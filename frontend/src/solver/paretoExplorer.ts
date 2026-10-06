import { computeStructuralBounds } from './structuralBounds.ts';
/**
 * Pareto frontier exploration: the sweep-target generation (Phase 2.7b, ADR 0013 section 6).
 * Ported from optimizer.py:explore_pareto(); the target generation is the pre-cutover one, now exposed as a recorded schedule.
 *
 * The sweep solves one objective axis at a time with the third axis ignored, and steps a constraint on the swept axis:
 *
 *   ignore    endpoint low      endpoint high     steps (a lower bound on / an upper bound on)
 *   price     min recoil        max ergonomics    minErgonomics = e   (ergonomics axis; minimize recoil)
 *   recoil    min price         max ergonomics    minErgonomics = e   (ergonomics axis; minimize price)
 *   ergo      min recoil        min price         maxRecoilV = r      (recoil axis; maximize ergonomics)
 *
 * The two endpoints are the first two scheduled targets. After both have returned, the range between their achieved values is divided into steps
 * of `max(1, range / max(steps, 10))` (recoil axis: `range / max(steps, 10)`), and each step target is generated from the achieved value of the
 * previous one (a step whose build already reaches beyond the next grid value moves the cursor there). That is `SweepSchedule.extend`; every
 * generated target is recorded in the response's `sweep_schedule` and classified exactly once by `runExplore` (`exploreSweep.ts`).
 *
 * A schedule is single-use (the generator keeps the cursor). `buildSweepSchedule` returns a schedule with NO targets for a request that cannot
 * be swept (an unknown weapon or axis, a non-finite `steps`); `runExplore` reports that as `invalid` with no points and no solve.
 */

import type { ItemLookup, CompatibilityMap, PrecisionRequest, SolveParams, TraderLevels } from './types.ts';
import type { ExploreAxis, ExploreRunRequest, SettledTarget, SweepSchedule, SweepTarget } from './exploreSweep.ts';

export interface ParetoParams {
  weaponId: string;
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  ignore: ExploreAxis;
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  maxMOA?: number | null;
  includeItems?: string[] | null;
  excludeItems?: string[] | null;
  includeCategories?: string[][] | null;
  excludeCategories?: string[] | null;
  useTrueErgo?: boolean;
  preventOverswing?: boolean;
  equipErgoModifier?: number | null;
  steps?: number;
  traderLevels?: TraderLevels | null;
  fleaAvailable?: boolean;
  barterAvailable?: boolean;
  barterExcludeDogtags?: boolean;
  playerLevel?: number | null;
  /** Stash multiset (validated by the operation layer), forwarded to every target's solve. */
  ownedItems?: readonly string[];
  preciseMode?: boolean;
  /** Fast only: allow several copies of one part (default false: one copy of each part). Forwarded to every target's solve. */
  allowRepeatedParts?: boolean;
  /** What the caller asked for, echoed on every point's `precision_request`. */
  precisionRequest?: PrecisionRequest;
  boundsMode?: 'structural' | 'naive';
  structuralBounds?: import('./structuralBounds.ts').StructuralBounds;
}

function buildBaseParams(p: ParetoParams): Omit<SolveParams, 'ergoWeight' | 'recoilWeight' | 'priceWeight'> {
  return {
    weaponId: p.weaponId,
    itemLookup: p.itemLookup,
    compatibilityMap: p.compatibilityMap,
    maxPrice: p.maxPrice,
    minErgonomics: p.minErgonomics,
    maxRecoilV: p.maxRecoilV,
    maxRecoilSum: p.maxRecoilSum,
    minMagCapacity: p.minMagCapacity,
    minSightingRange: p.minSightingRange,
    maxWeight: p.maxWeight,
    maxMOA: p.maxMOA,
    includeItems: p.includeItems,
    excludeItems: p.excludeItems,
    includeCategories: p.includeCategories,
    excludeCategories: p.excludeCategories,
    useTrueErgo: p.useTrueErgo ?? false,
    preventOverswing: p.preventOverswing ?? false,
    equipErgoModifier: p.equipErgoModifier,
    traderLevels: p.traderLevels,
    fleaAvailable: p.fleaAvailable ?? true,
    barterAvailable: p.barterAvailable ?? false,
    barterExcludeDogtags: p.barterExcludeDogtags ?? false,
    playerLevel: p.playerLevel,
    ...(p.ownedItems === undefined ? {} : { ownedItems: p.ownedItems }),
    preciseMode: p.preciseMode,
    ...(p.allowRepeatedParts === undefined ? {} : { allowRepeatedParts: p.allowRepeatedParts }),
    precisionRequest: p.precisionRequest,
    boundsMode: p.boundsMode,
    structuralBounds: p.structuralBounds,
  };
}

const gunOf = (params: ParetoParams) => {
  const weapon = Object.hasOwn(params.itemLookup, params.weaponId) ? params.itemLookup[params.weaponId] : undefined;
  return weapon !== undefined && weapon.type === 'gun' ? weapon : null;
};

/** The request of a sweep, as `runExplore` reads it: the shared Optimize request, the axis, the precision flags and the weapon's naked recoil. */
export function exploreRunRequest(params: ParetoParams): ExploreRunRequest {
  const weapon = gunOf(params);
  const base = buildBaseParams(params);
  if (weapon !== null && !base.structuralBounds && base.boundsMode !== 'naive') {
    base.structuralBounds = computeStructuralBounds(params.weaponId, params.itemLookup, params.compatibilityMap, { maxWeight: params.maxWeight });
  }
  return {
    ignore: params.ignore,
    base,
    precisionRequest: params.precisionRequest ?? (params.preciseMode ? 'precise' : 'fast'),
    ...(params.preciseMode === undefined ? {} : { preciseMode: params.preciseMode }),
    nakedRecoilV: weapon === null ? 0 : weapon.stats.naked_recoil_v,
  };
}

