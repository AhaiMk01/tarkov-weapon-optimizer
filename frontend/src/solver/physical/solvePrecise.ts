/**
 * The Precise solve pipeline over the certified COUNT model (owner decisions 2d as amended and 2e, Phase 2.10; ADR 0013 sections 4A to 4C, 5 and 6).
 *
 *   preparePhysicalWeapon (memoized per lookup object and weapon id; a cyclic part graph is an internal error there)
 *     -> prepareSubproblemDomain -> Lemma 1 on the domain (an internal assertion) -> specializeCount (per spatial node)
 *     -> native solve (presolve off, readback of the parsed model) -> assessNativeResult -> a second opinion on every certificate-bearing verdict
 *     -> decodeFast -> independent validation (`preparePhysicalValidator`) -> exact re-scoring
 *
 * The model. On an acyclic part graph the template count model of Fast is an exact reformulation of the physical problem
 * (docs/research/acyclic-fast-exactness.md, sections 3 to 5), and `specializeCount` builds it through the proof layer, so a solve of it can carry
 * a certificate (see `specializeCount.ts` for what the certificate rests on). The occurrence-level model this pipeline used to solve left production
 * with owner decision 2d as amended (2026-10-12); it stays in the tests as the independent cross-check (`tests/physical/occurrence/`).
 *
 * Acyclic part graphs are assumed (owner decision 2026-10-12: no gun has a cyclic part graph); the blueprint builder throws an internal
 * `CYCLIC_PART_GRAPH` error on one rather than unrolling it. Lemma 1 then holds by theorem; it is still verified on every prepared domain
 * (`assertCountModelApplies`), and a failure is a solver error, never a silent fallback to another model.
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
 *     unresolved with the factual reason and its verified builds kept, but NO bound: see "Only checked bounds"), and so does a disagreement no two
 *     solves resolve;
 *   - a found point blocks impossible (owner, 2026-10-12, G2): two Infeasible verdicts never settle a node against a qualified opinion that returned a
 *     primal point (an Optimal, or a qualified limit stop with a point) or a verified build, on the integer and the relaxed-edge text alike; the node
 *     stays unresolved.
 * `SearchTelemetry` counts the second and third solves, the disagreements and the time they cost.
 *
 * Splits need no second opinion (owner, 2026-10-12, decision F1). A first opinion that leads ONLY to a split of the weight range (a qualified Optimal of an
 * inexact node with no verified build and a split point, whose bound would not fathom the node) is not confirmed: the node is returned as a `split`
 * evaluation, which the search splits without reading its bound (`search.ts`). Splitting discards nothing, so it needs no certificate, and the shortcut
 * issues none: no bound, no pruning, no infeasibility. A first opinion whose bound WOULD fathom the node against the incumbent goes through the full rule.
 * Extended (owner, 2026-10-13, amending F1; `PRECISE_SPLIT_SHORTCUT` 'witness'): the first opinion may carry a verified build. Its proved bound must then
 * exceed by more than the tolerance BOTH the incumbent and every verified build the evaluation brings (its own, and a build kept from the relaxed try),
 * so the node would be split even after its own build became the incumbent, whatever the exact bound. The build is returned with the `split` as a
 * witness (validated exactly, it may become the incumbent); its single-solve bound is not (G1). The interval must be splittable at the split point (a
 * node at the resolution limit needs a settled verdict), and a MOA floor query (`stopAtFirstWitness`, `nativeStop`) keeps the 2026-10-12 rule.
 *
 * Only checked bounds (owner, 2026-10-12, G1). A node's bound enters the search, and so any published upper bound or gap, only from a SETTLED verdict
 * (two agreeing qualified solves). An unresolved or failed node carries no bound of its own (`evidence: null`, enforced once in `evaluate`), whatever
 * single solve it saw: a limit-stopped first opinion, a timed-out or unqualified second opinion, a disagreement, a relaxed try carried through the
 * fallback, a rejected solve's dual bound, or the first-witness short-circuit of a floor query. Such a node keeps the bound it inherited from a settled
 * parent, unknown at a root, and an unknown live bound makes the published upper bound and gap unknown (null on the wire).
 * Amended (owner, 2026-10-18): one bound needs no solve at all, the a-priori cap bound of an objective that is exactly `e x TED` (`aprioriScoreBound`).
 * Every node takes the tighter of it and its inherited bound, so a heavy interval it proves hopeless is fathomed without a native call.
 *
 * Inconclusive solves (owner, 2026-10-12: "retry seeds, never throw"). HiGHS 1.15.1 returns `SolveError` under the production options on some small,
 * valid count models for some seeds (reference/harness/countGates.nativeDefects.differential.test.ts). Such a solve (`SolveError`, `PresolveError`,
 * `PostsolveError` on a text HiGHS read without error: `nativeSolve.ts`) is an INCONCLUSIVE opinion: it is no verdict, it is not counted among the
 * (at most three, decision 5a) qualified opinions, and the node moves on to the next seed of `PRECISE_RANDOM_SEEDS`, for its first opinion as for
 * its second and third. When the seeds run out before two qualified verdicts agree, the node is unresolved with `Required proof prerequisite
 * unavailable`: no certificate, its verified builds kept and no bound (G1). A malformed text or a native call that throws still raises its typed error.
 *
 * Infeasibility needs the relaxation to agree (owner, 2026-10-12: "relaxation must agree"). HiGHS 1.15.1 also reported a FEASIBLE integer count text
 * Infeasible under every production seed (fuzz world 30001860, TrueErgo, weight node [2.5, 2.5]) while the relaxed-edge text of the same node found the
 * build, so two agreeing seeds are no sound guard for an Infeasible verdict of the INTEGER text. A node is therefore treated as infeasible (pruned by the
 * spatial search, counted in a certified infeasibility, used by the MOA floor as an infeasibility proof) only when its RELAXED-edge text, with the same
 * cuts, is settled Infeasible by two agreeing qualified verdicts: an infeasible relaxation leaves the integer model nothing, which is sound. Concretely:
 *   - the relaxed text settled Infeasible (production's relaxed-first try, or the confirmation below): the node is infeasible;
 *   - the integer text settled Infeasible: the relaxed text with the same cuts is solved (unless it was already solved in this node without settling
 *     Infeasible, or a verified build of the node exists: then it cannot agree) and its own verdict decides: settled Infeasible, the node is infeasible; an integral point the validator accepts, that build is the node's candidate
 *     (settled by the second opinion as any relaxed optimum); a fractional or rejected point, no verdict or a stop, the node is NOT infeasible but
 *     unresolved (`Required proof prerequisite unavailable`, or the factual stop of the confirmation): no certificate, the best verified build kept;
 *   - relaxed-first in production: an integer-text Infeasible normally FOLLOWS a feasible fractional (or rejected) relaxation of the same text, so it can
 *     never certify the node infeasible: such a node is unresolved at once, without another solve (`relaxationVetoes`).
 * A node model with no slot edge has a relaxed text equal to its integer text, so its settled Infeasible needs nothing more. This guard is sound but not
 * complete: a relaxation can share a false Infeasible (the row-deleted minimal text of world 30001860 does), and then nothing here detects it.
 *
 * Every result carries its `outcome` (ADR 0013 section 6, `outcome.ts`): the pipeline reports what the search established (an optimum, an
 * emptiness, or neither, whether a verified witness exists, whether the executed search finished, which stops it observed) and the pure
 * classifier chooses the status, certificate, qualifications, termination and reason.
 *
 * The solve pool (owner, 2026-10-13; `native/pool.ts`, `speculativeSolves.ts`, `docs/stage3/parallel-pool.md`). With a pool of two or more lanes every
 * solve runs in a pool worker, and solves the pipeline is likely to read soon are started early: a node's second seed together with its first
 * (`PRECISE_SPECULATION`) and the first solve of the next live nodes (the search's `lookahead`). The pipeline above is unchanged: it reads an early
 * answer only when it asks for exactly that text and those options, in its own order, so the opinions, their settlement, the commit order of the
 * search and the returned build are those of the sequential run. Pool size 1 is the in-thread path, unchanged.
 */

