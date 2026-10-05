// The worker runtime (src/solver/workerRuntime.ts, ADR 0013 sections 4D, 5 and 6, Phase 2.7a) with injected collaborators: the queue-inclusive epoch
// deadline, queue expiry and cancel envelopes per operation, out-of-band cancel, owned_items validation and forwarding, metadata operations, the
// endpoint cache and its invalidation, and the typed native failure. No HiGHS: the solve is a spy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreRequest, MOAFloorRequest, OptimizeRequest, OptimizeResponse } from '../../src/api/client';
import type { LoadedState } from '../../src/solver/dataService';
import { exploreEnvelope, floorEnvelope, optimizeEnvelope } from '../../src/solver/operationEnvelopes';
import { SolverError as NativeSolverError } from '../../src/solver/native/errors';
import { attachCompletion, reviveWorkerError, SolverError } from '../../src/solver/runtimeErrors';
import type { SerializedWorkerError } from '../../src/solver/runtimeErrors';
import { remainingMs } from '../../src/solver/runtimeGuard';
import type { EndpointRecord, PayoffReport, SolveReport } from '../../src/solver/solver';
import type { SolveParams } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { ExploreRunInput, FloorRunInput, WorkerDeps } from '../../src/solver/workerRuntime';
import type { WorkerInMessage, WorkerOperation, WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

// ---------------------------------------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

const makeState = (generation: number): LoadedState => ({
  guns: [{ id: WEAPON, name: 'Test Gun', properties: { caliber: 'Caliber556x45NATO', centerOfImpact: 0.5, defaultPreset: {} }, bsgCategory: { name: 'Assault rifle' } }],
  mods: [],
  itemLookup: lookupOf(
    gun(WEAPON, { slots: [slot('s', ['a', 'b'])] }),
    ['a', mod('a', { ergo: 5 })], ['b', mod('b', { ergo: 4 })],
  ),
  loadedAt: 0,
  generation,
});

const cannedResponse = (extra: Partial<OptimizeResponse> = {}): OptimizeResponse => {
  const base = optimizeEnvelope('cancelled', { precisionRequest: 'precise', moaDependent: false });
  delete base.reason;
  return { ...base, status: 'optimal', precision_resolved: 'precise', model_qualification: 'exact', physical_certificate: 'certified_optimal', ...extra };
};

const certifiedEndpoints = (): EndpointRecord[] => [0, 1, 2].map(i => ({
  weights: [[100, 0, 0], [0, 100, 0], [0, 0, 100]][i] as [number, number, number],
  status: 'optimal', physical_certificate: 'certified_optimal', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
}));

const payoffOf = (endpoints: EndpointRecord[] = certifiedEndpoints()): PayoffReport => ({ idealPoint: { zE: 50, nadE: 0, zR: -3, nadR: 0, zP: 5, nadP: 9 }, endpoints });

interface Deferred { promise: Promise<void>; release(): void }
const deferred = (): Deferred => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

interface Harness {
  receive(message: WorkerInMessage): void;
  idle(): Promise<void>;
  posted: WorkerOutMessage[];
  clock: { t: number };
  calls: { loadData: number; solve: SolveParams[]; explore: ExploreRunInput[]; floor: FloorRunInput[]; fetchTasks: number; clearLoaded: number };
  /** Replace what `solve` returns / waits for. */
  setSolve(fn: (params: SolveParams) => Promise<SolveReport>): void;
  /** The state `loadData` will hand out next. */
  setState(state: LoadedState): void;
  resultOf(id: number): unknown;
  errorOf(id: number): SerializedWorkerError;
}

function harness(overrides: Partial<WorkerDeps> = {}): Harness {
  const posted: WorkerOutMessage[] = [];
  const clock = { t: T0 };
  const calls: Harness['calls'] = { loadData: 0, solve: [], explore: [], floor: [], fetchTasks: 0, clearLoaded: 0 };
  let state = makeState(1);
  let solveImpl = async (): Promise<SolveReport> => ({ response: cannedResponse(), payoff: null });
  const deps: WorkerDeps = {
    post: m => { posted.push(m); },
    now: () => clock.t,
    yieldMacrotask: async () => { await Promise.resolve(); },
    loadData: async () => { calls.loadData++; return state; },
    clearLoadedData: () => { calls.clearLoaded++; state = makeState(state.generation + 1); },
    solve: async params => { calls.solve.push(params); return solveImpl(); },
    fetchTasks: async () => { calls.fetchTasks++; return [{ task_name: 'Task', weapon_id: WEAPON, required_item_ids: ['a'], constraints: {} }]; },
    runExplore: async input => { calls.explore.push(input); return { ...exploreEnvelope('cancelled', { precisionRequest: input.precisionRequest, moaDependent: false }), curve_status: 'partial' }; },
    runMoaFloor: async input => { calls.floor.push(input); return { ...floorEnvelope('cancelled'), status: 'model_witnessed', floor: 1.5 }; },
    ...overrides,
  };
  const runtime = createWorkerRuntime(deps);
  return {
    receive: runtime.receive,
    idle: runtime.idle,
    posted,
    clock,
    calls,
    setSolve: fn => { solveImpl = () => fn(calls.solve[calls.solve.length - 1]); },
    setState: s => { state = s; },
    resultOf: id => {
      const m = posted.filter(p => p.id === id && p.type !== 'snapshot');
      assert.equal(m.length, 1, `exactly one terminal message for ${id}, got ${m.map(x => x.type).join(',')}`);
      assert.notEqual(m[0].type, 'error', JSON.stringify(m[0].payload));
      return m[0].payload;
    },
    errorOf: id => {
      const m = posted.filter(p => p.id === id && p.type === 'error');
      assert.equal(m.length, 1);
      return m[0].payload as SerializedWorkerError;
    },
  };
}

/** `deadline`: an epoch millisecond value as the client would stamp it, `null` for a message that carries none, omitted for the operation default window. */
const optimizeMsg = (id: number, request: Partial<OptimizeRequest> = {}, deadline: number | null = T0 + 60_000): WorkerInMessage => ({
  type: 'optimize', id, payload: { request: { weapon_id: WEAPON, ...request }, lang: 'en', gameMode: 'regular', ...(deadline === null ? {} : { deadline }) },
});
const exploreMsg = (id: number, request: Partial<ExploreRequest> = {}, deadline: number | null = T0 + 60_000): WorkerInMessage => ({
  type: 'explore', id, payload: { request: { weapon_id: WEAPON, ignore: 'price', ...request } as ExploreRequest, lang: 'en', gameMode: 'regular', ...(deadline === null ? {} : { deadline }) },
});
const floorMsg = (id: number, request: Partial<MOAFloorRequest> = {}, deadline: number | null = T0 + 30_000): WorkerInMessage => ({
  type: 'computeMOAFloor', id, payload: { request: { weapon_id: WEAPON, ...request }, lang: 'en', gameMode: 'regular', ...(deadline === null ? {} : { deadline }) },
});
/** Let every pending microtask and timer callback run. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const simple = (type: WorkerOperation, id: number, extra: Record<string, unknown> = {}): WorkerInMessage => ({ type, id, payload: { lang: 'en', gameMode: 'regular', ...extra } } as WorkerInMessage);
const cancelMsg = (targetId: number): WorkerInMessage => ({ type: 'cancel', id: 9000 + targetId, payload: { targetId } });

const OPERATIONS = [
  { name: 'Optimize', message: (id: number, deadline?: number, request: Partial<OptimizeRequest> = {}) => optimizeMsg(id, request, deadline) },
  { name: 'Explore', message: (id: number, deadline?: number, request: Partial<ExploreRequest> = {}) => exploreMsg(id, request, deadline) },
  { name: 'MOA floor', message: (id: number, deadline?: number, request: Partial<MOAFloorRequest> = {}) => floorMsg(id, request, deadline) },
] as const;

/** The pre-model envelope of an operation, to compare responses with. */
const envelopeOf = (name: string, stop: 'invalid_owned_items' | 'queue_timeout' | 'cancelled', elapsedMs: number, moaDependent = false): unknown => {
  if (name === 'Optimize') return optimizeEnvelope(stop, { precisionRequest: 'fast', moaDependent, elapsedMs });
  if (name === 'Explore') return exploreEnvelope(stop, { precisionRequest: 'fast', moaDependent, elapsedMs });
  return floorEnvelope(stop, { elapsedMs });
};

// ---------------------------------------------------------------------------------------------------------------------------
// Epoch deadline, queue expiry, cancel
// ---------------------------------------------------------------------------------------------------------------------------

for (const op of OPERATIONS) {
  test(`${op.name}: a request that expired in the queue stops before any preparation with its own envelope and Queue timeout before dispatch`, async () => {
    const h = harness();
    const gate = deferred();
    h.setSolve(async () => { await gate.promise; return { response: cannedResponse(), payoff: null }; });
    h.receive(optimizeMsg(1)); // the running request holds the worker
    h.receive(op.message(2, T0 + 100));
    await Promise.resolve();
    h.clock.t = T0 + 500; // B waited behind A beyond its deadline
    gate.release();
    await h.idle();
    const loadsAfterA = 1;
    assert.equal(h.calls.loadData, loadsAfterA, 'the expired request loaded nothing');
    assert.equal(h.calls.solve.length, 1);
    assert.equal(h.calls.explore.length, 0);
    assert.equal(h.calls.floor.length, 0);
    const result = h.resultOf(2) as { reason?: string };
    assert.equal(result.reason, 'Queue timeout before dispatch');
    assert.deepEqual(result, envelopeOf(op.name, 'queue_timeout', 500));
  });
}

test('the envelopes are null: nothing resolved, no build, no proof, no node, a search that never started', () => {
  const o = optimizeEnvelope('queue_timeout', { precisionRequest: 'auto', moaDependent: true });
  assert.equal(o.status, 'incomplete');
  assert.equal(o.physical_certificate, 'none');
  assert.equal(o.precision_request, 'auto');
  assert.equal(o.precision_resolved, null);
  assert.equal(o.model_qualification, null);
  assert.equal(o.moa_qualification, 'provisional_model', 'the MOA qualification still says what the request asked');
  assert.deepEqual(o.selected_items, []);
  assert.deepEqual(o.slot_pairs, []);
  assert.equal(o.objective_value, null);
  assert.deepEqual(o.optimization, { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' });
  const e = exploreEnvelope('queue_timeout', { precisionRequest: 'fast', moaDependent: false });
  assert.equal(e.curve_status, 'invalid');
  assert.deepEqual(e.points, []);
  assert.deepEqual(e.sweep_schedule, []);
  assert.deepEqual(e.step_outcomes, []);
  assert.equal(e.precision_resolved, null);
  assert.equal(e.model_qualification, null);
  assert.equal(e.moa_qualification, null, 'MOA-independent Explore: null, never n/a');
  const f = floorEnvelope('queue_timeout');
  assert.deepEqual(f, { status: 'unresolved', moa_qualification: 'provisional_model', floor: null, display_floor: null, proved_lower_bound: null, solve_time_ms: 0, reason: 'Queue timeout before dispatch' });
  assert.equal('witness' in f, false);
});

test('the guard of a dispatched request carries the client-stamped epoch deadline: the time spent queued is already spent', async () => {
  const h = harness();
  const gate = deferred();
  h.setSolve(async () => { await gate.promise; return { response: cannedResponse(), payoff: null }; });
  h.receive(optimizeMsg(1));
  h.receive(optimizeMsg(2, {}, T0 + 10_000));
  await Promise.resolve();
  h.clock.t = T0 + 4_000;
  gate.release();
  await h.idle();
  const guard = h.calls.solve[1].guard;
  assert.ok(guard !== undefined);
  assert.equal(guard.deadline, T0 + 10_000, 'the deadline is the stamped one, not a fresh budget from dispatch');
  assert.equal(remainingMs(guard), 6_000, 'the 4 s in the queue count');
});

test('without a stamped deadline the budget runs from arrival: the operation defaults are 60 s, 60 s and 30 s, and time_limit_ms overrides them', async () => {
  const h = harness();
  h.receive(optimizeMsg(1, {}, null));
  h.receive(exploreMsg(2, {}, null));
  h.receive(floorMsg(3, {}, null));
  h.receive(optimizeMsg(4, { time_limit_ms: 5_000 }, null));
  await h.idle();
  assert.equal(h.calls.solve[0].guard?.deadline, T0 + 60_000);
  assert.equal(h.calls.explore[0].guard.deadline, T0 + 60_000);
  assert.equal(h.calls.floor[0].guard.deadline, T0 + 30_000);
  assert.equal(h.calls.solve[1].guard?.deadline, T0 + 5_000);
});

test('a cancel message bypasses the dispatch chain: it flags the running request at once, while the worker is still busy', async () => {
  const h = harness();
  const gate = deferred();
  const seen: boolean[] = [];
  h.setSolve(async () => {
    const guard = h.calls.solve[0].guard!;
    seen.push(guard.cancelled());
    h.receive(cancelMsg(1)); // delivered while request 1 is running and request 2 is queued behind it
    seen.push(guard.cancelled());
    await gate.promise;
    return { response: cannedResponse(), payoff: null };
  });
  h.receive(optimizeMsg(1));
  h.receive(optimizeMsg(2));
  await flush();
  assert.deepEqual(seen, [false, true], 'visible immediately, not after the chain drains');
  assert.equal(h.posted.length, 0, 'request 1 has not finished');
  gate.release();
  await h.idle();
  assert.equal(h.calls.solve[1].guard?.cancelled(), false, 'the cancel is scoped to its own request');
});

for (const op of OPERATIONS) {
  test(`${op.name}: a request cancelled while queued returns its envelope with Cancelled by user, and cancel outranks a coincident expiry`, async () => {
    const h = harness();
    const gate = deferred();
    h.setSolve(async () => { await gate.promise; return { response: cannedResponse(), payoff: null }; });
    h.receive(optimizeMsg(1));
    h.receive(op.message(2, T0 + 100));
    await Promise.resolve();
    h.receive(cancelMsg(2));
    h.receive(cancelMsg(77)); // unknown or finished target: ignored
    h.clock.t = T0 + 500; // expired as well
    gate.release();
    await h.idle();
    assert.equal(h.calls.loadData, 1);
    assert.deepEqual(h.resultOf(2), envelopeOf(op.name, 'cancelled', 500));
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// owned_items
// ---------------------------------------------------------------------------------------------------------------------------

const INVALID_STASHES: { name: string; value: unknown }[] = [
  { name: 'a sparse array', value: new Array<string>(3) },
  { name: 'a sparse hole among entries', value: (() => { const a = ['x', 'y', 'z']; delete a[1]; return a; })() },
  { name: 'a non-string entry', value: ['a', 1] },
  { name: 'an empty string entry', value: ['a', ''] },
  { name: '10001 entries', value: Array.from({ length: 10_001 }, () => 'a') },
  { name: 'a string instead of an array', value: 'a' },
  { name: 'an object', value: { 0: 'a', length: 1 } },
];

for (const op of OPERATIONS) {
  test(`${op.name}: an invalid owned_items list returns the null envelope before hashing, loading, caching or any model work`, async () => {
    for (const bad of INVALID_STASHES) {
      const h = harness();
      h.receive(op.message(1, undefined, { owned_items: bad.value as string[] }));
      await h.idle();
      assert.deepEqual(h.resultOf(1), envelopeOf(op.name, 'invalid_owned_items', 0), bad.name);
      assert.equal(h.calls.loadData, 0, `${bad.name}: no data load`);
      assert.equal(h.calls.solve.length + h.calls.explore.length + h.calls.floor.length, 0, `${bad.name}: no model work`);
    }
  });

  test(`${op.name}: an invalid owned_items list is reported even when the request also expired in the queue, and 10000 entries are valid`, async () => {
    const h = harness();
    h.clock.t = T0 + 1_000_000;
    h.receive(op.message(1, T0 + 1, { owned_items: ['a', ''] }));
    await h.idle();
    assert.deepEqual(h.resultOf(1), envelopeOf(op.name, 'invalid_owned_items', 0));
    const ok = harness();
    ok.receive(op.message(1, undefined, { owned_items: Array.from({ length: 10_000 }, () => 'a') }));
    await ok.idle();
    assert.equal(ok.calls.loadData, 1);
  });
}

test('the Optimize envelope for an invalid stash keeps the MOA qualification of a capped request', async () => {
  const h = harness();
  h.receive(optimizeMsg(1, { owned_items: [''], max_moa: 4 }));
  await h.idle();
  assert.deepEqual(h.resultOf(1), optimizeEnvelope('invalid_owned_items', { precisionRequest: 'fast', moaDependent: true, elapsedMs: 0 }));
});

test('the validated multiset is forwarded to Optimize, and the Gunsmith optimize call is the same message: duplicates and order kept, a frozen snapshot', async () => {
  const h = harness();
  const stash = ['b', 'a', 'b'];
  h.receive(optimizeMsg(1, { owned_items: stash }));
  h.receive(optimizeMsg(2, {}));
  h.receive(optimizeMsg(3, { owned_items: [] }));
  await h.idle();
  stash.push('mutated-later');
  assert.deepEqual(h.calls.solve[0].ownedItems, ['b', 'a', 'b'], 'the duplicate is a second copy and is not deduplicated');
  assert.ok(Object.isFrozen(h.calls.solve[0].ownedItems));
  assert.notEqual(h.calls.solve[0].ownedItems, stash, 'a snapshot, not the caller array');
  assert.deepEqual(h.calls.solve[1].ownedItems, [], 'omitted means zero stock');
  assert.deepEqual(h.calls.solve[2].ownedItems, [], '[] means zero stock');
});

test('Explore forwards the validated multiset and the request guard to every step, whatever the step asks for; the floor gets them in its domain', async () => {
  const h = harness();
  h.receive(exploreMsg(1, { owned_items: ['x', 'x', 'y'] }));
  h.receive(floorMsg(2, { owned_items: ['x', 'x', 'y'] }));
  await h.idle();
  for (const input of [h.calls.explore[0], h.calls.floor[0]]) {
    assert.deepEqual(input.ownedItems, ['x', 'x', 'y']);
    assert.deepEqual(input.request.owned_items, ['x', 'x', 'y']);
    assert.deepEqual(input.baseParams.ownedItems, ['x', 'x', 'y']);
    assert.ok(Object.isFrozen(input.ownedItems));
  }
  const explore = h.calls.explore[0];
  const before = h.calls.solve.length;
  await explore.optimize({ ...explore.baseParams, ownedItems: ['smuggled'] }, explore.guard);
  const step = h.calls.solve[before];
  assert.deepEqual(step.ownedItems, ['x', 'x', 'y'], 'a driver cannot swap the stash of a step');
  assert.equal(step.guard, explore.guard);
});

test('the full acquisition and feasibility domain reaches every operation base, and a floor base is Precise with no objective weights of its own', async () => {
  const domain: Partial<OptimizeRequest> = {
    max_price: 123456, min_ergonomics: 30, max_recoil_v: 70, max_recoil_sum: -0.1, min_mag_capacity: 20, min_sighting_range: 100, max_weight: 4.5,
    include_items: ['a'], exclude_items: ['b'], include_categories: [['c1']], exclude_categories: ['c2'], prevent_overswing: true, use_true_ergo: true,
    equip_ergo_modifier: -0.1, trader_levels: { Prapor: 2, skier: 3 } as unknown as OptimizeRequest['trader_levels'], flea_available: false, barter_available: true,
    barter_exclude_dogtags: true, player_level: 22, bounds_mode: 'naive',
  };
  const h = harness();
  h.receive(optimizeMsg(1, { ...domain, precise_mode: 'auto' }));
  h.receive(exploreMsg(2, { ...domain, precise_mode: 'auto' }));
  h.receive(floorMsg(3, domain));
  await h.idle();
  const expected = {
    maxPrice: 123456, minErgonomics: 30, maxRecoilV: 70, maxRecoilSum: -0.1, minMagCapacity: 20, minSightingRange: 100, maxWeight: 4.5,
    includeItems: ['a'], excludeItems: ['b'], includeCategories: [['c1']], excludeCategories: ['c2'], preventOverswing: true, useTrueErgo: true,
    equipErgoModifier: -0.1, fleaAvailable: false, barterAvailable: true, barterExcludeDogtags: true, playerLevel: 22, boundsMode: 'naive',
  };
  for (const params of [h.calls.solve[0], h.calls.explore[0].baseParams, h.calls.floor[0].baseParams]) {
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k => [k, (params as unknown as Record<string, unknown>)[k]])), expected);
    assert.deepEqual(params.traderLevels, { prapor: 2, skier: 3 }, 'trader names are canonicalized once at the boundary');
  }
  const floorBase = h.calls.floor[0].baseParams;
  assert.equal(floorBase.preciseMode, true);
  assert.equal(floorBase.precisionRequest, 'precise');
  assert.equal(floorBase.maxMOA, undefined, 'the searched cap is the driver business');
  assert.equal(floorBase.ergoWeight, undefined);
  assert.equal(h.calls.explore[0].precisionRequest, 'auto');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Metadata operations
// ---------------------------------------------------------------------------------------------------------------------------

test('metadata operations take no stash and no deadline, even long after any request budget', async () => {
  const h = harness();
  h.clock.t = T0 + 10_000_000;
  h.receive(simple('loadData', 1));
  h.receive(simple('getInfo', 2));
  h.receive(simple('getWeaponMods', 3, { weaponId: WEAPON }));
  h.receive(simple('getWeaponMods', 4, { weaponId: WEAPON, withCompat: true }));
  h.receive(simple('getGunsmithTasks', 5));
  h.receive(simple('getStatus', 6));
  h.receive(simple('clearCache', 7));
  await h.idle();
  assert.equal(h.posted.find(m => m.id === 1)?.type, 'dataLoaded');
  const info = h.resultOf(2) as { guns: { id: string; base_moa: number; name: string }[] };
  assert.equal(info.guns[0].name, 'Test Gun');
  assert.equal(info.guns[0].base_moa, 0.5 * (1000000 / 29089), 'the physical MOA constant K = 1000000 / 29089');
  const mods = h.resultOf(3) as { mods: { id: string }[]; conflicts?: unknown };
  assert.deepEqual(mods.mods.map(m => m.id).sort(), ['a', 'b']);
  assert.equal(mods.conflicts, undefined);
  assert.ok((h.resultOf(4) as { conflicts?: unknown }).conflicts !== undefined);
  const tasks = h.resultOf(5) as { tasks: { task_name: string; required_item_names: string[] }[] };
  assert.equal(tasks.tasks[0].task_name, 'Task');
  const status = h.resultOf(6) as { timestamp: number; capabilities: unknown };
  assert.equal(typeof status.timestamp, 'number');
  assert.deepEqual(h.resultOf(7), { cleared: true });
  assert.equal(h.calls.solve.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The endpoint cache
// ---------------------------------------------------------------------------------------------------------------------------

const tcheb = (extra: Partial<OptimizeRequest> = {}): Partial<OptimizeRequest> => ({ use_tchebycheff: true, precise_mode: 'precise', ...extra });

/** A harness whose solve reports a payoff table when it was not given one, and records what it was given. */
function cachingHarness(endpoints: EndpointRecord[] = certifiedEndpoints()): Harness {
  const h = harness();
  h.setSolve(async () => {
    const params = h.calls.solve[h.calls.solve.length - 1];
    return { response: cannedResponse({ ...(params.idealPoint ? { ideal_point: params.idealPoint } : {}) }), payoff: params.idealPoint ? null : payoffOf(endpoints) };
  });
  return h;
}

const endpointCacheOf = async (h: Harness, id: number, message: WorkerInMessage): Promise<'hit' | 'miss' | undefined> => {
  h.receive(message);
  await h.idle();
  return (h.resultOf(id) as OptimizeResponse).endpoint_cache;
};

test('a qualified Precise table is cached: the second request is a hit that supplies the table, and it is invariant to preference weights, request id and deadline', async () => {
  const h = cachingHarness();
  assert.equal(await endpointCacheOf(h, 1, optimizeMsg(1, tcheb({ ergo_weight: 1, recoil_weight: 1, price_weight: 0 }))), 'miss');
  assert.equal(h.calls.solve[0].idealPoint, undefined);
  assert.equal(await endpointCacheOf(h, 2, optimizeMsg(2, tcheb({ ergo_weight: 0.2, recoil_weight: 3, price_weight: 9 }), T0 + 12_345)), 'hit');
  assert.deepEqual(h.calls.solve[1].idealPoint, payoffOf().idealPoint);
  assert.equal(await endpointCacheOf(h, 3, optimizeMsg(3, tcheb(), T0 + 999_999)), 'hit');
  // A weighted request has no Sweet Spot: no cache field at all.
  assert.equal(await endpointCacheOf(h, 4, optimizeMsg(4, {})), undefined);
});

test('a changed acquisition domain is not a cache hit: the stash multiset, the market, a constraint and the resolved duration', async () => {
  const h = cachingHarness();
  let id = 0;
  const run = async (extra: Partial<OptimizeRequest>) => endpointCacheOf(h, ++id, optimizeMsg(id, tcheb(extra)));
  assert.equal(await run({ owned_items: ['a', 'b'] }), 'miss');
  assert.equal(await run({ owned_items: ['b', 'a'] }), 'hit', 'the same multiset in another order');
  assert.equal(await run({ owned_items: ['a', 'a', 'b'] }), 'miss', 'a second copy is more stock');
  assert.equal(await run({ owned_items: ['a'] }), 'miss');
  assert.equal(await run({}), 'miss', 'no stock');
  assert.equal(await run({ owned_items: [] }), 'hit', 'omitted and [] are the same zero stock');
  assert.equal(await run({ flea_available: false }), 'miss');
  assert.equal(await run({ max_price: 1000 }), 'miss');
  assert.equal(await run({ time_limit_ms: 30_000 }), 'miss', 'the resolved duration is part of the controls');
});

test('only a qualified Precise MOA-independent certified table is ever stored', async () => {
  // A Fast request, a provisional-MOA request, and a table with one endpoint that is not certified: each stays a miss on repeat.
  const notCertified = certifiedEndpoints();
  notCertified[1] = { ...notCertified[1], status: 'feasible', physical_certificate: 'feasible' };
  const cases: { name: string; h: Harness; extra: Partial<OptimizeRequest> }[] = [
    { name: 'Fast', h: cachingHarness(certifiedEndpoints().map(e => ({ ...e, precision_resolved: 'fast', model_qualification: 'approximate', physical_certificate: 'approximate_optimal' } satisfies EndpointRecord))), extra: { precise_mode: 'fast' } },
    { name: 'provisional MOA', h: cachingHarness(certifiedEndpoints().map(e => ({ ...e, moa_qualification: 'provisional_model', physical_certificate: 'approximate_optimal' } satisfies EndpointRecord))), extra: { max_moa: 5 } },
    { name: 'an endpoint that is only feasible', h: cachingHarness(notCertified), extra: {} },
  ];
  for (const c of cases) {
    assert.equal(await endpointCacheOf(c.h, 1, optimizeMsg(1, tcheb(c.extra))), 'miss', c.name);
    assert.equal(await endpointCacheOf(c.h, 2, optimizeMsg(2, tcheb(c.extra))), 'miss', `${c.name}: not stored, so a repeat still computes its own table`);
    assert.equal(c.h.calls.solve[1].idealPoint, undefined, c.name);
  }
  // A Fast request is never even offered a cached Precise table, and a Precise table is not stored by a MOA-dependent request.
  const h = cachingHarness();
  assert.equal(await endpointCacheOf(h, 1, optimizeMsg(1, tcheb())), 'miss');
  assert.equal(await endpointCacheOf(h, 2, optimizeMsg(2, tcheb({ precise_mode: 'fast' }))), 'miss');
  assert.equal(await endpointCacheOf(h, 3, optimizeMsg(3, tcheb({ max_moa: 5 }))), 'miss');
  assert.equal(h.calls.solve[1].idealPoint, undefined);
  assert.equal(h.calls.solve[2].idealPoint, undefined);
});

test('a reload, a replacement and clearCache each invalidate the endpoint table and the physical state, even though language and game mode are the same', async () => {
  const h = cachingHarness();
  assert.equal(await endpointCacheOf(h, 1, optimizeMsg(1, tcheb())), 'miss');
  assert.equal(await endpointCacheOf(h, 2, optimizeMsg(2, tcheb())), 'hit');
  const lookupBefore = h.calls.solve[1].itemLookup;
  const compatBefore = h.calls.solve[1].compatibilityMap;

  h.setState(makeState(2)); // a reload (or seedDataCache): a different state under the same names
  assert.equal(await endpointCacheOf(h, 3, optimizeMsg(3, tcheb())), 'miss');
  assert.notEqual(h.calls.solve[2].itemLookup, lookupBefore, 'solved on the new lookup');
  assert.notEqual(h.calls.solve[2].compatibilityMap, compatBefore, 'the compatibility map was rebuilt for it');
  assert.equal(await endpointCacheOf(h, 4, optimizeMsg(4, tcheb())), 'hit', 'and the new table is cached for the new data');

  h.receive(simple('clearCache', 5));
  await h.idle();
  assert.equal(h.calls.clearLoaded, 1, 'the loaded states were dropped so the next load rebuilds the lookup');
  assert.equal(await endpointCacheOf(h, 6, optimizeMsg(6, tcheb())), 'miss');
  assert.notEqual(h.calls.solve[4].itemLookup, h.calls.solve[3].itemLookup);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Typed failures
// ---------------------------------------------------------------------------------------------------------------------------

test('a native failure is a typed SolverError envelope with the completion metadata captured before it; the worker keeps serving', async () => {
  const h = harness();
  const completion = { nodes: 2, termination: 'limit' as const, witness: true, lower_bound: 4, upper_bound: null, absolute_gap: null };
  h.setSolve(async () => {
    if (h.calls.solve.length === 1) throw attachCompletion(new NativeSolverError('solve', new Error('wasm trap')), completion);
    return { response: cannedResponse(), payoff: null };
  });
  h.receive(optimizeMsg(1));
  h.receive(optimizeMsg(2));
  await h.idle();
  const payload = h.errorOf(1);
  assert.ok(typeof payload === 'object' && payload.kind === 'SolverError');
  if (typeof payload !== 'object' || payload.kind !== 'SolverError') return;
  assert.equal(payload.phase, 'solve');
  assert.equal(payload.corrupted, true);
  assert.deepEqual(payload.completion, completion);
  assert.equal(h.posted.filter(m => m.id === 1 && m.type === 'result').length, 0, 'never a normal result');
  const revived = reviveWorkerError(structuredClone(payload));
  assert.ok(revived instanceof SolverError);
  assert.ok(revived instanceof NativeSolverError);
  assert.equal(revived.name, 'SolverError');
  assert.equal(revived.message, 'HiGHS native call failed during solve: Error: wasm trap');
  assert.deepEqual(revived.completion, completion);
  assert.equal((h.resultOf(2) as OptimizeResponse).status, 'optimal');
});

test('any other failure is a generic error envelope, and an unknown message type is an error too', async () => {
  const h = harness();
  h.setSolve(async () => { throw new RangeError('bad'); });
  h.receive(optimizeMsg(1));
  h.receive({ type: 'nope' as WorkerOperation, id: 2, payload: {} });
  await h.idle();
  assert.deepEqual(h.errorOf(1), { kind: 'error', name: 'RangeError', message: 'bad' });
  assert.equal(h.posted.find(m => m.id === 2)?.payload, 'Unknown message type: nope');
  const revived = reviveWorkerError(h.errorOf(1));
  assert.equal(revived.name, 'RangeError');
  assert.equal(reviveWorkerError('legacy text').message, 'legacy text');
});
