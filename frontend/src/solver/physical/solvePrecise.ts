/**
 * The Precise solve pipeline over the certified COUNT model (owner decisions 2d as amended and 2e, Phase 2.10; ADR 0013 sections 4A to 4C, 5 and 6).
 *
 *   preparePhysicalWeapon (memoized per lookup object and weapon id) -> acyclic part graph (checked per gun, else refused)
 *     -> prepareSubproblemDomain -> Lemma 1 on the domain (an internal assertion) -> specializeCount (per spatial node)
 *     -> native solve (presolve off, readback of the parsed model) -> assessNativeResult -> a second opinion on every certificate-bearing verdict
 *     -> decodeFast -> independent validation (`preparePhysicalValidator`) -> exact re-scoring
 *
 * The model. On an acyclic part graph the template count model of Fast is an exact reformulation of the physical problem
 * (docs/research/acyclic-fast-exactness.md, sections 3 to 5), and `specializeCount` builds it through the proof layer, so a solve of it can carry
 * a certificate (see `specializeCount.ts` for what the certificate rests on). The occurrence-level model this pipeline used to solve left production
 * with owner decision 2d as amended (2026-10-12); it stays in the tests as the independent cross-check (`tests/physical/occurrence/`).
 *
 * Acyclicity is a checked PRECONDITION, not a branch: a gun whose part graph reachable from the receiver has a cycle (the blueprint's ancestor rule
 * cut an edge, `partGraphIsAcyclic`) is refused as unsupported data (`Unsupported data: cyclic part graph`) before anything is solved, in every
 * mode. On an acyclic gun Lemma 1 holds by theorem; it is still verified on every prepared domain (`assertCountModelApplies`), and a failure is a
 * solver error, never a silent fallback to another model.
 *
 * A build is a candidate only after the validator accepts it, so nothing that fails validation is ever published, and the incumbent's
 * statistics and score are the validator's exact recomputation, never the solver's column values. A count point the decoder or the validator
 * rejects (a boundary the solver's tolerance admitted, or a fault) is cut out with an integer no-good over the decision columns (`fastCut.ts`) and
 * the node solved again.
 *
 * Relaxed slot edges first (`PRECISE_EDGE_INTEGRALITY`). Every node is first solved with the slot-edge counts continuous (`CountModel.lpRelaxedEdges`): once
 * the template counts are integer the slot assignment is a flow over the template DAG, and its optimum is almost always integral, which then IS an optimum
 * of the integer model; its dual bound is a valid bound either way (a relaxation). A fractional edge, a stop or a rejected point falls back to the integer
 * model of the node. Both texts go through the same qualification and the same second opinion.
 *
 * Every request runs through the one spatial search (`search.ts`). A request that reads no TED (no TrueErgo, no Prevent Overswing) has a
 * single root with no weight interval and an exact model, so the search is one node. A TED request starts from the active weight range split
 * at the 3 kg knee and refines nodes until the gap is within the requested tolerance or a limit is reached. The count model carries the weight
 * exactly, so a node is rows on it and the search transfers unchanged.
 *
 * The models are solved with presolve off (`PRECISE_PRESOLVE`); no claim is taken from a presolved solve (`nativeSolve.ts`). The native
 * integrality tolerance is 1e-7 and the primal and dual feasibility tolerances 1e-9 (owner decision 5b, `nativeSolveOptions`).
 *
 * The proof frame (Phase 2.5, `proof.ts`, `nativeProof.ts`, `search.ts`). EVERY native solve is verified against its text: the parsed model must equal the
 * emitted one (a filtered coefficient is a difference), the parsed padded right-hand sides must dominate their exact needs, the native tolerances must
 * be the declared ones and presolve must be off. A qualified solve proves `UB = dual bound + the model's proved frame error` (exact rationals); an
 * unqualified one still yields verified builds (published as witnesses) but proves nothing: its bound is unknown (null on the wire) and an
 * infeasibility verdict from it is unresolved (`Required proof prerequisite unavailable`), never emptiness. The incumbent is scored as the exact rational
 * of the validator's statistics: its downward enclosure is the lower bound, its exact score the incumbent's part of the upper bound, and the
 * certificate compares the exact upper bound with the exact score.
 *
 * The second opinion (owner decision 5a). HiGHS 1.15.1 with presolve off returned, about once in 10,000 solves, a wrong Optimal with a wrong dual
 * bound (tests/physical/solverDefects/count_presolve_off_wrong_optimal.lp). So every node verdict a certificate rests on (a qualified Optimal, whose
 * bound enters the upper bound, or a qualified Infeasible) is solved again on the same text with another `random_seed` (`PRECISE_RANDOM_SEEDS`):
 *   - two QUALIFIED verdicts agree when both say Infeasible, or both say Optimal with proved bounds within the request tolerance of each other;
 *   - when the second agrees with the first, the node is settled: its bound is the larger of the two, its candidate the better verified build;
 *   - when they disagree, a third seed breaks the tie: the node is settled only by two agreeing solves, its bound is then the largest qualified
 *     bound of all three, and an infeasibility needs two qualified Infeasible verdicts and no verified build among the three;
 *   - a second or third solve that times out, stops on a limit or is not qualified settles nothing: the certificate is withheld (the node stays
 *     unresolved with the factual reason, its qualified bound and its verified builds kept), and so does a disagreement no two solves resolve.
 * `SearchTelemetry` counts the second and third solves, the disagreements and the time they cost.
 *
 * Every result carries its `outcome` (ADR 0013 section 6, `outcome.ts`): the pipeline reports what the search established (an optimum, an
 * emptiness, or neither, whether a verified witness exists, whether the executed search finished, which stops it observed) and the pure
 * classifier chooses the status, certificate, qualifications, termination and reason.
 */

