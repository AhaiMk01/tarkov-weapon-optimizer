/**
 * The client side of the worker connection (ADR 0013 section 4D, Phase 2.7a): request queue, epoch deadlines, soft cancel and hard termination.
 *
 * DOM-free and worker-injectable, so the queue logic is unit-tested with a fake worker; `client.ts` wires the real `Worker`.
 *
 *  - EPOCH DEADLINE. A request with a `timeLimitMs` gets ONE absolute epoch deadline (`clock() + timeLimitMs`), stamped when `send` is called
 *    and carried in the message, so the time it waits behind other requests in the worker counts against it.
 *  - SOFT CANCEL (`AbortSignal` or {@link WorkerChannel.cancel}). A `cancel` message is posted for the request; the worker handles it out of
 *    band and the operation resolves normally with its retained state and the reason `Cancelled by user`. If the request is still pending after
 *    `escalateAfterMs` (a native solve cannot be interrupted, only bounded by its time limit) the cancel escalates to a hard termination.
 *  - HARD TERMINATION ({@link WorkerChannel.terminate}). Every active and queued promise is rejected exactly once with a
 *    {@link CancellationError} carrying the last snapshot already published for it, the worker is terminated and the next request starts a
 *    fresh one. Late messages of the terminated worker are ignored.
 *  - A worker crash rejects every pending request with the failure (not a cancellation), terminates the worker, and the next request starts a
 *    fresh one.
 */

import { epochNow } from '../solver/requestGuard';
import { CancellationError, reviveWorkerError } from '../solver/runtimeErrors';
import type { WorkerInMessage, WorkerOperation, WorkerOutMessage, WorkerPayload } from '../solver/workerProtocol';

/** The slice of a `Worker` the channel uses. */
export interface WorkerLike {
  postMessage(message: WorkerInMessage): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerOutMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

export interface RequestOptions {
  /** Aborting the signal soft-cancels the request (see the file header). An already aborted signal rejects at once without posting. */
  signal?: AbortSignal;
  /** Called with each verified snapshot the worker publishes for this request; the last one is kept for a {@link CancellationError}. */
  onSnapshot?: (snapshot: unknown) => void;
}

export interface SendOptions extends RequestOptions {
  /** The request budget; the epoch deadline is stamped now. `null` or absent: no deadline (a metadata operation). */
  timeLimitMs?: number | null;
}

export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ChannelOptions {
  createWorker: () => WorkerLike;
  /** Epoch milliseconds (default `epochNow`). */
  clock?: () => number;
  /** How long a soft-cancelled request may stay pending before the cancel escalates to a hard termination; `null` never escalates. Default 2000. */
  escalateAfterMs?: number | null;
  timers?: Timers;
}

const realTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  /** The last verified snapshot published for this request. */
  snapshot: unknown;
  onSnapshot?: (snapshot: unknown) => void;
  /** Removes the abort listener and the escalation timer. */
  cleanup(): void;
}

export class WorkerChannel {
  private worker: WorkerLike | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly createWorker: () => WorkerLike;
  private readonly clock: () => number;
  private readonly escalateAfterMs: number | null;
  private readonly timers: Timers;

  constructor(options: ChannelOptions) {
    this.createWorker = options.createWorker;
    this.clock = options.clock ?? epochNow;
    this.escalateAfterMs = options.escalateAfterMs === undefined ? 2000 : options.escalateAfterMs;
    this.timers = options.timers ?? realTimers;
  }

  /** Requests posted and not yet settled. */
  get pendingCount(): number {
    return this.pending.size;
  }

  send<T>(type: WorkerOperation, payload: WorkerPayload, options: SendOptions = {}): Promise<T> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new CancellationError());
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      const deadline = options.timeLimitMs === undefined || options.timeLimitMs === null ? undefined : this.clock() + Math.max(0, options.timeLimitMs);
      let timer: unknown;
      const onAbort = (): void => {
        this.cancel(id);
        if (this.escalateAfterMs !== null && this.pending.has(id)) {
          timer = this.timers.set(() => { if (this.pending.has(id)) this.terminate(); }, this.escalateAfterMs);
        }
      };
      const record: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        snapshot: null,
        onSnapshot: options.onSnapshot,
        cleanup: () => {
          signal?.removeEventListener('abort', onAbort);
          if (timer !== undefined) this.timers.clear(timer);
        },
      };
      this.pending.set(id, record);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.getWorker().postMessage({ type, id, payload: deadline === undefined ? payload : { ...payload, deadline } });
      } catch (error) {
        // The message could not be posted (a payload that cannot be cloned): this request fails, the channel stays usable.
        this.pending.delete(id);
        record.cleanup();
        reject(error);
      }
    });
  }

  /**
   * SOFT cancel of one request: an out-of-band message the worker acts on at its next guard check. The request still settles normally (its
   * response carries `Cancelled by user`). No effect on a request that already settled.
   */
  cancel(id: number): void {
    if (!this.pending.has(id) || this.worker === null) return;
    this.worker.postMessage({ type: 'cancel', id: this.nextId++, payload: { targetId: id } });
  }

  /**
   * HARD termination: reject every active and queued request exactly once with a {@link CancellationError} (keeping its last published
   * snapshot), terminate the worker and start a fresh one on the next request.
   */
  terminate(reason = 'Cancelled by user'): void {
    const victims = [...this.pending.values()];
    this.pending.clear();
    this.dropWorker();
    for (const record of victims) {
      record.cleanup();
      record.reject(new CancellationError(reason, record.snapshot));
    }
  }

  /** The worker failed (crash, message error): every pending request is rejected with the failure, the worker is replaced on the next request. */
  private fail(error: Error): void {
    const victims = [...this.pending.values()];
    this.pending.clear();
    this.dropWorker();
    for (const record of victims) {
      record.cleanup();
      record.reject(error);
    }
  }

  private dropWorker(): void {
    const w = this.worker;
    this.worker = null;
    if (w === null) return;
    // Detach first: a message already in flight from the terminated worker must not settle anything.
    w.onmessage = null;
    w.onerror = null;
    w.onmessageerror = null;
    w.terminate();
  }

  private getWorker(): WorkerLike {
    if (this.worker === null) {
      const w = this.createWorker();
      w.onmessage = (event): void => {
        if (this.worker !== w) return;
        const { type, id, payload } = event.data;
        const record = this.pending.get(id);
        if (record === undefined) return;
        if (type === 'snapshot') {
          record.snapshot = payload;
          record.onSnapshot?.(payload);
          return;
        }
        this.pending.delete(id);
        record.cleanup();
        if (type === 'error') record.reject(reviveWorkerError(payload));
        else record.resolve(payload);
      };
      w.onerror = (event): void => {
        if (this.worker !== w) return;
        console.error('Worker error:', event);
        this.fail(new Error(event.message || 'Web Worker failed'));
      };
      w.onmessageerror = (event): void => {
        if (this.worker !== w) return;
        console.error('Worker message error:', event);
        this.fail(new Error('Web Worker message error'));
      };
      this.worker = w;
    }
    return this.worker;
  }
}
