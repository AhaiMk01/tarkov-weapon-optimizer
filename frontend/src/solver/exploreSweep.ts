/**
 * The Explore sweep and its total classification (ADR 0013 section 6 "Explore: total classification and precedence", ADR 0004 section 5).
 *
 * An Explore request is a SCHEDULE of targets. Every scheduled target is solved by one injected Optimize call and recorded exactly once:
 *
 *   V  an independently valid optimal or FEASIBLE witness (the response carries a build and its statistics; a build the pipeline rejected is not one);
 *   I  status `infeasible` AND `certified_infeasible`, from a Precise MOA-independent result. Fast or provisional-MOA model infeasibility is `incomplete`
 *      with no certificate, so it is U, never I;
 *   U  everything else that is not an error: no witness and no certified emptiness, and every target never launched because the deadline passed or
 *      the request was cancelled (U with that reason);
 *   E  a runtime error: a thrown error or a response with status `error`.
 *
 * `curve_status` follows the seven rules of the ADR (see {@link classifyCurve}); a late cancel after every target is V or I does not downgrade a
 * completed schedule. `complete` is discrete schedule coverage, never a continuous Pareto proof. The points are the V witnesses (deduplicated and
 * Pareto-filtered for display); a dropped duplicate or dominated build keeps its V record with `point_index: null`. No point or certificate is
 * ever reused for another target.
 *
 * The schedule may be ADAPTIVE (`SweepSchedule.extend`), as the pre-cutover sweep was: the two endpoint solves are scheduled up front, and the
 * step targets between them are generated after the endpoints return, each from the achieved value of the previous step. Every generated target is
 * recorded in `sweep_schedule`; generation happens before the next guard check, so a sweep that stops early always carries at least one
 * unlaunched (U) target and is never reported complete.
 *
 * Runtime guard (ADR 0013 section 4D): `guardStop` before each step, an explicit macrotask yield between steps. The optimize function is injected
 * (`optimize(params, guard)`), and receives the guard so it can derive a positive native allowance from the one shared request deadline.
 */

import type { ExplorePoint, ExploreResponse, ExploreSnapshot, ExploreStepOutcome, OptimizationMetadata, OptimizeResponse } from '../api/client';
import { PUBLIC_REASONS } from './physical/reasons';
import { resolveTolerance } from './physical/solvePrecise';
import { guardStop } from './runtimeGuard';
import type { RuntimeGuard } from './runtimeGuard';
import type { MoaQualification, PrecisionRequest, PrecisionResolved, SolveParams } from './types';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ExploreAxis = 'price' | 'recoil' | 'ergo';
export type StepOutcome = ExploreStepOutcome['outcome'];

export interface SweepTarget {
  /** Position in the schedule, 0-based and consecutive. */
  target_index: number;
  /** The value of the swept axis this target aims at (an endpoint carries the end of the axis it solves for). */
  target_value: number;
  /** The objective weights of this target's solve. */
  weights: { ergoWeight: number; recoilWeight: number; priceWeight: number };
  /** Request fields this target changes (the swept axis bound). */
  overrides: Partial<SolveParams>;
}

/** A launched target with its classification and the response it was classified from (`null` for a thrown error). */
export interface SettledTarget {
  target: SweepTarget;
  outcome: StepOutcome;
  response: OptimizeResponse | null;
}

export interface SweepSchedule {
  /** Targets known before the first solve. A schedule with none is invalid. */
  targets: readonly SweepTarget[];
  /**
   * Called after each launched target is classified, in order, with every settled target so far; returns the targets to append (the next step of an
   * adaptive sweep). Synchronous and deterministic. Absent: the schedule is exactly `targets`.
   */
  extend?: (settled: readonly SettledTarget[]) => readonly SweepTarget[];
}

export interface ExploreRunRequest {
  ignore: ExploreAxis;
  /** The request under every target: constraints, acquisition domain, precision, owned stock. Weights come from the target. */
  base: Omit<SolveParams, 'ergoWeight' | 'recoilWeight' | 'priceWeight'>;
  /** What the caller asked for. */
  precisionRequest: PrecisionRequest;
  /** The mode the caller resolved the request to (`true` Precise), when it did; used for the aggregate when no target resolved one. */
  preciseMode?: boolean;
  /** Naked vertical recoil of the weapon, for the plotted recoil percentage. */
  nakedRecoilV: number;
}

export type OptimizeFn = (params: SolveParams, guard: RuntimeGuard) => Promise<OptimizeResponse>;