import { SolverError } from '../runtimeErrors';
import type { HighsOptions, NativeResult } from '../native';
import { guardOfContext } from '../requestGuard';
import { guardStop } from '../runtimeGuard';
import type { RuntimeGuard } from '../runtimeGuard';
import type { ObjectiveAxes } from '../trueErgo';
import type { ItemLookup, PhysicalClassifiers, SolveParams } from '../types';
import { partGraphIsAcyclic, preparePhysicalWeapon } from './blueprint';
import type { PhysicalBlueprint } from './blueprint';
import { computeActiveBounds } from './bounds';
import { columnValuesFromStructured } from './decode';
import type { ColumnValues } from './decode';
import { decodeFast } from './decodeFast';
import { prepareSubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import { integerNoGood } from './fastCut';
import type { IntegerNoGood } from './fastCut';
import { NATIVE_FEASIBILITY_TOLERANCE, nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from './nativeSolve';
import type { PolicyOutcome, PresolveSetting, SolveFn } from './nativeSolve';
import { assessNativeResult, boundEvidenceOf } from './nativeProof';
import type { NativeAssessment } from './nativeProof';
import { axesOfStats } from './objective';
import { exactAxes, exactObjectiveScore, scoreEnclosure, upperBoundExact } from './proof';
import type { BoundEvidence } from './proof';
import { ratCmp, ratSub, ratToNumber, type Rat } from './exact';
import { ratAbs, ratRoundUp } from './rational';
import { classifyOptimize, isMoaDependent, observationsOfReason, unsupportedPartGraphOutcome } from './outcome';
import type { OptimizeOutcome } from './outcome';
import { PUBLIC_REASONS, reasonOfNativeLimit } from './reasons';
import { candidateExact, runSpatialSearch, transportedBounds } from './search';
import type { Candidate, NodeEvaluation, SearchInterval, SearchNode } from './search';
import { assertCountModelApplies, specializeCount } from './specializeCount';
import type { CountModel } from './specializeCount';
import { preparePhysicalValidator } from './validate';
import type { PhysicalBuild, PhysicalBuildStats } from './validate';
import { TED_FREE_WEIGHT_KG } from './spatial';

// ---------------------------------------------------------------------------------------------
// Blueprint memo and the per-gun data check
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

/**
 * The per-gun data check of owner decision 2d as amended: the part graph reachable from the receiver has no cycle. A property of the gun's data,
 * read from its memoized blueprint (so it is computed once per gun), independent of the request. Every operation (Optimize in every mode, the
 * payoff endpoints, Explore, the MOA floor) refuses a gun that fails it before any solve, with `Unsupported data: cyclic part graph`.
 */
export function partGraphSupported(lookup: ItemLookup, weaponId: string, classifiers?: PhysicalClassifiers): boolean {
  return partGraphIsAcyclic(getPhysicalBlueprint(lookup, weaponId, classifiers));
}

/**
 * The entry refusal of an operation (Optimize, Explore, the MOA floor): `Unsupported data: cyclic part graph` when the request's gun fails the data
 * check above, otherwise null. A weapon id the lookup does not hold as a gun is not judged here: the operation reports it as it always did.
 */
export function partGraphRefusal(params: Pick<SolveParams, 'itemLookup' | 'weaponId' | 'physicalOptions'>): string | null {
  const { itemLookup, weaponId } = params;
  if (!Object.hasOwn(itemLookup, weaponId) || itemLookup[weaponId].type !== 'gun') return null;
  return partGraphSupported(itemLookup, weaponId, params.physicalOptions) ? null : PUBLIC_REASONS.unsupportedCyclicPartGraph;
}

// ---------------------------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------------------------

/** A build the independent validator accepted, with its exact statistics and score. */
export interface VerifiedBuild {
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
  /** Native solves made: the first solve of every node, every re-solve after a cut, every second and third opinion, every relaxed-edge try. */
  nativeSolves: number;
  /** Solves whose presolve-on verdict was Infeasible and whose presolve-off confirmation found a solution. */
  presolveRescues: number;
  /** Infeasibility verdicts accepted, each settled by two agreeing qualified presolve-off solves (a whole model or a spatial node). */
  confirmedInfeasible: number;
  /** Nodes proved empty without a native call (a contradiction row of the model text). */
  provedEmptyNodes: number;
  /** Solver solutions the decoder or the validator rejected and an integer no-good cut removed (see `fastCut.ts`). */
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
  /** Second solves with another seed (decision 5a): one per certificate-bearing node verdict. */
  secondOpinions: number;
  /** Third solves: one per disagreement between the first two qualified verdicts. */
  thirdOpinions: number;
  /** Nodes whose first two qualified verdicts disagreed (different verdicts, or Optimal bounds further apart than the tolerance). */
  disagreements: number;
  /** Disagreements the third solve did not settle (no two of the three agreed): the certificate was withheld. */
  unsettledDisagreements: number;
  /** Wall time of the second and third solves, readback included, milliseconds. */
  secondOpinionMs: number;
  /** Node solves tried first with continuous slot-edge counts, and how many of them fell back to the integer model (`edgeIntegrality`). */
  relaxedEdgeSolves: number;
  relaxedEdgeFallbacks: number;
  /** The largest count model of the search: columns and rows. */
  columns: number;
  rows: number;
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
  /**
   * No verified build and no proof of emptiness. `reason` is the outcome's: a stop, a withheld proof, or the refusal of a gun whose part graph has
   * a cycle (`Unsupported data: cyclic part graph`: nothing prepared beyond the blueprint, nothing solved).
   */
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
  /**
   * 'integer': every node solves the integer count model. 'relaxed-first': every node is first solved with the slot-edge counts continuous
   * (`CountModel.lpRelaxedEdges`, a relaxation whose dual bound is still a valid bound) and falls back to the integer model when an edge comes out
   * fractional or the point is rejected; an integral optimum passes the same proof layer and the same second opinion. Default
   * `PRECISE_EDGE_INTEGRALITY` ('relaxed-first', decided by the Phase 2.10 measurement).
   */
  edgeIntegrality?: 'relaxed-first' | 'integer';
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
/** Most solver solutions of one node the decoder or validator may reject (each is cut out and the node re-solved) before the node fails. */
export const MAX_REJECTIONS_PER_NODE = 16;
export const DEFAULT_MAX_SPATIAL_NODES = 512;
/**
 * The `random_seed` of the first, second and third solve of a certificate-bearing verdict (owner decision 5a). The first is HiGHS's default; the
 * other two are arbitrary distinct values, fixed so that a run is reproducible.
 */
export const PRECISE_RANDOM_SEEDS = [0, 11, 29] as const;
/**
 * The node strategy of production Precise (see `PreciseContext.edgeIntegrality`): relaxed slot edges first. Certificate-safe: the relaxation's dual bound is a
 * valid bound of the integer model, an integral optimum is a point of it, and either passes the same readback, allowances, validator and second opinion.
 * Phase 2.10 measurement (172 pinned guns, 60 s, 14 processes): total wall time 156 s -> 111 s plain and 1,511 s -> 1,050 s TrueErgo; every TrueErgo
 * request certified (4 had stopped at 60 s with integer edges only); 17 of 877 relaxed node solves fell back to the integer model; the same optimum everywhere.
 */
export const PRECISE_EDGE_INTEGRALITY: 'relaxed-first' | 'integer' = 'relaxed-first';

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

/**
 * What one native solve of a node says, judged: `optimal` is a QUALIFIED Optimal (its bound may enter the upper bound), `infeasible` a QUALIFIED
 * Infeasible, `none` anything that proves nothing (a limit stop, a timeout, an unqualified solve, a bound a verified build contradicts).
 */
export interface Opinion {
  verdict: 'optimal' | 'infeasible' | 'none';
  /** The bound evidence of the solve (qualified or not); null without one. */
  evidence: BoundEvidence | null;
  /** The verified build the solve produced, if any. */
  candidate: Candidate<VerifiedBuild> | null;
  /** Total weight of the solve's point (a verified build, or a point rejected only for overswinging): the split point of an inexact node. */
  splitAt?: number;
  /** The factual reason of a `none` verdict. */
  reason?: string;
  /** The native search of the node ran to completion (see `NodeEvaluation.finished`). */
  finished: boolean;
  /** A decoded point the validator rejected for a reason the relaxation cannot explain, or that decodes to no build: the first solve cuts it out. */
  rejected?: ColumnValues;
}

/** Two QUALIFIED verdicts agree: both Infeasible, or both Optimal with proved bounds within the tolerance of each other (exact comparison). */
export function opinionsAgree(a: Opinion, b: Opinion, tolerance: number): boolean {
  if (a.verdict === 'none' || b.verdict === 'none' || a.verdict !== b.verdict) return false;
  if (a.verdict === 'infeasible') return true;
  const ua = upperBoundExact(a.evidence);
  const ub = upperBoundExact(b.evidence);
  if (ua === null || ub === null) return false;
  return ratRoundUp(ratAbs(ratSub(ua, ub))) <= tolerance;
}

const betterCandidate = <P>(a: Candidate<P> | null, b: Candidate<P> | null): Candidate<P> | null => {
  if (a === null) return b;
  if (b === null) return a;
  return ratCmp(candidateExact(b), candidateExact(a)) > 0 ? b : a;
};

/**
 * Settle a node from its opinions (decision 5a, see the header): two agreeing qualified verdicts settle it; the bound is the largest qualified Optimal
 * bound of all the solves, the candidate the best verified build of all of them; anything else withholds the certificate. Pure: exported for tests.
 */
export function settleOpinions(opinions: readonly Opinion[], tolerance: number, exact: boolean): { evaluation: NodeEvaluation<VerifiedBuild>; settled: boolean } {
  let candidate: Candidate<VerifiedBuild> | null = null;
  let bound: { exact: Rat; evidence: BoundEvidence } | null = null;
  for (const opinion of opinions) {
    candidate = betterCandidate(candidate, opinion.candidate);
    if (opinion.verdict !== 'optimal') continue;
    const proved = upperBoundExact(opinion.evidence);
    if (proved !== null && opinion.evidence !== null && (bound === null || ratCmp(proved, bound.exact) > 0)) bound = { exact: proved, evidence: opinion.evidence };
  }
  let agreed: Opinion['verdict'] | null = null;
  for (let i = 0; i < opinions.length && agreed === null; i++) {
    for (let j = i + 1; j < opinions.length; j++) {
      if (opinionsAgree(opinions[i], opinions[j], tolerance)) {
        agreed = opinions[i].verdict;
        break;
      }
    }
  }
  const splitAt = candidate?.payload.stats.weight ?? opinions.find(o => o.splitAt !== undefined)?.splitAt;
  const split = splitAt === undefined ? {} : { splitAt };
  const evidence = bound?.evidence ?? null;
  if (agreed === 'optimal') return { settled: true, evaluation: { verdict: 'solved', evidence, candidate, exact, ...split } };
  if (agreed === 'infeasible' && candidate === null) return { settled: true, evaluation: { verdict: 'infeasible', evidence: null, candidate: null, exact } };
  // Nothing agreed (or two Infeasible verdicts against a verified build): no certificate. The factual reason is that of the last solve when it
  // proved nothing (a timeout, a limit, an unqualified solve), otherwise the disagreement itself, a proof prerequisite that is unavailable.
  const last = opinions[opinions.length - 1];
  const reason = last.verdict === 'none' && last.reason !== undefined ? last.reason : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
  return { settled: false, evaluation: { verdict: 'unresolved', evidence, candidate, exact, reason, finished: opinions.every(o => o.finished), ...split } };
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
    secondOpinions: 0, thirdOpinions: 0, disagreements: 0, unsettledDisagreements: 0, secondOpinionMs: 0,
    relaxedEdgeSolves: 0, relaxedEdgeFallbacks: 0, columns: 0, rows: 0,
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
  if (!partGraphIsAcyclic(blueprint)) {
    const outcome = unsupportedPartGraphOutcome(moaDependent);
    return { kind: 'incomplete', reason: outcome.reason as string, outcome, summary: summary({ nodes: 0 }) };
  }
  const domain = prepareSubproblemDomain(blueprint, lookup, params);
  if (domain.empty) {
    const detail = domain.contradictions.map(c => (c.code === 'NO_ACCESSIBLE_BASE' ? 'no accessible base' : `root required slot ${c.rawSlotId} has no active candidate`)).join('; ');
    const outcome = classifyOptimize({ mode: 'precise', moaDependent, end: 'empty', witness: false, searchFinished: true });
    return { kind: 'empty', source: 'domain', detail, outcome, summary: summary({ nodes: 0, upperBound: -Infinity, completed: true }) };
  }
  // Lemma 1 on this domain: it holds by theorem on an acyclic part graph, so a failure is a fault of the solver's own premises, never a fallback.
  try {
    assertCountModelApplies(blueprint, domain);
  } catch (error) {
    if (error instanceof PhysicalModelError) throw new SolverError('count model assertion', error, false);
    throw error;
  }

  const validator = preparePhysicalValidator(lookup, params, {
    isAmmo: params.physicalOptions?.isAmmo,
    categoryChainOf: params.physicalOptions?.categoryChainOf,
    requirePathInstanceIds: true,
  });
  const useTrueErgo = params.useTrueErgo === true;
  const solveFn = context.solve ?? nativeSolve;
  const relaxEdges = (context.edgeIntegrality ?? PRECISE_EDGE_INTEGRALITY) === 'relaxed-first';
  const optionsOf = (seed: number): HighsOptions => ({ ...nativeSolveOptions(tolerance), ...context.nativeStop, random_seed: seed });

  /** The model of one node; a request with no TED has one model, built once. */
  let rootModel: CountModel | null = null;
  const modelOf = (interval: SearchInterval | null): CountModel => {
    const model = interval === null
      ? (rootModel ??= specializeCount(blueprint, domain, params))
      : specializeCount(blueprint, domain, params, { weightMin: interval.lo, weightMax: interval.hi });
    telemetry.columns = Math.max(telemetry.columns, model.stats.columns);
    telemetry.rows = Math.max(telemetry.rows, model.stats.rows);
    return model;
  };

  /** Verify one solve against the text it solved and the proof record of its model; the first reasons are kept for the report. */
  const assess = (model: CountModel, lpText: string, result: NativeResult): NativeAssessment => {
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

  /** Judge one solved (Optimal or limit) native answer: decode, validate exactly, score, and check the bound against the build. */
  const judge = (model: CountModel, lpText: string, result: NativeResult, relaxed: boolean): Opinion => {
    const status = result.modelStatus.name;
    const assessment = assess(model, lpText, result);
    const trusted = assessment.qualified;
    // The bound of this solve: its dual bound, qualified or not (unqualified evidence proves nothing), plus the model's proved frame error.
    const evidence = boundEvidenceOf(model.proof, result, assessment);
    const optimal = status === 'Optimal';
    const qualifiedOptimal = optimal && trusted;
    const stopReason = optimal ? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable : reasonOfNativeLimit(status);
    // An Optimal solve of an exact node is a finished search of it, whatever is then withheld (the bound, the build). An inexact node still
    // needs refining, and a limit stop has not finished.
    const finished = optimal && model.exact;
    const none = (extra: Partial<Opinion> = {}): Opinion => ({ verdict: 'none', evidence, candidate: null, reason: stopReason, finished, ...extra });
    if (result.colValues === null) return none();
    // A relaxed-edge solve whose edges are not integral is no point of the integer model: its bound is still valid (a relaxation), its point is not judged.
    if (relaxed && model.edges.some(edge => {
      const j = result.colIndexByName.get(edge.column);
      const v = j === undefined ? Number.NaN : (result.colValues as Float64Array)[j];
      return !(Math.abs(v - Math.round(v)) <= NATIVE_FEASIBILITY_TOLERANCE);
    })) {
      return qualifiedOptimal ? { verdict: 'optimal', evidence, candidate: null, finished } : none();
    }
    const values = columnValuesFromStructured(result.colNames, result.colValues);
    let decoded: ReturnType<typeof decodeFast>;
    try {
      decoded = decodeFast(model, values);
    } catch (error) {
      // A decision column that cannot be read as an integer: a solver fault with nothing to cut the point out by.
      if (error instanceof PhysicalModelError && error.code === 'DECODE_FAILED') return none({ reason: PUBLIC_REASONS.independentBuildValidationFailed });
      throw error;
    }
    if (decoded.ok) {
      const validation = validator.validate(decoded.build);
      const stats = validation.stats;
      if (validation.ok && stats !== null) {
        const axes = axesOfStats(stats, useTrueErgo);
        // The incumbent's score is the exact rational of the validator's statistics under the model's own resolved weights and payoff table,
        // enclosed on both sides: the lower end is the proof lower bound, the upper end the incumbent's part of the upper bound.
        const exactScore = exactObjectiveScore(model.objective.weights, model.objective.tchebycheff?.ideal ?? null, exactAxes(stats.exact, useTrueErgo));
        const enclosure = scoreEnclosure(exactScore);
        const candidate: Candidate<VerifiedBuild> = {
          score: enclosure.nominal,
          scoreLower: enclosure.lower,
          scoreUpper: enclosure.upper,
          scoreExact: enclosure.exact,
          payload: { build: decoded.build, stats, axes, score: enclosure.nominal, scoreLower: enclosure.lower, scoreUpper: enclosure.upper },
        };
        // A build verified in THIS solve cannot score above the solve's proved upper bound. The shortfall (how far the bound falls below the
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
            return none({ evidence: { ...evidence, qualified: false }, candidate, splitAt: stats.weight, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable });
          }
        }
        if (qualifiedOptimal) return { verdict: 'optimal', evidence, candidate, splitAt: stats.weight, finished };
        return none({ candidate, splitAt: stats.weight });
      }
      // The weight penalty of an inexact node is a lower envelope of q, so its optimum may be overswinging exactly: the relaxation is a valid
      // upper bound, the build is not a candidate, and the node is refined at that weight.
      const relaxationOnly = !model.exact && stats !== null && validation.violations.length > 0
        && validation.violations.every(v => v.code === 'OVERSWING_PREVENTED');
      if (relaxationOnly && stats !== null) {
        if (qualifiedOptimal) return { verdict: 'optimal', evidence, candidate: null, splitAt: stats.weight, finished };
        return none({ splitAt: stats.weight, finished: false });
      }
    }
    // Any other rejection is a boundary the solver's tolerance admitted and exact arithmetic does not (or a fault): the first solve of a node cuts
    // the point out and solves again; a later opinion keeps only its bound.
    return { verdict: qualifiedOptimal ? 'optimal' : 'none', evidence, candidate: null, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished, rejected: values };
  };

  /** One native solve of a node's text with a given seed, judged. Never cuts. */
  const opinionOf = async (model: CountModel, lpText: string, seed: number, relaxed: boolean): Promise<Opinion> => {
    telemetry.nativeSolves++;
    const outcome: PolicyOutcome = await solveWithPresolvePolicy(lpText, {
      options: optionsOf(seed), deadline, now, solve: solveFn, presolve: context.presolve, includeReadback: true,
    });
    if (outcome.kind === 'unresolved') {
      return { verdict: 'none', evidence: null, candidate: null, finished: false, reason: outcome.cause === 'deadline' ? PUBLIC_REASONS.timeLimitReached : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
    }
    if (outcome.kind === 'infeasible') {
      // An infeasibility verdict is evidence about the model HiGHS parsed: it counts only when the solve that DECIDES it (the presolve-off
      // solve: the first one, or the confirmation of a presolved first one) was verified against the text (readback equal, allowances
      // dominating, declared tolerances, presolve off), so a filtered coefficient can never prove emptiness.
      const deciding = outcome.confirmation ?? outcome.first;
      // The native search finished (it said Infeasible); an unqualified one only has its proof withheld.
      if (!assess(model, lpText, deciding).qualified) return { verdict: 'none', evidence: null, candidate: null, finished: true, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
      return { verdict: 'infeasible', evidence: null, candidate: null, finished: true };
    }
    if (outcome.presolveRescue) telemetry.presolveRescues++;
    return judge(model, lpText, outcome.result, relaxed);
  };

  /**
   * The second opinion of a certificate-bearing first verdict (decision 5a, see the header): another seed on the same text, a third on a
   * disagreement, then `settleOpinions`.
   */
  const confirm = async (model: CountModel, lpText: string, first: Opinion, relaxed: boolean): Promise<NodeEvaluation<VerifiedBuild>> => {
    // The first-witness policy of a MOA floor query takes the first verified build and stops: no certificate is asked of it, so no second opinion is
    // spent on it (ADR 0013 section 6). An infeasibility verdict of a floor query is still confirmed: it is what raises the proved lower bound.
    if (context.stopAtFirstWitness === true && first.candidate !== null) {
      return {
        verdict: 'unresolved', evidence: first.evidence, candidate: first.candidate, exact: model.exact, reason: PUBLIC_REASONS.nativeSolutionLimitReached,
        finished: first.finished, ...(first.splitAt === undefined ? {} : { splitAt: first.splitAt }),
      };
    }
    const started = now();
    const opinions = [first];
    telemetry.secondOpinions++;
    const second = await opinionOf(model, lpText, PRECISE_RANDOM_SEEDS[1], relaxed);
    opinions.push(second);
    if (second.verdict !== 'none' && !opinionsAgree(first, second, tolerance)) {
      telemetry.disagreements++;
      telemetry.thirdOpinions++;
      opinions.push(await opinionOf(model, lpText, PRECISE_RANDOM_SEEDS[2], relaxed));
    }
    telemetry.secondOpinionMs += now() - started;
    const { evaluation, settled } = settleOpinions(opinions, tolerance, model.exact);
    if (!settled && opinions.length === 3) telemetry.unsettledDisagreements++;
    if (evaluation.verdict === 'infeasible') telemetry.confirmedInfeasible++;
    return evaluation;
  };

  /** A first opinion that bears no certificate, as the node's evaluation. */
  const unconfirmed = (model: CountModel, opinion: Opinion): NodeEvaluation<VerifiedBuild> => ({
    verdict: 'unresolved',
    evidence: opinion.evidence,
    candidate: opinion.candidate,
    exact: model.exact,
    reason: opinion.reason ?? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable,
    finished: opinion.finished,
    ...(opinion.splitAt === undefined ? {} : { splitAt: opinion.splitAt }),
  });
  const failed = (model: CountModel, opinion: Opinion): NodeEvaluation<VerifiedBuild> => ({
    verdict: 'failed', evidence: opinion.evidence, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished: opinion.finished,
  });
  /** The interrupt a guard reports, as an unresolved evaluation. */
  const interrupted = (model: CountModel, stop: 'cancelled' | 'deadline'): NodeEvaluation<VerifiedBuild> => ({
    verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached,
  });

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<VerifiedBuild>> => {
    const model = modelOf(node.interval);
    if (model.provedEmpty !== null) {
      telemetry.provedEmptyNodes++;
      return { verdict: 'infeasible', evidence: null, candidate: null, exact: true };
    }

    // Relaxed slot edges first (opt-in): an integral optimum of the relaxation is an optimum of the integer model, judged and confirmed exactly as
    // one, and an infeasible relaxation leaves the integer model nothing either. Anything else falls back to the integer model of the node.
    let relaxedRejection: Opinion | null = null;
    if (relaxEdges && model.edges.length > 0) {
      const lpText = model.lpRelaxedEdges();
      telemetry.relaxedEdgeSolves++;
      const first = await opinionOf(model, lpText, PRECISE_RANDOM_SEEDS[0], true);
      if (first.verdict === 'infeasible') return confirm(model, lpText, first, true);
      if (first.verdict === 'optimal' && first.rejected === undefined && (first.candidate !== null || first.splitAt !== undefined)) return confirm(model, lpText, first, true);
      if (first.verdict === 'none' && first.reason === PUBLIC_REASONS.timeLimitReached && first.evidence === null) return unconfirmed(model, first);
      telemetry.relaxedEdgeFallbacks++;
      if (first.rejected !== undefined) relaxedRejection = first;
      // The integer re-solve is a stage of its own: yield so a cancel message is dispatched, then guard. A rejected point seen by the relaxed solve
      // is an observed validation failure, which outranks the coincident interrupt (section 6); the integer model was never solved (unfinished).
      await guard.yieldMacrotask();
      const stop = guardStop(guard);
      if (stop !== null) return relaxedRejection !== null ? { ...failed(model, relaxedRejection), finished: false } : interrupted(model, stop);
    }

    const cuts: IntegerNoGood[] = [];
    for (;;) {
      if (cuts.length > 0) {
        // A re-solve after a rejected candidate is a stage of its own: yield so a cancel message is dispatched, then guard.
        await guard.yieldMacrotask();
        const stop = guardStop(guard);
        if (stop !== null) return interrupted(model, stop);
      }
      const lpText = model.lp(cuts);
      const first = await opinionOf(model, lpText, PRECISE_RANDOM_SEEDS[0], false);
      if (first.rejected !== undefined) {
        // The rejected point is cut out and the node solved again, so the valid builds beside it are still found; only a repeated rejection
        // (or no time to try again) fails the node.
        const trusted = first.evidence?.qualified === true;
        const cut = trusted && cuts.length < MAX_REJECTIONS_PER_NODE && deadline - now() > 0 ? integerNoGood(`nogood_${cuts.length}`, model.decision, first.rejected) : null;
        if (cut === null) return failed(model, first);
        telemetry.rejectedCandidates++;
        cuts.push(cut);
        continue;
      }
      if (first.verdict === 'none' && first.reason === PUBLIC_REASONS.independentBuildValidationFailed) return failed(model, first);
      if (first.verdict === 'none') return unconfirmed(model, first);
      return confirm(model, lpText, first, false);
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
