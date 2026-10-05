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
 * The models are solved with presolve off (`PRECISE_PRESOLVE`); no claim is taken from a presolved solve (`nativeSolve.ts`).
 *
 * The proof frame (Phase 2.5, `proof.ts`, `nativeProof.ts`, `search.ts`). EVERY native solve is verified against its text: the parsed model must equal the
 * emitted one (a filtered coefficient is a difference), the parsed padded right-hand sides must dominate their exact needs, the native tolerances must
 * be the declared ones and presolve must be off. A qualified solve proves `UB = dual bound + the model's proved frame error` (exact rationals); an
 * unqualified one still yields verified builds (published as witnesses) but proves nothing: its bound is unknown (null on the wire) and an
 * infeasibility verdict from it is unresolved (`Required proof prerequisite unavailable`), never emptiness. The incumbent is scored as the exact rational
 * of the validator's statistics: its downward enclosure is the lower bound, its exact score the incumbent's part of the upper bound, and the
 * certificate compares the exact upper bound with the exact score.
 *
 * Every result carries its `outcome` (ADR 0013 section 6, `outcome.ts`): the pipeline reports what the search established (an optimum, an
 * emptiness, or neither, whether a verified witness exists, whether the executed search finished, which stops it observed) and the pure
 * classifier chooses the status, certificate, qualifications, termination and reason.
 */

import type { HighsOptions, NativeResult } from '../native';
import { guardOfContext } from '../requestGuard';
import { guardStop } from '../runtimeGuard';
import type { RuntimeGuard } from '../runtimeGuard';
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
import { assessNativeResult, boundEvidenceOf } from './nativeProof';
import type { NativeAssessment } from './nativeProof';
import { insertRows, noGoodRow } from './nogood';
import type { PresolveSetting, SolveFn } from './nativeSolve';
import { axesOfStats } from './objective';
import { exactAxes, exactObjectiveScore, scoreEnclosure, upperBoundExact } from './proof';
import { ratCmp, ratSub, ratToNumber, type Rat } from './exact';
import { ratRoundUp } from './rational';
import { classifyOptimize, isMoaDependent, observationsOfReason } from './outcome';
import type { OptimizeOutcome } from './outcome';
import { PUBLIC_REASONS, reasonOfNativeLimit } from './reasons';
import { runSpatialSearch, transportedBounds } from './search';
import type { NodeEvaluation, SearchInterval, SearchNode } from './search';
import { specializeLP } from './specialize';
import type { SpecializedModel } from './specialize';
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
  /** Exact score in the objective frame (`scale` 1, `offset` 0), the exact rational of the validator's statistics rounded to nearest. */
  score: number;
  /** The largest double at most the exact score (the proof lower bound) and the smallest at least it (the incumbent's part of the upper bound). */
  scoreLower: number;
  scoreUpper: number;
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
  /** Solves whose parsed model was verified against the emitted text (`nativeProof.ts`): one per native solve, the confirmation included. */
  readbackChecks: number;
  /** Solves that failed a check and so proved nothing (no bound, no infeasibility verdict). */
  unqualifiedSolves: number;
  /** Time spent verifying parsed models, milliseconds (the cost of the every-solve policy). */
  readbackMs: number;
  /** The first few distinct reasons a solve was unqualified. */
  unqualifiedReasons: string[];
  /**
   * The largest amount by which a qualified solve's proved upper bound fell BELOW the exact score of its own verified build: the native
   * solver's floating-point noise (the pinned build exports no node duals, so no allowance can be proved for it). Zero when none was seen.
   */
  boundShortfall: number;
}

export interface PreciseSummary {
  /** Outer spatial calls, never native MIP nodes. */
  nodes: number;
  /** The downward enclosure of the incumbent's exact score, `null` without one. */
  lowerBound: number | null;
  /** Composed upper bound; `Infinity` when some live node has no proved bound. */
  upperBound: number;
  gap: number | null;
  /** The same bounds as they travel: an unknown or unproved value is `null`, never `Infinity` and never zero. */
  bounds: { lower: number | null; upper: number | null; gap: number | null };
  tolerance: number;
  /** The executed search finished. Search completion only, never proof authority (`SearchResult.finished`). */
  completed: boolean;
  /** The request reads TED, so the weight search ran (optimization metadata applies). */
  spatial: boolean;
  telemetry: SearchTelemetry;
}

