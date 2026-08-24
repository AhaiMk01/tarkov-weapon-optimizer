/**
 * HiGHS LP Solver Integration
 * Builds LP string via lpBuilder, solves with HiGHS WASM, decodes result.
 */

import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client';
import type { SolveParams, GunLookupEntry } from './types';
export type { SolveParams } from './types';
import { buildLP, MOA_K, EVO_ERGO_K, EVO_ERGO_SWEEP_KS, eedOf, eedTangentK } from './lpBuilder';
import { getAvailablePrice } from './dataService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highs: any = null;
let highsCorrupted = false;

// Load HiGHS module.  In Node (tests), use the npm package directly.
// In browser workers, Vite's ES module bundling corrupts the Emscripten
// runtime, so we load highs.js from public/ at runtime instead.
async function loadHiGHS() {
  const base = import.meta.env?.BASE_URL || '/';

  // Node / test environment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).WorkerGlobalScope === 'undefined' && typeof (globalThis as any).window === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — dynamic require for Node
    const loader = (await import('highs')).default;
    return loader();
  }

  // Browser: fetch both WASM binary and highs.js source, then evaluate
  // highs.js with CJS shims.  Vite's ES module bundling corrupts the
  // Emscripten runtime, so we bypass the bundler entirely.
  const [wasmResp, jsResp] = await Promise.all([
    fetch(base + 'highs.wasm'),
    fetch(base + 'highs.js'),
  ]);
  const wasmBinary = new Uint8Array(await wasmResp.arrayBuffer());
  const jsSource = await jsResp.text();

  // Evaluate highs.js with CJS module/exports shims
  const exports = {} as Record<string, unknown>;
  const module = { exports };
  const fn = new Function('module', 'exports', jsSource);
  fn(module, exports);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loader = module.exports as any;

  return loader({ wasmBinary });
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  const startTime = performance.now();

  try {
    if (!highs || highsCorrupted) {
      highs = await loadHiGHS();
      highsCorrupted = false;
    }

    const lp = buildLP(params);
    const result = highs.solve(lp.lpString);

    if (result.Status !== 'Optimal') {
      return {
        status: 'infeasible',
        reason: result.Status === 'Infeasible' ? 'No valid configuration found' : result.Status,
        selected_items: [],
        selected_preset: undefined,
        objective_value: 0,
        solve_time_ms: performance.now() - startTime,
      };
    }

    // Decode solution: read x_i variables
    const columns = result.Columns || {};
    const selectedIds: string[] = [];
    for (let i = 1; i <= lp.nItems; i++) {
      const col = columns[`x_${i}`];
      if (col && col.Primal > 0.5) {
        selectedIds.push(lp.indexToItem[i]);
      }
    }

    // Find selected base
    let selectedBaseId: string | null = null;
    for (let b = 0; b < lp.nBases; b++) {
      const col = columns[`base_${b + 1}`];
      if (col && col.Primal > 0.5) {
        selectedBaseId = lp.baseIds[b];
        break;
      }
    }

    // Compute stats from raw item data (matching test_compare.py)
    const weapon = params.itemLookup[params.weaponId] as GunLookupEntry;
    const wStats = weapon.stats;

    let totalErgo = wStats.naked_ergonomics;
    let totalRecoilMod = 0;
    let totalAccuracyMod = 0;
    let totalWeight = wStats.weight || 0;
    let barrelCOI = 0; // installed replaceable barrel's centerOfImpact — REPLACES weapon's intrinsic COI when present

    const detailedItems: ItemDetail[] = [];

    for (const itemId of selectedIds) {
      const entry = params.itemLookup[itemId];
      if (!entry) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = entry.data as Record<string, any>;
      const icon = data.image512pxLink ?? data.imageLink ?? data.image8xLink ?? data.iconLink ?? data.iconLinkFallback;
      const imageLarge = data.image512pxLink ?? data.imageLink ?? data.image8xLink;

      if (entry.type === 'mod') {
        const ms = entry.stats;
        totalErgo += ms.ergonomics || 0;
        totalRecoilMod += ms.recoil_modifier || 0;
        totalAccuracyMod += ms.accuracy_modifier || 0;
        totalWeight += ms.weight || 0;
        if ((ms.center_of_impact ?? 0) > 0) barrelCOI = ms.center_of_impact;

        // Initialize with no price/source — the buy loop below will fill in
        // price and source only for items that are actually purchased (buy_i=1).
        // Items retained from a preset keep price=0 and no source.
        detailedItems.push({
          id: itemId,
          name: data.name ?? 'Unknown',
          price: 0,
          icon,
          image_large: imageLarge || undefined,
          source: undefined,
          purchasable: ms.purchasable,
          reference_price_rub: ms.reference_price_rub,
          ergonomics: ms.ergonomics || 0,
          recoil_modifier: ms.recoil_modifier || 0,
          accuracy_modifier: ms.accuracy_modifier || undefined,
          weight: ms.weight || undefined,
          category: ms.category || undefined,
          handbook_categories: ms.handbook_categories?.length ? ms.handbook_categories : undefined,
          capacity: ms.capacity || undefined,
          sighting_range: ms.sighting_range || undefined,
        });
      } else {
        detailedItems.push({
          id: itemId,
          name: data.name ?? 'Unknown',
          price: 0,
          icon,
          source: '',
          ergonomics: 0,
          recoil_modifier: 0,
        });
      }
    }

    // Compute price using buy variables with trader-filtered prices
    const traderLevels = params.traderLevels ?? undefined;
    const fleaAvailable = params.fleaAvailable ?? true;
    const playerLevel = params.playerLevel ?? null;
    const barterAvailable = params.barterAvailable ?? false;
    const barterExcludeDogtags = params.barterExcludeDogtags ?? false;

    let buyPrice = 0;
    for (let i = 1; i <= lp.nItems; i++) {
      const itemId = lp.indexToItem[i];
      const xCol = columns[`x_${i}`];
      if (!xCol || xCol.Primal < 0.5) continue; // not selected
      const buyCol = columns[`buy_${i}`];
      const isBought = buyCol && buyCol.Primal > 0.5;
      const entry = params.itemLookup[itemId];
      if (entry?.type !== 'mod') continue;
      const detail = detailedItems.find(d => d.id === itemId);
      if (!detail) continue;

      if (isBought) {
        const [price, src] = getAvailablePrice(entry.stats, traderLevels, fleaAvailable, playerLevel, barterAvailable, barterExcludeDogtags);
        buyPrice += price;
        detail.source = src ?? undefined;
        detail.price = price;
        if (src?.startsWith('barter:') && entry.stats.offers) {
          const offer = entry.stats.offers.find(o => o.source === src);
          if (offer?.barter_requirements) {
            detail.barter_requirements = offer.barter_requirements;
          }
        }
      } else if (!entry.stats.purchasable) {
        // FiR / unpurchasable item — show as such
        detail.source = 'not_purchasable';
      }
      // else: preset-retained item — keeps price=0, source=undefined
    }

    // Base price (use filtered preset price)
    let basePrice = 0;
    let presetDetail: PresetDetail | undefined;
    // Shared weapon info for preset tooltip
    const weaponTooltip = {
      caliber: wStats.caliber || undefined,
      fire_rate: wStats.fire_rate || undefined,
      fire_modes: wStats.fire_modes?.length ? wStats.fire_modes : undefined,
      default_ergo: wStats.default_ergonomics || undefined,
      default_recoil_v: wStats.default_recoil_v || undefined,
      default_recoil_h: wStats.default_recoil_h || undefined,
      weight: wStats.weight || undefined,
    };

    if (selectedBaseId === 'naked') {
      basePrice = wStats.price < 100_000_000 ? wStats.price : 0;
      const gunData = weapon.data as Record<string, unknown>;
      presetDetail = {
        id: params.weaponId,
        name: (gunData.name as string) ?? 'Naked Gun',
        price: basePrice,
        items: [],
        icon: (gunData.iconLink ?? gunData.iconLinkFallback ?? wStats.default_preset_image) as string | undefined,
        image_large: (gunData.image512pxLink ?? gunData.imageLink ?? gunData.image8xLink) as string | undefined,
        source: wStats.price_source !== 'not_available' ? wStats.price_source : undefined,
        ...weaponTooltip,
      };
    } else if (selectedBaseId) {
      const preset = (weapon.presets || []).find(p => p.id === selectedBaseId)
        || (weapon.all_presets || []).find(p => p.id === selectedBaseId);
      if (preset) {
        const [filteredPrice, src, , purchaseLabel] = getAvailablePrice(preset, traderLevels, fleaAvailable, playerLevel, barterAvailable, barterExcludeDogtags);
        basePrice = filteredPrice;
        let source = src ?? undefined;
        let label = purchaseLabel ?? undefined;
        if (!source && preset.price_source && preset.price_source !== 'not_available') {
          source = preset.price_source;
        }
        if (!label && source === 'fleaMarket') {
          label = 'Flea Market';
        }
        let presetBarterReqs: Array<{ name: string; count: number; unit_price: number }> | undefined;
        if (source?.startsWith('barter:') && preset.offers) {
          const offer = preset.offers.find(o => o.source === source);
          if (offer?.barter_requirements) presetBarterReqs = offer.barter_requirements;
        }
        presetDetail = {
          id: preset.id,
          name: preset.name,
          price: filteredPrice,
          items: preset.items || [],
          icon: preset.image ?? undefined,
          image_large: preset.image ?? undefined,
          source,
          purchase_label: label,
          barter_requirements: presetBarterReqs,
          parts_count: preset.items?.length || undefined,
          ...weaponTooltip,
        };
      }
    }

    const totalPrice = buyPrice + basePrice;

    // BSG formula: displayed MOA = effectiveBaseCOI * (1 - accMod/100) * MOA_K
    // effectiveBaseCOI = installed replaceable-barrel COI if any, else weapon's intrinsic COI.
    const intrinsicCOI = wStats.center_of_impact || 0;
    const effectiveBaseCOI = barrelCOI > 0 ? barrelCOI : intrinsicCOI;
    const finalMOA = effectiveBaseCOI * (1 - totalAccuracyMod / 100) * MOA_K;

    const finalStats: FinalStats = {
      ergonomics: Math.max(0, Math.min(100, totalErgo)),
      recoil_vertical: wStats.naked_recoil_v * (1 + totalRecoilMod),
      recoil_horizontal: wStats.naked_recoil_h * (1 + totalRecoilMod),
      total_price: totalPrice,
      total_weight: totalWeight,
      evo_ergo: Math.max(0, Math.min(100, totalErgo)) - EVO_ERGO_K * totalWeight,
      eed: eedOf(totalErgo, totalWeight),
      moa: finalMOA,
    };

    // Reconstruct slot-item pairs for EFTForge build export.
    // For multi-slot items (precise mode), read p_{item}_{slot} placement
    // variables to get exact slot assignments. For single-slot items, use
    // BFS with greedy matching.
    const selectedSet = new Set(selectedIds);
    // Pre-resolve placement for multi-slot items via p_ variables
    const itemSlotPlacement = new Map<string, Set<string>>(); // itemId → assigned slotIds
    for (const itemIdx of lp.multiSlotItemIndices) {
      const itemId = lp.indexToItem[itemIdx];
      if (!selectedSet.has(itemId)) continue;
      const slotIndices = lp.itemToSlotIndices.get(itemIdx);
      if (!slotIndices) continue;
      for (const slotIdx of slotIndices) {
        const pVar = columns[`p_${itemIdx}_${slotIdx}`];
        if (pVar && pVar.Primal > 0.5) {
          if (!itemSlotPlacement.has(itemId)) itemSlotPlacement.set(itemId, new Set());
          itemSlotPlacement.get(itemId)!.add(lp.indexToSlot[slotIdx]);
        }
      }
    }
    // BFS from weapon root in parent-before-child order
    const slotPairs: [string, string][] = [];
    const placedItems = new Set<string>(); // each item ID placed at most once
    const queue = [lp.weaponId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const ownerId = queue.shift()!;
      if (visited.has(ownerId)) continue;
      visited.add(ownerId);
      for (const [slotId, owner] of Object.entries(lp.slotOwnerMap)) {
        if (owner !== ownerId) continue;
        const candidates = lp.slotItemsMap[slotId];
        if (!candidates) continue;
        for (const itemId of candidates) {
          if (!selectedSet.has(itemId)) continue;
          if (placedItems.has(itemId)) continue;
          // For multi-slot items, only assign to the slot the solver chose
          const placements = itemSlotPlacement.get(itemId);
          if (placements && !placements.has(slotId)) continue;
          placedItems.add(itemId);
          slotPairs.push([slotId, itemId]);
          queue.push(itemId);
          break;
        }
      }
    }

    return {
      status: 'optimal',
      selected_items: detailedItems,
      selected_preset: presetDetail,
      objective_value: result.ObjectiveValue || 0,
      final_stats: finalStats,
      solve_time_ms: performance.now() - startTime,
      slot_pairs: slotPairs,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'number' ? `HiGHS WASM exception (code ${e})`
      : `Unknown solver error: ${String(e)}`;
    console.error('HiGHS Solve Error:', e);
    // Mark as corrupted so next solve reinitializes WASM
    highsCorrupted = true;
    return {
      status: 'infeasible',
      reason: msg,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: performance.now() - startTime,
    };
  }
}