import { SolverError } from '../runtimeErrors';
import type { HighsOptions, NativeResult } from '../native';
import { guardOfContext } from '../requestGuard';
import { guardStop } from '../runtimeGuard';
import type { RuntimeGuard } from '../runtimeGuard';
import type { ObjectiveAxes } from '../trueErgo';
import type { ItemLookup, PhysicalClassifiers, SolveParams } from '../types';
import { preparePhysicalWeapon } from './blueprint';
import type { PhysicalBlueprint } from './blueprint';
import { computeActiveBounds } from './bounds';
import { columnValuesFromStructured } from './decode';
import type { ColumnValues } from './decode';
import { decodeFast } from './decodeFast';
import { prepareSubproblemDomain } from './domain';
import { PhysicalModelError } from './errors';
import { appendCuts, integerNoGood } from './fastCut';
import type { IntegerNoGood } from './fastCut';
import { PoolWorkerCrashError, acquireNativePool } from '../native/pool';
import type { SolveLanes } from '../native/pool';
import {
  NATIVE_FEASIBILITY_TOLERANCE, PRECISE_PRESOLVE, nativeSolve, nativeSolveOptions, nativeTimeLimitSeconds, solveWithPresolvePolicy,
} from './nativeSolve';
import type { PolicyOutcome, PresolveSetting, SolveFn } from './nativeSolve';
import { PRIORITY_PREFETCH, PRIORITY_SECOND_OPINION, RequestSolves, SolveInterrupted } from './speculativeSolves';
import type { SpeculationStats } from './speculativeSolves';
import { assessNativeResult, boundEvidenceOf } from './nativeProof';
import type { NativeAssessment } from './nativeProof';
import { axesOfStats } from './objective';
import { aprioriScoreBound, exactAxes, exactObjectiveScore, scoreEnclosure, upperBoundExact } from './proof';
import type { BoundEvidence } from './proof';
import { ratCmp, ratFromDouble, ratSub, ratToNumber, type Rat } from './exact';
import { ratAbs, ratRoundUp } from './rational';
import { classifyOptimize, isMoaDependent, observationsOfReason } from './outcome';
import type { OptimizeOutcome } from './outcome';
import { PUBLIC_REASONS, reasonOfNativeLimit } from './reasons';
import { candidateExact, runSpatialSearch, splitInterval, transportedBounds } from './search';
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
  /** The HiGHS model status of the solve that produced this build (`Optimal`, `SolutionLimit`, `TimeLimit`, ...): the floor trace's `nativeStop` (F2). */
  nativeStatus: string;
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
  /** Weight nodes fathomed by the a-priori cap bound without a native call (`aprioriScoreBound`, owner decision 2026-10-18). */
  aprioriFathomedNodes: number;
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
  /** Solves that reached no verdict (`SolveError`, `PresolveError`, `PostsolveError`): each was followed by the next seed while seeds remained. */
  inconclusiveSolves: number;
  /** Solves of a text made after an inconclusive solve of the same text (retries with the following seeds); 0 when nothing was inconclusive. */
  extraSeedSolves: number;
  /** Relaxed-edge first opinions solved only to confirm an integer-text Infeasible verdict ("relaxation must agree"). */
  relaxationChecks: number;
  /** Integer-text Infeasible verdicts the relaxation did NOT confirm (its text had a point, or reached no settled verdict): the node stayed unresolved. */
  relaxationVetoes: number;
  /** Integer-text Infeasible verdicts overturned by a verified build of the relaxed-edge text (a native false Infeasible caught). */
  relaxationRescues: number;
  /** Nodes split on a first opinion alone (decision F1 as extended 2026-10-13: a qualified Optimal whose bound would not fathom the node), all of them. */
  splitOnlyNodes: number;
  /** Of `splitOnlyNodes`, those whose first opinion carried a verified build (the 2026-10-13 extension; 0 under 'f1'). */
  splitWitnessNodes: number;
  /** The largest count model of the search: columns and rows. */
  columns: number;
  rows: number;
  /**
   * On a solve pool (`speculativeSolves.ts`): the lanes used and the early solves started, used and abandoned. Not counted in `nativeSolves`, which is
   * the solves the pipeline read, the same with and without a pool. Absent without a pool.
   */
  pool?: { lanes: number } & SpeculationStats;
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
  /** No verified build and no proof of emptiness. `reason` is the outcome's: a stop or a withheld proof. */
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
  /** Native solve, injectable for tests. An injected `solve` runs without a pool unless `lanes` is given too. */
  solve?: SolveFn;
  /**
   * The solve pool (`native/pool.ts`; `docs/stage3/parallel-pool.md`). Default: the shared pool of the context (`acquireNativePool`) when `solve` is not
   * injected; `null` forces the sequential in-thread path. A pool of one lane is no pool. With a pool the pipeline is unchanged and only starts solves
   * early (`speculativeSolves.ts`), so every result is the one without it.
   */
  lanes?: SolveLanes | null;
  /** On a pool: which second opinions start together with their first opinion (default `PRECISE_SPECULATION`). */
  speculation?: Speculation;
  /** On a pool: how many upcoming nodes get their first solve started early (default `lanes - 2`, at least 0). */
  prefetchNodes?: number;
  /** Presolve of the first solve of every node (default `PRECISE_PRESOLVE`); tests set 'choose' to exercise the confirmation path. */
  presolve?: PresolveSetting;
  /**
   * Native stopping options of THIS call only, layered over `nativeSolveOptions`: a MOA floor query sets `mip_max_improving_sols: 1` to stop at the
   * first improving incumbent (ADR 0013 section 6, scoped to floor calls). Restricted to stopping options, so no caller can loosen a tolerance.
   */
  nativeStop?: Pick<HighsOptions, 'mip_max_improving_sols'>;
  /**
   * End the weight search at the first verified build (the first-witness policy of a MOA floor query): the result is a `build` that is not
   * certified and carries no bound (G1), with the factual reason of the witness's own native stop (F2: `Native solution limit reached` after a
   * native solution limit, `Required proof prerequisite unavailable` after a native Optimal whose second opinion was not run). Only a search with a
   * node still live stops this way.
   */
  stopAtFirstWitness?: boolean;
  /**
   * 'integer': every node solves the integer count model. 'relaxed-first': every node is first solved with the slot-edge counts continuous
   * (`CountModel.lpRelaxedEdges`, a relaxation whose dual bound is still a valid bound) and falls back to the integer model when an edge comes out
   * fractional or the point is rejected; an integral optimum passes the same proof layer and the same second opinion. Default
   * `PRECISE_EDGE_INTEGRALITY` ('relaxed-first', decided by the Phase 2.10 measurement).
   */
  edgeIntegrality?: 'relaxed-first' | 'integer';
  /** The split-only shortcut (`leadsOnlyToSplit`); default `PRECISE_SPLIT_SHORTCUT`. A floor query (`stopAtFirstWitness` or `nativeStop`) always uses 'f1'. */
  splitShortcut?: SplitShortcut;
  /**
   * Opt-in wall-time breakdown (benchmarks only, `benchmarks/phase210m2/bench.ts --timing on`): when set, the stages below add their time to it. It only
   * reads the clock, so a result is the same with or without it; production never sets it.
   */
  timing?: PreciseTiming;
}

