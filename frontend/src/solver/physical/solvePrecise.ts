/**
 * The Precise solve pipeline over the exact physical model (ADR 0013 sections 4A to 4C, Phase 2.4b-3b).
 *
 *   preparePhysicalWeapon (memoized per lookup object and weapon id)
 *     -> prepareSubproblemDomain -> specializeLP (per spatial node) -> native solve under the presolve policy
 *     -> decodeSolution -> independent validation (`preparePhysicalValidator`) -> exact re-scoring
 *
 * A build is a candidate only after the validator accepts it, so nothing that fails validation is ever published, and the incumbent's
 * statistics and score are the validator's exact recomputation, never the solver's column values.
 *
 * Every request runs through the one spatial search (`search.ts`). A request that reads no TED (no TrueErgo, no Prevent Overswing) has a
 * single root with no weight interval and an exact model, so the search is one native solve. A TED request starts from the active weight
 * range split at the 3 kg knee and refines nodes until the gap is within the requested tolerance or a limit is reached.
 *
 * The models are solved with presolve off (`PRECISE_PRESOLVE`); infeasibility is never taken from a presolved solve alone (`nativeSolve.ts`). A model whose proof inputs are not trustworthy (a
 * coefficient at risk of being filtered on read, or a read that HiGHS adjusted) still yields verified builds but proves nothing: its bounds
 * are withheld and its infeasibility verdicts are unresolved.
 */

