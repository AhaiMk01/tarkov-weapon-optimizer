// Milestone-1 test driver of the certifiable count model (Phase 2.10): the Precise solve pipeline of `solvePrecise.ts` with the COUNT model in place of the
// occurrence model, so the model-level gates can compare the two on an optimum, an emptiness and a certificate before Precise itself is switched.
//
//   getPhysicalBlueprint -> prepareSubproblemDomain -> eligibility -> specializeCount (per weight node) -> native solve (presolve off, readback of the parsed
//   model) -> assessNativeResult -> bound evidence -> decodeFast -> independent validation -> exact rational re-scoring -> integer no-good cut on a rejection
//
// It drives the very search, qualification and bound code Precise uses (`runSpatialSearch`, `assessNativeResult`, `boundEvidenceOf`), so what it reports as
// `certified` is decided by the same proof layer. It is NOT production code: the production entry is `solvePrecise` once milestone 2 chooses the model.
import { columnValuesFromStructured } from '../../src/solver/physical/decode';
import { decodeFast } from '../../src/solver/physical/decodeFast';
import { prepareSubproblemDomain } from '../../src/solver/physical/domain';
import { integerNoGood, type IntegerNoGood } from '../../src/solver/physical/fastCut';
import { ratCmp, ratSub, ratToNumber } from '../../src/solver/physical/exact';
import { nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from '../../src/solver/physical/nativeSolve';
import type { PresolveSetting, SolveFn } from '../../src/solver/physical/nativeSolve';
import { assessNativeResult, boundEvidenceOf } from '../../src/solver/physical/nativeProof';
import { exactAxes, exactObjectiveScore, scoreEnclosure, upperBoundExact } from '../../src/solver/physical/proof';
import { PUBLIC_REASONS, reasonOfNativeLimit } from '../../src/solver/physical/reasons';
import { ratRoundUp } from '../../src/solver/physical/rational';
import { runSpatialSearch, transportedBounds } from '../../src/solver/physical/search';
import type { NodeEvaluation, SearchInterval, SearchNode } from '../../src/solver/physical/search';
import { countModelEligibility, specializeCount } from '../../src/solver/physical/specializeCount';
import type { CountModel } from '../../src/solver/physical/specializeCount';
import { DEFAULT_MAX_SPATIAL_NODES, getPhysicalBlueprint, resolveTolerance, rootIntervals } from '../../src/solver/physical/solvePrecise';
import { computeActiveBounds } from '../../src/solver/physical/bounds';
import { PhysicalModelError } from '../../src/solver/physical/errors';
import { preparePhysicalValidator } from '../../src/solver/physical/validate';
import type { PhysicalBuild, PhysicalBuildStats } from '../../src/solver/physical/validate';
import type { SolveParams } from '../../src/solver/types';

export interface CountVerified {
  build: PhysicalBuild;
  stats: PhysicalBuildStats;
  score: number;
  scoreLower: number;
}

export interface CountTelemetry {
  nativeSolves: number;
  rejectedCandidates: number;
  unqualifiedSolves: number;
  unqualifiedReasons: string[];
  confirmedInfeasible: number;
  provedEmptyNodes: number;
  boundShortfall: number;
}

export type CountRun =
  | { kind: 'ineligible'; reason: string }
  | { kind: 'empty'; source: 'domain' | 'request' | 'native'; telemetry: CountTelemetry; bounds: { lower: number | null; upper: number | null; gap: number | null }; nodes: number }
  | { kind: 'build'; best: CountVerified; certified: boolean; reason: string | null; telemetry: CountTelemetry; bounds: { lower: number | null; upper: number | null; gap: number | null }; nodes: number; model: CountModel | null }
  | { kind: 'incomplete'; reason: string; telemetry: CountTelemetry; bounds: { lower: number | null; upper: number | null; gap: number | null }; nodes: number };

export interface CountOptions {
  /** Absolute time budget in milliseconds (default 120 s). */
  budgetMs?: number;
  solve?: SolveFn;
  presolve?: PresolveSetting;
}

const MAX_REJECTIONS = 16;
const BOUND_SANITY_RELATIVE = 1e-9;

export async function solveCount(params: SolveParams, options: CountOptions = {}): Promise<CountRun> {
  const now = (): number => performance.now();
  const deadline = now() + (options.budgetMs ?? 120_000);
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const tedRequest = params.useTrueErgo === true || params.preventOverswing === true;
  const telemetry: CountTelemetry = { nativeSolves: 0, rejectedCandidates: 0, unqualifiedSolves: 0, unqualifiedReasons: [], confirmedInfeasible: 0, provedEmptyNodes: 0, boundShortfall: 0 };
  const lookup = params.itemLookup;
  const blueprint = getPhysicalBlueprint(lookup, params.weaponId, params.physicalOptions);
  const domain = prepareSubproblemDomain(blueprint, lookup, params);
  const none = { lower: null, upper: null, gap: null };
  if (domain.empty) return { kind: 'empty', source: 'domain', telemetry, bounds: none, nodes: 0 };
  const eligibility = countModelEligibility(blueprint, domain);
  if (!eligibility.eligible) return { kind: 'ineligible', reason: eligibility.reason as string };
  const validator = preparePhysicalValidator(lookup, params, {
    isAmmo: params.physicalOptions?.isAmmo, categoryChainOf: params.physicalOptions?.categoryChainOf, requirePathInstanceIds: true,
  });
  const useTrueErgo = params.useTrueErgo === true;
  let lastModel: CountModel | null = null;

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<CountVerified>> => {
    const spatialNode = node.interval === null ? undefined : { weightMin: node.interval.lo, weightMax: node.interval.hi };
    const model = specializeCount(blueprint, domain, params, spatialNode);
    lastModel = model;
    if (model.provedEmpty !== null) {
      telemetry.provedEmptyNodes++;
      return { verdict: 'infeasible', evidence: null, candidate: null, exact: true };
    }
    const nativeOptions = nativeSolveOptions(tolerance);
    telemetry.nativeSolves++;
    const cuts: IntegerNoGood[] = [];
    for (;;) {
      const lpText = model.lp(cuts);
      const outcome = await solveWithPresolvePolicy(lpText, {
        options: nativeOptions, deadline, now, solve: options.solve ?? nativeSolve, presolve: options.presolve ?? 'off', includeReadback: true,
      });
      if (outcome.kind === 'unresolved') {
        return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: outcome.cause === 'deadline' ? PUBLIC_REASONS.timeLimitReached : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
      }
      const assess = (result: Parameters<typeof assessNativeResult>[1]) => {
        const assessment = assessNativeResult({ lpText, proof: model.proof }, result);
        if (!assessment.qualified) {
          telemetry.unqualifiedSolves++;
          for (const reason of assessment.reasons) if (telemetry.unqualifiedReasons.length < 3 && !telemetry.unqualifiedReasons.includes(reason)) telemetry.unqualifiedReasons.push(reason);
        }
        return assessment;
      };
      if (outcome.kind === 'infeasible') {
        const deciding = outcome.confirmation ?? outcome.first;
        if (!assess(deciding).qualified) return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished: true };
        telemetry.confirmedInfeasible++;
        return { verdict: 'infeasible', evidence: null, candidate: null, exact: model.exact };
      }
      const result = outcome.result;
      const status = result.modelStatus.name;
      const assessment = assess(result);
      const trusted = assessment.qualified;
      const evidence = boundEvidenceOf(model.proof, result, assessment);
      const optimal = status === 'Optimal';
      const stopReason = optimal ? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable : reasonOfNativeLimit(status);
      const finished = optimal && model.exact;
      if (result.colValues === null) return { verdict: 'unresolved', evidence, candidate: null, exact: model.exact, reason: stopReason, finished };
      const values = columnValuesFromStructured(result.colNames, result.colValues);
      let decoded: ReturnType<typeof decodeFast>;
      try {
        decoded = decodeFast(model, values);
      } catch (error) {
        if (error instanceof PhysicalModelError && error.code === 'DECODE_FAILED') return { verdict: 'failed', evidence, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished };
        throw error;
      }
      if (decoded.ok) {
        const validation = validator.validate(decoded.build);
        const stats = validation.stats;
        if (validation.ok && stats !== null) {
          const exactScore = exactObjectiveScore(model.objective.weights, model.objective.tchebycheff?.ideal ?? null, exactAxes(stats.exact, useTrueErgo));
          const enclosure = scoreEnclosure(exactScore);
          const candidate = {
            score: enclosure.nominal, scoreLower: enclosure.lower, scoreUpper: enclosure.upper, scoreExact: enclosure.exact,
            payload: { build: decoded.build, stats, score: enclosure.nominal, scoreLower: enclosure.lower },
          };
          const proved = upperBoundExact(evidence);
          if (trusted && proved !== null && ratCmp(enclosure.exact, proved) > 0) {
            const shortfall = ratRoundUp(ratSub(enclosure.exact, proved));
            telemetry.boundShortfall = Math.max(telemetry.boundShortfall, shortfall);
            if (shortfall > Math.max(tolerance, BOUND_SANITY_RELATIVE * Math.max(1, Math.abs(ratToNumber(proved))))) {
              telemetry.unqualifiedSolves++;
              return { verdict: 'unresolved', evidence: { ...evidence, qualified: false }, candidate, exact: model.exact, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished };
            }
          }
          if (optimal && trusted) return { verdict: 'solved', evidence, candidate, exact: model.exact, splitAt: stats.weight };
          return { verdict: 'unresolved', evidence, candidate, exact: model.exact, reason: stopReason, finished };
        }
        const relaxationOnly = !model.exact && stats !== null && validation.violations.length > 0 && validation.violations.every(v => v.code === 'OVERSWING_PREVENTED');
        if (relaxationOnly && stats !== null) {
          if (optimal && trusted) return { verdict: 'solved', evidence, candidate: null, exact: false, splitAt: stats.weight };
          return { verdict: 'unresolved', evidence, candidate: null, exact: false, reason: stopReason };
        }
      }
      if (trusted && cuts.length < MAX_REJECTIONS && deadline - now() > 0) {
        const cut = integerNoGood(`nogood_${cuts.length}`, model.decision, values);
        if (cut !== null) {
          telemetry.rejectedCandidates++;
          cuts.push(cut);
          continue;
        }
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
  const search = await runSpatialSearch<CountVerified>({ roots, evaluate, tolerance, maxNodes, now, deadline });
  const bounds = transportedBounds(search);
  if (search.incumbent !== null) {
    return { kind: 'build', best: search.incumbent.payload, certified: search.certified, reason: search.stopReason, telemetry, bounds, nodes: search.nodes, model: lastModel };
  }
  if (search.empty) return { kind: 'empty', source: telemetry.nativeSolves > 0 ? 'native' : 'request', telemetry, bounds, nodes: search.nodes };
  return { kind: 'incomplete', reason: search.stopReason ?? 'no proof', telemetry, bounds, nodes: search.nodes };
}
