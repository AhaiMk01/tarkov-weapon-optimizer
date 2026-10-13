// Explore and the MOA floor THROUGH the worker runtime and the client, on small fixtures and the pinned native build (Phase 2.7 integration): the real drivers
// behind the queue-expiry, cancel and invalid-stock envelopes, a cancel delivered across a macrotask yield during each, the typed native failure of a floor
// query with its published snapshot, and the client functions end to end over a loopback worker (explore and computeMOAFloor return the real responses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, MOAFloorResponse, OptimizeResponse } from '../../src/api/client';
import { computeMOAFloor, explore, optimize, terminateWorker, CancellationError } from '../../src/api/client';
import type { LoadedState } from '../../src/solver/dataService';
import { SolverError as NativeSolverError } from '../../src/solver/native/errors';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { rat } from '../../src/solver/physical/exact';
import { ratRoundUp } from '../../src/solver/physical/rational';
import { epochNow } from '../../src/solver/requestGuard';
import { PUBLIC_REASON_SET, PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { reviveWorkerError, SolverError } from '../../src/solver/runtimeErrors';
import { solveRequest } from '../../src/solver/solver';
import type { ItemLookup } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerDeps, WorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerInMessage, WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gunWith, lookupOf, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

// ---------------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Receiver COI 1/16. A required barrel slot (4.297, 1.074 or 0.537 MOA by replacement), an optional scope and an optional suppressor: the floor of
 * the provisional model is best barrel + scope = 28125/58178 MOA, with a 5000 receiver, barrels at 100, 100 and 500, and a 300 scope.
 */
const floorLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { coi: 0.0625, slots: [slot('barrel', ['b_wide', 'b_mid', 'b_best'], true), slot('optic', ['scope']), slot('muzzle', ['sup'])] }),
  ['b_wide', modWith('b_wide', { coi: 0.125 })],
  ['b_mid', modWith('b_mid', { coi: 0.03125 })],
  ['b_best', modWith('b_best', { coi: 0.015625, offers: [trader('prapor', 1, 500)] })],
  ['scope', modWith('scope', { accuracy: 10, offers: [trader('prapor', 1, 300)] })],
  ['sup', modWith('sup', { accuracy: -5 })],
);
const MINIMUM = ratRoundUp(rat(28125n, 58178n));

/** Two grips and two stocks: an ergonomics/recoil/price trade-off with a multi-step Explore sweep. */
const sweepLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { weight: 1, ergo: 40, recoilV: 100, recoilH: 50, slots: [slot('grip', ['g1', 'g2']), slot('stock', ['s1', 's2'])] }),
  ['g1', modWith('g1', { ergo: 5, recoil: -0.02, weight: 0.2, offers: [trader('prapor', 1, 200)] })],
  ['g2', modWith('g2', { ergo: 10, recoil: -0.05, weight: 0.4, offers: [trader('prapor', 1, 800)] })],
  ['s1', modWith('s1', { ergo: 3, recoil: -0.1, weight: 0.5, offers: [trader('prapor', 1, 300)] })],
  ['s2', modWith('s2', { ergo: 12, recoil: 0, weight: 0.3, offers: [trader('prapor', 1, 1500)] })],
);

let generation = 100;
const stateOf = (itemLookup: ItemLookup): LoadedState => ({ guns: [], mods: [], itemLookup, loadedAt: 0, generation: ++generation });

// ---------------------------------------------------------------------------------------------------------------------------
// A real runtime
// ---------------------------------------------------------------------------------------------------------------------------

interface Rig {
  runtime: WorkerRuntime;
  posted: WorkerOutMessage[];
  /** The terminal message of a request. */
  terminal(id: number): WorkerOutMessage;
  result<T>(id: number): T;
}