/**
 * Per-step observer (Phase 2.8): called after each launched target is recorded and classified, with the verified partial result so far (an
 * `ExploreSnapshot`). The worker publishes it, so a hard termination keeps the points published so far (ADR 0013 section 4D). Synchronous; a
 * throwing observer never changes the sweep.
 */
export type ExploreStepObserver = (snapshot: ExploreSnapshot) => void;

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

/** The certificate a status must carry for its response to be a published witness (`outcome.ts`). */
const WITNESS_CERTIFICATES: Record<'optimal' | 'feasible', readonly string[]> = {
  optimal: ['certified_optimal', 'approximate_optimal'],
  feasible: ['feasible'],
};

/**
 * Is this response a verified witness? The Optimize pipeline publishes a build only after the independent validator accepted it, so the check is
 * the consistency of the published record: an optimal or feasible status with the matching certificate, a build with statistics, a finite objective
 * and one placement per installed occurrence. Anything else is not a witness, whatever its status claims.
 */
export function isVerifiedWitness(r: OptimizeResponse): boolean {
  if (r.status !== 'optimal' && r.status !== 'feasible') return false;
  if (!WITNESS_CERTIFICATES[r.status].includes(r.physical_certificate)) return false;
  if (r.final_stats === undefined || r.objective_value === null || !Number.isFinite(r.objective_value)) return false;
  if (!Array.isArray(r.selected_items) || !Array.isArray(r.slot_pairs) || !Array.isArray(r.selected_item_ids)) return false;
  return r.selected_items.length === r.slot_pairs.length && r.selected_item_ids.length === r.slot_pairs.length;
}

/** I: certified emptiness of the whole request, from a Precise MOA-independent proof. */
export function isCertifiedInfeasible(r: OptimizeResponse): boolean {
  return r.status === 'infeasible' && r.physical_certificate === 'certified_infeasible'
    && r.precision_resolved === 'precise' && r.model_qualification === 'exact' && r.moa_qualification === null;
}

/** The V/I/U/E classification of one launched target's response. Total. */
export function classifyResponse(r: OptimizeResponse): StepOutcome {
  if (r.status === 'error') return 'E';
  if (isVerifiedWitness(r)) return 'V';
  if (isCertifiedInfeasible(r)) return 'I';
  return 'U';
}

export interface OutcomeCounts { V: number; I: number; U: number; E: number }

export const countOutcomes = (outcomes: readonly StepOutcome[]): OutcomeCounts => {
  const counts: OutcomeCounts = { V: 0, I: 0, U: 0, E: 0 };
  for (const o of outcomes) counts[o]++;
  return counts;
};

/**
 * `curve_status` from the outcome counts (ADR 0013 section 6, the seven rules in order):
 *   1. V = N                           complete
 *   2. V >= 1, I >= 1, V + I = N       complete
 *   3. V >= 1 with U or E              partial
 *   4. I = N                           infeasible
 *   5. V = 0 with U or E               invalid
 *   6. cancellation stopped an unfinished schedule, V >= 1    partial
 *   7. cancellation stopped an unfinished schedule, V = 0     invalid
 * An unlaunched target is U, so an unfinished schedule always has U >= 1 and rules 6 and 7 coincide with 3 and 5. Completed-schedule precedence:
 * when every target is V or I (U = E = 0) a cancel or deadline that arrived afterwards has no row to apply to, so it cannot downgrade complete or
 * infeasible. An empty schedule (N = 0) is never complete or infeasible.
 */
