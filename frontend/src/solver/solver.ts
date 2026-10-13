/**
 * Solver entry points: `solve` and `computeIdealPoint` (Stage 2 correctness cutover, Phase 2.4b-3b).
 *
 * Two models, one acceptance rule. Nothing is published that the independent physical validator (`physical/validate.ts`) did not accept,
 * and every published statistic is the validator's exact recomputation.
 *
 *  - Precise (`preciseMode: true`): the certified count model of `physical/` (`solvePrecise`, owner decisions 2d and 2e), built through the
 *    proof layer, with a second opinion on every certificate (decision 5a). Multiple copies, physical slots, the exact wallet, preset/owned
 *    supply. TrueErgo and Prevent Overswing run its spatial search over total weight, certified.
 *  - Fast (`preciseMode` false or absent): the template-count model of `physical/specializeFast.ts` on the same physical domain, acquisition and
 *    request as Precise (the same count model as plain doubles, at most one copy per part unless repeats are allowed), solved on the same
 *    pinned native build. Its counts are decoded into a rooted occurrence tree and judged by the same exact validator; a rejected point is cut out
 *    and the model re-solved, and a result that is not a valid physical build is `incomplete`, never published (`physical/solveFast.ts`).
 *    TrueErgo and Prevent Overswing run the same spatial search over total weight on the count model (owner decision 2b, Phase 2.6b): an
 *    approximate answer, never a certificate.
 *
 * This module only ASSEMBLES. The status, certificate, qualifications, termination and reason of every response come from the pure classifier
 * (`physical/outcome.ts`, ADR 0013 section 6), fed by the facts `solvePrecise` and `solveFast` report; the optimization metadata is the search's
 * own bounds (an unknown bound is `null`, never 0). The response is the section 5 transport of `api/client.ts`.
 * A native failure is a typed error (`SolverError`), never a fabricated result.
 *
 * Precision. `precision_request` echoes what the caller asked (`SolveParams.precisionRequest`, else derived from `preciseMode`);
 * `precision_resolved` is the model that actually ran, which is `preciseMode` and nothing else: a TrueErgo or Prevent Overswing request is NOT
 * upgraded to Precise (the caller resolves Auto by size, `precisionMode.ts`).
 */

import type { OptimizeResponse, OptimizationMetadata, FinalStats } from '../api/client';
import type { SolveParams, IdealPoint, ModelQualification, MoaQualification, PhysicalCertificate, PrecisionRequest, PrecisionResolved, SolveStatus } from './types';
export type { SolveParams, IdealPoint } from './types';
import type { ObjectiveAxes } from './trueErgo';
import { canonicalizeTraderLevels } from './reuseKey';
import { itemDetails, presetDetail } from './buildDetails';
import { optimizeEnvelope } from './operationEnvelopes';
import { withDeadline } from './requestGuard';
import { fixedGuard, guardStop } from './runtimeGuard';
import type { RuntimeGuard } from './runtimeGuard';
import { setHighsBaseUrl } from './native';
import { axesOfStats } from './physical/objective';
import { inspectOwnedItems } from './physical/ownedItems';
import { classifyOptimize, isMoaDependent, observationsOfReason } from './physical/outcome';
import type { OptimizeOutcome, StopObservations } from './physical/outcome';
import { PUBLIC_REASONS } from './physical/reasons';
import { solveFast } from './physical/solveFast';
import type { FastSummary } from './physical/solveFast';
import { resolveTolerance, solvePrecise } from './physical/solvePrecise';
import type { PreciseSummary } from './physical/solvePrecise';
import type { PhysicalBuild, PhysicalBuildStats } from './physical/validate';

/**
 * The shipped highs.js solve() returned only Status, ObjectiveValue, Columns and Rows: no dual bound, gap or node count.
 * Kept for the benchmark experiments that still read it (Phase 2.9); `solve` no longer uses it.
 * @deprecated
 */
