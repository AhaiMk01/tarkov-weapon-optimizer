/**
 * Helpers around the shared {@link RuntimeGuard} (ADR 0013 section 4D, Phase 2.7a).
 *
 * The request epoch has ONE clock, epoch milliseconds (`performance.timeOrigin + performance.now()`): the page and the worker have different
 * `performance.now()` origins, so only the epoch sum is comparable between the client that stamps the deadline and the worker that checks it.
 * Everything below is DOM-free so the solver, the worker runtime and the tests can read it.
 */

import { fixedGuard } from './runtimeGuard';
import type { RuntimeGuard } from './runtimeGuard';

/** Epoch milliseconds, monotonic within a realm: the clock of a request epoch. */
export const epochNow = (): number => performance.timeOrigin + performance.now();

/** The same guard with a nearer deadline (a sub-solve given a share of the request's time). It never extends the parent's deadline. */
export function withDeadline(guard: RuntimeGuard, deadline: number): RuntimeGuard {
  const limit = Math.min(guard.deadline, deadline);
  return {
    deadline: limit,
    now: () => guard.now(),
    cancelled: () => guard.cancelled(),
    yieldMacrotask: () => guard.yieldMacrotask(),
  };
}

/**
 * The guard of a pipeline context: the request's own, or one built from a plain absolute deadline on the `now` clock (a direct caller with no
 * cancel source). A context with neither is a programming error: no solve runs without a deadline.
 */
export function guardOfContext(context: { guard?: RuntimeGuard; deadline?: number; now?: () => number }): RuntimeGuard {
  if (context.guard !== undefined) return context.guard;
  if (context.deadline === undefined) throw new TypeError('a solve context needs a guard or an absolute deadline');
  return fixedGuard(context.deadline, context.now === undefined ? {} : { now: context.now });
}