/**
 * EvoErgo-aware solve. With useEvoErgo and no explicit k, solves once per
 * EVO_ERGO_SWEEP_KS value and returns the build with the best true EED
 * (quadratic threshold curve). EED is convex in ergo, so its maximizer is
 * always some tangent line's optimum — the sweep is exact up to grid
 * resolution. An explicit evoErgoK (tests, tuning) bypasses the sweep.
 */
export async function solveEvoErgo(params: SolveParams): Promise<OptimizeResponse> {
  if (!params.useEvoErgo || params.evoErgoK != null) {
    return solve(params);
  }

  // Same weight flooring as lpBuilder, so candidate selection stays consistent
  // with what each solve optimized.
  const ew = Math.max(params.ergoWeight ?? 1, 0.01);
  const rw = Math.max(params.recoilWeight ?? 1, 0.01);
  const pw = Math.max(params.priceWeight ?? 0, 0.01);

  type Candidate = { r: OptimizeResponse; k: number };
  const candidates: Candidate[] = [];
  const solvedKs: number[] = [];
  let fallback: OptimizeResponse | null = null;
  let totalMs = 0;

  const runK = async (k: number) => {
    const r = await solve({ ...params, evoErgoK: k });
    totalMs += r.solve_time_ms ?? 0;
    solvedKs.push(k);
    if (r.status === 'optimal' && r.final_stats) candidates.push({ r, k });
    else fallback = fallback ?? r;
  };
  for (const k of EVO_ERGO_SWEEP_KS) await runK(k);

  // Candidates are compared in the user's own objective units so non-trivial
  // recoil/price weights keep their influence over which tradeoff wins: the
  // ergo axis contributes true EED converted to ergo-equivalents at one shared
  // reference tangent slope; recoil and price contribute as in the LP
  // objective (ew·10⁴ per ergo point, rw·10⁴ per scaled recoil unit, pw·10 per
  // ruble). With ergo-dominant weights this reduces to picking max EED.
  const score = (c: Candidate, kRef: number): number => {
    const s = c.r.final_stats!;
    const recoilScaled = c.r.selected_items.reduce(
      (a, it) => a + Math.round((it.recoil_modifier ?? 0) * 1000), 0);
    return ew * 10000 * ((s.eed ?? eedOf(s.ergonomics, s.total_weight)) / 15) * kRef
      - rw * 10000 * recoilScaled
      - pw * 10 * s.total_price;
  };
  const pickWinner = (): Candidate | null => {
    if (candidates.length === 0) return null;
    const maxEed = candidates.reduce((a, b) =>
      (b.r.final_stats!.eed ?? -Infinity) > (a.r.final_stats!.eed ?? -Infinity) ? b : a);
    const kRef = eedTangentK(maxEed.r.final_stats!.ergonomics);
    return candidates.reduce((a, b) => (score(b, kRef) > score(a, kRef) ? b : a));
  };

  // Iterated tangent refinement: the exact exchange rate is weapon-specific —
  // k(E) = 1/KG'(E) at the ergo the build actually reaches. The grid brackets
  // [26, 100] build ergo; iterating also covers k > 15 for sub-26-ergo builds.
  for (let iter = 0; iter < 2; iter++) {
    const w = pickWinner();
    if (!w) break;
    const kStar = eedTangentK(w.r.final_stats!.ergonomics);
    if (solvedKs.some(k => Math.abs(k - kStar) <= 0.25)) break;
    await runK(kStar);
  }

  const winner = pickWinner();
  const out = winner?.r ?? fallback;
  if (!out) {
    // unreachable: EVO_ERGO_SWEEP_KS is non-empty, so runK recorded a result
    return solve(params);
  }
  out.solve_time_ms = totalMs;
  if (winner) out.evo_ergo_k = winner.k;
  return out;
}
