import type {
  OptimizeRequest,
  OptimizeResponse,
  ItemDetail,
  FinalStats,
  PresetDetail,
} from '../../src/api/client';
import type {
  SolveParams,
  GunLookupEntry,
  TraderLevels,
} from '../../src/solver/types';
import type { ObjectiveAxes } from '../../src/solver/trueErgo';
import { PREVENT_OVERSWING_VIOLATION, validateBuild } from '../../src/solver/validateBuild';
import { mergeComponents, presetSupply } from '../../src/solver/presetSupply';

export interface ModelResponse extends OptimizeResponse {
  axes?: ObjectiveAxes;
  bound?: number;
  incumbentEligible?: boolean;
}

function isExpectedExactTedGap(errors: readonly string[]): boolean {
  return errors.length > 0 && errors.every(error => error === PREVENT_OVERSWING_VIOLATION);
}
import { buildLP, MOA_K } from '../../src/solver/lpBuilder';
import {
  classifyMipStatus,
  certifiedDualBound,
  incumbentBlockReason,
} from '../../src/solver/solver';
import { trueErgoDelta, overswingPercent, tedContribution } from '../../src/solver/trueErgo';
import { getAvailablePrice } from '../../src/solver/dataService';
import { canonicalizeTraderLevels } from '../../src/solver/reuseKey';

let highs: any = null;
async function loadHiGHS(): Promise<any> {
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
        const loader = module.exports as unknown as (opts: { wasmBinary: Uint8Array }) => Promise<any>;
        return loader({ wasmBinary });
      }
    } catch {
      // Fallback
    }
    const loader = (await import('highs')).default as unknown as () => Promise<any>;
    return loader();
  }

  // Browser: fetch both WASM binary and highs.js source from public/
  const base = '/';
  const [wasmResp, jsResp] = await Promise.all([
    fetch(base + 'highs.wasm'),
    fetch(base + 'highs.js'),
  ]);
  const wasmBinary = new Uint8Array(await wasmResp.arrayBuffer());
  const jsSource = await jsResp.text();

  const exports = {} as Record<string, unknown>;
  const module = { exports };
  const fn = new Function('module', 'exports', jsSource);
  fn(module, exports);
  const loader = module.exports as unknown as (opts: { wasmBinary: Uint8Array }) => Promise<any>;
  return loader({ wasmBinary });
}

function toOptimizeRequest(params: SolveParams): OptimizeRequest {
  return {
    weapon_id: params.weaponId,
    max_price: params.maxPrice ?? undefined,
    min_ergonomics: params.minErgonomics ?? undefined,
    max_recoil_v: params.maxRecoilV ?? undefined,
    max_recoil_sum: params.maxRecoilSum ?? undefined,
    min_mag_capacity: params.minMagCapacity ?? undefined,
    min_sighting_range: params.minSightingRange ?? undefined,
    max_weight: params.maxWeight ?? undefined,
    max_moa: params.maxMOA ?? undefined,
    include_items: params.includeItems ?? undefined,
    exclude_items: params.excludeItems ?? undefined,
    include_categories: params.includeCategories ?? undefined,
    exclude_categories: params.excludeCategories ?? undefined,
    ergo_weight: params.ergoWeight,
    recoil_weight: params.recoilWeight,
    price_weight: params.priceWeight,
    use_true_ergo: params.useTrueErgo,
    use_tchebycheff: params.useTchebycheff,
    prevent_overswing: params.preventOverswing,
    equip_ergo_modifier: params.equipErgoModifier ?? undefined,
    trader_levels: params.traderLevels ? (canonicalizeTraderLevels(params.traderLevels) as any) : undefined,
    flea_available: params.fleaAvailable,
    barter_available: params.barterAvailable,
    barter_exclude_dogtags: params.barterExcludeDogtags,
    player_level: params.playerLevel ?? undefined,
  };
}


