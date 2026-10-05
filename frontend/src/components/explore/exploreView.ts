/**
 * How an Explore sweep is shown (ADR 0013 section 6 "Explore: total classification and precedence", Phase 2.8). Pure: no React, no antd, no
 * solver imports (type-only imports of the transport shapes).
 *
 * `curve_status` is DISCRETE SCHEDULE COVERAGE, never continuous Pareto optimality:
 *   complete    every scheduled target got a verified witness (V) or a certified emptiness (I)
 *   partial     at least one witness, but some target is unresolved (U) or failed (E)
 *   infeasible  every scheduled target is certified empty
 *   invalid     no witness and some target unresolved or failed, or the request itself was rejected
 * A point is a verified witness; each carries the proof and qualification fields of the Optimize result that produced it.
 */

import type { ExplorePoint, ExploreResponse, ExploreSnapshot, ExploreStepOutcome } from '../../api/client';
import { levelOf, qualifiersOf, reasonViewOf } from '../common/resultView';
import type { AuthorityInput, AuthorityLevel, Qualifier, ReasonView, Tone } from '../common/resultView';

export type CurveStatus = ExploreResponse['curve_status'];

export const CURVE_TONE: Record<CurveStatus, Tone> = { complete: 'success', partial: 'warning', infeasible: 'error', invalid: 'error' };

/** i18n key of the headline of a curve status, `explore.curve_<status>`. */
export const curveStatusKey = (status: CurveStatus): string => `explore.curve_${status}`;
/** i18n key of what a curve status MEANS, `explore.curve_<status>_meaning`. */
export const curveMeaningKey = (status: CurveStatus): string => `explore.curve_${status}_meaning`;
export const CURVE_STATUSES: readonly CurveStatus[] = ['complete', 'partial', 'infeasible', 'invalid'];

export interface OutcomeCounts { V: number; I: number; U: number; E: number }

export interface UnresolvedTarget {
  targetIndex: number;
  /** The value of the swept axis this target aimed at, `null` when the schedule does not record it. */
  targetValue: number | null;
  outcome: 'U' | 'E';
  /** `null` for a target with no reason (not launched yet, in a live snapshot). */
  reason: ReasonView | null;
}

export interface Coverage {
  total: number;
  counts: OutcomeCounts;
  /** Every target without a witness or a certified emptiness, with its reason. */
  unresolved: UnresolvedTarget[];
}

/**
 * The per-target coverage of a response: the counts of V, I, U and E, and which targets are unresolved or failed, with their reasons.
 * `fallbackReason` is the factual cause to show for a target that carries none: the retained snapshot of a cancelled run lists the targets that
 * never started as U without a reason, and the cancel is why they did not.
 */
export function coverageOf(response: Pick<ExploreResponse, 'step_outcomes' | 'sweep_schedule'>, fallbackReason?: string): Coverage {
  const counts: OutcomeCounts = { V: 0, I: 0, U: 0, E: 0 };
  const unresolved: UnresolvedTarget[] = [];
  const values = new Map(response.sweep_schedule.map(t => [t.target_index, t.target_value]));
  for (const row of response.step_outcomes) {
    counts[row.outcome]++;
    if (row.outcome === 'U' || row.outcome === 'E') {
      unresolved.push({
        targetIndex: row.target_index, targetValue: values.get(row.target_index) ?? null, outcome: row.outcome, reason: reasonViewOf(row.reason ?? fallbackReason),
      });
    }
  }
  return { total: response.step_outcomes.length, counts, unresolved };
}

