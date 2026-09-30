/**
 * HiGHS LP Solver Integration
 * Builds LP string via lpBuilder, solves with HiGHS WASM, decodes result.
 */

import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client';
import type { SolveParams, GunLookupEntry, IdealPoint } from './types';
export type { SolveParams, IdealPoint } from './types';
import { buildLP, MOA_K } from './lpBuilder';
import { trueErgoDelta } from './trueErgo';
import type { ObjectiveAxes } from './trueErgo';
import { getAvailablePrice } from './dataService';

interface HighsInstance {
  solve(problem: string, options?: {
    mip_rel_gap: number; mip_abs_gap: number; mip_feasibility_tolerance: number;
    primal_feasibility_tolerance: number; dual_feasibility_tolerance: number; time_limit: number;
  }): { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal?: number }> };
}
let highs: HighsInstance | null = null;
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
        const loader = module.exports as unknown as (opts: { wasmBinary: Uint8Array }) => Promise<HighsInstance>;
        return loader({ wasmBinary });
      }
    } catch {
      // Fallback to stock npm package
    }

    const loader = (await import('highs')).default as unknown as () => Promise<HighsInstance>;
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
  const loader = module.exports as unknown as (opts: { wasmBinary: Uint8Array }) => Promise<HighsInstance>;

  return loader({ wasmBinary });
}

interface ModelResponse extends OptimizeResponse {
  axes?: ObjectiveAxes;
  bound?: number;
}

/**
 * Endpoint payoff table in the SAME raw-ergo/TED, recoil, purchase-cost axes as
 * the final objective. Every endpoint retains every user feasibility constraint.
 */
export async function computeIdealPoint(params: SolveParams): Promise<IdealPoint> {
  const deadline = performance.now() + Math.max(0, params.timeLimitMs ?? 60_000);
  const base = { ...params, useTchebycheff: false, idealPoint: undefined };
  const pay: ObjectiveAxes[] = [];
  for (const weights of [[100, 0, 0], [0, 100, 0], [0, 0, 100]]) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error('Ideal-point time limit reached');
    const r = await solveDetailed({ ...base, timeLimitMs: remaining, ergoWeight: weights[0], recoilWeight: weights[1], priceWeight: weights[2] });
    if (r.status !== 'optimal' || !r.axes) {
      throw new Error(`Ideal-point endpoint not certified: ${r.reason ?? r.status}`);
    }
    pay.push(r.axes);
  }
  return {
    zE: Math.max(...pay.map(p => p.fE)), nadE: Math.min(...pay.map(p => p.fE)),
    zR: Math.min(...pay.map(p => p.fR)), nadR: Math.max(...pay.map(p => p.fR)),
    zP: Math.min(...pay.map(p => p.fP)), nadP: Math.max(...pay.map(p => p.fP)),
  };
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  const result = await solveDetailed(params);
  const { axes: _axes, bound: _bound, ...response } = result;
  void _axes;
  void _bound;
  return response;
}

