/**
 * Pareto frontier exploration.
 * Ported from optimizer.py:explore_pareto()
 */

import type { ItemLookup, CompatibilityMap, TraderLevels } from './types.ts';
import type { ExplorePoint, OptimizeResponse } from '../api/client.ts';
import { solve } from './solver.ts';
import type { SolveParams } from './solver.ts';

export interface ParetoParams {
  weaponId: string;
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  ignore: 'price' | 'recoil' | 'ergo';
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
  steps?: number;
  traderLevels?: TraderLevels | null;
  fleaAvailable?: boolean;
  playerLevel?: number | null;
  preciseMode?: boolean;
}

function buildBaseParams(p: ParetoParams): Omit<SolveParams, 'ergoWeight' | 'recoilWeight' | 'priceWeight' | 'maxRecoilV' | 'minErgonomics' | 'maxPrice'> {
  return {
    weaponId: p.weaponId,
    itemLookup: p.itemLookup,
    compatibilityMap: p.compatibilityMap,
    maxRecoilSum: p.maxRecoilSum,
    minMagCapacity: p.minMagCapacity,
    minSightingRange: p.minSightingRange,
    maxWeight: p.maxWeight,
    includeItems: p.includeItems,
    excludeItems: p.excludeItems,
    includeCategories: p.includeCategories,
    excludeCategories: p.excludeCategories,
    traderLevels: p.traderLevels,
    fleaAvailable: p.fleaAvailable ?? true,
    playerLevel: p.playerLevel,
    preciseMode: p.preciseMode,
  };
}

