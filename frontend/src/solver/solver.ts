/**
 * HiGHS LP Solver Integration
 * Builds LP string via lpBuilder, solves with HiGHS WASM, decodes result.
 */

import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client';
import type { SolveParams, GunLookupEntry, IdealPoint } from './types';
export type { SolveParams, IdealPoint } from './types';
import { buildLP, MOA_K, EVO_ERGO_K, eedOf, estimateEvoErgoK } from './lpBuilder';
import { getAvailablePrice } from './dataService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highs: any = null;
let highsCorrupted = false;

// Load HiGHS module.  In Node (tests), use the npm package directly.
// In browser workers, Vite's ES module bundling corrupts the Emscripten
// runtime, so we load highs.js from public/ at runtime instead.
async function loadHiGHS() {
  const base = import.meta.env?.BASE_URL || '/';

  // Node / test environment: use custom WASM build from public/ if present on disk
  const g = globalThis as unknown as {
    WorkerGlobalScope?: unknown;
    window?: unknown;
    process?: { cwd: () => string };
  };
  if (typeof g.WorkerGlobalScope === 'undefined' && typeof g.window === 'undefined') {
    try {
      const cwd = g.process?.cwd?.() || '.';
      // @ts-expect-error — dynamic node import for test environments
      const fs = await import('fs');
      // @ts-expect-error — dynamic node import for test environments
      const path = await import('path');
      const wasmPath = path.resolve(cwd, 'public/highs.wasm');
      const jsPath = path.resolve(cwd, 'public/highs.js');
      if (fs.existsSync(wasmPath) && fs.existsSync(jsPath)) {
        const wasmBinary = new Uint8Array(fs.readFileSync(wasmPath));
        const jsSource = fs.readFileSync(jsPath, 'utf8');
        const exports = {} as Record<string, unknown>;
        const module = { exports };
        // @ts-expect-error — dynamic node import for test environments
        const { createRequire } = await import('module');
        const nodeRequire = createRequire(import.meta.url);
        new Function('module', 'exports', 'require', '__dirname', '__filename', jsSource)(
          module, exports, nodeRequire, cwd, 'highs.js'
        );
        const loader = module.exports as unknown as (opts: { wasmBinary: Uint8Array }) => Promise<unknown>;
        return loader({ wasmBinary });
      }
    } catch {
      // Fallback to stock npm package
    }

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

/**
 * Computes the ideal z* and nadir reference points across 3 endpoint solves
 * (pure ergo, pure recoil, pure price). Used by augmented Tchebycheff scalarization.
 */
export async function computeIdealPoint(params: SolveParams): Promise<IdealPoint> {
  const baseParams: SolveParams = {
    ...params,
    useTchebycheff: false,
    idealPoint: undefined,
  };

  const [ergoRes, recoilRes, priceRes] = await Promise.all([
    solve({ ...baseParams, ergoWeight: 100, recoilWeight: 0, priceWeight: 0 }),
    solve({ ...baseParams, ergoWeight: 0, recoilWeight: 100, priceWeight: 0 }),
    solve({ ...baseParams, ergoWeight: 0, recoilWeight: 0, priceWeight: 100 }),
  ]);

  const evalPt = (r: OptimizeResponse) => {
    const s = r.final_stats;
    if (!s) return { fE: 500, fR: 0, fP: 100000 };
    let fE = Math.min(100, Math.max(0, s.ergonomics)) * 10;
    if (params.useEvoErgo) {
      const weapon = params.itemLookup[params.weaponId];
      const baseErgo = weapon?.type === 'gun' ? weapon.stats.naked_ergonomics : 40;
      const k = params.evoErgoK ?? estimateEvoErgoK(baseErgo, params.equipErgoModifier ?? 0);
      fE = fE - k * 10 * s.total_weight;
    }
    const fR = r.selected_items.reduce((a, it) => a + Math.round((it.recoil_modifier ?? 0) * 1000), 0);
    const fP = s.total_price;
    return { fE, fR, fP };
  };

  const pay = [evalPt(ergoRes), evalPt(recoilRes), evalPt(priceRes)];
  const zE = Math.max(...pay.map(p => p.fE));
  const nadE = Math.min(...pay.map(p => p.fE));
  const zR = Math.min(...pay.map(p => p.fR));
  const nadR = Math.max(...pay.map(p => p.fR));
  const zP = Math.min(...pay.map(p => p.fP));
  const nadP = Math.max(...pay.map(p => p.fP));

  return { zE, nadE, zR, nadR, zP, nadP };
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  const startTime = performance.now();

    if (params.preventOverswing && (!params.overswingCuts || params.overswingCuts.length === 0)) {
      const b = Math.max(-0.9, Math.min(0.5, params.equipErgoModifier ?? 0));
      const cuts: Array<{ slope: number; rhs: number }> = [];
      let res = await solve({ ...params, preventOverswing: false, overswingCuts: cuts });
      for (let iter = 0; iter < 4; iter++) {
        if (res.status !== 'optimal' || !res.final_stats) break;
        const s = res.final_stats;
        const eed = eedOf(s.ergonomics, s.total_weight, b);
        if (eed >= -0.05) break;

        const E_raw = Math.min(100, Math.max(0, s.ergonomics));
        const E_eff = E_raw * (1 + b);
        const slopeEff = 2 * 0.0007556 * E_eff + 0.02736;
        const slopeRaw = slopeEff * (1 + b);
        const KG = 0.0007556 * E_eff * E_eff + 0.02736 * E_eff + 2.9159;
        const rhs = KG - slopeEff * E_eff;
        cuts.push({ slope: slopeRaw, rhs });

        res = await solve({ ...params, preventOverswing: false, overswingCuts: [...cuts] });
      }
      return res;
    }

  try {
    if (!highs || highsCorrupted) {
      highs = await loadHiGHS();
      highsCorrupted = false;
    }
    if (params.useTchebycheff && !params.idealPoint) {
      params.idealPoint = await computeIdealPoint(params);
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
      // Same availability filtering the LP priced this base with, so the
      // reported price and seller match what the solver actually paid.
      const [nakedPrice, nakedSource, , nakedLabel] = getAvailablePrice(
        wStats, traderLevels, fleaAvailable, playerLevel, barterAvailable, barterExcludeDogtags,
      );
      basePrice = nakedPrice;
      const gunData = weapon.data as Record<string, unknown>;
      presetDetail = {
        id: params.weaponId,
        name: (gunData.name as string) ?? 'Naked Gun',
        price: basePrice,
        items: [],
        icon: (gunData.iconLink ?? gunData.iconLinkFallback ?? wStats.default_preset_image) as string | undefined,
        image_large: (gunData.image512pxLink ?? gunData.imageLink ?? gunData.image8xLink) as string | undefined,
        source: nakedSource ?? undefined,
        purchase_label: nakedLabel ?? undefined,
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
      eed: eedOf(totalErgo, totalWeight, params.equipErgoModifier ?? 0),
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
      ideal_point: params.idealPoint,
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
 * EvoErgo-aware solve. Uses the weapon-specific closed-form tangent estimator
 * k(E_base + 25) to solve in a single LP pass (~9x faster than sweeping),
 * matching the true quadratic EED optimum across >95% of builds.
 * An explicit evoErgoK (tests, tuning) overrides the estimate.
 */
export async function solveEvoErgo(params: SolveParams): Promise<OptimizeResponse> {
  if (!params.useEvoErgo) {
    return solve(params);
  }
  const weapon = params.itemLookup[params.weaponId];
  const baseErgo = weapon?.type === 'gun' ? weapon.stats.naked_ergonomics : 40;
  const k = params.evoErgoK ?? estimateEvoErgoK(baseErgo, params.equipErgoModifier ?? 0);

  const res = await solve({ ...params, evoErgoK: k });
  if (res.status === 'optimal') {
    res.evo_ergo_k = k;
  }
  return res;
}