async function solveDetailed(input: SolveParams): Promise<ModelResponse> {
  const start = performance.now();
  const deadline = start + Math.max(0, input.timeLimitMs ?? 60_000);
  let params = { ...input };
  const nonlinear = !!(params.useTrueErgo || params.preventOverswing);
  // Certificates describe real slot placements, not the fast model's restrictions.
  if (nonlinear) params.preciseMode = true;
  if (params.useTchebycheff && !params.idealPoint) {
    try {
      params = { ...params, idealPoint: await computeIdealPoint({ ...params, timeLimitMs: Math.max(0, deadline - performance.now()) }) };
    } catch (error) {
      return { status: 'incomplete', reason: String(error), selected_items: [], objective_value: 0, solve_time_ms: performance.now() - start };
    }
  }
  if (performance.now() >= deadline) {
    return { status: 'incomplete', reason: 'Request time limit reached', selected_items: [], objective_value: 0, solve_time_ms: performance.now() - start };
  }
  if (!nonlinear) return solveModel(params, undefined, (deadline - performance.now()) / 1000);

  const tolerance = Math.max(1e-7, params.objectiveTolerance ?? 1e-5);
  const maxNodes = Math.max(0, params.maxSpatialNodes ?? 512);
  const [lo, hi] = buildLP(params).weightBounds;
  type Node = { interval: [number, number]; bound: number };
  const queue: Node[] = lo < 3 && hi > 3
    ? [{ interval: [lo, 3], bound: Infinity }, { interval: [3, hi], bound: Infinity }]
    : [{ interval: [lo, hi], bound: Infinity }];
  let incumbent: ModelResponse | undefined;
  let nodes = 0;
  let unresolved = -Infinity;
  let limitReason = 'Spatial node or time limit reached';
  // Keep the largest discarded bound too: tolerance pruning must not report gap=0.
  let closedBound = -Infinity;
  while (queue.length && nodes < maxNodes && performance.now() < deadline) {
    queue.sort((a, b) => b.bound - a.bound);
    const node = queue.shift()!;
    if (incumbent && node.bound <= incumbent.objective_value + tolerance) {
      closedBound = Math.max(closedBound, node.bound);
      continue;
    }
    const result = await solveModel(params, node.interval, Math.max(0.001, (deadline - performance.now()) / 1000));
    nodes++;
    if (result.status === 'infeasible') continue;
    if (result.status !== 'optimal' || result.bound == null || !result.final_stats) {
      unresolved = Math.max(unresolved, node.bound);
      limitReason = result.reason ?? result.status;
      break;
    }
    const bound = Math.min(node.bound, result.bound);
    const feasible = !params.preventOverswing || result.final_stats.true_ergo_delta! >= -1e-7;
    if (feasible && (!incumbent || result.objective_value > incumbent.objective_value)) incumbent = result;
    if (incumbent && bound <= incumbent.objective_value + tolerance) {
      closedBound = Math.max(closedBound, bound);
      continue;
    }
    const [a, b] = node.interval;
    const mid = (a + b) / 2;
    if (mid <= a || mid >= b || b - a < 1e-10) {
      unresolved = Math.max(unresolved, bound);
      limitReason = 'Numerical interval resolution reached before certification';
      break;
    }
    queue.push({ interval: [a, mid], bound }, { interval: [mid, b], bound });
  }
  const upper = Math.max(incumbent?.objective_value ?? -Infinity, closedBound, unresolved, ...queue.map(n => n.bound));
  if (!incumbent) {
    const exhausted = !queue.length && unresolved === -Infinity;
    return {
      status: exhausted ? 'infeasible' : 'incomplete',
      reason: exhausted ? 'No valid configuration found' : limitReason,
      selected_items: [], objective_value: 0, solve_time_ms: performance.now() - start,
      ideal_point: params.idealPoint,
    };
  }
  const gap = Math.max(0, upper - incumbent.objective_value);
  const certified = gap <= tolerance;
  return {
    ...incumbent,
    status: certified ? 'optimal' : 'feasible',
    reason: certified ? undefined : limitReason,
    solve_time_ms: performance.now() - start,
    optimization: { lower_bound: incumbent.objective_value, upper_bound: upper, absolute_gap: gap, tolerance, nodes, termination: certified ? 'optimal' : 'limit' },
  };
}

async function solveModel(params: SolveParams, interval?: [number, number], timeLimit = 60): Promise<ModelResponse> {
  const startTime = performance.now();
  try {
    if (!highs || highsCorrupted) {
      highs = await loadHiGHS();
      highsCorrupted = false;
    }
    const lp = buildLP(params, interval);
    const result = highs.solve(lp.lpString, {
      mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_feasibility_tolerance: 1e-8,
      primal_feasibility_tolerance: 1e-9, dual_feasibility_tolerance: 1e-9,
      time_limit: timeLimit,
    });
    if (result.Status !== 'Optimal') {
      return {
        status: result.Status === 'Infeasible' ? 'infeasible' : 'incomplete',
        reason: result.Status === 'Infeasible' ? 'No valid configuration found' : result.Status,
        selected_items: [], objective_value: 0, solve_time_ms: performance.now() - startTime,
      };
    }
    // Decode solution: read x_i variables
    const columns = result.Columns as Record<string, { Primal: number }>;
    // Never round a fractional relaxation into an alleged feasible build.
    for (const [name, column] of Object.entries(columns) as Array<[string, { Primal: number }]>) {
      if (/^(x_|buy_|base_|p_)/.test(name) && Math.abs(column.Primal - Math.round(column.Primal)) > 1e-7) {
        return { status: 'incomplete', reason: 'Solver returned a nonintegral selection', selected_items: [], objective_value: 0 };
      }
    }
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
      true_ergo_delta: trueErgoDelta(totalErgo, totalWeight, params.equipErgoModifier ?? 0),
      moa: finalMOA,
    };
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

    const axes = lp.axes(columns, params.useTrueErgo ? finalStats.true_ergo_delta! : finalStats.ergonomics);
    return {
      status: 'optimal',
      selected_items: detailedItems,
      selected_preset: presetDetail,
      objective_value: lp.score(axes),
      axes,
      // HiGHS has zero relative MIP gap; reserve an absolute numeric margin.
      bound: result.ObjectiveValue + 1e-7,
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
      status: 'error',
      reason: msg,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: performance.now() - startTime,
    };
  }
}

