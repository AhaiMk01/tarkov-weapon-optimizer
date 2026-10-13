/**
 * The native solve pool: N instances of the pinned HiGHS build, each in its own worker, solving independent texts at the same time (owner approval
 * 2026-10-13, `docs/stage3/parallel-pool.md`).
 *
 * Why every lane is a worker. With a pool, the solver worker only orchestrates: every Precise solve runs in a pool worker and the solver worker's
 * event loop stays free, so a result from one lane is dispatched (and the lane given its next text) while another lane is still solving, and an
 * out-of-band cancel is observed at once (the in-flight solves are then terminated, `speculativeSolves.ts`). An in-thread lane would block that
 * loop for the length of its solve. Pool size 1 is no pool: the in-thread shared instance (`instance.ts`), exactly as before.
 *
 * Workers. Browser: a dedicated module Worker nested in the solver worker (`poolWorker.ts`, bundled by Vite as a worker chunk); Node
 * (tests, benchmarks): a `worker_threads` worker running the same file. Every pool worker loads its instance through `loadHighs` with the SHA-256
 * check and the ABI validation; nothing else is ever loaded. When nested workers are unavailable (feature detection) or a pool worker fails to load,
 * the pool is not used and Precise runs on the in-thread instance (size 1).
 *
 * Scheduling. Each solve is a job with a priority (lower first; FIFO within a priority). A lane takes the best queued job when it is idle. A job of
 * priority 0 (a solve the search is waiting for) that finds no idle lane preempts the lane running the least urgent job of priority
 * `PREEMPTIBLE_PRIORITY` or more (a prefetch): that worker is terminated, the prefetch requeued and a fresh worker loaded (about 10 to 50 ms).
 * An abandoned job (a speculative solve that turned out unnecessary, or every solve of a cancelled request) is dropped from the queue, or, when it is
 * running, its worker is terminated and replaced. A worker that crashes (an error event or an exit nobody asked for) is replaced and its job retried
 * once; a second crash rejects the job with the typed `SolverError`, as a trap of the in-thread instance would.
 *
 * Results do not depend on which lane solved a text: every solve creates its own HiGHS handle with the same options (threads 1), so a lane returns
 * what the in-thread instance returns for the same text and options (verified on all 172 pinned guns, `docs/stage3/parallel-pool.md`).
 */

import { HighsLoadError, NativeUsageError, SolverError } from './errors';
import { getHighsBaseUrl } from './loadHighs';
import type { HighsOptions } from './options';
import type { NativeResult, SolveExtras } from './native';
import { deserializeError } from './poolProtocol';
import type { PoolInMessage, PoolOutMessage, SerializedError } from './poolProtocol';

/** One worker as the pool sees it. */
export interface LaneEndpoint {
  post(message: PoolInMessage): void;
  /** `onCrash`: the worker failed (an error event, a message that cannot be cloned, an exit not asked for). */
  listen(onMessage: (message: PoolOutMessage) => void, onCrash: (error: unknown) => void): void;
  terminate(): void;
}

export type LaneSpawner = () => Promise<LaneEndpoint>;

/** A job of this priority or more may be preempted by a job of priority 0. */
export const PREEMPTIBLE_PRIORITY = 2;
/** The longest a pool worker may take to load before it counts as failed. */
const LOAD_TIMEOUT_MS = 30_000;

/** The solve of an abandoned job settles with this (nobody reads it: `SolveTicket.result` of an abandoned job is never awaited). */
export class AbandonedSolveError extends Error {
  constructor() {
    super('the solve was abandoned');
    this.name = 'AbandonedSolveError';
  }
}

/**
 * A job whose worker crashed twice (the first crash is retried on a fresh worker). A `SolverError` (the instance is gone); Precise treats it as an
 * INCONCLUSIVE solve and moves on to the next seed, as it does for HiGHS's `SolveError` (owner, 2026-10-12: retry seeds, never throw), so a crashing
 * pool worker never fails a valid request by itself.
 */
export class PoolWorkerCrashError extends SolverError {
  constructor(cause: unknown) {
    super('pool worker', cause, true);
  }
}

/** One started solve. */
export interface SolveTicket {
  readonly result: Promise<NativeResult>;
  /** Drop the solve: removed from the queue, or its worker terminated and replaced. */
  abandon(): void;
  /** Raise the solve's priority (a speculative solve the search now waits for). */
  promote(priority: number): void;
}

