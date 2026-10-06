/**
 * The Fast solve pipeline over the template-count model (Phase 2.4c, ADR 0013 sections 6 and 7; TED search Phase 2.6b).
 *
 *   getPhysicalBlueprint (memoized per lookup) -> prepareSubproblemDomain -> specializeFast (per weight node) -> native solve under the presolve policy
 *     -> decodeFast (a rooted occurrence tree from the counts) -> exact physical validation (`preparePhysicalValidator`) -> exact re-scoring
 *
 * Fast is an APPROXIMATE placement model and this module never says otherwise: a model optimum is an `approximate_optimal` witness, never a
 * physical certificate, and a model with no feasible point is `empty` with source `native` (the caller reports `incomplete` with the
 * approximate-model reason, never `infeasible`). What it does guarantee is the acceptance rule: a build is a result only after the exact
 * validator accepted it, and its statistics and score are the validator's recomputation, never the solver's column values.
 *
 * Every request runs through the one spatial search (`search.ts`), as in Precise. A request that reads no TED (no TrueErgo, no Prevent Overswing) has
 * a single root with no weight interval and an exact model, so the search is one native solve. A TED request starts from the active weight range split
 * at the 3 kg knee and refines nodes (`specializeFast` states the TED rows on a node) until every node is settled or a limit is reached:
 *   - a node is SETTLED when its model is exact and its native solve was Optimal, when it is proved empty, or when its approximate-model bound is within
 *     the tolerance of the incumbent (the incumbent being the best exactly scored build any node has produced);
 *   - the bound of a node is the native dual bound of the APPROXIMATE model (plain double rows, no proof frame): it orders and fathoms the search and
 *     decides when to split, it never becomes a physical upper bound. It is also only used when the solve ran with presolve off, the one setting whose
 *     dual bound HiGHS 1.15.1 can be trusted for (`nativeSolve.ts`);
 *   - the count model carries total weight exactly (weight = receiver + sum of n_t x weight_t) and, on an acyclic template graph, decodes every point
 *     to a physical build of the same installed multiset, so the weight of the decoded build is the weight of the model point and a node's rows state
 *     what the node means (docs/research/acyclic-fast-exactness.md section 9).
 *
 * A point the validator rejects, or that decodes to no rooted tree (cyclic graphs only), or that sits on a boundary the solver's tolerance admitted and
 * exact arithmetic does not, is cut out with an integer no-good over the model's own decision columns (`fastCut.ts`) and the node is solved again, within
 * the deadline. The cut removes exactly that point, so the first accepted point is the best of the points left. A point of an INEXACT node that is
 * rejected only for overswinging is no fault: the node's penalty line is a relaxation, so its optimum may overswing exactly; the node is refined at that
 * build's weight instead (as in Precise). When the rejections reach the limit, or the time runs out, with no accepted point the outcome is `incomplete`.
 *
 * Continuous slot edges first. Every node is solved first with the slot-edge counts e_s_c continuous (`FastModel.lpRelaxedEdges`, a relaxation):
 * once the template counts are integer, the slot assignment is a flow over the template graph, and on every pinned gun its optimum came out integral,
 * which then IS an optimum of the integer model. A fractional edge, a non-optimal stop or a point that must be cut falls back to the integer model of
 * the node (the loop above, unchanged). HiGHS then works with about a tenth of the integer columns on the largest weapons. The integrality of that flow
 * is measured, not proved: the fallback keeps every answer correct either way, and a certificate built on it needs the proof (Stage 4).
 *
 * Every result carries its `outcome` (ADR 0013 section 6, `outcome.ts`). Fast has no proof frame: its native bound is the bound of the
 * approximate model, not a qualified bound of the physical problem, so a Fast result NEVER carries a physical certificate beyond
 * `approximate_optimal`, its upper bound and gap are unknown (null on the wire), and its lower bound is the downward enclosure of the exact
 * score of the verified witness. A Fast TED search that finished with every node settled is an `optimum` of the approximate model with the
 * same `approximate_optimal` qualification; a stop with a witness is `feasible` with the factual reason.
 */

