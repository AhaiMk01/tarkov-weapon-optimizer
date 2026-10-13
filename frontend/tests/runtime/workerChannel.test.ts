// The client side of the worker connection (src/api/workerChannel.ts, ADR 0013 section 4D, Phase 2.7a) against a fake worker: the epoch deadline stamped at
// entry, soft cancel and its escalation, hard termination (every active and queued promise rejected exactly once, snapshots kept, a fresh worker next),
// worker crashes and typed error revival.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerChannel } from '../../src/api/workerChannel';
import type { Timers, WorkerLike } from '../../src/api/workerChannel';
import { CancellationError, SolverError, serializeWorkerError } from '../../src/solver/runtimeErrors';
import { SolverError as NativeSolverError } from '../../src/solver/native/errors';
import type { WorkerInMessage, WorkerOutMessage } from '../../src/solver/workerProtocol';

class FakeWorker implements WorkerLike {
  posted: WorkerInMessage[] = [];
  terminated = 0;
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  postMessage(message: WorkerInMessage): void { this.posted.push(message); }
  terminate(): void { this.terminated++; }
  /** Deliver a message as the worker would (nothing happens once the channel detached the handler). */
  emit(message: WorkerOutMessage): void { this.onmessage?.({ data: message }); }
}

interface Rig {
  channel: WorkerChannel;
  workers: FakeWorker[];
  clock: { t: number };
  timers: { set: Timers['set']; clear: Timers['clear']; pending(): number; fireAll(): void };
}

function rig(escalateAfterMs: number | null = 1000): Rig {
  const workers: FakeWorker[] = [];
  const clock = { t: 1_000_000 };
  const scheduled = new Map<number, () => void>();
  let nextTimer = 1;
  const timers = {
    set: (callback: () => void): unknown => { const id = nextTimer++; scheduled.set(id, callback); return id; },
    clear: (handle: unknown): void => { scheduled.delete(handle as number); },
    pending: (): number => scheduled.size,
    fireAll: (): void => { for (const [id, callback] of [...scheduled]) { scheduled.delete(id); callback(); } },
  };
  const channel = new WorkerChannel({
    createWorker: () => { const w = new FakeWorker(); workers.push(w); return w; },
    clock: () => clock.t,
    escalateAfterMs,
    timers,
  });
  return { channel, workers, clock, timers };
}