/** What `solvePrecise` needs from a pool (`speculativeSolves.ts`); the real one is {@link NativePool}, tests inject others. */
export interface SolveLanes {
  /** Solves that can run at the same time. */
  readonly size: number;
  start(lpText: string, options: HighsOptions, extras: SolveExtras, priority: number): SolveTicket;
}

export interface PoolStats {
  size: number;
  /** Workers started (the initial ones included) and how many of them crashed. */
  spawned: number;
  crashes: number;
  /** Jobs retried after a crash. */
  retries: number;
  jobsStarted: number;
  jobsCompleted: number;
  /** Running jobs whose worker was terminated: abandoned, or preempted (and requeued). */
  abandonedRunning: number;
  abandonedQueued: number;
  preempted: number;
  /** The largest wasm heap each lane slot reported, bytes. */
  maxHeapBytes: number[];
}

interface Job {
  id: number;
  seq: number;
  priority: number;
  lpText: string;
  options: HighsOptions;
  extras: SolveExtras;
  attempts: number;
  settled: boolean;
  lane: Lane | null;
  resolve(result: NativeResult): void;
  reject(error: unknown): void;
}

interface Lane {
  slot: number;
  endpoint: LaneEndpoint | null;
  state: 'loading' | 'idle' | 'busy' | 'dead';
  job: Job | null;
  /** Bumped on every respawn, so messages of a terminated worker are ignored. */
  generation: number;
}

export class NativePool implements SolveLanes {
  readonly size: number;
  private readonly spawner: LaneSpawner;
  private readonly location: string | undefined;
  private readonly preempt: boolean;
  private readonly lanes: Lane[];
  private readonly queue: Job[] = [];
  private nextJob = 1;
  private nextSeq = 0;
  private closed = false;
  readonly stats: PoolStats;

  private constructor(size: number, spawner: LaneSpawner, location: string | undefined, preempt: boolean) {
    this.size = size;
    this.spawner = spawner;
    this.location = location;
    this.preempt = preempt;
    this.lanes = Array.from({ length: size }, (_, slot) => ({ slot, endpoint: null, state: 'loading', job: null, generation: 0 }));
    this.stats = {
      size, spawned: 0, crashes: 0, retries: 0, jobsStarted: 0, jobsCompleted: 0, abandonedRunning: 0, abandonedQueued: 0, preempted: 0,
      maxHeapBytes: new Array<number>(size).fill(0),
    };
  }

  /** A pool whose every worker loaded the pinned build, or `null` when any failed (the caller then uses the in-thread instance). */
  static async create(size: number, spawner: LaneSpawner, options: { location?: string; preempt?: boolean } = {}): Promise<NativePool | null> {
    if (!(Number.isInteger(size) && size >= 1)) throw new NativeUsageError(`a native pool needs a positive integer size, got ${size}`);
    const pool = new NativePool(size, spawner, options.location, options.preempt ?? true);
    const loaded = await Promise.all(pool.lanes.map(lane => pool.spawn(lane)));
    if (loaded.every(Boolean)) return pool;
    pool.shutdown();
    return null;
  }

  /** Every lane is dead (each failed to reload): the pool can no longer solve. */
  get broken(): boolean {
    return this.closed || this.lanes.every(lane => lane.state === 'dead');
  }