export async function explorePareto(params: ParetoParams): Promise<ExplorePoint[]> {
  const { ignore, maxPrice, minErgonomics, maxRecoilV } = params;
  const steps = params.steps ?? 10;
  const weapon = params.itemLookup[params.weaponId];
  if (!weapon || weapon.type !== 'gun') return [];
  const nakedRecoilV = weapon.stats.naked_recoil_v;

  const base = buildBaseParams(params);
  const frontier: ExplorePoint[] = [];

  async function runSolve(weights: { ergoWeight: number; recoilWeight: number; priceWeight: number }, overrides: Partial<SolveParams> = {}): Promise<OptimizeResponse> {
    return solve({
      ...base,
      ergoWeight: weights.ergoWeight,
      recoilWeight: weights.recoilWeight,
      priceWeight: weights.priceWeight,
      maxPrice: maxPrice,
      minErgonomics: minErgonomics,
      maxRecoilV: maxRecoilV,
      ...overrides,
    });
  }

  // Tiny tiebreaker on secondary weights prevents multi-slot over-constraint
  // from blocking items (see lpBuilder.ts slot mutex). Must be small enough
  // not to collapse the Pareto frontier.
  const TB = 0.0001;
  const RECOIL_WEIGHTS = { ergoWeight: TB, recoilWeight: 1, priceWeight: TB };
  const ERGO_WEIGHTS = { ergoWeight: 1, recoilWeight: TB, priceWeight: TB };
  const PRICE_WEIGHTS = { ergoWeight: TB, recoilWeight: TB, priceWeight: 1 };

  function addPoint(result: OptimizeResponse) {
    if (result.status === 'infeasible' || !result.final_stats) return;
    const stats = result.final_stats;
    const recoilMultiplier = nakedRecoilV > 0 ? stats.recoil_vertical / nakedRecoilV : 1;
    frontier.push({
      ergo: Math.round(stats.ergonomics * 10) / 10,
      recoil_pct: Math.round((recoilMultiplier - 1) * 1000) / 10,
      recoil_v: Math.round(stats.recoil_vertical * 10) / 10,
      recoil_h: Math.round(stats.recoil_horizontal * 10) / 10,
      price: Math.round(stats.total_price),
      selected_items: result.selected_items,
      selected_preset: result.selected_preset,
      slot_pairs: result.slot_pairs,
      status: result.status,
      solve_time_ms: result.solve_time_ms,
    });
  }

  if (ignore === 'price') {
    const resultLow = await runSolve(RECOIL_WEIGHTS);
    const resultHigh = await runSolve(ERGO_WEIGHTS);

    if (resultLow.status === 'infeasible') return [];
    let rangeMin = Math.floor(resultLow.final_stats!.ergonomics);
    let rangeMax = resultHigh.status !== 'infeasible' ? Math.floor(resultHigh.final_stats!.ergonomics) : 100;

    if (minErgonomics != null) rangeMin = Math.max(rangeMin, minErgonomics);
    rangeMin = Math.max(0, rangeMin);
    rangeMax = Math.min(100, rangeMax);
    if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
    const stepSize = steps > 1 ? (rangeMax - rangeMin) / (steps - 1) : 0;

    for (let i = 0; i < steps; i++) {
      const target = Math.floor(rangeMin + i * stepSize);
      const result = await runSolve(RECOIL_WEIGHTS, { minErgonomics: target });
      addPoint(result);
    }
  } else if (ignore === 'recoil') {
    const resultLow = await runSolve(PRICE_WEIGHTS);
    const resultHigh = await runSolve(ERGO_WEIGHTS);

    if (resultLow.status === 'infeasible') return [];
    let rangeMin = Math.floor(resultLow.final_stats!.ergonomics);
    let rangeMax = resultHigh.status !== 'infeasible' ? Math.floor(resultHigh.final_stats!.ergonomics) : 100;

    if (minErgonomics != null) rangeMin = Math.max(rangeMin, minErgonomics);
    rangeMin = Math.max(0, rangeMin);
    rangeMax = Math.min(100, rangeMax);
    if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
    const stepSize = steps > 1 ? (rangeMax - rangeMin) / (steps - 1) : 0;

    for (let i = 0; i < steps; i++) {
      const target = Math.floor(rangeMin + i * stepSize);
      const result = await runSolve(PRICE_WEIGHTS, { minErgonomics: target });
      addPoint(result);
    }
  } else if (ignore === 'ergo') {
    const resultLow = await runSolve(RECOIL_WEIGHTS, { minErgonomics: minErgonomics });
    const resultHigh = await runSolve(PRICE_WEIGHTS, { minErgonomics: minErgonomics });

    if (resultLow.status === 'infeasible') return [];
    let rangeMin = resultLow.final_stats!.recoil_vertical;
    let rangeMax = resultHigh.status !== 'infeasible' ? resultHigh.final_stats!.recoil_vertical : nakedRecoilV;

    if (maxRecoilV != null) rangeMax = Math.min(rangeMax, maxRecoilV);
    if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
    const stepSize = steps > 1 ? (rangeMax - rangeMin) / (steps - 1) : 0;

    for (let i = 0; i < steps; i++) {
      const target = rangeMin + i * stepSize;
      const result = await runSolve(PRICE_WEIGHTS, { minErgonomics: minErgonomics, maxRecoilV: target });
      addPoint(result);
    }
  }

  // Deduplicate
  const pointsMap = new Map<string, ExplorePoint>();

  if (ignore === 'price') {
    for (const p of frontier) {
      const key = `${p.ergo},${p.recoil_v}`;
      const existing = pointsMap.get(key);
      if (!existing || p.price < existing.price) pointsMap.set(key, p);
    }
  } else if (ignore === 'recoil') {
    for (const p of frontier) {
      const key = `${p.ergo},${p.price}`;
      const existing = pointsMap.get(key);
      if (!existing || p.recoil_v < existing.recoil_v) pointsMap.set(key, p);
    }
  } else if (ignore === 'ergo') {
    for (const p of frontier) {
      const key = `${p.recoil_v},${p.price}`;
      const existing = pointsMap.get(key);
      if (!existing || p.ergo > existing.ergo) pointsMap.set(key, p);
    }
  }

  const deduplicated = [...pointsMap.values()];

  // Pareto filter
  function isDominated(p: ExplorePoint, others: ExplorePoint[]): boolean {
    for (const q of others) {
      if (q === p) continue;
      if (ignore === 'price') {
        if (q.ergo >= p.ergo && q.recoil_v <= p.recoil_v && (q.ergo > p.ergo || q.recoil_v < p.recoil_v)) return true;
      } else if (ignore === 'recoil') {
        if (q.ergo >= p.ergo && q.price <= p.price && (q.ergo > p.ergo || q.price < p.price)) return true;
      } else if (ignore === 'ergo') {
        if (q.recoil_v <= p.recoil_v && q.price <= p.price && (q.recoil_v < p.recoil_v || q.price < p.price)) return true;
      }
    }
    return false;
  }

  const paretoFrontier = deduplicated.filter(p => !isDominated(p, deduplicated));

  // Sort by X-axis
  if (ignore === 'price' || ignore === 'recoil') {
    paretoFrontier.sort((a, b) => a.ergo - b.ergo);
  } else {
    paretoFrontier.sort((a, b) => a.recoil_v - b.recoil_v);
  }

  return paretoFrontier;
}
