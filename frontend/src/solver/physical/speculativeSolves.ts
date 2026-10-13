/**
 * Speculative native solves of one Precise request on a solve pool (`native/pool.ts`; owner approval 2026-10-13, `docs/stage3/parallel-pool.md`).
 *
 * The rule that keeps results identical. The search, the opinions and their settlement run EXACTLY as without a pool, one solve after the other, in the
 * same order and with the same decisions. The pool only changes WHEN a solve's answer is computed: a solve the pipeline is likely to ask for soon (the
 * second opinion of a node, the first opinion of the next live node) is started early on an idle lane (`prefetch`), and when the pipeline asks for it
 * (`solve`), the answer of that early solve is handed over instead of solving again. Nothing is ever decided from a solve the sequential pipeline
 * would not have made: an early answer is read only when the pipeline asks for exactly that text with exactly those options, and an early solve the
 * pipeline never asks for is abandoned unread. So the opinions, their settlement (`settleOpinions`), the node evaluations, their commit order in the
 * search, the incumbent, the bounds, the node count and the returned build are those of the sequential run, whatever the timing.
 *
 * What may differ is only the native time allowance: an early solve was given the time left when it started (more than the sequential solve would
 * have had, never less). A solve that finishes within its allowance does not depend on it (HiGHS's search is deterministic for a text, its options
 * and its `random_seed`, with threads 1); a solve that reaches it is a time-limit stop, which is timing dependent with or without a pool.
 *
 * Interrupts. While the pipeline waits for a pool solve its event loop is free, so an out-of-band cancel is dispatched at once; this layer polls the
 * guard and, on a cancel (or the deadline passed by more than `DEADLINE_GRACE_MS`, a backstop behind the native time limit), terminates every
 * in-flight solve of the request and answers the waiting call with {@link SolveInterrupted}, which the pipeline turns into its usual unresolved
 * opinion (ADR 0013 section 6 precedence unchanged: the search reports the cancel or the deadline as before).
 */

import { HighsLoadError } from '../native';
import type { HighsOptions, NativeResult, SolveExtras } from '../native';
import type { SolveLanes, SolveTicket } from '../native/pool';
import type { RuntimeGuard } from '../runtimeGuard';
import type { SolveFn } from './nativeSolve';

/** Priority of a solve the pipeline is waiting for. */
export const PRIORITY_NEEDED = 0;
/** Priority of a node's speculative second opinion. */
export const PRIORITY_SECOND_OPINION = 1;
/** Priority of the first prefetched upcoming node (the r-th upcoming node gets this plus r). */
export const PRIORITY_PREFETCH = 2;
/** How often a waiting call checks the guard for a cancel, milliseconds. */
const POLL_MS = 20;
/** The deadline backstop: past the deadline by this much, the in-flight solves are terminated (the native time limit normally stops them first). */
export const DEADLINE_GRACE_MS = 1_000;

/** A waiting solve was interrupted: the request was cancelled, or its deadline passed. */
export class SolveInterrupted extends Error {
  readonly stop: 'cancelled' | 'deadline';

  constructor(stop: 'cancelled' | 'deadline') {
    super(stop === 'cancelled' ? 'the request was cancelled during a native solve' : 'the request deadline passed during a native solve');
    this.name = 'SolveInterrupted';
    this.stop = stop;
  }
}

interface Entry {
  ticket: SolveTicket;
  /** The node the speculative solve was started for (its abandonment follows the node). */
  tag: string;
}

export interface SpeculationStats {
  /** Speculative solves started, and of them those the pipeline then asked for (the rest were abandoned unread). */
  started: number;
  used: number;
  abandoned: number;
  /** Solves the pipeline asked for that no speculative solve had started. */
  direct: number;
}

