// The native solve pool (src/solver/native/pool.ts, docs/stage3/parallel-pool.md): N pool workers, each loading its own instance of the pinned build through
// `loadHighs` (the SHA-256 check and the ABI validation), solving texts at the same time. Tested on real `worker_threads` workers (the Node path of the
// same `poolWorker.ts` the browser nests in the solver worker) and, for scheduling and failure rules, on fake workers:
//   - a lane's answer is the in-thread instance's answer for the same text and options (status, primal, objective, dual bound, readback);
//   - typed errors cross the worker boundary as the same classes;
//   - an abandoned running solve's worker is terminated and replaced, the pool keeps solving;
//   - a crashed worker is replaced and its job retried once; a second crash is the typed SolverError;
//   - a worker that fails to load makes the pool unavailable (Precise falls back to the in-thread instance, never another HiGHS);
//   - priorities: the queue runs the most urgent job first, and a waited-for job preempts a running prefetch.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HighsOptionError, ModelReadError, NativeHighs, SolverError } from '../../src/solver/native';
import type { NativeResult } from '../../src/solver/native';
import {
  AbandonedSolveError, NativePool, acquireNativePool, configureNativePool, defaultLaneSpawner, defaultNativePoolSize, shutdownNativePool,
} from '../../src/solver/native/pool';
import type { LaneEndpoint, LaneSpawner } from '../../src/solver/native/pool';
import type { PoolInMessage, PoolOutMessage } from '../../src/solver/native/poolProtocol';
import { serializeError } from '../../src/solver/native/poolProtocol';
import { HIGHS_JS_README_LP, INFEASIBLE_LP, PRECISION_LP, knapsackLp } from './fixtures';

const local = new NativeHighs();
const pools: NativePool[] = [];
after(async () => {
  for (const pool of pools) pool.shutdown();
  await shutdownNativePool();
});

async function realPool(size: number): Promise<NativePool> {
  const spawner = defaultLaneSpawner();
  assert.ok(spawner !== null, 'Node can start worker_threads workers');
  const pool = await NativePool.create(size, spawner);
  assert.ok(pool !== null, 'every pool worker loaded the pinned build');
  pools.push(pool);
  return pool;
}

const comparable = (r: NativeResult) => ({
  status: r.modelStatus, primal: r.primalSolutionStatus, objective: r.objectiveValue, dual: r.mipDualBound, nodes: r.mipNodeCount,
  cols: r.colValues === null ? null : [...r.colValues], names: r.colNames, readback: r.readback === null ? null : {
    ...r.readback, colCost: [...r.readback.colCost], colLower: [...r.readback.colLower], colUpper: [...r.readback.colUpper], rowLower: [...r.readback.rowLower],
    rowUpper: [...r.readback.rowUpper], integrality: [...r.readback.integrality],
    matrix: { start: [...r.readback.matrix.start], index: [...r.readback.matrix.index], value: [...r.readback.matrix.value] },
  },
  options: r.effectiveOptions, version: r.highsVersion, githash: r.githash,
});

test('Node defaults to no pool (tests and benchmarks opt in); a browser default is min(max(1, cores - 1), 3)', () => {
  assert.equal(defaultNativePoolSize(), 1);
});

test('a pool lane answers exactly what the in-thread instance answers for the same text and options, solves running at the same time', { timeout: 120_000 }, async () => {
  const pool = await realPool(3);
  const texts = [PRECISION_LP, HIGHS_JS_README_LP, INFEASIBLE_LP, knapsackLp(40, 3), knapsackLp(60, 5), knapsackLp(50, 11)];
  const options = { mip_rel_gap: 0, mip_abs_gap: 1e-9, presolve: 'off', random_seed: 11, time_limit: 60 } as const;
  const pooled = await Promise.all(texts.map(t => pool.start(t, options, { includeReadback: true }, 0).result));
  for (let k = 0; k < texts.length; k++) {
    const direct = await local.solveStructured(texts[k], options, { includeReadback: true });
    assert.deepEqual(comparable(pooled[k]), comparable(direct), `text ${k}`);
    assert.ok(pooled[k].colIndexByName instanceof Map, 'the Map survives the structured clone');
  }
  assert.equal(pool.stats.jobsCompleted, texts.length);
  assert.ok(pool.stats.maxHeapBytes.every(b => b > 0), 'every lane reports its wasm heap');
});