/** Track how a promise settles: every settlement is recorded, so a double settlement would show. */
function track<T>(promise: Promise<T>): { log: string[]; errors: unknown[] } {
  const log: string[] = [];
  const errors: unknown[] = [];
  promise.then(() => log.push('resolved'), (error: unknown) => { log.push('rejected'); errors.push(error); });
  return { log, errors };
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const lastPost = (w: FakeWorker): WorkerInMessage => w.posted[w.posted.length - 1];

test('the epoch deadline is stamped when the call enters (clock plus budget), so time spent queued in the worker counts', () => {
  const { channel, workers, clock } = rig();
  void channel.send('optimize', { lang: 'en' }, { timeLimitMs: 60_000 });
  clock.t += 7_000; // a later request, after the first has been waiting
  void channel.send('computeMOAFloor', { lang: 'en' }, { timeLimitMs: 30_000 });
  void channel.send('getInfo', { lang: 'en' });
  void channel.send('getStatus', { lang: 'en' }, { timeLimitMs: null });
  const [a, b, c, d] = workers[0].posted;
  assert.equal((a.payload as { deadline: number }).deadline, 1_000_000 + 60_000);
  assert.equal((b.payload as { deadline: number }).deadline, 1_007_000 + 30_000);
  assert.equal('deadline' in c.payload, false, 'a metadata operation has no deadline');
  assert.equal('deadline' in d.payload, false);
  assert.deepEqual(workers[0].posted.map(m => m.id), [0, 1, 2, 3], 'one id per request');
});

test('results and errors are routed to their own request, and a settled request is forgotten', async () => {
  const { channel, workers } = rig();
  const first = track(channel.send('getInfo', {}));
  const second = track(channel.send('getInfo', {}));
  workers[0].emit({ type: 'result', id: 1, payload: { ok: 2 } });
  await flush();
  assert.deepEqual(first.log, []);
  assert.deepEqual(second.log, ['resolved']);
  workers[0].emit({ type: 'error', id: 0, payload: 'plain failure' });
  await flush();
  assert.deepEqual(first.log, ['rejected']);
  assert.equal((first.errors[0] as Error).message, 'plain failure');
  workers[0].emit({ type: 'result', id: 1, payload: 'again' }); // a duplicate is ignored
  await flush();
  assert.equal(second.log.length, 1);
  assert.equal(channel.pendingCount, 0);
});

test('a hard termination rejects every active and queued promise exactly once with a CancellationError, keeps the published snapshot, and starts a fresh worker', async () => {
  const { channel, workers } = rig();
  const seen: unknown[] = [];
  const active = track(channel.send('explore', {}, { timeLimitMs: 60_000, onSnapshot: s => seen.push(s) }));
  const queuedA = track(channel.send('optimize', {}, { timeLimitMs: 60_000 }));
  const queuedB = track(channel.send('getInfo', {}));
  workers[0].emit({ type: 'snapshot', id: 0, payload: { points: 1 } });
  workers[0].emit({ type: 'snapshot', id: 0, payload: { points: 2 } });
  assert.deepEqual(seen, [{ points: 1 }, { points: 2 }]);
  const staleHandler = workers[0].onmessage!;

  channel.terminate('Cache cleared by user');
  await flush();
  for (const t of [active, queuedA, queuedB]) {
    assert.deepEqual(t.log, ['rejected'], 'rejected once, never resolved');
    assert.ok(t.errors[0] instanceof CancellationError);
    assert.equal((t.errors[0] as CancellationError).reason, 'Cache cleared by user');
    assert.equal((t.errors[0] as CancellationError).name, 'CancellationError');
  }
  assert.deepEqual((active.errors[0] as CancellationError).snapshot, { points: 2 }, 'the last verified snapshot is kept');
  assert.equal((queuedA.errors[0] as CancellationError).snapshot, null);
  assert.equal(workers[0].terminated, 1);
  assert.equal(workers[0].onmessage, null, 'the old worker is detached');
  assert.equal(channel.pendingCount, 0);

  // Late traffic of the terminated worker settles nothing a second time.
  staleHandler({ data: { type: 'result', id: 0, payload: 'late' } });
  staleHandler({ data: { type: 'error', id: 1, payload: 'late' } });
  workers[0].emit({ type: 'result', id: 2, payload: 'late' });
  await flush();
  for (const t of [active, queuedA, queuedB]) assert.deepEqual(t.log, ['rejected']);

  // Terminating again with nothing pending is a no-op, and the next request gets a fresh worker.
  channel.terminate();
  assert.equal(workers.length, 1, 'no worker is created just to be terminated');
  const next = track(channel.send('getInfo', {}));
  assert.equal(workers.length, 2, 'a fresh worker');
  assert.equal(workers[1].posted.length, 1);
  workers[1].emit({ type: 'result', id: lastPost(workers[1]).id, payload: 'fresh' });
  await flush();
  assert.deepEqual(next.log, ['resolved']);
  assert.equal(workers[0].posted.length, 3, 'nothing more was ever posted to the terminated worker');
});

test('a soft cancel posts an out-of-band cancel for that request; the request still settles normally with the worker response', async () => {
  const { channel, workers, timers } = rig();
  const controller = new AbortController();
  const other = track(channel.send('optimize', {}, { timeLimitMs: 60_000 }));
  const t = track(channel.send('optimize', {}, { timeLimitMs: 60_000, signal: controller.signal }));
  controller.abort();
  const cancel = lastPost(workers[0]);
  assert.equal(cancel.type, 'cancel');
  assert.deepEqual(cancel.payload, { targetId: 1 });
  assert.equal(timers.pending(), 1, 'the escalation clock runs');
  assert.deepEqual(t.log, [], 'not rejected: the worker answers with its retained state');
  workers[0].emit({ type: 'result', id: 1, payload: { reason: 'Cancelled by user' } });
  await flush();
  assert.deepEqual(t.log, ['resolved']);
  assert.equal(timers.pending(), 0, 'the answer stops the escalation');
  assert.equal(workers[0].terminated, 0);
  assert.deepEqual(other.log, [], 'the other request is untouched');
  // Aborting a settled request, or cancelling an unknown id, posts nothing.
  const posted = workers[0].posted.length;
  controller.abort();
  channel.cancel(1);
  channel.cancel(999);
  assert.equal(workers[0].posted.length, posted);
});

test('a soft cancel the worker does not answer escalates to a hard termination: all pending requests are rejected with a CancellationError', async () => {
  const { channel, workers, timers } = rig(1000);
  const controller = new AbortController();
  const busy = track(channel.send('optimize', {}, { timeLimitMs: 60_000, signal: controller.signal }));
  const queued = track(channel.send('explore', {}, { timeLimitMs: 60_000 }));
  controller.abort();
  assert.equal(timers.pending(), 1);
  timers.fireAll();
  await flush();
  assert.equal(workers[0].terminated, 1);
  for (const t of [busy, queued]) {
    assert.deepEqual(t.log, ['rejected']);
    assert.ok(t.errors[0] instanceof CancellationError);
  }
});

test('an aborted signal rejects at once without posting, and escalation can be disabled', async () => {
  const { channel, workers } = rig();
  const controller = new AbortController();
  controller.abort();
  const t = track(channel.send('optimize', {}, { timeLimitMs: 60_000, signal: controller.signal }));
  await flush();
  assert.deepEqual(t.log, ['rejected']);
  assert.ok(t.errors[0] instanceof CancellationError);
  assert.equal(workers.length, 0, 'no worker was even created');

  const never = rig(null);
  const c2 = new AbortController();
  const p = track(never.channel.send('optimize', {}, { timeLimitMs: 60_000, signal: c2.signal }));
  c2.abort();
  assert.equal(never.timers.pending(), 0);
  assert.equal(lastPost(never.workers[0]).type, 'cancel');
  assert.deepEqual(p.log, []);
});

test('a worker crash rejects every pending request with the failure (not a cancellation), drops the worker, and the next request starts a fresh one', async () => {
  const { channel, workers } = rig();
  const a = track(channel.send('optimize', {}, { timeLimitMs: 60_000 }));
  const b = track(channel.send('getInfo', {}));
  const originalError = console.error;
  console.error = () => {}; // the channel logs the worker error
  try {
    workers[0].onerror!({ message: 'wasm out of memory' });
  } finally {
    console.error = originalError;
  }
  await flush();
  for (const t of [a, b]) {
    assert.deepEqual(t.log, ['rejected']);
    assert.ok(!(t.errors[0] instanceof CancellationError));
    assert.equal((t.errors[0] as Error).message, 'wasm out of memory');
  }
  assert.equal(workers[0].terminated, 1);
  void channel.send('getInfo', {});
  assert.equal(workers.length, 2);
});

test('a native failure arrives as a typed SolverError with its completion metadata; a plain payload as an Error', async () => {
  const { channel, workers } = rig();
  const completion = { nodes: 3, termination: 'limit' as const, witness: true, lower_bound: 1.5, upper_bound: null, absolute_gap: null };
  const typed = track(channel.send('optimize', {}, { timeLimitMs: 60_000 }));
  const plain = track(channel.send('getInfo', {}));
  const original = new NativeSolverError('solve', new Error('trap'));
  const serialized = serializeWorkerError(new SolverError('solve', new Error('trap'), true, completion));
  workers[0].emit({ type: 'error', id: 0, payload: JSON.parse(JSON.stringify(serialized)) });
  workers[0].emit({ type: 'error', id: 1, payload: { kind: 'error', name: 'RangeError', message: 'bad input' } });
  await flush();
  const error = typed.errors[0];
  assert.ok(error instanceof SolverError && error instanceof NativeSolverError);
  assert.equal((error as SolverError).phase, 'solve');
  assert.equal((error as SolverError).message, original.message);
  assert.deepEqual((error as SolverError).completion, completion);
  assert.equal((plain.errors[0] as Error).name, 'RangeError');
  assert.equal((plain.errors[0] as Error).message, 'bad input');
});

test('a message that cannot be posted fails only its own request', async () => {
  const { channel, workers } = rig();
  void channel.send('getInfo', {});
  workers[0].postMessage = () => { throw new DOMException('not cloneable', 'DataCloneError'); };
  const bad = track(channel.send('getInfo', {}));
  await flush();
  assert.deepEqual(bad.log, ['rejected']);
  assert.equal(channel.pendingCount, 1, 'the earlier request is still pending');
});