  /** Load a worker into `lane`; true when it reported the pinned build ready. */
  private async spawn(lane: Lane): Promise<boolean> {
    const generation = ++lane.generation;
    lane.state = 'loading';
    lane.job = null;
    let endpoint: LaneEndpoint;
    try {
      endpoint = await this.spawner();
    } catch {
      if (lane.generation === generation) lane.state = 'dead';
      this.afterLaneLoss();
      return false;
    }
    if (this.closed || lane.generation !== generation) { endpoint.terminate(); return false; }
    lane.endpoint = endpoint;
    this.stats.spawned++;
    return new Promise<boolean>(resolve => {
      let loading = true;
      const timer = setTimeout(() => fail(new HighsLoadError('a native pool worker did not load in time')), LOAD_TIMEOUT_MS);
      const fail = (_error: unknown): void => {
        clearTimeout(timer);
        if (loading) {
          loading = false;
          if (lane.generation === generation) {
            lane.state = 'dead';
            lane.endpoint = null;
          }
          endpoint.terminate();
          this.afterLaneLoss();
          resolve(false);
        }
      };
      endpoint.listen(message => {
        if (lane.generation !== generation) return;
        if (loading) {
          if (message.type === 'ready') {
            clearTimeout(timer);
            loading = false;
            lane.state = 'idle';
            this.noteHeap(lane, message.heapBytes);
            resolve(true);
            this.schedule();
          } else if (message.type === 'initError') {
            fail(message.error);
          }
          return;
        }
        this.onMessage(lane, message);
      }, error => {
        if (lane.generation !== generation) return;
        if (loading) fail(error);
        else this.onCrash(lane, error);
      });
      endpoint.post({ type: 'init', ...(this.location === undefined ? {} : { location: this.location }) });
    });
  }

  private noteHeap(lane: Lane, bytes: number): void {
    if (bytes > this.stats.maxHeapBytes[lane.slot]) this.stats.maxHeapBytes[lane.slot] = bytes;
  }

  /** Terminate `lane`'s worker and load a fresh one in the background. */
  private respawn(lane: Lane): void {
    lane.endpoint?.terminate();
    lane.endpoint = null;
    lane.job = null;
    if (this.closed) { lane.state = 'dead'; return; }
    void this.spawn(lane);
  }

  /** A lane died for good: when none is left, nothing queued can ever run. */
  private afterLaneLoss(): void {
    if (!this.broken || this.closed) return;
    for (const job of this.queue.splice(0)) this.settle(job, new HighsLoadError('every native pool worker failed to load'));
  }

  private settle(job: Job, outcome: NativeResult | Error): void {
    if (job.settled) return;
    job.settled = true;
    job.lane = null;
    if (outcome instanceof Error) job.reject(outcome);
    else job.resolve(outcome);
  }

  private onMessage(lane: Lane, message: PoolOutMessage): void {
    if (message.type !== 'result' && message.type !== 'error') return;
    const job = lane.job;
    if (job === null || job.id !== message.id) return;
    this.noteHeap(lane, message.heapBytes);
    lane.job = null;
    lane.state = 'idle';
    this.stats.jobsCompleted++;
    this.settle(job, message.type === 'result' ? message.result : deserializeError(message.error as SerializedError));
    this.schedule();
  }

  private onCrash(lane: Lane, error: unknown): void {
    this.stats.crashes++;
    const job = lane.job;
    this.respawn(lane);
    if (job === null || job.settled) return;
    job.lane = null;
    job.attempts++;
    if (job.attempts <= 1) {
      this.stats.retries++;
      this.queue.push(job);
      this.schedule();
    } else {
      this.settle(job, new PoolWorkerCrashError(error));
    }
  }

  start(lpText: string, options: HighsOptions, extras: SolveExtras, priority: number): SolveTicket {
    let resolve!: (r: NativeResult) => void;
    let reject!: (e: unknown) => void;
    const result = new Promise<NativeResult>((res, rej) => { resolve = res; reject = rej; });
    // An abandoned job's promise is never awaited: mark it handled so its rejection is not reported.
    result.catch(() => undefined);
    const job: Job = { id: this.nextJob++, seq: this.nextSeq++, priority, lpText, options, extras, attempts: 0, settled: false, lane: null, resolve, reject };
    if (this.broken) {
      this.settle(job, new HighsLoadError('the native pool has no worker left'));
    } else {
      this.queue.push(job);
      this.schedule();
    }
    return {
      result,
      abandon: () => this.abandon(job),
      promote: (p: number) => this.promote(job, p),
    };
  }

  private abandon(job: Job): void {
    if (job.settled) return;
    const k = this.queue.indexOf(job);
    if (k >= 0) {
      this.queue.splice(k, 1);
      this.stats.abandonedQueued++;
    } else if (job.lane !== null) {
      this.stats.abandonedRunning++;
      this.respawn(job.lane);
    }
    this.settle(job, new AbandonedSolveError());
    this.schedule();
  }

  private promote(job: Job, priority: number): void {
    if (job.settled || priority >= job.priority) return;
    job.priority = priority;
    if (this.queue.includes(job)) this.schedule();
  }