import type { NativeResult } from '../native';
import { guardOfContext } from '../requestGuard';
import { guardStop } from '../runtimeGuard';
import type { RuntimeGuard } from '../runtimeGuard';
import type { ObjectiveAxes } from '../trueErgo';
import type { SolveParams } from '../types';
import { computeActiveBounds } from './bounds';
import { columnValuesFromStructured } from './decode';
import type { ColumnValues } from './decode';
import { decodeFast } from './decodeFast';
import { prepareSubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import { integerNoGood } from './fastCut';
import type { IntegerNoGood } from './fastCut';
import { FAST_PRESOLVE, isLimitStatus, NATIVE_FEASIBILITY_TOLERANCE, nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from './nativeSolve';
import type { PresolveSetting, SolveFn } from './nativeSolve';
import { axesOfStats } from './objective';
import { classifyOptimize, isMoaDependent, observationsOfReason } from './outcome';
import type { OptimizeOutcome } from './outcome';
import { exactAxes, exactObjectiveScore, scoreEnclosure } from './proof';
import type { BoundEvidence } from './proof';
import { PUBLIC_REASONS, reasonOfNativeLimit } from './reasons';
import { runSpatialSearch } from './search';
import type { NodeEvaluation, SearchInterval, SearchNode } from './search';
import type { SpecializeRequest } from './specialize';
import { specializeFast } from './specializeFast';
import type { FastModel } from './specializeFast';
import { DEFAULT_MAX_SPATIAL_NODES, getPhysicalBlueprint, resolveTolerance, rootIntervals } from './solvePrecise';
import { preparePhysicalValidator } from './validate';
import type { PhysicalBuild, PhysicalBuildStats } from './validate';

/** Most points the validator (or the decoder) may reject in one node before the node fails. Each is cut out and the node re-solved. */
export const MAX_FAST_REJECTIONS = 64;

/** A build the independent validator accepted, with its exact statistics and score. */
export interface FastVerifiedBuild {
  build: PhysicalBuild;
  stats: PhysicalBuildStats;
  axes: ObjectiveAxes;
  /** The exact score in the objective frame (`scale` 1, `offset` 0) of the validator's statistics, rounded to nearest. */
  score: number;
  /** The largest double at most the exact score: the lower bound the response reports. */
  scoreLower: number;
}

export interface FastSummary {
  /** Native solves made (the first of every node and one per cut). */
  nativeSolves: number;
  /** Points a cut removed: decoded to no tree, or rejected by the validator. */
  rejectedPoints: number;
  /** Size of the model: columns, rows, candidate edges, whether the template graph is acyclic (the largest model of the search). */
  columns: number;
  rows: number;
  edges: number;
  acyclic: boolean;
  /** The presolve setting of the first solve of every round. */
  presolve: PresolveSetting;
  /** Solver-reported objective of the last native solve, `null` without one. */
  modelObjective: number | null;
  /** The absolute objective tolerance in force (the native MIP gap is at most a quarter of it). */
  tolerance: number;
  /** Outer spatial calls (weight nodes evaluated); 0 for a request that reads no TED (there is no spatial dimension). */
  nodes: number;
  /** The request reads TED, so the weight search ran. */
  spatial: boolean;
  /**
   * The composed upper bound of the APPROXIMATE model over every node the search left unsettled or settled by a bound, `null` when unknown. A diagnostic
   * for tests and measurement: it is never transported (a Fast result has no physical upper bound) and never read as a certificate.
   */
  modelBound: number | null;
  /** Node solves tried first with continuous slot-edge counts, and how many of them fell back to the integer model. */
  relaxedEdgeSolves: number;
  relaxedEdgeFallbacks: number;
  /** The model allowed at most one copy of each part (`allowRepeatedParts` was not true). */
  singleCopy: boolean;
}

export type FastResult =
  /** The model has no point: the domain, a constant row of the request, or native infeasibility. Fast emptiness is never a proof of infeasibility. */
  | { kind: 'empty'; source: 'domain' | 'request' | 'native'; detail: string; outcome: OptimizeOutcome; summary: FastSummary }
  /** A verified build. `optimal`: the search finished (the build is the best of the model's points that the validator accepts, within the tolerance). */
  | { kind: 'build'; best: FastVerifiedBuild; optimal: boolean; reason?: string; outcome: OptimizeOutcome; summary: FastSummary }
  /** No verified build and no emptiness. `reason` is the outcome's. */
  | { kind: 'incomplete'; reason: string; outcome: OptimizeOutcome; summary: FastSummary };

export interface FastContext {
  /**
   * The normalized request. `useTchebycheff` needs an `idealPoint`. TrueErgo and Prevent Overswing run the weight search over the count model.
   * `allowRepeatedParts` (default false) decides whether the model may install several copies of one part: without it every part is capped at one copy.
   */
  params: SolveParams;
  /**
   * The request epoch (ADR 0013 section 4D): one queue-inclusive deadline, the out-of-band cancel flag and the macrotask yield. Checked before
   * every stage (preparation, each weight node, each native re-solve after a rejected point) and after every yield. Preferred.
   */
  guard?: RuntimeGuard;
  /** Without a `guard`: absolute deadline on the `now` clock, milliseconds (no cancel source). One of `guard` and `deadline` is required. */
  deadline?: number;
  now?: () => number;
  /** Native solve, injectable for tests. */
  solve?: SolveFn;
  /** Presolve of the first solve of every round (default `FAST_PRESOLVE`). */
  presolve?: PresolveSetting;
  /** Override of {@link MAX_FAST_REJECTIONS} (the rejections one node may take), for tests. */
  maxRejections?: number;
  /**
   * 'relaxed-first' (default): every node is solved first with continuous slot-edge counts and falls back to the integer model when an edge comes out
   * fractional or the point is rejected (same answers, fewer integer columns for HiGHS). 'integer': the integer model only (tests, measurement).
   */
  edgeIntegrality?: 'relaxed-first' | 'integer';
}

/**
 * The bound a Fast solve reports for its node: the native MIP dual bound of the approximate model, marked usable only when the solve ran with presolve
 * off. `qualified` here is NOT the proof qualification of Precise (no readback, no allowance, no frame error: the Fast rows are plain doubles); it says
 * only that the number may order and fathom the search. Nothing derived from it is a certificate (`classifyOptimize` fences every Fast result).
 */
function fastBoundEvidence(result: NativeResult): BoundEvidence {
  const dual = result.mipDualBound;
  const presolve = (result.effectiveOptions as Readonly<Record<string, unknown>> | undefined)?.presolve;
  return { nativeDual: dual !== null && Number.isFinite(dual) ? dual : null, qualified: presolve === 'off', frameError: 0 };
}

export async function solveFast(context: FastContext): Promise<FastResult> {
  const { params } = context;
  const guard = guardOfContext(context);
  const now = guard.now;
  const deadline = guard.deadline;
  const lookup = params.itemLookup;
  const presolve = context.presolve ?? FAST_PRESOLVE;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const tedRequest = params.useTrueErgo === true || params.preventOverswing === true;
  /** Owner decision 2c: one copy of each part unless the request allows repeats. The cap is a model restriction, so it never changes what a Fast result claims. */
  const singleCopy = params.allowRepeatedParts !== true;
  const request: SpecializeRequest = { ...params, singleCopy };
  const summary: FastSummary = {
    nativeSolves: 0, rejectedPoints: 0, columns: 0, rows: 0, edges: 0, acyclic: true, presolve, modelObjective: null, tolerance, nodes: 0, spatial: tedRequest, modelBound: null,
    relaxedEdgeSolves: 0, relaxedEdgeFallbacks: 0, singleCopy,
  };
  const moaDependent = isMoaDependent(params);
  /** A completed model search with no point: a Fast emptiness is never a physical proof (the classifier fences it). */
  const empty = (source: 'domain' | 'request' | 'native', detail: string): FastResult => ({
    kind: 'empty', source, detail, outcome: classifyOptimize({ mode: 'fast', moaDependent, end: 'empty', witness: false, searchFinished: true }), summary,
  });

  // Stage guard: nothing is prepared for a request that was already cancelled or out of time.
  const preStop = guardStop(guard);
  if (preStop !== null) {
    const outcome = classifyOptimize({ mode: 'fast', moaDependent, end: 'unproved', witness: false, searchFinished: false, observed: preStop === 'cancelled' ? { cancelled: true } : { deadline: true } });
    return { kind: 'incomplete', reason: outcome.reason as string, outcome, summary };
  }

  const blueprint = getPhysicalBlueprint(lookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, lookup, params);
  if (domain.empty) {
    const detail = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`)).join('; ');
    return empty('domain', detail);
  }

  /** The model of one node; a request with no TED has one model, built once (a constant contradiction of the request is read from it before the search). */
  let rootModel: FastModel | null = null;
  const modelOf = (interval: SearchInterval | null): FastModel => {
    if (interval === null) return (rootModel ??= specializeFast(blueprint, domain, request));
    return specializeFast(blueprint, domain, request, { weightMin: interval.lo, weightMax: interval.hi });
  };
  const measure = (model: FastModel): void => {
    summary.columns = Math.max(summary.columns, model.stats.columns);
    summary.rows = Math.max(summary.rows, model.stats.rows);
    summary.edges = Math.max(summary.edges, model.edges.length);
    summary.acyclic = model.graph.acyclic;
  };
  let requestReasons: readonly string[] | null = null;
  if (!tedRequest) {
    const model = modelOf(null);
    measure(model);
    if (model.provedEmpty !== null) return empty('request', model.provedEmpty.reasons.join('; '));
  }

  const validator = preparePhysicalValidator(lookup, params, {
    isAmmo: params.physicalOptions?.isAmmo,
    categoryChainOf: params.physicalOptions?.categoryChainOf,
    requirePathInstanceIds: true,
  });
  const useTrueErgo = params.useTrueErgo === true;
  const options = nativeSolveOptions(tolerance);
  const maxRejections = context.maxRejections ?? MAX_FAST_REJECTIONS;
  const relaxEdges = context.edgeIntegrality !== 'integer';

  /**
   * Judge one native answer of a node: decode it, validate the build exactly and score it. Returns the node's evaluation, or `reject` when the point
   * must be cut out and the node solved again (a decoded build the validator refused, or a count point that is no rooted tree).
   */
  type Judged = { evaluation: NodeEvaluation<FastVerifiedBuild> } | { reject: { values: ColumnValues; evidence: BoundEvidence; finished: boolean } };
  const judge = (model: FastModel, result: NativeResult): Judged => {
    const status = result.modelStatus.name;
    const optimal = status === 'Optimal';
    summary.modelObjective = result.objectiveValue;
    const evidence = fastBoundEvidence(result);
    const stopReason = isLimitStatus(status) ? reasonOfNativeLimit(status) : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
    // A solve that ran to Optimal finished the search of an EXACT node whatever is then missing or rejected; an inexact node still needs refining and
    // a limit stop has not finished.
    const finished = optimal && model.exact;
    if (result.colValues === null) {
      return { evaluation: { verdict: 'unresolved', evidence, candidate: null, exact: model.exact, reason: stopReason, finished } };
    }
    const values = columnValuesFromStructured(result.colNames, result.colValues);

    // A decision column that cannot be read as an integer is a solver fault: there is nothing to cut the point out by.
    let decoded: ReturnType<typeof decodeFast>;
    try {
      decoded = decodeFast(model, values);
    } catch (error) {
      if (error instanceof PhysicalModelError && error.code === 'DECODE_FAILED') {
        return { evaluation: { verdict: 'failed', evidence, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished } };
      }
      throw error;
    }
    if (decoded.ok) {
      const validation = validator.validate(decoded.build);
      const stats = validation.stats;
      if (validation.ok && stats !== null) {
        const axes = axesOfStats(stats, useTrueErgo);
        const exactScore = exactObjectiveScore(model.objective.weights, model.objective.tchebycheff?.ideal ?? null, exactAxes(stats.exact, useTrueErgo));
        const enclosure = scoreEnclosure(exactScore);
        const best: FastVerifiedBuild = { build: decoded.build, stats, axes, score: enclosure.nominal, scoreLower: enclosure.lower };
        const candidate = { score: enclosure.nominal, scoreLower: enclosure.lower, scoreUpper: enclosure.upper, scoreExact: enclosure.exact, payload: best };
        // A native limit stop with a verified build: a witness, searched no further (the model search of the node is unfinished).
        if (optimal) return { evaluation: { verdict: 'solved', evidence, candidate, exact: model.exact, splitAt: stats.weight } };
        return { evaluation: { verdict: 'unresolved', evidence, candidate, exact: model.exact, reason: stopReason, finished } };
      }
      // The penalty line of an inexact node is a lower envelope of q, so its optimum may be overswinging exactly: the relaxation is a valid bound, the
      // build is not a candidate, and the node is refined at the weight of that build.
      const relaxationOnly = !model.exact && stats !== null && validation.violations.length > 0 && validation.violations.every(v => v.code === 'OVERSWING_PREVENTED');
      if (relaxationOnly && stats !== null) {
        if (optimal) return { evaluation: { verdict: 'solved', evidence, candidate: null, exact: false, splitAt: stats.weight } };
        return { evaluation: { verdict: 'unresolved', evidence, candidate: null, exact: false, reason: stopReason } };
      }
    }
    return { reject: { values, evidence, finished } };
  };

  /**
   * First try of a node with continuous slot-edge counts (`FastModel.lpRelaxedEdges`), a relaxation of the node's model. When its optimum has every
   * edge integral, that point is feasible for the integer model and therefore optimal for it (the relaxation's optimum is at least the integer
   * optimum), so the answer is judged exactly as an integer answer; its dual bound is still a valid bound of the node. Anything else (a fractional
   * edge, a non-optimal stop) returns `null` and the caller solves the integer model as before; a point that must be cut returns `rejected` (the
   * caller solves the integer model too, but the observed rejection outranks a coincident interrupt, ADR 0013 section 6). Only the deadline is final.
   */
  type RelaxedTry = NodeEvaluation<FastVerifiedBuild> | { rejected: BoundEvidence } | null;
  const tryRelaxedEdges = async (model: FastModel): Promise<RelaxedTry> => {
    if (model.edges.length === 0) return null;
    const outcome = await solveWithPresolvePolicy(model.lpRelaxedEdges(), { options, deadline, now, solve: context.solve ?? nativeSolve, presolve });
    summary.nativeSolves++;
    summary.relaxedEdgeSolves++;
    if (outcome.kind === 'unresolved') {
      if (outcome.cause === 'deadline') return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.timeLimitReached };
      summary.relaxedEdgeFallbacks++;
      return null;
    }
    // The relaxation has no point, so the integer model has none either.
    if (outcome.kind === 'infeasible') return { verdict: 'infeasible', evidence: null, candidate: null, exact: model.exact };
    const result = outcome.result;
    const fractional = result.modelStatus.name !== 'Optimal' || result.colValues === null || result.colNames === null
      || model.edges.some(edge => {
        const j = result.colIndexByName.get(edge.column);
        const v = j === undefined ? Number.NaN : (result.colValues as Float64Array)[j];
        return !(Math.abs(v - Math.round(v)) <= NATIVE_FEASIBILITY_TOLERANCE);
      });
    if (fractional) {
      summary.relaxedEdgeFallbacks++;
      return null;
    }
    const judged = judge(model, result);
    if ('evaluation' in judged) return judged.evaluation;
    summary.relaxedEdgeFallbacks++;
    return { rejected: judged.reject.evidence };
  };

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<FastVerifiedBuild>> => {
    const model = modelOf(node.interval);
    measure(model);
    if (model.provedEmpty !== null) {
      requestReasons ??= model.provedEmpty.reasons;
      return { verdict: 'infeasible', evidence: null, candidate: null, exact: true };
    }
    if (relaxEdges) {
      const relaxed = await tryRelaxedEdges(model);
      if (relaxed !== null && !('rejected' in relaxed)) return relaxed;
      // The integer re-solve is a stage of its own: yield so a cancel message is dispatched, then guard. A rejected point seen by the relaxed solve is
      // an observed validation failure, which outranks the coincident interrupt (section 6); the integer model was never solved (unfinished).
      await guard.yieldMacrotask();
      const stop = guardStop(guard);
      if (stop !== null) {
        if (relaxed !== null) return { verdict: 'failed', evidence: relaxed.rejected, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished: false };
        return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached };
      }
    }
    const cuts: IntegerNoGood[] = [];
    let rejections = 0;
    for (;;) {
      if (cuts.length > 0) {
        // A re-solve after a rejected point is a stage of its own: yield so a cancel message is dispatched, then guard.
        await guard.yieldMacrotask();
        const stop = guardStop(guard);
        if (stop !== null) {
          return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached };
        }
      }
      const outcome = await solveWithPresolvePolicy(model.lp(cuts), { options, deadline, now, solve: context.solve ?? nativeSolve, presolve });
      summary.nativeSolves++;
      if (outcome.kind === 'unresolved') {
        return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: outcome.cause === 'deadline' ? PUBLIC_REASONS.timeLimitReached : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
      }
      if (outcome.kind === 'infeasible') return { verdict: 'infeasible', evidence: null, candidate: null, exact: model.exact };
      const judged = judge(model, outcome.result);
      if ('evaluation' in judged) return judged.evaluation;
      const { values, evidence, finished } = judged.reject;
      // Any other rejection is a validation failure (it outranks a coincident clock stop): the rejected point is cut out and the node solved again, so
      // the valid builds beside it are still found; the node fails when the rejections reach the limit, or the time runs out.
      const deadlineHit = deadline - now() <= 0;
      const cut = rejections >= maxRejections || deadlineHit ? null : integerNoGood(`nogood_${cuts.length}`, model.decision, values);
      // A point with no cut (a value outside its column's domain) cannot be excluded, and solving again would return it.
      if (cut === null) {
        return { verdict: 'failed', evidence, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished: finished && !deadlineHit };
      }
      cuts.push(cut);
      rejections++;
      summary.rejectedPoints++;
    }
  };

  let roots: (SearchInterval | null)[] = [null];
  if (tedRequest) {
    const weight = computeActiveBounds(blueprint, domain).weight;
    roots = rootIntervals(weight.lo, weight.hi, params.maxWeight);
  }
  const maxNodes = tedRequest ? Math.max(0, Math.floor(params.maxSpatialNodes ?? DEFAULT_MAX_SPATIAL_NODES)) : Number.POSITIVE_INFINITY;
  const search = await runSpatialSearch<FastVerifiedBuild>({ roots, evaluate, tolerance, maxNodes, now, deadline, guard });
  summary.nodes = tedRequest ? search.nodes : 0;
  summary.modelBound = Number.isFinite(search.upperBound) ? search.upperBound : null;

  const facts = { mode: 'fast', moaDependent, witness: search.incumbent !== null, searchFinished: search.finished, observed: observationsOfReason(search.stopReason) } as const;
  if (search.incumbent !== null) {
    // `completed`: every node was settled (exact and solved to the native gap, proved empty, or bounded within the tolerance of this very incumbent).
    const optimal = search.completed;
    const outcome = classifyOptimize({ ...facts, end: optimal ? 'optimum' : 'unproved' });
    return { kind: 'build', best: search.incumbent.payload, optimal, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }), outcome, summary };
  }
  if (search.empty) {
    if (summary.nativeSolves === 0) return empty('request', requestReasons === null ? 'every weight node is infeasible' : (requestReasons as readonly string[]).join('; '));
    return empty('native', tedRequest ? 'every weight node of the approximate model is infeasible' : 'the approximate model has no feasible point');
  }
  const outcome = classifyOptimize({ ...facts, end: 'unproved' });
  return { kind: 'incomplete', reason: outcome.reason as string, outcome, summary };
}