/** The step row that produced a point, `null` when the point is not referenced by any row. */
export function stepOfPoint(response: Pick<ExploreResponse, 'step_outcomes'>, pointIndex: number): ExploreStepOutcome | null {
  return response.step_outcomes.find(r => r.point_index === pointIndex) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Runs: one sweep per weapon
// ---------------------------------------------------------------------------------------------

export type RunPhase = 'running' | 'done' | 'cancelled' | 'failed';

/** One weapon's sweep as the UI holds it. `response` is the final response, or the last retained snapshot when the run did not finish. */
export interface ExploreWeaponRun {
  weaponId: string;
  weaponName: string;
  response: ExploreResponse | null;
  phase: RunPhase;
  /** Targets launched / scheduled so far (live snapshot), when known. */
  launched?: number;
  scheduled?: number;
  /** The message of a failure (a typed solver error or an unexpected one). */
  error?: string;
}

/**
 * The response of a run as far as it has settled. A live snapshot lists every scheduled target, the ones not launched yet as U without a reason;
 * while the run is running only the first `launched` rows are results (targets launch in order), so the coverage of a running sweep counts those
 * and not the targets still waiting. A finished (or retained) run is its response unchanged.
 */
export function settledResponseOf(run: Pick<ExploreWeaponRun, 'response' | 'phase' | 'launched'>): ExploreResponse | null {
  const { response } = run;
  if (response === null || run.phase !== 'running' || run.launched === undefined) return response;
  return { ...response, step_outcomes: response.step_outcomes.slice(0, run.launched) };
}

/** All plotted points of the runs, each tagged with its weapon. */
export function pointsOfRuns(runs: readonly ExploreWeaponRun[]): ExplorePoint[] {
  const points: ExplorePoint[] = [];
  for (const run of runs) {
    for (const p of run.response?.points ?? []) points.push({ ...p, weapon_id: run.weaponId, weapon_name: run.weaponName });
  }
  return points;
}

export interface RunsSummary {
  tone: Tone;
  total: number;
  running: number;
  /** Runs by the curve status of their response (a retained snapshot counts as what it was when the run ended). */
  byCurve: Record<CurveStatus, number>;
  failed: number;
  cancelled: number;
  /** Every finished run has curve status `complete`. */
  allComplete: boolean;
}

export function summarizeRuns(runs: readonly ExploreWeaponRun[], total: number): RunsSummary {
  const byCurve: Record<CurveStatus, number> = { complete: 0, partial: 0, infeasible: 0, invalid: 0 };
  let running = 0;
  let failed = 0;
  let cancelled = 0;
  for (const run of runs) {
    if (run.phase === 'running') running++;
    if (run.phase === 'failed') failed++;
    if (run.phase === 'cancelled') cancelled++;
    if (run.response !== null && run.phase !== 'running') byCurve[run.response.curve_status]++;
  }
  const allComplete = total > 0 && running === 0 && failed === 0 && cancelled === 0 && byCurve.complete === total;
  let tone: Tone;
  // A run in progress and a cancelled one are informational: neither is an error, and a cancel keeps its points.
  if (running > 0 || cancelled > 0) tone = 'info';
  else if (allComplete) tone = 'success';
  // Nothing but certified-empty or invalid sweeps: no weapon produced a point.
  else if (byCurve.complete === 0 && byCurve.partial === 0 && cancelled === 0) tone = 'error';
  else tone = 'warning';
  return { tone, total, running, byCurve, failed, cancelled, allComplete };
}

// ---------------------------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Is this a response shaped well enough to read (the live snapshot and the retained one are validated before they reach the UI)? */
export function isExploreResponse(v: unknown): v is ExploreResponse {
  return isObject(v) && typeof v.curve_status === 'string' && v.curve_status in CURVE_TONE && Array.isArray(v.points)
    && Array.isArray(v.step_outcomes) && Array.isArray(v.sweep_schedule);
}

/** A published Explore snapshot (also what a `CancellationError` carries for a hard-terminated Explore), or `null` for anything else. */
export function asExploreSnapshot(v: unknown): ExploreSnapshot | null {
  if (!isObject(v) || typeof v.launched !== 'number' || typeof v.scheduled !== 'number' || !isExploreResponse(v.response)) return null;
  return { launched: v.launched, scheduled: v.scheduled, response: v.response };
}

/** The retained snapshot of an abandoned Explore request (`CancellationError.snapshot`), or `null` when it published none. */
export function retainedExploreOf(error: unknown): ExploreSnapshot | null {
  return isObject(error) ? asExploreSnapshot(error.snapshot) : null;
}

// ---------------------------------------------------------------------------------------------
// Authority of the points
// ---------------------------------------------------------------------------------------------

/** How many points sit at each authority level: a sweep of Fast results is approximate, never "proved" because it is complete. */
export function authorityCounts(points: readonly AuthorityInput[]): Record<AuthorityLevel, number> {
  const counts: Record<AuthorityLevel, number> = {
    certified_optimal: 0, approximate_optimal: 0, feasible: 0, incomplete: 0, certified_infeasible: 0, error: 0,
  };
  for (const p of points) counts[levelOf(p)]++;
  return counts;
}

/** The model caveats of the sweep: the union over the runs of what each response says it ran on. */
export function runQualifiers(runs: readonly ExploreWeaponRun[]): Qualifier[] {
  const found = new Set<Qualifier>();
  for (const run of runs) {
    const r = run.response;
    if (r === null) continue;
    for (const q of qualifiersOf({ model_qualification: r.model_qualification, moa_qualification: r.moa_qualification, precision_resolved: r.precision_resolved })) found.add(q);
    // Every point and step row carries its own qualification; a sweep with a Fast point is approximate even if the aggregate is null (mixed).
    for (const p of r.points) for (const q of qualifiersOf(p)) found.add(q);
  }
  return [...found];
}

// ---------------------------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------------------------

export interface ExploreToast {
  type: 'success' | 'info' | 'warning' | 'error';
  /** i18n key of the message. */
  key: string;
  params: Record<string, string | number>;
}

/**
 * The toast of a finished Explore request (one or several weapons). "Complete" is said only for full discrete schedule coverage, and a cancel is an
 * info message that keeps its points, never an error.
 */
export function exploreToastOf(runs: readonly ExploreWeaponRun[], total: number): ExploreToast {
  const summary = summarizeRuns(runs, total);
  const points = runs.reduce((n, r) => n + (r.response?.points.length ?? 0), 0);
  if (summary.cancelled > 0) return { type: 'info', key: 'toast.explore_cancelled', params: { count: points } };
  if (summary.failed > 0 && points > 0) return { type: 'warning', key: 'toast.explore_compare_partial', params: { failed: summary.failed, total } };
  if (summary.failed >= total) return { type: 'error', key: 'toast.explore_failed', params: {} };
  if (summary.allComplete) return { type: 'success', key: 'toast.explore_success', params: {} };
  if (points > 0) return { type: 'warning', key: 'toast.explore_partial', params: {} };
  const empty = runs.filter(r => r.response?.curve_status === 'infeasible').map(r => r.weaponName);
  if (empty.length > 0) return { type: 'error', key: 'toast.explore_infeasible', params: { names: empty.join(', ') } };
  return { type: 'warning', key: 'toast.explore_empty', params: {} };
}