import { MODEL_STATUS_TEXT } from '../native';
import type { NativeResult } from '../native';
import { objectiveModel, objectiveScore } from '../trueErgo';
import type { ObjectiveAxes } from '../trueErgo';
import type { ItemLookup, PhysicalClassifiers, SolveParams } from '../types';
import { preparePhysicalWeapon } from './blueprint';
import type { PhysicalBlueprint } from './blueprint';
import { computeActiveBounds } from './bounds';
import { columnValuesFromStructured, decodeSolution } from './decode';
import type { DecodedBuild } from './decode';
import { prepareSubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import { nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from './nativeSolve';
import { insertRows, noGoodRow } from './nogood';
import type { PresolveSetting, SolveFn } from './nativeSolve';
import { axesOfStats } from './objective';
import { PUBLIC_REASONS } from './reasons';
import { runSpatialSearch } from './search';
import type { NodeEvaluation, SearchInterval, SearchNode } from './search';
import { specializeLP } from './specialize';
import { preparePhysicalValidator, physicalBuildFromDecoded } from './validate';
import type { PhysicalBuild, PhysicalBuildStats } from './validate';
import { TED_FREE_WEIGHT_KG } from './spatial';

// ---------------------------------------------------------------------------------------------
// Blueprint memo
// ---------------------------------------------------------------------------------------------

interface MemoEntry {
  blueprint: PhysicalBlueprint;
  classifiers: PhysicalClassifiers | undefined;
  /** Identities of the weapon entry's parts a mutation would replace: a changed identity re-prepares the blueprint. */
  slots: unknown;
  presets: unknown;
  stats: unknown;
}

const blueprintMemo = new WeakMap<object, Map<string, MemoEntry>>();

const sameClassifiers = (a: PhysicalClassifiers | undefined, b: PhysicalClassifiers | undefined): boolean =>
  a?.isAmmo === b?.isAmmo && a?.categoryChainOf === b?.categoryChainOf;

/**
 * The blueprint of a weapon, prepared once per lookup object, weapon id and classifier pair (Phase 2.7 moves caching to the worker).
 * The lookup is treated as immutable data, as production builds it; replacing the weapon's slot list, preset list or stats object is
 * noticed and re-prepares, an in-place edit of a leaf value is not.
 */
export function getPhysicalBlueprint(lookup: ItemLookup, weaponId: string, classifiers?: PhysicalClassifiers): PhysicalBlueprint {
  let byWeapon = blueprintMemo.get(lookup);
  if (!byWeapon) {
    byWeapon = new Map();
    blueprintMemo.set(lookup, byWeapon);
  }
  const weapon = Object.hasOwn(lookup, weaponId) ? lookup[weaponId] : undefined;
  const cached = byWeapon.get(weaponId);
  if (
    cached && sameClassifiers(cached.classifiers, classifiers) && weapon
    && cached.slots === weapon.slots && cached.stats === weapon.stats
    && cached.presets === (weapon.type === 'gun' ? weapon.all_presets : undefined)
  ) return cached.blueprint;
  const blueprint = preparePhysicalWeapon(lookup, weaponId, { isAmmo: classifiers?.isAmmo, categoryChainOf: classifiers?.categoryChainOf });
  byWeapon.set(weaponId, {
    blueprint,
    classifiers,
    slots: weapon?.slots,
    stats: weapon?.stats,
    presets: weapon?.type === 'gun' ? weapon.all_presets : undefined,
  });
  return blueprint;
}

// ---------------------------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------------------------

/** A build the independent validator accepted, with its exact statistics and score. */
export interface VerifiedBuild {
  decoded: DecodedBuild;
  build: PhysicalBuild;
  stats: PhysicalBuildStats;
  axes: ObjectiveAxes;
  /** Exact score in the objective frame (`scale` 1, `offset` 0), evaluated from the validator's statistics. */
  score: number;
}

export interface SearchTelemetry {
  /** Native solves made (each spatial node is one; a presolve-off confirmation is not counted separately). */
  nativeSolves: number;
  /** Solves whose presolve-on verdict was Infeasible and whose presolve-off confirmation found a solution. */
  presolveRescues: number;
  /** Infeasibility verdicts accepted, each decided by a presolve-off solve (a whole model or a spatial node). */
  confirmedInfeasible: number;
  /** Nodes proved empty without a native call (a contradiction row of the model text). */
  provedEmptyNodes: number;
  /** Solver solutions the validator rejected and a no-good cut removed (see `nogood.ts`). */
  rejectedCandidates: number;
}

export interface PreciseSummary {
  /** Outer spatial calls, never native MIP nodes. */
  nodes: number;
  /** Exact score of the incumbent, `null` without one. */
  lowerBound: number | null;
  /** Composed upper bound; `Infinity` when some live node has no proved bound. */
  upperBound: number;
  gap: number | null;
  tolerance: number;
  /** The executed search finished. Search completion only, never proof authority. */
  completed: boolean;
  /** The request reads TED, so the weight search ran (optimization metadata applies). */
  spatial: boolean;
  telemetry: SearchTelemetry;
}

export type PreciseResult =
  /** The request has no build. `source`: the domain, a constant row of the request, or confirmed native infeasibility. */
  | { kind: 'empty'; source: 'domain' | 'request' | 'native'; detail: string; summary: PreciseSummary }
  /** A verified build. `certified`: the search completed with a gap within the tolerance. */
  | { kind: 'build'; best: VerifiedBuild; certified: boolean; reason?: string; summary: PreciseSummary }
  /** No verified build and no proof of emptiness. */
  | { kind: 'incomplete'; reason: string; summary: PreciseSummary };

export interface PreciseContext {
  /** The normalized request. `useTchebycheff` needs an `idealPoint`. */
  params: SolveParams;
  /** Absolute deadline on the `now` clock, milliseconds. */
  deadline: number;
  now?: () => number;
  /** Native solve, injectable for tests. */
  solve?: SolveFn;
  /** Presolve of the first solve of every node (default `PRECISE_PRESOLVE`); tests set 'choose' to exercise the confirmation path. */
  presolve?: PresolveSetting;
}

// ---------------------------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------------------------

export const DEFAULT_OBJECTIVE_TOLERANCE = 1e-5;
/** Most solver solutions of one node the validator may reject (each is cut out and the node re-solved) before the node fails. */
export const MAX_REJECTIONS_PER_NODE = 16;
export const DEFAULT_MAX_SPATIAL_NODES = 512;

/** The tolerance as requested; only a missing, non-finite or negative value falls back to the default. */
export function resolveTolerance(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested) && requested >= 0 ? requested : DEFAULT_OBJECTIVE_TOLERANCE;
}

const limitReason = (status: string): string => {
  if (status === 'TimeLimit') return PUBLIC_REASONS.timeLimitReached;
  if (status === 'SolutionLimit') return PUBLIC_REASONS.nativeSolutionLimitReached;
  return (MODEL_STATUS_TEXT as Record<string, string>)[status] ?? status;
};

/** The node model's own upper bound: HiGHS's dual bound, or (an optimal solve without one) the objective plus the native gap in force. */
function provedUpperBound(result: NativeResult): number | null {
  const dual = result.mipDualBound;
  if (dual !== null && Number.isFinite(dual)) return dual;
  if (result.modelStatus.name === 'Optimal' && result.objectiveValue !== null && Number.isFinite(result.objectiveValue)) {
    const gap = result.effectiveOptions.mip_abs_gap;
    return result.objectiveValue + (typeof gap === 'number' ? gap : 0);
  }
  return null;
}

/** Root intervals: the active weight range clipped by the weight cap, split at the 3 kg knee where the penalty changes shape. */
function rootIntervals(lo: number, hi: number, maxWeight: number | null | undefined): SearchInterval[] {
  let top = hi;
  if (maxWeight != null && maxWeight >= lo) top = Math.min(hi, maxWeight);
  return lo < TED_FREE_WEIGHT_KG && top > TED_FREE_WEIGHT_KG
    ? [{ lo, hi: TED_FREE_WEIGHT_KG }, { lo: TED_FREE_WEIGHT_KG, hi: top }]
    : [{ lo, hi: top }];
}

export async function solvePrecise(context: PreciseContext): Promise<PreciseResult> {
  const { params } = context;
  const now = context.now ?? ((): number => performance.now());
  const lookup = params.itemLookup;
  const tedRequest = params.useTrueErgo === true || params.preventOverswing === true;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const telemetry: SearchTelemetry = { nativeSolves: 0, presolveRescues: 0, confirmedInfeasible: 0, provedEmptyNodes: 0, rejectedCandidates: 0 };
  const summary = (partial: Partial<PreciseSummary> & Pick<PreciseSummary, 'nodes'>): PreciseSummary => ({
    lowerBound: null, upperBound: Infinity, gap: null, tolerance, completed: false, spatial: tedRequest, telemetry, ...partial,
  });

  const blueprint = getPhysicalBlueprint(lookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, lookup, params);
  if (domain.empty) {
    const detail = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`)).join('; ');
    return { kind: 'empty', source: 'domain', detail, summary: summary({ nodes: 0, upperBound: -Infinity, completed: true }) };
  }

  const validator = preparePhysicalValidator(lookup, params, {
    isAmmo: params.physicalOptions?.isAmmo,
    categoryChainOf: params.physicalOptions?.categoryChainOf,
    requirePathInstanceIds: true,
  });
  const objective = objectiveModel(params);
  const useTrueErgo = params.useTrueErgo === true;
  const nativeOptions = nativeSolveOptions(tolerance);

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<VerifiedBuild>> => {
    const spatialNode = node.interval === null ? undefined : { weightMin: node.interval.lo, weightMax: node.interval.hi };
    const model = specializeLP(blueprint, domain, params, spatialNode);
    if (model.provedEmpty !== null) {
      telemetry.provedEmptyNodes++;
      return { verdict: 'infeasible', upperBound: null, candidate: null, exact: true };
    }
    telemetry.nativeSolves++;
    const decisionColumns = [...model.columns.activeOccurrences].map(v => model.columns.occurrence(v) as string);
    for (let b = 0; b < domain.bases.length; b++) decisionColumns.push(model.columns.base(b));
    const cuts: string[] = [];
    for (;;) {
      const lpText = insertRows(model.lp, cuts);
      const outcome = await solveWithPresolvePolicy(lpText, { options: nativeOptions, deadline: context.deadline, now, solve: context.solve ?? nativeSolve, presolve: context.presolve });
      if (outcome.kind === 'unresolved') {
        return {
          verdict: 'unresolved',
          upperBound: null,
          candidate: null,
          exact: model.exact,
          reason: outcome.cause === 'deadline' ? PUBLIC_REASONS.timeLimitReached : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable,
        };
      }
      if (outcome.kind === 'infeasible') {
        // A model whose text may not be the model HiGHS solved proves nothing, emptiness included.
        if (model.matrixFilterRisk || outcome.first.readStatus !== 'ok' || (outcome.confirmation !== null && outcome.confirmation.readStatus !== 'ok')) {
          return { verdict: 'unresolved', upperBound: null, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
        }
        telemetry.confirmedInfeasible++;
        return { verdict: 'infeasible', upperBound: null, candidate: null, exact: model.exact };
      }
      if (outcome.presolveRescue) telemetry.presolveRescues++;
      const result = outcome.result;
      const status = result.modelStatus.name;
      const trusted = !model.matrixFilterRisk && result.readStatus === 'ok';
      const proved = trusted ? provedUpperBound(result) : null;
      const optimal = status === 'Optimal';
      const stopReason = optimal ? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable : limitReason(status);

      if (result.colValues === null) {
        return { verdict: 'unresolved', upperBound: proved, candidate: null, exact: model.exact, reason: stopReason };
      }
      const values = columnValuesFromStructured(result.colNames, result.colValues);
      let decoded: DecodedBuild;
      try {
        decoded = decodeSolution(model, values);
      } catch (error) {
        if (error instanceof PhysicalModelError && error.code === 'DECODE_FAILED') {
          return { verdict: 'failed', upperBound: proved, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed };
        }
        throw error;
      }
      const build = physicalBuildFromDecoded(decoded);
      const validation = validator.validate(build);
      const stats = validation.stats;
      if (validation.ok && stats !== null) {
        const axes = axesOfStats(stats, useTrueErgo);
        const score = objectiveScore(objective, axes);
        const candidate = { score, payload: { decoded, build, stats, axes, score } };
        if (optimal && trusted) return { verdict: 'solved', upperBound: proved, candidate, exact: model.exact, splitAt: stats.weight };
        return { verdict: 'unresolved', upperBound: proved, candidate, exact: model.exact, reason: stopReason };
      }
      // The weight penalty of an inexact node is a lower envelope of q, so its optimum may be overswinging exactly: the relaxation is a valid
      // upper bound, the build is not a candidate, and the node is refined.
      const relaxationOnly = !model.exact && stats !== null && validation.violations.length > 0
        && validation.violations.every(v => v.code === 'OVERSWING_PREVENTED');
      if (relaxationOnly && stats !== null) {
        if (optimal && trusted) return { verdict: 'solved', upperBound: proved, candidate: null, exact: false, splitAt: stats.weight };
        return { verdict: 'unresolved', upperBound: proved, candidate: null, exact: false, reason: stopReason };
      }
      // Any other rejection is a boundary the solver's tolerance admitted and exact arithmetic does not (or a fault). The rejected assignment is
      // cut out and the node solved again, so the valid builds beside it are still found; only a repeated rejection fails the node.
      if (trusted && cuts.length < MAX_REJECTIONS_PER_NODE && context.deadline - now() > 0) {
        telemetry.rejectedCandidates++;
        cuts.push(noGoodRow(`nogood_${cuts.length}`, decisionColumns, values));
        continue;
      }
      return { verdict: 'failed', upperBound: proved, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed };
    }
  };

  let roots: (SearchInterval | null)[] = [null];
  if (tedRequest) {
    const weight = computeActiveBounds(blueprint, domain).weight;
    roots = rootIntervals(weight.lo, weight.hi, params.maxWeight);
  }
  const maxNodes = tedRequest ? Math.max(0, Math.floor(params.maxSpatialNodes ?? DEFAULT_MAX_SPATIAL_NODES)) : Number.POSITIVE_INFINITY;
  const search = await runSpatialSearch<VerifiedBuild>({ roots, evaluate, tolerance, maxNodes, now, deadline: context.deadline });
  const finished = summary({
    nodes: search.nodes,
    lowerBound: search.incumbent?.score ?? null,
    upperBound: search.upperBound,
    gap: search.gap,
    completed: search.completed,
  });

  if (search.incumbent !== null) {
    const reason = search.certified ? undefined : search.stopReason ?? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
    return { kind: 'build', best: search.incumbent.payload, certified: search.certified, ...(reason === undefined ? {} : { reason }), summary: finished };
  }
  if (search.empty) {
    const source = telemetry.nativeSolves > 0 ? 'native' : 'request';
    return { kind: 'empty', source, detail: 'every spatial node is infeasible', summary: finished };
  }
  return { kind: 'incomplete', reason: search.stopReason ?? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, summary: finished };
}