export function classifyMipStatus(status: string): 'optimal' | 'infeasible' | 'limit' | 'other' {
  if (status === 'Optimal') return 'optimal';
  if (status === 'Infeasible') return 'infeasible';
  if (
    status === 'Time limit reached'
    || status === 'Iteration limit reached'
    || status === 'Target for objective reached'
    || status === 'Bound on objective reached'
  ) return 'limit';
  return 'other';
}

/**
 * Upper bound only after Optimal: the solver's own objective, with NO fixed margin. The pre-cutover code added a nominal 1e-7 to every
 * bound; that constant had no error analysis and made a requested tolerance below it impossible to certify. The proved allowance for
 * native, secant and frame error is Phase 2.5 (`physical/search.ts` `nodeUpperBound` is the seam).
 * @deprecated Kept for the benchmark experiments that still read it (Phase 2.9); `solve` uses the structured native bound.
 */
export function certifiedDualBound(status: string, objectiveValue: number | undefined): number | undefined {
  if (classifyMipStatus(status) !== 'optimal') return undefined;
  if (objectiveValue == null || !Number.isFinite(objectiveValue)) return undefined;
  return objectiveValue;
}

/**
 * A MIP column vector may update the incumbent only when every expected decision column is present and integral and exactly one purchase
 * base is selected, and the independent build validator reports no errors. Pure column check of the legacy template model.
 * @deprecated Kept for the benchmark experiments that still read it (Phase 2.9); `solve` validates through `physical/validate.ts`.
 */
export function incumbentBlockReason(
  columns: Record<string, { Primal?: number } | undefined>,
  expectedColumns: readonly string[],
  nBases: number,
  validationErrors: readonly string[],
): string | undefined {
  for (const name of expectedColumns) {
    const primal = columns[name]?.Primal;
    if (primal == null || !Number.isFinite(primal)) return `Missing decision column ${name}`;
    if (Math.abs(primal - Math.round(primal)) > 1e-7) return `Nonintegral decision column ${name}`;
  }
  let bases = 0;
  for (let b = 1; b <= nBases; b++) {
    const primal = columns[`base_${b}`]?.Primal;
    if (primal != null && primal > 0.5) bases++;
  }
  if (bases !== 1) return `Decoded solution selected ${bases} purchase bases`;
  if (validationErrors.length) return `Independent build validation failed: ${validationErrors.join('; ')}`;
  return undefined;
}

/**
 * Solver features supported by this build.
 * Benchmark runners check this to avoid running candidate flags against legacy code.
 */
export const SOLVER_CAPABILITIES = {
  retainLimitIncumbent: false,
  branchOrdering: false,
  initialCandidate: false,
} as const;