export function classifyCurve(counts: OutcomeCounts): ExploreResponse['curve_status'] {
  const n = counts.V + counts.I + counts.U + counts.E;
  if (n < 1) return 'invalid';
  if (counts.U === 0 && counts.E === 0) return counts.I === n ? 'infeasible' : 'complete';
  return counts.V >= 1 ? 'partial' : 'invalid';
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

const unknownOptimization = (tolerance: number): OptimizationMetadata => ({
  lower_bound: null, upper_bound: null, absolute_gap: null, tolerance, nodes: 0, termination: 'limit',
});

const moaQualificationOf = (base: ExploreRunRequest['base']): MoaQualification => (base.maxMOA != null ? 'provisional_model' : null);

/**
 * The row of a target that produced a response. The reason is the response's own public reason, except for an `E` row (a response with status
 * `error`), which may carry a diagnostic message outside the closed set: that is accepted for E rows only.
 */
function rowOfResponse(index: number, outcome: StepOutcome, r: OptimizeResponse, reason: string | undefined): ExploreStepOutcome {
  return {
    target_index: index,
    outcome,
    point_index: null,
    status: r.status,
    physical_certificate: r.physical_certificate,
    precision_resolved: r.precision_resolved,
    model_qualification: r.model_qualification,
    moa_qualification: r.moa_qualification,
    optimization: r.optimization,
    ...(reason === undefined ? {} : { reason }),
  };
}

/** The row of a target with no response: never launched (U) or a runtime error (E). Nothing resolved, the search never completed. */
function rowWithoutResponse(index: number, outcome: 'U' | 'E', request: ExploreRunRequest, reason: string | undefined): ExploreStepOutcome {
  return {
    target_index: index,
    outcome,
    point_index: null,
    status: outcome === 'E' ? 'error' : 'incomplete',
    physical_certificate: 'none',
    precision_resolved: null,
    model_qualification: null,
    moa_qualification: moaQualificationOf(request.base),
    optimization: unknownOptimization(resolveTolerance(request.base.objectiveTolerance)),
    ...(reason === undefined ? {} : { reason }),
  };
}

const stopReasonOf = (cause: 'cancelled' | 'deadline'): string => (cause === 'cancelled' ? PUBLIC_REASONS.cancelledByUser : PUBLIC_REASONS.timeLimitReached);

// ---------------------------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------------------------

/** The plotted point of a witness: display-rounded coordinates plus the proof and witness fields of the Optimize result that generated it. */
export function explorePointOf(result: OptimizeResponse, nakedRecoilV: number): ExplorePoint {
  const stats = result.final_stats as NonNullable<OptimizeResponse['final_stats']>;
  const recoilMultiplier = nakedRecoilV > 0 ? stats.recoil_vertical / nakedRecoilV : 1;
  // Display rounding: 0.1 for ergonomics and recoil, integer for price.
  return {
    ergo: Math.round(stats.ergonomics * 10) / 10,
    recoil_pct: Math.round((recoilMultiplier - 1) * 1000) / 10,
    recoil_v: Math.round(stats.recoil_vertical * 10) / 10,
    recoil_h: Math.round(stats.recoil_horizontal * 10) / 10,
    price: Math.round(stats.total_price),
    selected_items: result.selected_items,
    selected_item_ids: result.selected_item_ids,
    selected_preset: result.selected_preset,
    slot_pairs: result.slot_pairs,
    status: result.status,
    physical_certificate: result.physical_certificate,
    precision_request: result.precision_request,
    precision_resolved: result.precision_resolved,
    model_qualification: result.model_qualification,
    moa_qualification: result.moa_qualification,
    objective_value: result.objective_value,
    optimization: result.optimization,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    solve_time_ms: result.solve_time_ms,
  };
}

interface Candidate { targetIndex: number; point: ExplorePoint }

/**
 * The displayed frontier of the witnesses: one point per plotted coordinate pair (the cheaper, lower-recoil or higher-ergonomics one), the
 * dominated points removed, sorted along the swept axis. This is display filtering only; the step records of the dropped points stay.
 */
export function displayFrontier(ignore: ExploreAxis, candidates: readonly Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of candidates) {
    const p = c.point;
    const key = ignore === 'price' ? `${p.ergo},${p.recoil_v}` : ignore === 'recoil' ? `${p.ergo},${p.price}` : `${p.recoil_v},${p.price}`;
    const existing = byKey.get(key);
    const better = existing === undefined
      || (ignore === 'price' ? p.price < existing.point.price : ignore === 'recoil' ? p.recoil_v < existing.point.recoil_v : p.ergo > existing.point.ergo);
    if (better) byKey.set(key, c);
  }
  const unique = [...byKey.values()];
  const dominated = (p: ExplorePoint): boolean => unique.some(({ point: q }) => {
    if (q === p) return false;
    if (ignore === 'price') return q.ergo >= p.ergo && q.recoil_v <= p.recoil_v && (q.ergo > p.ergo || q.recoil_v < p.recoil_v);
    if (ignore === 'recoil') return q.ergo >= p.ergo && q.price <= p.price && (q.ergo > p.ergo || q.price < p.price);
    return q.recoil_v <= p.recoil_v && q.price <= p.price && (q.recoil_v < p.recoil_v || q.price < p.price);
  });
  const frontier = unique.filter(c => !dominated(c.point));
  if (ignore === 'ergo') frontier.sort((a, b) => a.point.recoil_v - b.point.recoil_v);
  else frontier.sort((a, b) => a.point.ergo - b.point.ergo);
  return frontier;
}