export async function solveModel(params: SolveParams, interval?: [number, number], timeLimit = 60, customOptions?: Record<string, unknown>): Promise<ModelResponse> {
  const startTime = performance.now();
  try {
    if (!highs) {
      highs = await loadHiGHS();
      
    }
    const lp = buildLP(params, interval);
    const result = highs.solve(lp.lpString, {
      mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_feasibility_tolerance: 1e-8,
      primal_feasibility_tolerance: 1e-9, dual_feasibility_tolerance: 1e-9,
      time_limit: timeLimit,
      ...(customOptions || {}),
    });
    const stop = classifyMipStatus(result.Status);
    if (stop === 'infeasible') {
      return {
        status: 'infeasible',
        reason: 'No valid configuration found',
        selected_items: [], objective_value: 0, solve_time_ms: performance.now() - startTime,
      };
    }
    if (stop !== 'optimal') {
      return {
        status: 'incomplete',
        reason: result.Status,
        selected_items: [], objective_value: 0, solve_time_ms: performance.now() - startTime,
      };
    }
    const columns = result.Columns as Record<string, { Primal?: number }>;
    const expectedColumns: string[] = [];
    for (let i = 1; i <= lp.nItems; i++) expectedColumns.push(`x_${i}`, `buy_${i}`);
    for (let b = 1; b <= lp.nBases; b++) expectedColumns.push(`base_${b}`);
    for (const item of lp.multiSlotItemIndices) {
      for (const slot of lp.itemToSlotIndices.get(item) ?? []) expectedColumns.push(`p_${item}_${slot}`);
    }
    const blocked = incumbentBlockReason(columns, expectedColumns, lp.nBases, []);
    if (blocked) {
      return {
        status: 'incomplete',
        reason: blocked,
        selected_items: [], objective_value: 0, solve_time_ms: performance.now() - startTime,
      };
    }
    const solvedColumns = columns as Record<string, { Primal: number }>;
    const selectedIds: string[] = [];
    for (let i = 1; i <= lp.nItems; i++) {
      const col = solvedColumns[`x_${i}`];
      if (col && col.Primal > 0.5) {
        selectedIds.push(lp.indexToItem[i]);
      }
    }

    // Find selected base
    let selectedBaseId: string | null = null;
    for (let b = 0; b < lp.nBases; b++) {
      const col = solvedColumns[`base_${b + 1}`];
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
      const xCol = solvedColumns[`x_${i}`];
      if (!xCol || xCol.Primal < 0.5) continue; // not selected
      const buyCol = solvedColumns[`buy_${i}`];
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
        receiver_id: params.weaponId,
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
          receiver_id: preset.receiver_id,
          items: mergeComponents(preset.items ?? []),
          icon: preset.image ?? undefined,
          image_large: preset.image ?? undefined,
          source,
          purchase_label: label,
          barter_requirements: presetBarterReqs,
          parts_count: presetSupply(preset.items).size || undefined,
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
      true_ergo_delta: trueErgoDelta(totalErgo, totalWeight, params.equipErgoModifier ?? 0),
      overswing_pct: overswingPercent(totalErgo, totalWeight, params.equipErgoModifier ?? 0),
      moa: finalMOA,
    };
    for (const d of detailedItems) {
      if (d.weight == null && !d.ergonomics) continue;
      d.ted_delta = tedContribution(
        totalErgo, totalWeight, d.ergonomics || 0, d.weight || 0, params.equipErgoModifier ?? 0,
      );
    }
    // Validate hard numerical limits against the actual reconstructed build,
    // rather than trusting rounded display values or auxiliary LP variables.
    const eps = 1e-6;
    const violatesLimit =
      (params.maxPrice != null && totalPrice > params.maxPrice + eps) ||
      (params.minErgonomics != null && finalStats.ergonomics < params.minErgonomics - eps) ||
      (params.maxWeight != null && totalWeight > params.maxWeight + eps) ||
      (params.maxRecoilV != null && finalStats.recoil_vertical > params.maxRecoilV + eps) ||
      (params.maxRecoilSum != null && finalStats.recoil_vertical + finalStats.recoil_horizontal > params.maxRecoilSum + eps) ||
      (params.maxMOA != null && finalMOA > params.maxMOA + eps);
    if (violatesLimit) {
      return { status: 'incomplete', reason: 'Reconstructed build did not satisfy a hard numerical limit', selected_items: [], objective_value: 0 };
    }

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
        const pVar = solvedColumns[`p_${itemIdx}_${slotIdx}`];
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

    const axes = lp.axes(solvedColumns, params.useTrueErgo ? finalStats.true_ergo_delta! : finalStats.ergonomics);
    const candidate: ModelResponse = {
      status: 'optimal',
      selected_items: detailedItems,
      selected_preset: presetDetail,
      objective_value: lp.score(axes),
      final_stats: finalStats,
      slot_pairs: slotPairs,
    };
    const validationErrors = validateBuild(toOptimizeRequest(params), candidate, params.itemLookup);
    const rejected = incumbentBlockReason(columns, expectedColumns, lp.nBases, validationErrors);
    const dual = certifiedDualBound(result.Status, result.ObjectiveValue);
    if (rejected) {
      // The secant is an outer approximation. Exact TED can fail while the
      // optimal relaxation value remains a valid upper bound for this interval.
      if (isExpectedExactTedGap(validationErrors) && dual != null) {
        return {
          status: 'optimal',
          bound: dual,
          incumbentEligible: false,
          reason: rejected,
          selected_items: [], objective_value: 0, solve_time_ms: performance.now() - startTime,
        };
      }
      // Placement, purchasing, and decoding failures are diagnostics. They do
      // not become ordinary nonlinear relaxation error and do not publish a bound.
      return {
        status: 'incomplete',
        reason: rejected,
        selected_items: [], objective_value: 0, solve_time_ms: performance.now() - startTime,
      };
    }
    return {
      status: dual != null ? 'optimal' : 'feasible',
      incumbentEligible: true,
      selected_items: detailedItems,
      selected_preset: presetDetail,
      objective_value: lp.score(axes),
      axes,
      bound: dual,
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
    
    return {
      status: 'error',
      reason: msg,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: performance.now() - startTime,
    };
  }
}

