/**
 * HiGHS solver integration + solution decoding.
 * Wraps LP building + HiGHS solving + result extraction.
 */

import type { ItemLookup, CompatibilityMap, TraderLevels } from './types.ts';
import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client.ts';
import { buildLP } from './lpBuilder.ts';
import type { VarMap } from './lpBuilder.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HighsInstance = { solve: (lp: string, options?: Record<string, unknown>) => any };

// Static URL reference — Vite detects `new URL(string_literal, import.meta.url)`
// and bundles the WASM file with a content hash, replacing this with the correct path.
const highsWasmUrl = new URL('../../node_modules/highs/build/highs.wasm', import.meta.url).href;

let highsInstance: HighsInstance | null = null;
let highsLoading: Promise<HighsInstance> | null = null;

export async function initHiGHS(): Promise<HighsInstance> {
  if (highsInstance) return highsInstance;
  if (highsLoading) return highsLoading;

  highsLoading = (async () => {
    const highsLoader = (await import('highs')).default;
    const instance = await highsLoader({
      locateFile: () => highsWasmUrl,
    });

    // Sanity check: solve a trivial LP to confirm HiGHS works
    try {
      const testLP = 'Maximize\n obj: x\nSubject To\n c1: x <= 10\nBounds\n 0 <= x <= 10\nEnd\n';
      const testResult = instance.solve(testLP);
      console.log('HiGHS sanity check passed. Status:', testResult.Status);
    } catch (e) {
      console.error('HiGHS sanity check FAILED:', e);
    }

    highsInstance = instance;
    return instance;
  })();

  return highsLoading;
}

export interface SolveParams {
  weaponId: string;
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  includeItems?: string[] | null;
  excludeItems?: string[] | null;
  includeCategories?: string[][] | null;
  excludeCategories?: string[] | null;
  ergoWeight?: number;
  recoilWeight?: number;
  priceWeight?: number;
  traderLevels?: TraderLevels | null;
  fleaAvailable?: boolean;
  playerLevel?: number | null;
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  const startTime = performance.now();
  const highs = await initHiGHS();

  const { lpString, varMap, infeasibleReason } = buildLP({
    weaponId: params.weaponId,
    itemLookup: params.itemLookup,
    compatibilityMap: params.compatibilityMap,
    maxPrice: params.maxPrice,
    minErgonomics: params.minErgonomics,
    maxRecoilV: params.maxRecoilV,
    maxRecoilSum: params.maxRecoilSum,
    minMagCapacity: params.minMagCapacity,
    minSightingRange: params.minSightingRange,
    maxWeight: params.maxWeight,
    includeItems: params.includeItems,
    excludeItems: params.excludeItems,
    includeCategories: params.includeCategories,
    excludeCategories: params.excludeCategories,
    ergoWeight: params.ergoWeight,
    recoilWeight: params.recoilWeight,
    priceWeight: params.priceWeight,
    traderLevels: params.traderLevels,
    fleaAvailable: params.fleaAvailable,
    playerLevel: params.playerLevel,
  });

  if (infeasibleReason) {
    return {
      status: 'infeasible',
      reason: infeasibleReason,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: Math.round(performance.now() - startTime),
    };
  }

  // Debug: log LP summary before solving
  console.log(`LP model: ${lpString.length} chars, ${lpString.split('\n').length} lines`);
  console.log('LP first 2000 chars:\n', lpString.slice(0, 2000));

  // Validate LP string for common format issues
  if (lpString.includes('NaN') || lpString.includes('undefined') || lpString.includes('Infinity')) {
    const issues: string[] = [];
    if (lpString.includes('NaN')) issues.push('NaN');
    if (lpString.includes('undefined')) issues.push('undefined');
    if (lpString.includes('Infinity')) issues.push('Infinity');
    console.error(`LP contains invalid values: ${issues.join(', ')}`);
    console.error('LP first 3000 chars:\n', lpString.slice(0, 3000));
    // Find the specific lines with issues
    for (const line of lpString.split('\n')) {
      if (line.includes('NaN') || line.includes('undefined') || line.includes('Infinity')) {
        console.error('Bad LP line:', line);
      }
    }
    return {
      status: 'infeasible',
      reason: `Internal error: LP model contains invalid values (${issues.join(', ')})`,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: Math.round(performance.now() - startTime),
    };
  }

  let solution;
  try {
    solution = highs.solve(lpString, {
      time_limit: 30,
    });
  } catch (e) {
    // Log LP for debugging
    console.error('HiGHS solve failed. LP length:', lpString.length);
    console.error('LP first 3000 chars:\n', lpString.slice(0, 3000));
    console.error('LP last 1000 chars:\n', lpString.slice(-1000));
    // Log section headers
    const lines = lpString.split('\n');
    const sectionLines = lines.filter(l =>
      /^(Maximize|Minimize|Subject To|Bounds|General|Generals|Binary|Binaries|End)/i.test(l.trim())
    );
    console.error('LP sections:', sectionLines);
    console.error('Total lines:', lines.length, 'Total vars (Binary):', lines.filter(l => l.trim() && lines.indexOf('Binary') < lines.indexOf(l) && lines.indexOf(l) < lines.indexOf('End')).length);
    throw e;
  }

  const solveTimeMs = Math.round(performance.now() - startTime);

  if (solution.Status === 'Optimal' || solution.Status === 'Time limit reached' || solution.Status === 'Target for objective reached') {
    return decodeSolution(solution, varMap, params.itemLookup, params.weaponId, solveTimeMs);
  }