// ---------------------------------------------------------------------------------------------
// Schedule validation
// ---------------------------------------------------------------------------------------------

const isWeight = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Why a list of targets is not a valid schedule continuing from position `from`, or `null` when it is. */
export function targetsProblem(targets: readonly SweepTarget[], from: number): string | null {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t === null || typeof t !== 'object') return `target ${from + i} is not an object`;
    if (t.target_index !== from + i) return `target ${from + i} has index ${String(t.target_index)}`;
    if (typeof t.target_value !== 'number' || !Number.isFinite(t.target_value)) return `target ${from + i} has a non-finite target value`;
    if (t.weights === null || typeof t.weights !== 'object' || !isWeight(t.weights.ergoWeight) || !isWeight(t.weights.recoilWeight) || !isWeight(t.weights.priceWeight)) {
      return `target ${from + i} has invalid weights`;
    }
    if (t.overrides === null || typeof t.overrides !== 'object') return `target ${from + i} has no overrides object`;
  }
  return null;
}

/** Why a schedule is invalid (empty or malformed), or `null`. */
export function scheduleProblem(schedule: SweepSchedule | null | undefined): string | null {
  if (schedule === null || schedule === undefined || !Array.isArray(schedule.targets)) return 'the schedule has no target list';
  if (schedule.targets.length < 1) return 'the schedule has no targets';
  return targetsProblem(schedule.targets, 0);
}

// ---------------------------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------------------------

/** The Optimize parameters of one target: the shared request, the target's weights, then its overrides. */
export const paramsOfTarget = (request: ExploreRunRequest, target: SweepTarget): SolveParams => ({ ...request.base, ...target.weights, ...target.overrides });

/** Aggregate resolved mode: the uniform per-target mode, else the caller's resolved mode when nothing resolved one, else `null` (mixed). */
function aggregateMode(rows: readonly ExploreStepOutcome[], request: ExploreRunRequest): PrecisionResolved {
  const modes = new Set<PrecisionResolved>();
  for (const row of rows) if (row.precision_resolved !== null) modes.add(row.precision_resolved);
  if (modes.size === 1) return [...modes][0];
  if (modes.size > 1) return null;
  return request.preciseMode === undefined ? null : request.preciseMode ? 'precise' : 'fast';
}

function envelope(request: ExploreRunRequest, started: number, guard: RuntimeGuard, reason: string): ExploreResponse {
  return {
    curve_status: 'invalid', points: [], sweep_schedule: [], step_outcomes: [], total_solve_time_ms: Math.round(guard.now() - started),
    precision_request: request.precisionRequest, precision_resolved: null, model_qualification: null, moa_qualification: moaQualificationOf(request.base), reason,
  };
}

/**
 * The response of a sweep as it stands: the launched rows, every scheduled target not launched as U (with the factual stop cause, when there is
 * one), the displayed frontier of the witnesses and the aggregates. The final response and every per-step snapshot are this function, so a
 * snapshot is exactly what the sweep would return if it stopped now. It never mutates its inputs.
 */
function buildResponse(
  request: ExploreRunRequest, targets: readonly SweepTarget[], launchedRows: readonly ExploreStepOutcome[],
  witnessResponses: ReadonlyMap<number, OptimizeResponse>, stopCause: 'cancelled' | 'deadline' | null, started: number, guard: RuntimeGuard,
): ExploreResponse {
  const rows: ExploreStepOutcome[] = [...launchedRows];
  // Targets never launched: U with the factual stop cause.
  for (let i = launchedRows.length; i < targets.length; i++) {
    rows.push(rowWithoutResponse(targets[i].target_index, 'U', request, stopCause === null ? undefined : stopReasonOf(stopCause)));
  }

  // Points: the displayed frontier of the witnesses; a dropped build keeps its V record with no point index.
  const candidates: Candidate[] = [];
  for (const [targetIndex, response] of witnessResponses) candidates.push({ targetIndex, point: explorePointOf(response, request.nakedRecoilV) });
  const frontier = displayFrontier(request.ignore, candidates);
  frontier.forEach((c, index) => { rows[c.targetIndex] = { ...rows[c.targetIndex], point_index: index }; });

  const counts = countOutcomes(rows.map(r => r.outcome));
  const curve = classifyCurve(counts);
  const precision_resolved = aggregateMode(rows, request);
  let reason: string | undefined;
  if (stopCause !== null) reason = stopReasonOf(stopCause);
  else if (curve === 'partial' || curve === 'invalid') reason = rows.find(r => r.outcome !== 'V' && r.reason !== undefined)?.reason;

  return {
    curve_status: curve,
    points: frontier.map(c => c.point),
    sweep_schedule: targets.map(t => ({ target_index: t.target_index, target_value: t.target_value })),
    step_outcomes: rows,
    total_solve_time_ms: Math.round(guard.now() - started),
    precision_request: request.precisionRequest,
    precision_resolved,
    model_qualification: precision_resolved === 'precise' ? 'exact' : precision_resolved === 'fast' ? 'approximate' : null,
    moa_qualification: moaQualificationOf(request.base),
    ...(reason === undefined ? {} : { reason }),
    // Fast with repeats off: every step ran the one-copy model (the sweep's own mode is uniform when it says 'fast').
    ...(precision_resolved === 'fast' && request.base.allowRepeatedParts !== true ? { single_copy: true as const } : {}),
  };
}

