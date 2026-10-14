// TEST-ONLY: the Precise pipeline over the OCCURRENCE model, the independent cross-check of the count model (owner decision 2d as amended,
// 2026-10-12; Phase 2.10 milestone 2). Until then it was production's `solvePrecise`; production now runs Precise only on the certified count model
// (`src/solver/physical/solvePrecise.ts`) and imports nothing from here.
//
//   getPhysicalBlueprint -> prepareSubproblemDomain -> specializeLP (per weight node) -> native solve (presolve off, readback) -> assessNativeResult
//     -> decodeSolution -> independent validation -> exact rational re-scoring -> no-good cut on a rejection
//
// It drives the same spatial search, qualification and bound code as production (`runSpatialSearch`, `assessNativeResult`, `boundEvidenceOf`), so
// a certificate it reports is decided by the same proof layer, on a model that shares no row with the count model. It runs one solve per node
// (no second opinion): the gates that compare it with the count model treat a disagreement as a finding to look at, not as a verdict.
import type { HighsOptions, NativeResult } from '../../../src/solver/native';
import { guardOfContext } from '../../../src/solver/requestGuard';
import { guardStop } from '../../../src/solver/runtimeGuard';
import type { RuntimeGuard } from '../../../src/solver/runtimeGuard';
import type { ObjectiveAxes } from '../../../src/solver/trueErgo';
import type { SolveParams } from '../../../src/solver/types';
import { computeActiveBounds } from '../../../src/solver/physical/bounds';
import { columnValuesFromStructured } from '../../../src/solver/physical/decode';
import { decodeSolution, physicalBuildFromDecoded, type DecodedBuild } from './decodeOccurrence';
import { prepareSubproblemDomain } from '../../../src/solver/physical/domain';
import { PhysicalModelError } from '../../../src/solver/physical/errors';
import { nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from '../../../src/solver/physical/nativeSolve';
import { assessNativeResult, boundEvidenceOf } from '../../../src/solver/physical/nativeProof';
import type { NativeAssessment } from '../../../src/solver/physical/nativeProof';
import { insertRows, noGoodRow } from '../../../src/solver/physical/nogood';
import type { PresolveSetting, SolveFn } from '../../../src/solver/physical/nativeSolve';
import { axesOfStats } from '../../../src/solver/physical/objective';
import { exactAxes, exactObjectiveScore, scoreEnclosure, upperBoundExact } from '../../../src/solver/physical/proof';
import { ratCmp, ratSub, ratToNumber, type Rat } from '../../../src/solver/physical/exact';
import { ratRoundUp } from '../../../src/solver/physical/rational';
import { classifyOptimize, isMoaDependent, observationsOfReason } from '../../../src/solver/physical/outcome';
import type { OptimizeOutcome } from '../../../src/solver/physical/outcome';
import { PUBLIC_REASONS, reasonOfNativeLimit } from '../../../src/solver/physical/reasons';
import { runSpatialSearch, transportedBounds } from '../../../src/solver/physical/search';
import type { NodeEvaluation, SearchInterval, SearchNode } from '../../../src/solver/physical/search';
import { specializeLP, type SpecializedModel } from './specializeOccurrence';
import { preparePhysicalValidator } from '../../../src/solver/physical/validate';
import type { PhysicalBuild, PhysicalBuildStats } from '../../../src/solver/physical/validate';
import { BOUND_SANITY_RELATIVE, DEFAULT_MAX_SPATIAL_NODES, getPhysicalBlueprint, resolveTolerance, rootIntervals } from '../../../src/solver/physical/solvePrecise';

// ---------------------------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------------------------

/** A build the independent validator accepted, with its exact statistics and score. */
export interface OccurrenceVerifiedBuild {
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

export interface OccurrenceTelemetry {
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

export interface OccurrenceSummary {
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
  telemetry: OccurrenceTelemetry;
}

export type OccurrenceResult =
  /** The request has no build. `source`: the domain, a constant row of the request, or confirmed native infeasibility. */
  | { kind: 'empty'; source: 'domain' | 'request' | 'native'; detail: string; outcome: OptimizeOutcome; summary: OccurrenceSummary }
  /** A verified build. `certified`: the search completed with a gap within the tolerance. `reason`: the outcome's, when it is not certified. */
  | { kind: 'build'; best: OccurrenceVerifiedBuild; certified: boolean; reason?: string; outcome: OptimizeOutcome; summary: OccurrenceSummary }
  /** No verified build and no proof of emptiness. `reason` is the outcome's. */
  | { kind: 'incomplete'; reason: string; outcome: OptimizeOutcome; summary: OccurrenceSummary };

export interface OccurrenceContext {
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

const boundShortfallLimit = (bound: Rat, tolerance: number): number => Math.max(tolerance, BOUND_SANITY_RELATIVE * Math.max(1, Math.abs(ratToNumber(bound))));
const MAX_REJECTIONS_PER_NODE = 16;

export async function solveOccurrence(context: OccurrenceContext): Promise<OccurrenceResult> {
  const { params } = context;
  const guard = guardOfContext(context);
  const now = guard.now;
  const deadline = guard.deadline;
  const lookup = params.itemLookup;
  const tedRequest = params.useTrueErgo === true || params.preventOverswing === true;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const telemetry: OccurrenceTelemetry = {
    nativeSolves: 0, presolveRescues: 0, confirmedInfeasible: 0, provedEmptyNodes: 0, rejectedCandidates: 0,
    readbackChecks: 0, unqualifiedSolves: 0, readbackMs: 0, unqualifiedReasons: [], boundShortfall: 0,
  };
  const moaDependent = isMoaDependent(params);
  const summary = (partial: Partial<OccurrenceSummary> & Pick<OccurrenceSummary, 'nodes'>): OccurrenceSummary => ({
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
    const detail = domain.contradictions.map(c => `root required slot ${c.rawSlotId} has no active candidate`).join('; ');
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

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<OccurrenceVerifiedBuild>> => {
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
  const search = await runSpatialSearch<OccurrenceVerifiedBuild>({ roots, evaluate, tolerance, maxNodes, now, deadline, guard, stopAtFirstWitness: context.stopAtFirstWitness });
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