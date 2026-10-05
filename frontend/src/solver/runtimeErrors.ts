/**
 * Typed runtime failures of a request (ADR 0013 sections 4D and 6, Phase 2.7a).
 *
 *  - {@link CancellationError}: the CLIENT abandoned the request (hard termination of the worker). Every active and queued promise is rejected
 *    with one, exactly once, and carries the last verified snapshot that was already published for that request.
 *  - {@link SolverError}: a native call failed. It travels as a typed error envelope, never as a normal (feasible or incomplete) result and
 *    never rewritten into an interrupt reason, together with the completion metadata of the search captured BEFORE the failure.
 *
 * DOM-free: the solver, the worker runtime, the client and the tests all read it.
 */

import { describeThrown, SolverError as NativeSolverError } from './native/errors';

/** What the search had established when a native call failed. A failed search never finished, so its termination is always `limit`. */
export interface CompletionMetadata {
  /** Outer spatial calls completed before the failure (the failing call is not counted). */
  nodes: number;
  termination: 'limit';
  /** A verified build existed when the failure happened. */
  witness: boolean;
  /** The proof bounds at that moment, in the transport form (`null` is unknown, never zero). */
  lower_bound: number | null;
  upper_bound: number | null;
  absolute_gap: number | null;
}

const completions = new WeakMap<object, CompletionMetadata>();

/**
 * Remember what the search had established on the error that is about to leave it. The innermost capture wins: it is the one closest to the
 * failure. Anything that is not an object cannot carry it and is returned unchanged.
 */
export function attachCompletion<E>(error: E, completion: CompletionMetadata): E {
  if (typeof error === 'object' && error !== null && !completions.has(error)) completions.set(error, completion);
  return error;
}

/** The completion metadata captured before a failure, `null` when none was (a failure outside any search). */
export function completionOf(error: unknown): CompletionMetadata | null {
  return typeof error === 'object' && error !== null ? completions.get(error) ?? null : null;
}

/**
 * The CLIENT abandoned the request: the worker was terminated (cancel escalated, cache cleared) and the promise rejected exactly once.
 * `snapshot` is the last verified snapshot the worker published for this request before it was abandoned, `null` when there was none.
 */
export class CancellationError extends Error {
  readonly reason: string;
  readonly snapshot: unknown;

  constructor(reason = 'Cancelled by user', snapshot: unknown = null) {
    super(reason);
    this.name = 'CancellationError';
    this.reason = reason;
    this.snapshot = snapshot;
  }
}

/**
 * A native call failed (a wasm trap, an uncaught C++ exception, an out-of-memory failure, an unexpected model status). It extends the native
 * `SolverError` (so `instanceof` the native class holds in the realm that threw it and in the one that revived it) with the completion
 * metadata of the search that was running.
 */
export class SolverError extends NativeSolverError {
  readonly completion: CompletionMetadata | null;

  constructor(phase: string, cause: unknown, corrupted = true, completion: CompletionMetadata | null = null) {
    super(phase, cause, corrupted);
    this.completion = completion;
    // Also readable through completionOf, so a revived error serializes with its metadata again.
    if (completion !== null) attachCompletion(this, completion);
  }
}

/** The structured-clone form of an error crossing the worker boundary. A plain `string` is the legacy form of a generic failure. */
export type SerializedWorkerError =
  | string
  | { kind: 'error'; name: string; message: string }
  | { kind: 'SolverError'; message: string; phase: string; corrupted: boolean; cause: string; completion: CompletionMetadata | null };

/** Serialize a failure for `postMessage`: a native `SolverError` keeps its type, phase, corruption flag and completion metadata. */
export function serializeWorkerError(error: unknown): SerializedWorkerError {
  if (error instanceof NativeSolverError) {
    return {
      kind: 'SolverError',
      message: error.message,
      phase: error.phase,
      corrupted: error.corrupted,
      cause: describeThrown(error.cause),
      completion: completionOf(error),
    };
  }
  if (error instanceof Error) return { kind: 'error', name: error.name, message: error.message };
  return { kind: 'error', name: 'Error', message: String(error) };
}

/** Rebuild the typed error on the receiving side. */
export function reviveWorkerError(payload: unknown): Error {
  if (typeof payload === 'string') return new Error(payload);
  if (typeof payload === 'object' && payload !== null) {
    const p = payload as Record<string, unknown>;
    if (p.kind === 'SolverError') {
      const s = payload as Extract<SerializedWorkerError, { kind: 'SolverError' }>;
      return new SolverError(s.phase, s.cause, s.corrupted, s.completion);
    }
    if (typeof p.message === 'string') {
      const error = new Error(p.message);
      if (typeof p.name === 'string') error.name = p.name;
      return error;
    }
  }
  return new Error('Web Worker failed');
}
