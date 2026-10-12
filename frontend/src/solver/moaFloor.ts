/**
 * The provisional MOA floor (ADR 0013 section 6 "MOA floor", ADR 0004 section 6, ADR 0006): the smallest MOA cap under which the request still has a
 * build, as a BRACKET on the minimum of the provisional model, never a game-physical minimum.
 *
 * Every query (the seed and each cap trial) is a Precise solve with a constant-zero weighted objective, every caller hard and acquisition
 * constraint (budget included) and only the searched MOA cap changed. A query ends at the first independently validated full witness:
 * `solvePrecise` is called with the scoped native option `mip_max_improving_sols = 1` and the shared request deadline, and the witness is a build
 * the independent validator accepted (a native candidate that failed validation is never a witness). Nothing cheaper or nicer is sought.
 *
 *   seed (no cap, not a trial)   supplies an achievable `hi` only. No witness: `unresolved`, or `model_infeasible` after a QUALIFIED Precise
 *                                emptiness of the seed.
 *   discovery (no `lo` yet)      d = max(1 MOA, |hi| / 2), probe t = hi - d, double d after each verified feasible probe; `hi` drops to the
 *                                smaller independently enclosed ACHIEVED MOA (never to the trial number t). A qualified Precise emptiness at t
 *                                sets `lo = t` and switches to bisection.
 *   bisection (`lo` known)       probe t = lo + (hi - lo) / 2. A witness lowers `hi` only, a qualified emptiness raises `lo` only.
 *
 * At most 14 threshold trials in all. Only a qualified emptiness raises `lo` and only a validated achieved upper enclosure lowers `hi`. The search
 * stops (keeping the best witness and the proved `lo`) on a nonfinite, nondecreasing or stalled threshold, on a witness that does not improve `hi`,
 * on unqualified or unresolved emptiness or a withheld prerequisite, and on the deadline or a cancel (checked before each trial and again after a
 * macrotask yield). A native solution-limit stop and a native `Optimal` completion are distinct but both yield a witness; neither a solution limit,
 * a time limit nor a missing witness ever raises `lo`. Zero and negative caps are real caps (absence is `null`, never falsiness).
 *
 * Qualification of an infeasibility. A trial is empty-and-qualified exactly when the Precise pipeline reports `kind: 'empty'` with a completed
 * search and the provisional-model emptiness outcome (`Provisional MOA model infeasible`, resolved Precise, termination `optimal`). The pipeline
 * reports that kind only for an emptiness the model text proves outright or a native Infeasible verdict whose deciding solve was verified against
 * the emitted text (parsed model equal, allowances dominating, declared tolerances, presolve off): `solvePrecise.ts` and `nativeProof.ts`. An
 * unqualified verdict, a limit, a missing witness or a rejected candidate is never emptiness.
 *
 * Status. `model_proved` needs a full witness and an outward-proved finite bracket `hi - lo <= 0.02` (the exact difference of the two doubles); a
 * retained witness otherwise is `model_witnessed` ("best witnessed MOA, minimum not proved"); no witness is `unresolved`. A completed bracket proof is
 * checked before any stop, so it survives a late cancel. `floor` is the achieved raw `hi`; `display_floor` is an outward 2-decimal ceiling, withheld
 * (`null`) when it is not finite or not at least `hi`, the raw witness staying the truth.
 */