test('typed errors cross the worker boundary as the same classes', { timeout: 60_000 }, async () => {
  const pool = await realPool(1);
  // HiGHS's reader ignores unrecognised text before the first section, so the garbage follows a real section (as in lifecycle.test.ts).
  const error = await pool.start('Maximize\n obj: x\nSubject To\n c1: x <= 4\nGarbage here\nmore garbage', {}, {}, 0).result.then(() => null, (e: unknown) => e);
  assert.ok(error instanceof ModelReadError, `got ${String(error)}`);
  assert.match((error as Error).message, /could not read the model/);
  const option = await pool.start(PRECISION_LP, { not_an_option: 1 } as never, {}, 0).result.then(() => null, (e: unknown) => e);
  assert.ok(option instanceof HighsOptionError, `got ${String(option)}`);
  assert.equal((option as HighsOptionError).option, 'not_an_option');
  // And the pool still solves after them.
  assert.equal((await pool.start(PRECISION_LP, {}, {}, 0).result).modelStatus.name, 'Optimal');
});

test('an abandoned running solve: its worker is terminated and replaced, and the pool keeps solving', { timeout: 120_000 }, async () => {
  const pool = await realPool(1);
  // A large text: the worker is still reading or solving it a few milliseconds after it started.
  const long = pool.start(knapsackLp(4000, 7), { mip_rel_gap: 0, mip_abs_gap: 0, time_limit: 120 }, {}, 0);
  await new Promise(resolve => setTimeout(resolve, 5));
  const started = performance.now();
  long.abandon();
  await assert.rejects(long.result, AbandonedSolveError);
  const next = await pool.start(PRECISION_LP, {}, {}, 0).result;
  assert.equal(next.modelStatus.name, 'Optimal');
  assert.ok(performance.now() - started < 30_000, 'the replacement worker loads quickly');
  assert.equal(pool.stats.abandonedRunning, 1);
  assert.equal(pool.stats.spawned, 2, 'one replacement worker');
});

// ---------------------------------------------------------------------------------------------
// Fake workers: failures and scheduling
// ---------------------------------------------------------------------------------------------

interface FakeWorker extends LaneEndpoint {
  solves: number[];
  terminated: boolean;
}

/**
 * Fake workers that load (or fail to) and answer each solve through `answer` (an in-thread solve by default). `behave(workerIndex, solveCount)` can make
 * a worker crash on a solve or hang (never answer).
 */
function fakeSpawner(options: {
  loadFails?: (index: number) => boolean;
  loadCrashes?: (index: number) => boolean;
  behave?: (index: number, solve: number) => 'answer' | 'crash' | 'hang';
} = {}): LaneSpawner & { workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const spawner = async (): Promise<LaneEndpoint> => {
    const index = workers.length;
    let onMessage: (m: PoolOutMessage) => void = () => undefined;
    let onCrash: (e: unknown) => void = () => undefined;
    const worker: FakeWorker = {
      solves: [], terminated: false,
      listen: (m, c) => { onMessage = m; onCrash = c; },
      terminate: () => { worker.terminated = true; },
      post: (message: PoolInMessage) => {
        if (worker.terminated) return;
        if (message.type === 'init') {
          setTimeout(() => {
            if (options.loadFails?.(index) === true) onMessage({ type: 'initError', error: serializeError(new Error('load failed')) });
            // A browser that cannot start a nested worker fires a bare error event before the worker ever runs (seen in an embedded Chromium).
            else if (options.loadCrashes?.(index) === true) onCrash(new Error('pool worker error'));
            else onMessage({ type: 'ready', highsVersion: '1.15.1', wasmSha256: 'x', heapBytes: 1 });
          }, 1);
          return;
        }
        const n = worker.solves.push(message.id);
        const what = options.behave?.(index, n) ?? 'answer';
        if (what === 'hang') return;
        if (what === 'crash') { setTimeout(() => { if (!worker.terminated) onCrash(new Error('worker died')); }, 1); return; }
        void local.solveStructured(message.lpText, message.options, message.extras).then(result => {
          if (!worker.terminated) onMessage({ type: 'result', id: message.id, result, heapBytes: 2 });
        });
      },
    };
    workers.push(worker);
    return worker;
  };
  return Object.assign(spawner, { workers });
}

