/**
 * The Fast solve pipeline over the template-count model (Phase 2.4c, ADR 0013 sections 6 and 7).
 *
 *   getPhysicalBlueprint (memoized per lookup) -> prepareSubproblemDomain -> specializeFast -> native solve under the presolve policy
 *     -> decodeFast (a rooted occurrence tree from the counts) -> exact physical validation (`preparePhysicalValidator`) -> exact re-scoring
 *
 * Fast is an APPROXIMATE placement model and this module never says otherwise: a model optimum is an `approximate_optimal` witness, never a
 * physical certificate, and a model with no feasible point is `empty` with source `native` (the caller reports `incomplete` with the
 * approximate-model reason, never `infeasible`). What it does guarantee is the acceptance rule: a build is a result only after the exact
 * validator accepted it, and its statistics and score are the validator's recomputation, never the solver's column values.
 *
 * A point the validator rejects, or that decodes to no rooted tree (cyclic graphs only), or that sits on a boundary the solver's tolerance
 * admitted and exact arithmetic does not, is cut out with an integer no-good over the model's own decision columns (`fastCut.ts`) and the model
 * is solved again, within the deadline. The cut removes exactly that point, so the first accepted point is the best of the points left.
 * When the rejections reach the limit, or the time runs out, with no accepted point the outcome is `incomplete`, never a guess.
 *
 * Every result carries its `outcome` (ADR 0013 section 6, `outcome.ts`). Fast has no proof frame: its native bound is the bound of the
 * approximate model, not a qualified bound of the physical problem, so a Fast result NEVER carries a physical certificate beyond
 * `approximate_optimal`, its upper bound and gap are unknown (null on the wire), and its lower bound is the downward enclosure of the exact
 * score of the verified witness.
 */