/** The key of a solve: everything the native answer depends on (the text, every option but the time allowance, the structured-result requests). */
function keyOf(lpText: string, options: HighsOptions, extras: SolveExtras | undefined): string {
  const entries = Object.entries(options).filter(([name, value]) => name !== 'time_limit' && value !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const extra = Object.entries(extras ?? {}).filter(([, value]) => value !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${JSON.stringify(entries)}|${JSON.stringify(extra)}|${lpText}`;
}

export class RequestSolves {
  private readonly lanes: SolveLanes;
  private readonly guard: RuntimeGuard;
  private readonly entries = new Map<string, Entry>();
  /** Solves the pipeline is waiting for right now (terminated on an interrupt). */
  private readonly waiting = new Set<SolveTicket>();
  readonly stats: SpeculationStats = { started: 0, used: 0, abandoned: 0, direct: 0 };

  /** The in-thread solve, used only when the pool has lost every worker and cannot reload one (`HighsLoadError` from the pool). */
  private readonly fallback: SolveFn;

  constructor(lanes: SolveLanes, guard: RuntimeGuard, fallback: SolveFn) {
    this.lanes = lanes;
    this.guard = guard;
    this.fallback = fallback;
  }

  get size(): number {
    return this.lanes.size;
  }

  /** The solve function of the pipeline: an early answer for exactly this text and these options, else a solve started now. */
  readonly solve: SolveFn = async (lpText, options, extras) => {
    const key = keyOf(lpText, options, extras);
    const early = this.entries.get(key);
    let ticket: SolveTicket;
    if (early !== undefined) {
      this.entries.delete(key);
      this.stats.used++;
      ticket = early.ticket;
      ticket.promote(PRIORITY_NEEDED);
    } else {
      this.stats.direct++;
      ticket = this.lanes.start(lpText, options, extras ?? {}, PRIORITY_NEEDED);
    }
    this.waiting.add(ticket);
    try {
      return await this.awaitWithInterrupts(ticket.result);
    } catch (error) {
      // The pool has no worker left and none reloads: the request continues on the in-thread instance (the same pinned build), as a pool of one.
      if (error instanceof HighsLoadError) return this.fallback(lpText, options, extras);
      throw error;
    } finally {
      this.waiting.delete(ticket);
    }
  };

  /** Start `lpText` early for the node `tag` (no-op when the same solve is already started). The options must be exactly those the pipeline will pass. */
  prefetch(tag: string, lpText: string, options: HighsOptions, extras: SolveExtras, priority: number): void {
    const key = keyOf(lpText, options, extras);
    if (this.entries.has(key)) return;
    this.stats.started++;
    this.entries.set(key, { ticket: this.lanes.start(lpText, options, extras, priority), tag });
  }

  /** The tags that have early solves outstanding. */
  tags(): Set<string> {
    return new Set([...this.entries.values()].map(e => e.tag));
  }

  /** Abandon the early solves of every node for which `drop(tag)` holds. */
  abandonWhere(drop: (tag: string) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (!drop(entry.tag)) continue;
      this.entries.delete(key);
      this.stats.abandoned++;
      entry.ticket.abandon();
    }
  }

  /** Abandon every early solve and every solve being waited for (the end of the request, or an interrupt). */
  abandonAll(): void {
    this.abandonWhere(() => true);
    for (const ticket of this.waiting) ticket.abandon();
  }

  private interruptCause(): 'cancelled' | 'deadline' | null {
    if (this.guard.cancelled()) return 'cancelled';
    if (this.guard.now() > this.guard.deadline + DEADLINE_GRACE_MS) return 'deadline';
    return null;
  }

  private awaitWithInterrupts(result: Promise<NativeResult>): Promise<NativeResult> {
    return new Promise<NativeResult>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => { done = true; if (timer !== undefined) clearTimeout(timer); };
      const poll = (): void => {
        if (done) return;
        const cause = this.interruptCause();
        if (cause !== null) {
          finish();
          this.abandonAll();
          reject(new SolveInterrupted(cause));
          return;
        }
        timer = setTimeout(poll, POLL_MS);
      };
      result.then(r => { if (!done) { finish(); resolve(r); } }, e => { if (!done) { finish(); reject(e); } });
      timer = setTimeout(poll, POLL_MS);
    });
  }
}
