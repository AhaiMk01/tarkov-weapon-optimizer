/**
 * One native model solve under the presolve policy (ADR 0013 section 4B, Phase 2.4b-3b).
 *
 * HiGHS 1.15.1 with presolve ON reports some feasible models `Infeasible` (tests/physical/solverDefects/native_presolve_false_infeasible.lp
 * is a 6-row example, tests/physical/nativeSolve.test.ts proves the policy catches it). With presolve OFF the pinned build agreed with the
 * reference oracle everywhere it was tried.
 *
 * Which setting the search runs with is ONE named constant per model family (`PRECISE_PRESOLVE`, `FAST_PRESOLVE`), so Stage 4 can benchmark it.
 * The physical (Precise) models run with presolve OFF. Orchestrator measurement, 2026-10-04, pinned snapshot, `specializeLP` with weights
 * e 0.4, r 0.4, p 0.2, pinned native build, 60 s limit, mip_rel_gap = mip_abs_gap = 1e-6 (presolve ON vs OFF):
 *   TRG M10 0.4 s vs 0.1 s; MPX 9.2 s vs 5.8 s; VSS 1.7 s vs 0.4 s; NL545 DI 27.8 s vs 8.9 s (presolve alone took 12.9 of 28.6 s);
 *   AK-105 time limit at gap 47% vs optimal in 30.0 s; AK-74N gap 61% vs 54%; M4A1 no incumbent vs an incumbent at gap 83%.
 * Wherever both runs finished, the optima were identical. Presolve off is also the setting that cannot produce the false Infeasible.
 *
 * Rule that holds for every setting: no infeasibility verdict is ever accepted from a PRESOLVED solve. A first solve with presolve off is its
 * own confirmation. A first solve with presolve on that says Infeasible is CONFIRMED by re-solving the same text with presolve off:
 *
 *   - the confirmation finds a solution: that solution is used (`presolveRescue`), the first verdict was the presolve defect;
 *   - the confirmation is infeasible too: the verdict stands (`infeasible`);
 *   - the confirmation times out or the native call fails: the verdict is UNRESOLVED (`unresolved`), never infeasible.
 *
 * Any other model status that is neither optimal, a limit stop nor an infeasibility claim (a model or solve error, an unbounded
 * report on a model whose columns are all finite) is a native failure and raises the typed `SolverError`: it never becomes a normal result.
 */

import { getNativeHighs, SolverError } from '../native';
import type { HighsOptions, ModelStatusName, NativeResult } from '../native';

/** The solve call, injectable so the policy is tested without a native build (production: the shared pinned instance). */
export type SolveFn = (lpText: string, options: HighsOptions) => Promise<NativeResult>;

export const nativeSolve: SolveFn = (lpText, options) => getNativeHighs().solveStructured(lpText, options);

/** HiGHS statuses that claim the model has no feasible point. A model with all-finite columns is never unbounded. */
const INFEASIBLE_STATUSES: ReadonlySet<string> = new Set<ModelStatusName>(['Infeasible', 'UnboundedOrInfeasible']);

/** Statuses that end a solve early: a primal solution may or may not exist, and nothing is claimed about the optimum. */
const LIMIT_STATUSES: ReadonlySet<string> = new Set<ModelStatusName>([
  'TimeLimit', 'IterationLimit', 'SolutionLimit', 'ObjectiveBound', 'ObjectiveTarget', 'Interrupt', 'MemoryLimit', 'HighsInterrupt', 'Unknown',
]);

export const isInfeasibleStatus = (name: string): boolean => INFEASIBLE_STATUSES.has(name);
export const isLimitStatus = (name: string): boolean => LIMIT_STATUSES.has(name);

/** Native feasibility tolerance of every solve: the model text carries exact coefficients, so the solver is held to them. */
export const NATIVE_FEASIBILITY_TOLERANCE = 1e-9;

/** The largest native MIP gap ever used: the pre-cutover value, so a loose request tolerance never loosens the native search. */
const MAX_NATIVE_ABS_GAP = 1e-9;

/**
 * Native options derived from the request's absolute objective tolerance `tau`. The native MIP gap is at most `tau / 4` (and at most 1e-9):
 * the final certificate adds the spatial fathoming tolerance and numeric noise on top of the native gap, so the native search has to be
 * finer than the claim it supports. The relative gap is 0, feasibility tolerances are the strict ones the model text was written for.
 */
export function nativeSolveOptions(tau: number): HighsOptions {
  const gap = Math.min(MAX_NATIVE_ABS_GAP, Math.max(0, tau) / 4);
  return {
    mip_rel_gap: 0,
    mip_abs_gap: gap,
    mip_feasibility_tolerance: NATIVE_FEASIBILITY_TOLERANCE,
    primal_feasibility_tolerance: NATIVE_FEASIBILITY_TOLERANCE,
    dual_feasibility_tolerance: NATIVE_FEASIBILITY_TOLERANCE,
  };
}