/** The opt-in stage timing of one request (`PreciseContext.timing`), milliseconds on the request's clock. The categories are disjoint. */
export interface PreciseTiming {
  /** `specializeCount` per spatial node: the count model, its proof record and its integer LP text. */
  specializeMs: number;
  specializeCalls: number;
  /** Further LP texts: the relaxed-edge text (built once per model) and texts with cuts appended. */
  lpTextMs: number;
  /** Native solves: the whole call, and inside it HiGHS's text read (parse), the run, and the rest (names, readback and solution marshalling). */
  nativeMs: number;
  nativeCalls: number;
  nativeReadMs: number;
  nativeRunMs: number;
  nativeMarshalMs: number;
  /** Decode, independent validation, exact scoring and the bound check of each solved answer (the readback check excluded: `SearchTelemetry.readbackMs`). */
  judgeMs: number;
}

export const emptyPreciseTiming = (): PreciseTiming => ({
  specializeMs: 0, specializeCalls: 0, lpTextMs: 0, nativeMs: 0, nativeCalls: 0, nativeReadMs: 0, nativeRunMs: 0, nativeMarshalMs: 0, judgeMs: 0,
});

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
/** The pure interrupts of ADR 0013 section 6: an observed proof-prerequisite failure outranks them. */
const INTERRUPT_REASONS: ReadonlySet<string> = new Set<string>([
  PUBLIC_REASONS.cancelledByUser, PUBLIC_REASONS.timeLimitReached, PUBLIC_REASONS.nodeLimitReached, PUBLIC_REASONS.nativeSolutionLimitReached,
]);
const boundShortfallLimit = (bound: Rat, tolerance: number): number => Math.max(tolerance, BOUND_SANITY_RELATIVE * Math.max(1, Math.abs(ratToNumber(bound))));
/** Most solver solutions of one node the decoder or validator may reject (each is cut out and the node re-solved) before the node fails. */
export const MAX_REJECTIONS_PER_NODE = 16;
export const DEFAULT_MAX_SPATIAL_NODES = 512;
/**
 * The `random_seed`s of the solves of one node text, in the order they are tried (owner decision 5a and the 2026-10-12 follow-up). The first is HiGHS's
 * default, the second the second opinion, the third the tie-breaker of a disagreement: the first three are the decision-5a seeds, used exactly as before
 * when no solve is inconclusive. The last three are tried only after an INCONCLUSIVE solve (`SolveError`, a solve that reached no verdict: see the
 * header), so that two agreeing qualified verdicts can still be reached. Fixed, distinct and arbitrary (no seed was picked for an outcome), so every run
 * is reproducible.
 *
 * Why six. A node needs at most three qualified opinions (decision 5a), so six seeds leave room for three inconclusive solves among them. On the minimal
 * SolveError reproduction (countGates.nativeDefects.differential.test.ts) about one seed in three is inconclusive (9 of 29 seeds tried); if seeds failed
 * independently at that rate, a node that needs two qualified verdicts would miss them within six seeds with probability about 1.3%
 * (p^6 + 6 p^5 (1 - p) at p = 0.31), against 9% within four, and it then degrades to an unresolved node (no certificate), never to a wrong one or a thrown
 * request. An inconclusive solve stops early, so the extra seeds are cheap, while an unbounded list would let one pathological text eat the whole budget.
 * In the Stage 3 campaigns inconclusive solves were rare (4 of 3,200 seeded worlds, 2 ledger fixtures under the gates' objective directions).
 */
export const PRECISE_RANDOM_SEEDS = [0, 11, 29, 47, 83, 131] as const;
/** The most QUALIFIED opinions one node verdict may take (decision 5a): a first, a second and one tie-breaker. Inconclusive solves do not count. */
export const MAX_QUALIFIED_OPINIONS = 3;
/**
 * The node strategy of production Precise (see `PreciseContext.edgeIntegrality`): relaxed slot edges first. Certificate-safe: the relaxation's dual bound is a
 * valid bound of the integer model, an integral optimum is a point of it, and either passes the same readback, allowances, validator and second opinion.
 * Phase 2.10 measurement (172 pinned guns, 60 s, 14 processes): total wall time 156 s -> 111 s plain and 1,511 s -> 1,050 s TrueErgo; every TrueErgo
 * request certified (4 had stopped at 60 s with integer edges only); 17 of 877 relaxed node solves fell back to the integer model; the same optimum everywhere.
 */
export const PRECISE_EDGE_INTEGRALITY: 'relaxed-first' | 'integer' = 'relaxed-first';
export type SplitShortcut = 'witness' | 'f1';
/**
 * The split-only shortcut of production Precise (see `leadsOnlyToSplit`, `PreciseContext.splitShortcut`). 'witness' (owner, 2026-10-13, amending decision
 * F1): a first opinion with a verified build is split without a second opinion too, when its bound is more than the tolerance above the incumbent and
 * every build of the node. 'f1': the 2026-10-12 rule exactly (no verified build), kept as the measured baseline. Measurement:
 * `docs/stage3/split-shortcut.md`.
 */