  private schedule(): void {
    if (this.closed) return;
    this.queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    for (const lane of this.lanes) {
      if (this.queue.length === 0) return;
      if (lane.state !== 'idle' || lane.endpoint === null) continue;
      const job = this.queue.shift() as Job;
      lane.state = 'busy';
      lane.job = job;
      job.lane = lane;
      this.stats.jobsStarted++;
      lane.endpoint.post({ type: 'solve', id: job.id, lpText: job.lpText, options: job.options, extras: job.extras });
    }
    if (!this.preempt || this.queue.length === 0 || this.queue[0].priority !== 0) return;
    // A solve the search waits for, and no lane free: a lane already reloading will take it; otherwise preempt the least urgent prefetch.
    const waiting = this.queue.filter(job => job.priority === 0).length;
    const reloading = this.lanes.filter(lane => lane.state === 'loading').length;
    for (let k = reloading; k < waiting; k++) {
      let victim: Lane | null = null;
      for (const lane of this.lanes) {
        const running = lane.state === 'busy' ? lane.job : null;
        if (running === null || running.priority < PREEMPTIBLE_PRIORITY) continue;
        if (victim === null || (victim.job as Job).priority < running.priority || ((victim.job as Job).priority === running.priority && (victim.job as Job).seq < running.seq)) victim = lane;
      }
      if (victim === null) return;
      const job = victim.job as Job;
      this.stats.preempted++;
      job.lane = null;
      this.queue.push(job);
      this.respawn(victim);
    }
  }

