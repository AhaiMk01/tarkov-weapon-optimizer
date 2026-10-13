/**
 * The runtime guard of one request epoch (ADR 0013 section 4D, Phase 2.7): one queue-inclusive deadline, an out-of-band cancel flag, and explicit
 * macrotask yields. Every operation (Optimize, Explore, MOA floor, Gunsmith) checks the guard before each stage and after each yield; a microtask
 * await alone never lets the worker dispatch a cancel message, so long loops yield with {@link RuntimeGuard.yieldMacrotask}.
 *
 * The worker (Phase 2.7a) builds the real guard (its cancel flag is set by an out-of-band message that bypasses the dispatch chain); algorithms
 * (Phase 2.7b: floor discovery and bisection, the Explore sweep) only read it. Tests use {@link fixedGuard}.
 */

export interface RuntimeGuard {
  /** Absolute deadline of the request epoch, in the clock of {@link RuntimeGuard.now} (milliseconds). Queue time counts against it. */
  readonly deadline: number;
  now(): number;
  /** True once an out-of-band cancel of this request was observed. It can only change across a macrotask yield. */
  cancelled(): boolean;
  /** Yields to the event loop with a MACROTASK, so a pending cancel message can be dispatched (a microtask await is not enough). */
  yieldMacrotask(): Promise<void>;
}

/** Milliseconds left before the deadline, never negative. */
export const remainingMs = (guard: RuntimeGuard): number => Math.max(0, guard.deadline - guard.now());

/** Why a guard says stop, in the precedence of ADR 0013 section 6 (cancel before deadline), or `null` to go on. */
export function guardStop(guard: RuntimeGuard): 'cancelled' | 'deadline' | null {
  if (guard.cancelled()) return 'cancelled';
  if (guard.now() >= guard.deadline) return 'deadline';
  return null;
}

/** A macrotask yield that works in a Web Worker, a browser page and Node. */
export const yieldMacrotask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** A guard with a fixed deadline and an optional cancel source, for direct calls and tests. */
export function fixedGuard(deadline: number, options: { now?: () => number; cancelled?: () => boolean } = {}): RuntimeGuard {
  const now = options.now ?? ((): number => performance.now());
  const cancelled = options.cancelled ?? ((): boolean => false);
  return { deadline, now, cancelled, yieldMacrotask };
}
