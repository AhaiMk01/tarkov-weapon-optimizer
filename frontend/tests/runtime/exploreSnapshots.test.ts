// Live Explore progress through the worker runtime and the client (Phase 2.8, ADR 0013 section 4D): the real driver publishes one verified snapshot per
// launched target before the result, `RequestOptions.onSnapshot` receives them, and a hard termination rejects with the last one so the points found
// so far are kept. Small fixture, the real runtime over a loopback worker, no mocks of the sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, ExploreSnapshot } from '../../src/api/client';
import { CancellationError, explore, terminateWorker } from '../../src/api/client';
import { asExploreSnapshot, retainedExploreOf } from '../../src/components/explore/exploreView';
import type { LoadedState } from '../../src/solver/dataService';
import { epochNow } from '../../src/solver/requestGuard';
import type { ItemLookup } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerInMessage, WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gunWith, lookupOf, modWith, trader, WEAPON, slot } from '../physical/lpFixtures';

/** Two grips and two stocks: an ergonomics/recoil/price trade-off with a multi-step Explore sweep. */
const sweepLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { weight: 1, ergo: 40, recoilV: 100, recoilH: 50, slots: [slot('grip', ['g1', 'g2']), slot('stock', ['s1', 's2'])] }),
  ['g1', modWith('g1', { ergo: 5, recoil: -0.02, weight: 0.2, offers: [trader('prapor', 1, 200)] })],
  ['g2', modWith('g2', { ergo: 10, recoil: -0.05, weight: 0.4, offers: [trader('prapor', 1, 800)] })],
  ['s1', modWith('s1', { ergo: 3, recoil: -0.1, weight: 0.5, offers: [trader('prapor', 1, 300)] })],
  ['s2', modWith('s2', { ergo: 12, recoil: 0, weight: 0.3, offers: [trader('prapor', 1, 1500)] })],
);

const state = (lookup: ItemLookup): LoadedState => ({ guns: [], mods: [], itemLookup: lookup, loadedAt: 0, generation: 7 });

const exploreMsg = (id: number): WorkerInMessage => ({
  type: 'explore', id,
  payload: { request: { weapon_id: WEAPON, ignore: 'price', precise_mode: 'precise' } as never, lang: 'en', gameMode: 'regular', deadline: epochNow() + 120_000 },
});

/** The elapsed time is read when the response is built, so a snapshot and the final response differ only in that clock. */
const withoutClock = (r: ExploreResponse): ExploreResponse => ({ ...r, total_solve_time_ms: 0 });

test('the runtime publishes one verified snapshot per launched target, before the result, and the last one is the result', async () => {
  const posted: WorkerOutMessage[] = [];
  const runtime = createWorkerRuntime({ post: m => { posted.push(structuredClone(m)); }, loadData: async () => state(sweepLookup()) });
  runtime.receive(exploreMsg(1));
  await runtime.idle();

  const mine = posted.filter(m => m.id === 1);
  assert.equal(mine[mine.length - 1].type, 'result', 'the result is the last message');
  const snapshotMessages = mine.filter(m => m.type === 'snapshot');
  assert.ok(snapshotMessages.length >= 3, 'one snapshot per target of a schedule of at least three');
  const result = mine[mine.length - 1].payload as ExploreResponse;
  assert.equal(snapshotMessages.length, result.step_outcomes.length, 'exactly one per launched target');

  const snapshots = snapshotMessages.map(m => asExploreSnapshot(m.payload));
  assert.ok(snapshots.every((s): s is ExploreSnapshot => s !== null), 'every payload is a well-formed Explore snapshot');
  const parsed = snapshots as ExploreSnapshot[];
  assert.deepEqual(parsed.map(s => s.launched), parsed.map((_, i) => i + 1), 'launched grows by one per snapshot');
  assert.ok(parsed.every(s => s.response.points.every(p => p.status === 'optimal' || p.status === 'feasible')), 'points are verified witnesses only');
  assert.ok(parsed[0].response.points.length >= 1, 'the first target already published a point');
  assert.deepEqual(withoutClock(parsed[parsed.length - 1].response), withoutClock(result), 'the last snapshot of a finished sweep is its response');
});

// ---------------------------------------------------------------------------------------------------------------------------
// The client over a loopback worker
// ---------------------------------------------------------------------------------------------------------------------------

/** A worker that runs the real runtime in this thread; messages cross as structured clones and as tasks, like a real worker port. */
class LoopbackWorker {
  onmessage: ((event: { data: WorkerOutMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private readonly runtime = createWorkerRuntime({
    post: m => {
      const copy = structuredClone(m);
      setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: copy }); }, 0);
    },
    loadData: async () => state(sweepLookup()),
  });

  constructor(_url: unknown, _options: unknown) { /* the real signature of `new Worker(url, options)` */ }

  postMessage(message: WorkerInMessage): void {
    const copy = structuredClone(message);
    setTimeout(() => { if (!this.terminated) this.runtime.receive(copy); }, 0);
  }

  terminate(): void { this.terminated = true; }
}
(globalThis as unknown as { Worker: unknown }).Worker = LoopbackWorker;

test('client.explore delivers every snapshot to onSnapshot, in order, then resolves with the response the last one equals', async () => {
  const seen: ExploreSnapshot[] = [];
  const response = await explore({ weapon_id: WEAPON, ignore: 'price', precise_mode: 'precise' }, 'regular', 'en', {
    onSnapshot: raw => { const s = asExploreSnapshot(raw); if (s !== null) seen.push(s); },
  });
  assert.equal(response.curve_status, 'complete');
  assert.ok(seen.length >= 3);
  assert.deepEqual(seen.map(s => s.launched), seen.map((_, i) => i + 1));
  assert.deepEqual(withoutClock(seen[seen.length - 1].response), withoutClock(response));
});

test('a hard termination mid-sweep rejects with a CancellationError that keeps the points published so far', async () => {
  const seen: ExploreSnapshot[] = [];
  let stopped = false;
  const pending = explore({ weapon_id: WEAPON, ignore: 'price', precise_mode: 'precise' }, 'regular', 'en', {
    onSnapshot: raw => {
      const s = asExploreSnapshot(raw);
      if (s !== null) seen.push(s);
      if (seen.length === 2 && !stopped) { stopped = true; terminateWorker(); }
    },
  });
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CancellationError);
    const kept = retainedExploreOf(error);
    assert.ok(kept !== null, 'the error carries the last published snapshot');
    assert.equal(kept.launched, 2, 'the second snapshot was the last one before the termination');
    assert.ok(kept.response.points.length >= 1, 'the points found so far are kept');
    assert.equal(kept.response.curve_status, 'partial', 'the unlaunched rest is U, so the kept curve is partial');
    assert.deepEqual(kept.response, seen[1].response);
    return true;
  });
});