  return {
    status: 'infeasible',
    reason: `Solver status: ${solution.Status}`,
    selected_items: [],
    selected_preset: undefined,
    objective_value: 0,
    solve_time_ms: solveTimeMs,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeSolution(solution: any, varMap: VarMap, itemLookup: ItemLookup, weaponId: string, solveTimeMs: number): OptimizeResponse {
  const columns = solution.Columns;

  // Extract selected items
  const selectedIds: string[] = [];
  for (const [varName, itemId] of Object.entries(varMap.itemVars)) {
    const col = columns[varName];
    if (col && Math.round(col.Primal) === 1) {
      selectedIds.push(itemId);
    }
  }

  // Determine selected base
  let selectedPreset: PresetDetail | undefined;
  let selectedBase: string | null = null;
  for (const [varName, baseId] of Object.entries(varMap.baseVars)) {
    const col = columns[varName];
    if (col && Math.round(col.Primal) === 1) {
      selectedBase = baseId;
      break;
    }
  }

  const weapon = itemLookup[weaponId];
  if (weapon.type !== 'gun') throw new Error('Not a gun');

  if (selectedBase && selectedBase !== 'naked') {
    const presets = weapon.presets ?? [];
    const allPresets = weapon.all_presets ?? [];
    let presetInfo = presets.find(p => p.id === selectedBase);
    if (!presetInfo) presetInfo = allPresets.find(p => p.id === selectedBase);

    if (presetInfo) {
      let presetSource = presetInfo.price_source;
      if (presetSource === 'fleaMarket') presetSource = 'Flea Market';
      else if (!presetSource || presetSource === 'not_available') {
        if (presetInfo.offers.length > 0) presetSource = presetInfo.offers[0].vendor_name;
      }

      selectedPreset = {
        id: selectedBase,
        name: presetInfo.name,
        price: Math.floor(varMap.presetPricesMap[selectedBase] ?? 0),
        items: [...(varMap.presetItemsMap[selectedBase] ?? [])],
        icon: presetInfo.image ?? undefined,
        source: presetSource ?? undefined,
      };
    } else {
      selectedPreset = {
        id: selectedBase,
        name: 'Unknown Preset',
        price: 0,
        items: [],
      };
    }
  }

  // Compute final stats
  const finalStats = calculateTotalStats(varMap.weaponStats, selectedIds, itemLookup);

  // Add base price
  let basePrice = 0;
  if (selectedPreset) {
    basePrice = selectedPreset.price;
  } else if (!varMap.fallbackBase || varMap.fallbackBase.type !== 'naked') {
    basePrice = Math.floor(varMap.weaponStats.price);
  }
  finalStats.total_price += basePrice;

  // Build detailed items
  const detailedItems: ItemDetail[] = selectedIds.map(itemId => {
    const entry = itemLookup[itemId];
    if (!entry) return { id: itemId, name: 'Unknown', price: 0, ergonomics: 0, recoil_modifier: 0 };
    const data = entry.data as Record<string, unknown>;
    const icon = (data.iconLink ?? data.iconLinkFallback ?? data.imageLink ?? data.image512pxLink) as string | undefined;

    if (entry.type === 'mod') {
      const modStats = entry.stats;
      return {
        id: itemId,
        name: (data.name as string) ?? 'Unknown',
        price: modStats.price ?? 0,
        icon,
        source: modStats.price_source ?? 'Unknown',
        ergonomics: modStats.ergonomics ?? 0,
        recoil_modifier: modStats.recoil_modifier ?? 0,
      };
    }
    const gunStats = entry.stats;
    return {
      id: itemId,
      name: (data.name as string) ?? 'Unknown',
      price: gunStats.price ?? 0,
      icon,
      source: gunStats.price_source ?? 'Unknown',
      ergonomics: 0,
      recoil_modifier: 0,
    };
  });

  const status = solution.Status === 'Optimal' ? 'optimal' : 'feasible';

  return {
    status,
    selected_items: detailedItems,
    selected_preset: selectedPreset,
    fallback_base: varMap.fallbackBase ?? undefined,
    objective_value: solution.ObjectiveValue ?? 0,
    final_stats: finalStats,
    solve_time_ms: solveTimeMs,
  };
}

function calculateTotalStats(
  weaponStats: Record<string, number>,
  selectedMods: string[],
  itemLookup: ItemLookup,
): FinalStats {
  let totalErgo = weaponStats.naked_ergonomics ?? 0;
  let totalRecoilMod = 0;
  let totalPrice = 0;
  let totalWeight = weaponStats.weight ?? 0;

  for (const modId of selectedMods) {
    const entry = itemLookup[modId];
    if (!entry || entry.type !== 'mod') continue;
    const stats = entry.stats;
    totalErgo += stats.ergonomics ?? 0;
    totalRecoilMod += stats.recoil_modifier ?? 0;
    totalPrice += stats.price ?? 0;
    totalWeight += stats.weight ?? 0;
  }

  const recoilMultiplier = 1 + totalRecoilMod;
  const nakedRecoilV = weaponStats.naked_recoil_v ?? 0;
  const nakedRecoilH = weaponStats.naked_recoil_h ?? 0;

  return {
    ergonomics: totalErgo,
    recoil_vertical: nakedRecoilV * recoilMultiplier,
    recoil_horizontal: nakedRecoilH * recoilMultiplier,
    total_price: totalPrice,
    total_weight: totalWeight,
  };
}