// Tiny tiebreaker on secondary weights prevents multi-slot over-constraint from blocking items (see lpBuilder.ts slot mutex). Must be small
// enough not to collapse the Pareto frontier.
const TB = 0.0001;
type Weights = SweepTarget['weights'];
const RECOIL_WEIGHTS: Weights = { ergoWeight: TB, recoilWeight: 1, priceWeight: TB };
const ERGO_WEIGHTS: Weights = { ergoWeight: 1, recoilWeight: TB, priceWeight: TB };
const PRICE_WEIGHTS: Weights = { ergoWeight: TB, recoilWeight: TB, priceWeight: 1 };

const isAxis = (ignore: unknown): ignore is ExploreAxis => ignore === 'price' || ignore === 'recoil' || ignore === 'ergo';

/** The statistics of a settled target that produced a witness, else `null`. */
const witnessStats = (settled: SettledTarget) => (settled.outcome === 'V' && settled.response?.final_stats ? settled.response.final_stats : null);

/**
 * The recorded schedule of a sweep: the two endpoint targets, and the step generator that extends it. Single-use.
 * Endpoint `target_value`s are the ends of the swept axis the endpoint solves for (ergonomics 0 or the user's minimum to 100, recoil 0 to the user's
 * maximum or the naked recoil); step `target_value`s are the constraint value passed to the solve.
 */
export function buildSweepSchedule(params: ParetoParams): SweepSchedule {
  const none: SweepSchedule = { targets: [] };
  const weapon = gunOf(params);
  if (weapon === null || !isAxis(params.ignore)) return none;
  const stepsRaw = params.steps ?? 10;
  if (typeof stepsRaw !== 'number' || !Number.isFinite(stepsRaw)) return none;
  const grid = Math.max(stepsRaw, 10);
  const { ignore, minErgonomics, maxRecoilV } = params;
  const nakedRecoilV = Number.isFinite(weapon.stats.naked_recoil_v) ? weapon.stats.naked_recoil_v : 0;

  const ergoAxis = ignore !== 'ergo';
  const low = ignore === 'price' ? RECOIL_WEIGHTS : ignore === 'recoil' ? PRICE_WEIGHTS : RECOIL_WEIGHTS;
  const high = ignore === 'ergo' ? PRICE_WEIGHTS : ERGO_WEIGHTS;
  const step: Weights = ignore === 'price' ? { ergoWeight: 0.01, recoilWeight: 1, priceWeight: TB }
    : ignore === 'recoil' ? { ergoWeight: 0.01, recoilWeight: TB, priceWeight: 1 }
      : { ergoWeight: TB, recoilWeight: 0.01, priceWeight: 1 };
  const stepOverrides = (value: number): Partial<SolveParams> => (ergoAxis ? { minErgonomics: value } : { minErgonomics, maxRecoilV: value });
  /** The swept-axis value a witness achieves. */
  const axisValue = (s: NonNullable<ReturnType<typeof witnessStats>>): number => (ergoAxis ? s.ergonomics : s.recoil_vertical);

  const targets: SweepTarget[] = [
    { target_index: 0, target_value: ergoAxis ? Math.max(0, minErgonomics ?? 0) : 0, weights: low, overrides: {} },
    { target_index: 1, target_value: ergoAxis ? 100 : (maxRecoilV ?? nakedRecoilV), weights: high, overrides: {} },
  ];

  let cursor = NaN;
  let rangeMax = NaN;
  let stepSize = NaN;
  let ready = false;
  const nextStep = (index: number): SweepTarget[] => {
    cursor += stepSize;
    if (!(cursor < rangeMax)) return [];
    return [{ target_index: index, target_value: cursor, weights: step, overrides: stepOverrides(cursor) }];
  };

  return {
    targets,
    extend(settled) {
      const n = settled.length;
      if (n === 1) return [];
      if (n === 2) {
        const lowStats = witnessStats(settled[0]);
        if (lowStats === null) return [];
        const highStats = witnessStats(settled[1]);
        let rangeMin: number;
        if (ergoAxis) {
          rangeMin = Math.floor(lowStats.ergonomics);
          rangeMax = highStats === null ? 100 : Math.ceil(highStats.ergonomics);
          if (minErgonomics != null) rangeMin = Math.max(rangeMin, minErgonomics);
          rangeMin = Math.max(0, rangeMin);
          rangeMax = Math.min(100, rangeMax);
          if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
          stepSize = Math.max(1, (rangeMax - rangeMin) / grid);
        } else {
          rangeMin = lowStats.recoil_vertical;
          rangeMax = highStats === null ? nakedRecoilV : highStats.recoil_vertical;
          if (maxRecoilV != null) rangeMax = Math.min(rangeMax, maxRecoilV);
          if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
          stepSize = (rangeMax - rangeMin) / grid;
        }
        if (![rangeMin, rangeMax, stepSize].every(Number.isFinite) || !(stepSize > 0)) return [];
        cursor = rangeMin;
        ready = true;
        return nextStep(n);
      }
      if (!ready) return [];
      const achieved = witnessStats(settled[n - 1]);
      if (achieved !== null) {
        const value = axisValue(achieved);
        if (value > cursor) cursor = value;
      }
      return nextStep(n);
    },
  };
}