  /** Terminate every worker and drop every queued job. */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const job of this.queue.splice(0)) this.settle(job, new AbandonedSolveError());
    for (const lane of this.lanes) {
      if (lane.job !== null) this.settle(lane.job, new AbandonedSolveError());
      lane.generation++;
      lane.endpoint?.terminate();
      lane.endpoint = null;
      lane.job = null;
      lane.state = 'dead';
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Spawners
// ---------------------------------------------------------------------------------------------------------------------------

type EnvGlobals = {
  process?: { versions?: { node?: string } };
  window?: unknown;
  WorkerGlobalScope?: unknown;
  Worker?: unknown;
  navigator?: { hardwareConcurrency?: number };
};

const isNode = (): boolean => {
  const g = globalThis as EnvGlobals;
  return typeof g.process?.versions?.node === 'string' && g.window === undefined && g.WorkerGlobalScope === undefined;
};

/** Dynamic import the bundler must not follow. */
const dynamicImport = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

/** Browser: a nested dedicated module Worker; `null` when the context has no `Worker` (nested workers unsupported). */
function browserSpawner(): LaneSpawner | null {
  if (typeof (globalThis as EnvGlobals).Worker !== 'function') return null;
  return async () => {
    // The literal `new Worker(new URL(...), { type: 'module' })` is what Vite bundles as a worker chunk.
    const worker = new Worker(new URL('./poolWorker.ts', import.meta.url), { type: 'module' });
    return {
      post: message => worker.postMessage(message),
      listen: (onMessage, onCrash) => {
        worker.onmessage = (event: MessageEvent<PoolOutMessage>) => onMessage(event.data);
        worker.onerror = (event: ErrorEvent) => { event.preventDefault(); onCrash(new Error(event.message || 'pool worker error')); };
        worker.onmessageerror = () => onCrash(new Error('a pool worker message could not be deserialized'));
      },
      terminate: () => worker.terminate(),
    };
  };
}

interface NodeWorker {
  postMessage(message: unknown): void;
  on(event: 'message' | 'error' | 'exit' | 'messageerror', handler: (value: never) => void): void;
  terminate(): Promise<number>;
  unref(): void;
}

/** Node (tests, benchmarks): a `worker_threads` worker on the same `poolWorker.ts`, run from source. */
function nodeSpawner(): LaneSpawner {
  return async () => {
    const threads = (await dynamicImport('node:worker_threads')) as { Worker: new (url: URL) => NodeWorker };
    // Built from parts so the bundler does not treat it as an asset of the app; Node runs the TypeScript source (tsx).
    const file = ['pool', 'Worker.ts'].join('');
    const worker = new threads.Worker(new URL(`./${file}`, import.meta.url));
    worker.unref();
    let terminated = false;
    return {
      post: message => worker.postMessage(message),
      listen: (onMessage, onCrash) => {
        worker.on('message', (m: never) => onMessage(m as PoolOutMessage));
        worker.on('error', (e: never) => onCrash(e));
        worker.on('messageerror', (e: never) => onCrash(e));
        worker.on('exit', (code: never) => { if (!terminated) onCrash(new Error(`pool worker exited with code ${String(code)}`)); });
      },
      terminate: () => { terminated = true; void worker.terminate(); },
    };
  };
}

/** The spawner of this context, or `null` when it cannot start workers (the pool is then not used). */
export function defaultLaneSpawner(): LaneSpawner | null {
  return isNode() ? nodeSpawner() : browserSpawner();
}

// ---------------------------------------------------------------------------------------------------------------------------
// The shared pool of the context
// ---------------------------------------------------------------------------------------------------------------------------

/** The most lanes the default ever uses: three cover a node's first and second opinion and one prefetch (`docs/stage3/parallel-pool.md`). */
export const MAX_DEFAULT_POOL_SIZE = 3;

/**
 * The default pool size: in a browser, min(max(1, hardwareConcurrency - 1), 3), so one core stays for the page; in Node 1 (no pool), because
 * Node callers are the tests and benchmarks, which hook the in-thread instance and opt into a pool explicitly ({@link configureNativePool}).
 */
export function defaultNativePoolSize(): number {
  if (isNode()) return 1;
  const cores = (globalThis as EnvGlobals).navigator?.hardwareConcurrency;
  const n = typeof cores === 'number' && Number.isFinite(cores) ? Math.floor(cores) : 1;
  return Math.min(Math.max(1, n - 1), MAX_DEFAULT_POOL_SIZE);
}

export interface NativePoolConfig {
  /** Concurrent solves; 1 (or less) means no pool. Default {@link defaultNativePoolSize}. */
  size?: number;
  /** How workers are started (tests). Default {@link defaultLaneSpawner}. */
  spawner?: LaneSpawner;
  /** Where the workers load `highs.js` / `highs.wasm` (browser). Default: the configured base URL (`setHighsBaseUrl`). */
  location?: string;
  /** Let a waited-for solve preempt a running prefetch (default true). */
  preempt?: boolean;
}

let config: NativePoolConfig = {};
let shared: Promise<NativePool | null> | null = null;

/** Replace the pool configuration; the current pool (if any) is shut down and the next Precise request builds the new one. */
export function configureNativePool(next: NativePoolConfig): void {
  void shutdownNativePool();
  config = { ...next };
}

/** The pool size the current configuration asks for. */
export function configuredNativePoolSize(): number {
  return Math.max(1, Math.floor(config.size ?? defaultNativePoolSize()));
}

/**
 * The shared pool, loaded on first use and reused by every later request; `null` when the configured size is 1, when workers are unavailable, or
 * when any worker failed to load (Precise then runs on the in-thread instance, never on another HiGHS).
 */
export function acquireNativePool(): Promise<NativePool | null> {
  if (shared !== null) {
    return shared.then(pool => {
      if (pool !== null && pool.broken) {
        shared = null;
        return acquireNativePool();
      }
      return pool;
    });
  }
  const size = configuredNativePoolSize();
  const spawner = config.spawner ?? defaultLaneSpawner();
  if (size < 2 || spawner === null) {
    shared = Promise.resolve(null);
    return shared;
  }
  const location = config.location ?? (isNode() ? undefined : getHighsBaseUrl());
  shared = NativePool.create(size, spawner, { ...(location === undefined ? {} : { location }), ...(config.preempt === undefined ? {} : { preempt: config.preempt }) })
    .catch(() => null);
  return shared;
}

/** The loaded shared pool's statistics, `null` without one. */
export async function nativePoolStats(): Promise<PoolStats | null> {
  const pool = shared === null ? null : await shared;
  return pool === null ? null : { ...pool.stats, maxHeapBytes: [...pool.stats.maxHeapBytes] };
}

/** Terminate the shared pool's workers (tests, benchmarks, a configuration change). */
export async function shutdownNativePool(): Promise<void> {
  const current = shared;
  shared = null;
  const pool = current === null ? null : await current;
  pool?.shutdown();
}