/**
 * Run the sweep. An empty or malformed schedule is `invalid` with no points and no solve. Otherwise every scheduled target is recorded exactly once;
 * see the file header for the classification and `classifyCurve` for the status. Typed errors of a target are rows (E), not failures of the sweep.
 * `onStep` (optional) is told the verified partial result after every launched target (see {@link ExploreStepObserver}).
 */
export async function runExplore(
  request: ExploreRunRequest, schedule: SweepSchedule, guard: RuntimeGuard, optimize: OptimizeFn, onStep?: ExploreStepObserver,
): Promise<ExploreResponse> {
  const started = guard.now();
  if (scheduleProblem(schedule) !== null) return envelope(request, started, guard, PUBLIC_REASONS.invalidExploreSchedule);

  const targets: SweepTarget[] = [...schedule.targets];
  const settled: SettledTarget[] = [];
  const rows: ExploreStepOutcome[] = [];
  const witnessResponses = new Map<number, OptimizeResponse>();
  let stopCause: 'cancelled' | 'deadline' | null = null;
  let next = 0;

  while (next < targets.length) {
    // Guard before every step, the first included.
    stopCause = guardStop(guard);
    if (stopCause !== null) break;
    const target = targets[next];
    let response: OptimizeResponse | null = null;
    let row: ExploreStepOutcome;
    let outcome: StepOutcome;
    try {
      response = await optimize(paramsOfTarget(request, target), guard);
      outcome = classifyResponse(response);
      if (outcome === 'E') {
        row = rowOfResponse(target.target_index, 'E', response, response.reason);
      } else if (outcome === 'U' && (response.status === 'optimal' || response.status === 'feasible') && response.reason === undefined) {
        // A published status without a valid witness: the build is rejected, not a point.
        row = rowOfResponse(target.target_index, 'U', response, PUBLIC_REASONS.independentBuildValidationFailed);
      } else {
        row = rowOfResponse(target.target_index, outcome, response, response.reason);
      }
    } catch (error) {
      response = null;
      if (guard.cancelled()) {
        // A cancel surfaced as a failure of the step: the target is unresolved because of the cancel, not a runtime error.
        outcome = 'U';
        row = rowWithoutResponse(target.target_index, 'U', request, PUBLIC_REASONS.cancelledByUser);
      } else {
        outcome = 'E';
        // A typed failure's own message is the only record of the cause. It is a diagnostic outside the closed set of public reasons, accepted
        // for E rows ONLY: no other row, response or snapshot carries a reason that is not in `PUBLIC_REASONS`.
        row = rowWithoutResponse(target.target_index, 'E', request, error instanceof Error ? error.message : String(error));
      }
    }
    rows.push(row);
    if (outcome === 'V' && response !== null) witnessResponses.set(target.target_index, response);
    settled.push({ target, outcome, response });
    next++;

    // The adaptive part of the schedule: generate the next target(s) now, before the guard is looked at again, so an early stop leaves them as U.
    if (schedule.extend !== undefined) {
      const appended = schedule.extend(settled);
      const problem = targetsProblem(appended, targets.length);
      if (problem !== null) throw new Error(`Explore schedule extension is invalid: ${problem}`);
      targets.push(...appended);
    }
    if (onStep !== undefined) {
      try {
        onStep({ launched: next, scheduled: targets.length, response: buildResponse(request, targets, rows, witnessResponses, null, started, guard) });
      } catch {
        // A failing observer must never change the sweep.
      }
    }
    // An explicit macrotask yield between steps (a pending cancel message can only be dispatched across one).
    if (next < targets.length) await guard.yieldMacrotask();
  }

  return buildResponse(request, targets, rows, witnessResponses, stopCause, started, guard);
}