function rig(lookup: ItemLookup, overrides: Partial<WorkerDeps> = {}): Rig {
  const posted: WorkerOutMessage[] = [];
  const state = stateOf(lookup);
  const runtime = createWorkerRuntime({ post: m => { posted.push(m); }, loadData: async () => state, ...overrides });
  const terminal = (id: number): WorkerOutMessage => {
    const m = posted.filter(p => p.id === id && p.type !== 'snapshot');
    assert.equal(m.length, 1, `one terminal message for ${id}: ${m.map(x => x.type).join(',')}`);
    return m[0];
  };
  return {
    runtime, posted, terminal,
    result: <T>(id: number): T => {
      const m = terminal(id);
      assert.notEqual(m.type, 'error', JSON.stringify(m.payload));
      return m.payload as T;
    },
  };
}

const exploreMsg = (id: number, request: Record<string, unknown> = {}, deadline = epochNow() + 120_000): WorkerInMessage => ({
  type: 'explore', id,
  payload: { request: { weapon_id: WEAPON, ignore: 'price', precise_mode: 'precise', ...request } as never, lang: 'en', gameMode: 'regular', deadline },
});
const floorMsg = (id: number, request: Record<string, unknown> = {}, deadline = epochNow() + 120_000): WorkerInMessage => ({
  type: 'computeMOAFloor', id, payload: { request: { weapon_id: WEAPON, ...request } as never, lang: 'en', gameMode: 'regular', deadline },
});
const cancelMsg = (targetId: number): WorkerInMessage => ({ type: 'cancel', id: 1000 + targetId, payload: { targetId } });

/** Deliver the cancel of `targetId` as the worker would receive a message: as a task of the event loop, so only a macrotask yield lets it in. */
const cancelOnNextTask = (r: Rig, targetId: number): void => { setTimeout(() => r.runtime.receive(cancelMsg(targetId)), 0); };

// ---------------------------------------------------------------------------------------------------------------------------
// Floor through the runtime
// ---------------------------------------------------------------------------------------------------------------------------

test('the floor through the runtime: the real driver proves the minimum of a fixture, over the caller stash and domain', async () => {
  const r = rig(floorLookup());
  r.runtime.receive(floorMsg(1, { owned_items: ['scope'] }));
  r.runtime.receive(floorMsg(2, { max_price: 5100 })); // the budget excludes the 500 barrel and the 300 scope
  await r.runtime.idle();
  const proved = r.result<MOAFloorResponse>(1);
  assert.equal(proved.status, 'model_proved', JSON.stringify(proved));
  assert.equal(proved.moa_qualification, 'provisional_model');
  assert.equal(proved.floor, MINIMUM);
  assert.ok(proved.proved_lower_bound !== null && (proved.floor as number) - proved.proved_lower_bound <= 0.02);
  assert.deepEqual([...proved.witness!.selected_item_ids].sort(), ['b_best', 'scope']);
  assert.deepEqual(proved.witness!.scope.inventory.owned_items, ['scope'], 'the validated stash is part of the witness scope');
  const scope = proved.witness!.selected_items.find(i => i.id === 'scope')!;
  assert.deepEqual([scope.acquisition?.source, scope.price], ['owned', 0], 'the owned scope is free');

  const budget = r.result<MOAFloorResponse>(2);
  assert.equal(budget.status, 'model_proved');
  assert.deepEqual(budget.witness!.selected_item_ids, ['b_mid']);
  assert.equal(budget.floor, ratRoundUp(rat(31250n, 29089n)));
  assert.equal(budget.witness!.scope.feasibility.max_price, 5100);
});

test('a floor cancelled across a macrotask yield returns its retained witness with Cancelled by user', async () => {
  let natives = 0;
  const holder: { rig?: Rig } = {};
  const solve: SolveFn = async (text, options, extras) => {
    const result = await nativeSolve(text, options, extras);
    if (++natives === 1) cancelOnNextTask(holder.rig!, 1); // the seed is done; the cancel message arrives as a task
    return result;
  };
  const r = rig(floorLookup(), { floorDeps: { solve } });
  holder.rig = r;
  r.runtime.receive(floorMsg(1));
  await r.runtime.idle();
  const floor = r.result<MOAFloorResponse>(1);
  assert.equal(natives, 1, 'no trial started after the cancel');
  assert.equal(floor.status, 'model_witnessed');
  assert.equal(floor.reason, 'Cancelled by user');
  assert.ok(floor.witness !== undefined && floor.floor === floor.witness.achieved_moa, 'the seed witness is kept');
  assert.equal(floor.proved_lower_bound, null);
});