import type { ItemDetail, MOAFloorResponse, PresetDetail, WitnessBuild, WitnessScope } from '../api/client';
import { itemDetails, presetDetail } from './buildDetails';
import { resolveMarket } from './physical/acquisition';
import { rat, ratFromDouble, ratGt, ratLe, ratSub } from './physical/exact';
import { inspectOwnedItems } from './physical/ownedItems';
import { outwardGridCeil, outwardSafeCeil, submissionIsSafe } from './physical/display';
import { ratFromString, ratRoundUp } from './physical/rational';
import { PUBLIC_REASONS } from './physical/reasons';
import type { SolveFn } from './physical/nativeSolve';
import { partGraphRefusal, solvePrecise } from './physical/solvePrecise';
import type { PreciseResult } from './physical/solvePrecise';
import { SolverError } from './native/errors';
import { floorEnvelope } from './operationEnvelopes';
import { completionOf, extendCompletion } from './runtimeErrors';
import { guardStop } from './runtimeGuard';
import type { RuntimeGuard } from './runtimeGuard';
import type { PrecisionRequest, SolveParams } from './types';
import { DEFAULT_FLOOR_TIME_LIMIT_MS } from './workerProtocol';

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Default shared request budget of a floor operation, queue time included (the worker stamps the deadline). */
export const MOA_FLOOR_DEFAULT_TIME_LIMIT_MS = DEFAULT_FLOOR_TIME_LIMIT_MS;
/** Threshold trials across discovery and bisection; the seed is not a trial. */
export const MOA_FLOOR_MAX_TRIALS = 14;
/** The bracket width at which the minimum counts as proved: `hi - lo <= 0.02` MOA. */
export const MOA_FLOOR_BRACKET_TOLERANCE = 0.02;
/** The first discovery step is at least this many MOA. */
export const MOA_FLOOR_MIN_DISCOVERY_STEP = 1;
/** The native stop of a floor query: the first improving incumbent. Scoped to floor calls (`PreciseContext.nativeStop`), never to other operations. */
export const MOA_FLOOR_NATIVE_STOP = Object.freeze({ mip_max_improving_sols: 1 });
/** Decimals of `display_floor`: the MOA control moves in 0.01 steps. */
export const MOA_FLOOR_DISPLAY_DECIMALS = 2;

const TOLERANCE = rat(1n, 50n);

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/**
 * The normalized Optimize-domain request minus the MOA cap being searched. The objective fields, `useTrueErgo`, Tchebycheff data and the precision
 * flags are overridden by the floor (a constant-zero objective on the Precise model); everything else is the caller's hard and acquisition domain.
 * `ownedItems` is expected to be validated by the operation layer; it is checked again here and an invalid list resolves nothing.
 */
export type MoaFloorRequest = Omit<SolveParams, 'maxMOA'>;

/** How a native solve of a witness-yielding query ended: it finished (`optimal`), hit the solution limit, or ended some other way (a clock, a withheld proof). */
export type FloorNativeStop = 'optimal' | 'solution_limit' | 'other';

/** A verified full build of one query, with its independently enclosed achieved MOA. */
export interface FloorWitness {
  /** The exact MOA of the build as the validator computed it (a canonical rational string). */
  moaExact: string;
  /** The smallest double at least `moaExact`: the achieved upper enclosure. */
  achievedMoa: number;
  build: WitnessBuild;
  nativeStop: FloorNativeStop;
}

/** What one seed or cap query established. */
export type FloorQueryResult =
  /** A verified full witness satisfying the exact hard constraints (and the cap, for a trial). */
  | { kind: 'witness'; witness: FloorWitness }
  /** The query has no build. `qualified`: a QUALIFIED Precise emptiness (see the header); anything else is not emptiness. */
  | { kind: 'empty'; qualified: boolean; reason?: string }
  /** No witness and no emptiness: a clock, a cancel, a limit, a withheld prerequisite or a rejected build. `reason` is a public reason. */
  | { kind: 'stopped'; reason: string };

/** One query: `cap` is the MOA cap of a trial, `null` for the seed. Injectable so the search is tested without a native build. */
export type FloorQuery = (cap: number | null, guard: RuntimeGuard) => Promise<FloorQueryResult>;

export interface MoaFloorDeps {
  /** Default: the Precise pipeline on the request (`preciseFloorQuery`). */
  query?: FloorQuery;
  /** The native solve of the default query (injectable to record what the pinned build is asked, `solvePrecise`'s `solve`). Ignored with a custom `query`. */
  solve?: SolveFn;
  /**
   * Called with the retained floor state just before a typed native failure (`SolverError`) is rethrown, so the client can show it. The same
   * snapshot travels on the error: `completionOf(error).floor`.
   */
  publishSnapshot?: (snapshot: MOAFloorResponse) => void;
}

export type FloorEnd =
  /** The bracket is within the tolerance. */
  | 'proved'
  | 'model_infeasible'
  | 'trial_cap'
  | 'cancelled'
  | 'deadline'
  /** A nonfinite, nondecreasing or stalled threshold, or an overflow. */
  | 'threshold'
  /** A returned witness did not improve `hi` (or contradicted the proved `lo`). */
  | 'no_progress'
  /** A query ended without a witness or an emptiness. */
  | 'query_stopped'
  /** A query's emptiness was not qualified. */
  | 'unqualified_empty'
  | 'invalid_input';