export type PresolveSetting = 'off' | 'choose';

/**
 * Presolve of the physical (Precise) models: off. See the measurement above. Change it here and only here; a setting other than 'off' makes
 * every Infeasible verdict cost a confirmation solve.
 */
export const PRECISE_PRESOLVE: PresolveSetting = 'off';

/** Presolve of the legacy template (Fast) model, which was not part of that measurement and keeps HiGHS's default until Phase 2.4c rewrites it. */
export const FAST_PRESOLVE: PresolveSetting = 'choose';

/** A positive native time allowance, at least one millisecond, for the time that remains (callers check `remaining > 0` first). */
export const nativeTimeLimitSeconds = (remainingMs: number): number => Math.max(0.001, remainingMs / 1000);

export interface PolicyContext {
  /** Native options without `time_limit` and `presolve`: the policy owns both. */
  options: HighsOptions;
  /** Absolute deadline on the `now` clock, milliseconds. */
  deadline: number;
  now?: () => number;
  solve?: SolveFn;
  /** Presolve of the first solve (default {@link PRECISE_PRESOLVE}). */
  presolve?: PresolveSetting;
}

export type PolicyOutcome =
  /** An optimal solve or a limit stop (inspect `result.modelStatus` and `result.colValues`). `presolveRescue`: presolve called it infeasible. */
  | { kind: 'solved'; result: NativeResult; presolveRescue: boolean }
  /**
   * A verdict that no presolved solve decided alone: the first solve was presolve off (`confirmation` null), or it was presolve on and a
   * presolve-off re-solve was infeasible too.
   */
  | { kind: 'infeasible'; first: NativeResult; confirmation: NativeResult | null }
  /** The infeasibility verdict could not be confirmed (or there was no time to start); never an infeasibility claim. */
  | { kind: 'unresolved'; cause: 'deadline' | 'native_error'; first: NativeResult | null; detail: string };

const defaultNow = (): number => performance.now();

function unexpectedStatus(result: NativeResult): SolverError {
  return new SolverError('solve', new Error(`HiGHS returned the unexpected model status ${result.modelStatus.name} (${result.modelStatus.code})`), false);
}

export async function solveWithPresolvePolicy(lpText: string, context: PolicyContext): Promise<PolicyOutcome> {
  const now = context.now ?? defaultNow;
  const solve = context.solve ?? nativeSolve;
  const remaining = (): number => context.deadline - now();

  if (remaining() <= 0) return { kind: 'unresolved', cause: 'deadline', first: null, detail: 'no time remained to start the solve' };
  const presolve = context.presolve ?? PRECISE_PRESOLVE;
  const first = await solve(lpText, { ...context.options, presolve, time_limit: nativeTimeLimitSeconds(remaining()) });
  const status = first.modelStatus.name;
  if (status === 'Optimal' || isLimitStatus(status)) return { kind: 'solved', result: first, presolveRescue: false };
  if (!isInfeasibleStatus(status)) throw unexpectedStatus(first);
  if (presolve === 'off') return { kind: 'infeasible', first, confirmation: null };

  // Presolve said infeasible: confirm with presolve off before the verdict is used.
  if (remaining() <= 0) return { kind: 'unresolved', cause: 'deadline', first, detail: 'no time remained to confirm the infeasibility with presolve off' };
  let confirmation: NativeResult;
  try {
    confirmation = await solve(lpText, { ...context.options, presolve: 'off', time_limit: nativeTimeLimitSeconds(remaining()) });
  } catch (error) {
    if (error instanceof SolverError) return { kind: 'unresolved', cause: 'native_error', first, detail: `the presolve-off confirmation failed: ${error.message}` };
    throw error;
  }
  const confirmed = confirmation.modelStatus.name;
  if (confirmed === 'Optimal') return { kind: 'solved', result: confirmation, presolveRescue: true };
  if (isInfeasibleStatus(confirmed)) return { kind: 'infeasible', first, confirmation };
  if (isLimitStatus(confirmed)) {
    // A limit stop that holds a primal solution proves the model feasible; without one the verdict stays open.
    if (confirmation.colValues !== null) return { kind: 'solved', result: confirmation, presolveRescue: true };
    return {
      kind: 'unresolved',
      cause: confirmed === 'TimeLimit' ? 'deadline' : 'native_error',
      first,
      detail: `the presolve-off confirmation ended with ${confirmed} and no solution`,
    };
  }
  return { kind: 'unresolved', cause: 'native_error', first, detail: `the presolve-off confirmation returned the model status ${confirmed}` };
}