export type PreciseResult =
  /** The request has no build. `source`: the domain, a constant row of the request, or confirmed native infeasibility. */
  | { kind: 'empty'; source: 'domain' | 'request' | 'native'; detail: string; outcome: OptimizeOutcome; summary: PreciseSummary }
  /** A verified build. `certified`: the search completed with a gap within the tolerance. `reason`: the outcome's, when it is not certified. */
  | { kind: 'build'; best: VerifiedBuild; certified: boolean; reason?: string; outcome: OptimizeOutcome; summary: PreciseSummary }
  /** No verified build and no proof of emptiness. `reason` is the outcome's. */
  | { kind: 'incomplete'; reason: string; outcome: OptimizeOutcome; summary: PreciseSummary };

export interface PreciseContext {
  /** The normalized request. `useTchebycheff` needs an `idealPoint`. */
  params: SolveParams;
  /**
   * The request epoch (ADR 0013 section 4D): one queue-inclusive deadline, the out-of-band cancel flag and the macrotask yield. Checked before
   * every stage (preparation, each spatial node, each native re-solve after a rejected candidate) and after every yield. Preferred.
   */
  guard?: RuntimeGuard;
  /** Without a `guard`: absolute deadline on the `now` clock, milliseconds (no cancel source). One of `guard` and `deadline` is required. */
  deadline?: number;
  now?: () => number;
  /** Native solve, injectable for tests. */
  solve?: SolveFn;
  /** Presolve of the first solve of every node (default `PRECISE_PRESOLVE`); tests set 'choose' to exercise the confirmation path. */
  presolve?: PresolveSetting;
  /**
   * Native stopping options of THIS call only, layered over `nativeSolveOptions`: a MOA floor query sets `mip_max_improving_sols: 1` to stop at the
   * first improving incumbent (ADR 0013 section 6, scoped to floor calls). Restricted to stopping options, so no caller can loosen a tolerance.
   */
  nativeStop?: Pick<HighsOptions, 'mip_max_improving_sols'>;
  /**
   * End the weight search at the first verified build (the first-witness policy of a MOA floor query): the result is a `build` that is not
   * certified, with the factual reason `Native solution limit reached`. Only a search with a node still live stops this way.
   */
  stopAtFirstWitness?: boolean;
}

// ---------------------------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------------------------

export const DEFAULT_OBJECTIVE_TOLERANCE = 1e-5;
/**
 * How far a qualified node's proved upper bound may fall below the exact score of a build verified in that node before the bound is judged
 * WRONG rather than noisy: the larger of the request tolerance and one part in 10^9 of the bound's magnitude (the observed solver noise is
 * about 1e-15 relative, the ledger worst case 5e-12 absolute). A sanity guard on the proof inputs, not an allowance: it never widens a bound.
 */
export const BOUND_SANITY_RELATIVE = 1e-9;
const boundShortfallLimit = (bound: Rat, tolerance: number): number => Math.max(tolerance, BOUND_SANITY_RELATIVE * Math.max(1, Math.abs(ratToNumber(bound))));
/** Most solver solutions of one node the validator may reject (each is cut out and the node re-solved) before the node fails. */
export const MAX_REJECTIONS_PER_NODE = 16;
export const DEFAULT_MAX_SPATIAL_NODES = 512;

/** The tolerance as requested; only a missing, non-finite or negative value falls back to the default. */
export function resolveTolerance(requested: number | undefined): number {
  return requested !== undefined && Number.isFinite(requested) && requested >= 0 ? requested : DEFAULT_OBJECTIVE_TOLERANCE;
}

/**
 * Root intervals: the active weight range clipped by the weight cap, split at the 3 kg knee where the penalty changes shape. Shared by the Precise
 * and the Fast spatial search, which run the same search over the same weight domain.
 */