export interface FloorTraceEntry {
  step: 'seed' | 'discovery' | 'bisection';
  /** 1-based trial number; `null` for the seed. */
  trial: number | null;
  cap: number | null;
  /** What the caller asked for and what ran: a floor query always resolves Precise. */
  precision_request: PrecisionRequest;
  precision_resolved: 'precise';
  result: 'witness' | 'empty' | 'unqualified_empty' | 'stopped';
  /** The independently enclosed achieved MOA of a witness. */
  achieved_moa?: number;
  nativeStop?: FloorNativeStop;
  reason?: string;
  elapsed_ms: number;
}

export interface MoaFloorRun {
  response: MOAFloorResponse;
  trace: FloorTraceEntry[];
  /** Threshold trials made (the seed is not counted). */
  trials: number;
  ended: FloorEnd;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/**
 * The displayed floor: the smallest 2-decimal value that parses to a double at least `hi`, or `null` (withheld) when `hi` is not finite or too large
 * to carry the places, or when the result is not a finite value at least `hi`. A cap submitted on an offset grid whose origin is this value is
 * the value itself (`outwardGridCeil` of a witness at most the origin), so it never falls below `hi` either.
 */
export function displayFloorOf(hi: number): number | null {
  const display = outwardSafeCeil(hi, MOA_FLOOR_DISPLAY_DECIMALS);
  if (display === null || !submissionIsSafe(display, hi)) return null;
  const submitted = outwardGridCeil(hi, display, 1 / 10 ** MOA_FLOOR_DISPLAY_DECIMALS);
  return submitted !== null && submissionIsSafe(submitted, hi) ? display : null;
}

/** Is the bracket `[lo, hi]` proved to be within the tolerance? Decided on the exact difference of the two doubles. */
export function bracketWithinTolerance(lo: number, hi: number): boolean {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return ratLe(ratSub(ratFromDouble(hi), ratFromDouble(lo)), TOLERANCE);
}

const stopReasonOf = (cause: 'cancelled' | 'deadline'): string => (cause === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached);

/** A validation or proof-prerequisite failure outranks a coincident clock event; pure interrupts go cancel first (ADR 0013 section 6). */
function reconcileReason(reason: string, guard: RuntimeGuard): string {
  if (reason === PUBLIC_REASONS.independentBuildValidationFailed || reason === PUBLIC_REASONS.requiredProofPrerequisiteUnavailable) return reason;
  return guard.cancelled() ? PUBLIC_REASONS.cancelledByUser : reason;
}

// ---------------------------------------------------------------------------------------------
// The default query: the Precise pipeline
// ---------------------------------------------------------------------------------------------

/** The solve parameters of one floor query: a constant-zero objective on the Precise model, the caller's hard and acquisition domain, the cap. */
export function floorQueryParams(request: MoaFloorRequest, cap: number | null): SolveParams {
  // Dropped from the caller's request: a stray `maxMOA` (the cap is the searched variable), and the clock (`guard`, `timeLimitMs`: the query's guard
  // is passed to `solvePrecise` directly).
  const { maxMOA: _stray, timeLimitMs: _limit, guard: _guard, ...rest } = request as SolveParams;
  void _stray; void _limit; void _guard;
  return {
    ...rest,
    maxMOA: cap,
    ergoWeight: 0,
    recoilWeight: 0,
    priceWeight: 0,
    // TrueErgo only shapes the objective, which is constant zero here; Prevent Overswing stays a hard constraint (it is not an objective term).
    useTrueErgo: false,
    useTchebycheff: false,
    idealPoint: undefined,
    preciseMode: true,
    precisionRequest: request.precisionRequest ?? 'precise',
  };
}

/** The complete normalized scope a witness was found under (ADR 0013 section 5): the acquisition, feasibility, inventory and model of the query. */
export function witnessScopeOf(request: MoaFloorRequest, cap: number | null): WitnessScope {
  const market = resolveMarket(request);
  const copyGroups = (groups: string[][] | null | undefined): string[][] | null => (groups == null ? null : groups.map(g => [...g]));
  const owned = inspectOwnedItems(request.ownedItems);
  return {
    weapon_id: request.weaponId,
    precision_resolved: 'precise',
    model_qualification: 'exact',
    moa_qualification: 'provisional_model',
    max_moa: cap,
    acquisition: {
      trader_levels: request.traderLevels == null ? null : { ...request.traderLevels },
      flea_available: market.fleaAvailable,
      barter_available: market.barterAvailable,
      barter_exclude_dogtags: market.barterExcludeDogtags,
      player_level: market.playerLevel,
    },
    feasibility: {
      max_price: request.maxPrice ?? null,
      min_ergonomics: request.minErgonomics ?? null,
      max_recoil_v: request.maxRecoilV ?? null,
      max_recoil_sum: request.maxRecoilSum ?? null,
      min_mag_capacity: request.minMagCapacity ?? null,
      min_sighting_range: request.minSightingRange ?? null,
      max_weight: request.maxWeight ?? null,
      include_items: request.includeItems == null ? null : [...request.includeItems],
      exclude_items: request.excludeItems == null ? null : [...request.excludeItems],
      include_categories: copyGroups(request.includeCategories),
      exclude_categories: request.excludeCategories == null ? null : [...request.excludeCategories],
      prevent_overswing: request.preventOverswing === true,
      equip_ergo_modifier: request.equipErgoModifier ?? null,
    },
    inventory: { owned_items: owned.ok ? [...owned.items] : [] },
  };
}

/**
 * The native stop of a build-yielding result, from the facts the classifier recorded (termination and the factual reason). A first-witness stop of
 * a weight search (`stopAtFirstWitness`, TED requests only) reports the same reason as a native solution limit, so it reads as `solution_limit`:
 * a trace diagnostic, never an input of the search.
 */
function nativeStopOf(result: Extract<PreciseResult, { kind: 'build' }>): FloorNativeStop {
  const { outcome } = result;
  if (outcome.reason === PUBLIC_REASONS.nativeSolutionLimitReached) return 'solution_limit';
  return outcome.termination === 'optimal' ? 'optimal' : 'other';
}

/**
 * Adapt a Precise result to a floor query result. A `build` is ALWAYS a validated witness (the pipeline publishes nothing the independent validator
 * rejected), however the native search ended; its achieved MOA is the upward enclosure of the validator's exact value, and a trial's witness must
 * also meet its cap exactly or it is rejected.
 */
export function floorQueryResultOf(request: MoaFloorRequest, params: SolveParams, cap: number | null, result: PreciseResult): FloorQueryResult {
  if (result.kind === 'incomplete') return { kind: 'stopped', reason: result.reason };
  if (result.kind === 'empty') {
    const { outcome } = result;
    const qualified = outcome.precision_resolved === 'precise' && outcome.termination === 'optimal'
      && (cap === null
        ? outcome.status === 'infeasible' && outcome.physical_certificate === 'certified_infeasible'
        : outcome.reason === PUBLIC_REASONS.provisionalMoaModelInfeasible);
    return { kind: 'empty', qualified, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) };
  }
  const { best } = result;
  let moa;
  let achievedMoa: number;
  try {
    moa = ratFromString(best.stats.exact.moa);
    achievedMoa = ratRoundUp(moa);
  } catch {
    return { kind: 'stopped', reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
  }
  if (cap !== null && ratGt(moa, ratFromDouble(cap))) return { kind: 'stopped', reason: PUBLIC_REASONS.independentBuildValidationFailed };
  const items: ItemDetail[] = itemDetails(params, best.build, best.stats);
  const preset: PresetDetail = presetDetail(params, best.build, best.stats);
  const build: WitnessBuild = {
    achieved_moa: achievedMoa,
    base: best.build.base.kind === 'naked' ? { kind: 'naked' } : { kind: 'preset', presetId: best.build.base.presetId },
    selected_items: items,
    selected_item_ids: best.build.placements.map(p => p.itemId),
    selected_preset: preset,
    slot_pairs: best.build.placements.map(p => ({ ...p })),
    scope: witnessScopeOf(request, cap),
  };
  return { kind: 'witness', witness: { moaExact: best.stats.exact.moa, achievedMoa, build, nativeStop: nativeStopOf(result) } };
}

/**
 * The default floor query: `solvePrecise` on the floor parameters with the scoped native stop and the shared deadline. A positive native allowance is
 * derived from the remaining time inside the pipeline (`solveWithPresolvePolicy`); a query that finds no time left launches nothing.
 */
export function preciseFloorQuery(request: MoaFloorRequest, solve?: SolveFn): FloorQuery {
  return async (cap, guard) => {
    const stop = guardStop(guard);
    if (stop !== null) return { kind: 'stopped', reason: stopReasonOf(stop) };
    const params = floorQueryParams(request, cap);
    const result = await solvePrecise({ params, guard, nativeStop: MOA_FLOOR_NATIVE_STOP, stopAtFirstWitness: true, ...(solve === undefined ? {} : { solve }) });
    return floorQueryResultOf(request, params, cap, result);
  };
}

// ---------------------------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------------------------

function inputEnvelope(started: number, guard: RuntimeGuard, stop: 'invalid_owned_items' | 'unsupported_part_graph' = 'invalid_owned_items'): MoaFloorRun {
  return { response: floorEnvelope(stop, { elapsedMs: guard.now() - started }), trace: [], trials: 0, ended: 'invalid_input' };
}

/** The floor search with its trace. See the file header for the algorithm; `runMoaFloor` returns the response alone. */
export async function runMoaFloorDetailed(request: MoaFloorRequest, guard: RuntimeGuard, deps: MoaFloorDeps = {}): Promise<MoaFloorRun> {
  const started = guard.now();
  const owned = inspectOwnedItems(request.ownedItems);
  if (!owned.ok) return inputEnvelope(started, guard);
  // A gun whose part graph has a cycle is unsupported data (owner decision 2d as amended): no seed, no trial, no witness.
  if (partGraphRefusal(request) !== null) return inputEnvelope(started, guard, 'unsupported_part_graph');
  const rawQuery = deps.query ?? preciseFloorQuery(request, deps.solve);
  const precisionRequest: PrecisionRequest = request.precisionRequest ?? 'precise';
  const trace: FloorTraceEntry[] = [];
  const record = (step: FloorTraceEntry['step'], trial: number | null, cap: number | null, at: number, result: FloorQueryResult): void => {
    const entry: FloorTraceEntry = {
      step, trial, cap, precision_request: precisionRequest, precision_resolved: 'precise', elapsed_ms: guard.now() - at,
      result: result.kind === 'witness' ? 'witness' : result.kind === 'stopped' ? 'stopped' : result.qualified ? 'empty' : 'unqualified_empty',
    };
    if (result.kind === 'witness') { entry.achieved_moa = result.witness.achievedMoa; entry.nativeStop = result.witness.nativeStop; }
    if (result.kind !== 'witness' && result.reason !== undefined) entry.reason = result.reason;
    trace.push(entry);
  };
  const finish = (best: FloorWitness | null, lo: number | null, ended: FloorEnd, trials: number, reason?: string): MoaFloorRun => {
    const solve_time_ms = guard.now() - started;
    if (best === null) {
      const status: MOAFloorResponse['status'] = ended === 'model_infeasible' ? 'model_infeasible' : 'unresolved';
      return {
        response: { status, moa_qualification: 'provisional_model', floor: null, display_floor: null, proved_lower_bound: null, solve_time_ms, ...(reason === undefined ? {} : { reason }) },
        trace, trials, ended,
      };
    }
    const hi = best.achievedMoa;
    const proved = lo !== null && bracketWithinTolerance(lo, hi);
    return {
      response: {
        status: proved ? 'model_proved' : 'model_witnessed',
        moa_qualification: 'provisional_model',
        floor: hi,
        display_floor: displayFloorOf(hi),
        proved_lower_bound: lo,
        witness: best.build,
        solve_time_ms,
        ...(proved || reason === undefined ? {} : { reason }),
      },
      trace, trials, ended: proved ? 'proved' : ended,
    };
  };

  // The retained state, read by the failure path below. Declared before the first query so a failure of the seed is covered too.
  let best: FloorWitness | null = null;
  let lo: number | null = null;
  let trials = 0;
  /**
   * One query. A typed native failure (`SolverError`) is never a floor result and never an interrupt reason: it is rethrown as the very same error,
   * but first the retained state (the best verified witness, the proved `lo`; ADR 0013 section 6 lists errors among the stops that keep them) is
   * published and attached to its completion metadata, so the caller can show what the floor had established.
   */
  const query: FloorQuery = async (cap, queryGuard) => {
    try {
      return await rawQuery(cap, queryGuard);
    } catch (error) {
      if (error instanceof SolverError) {
        const snapshot = finish(best, lo, 'query_stopped', trials).response;
        extendCompletion(error, { witness: best !== null, floor: snapshot });
        try {
          deps.publishSnapshot?.(snapshot);
        } catch {
          // A failing publisher must not replace the typed native failure.
        }
      }
      throw error;
    }
  };

  // The seed: an achievable hi only. It shares the budget but is not a trial.
  const stopBeforeSeed = guardStop(guard);
  if (stopBeforeSeed !== null) return finish(null, null, stopBeforeSeed, 0, stopReasonOf(stopBeforeSeed));
  const seedAt = guard.now();
  const seed = await query(null, guard);
  record('seed', null, null, seedAt, seed);
  if (seed.kind === 'empty') {
    return seed.qualified ? finish(null, null, 'model_infeasible', 0) : finish(null, null, 'unqualified_empty', 0, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  }
  if (seed.kind === 'stopped') return finish(null, null, 'query_stopped', 0, reconcileReason(seed.reason, guard));
  best = seed.witness;
  let discoveryStep = Math.max(MOA_FLOOR_MIN_DISCOVERY_STEP, Math.abs(best.achievedMoa) / 2);

  for (;;) {
    // A completed bracket proof is decided before any stop, so a late cancel or deadline never downgrades it.
    if (lo !== null && bracketWithinTolerance(lo, best.achievedMoa)) return finish(best, lo, 'proved', trials);
    if (trials >= MOA_FLOOR_MAX_TRIALS) return finish(best, lo, 'trial_cap', trials);
    const hi = best.achievedMoa;
    // Guard before each trial, and again after an explicit macrotask yield so a pending cancel message can be dispatched.
    let stop = guardStop(guard);
    if (stop === null) {
      await guard.yieldMacrotask();
      stop = guardStop(guard);
    }
    if (stop !== null) return finish(best, lo, stop, trials, stopReasonOf(stop));

    const discovering: boolean = lo === null;
    const threshold: number = discovering ? hi - discoveryStep : (lo as number) + (hi - (lo as number)) / 2;
    // A nonfinite, nondecreasing or stalled threshold is not a trial and promotes nothing.
    if (!Number.isFinite(threshold) || !(threshold < hi) || (!discovering && !(threshold > (lo as number)))) {
      return finish(best, lo, 'threshold', trials, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
    }
    trials++;
    const trialAt = guard.now();
    const result = await query(threshold, guard);
    record(discovering ? 'discovery' : 'bisection', trials, threshold, trialAt, result);

    if (result.kind === 'witness') {
      const achieved = result.witness.achievedMoa;
      // Evidence check: the witness must improve hi and cannot lie at or below a proved lo (the two proofs would contradict each other).
      if (lo !== null && achieved <= lo) return finish(best, null, 'no_progress', trials, PUBLIC_REASONS.independentBuildValidationFailed);
      if (!(achieved < hi)) return finish(best, lo, 'no_progress', trials, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
      best = result.witness;
      if (discovering) discoveryStep *= 2;
      continue;
    }
    if (result.kind === 'empty') {
      if (!result.qualified) return finish(best, lo, 'unqualified_empty', trials, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
      lo = threshold;
      continue;
    }
    return finish(best, lo, 'query_stopped', trials, reconcileReason(result.reason, guard));
  }
}

/** The floor state a typed native failure retained (see {@link runMoaFloorDetailed}), `null` for any other error. */
export function retainedFloorOf(error: unknown): MOAFloorResponse | null {
  const floor = completionOf(error)?.floor;
  return floor === undefined ? null : (floor as MOAFloorResponse);
}

/**
 * The MOA floor of a request (ADR 0013 section 6). Every outcome is a `MOAFloorResponse` except a typed native failure, which propagates as the
 * same `SolverError` with the retained floor state on `completionOf(error).floor` (and published through `deps.publishSnapshot`).
 */
export async function runMoaFloor(request: MoaFloorRequest, guard: RuntimeGuard, deps?: MoaFloorDeps): Promise<MOAFloorResponse> {
  return (await runMoaFloorDetailed(request, guard, deps)).response;
}
