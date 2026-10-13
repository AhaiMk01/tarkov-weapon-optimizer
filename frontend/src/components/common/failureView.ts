/**
 * How a REJECTED request is shown (ADR 0013 sections 4D and 6, Phase 2.8). A request promise can settle three ways:
 *
 *  - it resolves with a response (the response says whether it is optimal, feasible, incomplete, infeasible or cancelled: `resultView.ts`);
 *  - it rejects with a `CancellationError`: the CLIENT abandoned the request (the worker was terminated). That is a cancel, not an error, and the
 *    error carries the last verified snapshot the worker published for the request, if any;
 *  - it rejects with a `SolverError`: a native call failed. That is an error, never a normal result, and the error carries what the search had
 *    established before it failed (its completion metadata: nodes, whether a verified build existed, the proof bounds, a floor's retained state).
 *
 * Anything else is an unexpected failure. The classification is total and pure.
 */

import { CancellationError, SolverError } from '../../solver/runtimeErrors';
import type { CompletionMetadata } from '../../solver/runtimeErrors';
import { boundsViewOf } from './resultView';
import type { BoundsView } from './resultView';

export type Failure =
  /** The request was abandoned by the client. `snapshot` is the last verified partial result it published (`unknown`: its shape is the operation's). */
  | { kind: 'cancelled'; reason: string; snapshot: unknown }
  /** A native solver call failed. */
  | { kind: 'solver'; message: string; phase: string; corrupted: boolean; completion: CompletionMetadata | null; bounds: BoundsView | null }
  | { kind: 'unknown'; message: string };

export function classifyFailure(error: unknown): Failure {
  if (error instanceof CancellationError) return { kind: 'cancelled', reason: error.reason, snapshot: error.snapshot };
  if (error instanceof SolverError) {
    const completion = error.completion;
    return {
      kind: 'solver',
      message: error.message,
      phase: error.phase,
      corrupted: error.corrupted,
      completion,
      bounds: completion === null ? null : boundsViewOf(completion),
    };
  }
  return { kind: 'unknown', message: error instanceof Error ? error.message : String(error) };
}