export const PRECISE_SPLIT_SHORTCUT: SplitShortcut = 'witness';
/**
 * Which second opinions start on a solve pool together with their first opinion (`PreciseContext.speculation`):
 *   - 'always': every first opinion of a node text (outside a MOA floor query) also starts the next seed; when the first then leads only to a split
 *     (decision F1') or needs no confirmation, that early solve is abandoned unread (CPU spent, no latency);
 *   - 'unsplittable': only where the split-only shortcut cannot apply (an exact node or a request with no weight interval); elsewhere the second seed
 *     starts when the first opinion asks for it, as without a pool;
 *   - 'off': no early second opinions (upcoming nodes may still be prefetched).
 * A MOA floor query (`stopAtFirstWitness` or `nativeStop`) never speculates: its first witness ends the node without a second opinion.
 */
export type Speculation = 'always' | 'unsplittable' | 'off';
export const PRECISE_SPECULATION: Speculation = 'always';

/** Whether a requested tolerance is used as given: a finite, non-negative number. A missing (or null), non-finite or negative value is unset. */
export function isRequestedTolerance(requested: number | null | undefined): requested is number {
  return typeof requested === 'number' && Number.isFinite(requested) && requested >= 0;
}

/** The tolerance as requested; only a missing, non-finite or negative value falls back to the default. */
export function resolveTolerance(requested: number | null | undefined): number {
  return isRequestedTolerance(requested) ? requested : DEFAULT_OBJECTIVE_TOLERANCE;
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
  /** The solve reached no verdict (`SolveError` and kin): no opinion at all; the caller tries the next seed. */
  inconclusive?: boolean;
  /** The solve returned a primal point (feasible within the native tolerances), so its text is not infeasible as far as this solve can tell. */
  point?: boolean;
  /** The HiGHS model status of the solve (absent for a solve that reached no status the judge reads: an Infeasible, a stop before a result). */
  nativeStatus?: string;
}

/**
 * A qualified opinion found a point of its text (G2): an Optimal verdict (always with a point), or a qualified solve of any other status that returned a
 * primal point (a limit stop with a point). Unqualified points prove nothing.
 */
const foundPoint = (o: Opinion): boolean => o.verdict === 'optimal' || (o.point === true && o.evidence !== null && o.evidence.qualified);

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
 * bound of all the solves, the candidate the best verified build of all of them; anything else withholds the certificate AND the bound (G1: an unsettled
 * node carries no bound). Two agreeing Infeasible verdicts settle nothing against a verified build or a qualified point of any opinion (G2). Pure:
 * exported for tests.
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
  if (agreed === 'optimal') return { settled: true, evaluation: { verdict: 'solved', evidence: bound?.evidence ?? null, candidate, exact, ...split } };
  // G2: a found point blocks impossible. A verified build, or a qualified point of any opinion, refutes two Infeasible verdicts.
  if (agreed === 'infeasible' && candidate === null && !opinions.some(foundPoint)) {
    return { settled: true, evaluation: { verdict: 'infeasible', evidence: null, candidate: null, exact } };
  }
  // Nothing agreed (or two Infeasible verdicts against a point): no certificate, and no bound (G1: only a settled verdict carries one). The factual
  // reason is that of the last solve when it proved nothing (a timeout, a limit, an unqualified solve), otherwise the disagreement itself, a proof
  // prerequisite that is unavailable.
  const last = opinions[opinions.length - 1];
  const reason = last.verdict === 'none' && last.reason !== undefined ? last.reason : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable;
  return { settled: false, evaluation: { verdict: 'unresolved', evidence: null, candidate, exact, reason, finished: opinions.every(o => o.finished), ...split } };
}

/** What `leadsOnlyToSplit` needs besides the first opinion. */
export interface SplitShortcutOptions {
  /** The rule (default `PRECISE_SPLIT_SHORTCUT`). */
  mode?: SplitShortcut;
  /** Other verified builds the node's evaluation hands the search with the split (a build kept from the relaxed try): the bound must clear them too. */
  others?: readonly (Candidate<VerifiedBuild> | null)[];
}

/**
 * Decision F1 (owner, 2026-10-12; extended 2026-10-13), pure: does this first opinion lead ONLY to a split of the node's weight range, whatever its bound's
 * exact value? It must be a qualified Optimal of an inexact node with an interval, with no rejected point and a split point.
 *   - 'f1' (the 2026-10-12 rule): no verified build; with an incumbent, a proved bound more than the tolerance above it.
 *   - 'witness' (2026-10-13): the interval can be split at the split point (else the node needs a settled verdict), and the proved bound is more than the
 *     tolerance above the REFERENCE, the best of the incumbent, the opinion's own verified build and `others` (every build the search receives with the
 *     evaluation, which it adds to the incumbent before it splits). With no reference at all (no incumbent, no build) nothing can be fathomed: true.
 * Whenever the bound is within the tolerance of the reference (or unproved while a reference exists) the single solve could close the node, which needs
 * the full decision-5a rule: false. Exported for tests.
 */
export function leadsOnlyToSplit(
  first: Opinion, exact: boolean, node: Pick<SearchNode, 'interval' | 'incumbentExact'>, tolerance: number, options: SplitShortcutOptions = {},
): boolean {
  if (exact || node.interval === null || first.verdict !== 'optimal' || first.rejected !== undefined || first.splitAt === undefined) return false;
  const mode = options.mode ?? PRECISE_SPLIT_SHORTCUT;
  let reference: Rat | null = node.incumbentExact;
  if (mode === 'f1') {
    if (first.candidate !== null) return false;
  } else {
    if (splitInterval(node.interval, first.splitAt) === null) return false;
    for (const witness of [first.candidate, ...(options.others ?? [])]) {
      if (witness === null) continue;
      const score = candidateExact(witness);
      if (reference === null || ratCmp(score, reference) > 0) reference = score;
    }
  }
  if (reference === null) return true;
  const proved = upperBoundExact(first.evidence);
  return proved !== null && ratCmp(ratSub(proved, reference), ratFromDouble(tolerance)) > 0;
}

/** The key of a search node's interval: the early solves and models of a node are filed under it (`speculativeSolves.ts`). */
const tagOf = (interval: SearchInterval | null): string => (interval === null ? 'root' : `${interval.lo}:${interval.hi}`);