test('a floor stops with its envelope when the stash is invalid or the request expired in the queue, before any solve', async () => {
  let natives = 0;
  const solve: SolveFn = (text, options, extras) => { natives++; return nativeSolve(text, options, extras); };
  const r = rig(floorLookup(), { floorDeps: { solve } });
  r.runtime.receive(floorMsg(1, { owned_items: ['scope', ''] }));
  r.runtime.receive(floorMsg(2, {}, epochNow() - 1));
  await r.runtime.idle();
  assert.equal(r.result<MOAFloorResponse>(1).reason, 'Invalid owned_items format');
  assert.equal(r.result<MOAFloorResponse>(2).reason, 'Queue timeout before dispatch');
  assert.equal(natives, 0);
});

test('a typed native failure in a floor query publishes the retained state as a snapshot, then fails the request with the same typed error', async () => {
  let natives = 0;
  const solve: SolveFn = (text, options, extras) => {
    if (++natives === 2) throw new NativeSolverError('solve', new Error('wasm trap'));
    return nativeSolve(text, options, extras);
  };
  const r = rig(floorLookup(), { floorDeps: { solve } });
  r.runtime.receive(floorMsg(1));
  await r.runtime.idle();
  assert.equal(natives, 2);
  const mine = r.posted.filter(m => m.id === 1);
  assert.deepEqual(mine.map(m => m.type), ['snapshot', 'error'], 'the snapshot first, then the typed error; never a result');
  const snapshot = mine[0].payload as MOAFloorResponse;
  assert.equal(snapshot.status, 'model_witnessed');
  assert.ok(snapshot.witness !== undefined && snapshot.floor === snapshot.witness.achieved_moa, 'the seed witness is retained');
  const payload = mine[1].payload as { kind: string; phase: string; completion: { floor: MOAFloorResponse; witness: boolean } };
  assert.equal(payload.kind, 'SolverError');
  assert.equal(payload.phase, 'solve');
  assert.deepEqual(payload.completion.floor, snapshot);
  assert.equal(payload.completion.witness, true);
  const revived = reviveWorkerError(structuredClone(mine[1].payload));
  assert.ok(revived instanceof SolverError);
  assert.deepEqual((revived as SolverError).completion?.floor, snapshot);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Explore through the runtime
// ---------------------------------------------------------------------------------------------------------------------------

test('Explore through the runtime: a recorded schedule, one V/I/U/E row per target, points the driver classified, the stash honoured at every step', async () => {
  const r = rig(sweepLookup());
  r.runtime.receive(exploreMsg(1, { owned_items: ['s2', 's2'] }));
  await r.runtime.idle();
  const response = r.result<ExploreResponse>(1);
  assert.equal(response.curve_status, 'complete', JSON.stringify(response.step_outcomes.map(s => [s.outcome, s.reason])));
  assert.ok(response.sweep_schedule.length >= 3);
  assert.equal(response.step_outcomes.length, response.sweep_schedule.length);
  assert.ok(response.step_outcomes.every(s => s.outcome === 'V' && s.physical_certificate === 'certified_optimal'));
  assert.equal(response.precision_request, 'precise');
  assert.equal(response.precision_resolved, 'precise');
  assert.equal(response.model_qualification, 'exact');
  assert.equal(response.moa_qualification, null);
  assert.ok(response.points.length >= 2);
  const owned = response.points.flatMap(p => p.selected_items).filter(i => i.id === 's2');
  assert.ok(owned.length > 0 && owned.every(i => i.acquisition?.source === 'owned' && i.price === 0), 'the owned stock reaches every step');
});

test('every Explore request builds a fresh schedule: two sweeps through one runtime agree', async () => {
  const r = rig(sweepLookup());
  r.runtime.receive(exploreMsg(1));
  r.runtime.receive(exploreMsg(2));
  await r.runtime.idle();
  const a = r.result<ExploreResponse>(1);
  const b = r.result<ExploreResponse>(2);
  assert.deepEqual(a.sweep_schedule, b.sweep_schedule);
  assert.deepEqual(a.step_outcomes.map(s => s.outcome), b.step_outcomes.map(s => s.outcome));
});

test('an Explore cancelled across a macrotask yield keeps the completed targets, leaves the generated rest unlaunched (U), and is partial', async () => {
  const holder: { rig?: Rig } = {};
  let solves = 0;
  const solve: WorkerDeps['solve'] = async params => {
    const report = await solveRequest(params);
    if (++solves === 2) cancelOnNextTask(holder.rig!, 1); // both endpoints are done
    return report;
  };
  const r = rig(sweepLookup(), { solve });
  holder.rig = r;
  r.runtime.receive(exploreMsg(1));
  await r.runtime.idle();
  const response = r.result<ExploreResponse>(1);
  assert.equal(solves, 2, 'no step was solved after the cancel');
  assert.equal(response.curve_status, 'partial');
  assert.equal(response.reason, 'Cancelled by user');
  assert.deepEqual(response.step_outcomes.slice(0, 2).map(s => s.outcome), ['V', 'V']);
  assert.ok(response.step_outcomes.length >= 3);
  assert.ok(response.step_outcomes.slice(2).every(s => s.outcome === 'U' && s.reason === 'Cancelled by user'));
  assert.ok(response.points.length >= 1);
});

test('Explore stops with its envelope before any solve when the stash is invalid or the request expired in the queue', async () => {
  let solves = 0;
  const solve: WorkerDeps['solve'] = async params => { solves++; return solveRequest(params); };
  const r = rig(sweepLookup(), { solve });
  r.runtime.receive(exploreMsg(1, { owned_items: [1] }));
  r.runtime.receive(exploreMsg(2, {}, epochNow() - 1));
  await r.runtime.idle();
  assert.equal(r.result<ExploreResponse>(1).reason, 'Invalid owned_items format');
  assert.equal(r.result<ExploreResponse>(2).reason, 'Queue timeout before dispatch');
  assert.equal(r.result<ExploreResponse>(2).curve_status, 'invalid');
  assert.equal(solves, 0);
});

test('an unsweepable Explore request is invalid with the closed-set schedule reason and no solve', async () => {
  let solves = 0;
  const solve: WorkerDeps['solve'] = async params => { solves++; return solveRequest(params); };
  const r = rig(sweepLookup(), { solve });
  r.runtime.receive(exploreMsg(1, { steps: Number.NaN }));
  await r.runtime.idle();
  const response = r.result<ExploreResponse>(1);
  assert.equal(response.curve_status, 'invalid');
  assert.equal(response.reason, PUBLIC_REASONS.invalidExploreSchedule);
  assert.equal(response.reason, 'Invalid Explore schedule');
  assert.ok(PUBLIC_REASON_SET.has(response.reason as string), 'the reason is part of the closed set');
  assert.deepEqual(response.points, []);
  assert.equal(solves, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The client end to end over a loopback worker
// ---------------------------------------------------------------------------------------------------------------------------

let lookupForClient: ItemLookup = floorLookup();
let loadForClient: () => Promise<LoadedState> = async () => stateOf(lookupForClient);

/** A worker that runs the real runtime in this thread; messages cross as structured clones and as tasks, like a real worker port. */
class LoopbackWorker {
  static instances: LoopbackWorker[] = [];
  onmessage: ((event: { data: WorkerOutMessage }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  terminated = false;
  private readonly runtime: WorkerRuntime;

  constructor(_url: unknown, _options: unknown) {
    LoopbackWorker.instances.push(this);
    this.runtime = createWorkerRuntime({
      post: m => {
        const copy = structuredClone(m);
        setTimeout(() => { if (!this.terminated) this.onmessage?.({ data: copy }); }, 0);
      },
      loadData: () => loadForClient(),
    });
  }

  postMessage(message: WorkerInMessage): void {
    const copy = structuredClone(message);
    setTimeout(() => { if (!this.terminated) this.runtime.receive(copy); }, 0);
  }

  terminate(): void { this.terminated = true; }
}
(globalThis as unknown as { Worker: unknown }).Worker = LoopbackWorker;

const fresh = (lookup: ItemLookup): void => { lookupForClient = lookup; loadForClient = async () => stateOf(lookup); };

test('client.computeMOAFloor returns the real MOAFloorResponse end to end, and client.explore the real ExploreResponse', async () => {
  fresh(floorLookup());
  const floor = await computeMOAFloor({ weapon_id: WEAPON, owned_items: ['scope'] });
  assert.equal(floor.status, 'model_proved');
  assert.equal(floor.floor, MINIMUM);
  assert.equal(floor.moa_qualification, 'provisional_model');
  assert.deepEqual(floor.witness?.scope.inventory.owned_items, ['scope']);

  fresh(sweepLookup());
  const sweep = await explore({ weapon_id: WEAPON, ignore: 'price', precise_mode: 'precise' });
  assert.equal(sweep.curve_status, 'complete');
  assert.equal(sweep.step_outcomes.length, sweep.sweep_schedule.length);
  assert.ok(sweep.points.length >= 2);
  assert.ok(sweep.step_outcomes.every(s => s.outcome === 'V'));
});

test('client.optimize, explore and computeMOAFloor each return their own null envelope for an invalid stash, and an expired budget', async () => {
  fresh(sweepLookup());
  const bad = [''] as string[];
  const o: OptimizeResponse = await optimize({ weapon_id: WEAPON, owned_items: bad });
  assert.equal(o.reason, 'Invalid owned_items format');
  assert.equal(o.status, 'incomplete');
  assert.equal((await explore({ weapon_id: WEAPON, ignore: 'price', owned_items: bad })).curve_status, 'invalid');
  assert.equal((await computeMOAFloor({ weapon_id: WEAPON, owned_items: bad })).status, 'unresolved');
  // A zero budget is spent before the request is dispatched.
  assert.equal((await optimize({ weapon_id: WEAPON, time_limit_ms: 0 })).reason, 'Queue timeout before dispatch');
  assert.equal((await explore({ weapon_id: WEAPON, ignore: 'price', time_limit_ms: 0 })).reason, 'Queue timeout before dispatch');
  assert.equal((await computeMOAFloor({ weapon_id: WEAPON, time_limit_ms: 0 })).reason, 'Queue timeout before dispatch');
});

test('a soft cancel through the client signal returns the operation response with Cancelled by user, not a rejection', async () => {
  fresh(sweepLookup());
  const controller = new AbortController();
  loadForClient = async () => { controller.abort(); return stateOf(sweepLookup()); }; // the abort arrives while the request is being served
  const response = await explore({ weapon_id: WEAPON, ignore: 'price', precise_mode: 'precise' }, 'regular', 'en', { signal: controller.signal });
  assert.equal(response.reason, 'Cancelled by user');
  assert.equal(response.curve_status, 'invalid', 'nothing was solved before the cancel was observed');
  assert.ok(response.step_outcomes.every(s => s.outcome === 'U'));
});

test('a hard termination rejects the pending client promise with CancellationError and the next call gets a fresh worker', async () => {
  const gate = new Promise<LoadedState>(() => undefined); // the worker never finishes loading
  loadForClient = () => gate;
  const pending = computeMOAFloor({ weapon_id: WEAPON });
  const settled: string[] = [];
  pending.then(() => settled.push('resolved'), () => settled.push('rejected'));
  await new Promise(resolve => setTimeout(resolve, 5));
  const active = LoopbackWorker.instances[LoopbackWorker.instances.length - 1];
  assert.equal(active.terminated, false);
  terminateWorker('stopped by the test');
  await assert.rejects(pending, (error: unknown) => error instanceof CancellationError && error.reason === 'stopped by the test');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(settled, ['rejected'], 'rejected exactly once');
  assert.equal(active.terminated, true);
  const count = LoopbackWorker.instances.length;

  fresh(floorLookup());
  const again = await computeMOAFloor({ weapon_id: WEAPON, owned_items: ['scope'] });
  assert.equal(again.status, 'model_proved');
  assert.equal(LoopbackWorker.instances.length, count + 1, 'one fresh worker was created');
  assert.notEqual(LoopbackWorker.instances[count], active);
});