// HiGHS is the pinned native build behind ./native (see vendor/highs/README.md). The loader hash-checks both artifacts and
// validates the ABI against the committed manifest, and throws a typed error on any mismatch: there is no fallback to the
// stock npm package or to any other HiGHS. The Vite base is the browser location of highs.js / highs.wasm.
setHighsBaseUrl((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/');

/** The clock of a solve with no guard of its own (a direct caller): the page or worker monotonic clock. */
const defaultNow = (): number => performance.now();

/** Default request budget of a solve that was given neither a guard nor a `timeLimitMs`. */
export const DEFAULT_SOLVE_TIME_LIMIT_MS = 60_000;

/**
 * The guard a solve runs under (ADR 0013 section 4D). The request's own guard when it has one (the deadline is the queue-inclusive epoch
 * deadline; a `timeLimitMs` can only narrow it, never extend it), otherwise a guard built from `timeLimitMs` (no cancel source), which keeps
 * direct callers and the tests working. Every stage reads this one clock.
 */
export function guardOfParams(params: Pick<SolveParams, 'guard' | 'timeLimitMs'>): RuntimeGuard {
  const limit = Math.max(0, params.timeLimitMs ?? DEFAULT_SOLVE_TIME_LIMIT_MS);
  if (params.guard === undefined) return fixedGuard(defaultNow() + limit);
  return params.timeLimitMs === undefined ? params.guard : withDeadline(params.guard, params.guard.now() + limit);
}

/** The result of one solve plus the objective axes of its build (what a payoff-table endpoint reads). */
interface Detailed {
  response: OptimizeResponse;
  axes?: ObjectiveAxes;
  /** The payoff table THIS call computed (absent when it was supplied, or the request does not use one). */
  payoff?: PayoffReport;
}

/** What one payoff endpoint established: the endpoint cache admits a table only when every endpoint is a qualified Precise certified optimum. */
export interface EndpointRecord {
  weights: readonly [number, number, number];
  status: SolveStatus;
  physical_certificate: PhysicalCertificate;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
}

/** A payoff table with the proof state of the three solves that produced it. */
export interface PayoffReport {
  idealPoint: IdealPoint;
  endpoints: readonly EndpointRecord[];
  /**
   * Telemetry only (read by benchmarks, never by the cache or the response): the wall time of each endpoint solve in weight order and of the
   * whole table, milliseconds on the request clock.
   */
  timing?: { endpointMs: number[]; tableMs: number };
}

/** A solve response and, when this call computed the Tchebycheff payoff table, the table with its endpoint records. */
export interface SolveReport {
  response: OptimizeResponse;
  payoff: PayoffReport | null;
}

/** The payoff table could not be computed. `endpoint` is the response of the endpoint solve that failed, when there is one. */
class PayoffTableError extends Error {
  readonly reason: string;
  readonly endpoint: OptimizeResponse | null;

  constructor(reason: string, endpoint: OptimizeResponse | null) {
    super(`Ideal-point endpoint not certified: ${reason}`);
    this.name = 'PayoffTableError';
    this.reason = reason;
    this.endpoint = endpoint;
  }
}

const PAYOFF_WEIGHTS: readonly (readonly [number, number, number])[] = [[100, 0, 0], [0, 100, 0], [0, 0, 100]];

/**
 * How the payoff table is computed (docs/stage3/sweet-spot.md). Production: concurrent endpoints. Tests and benchmarks switch with
 * {@link configurePayoff} (`concurrent: false` is the behaviour before 2026-10-13: three endpoints one after the other).
 */
export interface PayoffOptions {
  /** Run the three endpoint solves at the same time (they are independent; the result is the sequential one, see `computePayoff`). */
  concurrent: boolean;
  /**
   * Test seam, never set in production: runs around each endpoint (its index in weight order) and must call `run` once, or throw instead (to delay
   * an endpoint, fail it, or observe the order they finish in).
   */
  endpointWrapper?: (index: number, run: () => Promise<void>) => Promise<void>;
}

const PAYOFF_DEFAULTS: PayoffOptions = { concurrent: true };
let payoffOptions: PayoffOptions = { ...PAYOFF_DEFAULTS };

/** Override the payoff options (tests, benchmarks); `configurePayoff({})` restores production's. */
export function configurePayoff(next: Partial<PayoffOptions>): void {
  payoffOptions = { ...PAYOFF_DEFAULTS, ...next };
}

/** One payoff endpoint: the request with the endpoint's weights (through the test seam when one is set). */
async function solveEndpoint(base: SolveParams, weights: readonly [number, number, number], index: number): Promise<Detailed> {
  const wrapper = payoffOptions.endpointWrapper;
  if (wrapper !== undefined) {
    let out: Detailed | undefined;
    await wrapper(index, async () => { out = await solveEndpointOnce(base, weights); });
    if (out === undefined) throw new Error('endpointWrapper returned without running the endpoint');
    return out;
  }
  return solveEndpointOnce(base, weights);
}

function solveEndpointOnce(base: SolveParams, weights: readonly [number, number, number]): Promise<Detailed> {
  return solveDetailed({ ...base, ergoWeight: weights[0], recoilWeight: weights[1], priceWeight: weights[2] });
}

/** A guard that also stops when `abort()` says so: a later endpoint is stopped once an earlier one has failed (its answer is never read). */
function abortableGuard(guard: RuntimeGuard, abort: () => boolean): RuntimeGuard {
  return {
    deadline: guard.deadline,
    now: () => guard.now(),
    cancelled: () => guard.cancelled() || abort(),
    yieldMacrotask: () => guard.yieldMacrotask(),
  };
}

/**
 * The payoff table and the proof state of its three endpoint solves, under one guard.
 *
 * Concurrent (production): the guard is checked once, then the three endpoints start together and share the request's guard and deadline (one
 * `timeLimitMs` covers the endpoints and the final search). The answer is the sequential one: each endpoint solve is independent of the others (its
 * native solves depend only on their text and options, `docs/stage3/parallel-pool.md`), and the outcomes are read in weight order, so the error
 * reported is the one of the first endpoint (in weight order) that failed, as the sequential loop reports it. Once an endpoint fails, the later
 * ones are stopped (their answers could not be reported). After the table, one macrotask yield lets an out-of-band cancel be dispatched.
 *
 * Sequential (`concurrent: false`): the guard before each endpoint, a macrotask yield after it (the 2026-10-13 behaviour).
 */
async function computePayoff(params: SolveParams, guard: RuntimeGuard): Promise<PayoffReport> {
  const base: SolveParams = { ...params, useTchebycheff: false, idealPoint: undefined, guard, timeLimitMs: undefined };
  const pay: ObjectiveAxes[] = [];
  const endpoints: EndpointRecord[] = [];
  const tableStart = guard.now();
  const endpointMs: number[] = [];
  const stopError = (stop: 'cancelled' | 'deadline'): PayoffTableError =>
    new PayoffTableError(stop === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached, null);
  const failed = (r: Detailed): boolean => r.response.status !== 'optimal' || !r.axes;
  const accept = (weights: readonly [number, number, number], r: Detailed): void => {
    if (failed(r)) throw new PayoffTableError(r.response.reason ?? r.response.status, r.response);
    pay.push(r.axes as ObjectiveAxes);
    const { status, physical_certificate, precision_resolved, model_qualification, moa_qualification } = r.response;
    endpoints.push({ weights, status, physical_certificate, precision_resolved, model_qualification, moa_qualification });
  };
  if (payoffOptions.concurrent) {
    const stop = guardStop(guard);
    if (stop !== null) throw stopError(stop);
    /** The first endpoint (in weight order) known to have failed; every later one is stopped. */
    let firstFailed = PAYOFF_WEIGHTS.length;
    const settled = await Promise.all(PAYOFF_WEIGHTS.map(async (weights, i) => {
      const started = guard.now();
      const own = abortableGuard(guard, () => firstFailed < i);
      try {
        const r = await solveEndpoint({ ...base, guard: own }, weights, i);
        endpointMs[i] = guard.now() - started;
        if (failed(r)) firstFailed = Math.min(firstFailed, i);
        return { ok: true as const, r };
      } catch (error) {
        endpointMs[i] = guard.now() - started;
        firstFailed = Math.min(firstFailed, i);
        return { ok: false as const, error };
      }
    }));
    // In weight order: the first failure is the one reported (a thrown error as it was thrown, a failed endpoint as a PayoffTableError).
    settled.forEach((outcome, i) => {
      if (!outcome.ok) throw outcome.error;
      accept(PAYOFF_WEIGHTS[i], outcome.r);
    });
    // The payoff solves are sub-solves of one request: yield a macrotask so an out-of-band cancel message is dispatched before the final solve.
    await guard.yieldMacrotask();
  } else {
    for (const [i, weights] of PAYOFF_WEIGHTS.entries()) {
      const stop = guardStop(guard);
      if (stop !== null) throw stopError(stop);
      const started = guard.now();
      const r = await solveEndpoint(base, weights, i);
      endpointMs.push(guard.now() - started);
      accept(weights, r);
      // The payoff solves are sub-solves of one request: yield a macrotask between them so an out-of-band cancel message is dispatched.
      await guard.yieldMacrotask();
    }
  }
  return {
    idealPoint: {
      zE: Math.max(...pay.map(p => p.fE)), nadE: Math.min(...pay.map(p => p.fE)),
      zR: Math.min(...pay.map(p => p.fR)), nadR: Math.max(...pay.map(p => p.fR)),
      zP: Math.min(...pay.map(p => p.fP)), nadP: Math.max(...pay.map(p => p.fP)),
    },
    endpoints,
    timing: { endpointMs, tableMs: guard.now() - tableStart },
  };
}

/**
 * Endpoint payoff table (ADR 0013 section 4D): three solves with weights [100, 0, 0], [0, 100, 0] and [0, 0, 100], in the SAME frames as
 * the final objective (fE = 10 x ergonomics or TED, fR = 1000 x recoil modifier sum, fP = RUB spend). Each endpoint keeps every user
 * feasibility constraint and must be certified optimal; the six coordinates are derived from those three vectors.
 */
export async function computeIdealPoint(params: SolveParams): Promise<IdealPoint> {
  return (await computePayoff(params, guardOfParams(params))).idealPoint;
}

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  return (await solveDetailed(params)).response;
}

/** {@link solve} plus the payoff table this call computed with the proof state of its endpoints (what the worker endpoint cache admits). */
export async function solveRequest(params: SolveParams): Promise<SolveReport> {
  const detailed = await solveDetailed(params);
  return { response: detailed.response, payoff: detailed.payoff ?? null };
}

// ---------------------------------------------------------------------------------------------
// Response assembly (shared by Precise and Fast: both publish a validated PhysicalBuild)
// ---------------------------------------------------------------------------------------------

/** What every assembled response shares: the caller's precision request, the clock and the payoff table that was used (if any). */
interface Assembly {
  precisionRequest: PrecisionRequest;
  start: number;
  /** The guard clock: `start` and `solve_time_ms` are read on it. */
  now: () => number;
  idealPoint?: IdealPoint;
  /** The Fast model ran (or would have run) with at most one copy of each part: the response says so (`single_copy`). Never set for Precise. */
  singleCopy?: boolean;
}

/** Bounds the search does not have: unknown, never 0. */
const unknownOptimization = (tolerance: number, nodes: number, termination: OptimizationMetadata['termination']): OptimizationMetadata => ({
  lower_bound: null, upper_bound: null, absolute_gap: null, tolerance, nodes, termination,
});

/** The Precise search's own bounds as they travel (`null` for an unknown or unproved value) with the classifier's termination. */
const preciseOptimization = (summary: PreciseSummary, outcome: OptimizeOutcome): OptimizationMetadata => ({
  lower_bound: summary.bounds.lower,
  upper_bound: summary.bounds.upper,
  absolute_gap: summary.bounds.gap,
  tolerance: summary.tolerance,
  nodes: summary.nodes,
  termination: outcome.termination,
});

/**
 * The Fast model has no proof frame: no physical upper bound or gap (its node bounds belong to the approximate model and never travel). Its lower
 * bound is the downward enclosure of the exact score of the verified witness, when there is one. `nodes` counts the outer spatial calls of a TED
 * request's weight search (0 for a request with no spatial dimension), never native MIP nodes.
 */
const fastOptimization = (summary: FastSummary, outcome: OptimizeOutcome, scoreLower: number | null): OptimizationMetadata => ({
  ...unknownOptimization(summary.tolerance, summary.nodes, outcome.termination),
  lower_bound: scoreLower,
});

/** The fields every response takes from the classified outcome. */
const outcomeFields = (assembly: Assembly, outcome: OptimizeOutcome) => ({
  status: outcome.status,
  precision_request: assembly.precisionRequest,
  precision_resolved: outcome.precision_resolved,
  model_qualification: outcome.model_qualification,
  moa_qualification: outcome.moa_qualification,
  physical_certificate: outcome.physical_certificate,
  ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
  ...(assembly.singleCopy === true ? { single_copy: true as const } : {}),
});

/** A response with no build: an emptiness, a limit or a refusal. The objective is `null`, the manifest empty. */
function noBuildResponse(assembly: Assembly, outcome: OptimizeOutcome, optimization: OptimizationMetadata): Detailed {
  return {
    response: {
      ...outcomeFields(assembly, outcome),
      selected_items: [],
      selected_item_ids: [],
      slot_pairs: [],
      objective_value: null,
      optimization,
      solve_time_ms: assembly.now() - assembly.start,
      ...(assembly.idealPoint === undefined ? {} : { ideal_point: assembly.idealPoint }),
    },
  };
}

function finalStatsOf(stats: PhysicalBuildStats): FinalStats {
  return {
    ergonomics: stats.ergonomics,
    recoil_vertical: stats.recoilVertical,
    recoil_horizontal: stats.recoilHorizontal,
    total_price: stats.spend,
    total_weight: stats.weight,
    true_ergo_delta: stats.ted,
    overswing_pct: stats.overswingPercent,
    moa: stats.moa,
  };
}

/** The published build: the installed multiset, placements, base and statistics all come from the validated build and its exact stats. */
function buildResponse(
  params: SolveParams, assembly: Assembly, build: PhysicalBuild, stats: PhysicalBuildStats, score: number, outcome: OptimizeOutcome, optimization: OptimizationMetadata,
): Detailed {
  const axes = axesOfStats(stats, params.useTrueErgo === true);
  const response: OptimizeResponse = {
    ...outcomeFields(assembly, outcome),
    selected_items: itemDetails(params, build, stats),
    selected_item_ids: build.placements.map(p => p.itemId),
    selected_preset: presetDetail(params, build, stats),
    slot_pairs: build.placements.map(p => ({ ...p })),
    objective_value: score,
    optimization,
    final_stats: finalStatsOf(stats),
    solve_time_ms: assembly.now() - assembly.start,
    ...(assembly.idealPoint === undefined ? {} : { ideal_point: assembly.idealPoint }),
  };
  return { response, axes };
}

// ---------------------------------------------------------------------------------------------
// Precise
// ---------------------------------------------------------------------------------------------

async function solveExact(params: SolveParams, guard: RuntimeGuard, assembly: Assembly): Promise<Detailed> {
  const result = await solvePrecise({ params, guard });
  const { outcome, summary } = result;
  if (result.kind !== 'build') return noBuildResponse(assembly, outcome, preciseOptimization(summary, outcome));
  const { best } = result;
  return buildResponse(params, assembly, best.build, best.stats, best.score, outcome, preciseOptimization(summary, outcome));
}

// ---------------------------------------------------------------------------------------------
// Fast
// ---------------------------------------------------------------------------------------------

/**
 * The approximate model's outcome: a verified build is `optimal` / `approximate_optimal` when the native solve was Optimal (the build is the best
 * point of the approximate model that the exact validator accepts), otherwise `feasible` with the solver's stop reason; emptiness is incomplete
 * with the approximate-model reason, never infeasible.
 */
async function solveApproximate(params: SolveParams, guard: RuntimeGuard, assembly: Assembly): Promise<Detailed> {
  const result = await solveFast({ params, guard });
  const { outcome, summary } = result;
  if (result.kind !== 'build') return noBuildResponse(assembly, outcome, fastOptimization(summary, outcome, null));
  const { best } = result;
  return buildResponse(params, assembly, best.build, best.stats, best.score, outcome, fastOptimization(summary, outcome, best.scoreLower));
}

// ---------------------------------------------------------------------------------------------
// Request driver
// ---------------------------------------------------------------------------------------------

async function solveDetailed(input: SolveParams): Promise<Detailed> {
  const guard = guardOfParams(input);
  const now = guard.now;
  const start = now();
  // What the caller asked for.
  const precisionRequest: PrecisionRequest = input.precisionRequest ?? (input.preciseMode ? 'precise' : 'fast');
  const moaDependent = isMoaDependent(input);
  const owned = inspectOwnedItems(input.ownedItems);
  if (!owned.ok) {
    // Before hashing, caching or any model work: nothing resolved, the search never started.
    return { response: optimizeEnvelope('invalid_owned_items', { precisionRequest, moaDependent, tolerance: resolveTolerance(input.objectiveTolerance), elapsedMs: now() - start }) };
  }
  // The normalized request: the stash is the validated frozen snapshot, the guard the one clock of every stage below.
  let params: SolveParams = { ...input, precisionRequest, ownedItems: owned.items, guard, timeLimitMs: undefined };
  if (params.traderLevels) params.traderLevels = canonicalizeTraderLevels(params.traderLevels) as SolveParams['traderLevels'];
  const mode = params.preciseMode ? 'precise' : 'fast';
  // Owner decision 2c: Fast installs at most one copy of each part unless the request allows repeats; Precise ignores the option.
  const singleCopy = mode === 'fast' && params.allowRepeatedParts !== true;
  const tolerance = resolveTolerance(params.objectiveTolerance);
  /** A request that stopped before its search started: no build, no proof, the factual cause. */
  const unstarted = (observed: StopObservations, idealPoint?: IdealPoint): Detailed => noBuildResponse(
    { precisionRequest, start, now, idealPoint, singleCopy },
    classifyOptimize({ mode, moaDependent, end: 'unproved', witness: false, searchFinished: false, observed }),
    unknownOptimization(tolerance, 0, 'limit'),
  );
  /** The stop the guard reports now (cancel before deadline, section 6), as an observation. */
  const guardObservation = (stop: 'cancelled' | 'deadline'): StopObservations => (stop === 'cancelled' ? { cancelled: true } : { deadline: true });
  // Stage guard: nothing runs for a request that was cancelled or ran out of time before its first stage.
  const entryStop = guardStop(guard);
  if (entryStop !== null) return unstarted(guardObservation(entryStop));
  let payoff: PayoffReport | undefined;
  if (params.useTchebycheff && !params.idealPoint) {
    try {
      payoff = await computePayoff(params, guard);
      params = { ...params, idealPoint: payoff.idealPoint };
    } catch (error) {
      if (error instanceof PayoffTableError) {
        // An endpoint that proves the request empty proves it for every objective; any other failure leaves the table unavailable.
        const endpoint = error.endpoint;
        const empty = endpoint !== null && (endpoint.status === 'infeasible' || endpoint.reason === PUBLIC_REASONS.provisionalMoaModelInfeasible
          || endpoint.reason === PUBLIC_REASONS.approximateModelInfeasible || endpoint.reason === PUBLIC_REASONS.fastProvisionalMoaModelInfeasible);
        if (empty) return { response: { ...endpoint, solve_time_ms: now() - start } };
        // The table is a prerequisite of the objective, but the stop is reported as what actually stopped the endpoint (its own factual reason).
        return unstarted(observationsOfReason(error.reason));
      }
      throw error;
    }
  }
  const idealPoint = params.useTchebycheff ? params.idealPoint : undefined;
  const midStop = guardStop(guard);
  if (midStop !== null) return unstarted(guardObservation(midStop), idealPoint);
  const assembly: Assembly = { precisionRequest, start, now, idealPoint, singleCopy };
  const detailed = await (params.preciseMode ? solveExact(params, guard, assembly) : solveApproximate(params, guard, assembly));
  return payoff === undefined ? detailed : { ...detailed, payoff };
}