export async function solvePrecise(context: PreciseContext): Promise<PreciseResult> {
  const { params } = context;
  const guard = guardOfContext(context);
  const now = guard.now;
  const deadline = guard.deadline;
  const lookup = params.itemLookup;
  const tedRequest = params.useTrueErgo === true || params.preventOverswing === true;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  const telemetry: SearchTelemetry = {
    nativeSolves: 0, presolveRescues: 0, confirmedInfeasible: 0, provedEmptyNodes: 0, aprioriFathomedNodes: 0, rejectedCandidates: 0,
    readbackChecks: 0, unqualifiedSolves: 0, readbackMs: 0, unqualifiedReasons: [], boundShortfall: 0,
    secondOpinions: 0, thirdOpinions: 0, disagreements: 0, unsettledDisagreements: 0, secondOpinionMs: 0,
    relaxedEdgeSolves: 0, relaxedEdgeFallbacks: 0, inconclusiveSolves: 0, extraSeedSolves: 0, relaxationChecks: 0, relaxationVetoes: 0, relaxationRescues: 0,
    splitOnlyNodes: 0, splitWitnessNodes: 0, columns: 0, rows: 0,
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
    const detail = domain.contradictions.map(c => `root required slot ${c.rawSlotId} has no active candidate`).join('; ');
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
  const timing = context.timing;
  // The solve pool: every solve the pipeline reads goes through `requests` (an early answer, or a solve started now on a lane); without a pool (or with
  // one lane) the pipeline calls the in-thread solve directly, exactly as before.
  const lanes = context.lanes !== undefined ? context.lanes : context.solve === undefined ? await acquireNativePool() : null;
  const requests = lanes !== null && lanes.size >= 2 ? new RequestSolves(lanes, guard, context.solve ?? nativeSolve) : null;
  const baseSolve = requests?.solve ?? context.solve ?? nativeSolve;
  const solveFn: SolveFn = timing === undefined ? baseSolve : async (lpText, options, extras) => {
    const started = now();
    const result = await baseSolve(lpText, options, extras);
    const total = now() - started;
    timing.nativeMs += total;
    timing.nativeCalls++;
    const wall = (result as Partial<NativeResult>).wallMs;
    if (wall !== undefined) {
      timing.nativeReadMs += wall.read;
      timing.nativeRunMs += wall.run;
      timing.nativeMarshalMs += total - wall.read - wall.run;
    }
    return result;
  };
  /** Time `body` into `timing[key]` when timing is on. */
  const timed = <T>(key: 'lpTextMs', body: () => T): T => {
    if (timing === undefined) return body();
    const started = now();
    try {
      return body();
    } finally {
      timing[key] += now() - started;
    }
  };
  const relaxEdges = (context.edgeIntegrality ?? PRECISE_EDGE_INTEGRALITY) === 'relaxed-first';
  const optionsOf = (seed: number): HighsOptions => ({ ...nativeSolveOptions(tolerance), ...context.nativeStop, random_seed: seed });

  /** A MOA floor query: its first witness ends a node without a second opinion, so nothing is started early for it. */
  const floorQuery = context.stopAtFirstWitness === true || context.nativeStop !== undefined;
  const speculation: Speculation = requests === null || floorQuery ? 'off' : (context.speculation ?? PRECISE_SPECULATION);
  const prefetchDepth = requests === null || floorQuery ? 0 : Math.max(0, Math.floor(context.prefetchNodes ?? requests.size - 2));
  /** Exactly the options and structured-result requests `solveWithPresolvePolicy` passes for the FIRST solve of a text with this seed (the time limit aside). */
  const earlyStart = (tag: string, lpText: string, seed: number, priority: number): void => {
    const remaining = deadline - now();
    if (requests === null || remaining <= 0) return;
    const options: HighsOptions = { ...optionsOf(seed), presolve: context.presolve ?? PRECISE_PRESOLVE, time_limit: nativeTimeLimitSeconds(remaining) };
    requests.prefetch(tag, lpText, options, { includeReadback: true }, priority);
  };
  /** Should the first opinion of a text of this node start its second seed at once? (See `Speculation`.) */
  const speculateFor = (model: CountModel, node: SearchNode): boolean => {
    if (speculation === 'always') return true;
    if (speculation === 'unsplittable') return model.exact || node.interval === null;
    return false;
  };
  /** Start the first solve of an upcoming node (its relaxed-edge text, or its integer text when it has no slot edge), as `evaluateNative` will ask for it. */
  const prefetchNode = (node: SearchNode, rank: number): void => {
    const tag = tagOf(node.interval);
    let model = prefetchedModels.get(tag);
    if (model === undefined) {
      model = specializeNode(node.interval);
      prefetchedModels.set(tag, model);
    }
    if (model.provedEmpty !== null) return;
    const lpText = relaxEdges && model.edges.length > 0 ? model.lpRelaxedEdges() : model.lp([]);
    earlyStart(tag, lpText, PRECISE_RANDOM_SEEDS[0], PRIORITY_PREFETCH + rank);
  };
  /** The search's lookahead (a pool only): abandon the early solves of nodes no longer live, start those of the next `prefetchDepth` upcoming nodes. */
  const lookahead = requests === null ? undefined : (current: SearchNode, upcoming: readonly SearchNode[]): void => {
    const live = new Set([tagOf(current.interval), ...upcoming.map(n => tagOf(n.interval))]);
    requests.abandonWhere(tag => !live.has(tag));
    for (const tag of [...prefetchedModels.keys()]) if (!live.has(tag)) prefetchedModels.delete(tag);
    upcoming.slice(0, prefetchDepth).forEach((node, rank) => prefetchNode(node, rank));
  };

  /** The model of one node; a request with no TED has one model, built once. */
  let rootModel: CountModel | null = null;
  /** Models of upcoming nodes built early to prefetch their first solve (a pool only), by node tag; taken by `modelOf` (the same deterministic model). */
  const prefetchedModels = new Map<string, CountModel>();
  /** The objective every node's model shares (the one its builds are scored with), from the first model built: what the a-priori bound reads. */
  let objective: CountModel['objective'] | null = null;
  const specializeNode = (interval: SearchInterval | null): CountModel => {
    const model = interval === null
      ? (rootModel ??= specializeCount(blueprint, domain, params))
      : specializeCount(blueprint, domain, params, { weightMin: interval.lo, weightMax: interval.hi });
    objective ??= model.objective;
    return model;
  };
  const modelOf = (interval: SearchInterval | null): CountModel => {
    const started = timing === undefined ? 0 : now();
    const calls = timing === undefined || (interval === null && rootModel !== null) ? 0 : 1;
    const early = prefetchedModels.get(tagOf(interval));
    if (early !== undefined) prefetchedModels.delete(tagOf(interval));
    const model = early ?? specializeNode(interval);
    telemetry.columns = Math.max(telemetry.columns, model.stats.columns);
    telemetry.rows = Math.max(telemetry.rows, model.stats.rows);
    if (timing !== undefined) {
      timing.specializeMs += now() - started;
      timing.specializeCalls += calls;
    }
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
    const point = result.colValues !== null;
    const none = (extra: Partial<Opinion> = {}): Opinion => ({ verdict: 'none', evidence, candidate: null, reason: stopReason, finished, point, ...extra });
    if (result.colValues === null) return none();
    // A relaxed-edge solve whose edges are not integral is no point of the integer model: its bound is still valid (a relaxation), its point is not judged.
    if (relaxed && model.edges.some(edge => {
      const j = result.colIndexByName.get(edge.column);
      const v = j === undefined ? Number.NaN : (result.colValues as Float64Array)[j];
      return !(Math.abs(v - Math.round(v)) <= NATIVE_FEASIBILITY_TOLERANCE);
    })) {
      return qualifiedOptimal ? { verdict: 'optimal', evidence, candidate: null, finished, point } : none();
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
          payload: { build: decoded.build, stats, axes, score: enclosure.nominal, scoreLower: enclosure.lower, scoreUpper: enclosure.upper, nativeStatus: status },
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
        if (qualifiedOptimal) return { verdict: 'optimal', evidence, candidate, splitAt: stats.weight, finished, point };
        return none({ candidate, splitAt: stats.weight });
      }
      // The weight penalty of an inexact node is a lower envelope of q, so its optimum may be overswinging exactly: the relaxation is a valid
      // upper bound, the build is not a candidate, and the node is refined at that weight.
      const relaxationOnly = !model.exact && stats !== null && validation.violations.length > 0
        && validation.violations.every(v => v.code === 'OVERSWING_PREVENTED');
      if (relaxationOnly && stats !== null) {
        if (qualifiedOptimal) return { verdict: 'optimal', evidence, candidate: null, splitAt: stats.weight, finished, point };
        return none({ splitAt: stats.weight, finished: false });
      }
    }
    // Any other rejection is a boundary the solver's tolerance admitted and exact arithmetic does not (or a fault): the first solve of a node cuts
    // the point out and solves again; a later opinion keeps only its bound.
    return { verdict: qualifiedOptimal ? 'optimal' : 'none', evidence, candidate: null, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished, rejected: values, point };
  };

  /** One native solve of a node's text with a given seed, judged. Never cuts. */
  const opinionOf = async (model: CountModel, lpText: string, seed: number, relaxed: boolean): Promise<Opinion> => {
    telemetry.nativeSolves++;
    let outcome: PolicyOutcome;
    try {
      outcome = await solveWithPresolvePolicy(lpText, {
        options: optionsOf(seed), deadline, now, solve: solveFn, presolve: context.presolve, includeReadback: true,
      });
    } catch (error) {
      // A pool worker that crashed twice on this solve: an INCONCLUSIVE solve, the next seed is tried (retry seeds, never throw; `native/pool.ts`).
      if (error instanceof PoolWorkerCrashError) {
        telemetry.inconclusiveSolves++;
        return { verdict: 'none', evidence: null, candidate: null, finished: false, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, inconclusive: true };
      }
      // A pool solve interrupted by a cancel or the deadline backstop (`speculativeSolves.ts`): no verdict, the pure interrupt as the reason.
      if (!(error instanceof SolveInterrupted)) throw error;
      return { verdict: 'none', evidence: null, candidate: null, finished: false, reason: error.stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached };
    }
    if (outcome.kind === 'unresolved') {
      if (outcome.cause === 'inconclusive') {
        telemetry.inconclusiveSolves++;
        return { verdict: 'none', evidence: null, candidate: null, finished: false, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, inconclusive: true };
      }
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
    if (timing === undefined) return { ...judge(model, lpText, outcome.result, relaxed), nativeStatus: outcome.result.modelStatus.name };
    const started = now();
    const readbackBefore = telemetry.readbackMs;
    const judged = judge(model, lpText, outcome.result, relaxed);
    timing.judgeMs += now() - started - (telemetry.readbackMs - readbackBefore);
    return { ...judged, nativeStatus: outcome.result.modelStatus.name };
  };

  /**
   * The first opinion of a text: seed after seed of `PRECISE_RANDOM_SEEDS` until a solve is not inconclusive (owner, 2026-10-12: retry seeds, never
   * throw). `next` is the index of the first seed not yet used, where the second opinion starts. When every seed is inconclusive the last (inconclusive)
   * opinion is returned: it proves nothing and its reason is `Required proof prerequisite unavailable`.
   */
  const firstOpinion = async (model: CountModel, lpText: string, relaxed: boolean, node: SearchNode): Promise<{ opinion: Opinion; next: number }> => {
    // On a pool, the seed the second opinion would start from runs at the same time as this one (`Speculation`); it is read only if `confirm` asks.
    const speculate = speculateFor(model, node);
    for (let i = 0; ; i++) {
      if (i > 0) telemetry.extraSeedSolves++;
      // The solve read now is queued first (it reaches `solve` synchronously), so the early one never takes the lane it needs.
      const pending = opinionOf(model, lpText, PRECISE_RANDOM_SEEDS[i], relaxed);
      if (speculate && i + 1 < PRECISE_RANDOM_SEEDS.length) earlyStart(tagOf(node.interval), lpText, PRECISE_RANDOM_SEEDS[i + 1], PRIORITY_SECOND_OPINION);
      const opinion = await pending;
      if (opinion.inconclusive !== true || i + 1 >= PRECISE_RANDOM_SEEDS.length) return { opinion, next: i + 1 };
    }
  };

  /**
   * The second opinion of a certificate-bearing first verdict (decision 5a, see the header): the next seed on the same text, one more on a disagreement
   * (at most `MAX_QUALIFIED_OPINIONS` qualified opinions), then `settleOpinions`. An inconclusive solve is no opinion: it is skipped and the next seed is
   * tried while seeds remain. Seeds that run out before two verdicts agree withhold the certificate (`Required proof prerequisite unavailable`).
   */
  const confirm = async (model: CountModel, lpText: string, first: Opinion, relaxed: boolean, next: number): Promise<NodeEvaluation<VerifiedBuild>> => {
    // The first-witness policy of a MOA floor query takes the first verified build and stops: no certificate is asked of it, so no second opinion is
    // spent on it (ADR 0013 section 6), and its single solve gives the node no bound (G1). Its reason is the solve's real native stop (F2): a native
    // limit's own reason, or, for a native Optimal, the withheld certificate (the second opinion was not run). An infeasibility verdict of a floor query
    // is still confirmed: it is what raises the proved lower bound.
    if (context.stopAtFirstWitness === true && first.candidate !== null) {
      const status = first.nativeStatus ?? first.candidate.payload.nativeStatus;
      return {
        verdict: 'unresolved', evidence: null, candidate: first.candidate, exact: model.exact,
        reason: status === 'Optimal' ? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable : reasonOfNativeLimit(status),
        finished: first.finished, ...(first.splitAt === undefined ? {} : { splitAt: first.splitAt }),
      };
    }
    const started = now();
    const opinions: Opinion[] = [first];
    telemetry.secondOpinions++;
    let skipped = next - 1;
    let lastInconclusive = false;
    for (let i = next; i < PRECISE_RANDOM_SEEDS.length; i++) {
      if (skipped > 0) telemetry.extraSeedSolves++;
      const opinion = await opinionOf(model, lpText, PRECISE_RANDOM_SEEDS[i], relaxed);
      lastInconclusive = opinion.inconclusive === true;
      if (lastInconclusive) {
        skipped++;
        continue;
      }
      if (opinions.length === 2) telemetry.thirdOpinions++;
      opinions.push(opinion);
      // A solve that proved nothing (a timeout, a limit, an unqualified solve) settles nothing and is not retried: the certificate is withheld.
      if (opinion.verdict === 'none') break;
      if (opinions.slice(0, -1).some(earlier => opinionsAgree(earlier, opinion, tolerance))) break;
      if (opinions.length >= MAX_QUALIFIED_OPINIONS) break;
      telemetry.disagreements++;
    }
    telemetry.secondOpinionMs += now() - started;
    const { evaluation, settled } = settleOpinions(opinions, tolerance, model.exact);
    if (!settled && opinions.length >= MAX_QUALIFIED_OPINIONS && opinions.every(o => o.verdict !== 'none')) telemetry.unsettledDisagreements++;
    // Seeds that ran out on inconclusive solves: the second opinion never finished.
    if (!settled && lastInconclusive) return { ...evaluation, finished: false };
    return evaluation;
  };

  /** A first opinion that bears no certificate, as the node's evaluation: its verified build is kept, its single-solve bound is not (G1). */
  const unconfirmed = (model: CountModel, opinion: Opinion): NodeEvaluation<VerifiedBuild> => ({
    verdict: 'unresolved',
    evidence: null,
    candidate: opinion.candidate,
    exact: model.exact,
    reason: opinion.reason ?? PUBLIC_REASONS.requiredProofPrerequisiteUnavailable,
    finished: opinion.finished,
    ...(opinion.splitAt === undefined ? {} : { splitAt: opinion.splitAt }),
  });
  /** A rejected point that cannot be cut out: the node fails, and the rejected solve's dual bound is not kept (G1). */
  const failed = (model: CountModel, opinion: Opinion): NodeEvaluation<VerifiedBuild> => ({
    verdict: 'failed', evidence: null, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.independentBuildValidationFailed, finished: opinion.finished,
  });
  /** The interrupt a guard reports, as an unresolved evaluation. */
  const interrupted = (model: CountModel, stop: 'cancelled' | 'deadline'): NodeEvaluation<VerifiedBuild> => ({
    verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached,
  });

  /**
   * "Relaxation must agree" (owner, 2026-10-12; see the header). `integerInfeasible` is the settled Infeasible evaluation of the INTEGER text of a node with
   * `cuts`; the node is infeasible only when the relaxed-edge text with the same cuts is settled Infeasible too. `knownPoint`: the relaxed text with these
   * cuts was already solved in this node without settling Infeasible, or a verified build of the node exists, so the relaxation cannot agree and no solve
   * is spent. Whatever single solve the node then rests on gives it no bound (G1). `node`: the search node, for the split-only shortcut (decision F1).
   */
  const relaxationAgrees = async (
    model: CountModel, cuts: readonly IntegerNoGood[], integerInfeasible: NodeEvaluation<VerifiedBuild>, knownPoint: boolean, node: SearchNode,
  ): Promise<NodeEvaluation<VerifiedBuild>> => {
    // A model with no slot edge: its relaxed-edge text IS its integer text, so the settled verdict already is the relaxation's.
    if (model.edges.length === 0) return integerInfeasible;
    if (knownPoint) {
      telemetry.relaxationVetoes++;
      // Both native searches of an exact node ran to completion; only the infeasibility is withheld. An inexact node still needs refining.
      return { verdict: 'unresolved', evidence: null, candidate: null, exact: model.exact, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished: model.exact };
    }
    telemetry.relaxationChecks++;
    const lpText = timed('lpTextMs', () => appendCuts(model.lpRelaxedEdges(), cuts));
    const { opinion: first, next } = await firstOpinion(model, lpText, true, node);
    if (first.verdict === 'infeasible') {
      const evaluation = await confirm(model, lpText, first, true, next);
      if (evaluation.verdict !== 'infeasible') {
        telemetry.relaxationVetoes++;
        if (evaluation.candidate !== null) telemetry.relaxationRescues++;
      }
      return evaluation;
    }
    if (first.verdict === 'optimal' && first.rejected === undefined && (first.candidate !== null || first.splitAt !== undefined)) {
      // An integral relaxed optimum is a point of the integer text: its Infeasible verdict was false. The point is settled like any relaxed optimum, or
      // only splits the node (decision F1).
      telemetry.relaxationRescues++;
      return splitOnly(model, first, node) ?? confirm(model, lpText, first, true, next);
    }
    telemetry.relaxationVetoes++;
    if (first.candidate !== null) telemetry.relaxationRescues++;
    // A fractional or rejected relaxed point, no verdict, or a stop: the node is not infeasible, and it is not settled either.
    const interrupt = first.verdict === 'none' && first.reason !== undefined && INTERRUPT_REASONS.has(first.reason);
    return {
      verdict: 'unresolved', evidence: null, candidate: first.candidate, exact: model.exact,
      reason: interrupt ? (first.reason as string) : PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished: first.finished,
      ...(first.splitAt === undefined ? {} : { splitAt: first.splitAt }),
    };
  };

  /** The rule of this call: a MOA floor query keeps the 2026-10-12 rule (its first-witness policy and solution limit are unchanged). */
  const shortcutMode: SplitShortcut = context.stopAtFirstWitness === true || context.nativeStop !== undefined ? 'f1' : (context.splitShortcut ?? PRECISE_SPLIT_SHORTCUT);
  /**
   * Decision F1 (extended 2026-10-13): the first opinion leads only to a split of the weight range (`leadsOnlyToSplit`: its bound would not fathom the node
   * against the incumbent, its own build and `others`, so the search would split it whatever the second opinion said). Then the node is split without a
   * second opinion and without a bound: the `split` evaluation, carrying the opinion's verified build as a witness. `null` when the full rule applies.
   */
  const splitOnly = (model: CountModel, first: Opinion, node: SearchNode, others: readonly (Candidate<VerifiedBuild> | null)[] = []): NodeEvaluation<VerifiedBuild> | null => {
    if (!leadsOnlyToSplit(first, model.exact, node, tolerance, { mode: shortcutMode, others }) || first.splitAt === undefined) return null;
    telemetry.splitOnlyNodes++;
    if (first.candidate !== null) telemetry.splitWitnessNodes++;
    return { verdict: 'split', evidence: null, candidate: first.candidate, exact: false, splitAt: first.splitAt };
  };

  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<VerifiedBuild>> => {
    const model = modelOf(node.interval);
    if (model.provedEmpty !== null) {
      telemetry.provedEmptyNodes++;
      return { verdict: 'infeasible', evidence: null, candidate: null, exact: true };
    }
    let evaluation: NodeEvaluation<VerifiedBuild>;
    try {
      evaluation = await evaluateNative(model, node);
    } finally {
      // The node is evaluated: an early solve of its texts that was not read never will be (a text belongs to one node).
      requests?.abandonWhere(tag => tag === tagOf(node.interval));
    }
    if (evaluation.verdict === 'infeasible') telemetry.confirmedInfeasible++;
    // G1, the one place it is enforced: only a SETTLED verdict carries a bound into the search (and so into a published upper bound or gap). An
    // unresolved, failed or split node keeps the bound it inherited from a settled parent (unknown at a root).
    if (evaluation.verdict !== 'solved' && evaluation.evidence !== null) return { ...evaluation, evidence: null };
    return evaluation;
  };

  const evaluateNative = async (model: CountModel, node: SearchNode): Promise<NodeEvaluation<VerifiedBuild>> => {
    // Relaxed slot edges first: an integral optimum of the relaxation is an optimum of the integer model, judged and confirmed exactly as one, and an
    // infeasible relaxation leaves the integer model nothing either. Anything else falls back to the integer model of the node.
    let relaxedRejection: Opinion | null = null;
    /**
     * What the relaxed first try observed that must survive the fallback (defect D1, ADR 0013 section 6): a verified build of the node, or a factual
     * reason that is not an interrupt (an observed proof-prerequisite failure outranks a coincident interrupt).
     */
    let kept: Opinion | null = null;
    /**
     * The relaxed-edge text WITHOUT cuts was solved and did not settle Infeasible (it had a point, or no verdict): an Infeasible verdict of the uncut
     * integer text cannot be confirmed by it, and solving the same text with the same seeds again would only repeat the answer.
     */
    let relaxedUncut = false;
    if (relaxEdges && model.edges.length > 0) {
      const lpText = timed('lpTextMs', () => model.lpRelaxedEdges());
      telemetry.relaxedEdgeSolves++;
      const { opinion: first, next } = await firstOpinion(model, lpText, true, node);
      if (first.verdict === 'infeasible') return confirm(model, lpText, first, true, next);
      if (first.verdict === 'optimal' && first.rejected === undefined && (first.candidate !== null || first.splitAt !== undefined)) {
        return splitOnly(model, first, node) ?? confirm(model, lpText, first, true, next);
      }
      if (first.verdict === 'none' && first.reason === PUBLIC_REASONS.timeLimitReached && first.evidence === null) return unconfirmed(model, first);
      telemetry.relaxedEdgeFallbacks++;
      relaxedUncut = true;
      if (first.rejected !== undefined) relaxedRejection = first;
      else if (first.candidate !== null || (first.reason !== undefined && !INTERRUPT_REASONS.has(first.reason))) kept = first;
      // The integer re-solve is a stage of its own: yield so a cancel message is dispatched, then guard. What the relaxed solve observed outranks the
      // coincident interrupt (section 6): a rejected point (a validation failure), or a verified build and a withheld proof (D1: the build is kept and the
      // status follows it); the integer model was never solved (unfinished).
      await guard.yieldMacrotask();
      const stop = guardStop(guard);
      if (stop !== null) {
        if (relaxedRejection !== null) return { ...failed(model, relaxedRejection), finished: false };
        if (kept !== null) return { ...unconfirmed(model, kept), finished: false };
        return interrupted(model, stop);
      }
    }

    /** The integer model's evaluation, with what the relaxed try kept: the better verified build, and its observed prerequisite failure over an interrupt. */
    const withKept = (evaluation: NodeEvaluation<VerifiedBuild>): NodeEvaluation<VerifiedBuild> => {
      if (kept === null || evaluation.verdict === 'infeasible') return evaluation;
      const candidate = betterCandidate(evaluation.candidate, kept.candidate);
      const overrides = evaluation.verdict === 'unresolved' && kept.reason === PUBLIC_REASONS.requiredProofPrerequisiteUnavailable
        && (evaluation.reason === undefined || INTERRUPT_REASONS.has(evaluation.reason));
      return {
        ...evaluation,
        candidate,
        ...(overrides ? { reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable } : {}),
        ...(evaluation.splitAt === undefined && candidate !== null ? { splitAt: candidate.payload.stats.weight } : {}),
      };
    };

    const cuts: IntegerNoGood[] = [];
    for (;;) {
      if (cuts.length > 0) {
        // A re-solve after a rejected candidate is a stage of its own: yield so a cancel message is dispatched, then guard.
        await guard.yieldMacrotask();
        const stop = guardStop(guard);
        if (stop !== null) return withKept(interrupted(model, stop));
      }
      const lpText = timed('lpTextMs', () => model.lp(cuts));
      const { opinion: first, next } = await firstOpinion(model, lpText, false, node);
      if (first.rejected !== undefined) {
        // The rejected point is cut out and the node solved again, so the valid builds beside it are still found; only a repeated rejection
        // (or no time to try again) fails the node.
        const trusted = first.evidence?.qualified === true;
        const cut = trusted && cuts.length < MAX_REJECTIONS_PER_NODE && deadline - now() > 0 ? integerNoGood(`nogood_${cuts.length}`, model.decision, first.rejected) : null;
        if (cut === null) return withKept(failed(model, first));
        telemetry.rejectedCandidates++;
        cuts.push(cut);
        continue;
      }
      if (first.verdict === 'none' && first.reason === PUBLIC_REASONS.independentBuildValidationFailed) return withKept(failed(model, first));
      if (first.verdict === 'none') return withKept(unconfirmed(model, first));
      const split = splitOnly(model, first, node, [kept?.candidate ?? null]);
      if (split !== null) return withKept(split);
      const evaluation = await confirm(model, lpText, first, false, next);
      if (evaluation.verdict !== 'infeasible') return withKept(evaluation);
      // A settled Infeasible of the INTEGER text: only the relaxation can make it the node's verdict. A verified build of the node (kept from the relaxed
      // try; cuts only ever remove rejected points) refutes the agreement, and so does the uncut relaxed text that was already solved without settling
      // Infeasible (production's relaxed-first try: its point, or its lack of a verdict, would only be repeated).
      const knownPoint = kept?.candidate != null || (cuts.length === 0 && relaxedUncut);
      return withKept(await relaxationAgrees(model, cuts, evaluation, knownPoint, node));
    }
  };

  let roots: (SearchInterval | null)[] = [null];
  if (tedRequest) {
    const weight = computeActiveBounds(blueprint, domain).weight;
    roots = rootIntervals(weight.lo, weight.hi, params.maxWeight);
  }
  const maxNodes = tedRequest ? Math.max(0, Math.floor(params.maxSpatialNodes ?? DEFAULT_MAX_SPATIAL_NODES)) : Number.POSITIVE_INFINITY;
  let search: Awaited<ReturnType<typeof runSpatialSearch<VerifiedBuild>>>;
  try {
    search = await runSpatialSearch<VerifiedBuild>({
      roots, evaluate, tolerance, maxNodes, now, deadline, guard, stopAtFirstWitness: context.stopAtFirstWitness, ...(lookahead === undefined ? {} : { lookahead }),
      aprioriBound: interval => (objective === null ? null : aprioriScoreBound(objective.weights, objective.tchebycheff?.ideal ?? null, useTrueErgo, interval)),
    });
  } finally {
    // Nothing started early outlives the request: queued early solves are dropped and running ones' workers replaced.
    requests?.abandonAll();
    if (requests !== null) telemetry.pool = { lanes: requests.size, ...requests.stats };
  }
  telemetry.aprioriFathomedNodes = search.aprioriFathomed;
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