test('a crashed worker is replaced and its job retried once; a second crash rejects the job with the typed SolverError', async () => {
  // Worker 0 crashes on its first solve; its replacement (worker 1) answers.
  const once = fakeSpawner({ behave: index => (index === 0 ? 'crash' : 'answer') });
  const pool = await NativePool.create(1, once);
  assert.ok(pool !== null);
  pools.push(pool);
  const result = await pool.start(PRECISION_LP, {}, {}, 0).result;
  assert.equal(result.modelStatus.name, 'Optimal');
  assert.deepEqual([pool.stats.crashes, pool.stats.retries], [1, 1]);
  // Every worker crashes: the retry crashes too.
  const always = fakeSpawner({ behave: () => 'crash' });
  const doomed = await NativePool.create(1, always);
  assert.ok(doomed !== null);
  pools.push(doomed);
  const error = await doomed.start(PRECISION_LP, {}, {}, 0).result.then(() => null, (e: unknown) => e);
  assert.ok(error instanceof SolverError, `got ${String(error)}`);
  assert.equal((error as SolverError).phase, 'pool worker');
});

test('a worker that fails to load makes the pool unavailable: Precise then runs on the in-thread instance', async () => {
  const failing = fakeSpawner({ loadFails: index => index === 1 });
  assert.equal(await NativePool.create(3, failing), null);
  assert.ok(failing.workers.every(w => w.terminated), 'the workers that did load are terminated');
  assert.equal(await NativePool.create(2, fakeSpawner({ loadCrashes: () => true })), null, 'a worker that cannot even start (no nested workers) counts as a load failure');
  configureNativePool({ size: 3, spawner: fakeSpawner({ loadFails: () => true }) });
  assert.equal(await acquireNativePool(), null, 'the shared pool falls back');
  configureNativePool({ size: 1 });
  assert.equal(await acquireNativePool(), null, 'size 1 is no pool');
  configureNativePool({});
});

test('scheduling: the most urgent queued job runs first; a waited-for job preempts a running prefetch, which is requeued and still answered', async () => {
  // One lane whose first solve hangs (a long prefetch).
  const spawner = fakeSpawner({ behave: (index, n) => (index === 0 && n === 1 ? 'hang' : 'answer') });
  const pool = await NativePool.create(1, spawner);
  assert.ok(pool !== null);
  pools.push(pool);
  const prefetch = pool.start(PRECISION_LP, { random_seed: 1 }, {}, 5);
  await new Promise(resolve => setTimeout(resolve, 5));
  const order: string[] = [];
  const lowPriority = pool.start(PRECISION_LP, { random_seed: 2 }, {}, 3);
  const needed = pool.start(PRECISION_LP, { random_seed: 3 }, {}, 0);
  void lowPriority.result.then(() => order.push('low'));
  void needed.result.then(() => order.push('needed'));
  const [n, p, l] = await Promise.all([needed.result, prefetch.result, lowPriority.result]);
  assert.deepEqual([n.modelStatus.name, p.modelStatus.name, l.modelStatus.name], ['Optimal', 'Optimal', 'Optimal']);
  assert.equal(order[0], 'needed', 'the waited-for job ran first');
  assert.equal(pool.stats.preempted, 1);
  assert.equal(spawner.workers[0].terminated, true, 'the preempted worker was terminated and replaced');
  // Without preemption the waited-for job waits behind the prefetch.
  const patient = fakeSpawner({ behave: (index, n) => (index === 0 && n === 1 ? 'hang' : 'answer') });
  const calm = await NativePool.create(1, patient, { preempt: false });
  assert.ok(calm !== null);
  pools.push(calm);
  calm.start(PRECISION_LP, {}, {}, 5);
  await new Promise(resolve => setTimeout(resolve, 5));
  const waiting = calm.start(PRECISION_LP, {}, {}, 0);
  const raced = await Promise.race([waiting.result.then(() => 'answered'), new Promise(resolve => setTimeout(() => resolve('waiting'), 50))]);
  assert.equal(raced, 'waiting');
  assert.equal(calm.stats.preempted, 0);
  waiting.abandon();
  await assert.rejects(waiting.result, AbandonedSolveError);
  assert.equal(calm.stats.abandonedQueued, 1);
});