import type { ObjectiveAxes } from '../trueErgo';
import type { SolveParams } from '../types';
import { columnValuesFromStructured } from './decode';
import { decodeFast } from './decodeFast';
import { prepareSubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import { integerNoGood } from './fastCut';
import type { IntegerNoGood } from './fastCut';
import { FAST_PRESOLVE, isLimitStatus, nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from './nativeSolve';
import type { PresolveSetting, SolveFn } from './nativeSolve';
import { axesOfStats } from './objective';
import { classifyOptimize, isMoaDependent, observationsOfReason } from './outcome';
import type { OptimizeOutcome, StopObservations } from './outcome';
import { exactAxes, exactObjectiveScore, scoreEnclosure } from './proof';
import { PUBLIC_REASONS, reasonOfNativeLimit } from './reasons';
import { specializeFast } from './specializeFast';
import type { FastModel } from './specializeFast';
import { getPhysicalBlueprint, resolveTolerance } from './solvePrecise';
import { preparePhysicalValidator } from './validate';
import type { PhysicalBuild, PhysicalBuildStats } from './validate';

/** Most points the validator (or the decoder) may reject before the request fails. Each is cut out and the model re-solved. */
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
  /** Native solves made (the first and one per cut). */
  nativeSolves: number;
  /** Points a cut removed: decoded to no tree, or rejected by the validator. */
  rejectedPoints: number;
  /** Size of the model: columns, rows, candidate edges, whether the template graph is acyclic. */
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
}

export type FastResult =
  /** The model has no point: the domain, a constant row of the request, or native infeasibility. Fast emptiness is never a proof of infeasibility. */
  | { kind: 'empty'; source: 'domain' | 'request' | 'native'; detail: string; outcome: OptimizeOutcome; summary: FastSummary }
  /** A verified build. `optimal`: the native solve was optimal (the build is the best of the model's points that the validator accepts). */
  | { kind: 'build'; best: FastVerifiedBuild; optimal: boolean; reason?: string; outcome: OptimizeOutcome; summary: FastSummary }
  /** No verified build and no emptiness. `reason` is the outcome's. */
  | { kind: 'incomplete'; reason: string; outcome: OptimizeOutcome; summary: FastSummary };

export interface FastContext {
  /** The normalized request. `useTchebycheff` needs an `idealPoint`; TrueErgo and Prevent Overswing are Precise-only. */
  params: SolveParams;
  /** Absolute deadline on the `now` clock, milliseconds. */
  deadline: number;
  now?: () => number;
  /** Native solve, injectable for tests. */
  solve?: SolveFn;
  /** Presolve of the first solve of every round (default `FAST_PRESOLVE`). */
  presolve?: PresolveSetting;
  /** Override of {@link MAX_FAST_REJECTIONS}, for tests. */
  maxRejections?: number;
}

export async function solveFast(context: FastContext): Promise<FastResult> {
  const { params } = context;
  const now = context.now ?? ((): number => performance.now());
  const lookup = params.itemLookup;
  const presolve = context.presolve ?? FAST_PRESOLVE;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const summary: FastSummary = { nativeSolves: 0, rejectedPoints: 0, columns: 0, rows: 0, edges: 0, acyclic: true, presolve, modelObjective: null, tolerance };
  const moaDependent = isMoaDependent(params);
  /** A completed model search with no point: a Fast emptiness is never a physical proof (the classifier fences it). */
  const empty = (source: 'domain' | 'request' | 'native', detail: string): FastResult => ({
    kind: 'empty', source, detail, outcome: classifyOptimize({ mode: 'fast', moaDependent, end: 'empty', witness: false, searchFinished: true }), summary,
  });
  /** No verified build and no emptiness: what was observed and whether the executed search finished decide the outcome. */
  const incomplete = (observed: StopObservations, searchFinished: boolean): FastResult => {
    const outcome = classifyOptimize({ mode: 'fast', moaDependent, end: 'unproved', witness: false, searchFinished, observed });
    return { kind: 'incomplete', reason: outcome.reason as string, outcome, summary };
  };

  const blueprint = getPhysicalBlueprint(lookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, lookup, params);
  if (domain.empty) {
    const detail = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`)).join('; ');
    return empty('domain', detail);
  }
  const model: FastModel = specializeFast(blueprint, domain, params);
  summary.columns = model.stats.columns;
  summary.rows = model.stats.rows;
  summary.edges = model.edges.length;
  summary.acyclic = model.graph.acyclic;
  if (model.provedEmpty !== null) {
    return empty('request', model.provedEmpty.reasons.join('; '));
  }

  const validator = preparePhysicalValidator(lookup, params, {
    isAmmo: params.physicalOptions?.isAmmo,
    categoryChainOf: params.physicalOptions?.categoryChainOf,
    requirePathInstanceIds: true,
  });
  const options = nativeSolveOptions(tolerance);
  const maxRejections = context.maxRejections ?? MAX_FAST_REJECTIONS;
  const cuts: IntegerNoGood[] = [];

  for (;;) {
    const outcome = await solveWithPresolvePolicy(model.lp(cuts), { options, deadline: context.deadline, now, solve: context.solve ?? nativeSolve, presolve });
    summary.nativeSolves++;
    if (outcome.kind === 'unresolved') {
      return incomplete(outcome.cause === 'deadline' ? { deadline: true } : { proofPrerequisiteUnavailable: true }, false);
    }
    if (outcome.kind === 'infeasible') return empty('native', 'the approximate model has no feasible point');

    const result = outcome.result;
    const status = result.modelStatus.name;
    const optimal = status === 'Optimal';
    summary.modelObjective = result.objectiveValue;
    // A solve that ran to Optimal finished its search whatever is then missing or rejected; a limit stop did not.
    if (result.colValues === null) {
      return incomplete(observationsOfReason(isLimitStatus(status) ? reasonOfNativeLimit(status) : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable), optimal);
    }
    const values = columnValuesFromStructured(result.colNames, result.colValues);

    // A decision column that cannot be read as an integer is a solver fault: there is nothing to cut the point out by.
    let decoded: ReturnType<typeof decodeFast>;
    try {
      decoded = decodeFast(model, values);
    } catch (error) {
      if (error instanceof PhysicalModelError && error.code === 'DECODE_FAILED') {
        return incomplete({ validationFailed: true }, optimal);
      }
      throw error;
    }
    if (decoded.ok) {
      const validation = validator.validate(decoded.build);
      if (validation.ok && validation.stats !== null) {
        const axes = axesOfStats(validation.stats, false);
        const exactScore = exactObjectiveScore(model.objective.weights, model.objective.tchebycheff?.ideal ?? null, exactAxes(validation.stats.exact, false));
        const enclosure = scoreEnclosure(exactScore);
        const best: FastVerifiedBuild = { build: decoded.build, stats: validation.stats, axes, score: enclosure.nominal, scoreLower: enclosure.lower };
        // A native limit stop with a verified build: a witness, searched no further (the model search is unfinished).
        const outcome = classifyOptimize({
          mode: 'fast', moaDependent, end: optimal ? 'optimum' : 'unproved', witness: true, searchFinished: optimal, observed: optimal ? undefined : observationsOfReason(reasonOfNativeLimit(status)),
        });
        return { kind: 'build', best, optimal, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }), outcome, summary };
      }
    }
    // The rejection is a validation failure either way (it outranks a coincident clock stop); the executed search is finished only when the solve
    // that produced the rejected point was Optimal and no clock stop kept the cut model from being solved.
    const deadlineHit = context.deadline - now() <= 0;
    if (summary.rejectedPoints >= maxRejections || deadlineHit) {
      return incomplete({ validationFailed: true, deadline: deadlineHit }, optimal && !deadlineHit);
    }
    const cut = integerNoGood(`nogood_${cuts.length}`, model.decision, values);
    // A point with no cut (a value outside its column's domain) cannot be excluded, and solving again would return it.
    if (cut === null) return incomplete({ validationFailed: true }, optimal);
    cuts.push(cut);
    summary.rejectedPoints++;
  }
}