export function rootIntervals(lo: number, hi: number, maxWeight: number | null | undefined): SearchInterval[] {
  let top = hi;
  if (maxWeight != null && maxWeight >= lo) top = Math.min(hi, maxWeight);
  return lo < TED_FREE_WEIGHT_KG && top > TED_FREE_WEIGHT_KG
    ? [{ lo, hi: TED_FREE_WEIGHT_KG }, { lo: TED_FREE_WEIGHT_KG, hi: top }]
    : [{ lo, hi: top }];
}

export async function solvePrecise(context: PreciseContext): Promise<PreciseResult> {
  const { params } = context;
  const guard = guardOfContext(context);
  const now = guard.now;
  const deadline = guard.deadline;
  const lookup = params.itemLookup;
  const tedRequest = params.useTrueErgo === true || params.preventOverswing === true;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const telemetry: SearchTelemetry = {
    nativeSolves: 0, presolveRescues: 0, confirmedInfeasible: 0, provedEmptyNodes: 0, rejectedCandidates: 0,
    readbackChecks: 0, unqualifiedSolves: 0, readbackMs: 0, unqualifiedReasons: [], boundShortfall: 0,
  };
  const moaDependent = isMoaDependent(params);
  const summary = (partial: Partial<PreciseSummary> & Pick<PreciseSummary, 'nodes'>): PreciseSummary => ({
    lowerBound: null, upperBound: Infinity, gap: null, bounds: { lower: null, upper: null, gap: null }, tolerance, completed: false, spatial: tedRequest, telemetry, ...partial,
  });

  // Stage guard: nothing is prepared for a request that was already cancelled or out of time.
  const preStop = guardStop(guard);
  if (preStop !== null) {
    const outcome = classifyOptimize({ mode: 'precise', moaDependent, end: 'unproved', witness: false, searchFinished: false, observed: preStop === 'cancelled' ? { cancelled: true } : { deadline: true } });
    return { kind: 'incomplete', reason: outcome.reason as string, outcome, summary: summary({ nodes: 0 }) };
  }

  const blueprint = getPhysicalBlueprint(lookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, lookup, params);
  if (domain.empty) {
    const detail = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`)).join('; ');
    const outcome = classifyOptimize({ mode: 'precise', moaDependent, end: 'empty', witness: false, searchFinished: true });
    return { kind: 'empty', source: 'domain', detail, outcome, summary: summary({ nodes: 0, upperBound: -Infinity, completed: true }) };
  }

  const validator = preparePhysicalValidator(lookup, params, {
    isAmmo: params.physicalOptions?.isAmmo,
    categoryChainOf: params.physicalOptions?.categoryChainOf,
    requirePathInstanceIds: true,
  });
  const useTrueErgo = params.useTrueErgo === true;

  /** Verify one solve against the text it solved and the proof record of its model; the first reasons are kept for the report. */
  const assess = (model: SpecializedModel, lpText: string, result: NativeResult): NativeAssessment => {
    const started = now();
    const assessment = assessNativeResult({ lpText, proof: model.proof }, result);
    telemetry.readbackMs += now() - started;
    telemetry.readbackChecks++;
    if (!assessment.qualified) {
      telemetry.unqualifiedSolves++;
      for (const reason of assessment.reasons) if (telemetry.unqualifiedReasons.length < 3 && !telemetry.unqualifiedReasons.includes(reason)) telemetry.unqualifiedReasons.push(reason);
    }
    return assessment;
  };

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<VerifiedBuild>> => {
    const spatialNode = node.interval === null ? undefined : { weightMin: node.interval.lo, weightMax: node.interval.hi };
    const model = specializeLP(blueprint, domain, params, spatialNode);
    if (model.provedEmpty !== null) {
      telemetry.provedEmptyNodes++;
      return { verdict: 'infeasible', evidence: null, candidate: null, exact: true };
    }
    const nativeOptions = { ...nativeSolveOptions(tolerance), ...context.nativeStop };
    telemetry.nativeSolves++;
    const decisionColumns = [...model.columns.activeOccurrences].map(v => model.columns.occurrence(v) as string);
    for (let b = 0; b < domain.bases.length; b++) decisionColumns.push(model.columns.base(b));
    const cuts: string[] = [];
    for (;;) {
      if (cuts.length > 0) {
        // A re-solve after a rejected candidate is a stage of its own: yield so a cancel message is dispatched, then guard.
        await guard.yieldMacrotask();
        const stop = guardStop(guard);
        if (stop !== null) {
          return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached };
        }
      }
      const lpText = insertRows(model.lp, cuts);
      const outcome = await solveWithPresolvePolicy(lpText, {
        options: nativeOptions, deadline, now, solve: context.solve ?? nativeSolve, presolve: context.presolve, includeReadback: true,
      });
      if (outcome.kind === 'unresolved') {
        return {
          verdict: 'unresolved',
          evidence: null,
          candidate: null,
          exact: model.exact,
          reason: outcome.cause === 'deadline' ? PUBLIC_REASONS.timeLimitReached : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable,
        };
      }
      if (outcome.kind === 'infeasible') {
        // An infeasibility verdict is evidence about the model HiGHS parsed: it counts only when the solve that DECIDES it (the presolve-off
        // solve: the first one, or the confirmation of a presolved first one) was verified against the text (readback equal, allowances
        // dominating, declared tolerances, presolve off), so a filtered coefficient can never prove emptiness.
        const deciding = outcome.confirmation ?? outcome.first;
        if (!assess(model, lpText, deciding).qualified) {
          // The native search finished (it said Infeasible); only the proof of it is withheld.
          return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished: true };
        }
        telemetry.confirmedInfeasible++;
        return { verdict: 'infeasible', evidence: null, candidate: null, exact: model.exact };
      }
      if (outcome.presolveRescue) telemetry.presolveRescues++;
      const result = outcome.result;
      const status = result.modelStatus.name;
      const assessment = assess(model, lpText, result);
      const trusted = assessment.qualified;
      // The bound of this solve: its dual bound, qualified or not (unqualified evidence proves nothing), plus the model's proved frame error.
      const evidence = boundEvidenceOf(model.proof, result, assessment);
      const optimal = status === 'Optimal';
      const stopReason = optimal ? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable : reasonOfNativeLimit(status);
      // An Optimal solve of an exact node is a finished search of it, whatever is then withheld (the bound, the build). An inexact node still
      // needs refining, and a limit stop has not finished.
      const finished = optimal && model.exact;

      if (result.colValues === null) {
        return { verdict: 'unresolved', evidence, candidate: null, exact: model.exact, reason: stopReason, finished };
      }
      const values = columnValuesFromStructured(result.colNames, result.colValues);
      let decoded: DecodedBuild;
      try {
        decoded = decodeSolution(model, values);
      } catch (error) {
        if (error instanceof PhysicalModelError && error.code === 'DECODE_FAILED') {
          return { verdict: 'failed', evidence, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished };
        }
        throw error;
      }
      const build = physicalBuildFromDecoded(decoded);
      const validation = validator.validate(build);
      const stats = validation.stats;
      if (validation.ok && stats !== null) {
        const axes = axesOfStats(stats, useTrueErgo);
        // The incumbent's score is the exact rational of the validator's statistics under the model's own resolved weights and payoff table,
        // enclosed on both sides: the lower end is the proof lower bound, the upper end the incumbent's part of the upper bound.
        const exactScore = exactObjectiveScore(model.objective.weights, model.objective.tchebycheff?.ideal ?? null, exactAxes(stats.exact, useTrueErgo));
        const enclosure = scoreEnclosure(exactScore);
        const candidate = {
          score: enclosure.nominal,
          scoreLower: enclosure.lower,
          scoreUpper: enclosure.upper,
          scoreExact: enclosure.exact,
          payload: { decoded, build, stats, axes, score: enclosure.nominal, scoreLower: enclosure.lower, scoreUpper: enclosure.upper },
        };
        // A build verified in THIS node cannot score above the node's proved upper bound. The shortfall (how far the bound falls below the
        // witness) is the native solver's own floating-point noise, which no proved allowance covers (the pinned build exports no node duals):
        // it is REPORTED (`boundShortfall`), not hidden. A shortfall beyond `boundShortfallLimit` is no noise but a proof input that is wrong
        // (the dual bound, the frame error, the padding): the bound is withheld rather than published next to a witness that contradicts it.
        const proved = upperBoundExact(evidence);
        if (trusted && proved !== null && ratCmp(enclosure.exact, proved) > 0) {
          const shortfall = ratRoundUp(ratSub(enclosure.exact, proved));
          telemetry.boundShortfall = Math.max(telemetry.boundShortfall, shortfall);
          if (shortfall > boundShortfallLimit(proved, tolerance)) {
            telemetry.unqualifiedSolves++;
            const reason = `a verified build of the node scores ${shortfall} above the node's proved upper bound`;
            if (telemetry.unqualifiedReasons.length < 3 && !telemetry.unqualifiedReasons.includes(reason)) telemetry.unqualifiedReasons.push(reason);
            return { verdict: 'unresolved', evidence: { ...evidence, qualified: false }, candidate, exact: model.exact, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished };
          }
        }
        if (optimal && trusted) return { verdict: 'solved', evidence, candidate, exact: model.exact, splitAt: stats.weight };
        return { verdict: 'unresolved', evidence, candidate, exact: model.exact, reason: stopReason, finished };
      }
      // The weight penalty of an inexact node is a lower envelope of q, so its optimum may be overswinging exactly: the relaxation is a valid
      // upper bound, the build is not a candidate, and the node is refined.
      const relaxationOnly = !model.exact && stats !== null && validation.violations.length > 0
        && validation.violations.every(v => v.code === 'OVERSWING_PREVENTED');
      if (relaxationOnly && stats !== null) {
        if (optimal && trusted) return { verdict: 'solved', evidence, candidate: null, exact: false, splitAt: stats.weight };
        return { verdict: 'unresolved', evidence, candidate: null, exact: false, reason: stopReason };
      }
      // Any other rejection is a boundary the solver's tolerance admitted and exact arithmetic does not (or a fault). The rejected assignment is
      // cut out and the node solved again, so the valid builds beside it are still found; only a repeated rejection fails the node.
      if (trusted && cuts.length < MAX_REJECTIONS_PER_NODE && deadline - now() > 0) {
        telemetry.rejectedCandidates++;
        cuts.push(noGoodRow(`nogood_${cuts.length}`, decisionColumns, values));
        continue;
      }
      return { verdict: 'failed', evidence, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished };
    }
  };

  let roots: (SearchInterval | null)[] = [null];
  if (tedRequest) {
    const weight = computeActiveBounds(blueprint, domain).weight;
    roots = rootIntervals(weight.lo, weight.hi, params.maxWeight);
  }
  const maxNodes = tedRequest ? Math.max(0, Math.floor(params.maxSpatialNodes ?? DEFAULT_MAX_SPATIAL_NODES)) : Number.POSITIVE_INFINITY;
  const search = await runSpatialSearch<VerifiedBuild>({ roots, evaluate, tolerance, maxNodes, now, deadline, guard, stopAtFirstWitness: context.stopAtFirstWitness });
  const finished = summary({
    nodes: search.nodes,
    lowerBound: search.lowerBound,
    upperBound: search.upperBound,
    gap: search.gap,
    bounds: transportedBounds(search),
    completed: search.finished,
  });

  const facts = { mode: 'precise', moaDependent, witness: search.incumbent !== null, searchFinished: search.finished, observed: observationsOfReason(search.stopReason) } as const;
  if (search.incumbent !== null) {
    const outcome = classifyOptimize({ ...facts, end: search.certified ? 'optimum' : 'unproved' });
    return { kind: 'build', best: search.incumbent.payload, certified: search.certified, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }), outcome, summary: finished };
  }
  if (search.empty) {
    const source = telemetry.nativeSolves > 0 ? 'native' : 'request';
    return { kind: 'empty', source, detail: 'every spatial node is infeasible', outcome: classifyOptimize({ ...facts, end: 'empty' }), summary: finished };
  }
  const outcome = classifyOptimize({ ...facts, end: 'unproved' });
  return { kind: 'incomplete', reason: outcome.reason as string, outcome, summary: finished };
}