// The run lifecycle (src/runs/): what the UI holds and is told while an Optimize, Gunsmith, Explore or MOA floor request runs. Driven through its
// public interface with the API client, request controllers, toast, log and clock replaced by fakes, so a whole run (the floor settling first, the
// controller, the request, the answer or the failure, the toast) is observed without React or a worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ExploreRequest, ExploreResponse, MOAFloorRequest, MOAFloorResponse, OptimizationMetadata, OptimizeRequest, OptimizeResponse, RequestOptions,
} from '../../src/api/client';
import { createRunLifecycle, FLOOR_DEBOUNCE_MS } from '../../src/runs/runLifecycle';
import type { ExplorePlan, RunController, RunLifecycle, Toast } from '../../src/runs/runLifecycle';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { CancellationError, SolverError } from '../../src/solver/runtimeErrors';

// ---------------------------------------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------------------------------------

/** Lets every promise continuation already queued run. */
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** A request the test answers when it chooses, like the worker would. */
interface Call<Req, Res> {
  request: Req;
  options: RequestOptions;
  resolve(response: Res): void;
  reject(error: unknown): void;
}

function pendingCalls<Req, Res>(): { calls: Call<Req, Res>[]; send(request: Req, options: RequestOptions): Promise<Res> } {
  const calls: Call<Req, Res>[] = [];
  return {
    calls,
    send: (request, options) => new Promise<Res>((resolve, reject) => { calls.push({ request, options, resolve, reject }); }),
  };
}

/** The slot of one cancellable request, as `useRequestController` keeps it. */
function fakeController(): RunController & { begun: AbortController[]; ended: AbortController[]; cancels: number } {
  let current: AbortController | null = null;
  const self = {
    begun: [] as AbortController[],
    ended: [] as AbortController[],
    cancels: 0,
    begin(): AbortController {
      current?.abort();
      current = new AbortController();
      self.begun.push(current);
      return current;
    },
    end(controller: AbortController): void {
      self.ended.push(controller);
      if (current === controller) current = null;
    },
    cancel(): void {
      self.cancels++;
      current?.abort();
    },
  };
  return self;
}

function manualClock() {
  let next = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++next;
      timers.set(id, { fn, ms });
      return () => { timers.delete(id); };
    },
    pending: (): number[] => [...timers.values()].map(t => t.ms),
    fire: (): void => {
      const due = [...timers.values()];
      timers.clear();
      for (const t of due) t.fn();
    },
  };
}

function harness() {
  const optimizeApi = pendingCalls<OptimizeRequest, OptimizeResponse>();
  const exploreApi = pendingCalls<ExploreRequest, ExploreResponse>();
  const floorApi = pendingCalls<MOAFloorRequest, MOAFloorResponse>();
  const controllers = { optimize: fakeController(), explore: fakeController(), gunsmith: fakeController(), floor: fakeController() };
  const clock = manualClock();
  const toasts: Toast[] = [];
  const logs: { message: string; error: unknown }[] = [];
  const runs = createRunLifecycle({
    api: {
      optimize: async (request, _mode, _lang, options = {}) => optimizeApi.send(request, options),
      explore: async (request, _mode, _lang, options = {}) => exploreApi.send(request, options),
      computeMOAFloor: async (request, _mode, _lang, options = {}) => floorApi.send(request, options),
    },
    controllers,
    announce: toast => { toasts.push(toast); },
    logError: (message, error) => { logs.push({ message, error }); },
    setTimer: clock.setTimer,
  });
  return { runs, optimizeApi, exploreApi, floorApi, controllers, clock, toasts, logs };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------------

const OPT: OptimizationMetadata = { lower_bound: 1, upper_bound: 1, absolute_gap: 0, tolerance: 1e-5, nodes: 1, termination: 'optimal' };

const optimum = (over: Partial<OptimizeResponse> = {}): OptimizeResponse => ({
  status: 'optimal', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
  physical_certificate: 'certified_optimal', selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: 1, optimization: OPT,
  final_stats: { ergonomics: 50, recoil_vertical: 100, recoil_horizontal: 50, total_price: 5000, total_weight: 3, moa: 2 }, solve_time_ms: 5, ...over,
});

const CERTIFIED_BUILD_TOAST: Toast = { type: 'success', key: 'toast.optimize_success' };

const optimizeRequest = (weaponId: string): OptimizeRequest => ({ weapon_id: weaponId });

/** An Explore response with `points` verified witnesses (their coordinates are the plotted ones). */
const sweepOf = (curve: ExploreResponse['curve_status'], points: number, over: Partial<ExploreResponse> = {}): ExploreResponse => ({
  curve_status: curve,
  points: Array.from({ length: points }, (_, i) => ({ ...optimum(), ergo: 40 + i, recoil_pct: 0, recoil_v: 100, recoil_h: 50, price: 1000 + i })),
  sweep_schedule: [], step_outcomes: [], total_solve_time_ms: 1,
  precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, ...over,
});

const cancelledSweep = (points: number): ExploreResponse => sweepOf(points > 0 ? 'partial' : 'invalid', points, { reason: PUBLIC_REASONS.cancelledByUser });

const gunName = (id: string): string => `Gun ${id}`;

/** An Explore plan over `weaponIds` whose requests are recorded by the plan itself. */
function plan(weaponIds: string[], over: Partial<ExplorePlan> = {}): ExplorePlan {
  return { weaponIds, tradeoff: 'recoil', weaponName: gunName, requestOf: id => ({ weapon_id: id, ignore: 'recoil' }), gameMode: 'regular', lang: 'en', ...over };
}

const floorAnswer = (over: Partial<MOAFloorResponse> = {}): MOAFloorResponse => ({
  status: 'model_proved', moa_qualification: 'provisional_model', floor: 1.2, display_floor: 1.2, proved_lower_bound: 1.19, solve_time_ms: 10, ...over,
});

const floorRequest = (weaponId: string): MOAFloorRequest => ({ weapon_id: weaponId });

const phases = (runs: RunLifecycle): string[] => [runs.getState().optimize.phase, runs.getState().gunsmith.phase, runs.getState().explore.phase];

// ---------------------------------------------------------------------------------------------------------------------------
// Optimize
// ---------------------------------------------------------------------------------------------------------------------------

test('a successful Optimize runs, shows its result and says "complete" only for a proved optimum', async () => {
  const h = harness();
  const seen: string[] = [];
  h.runs.subscribe(() => seen.push(h.runs.getState().optimize.phase));
  const done = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  assert.equal(h.runs.getState().optimize.phase, 'running', 'busy from the first moment');
  await flush();

  assert.equal(h.optimizeApi.calls.length, 1);
  assert.deepEqual(h.optimizeApi.calls[0].request, optimizeRequest('ak'));
  assert.equal(h.optimizeApi.calls[0].options.signal, h.controllers.optimize.begun[0].signal, 'the request carries the signal of its controller');

  const answer = optimum();
  h.optimizeApi.calls[0].resolve(answer);
  await done;

  assert.deepEqual(h.runs.getState().optimize, { phase: 'done', result: answer, failure: null });
  assert.deepEqual(h.toasts, [CERTIFIED_BUILD_TOAST]);
  assert.deepEqual(h.controllers.optimize.ended, h.controllers.optimize.begun, 'the controller is released');
  assert.deepEqual(seen, ['running', 'done']);
  assert.deepEqual(phases(h.runs), ['done', 'idle', 'idle'], 'Gunsmith and Explore are untouched');
});

test('an approximate Optimize result is announced as what its headline says, never as complete', async () => {
  const h = harness();
  const done = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  h.optimizeApi.calls[0].resolve(optimum({ physical_certificate: 'approximate_optimal', model_qualification: 'approximate', precision_resolved: 'fast' }));
  await done;
  assert.equal(h.toasts.length, 1);
  assert.notEqual(h.toasts[0].key, 'toast.optimize_success');
});

test('a failed Optimize is classified, kept next to the previous result, logged and announced as an error', async () => {
  const h = harness();
  const first = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  const previous = optimum();
  h.optimizeApi.calls[0].resolve(previous);
  await first;
  h.toasts.length = 0;

  const second = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  assert.deepEqual(h.runs.getState().optimize, { phase: 'running', result: previous, failure: null }, 'the previous result stays while the next one runs');
  await flush();
  const nativeFailure = new SolverError('solve', new Error('wasm trap'), true, { nodes: 3, termination: 'limit', witness: false, lower_bound: null, upper_bound: null, absolute_gap: null });
  h.optimizeApi.calls[1].reject(nativeFailure);
  await second;

  const state = h.runs.getState().optimize;
  assert.equal(state.phase, 'failed');
  assert.equal(state.result, previous);
  assert.equal(state.failure?.kind, 'solver');
  assert.equal(state.failure?.kind === 'solver' ? state.failure.phase : null, 'solve');
  assert.deepEqual(h.toasts, [{ type: 'error', key: 'toast.optimize_failed' }]);
  assert.deepEqual(h.logs, [{ message: 'Optimization failed', error: nativeFailure }]);
  assert.equal(h.controllers.optimize.ended.length, 2, 'the controller is released after a failure too');

  const third = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  assert.equal(h.runs.getState().optimize.failure, null, 'a new request clears the failure');
  await flush();
  h.optimizeApi.calls[2].reject(new Error('boom'));
  await third;
  const unexpected = h.runs.getState().optimize.failure;
  assert.deepEqual(unexpected, { kind: 'unknown', message: 'boom' });
});

test('a cancelled Optimize is an info toast, not a failure, and keeps the previous result', async () => {
  const h = harness();
  const first = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  const previous = optimum();
  h.optimizeApi.calls[0].resolve(previous);
  await first;
  h.toasts.length = 0;

  const second = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  h.controllers.optimize.cancel();
  assert.equal(h.optimizeApi.calls[1].options.signal?.aborted, true);
  h.optimizeApi.calls[1].reject(new CancellationError('Cancelled by user', null));
  await second;

  assert.deepEqual(h.runs.getState().optimize, { phase: 'cancelled', result: previous, failure: null });
  assert.deepEqual(h.toasts, [{ type: 'info', key: 'toast.cancelled' }]);
  assert.deepEqual(h.logs, [], 'a cancel is not logged as an error');
});

test('a request waits for the MOA floor in flight: the floor is cancelled first and the request is sent only once it has settled', async () => {
  const h = harness();
  h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  h.clock.fire();
  await flush();
  assert.equal(h.floorApi.calls.length, 1);

  const done = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  assert.equal(h.controllers.floor.cancels, 1, 'the floor is cancelled');
  assert.equal(h.floorApi.calls[0].options.signal?.aborted, true);
  assert.equal(h.optimizeApi.calls.length, 0, 'the request is not sent while the floor is still settling');
  assert.equal(h.controllers.optimize.begun.length, 0);

  h.floorApi.calls[0].resolve(floorAnswer({ status: 'unresolved', floor: null, display_floor: null, proved_lower_bound: null, reason: PUBLIC_REASONS.cancelledByUser }));
  await flush();
  assert.equal(h.optimizeApi.calls.length, 1, 'now it is');
  h.optimizeApi.calls[0].resolve(optimum());
  await done;
});

test('the request is built where the sequence needs it: a request that cannot be built is a failure of the run, not an unhandled error', async () => {
  const h = harness();
  await h.runs.run('optimize', () => { throw new Error('no request'); }, 'regular', 'en');
  assert.deepEqual(h.runs.getState().optimize.failure, { kind: 'unknown', message: 'no request' });
  assert.equal(h.optimizeApi.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Gunsmith
// ---------------------------------------------------------------------------------------------------------------------------

test('Gunsmith is the same request with its own state, controller and wording', async () => {
  const h = harness();
  const done = h.runs.run('gunsmith', () => optimizeRequest('task-gun'), 'pve', 'ru');
  assert.deepEqual(phases(h.runs), ['idle', 'running', 'idle']);
  await flush();
  assert.equal(h.controllers.gunsmith.begun.length, 1);
  assert.equal(h.controllers.optimize.begun.length, 0, 'Optimize has its own controller');
  const answer = optimum();
  h.optimizeApi.calls[0].resolve(answer);
  await done;

  assert.deepEqual(h.runs.getState().gunsmith, { phase: 'done', result: answer, failure: null });
  assert.equal(h.runs.getState().optimize.result, null);
  assert.deepEqual(h.toasts, [{ type: 'success', key: 'toast.gunsmith_success' }]);

  const failing = h.runs.run('gunsmith', () => optimizeRequest('task-gun'), 'pve', 'ru');
  await flush();
  const error = new Error('lost worker');
  h.optimizeApi.calls[1].reject(error);
  await failing;
  assert.equal(h.runs.getState().gunsmith.phase, 'failed');
  assert.deepEqual(h.runs.getState().gunsmith.failure, { kind: 'unknown', message: 'lost worker' });
  assert.equal(h.runs.getState().gunsmith.result, answer);
  assert.deepEqual(h.toasts[1], { type: 'error', key: 'toast.gunsmith_failed' });
  assert.deepEqual(h.logs, [{ message: 'Gunsmith optimization failed', error }]);
  assert.equal(h.runs.getState().optimize.phase, 'idle');
});

test('a cancelled Gunsmith request is an info toast', async () => {
  const h = harness();
  const done = h.runs.run('gunsmith', () => optimizeRequest('task-gun'), 'regular', 'en');
  await flush();
  h.controllers.gunsmith.cancel();
  h.optimizeApi.calls[0].reject(new CancellationError());
  await done;
  assert.equal(h.runs.getState().gunsmith.phase, 'cancelled');
  assert.deepEqual(h.toasts, [{ type: 'info', key: 'toast.cancelled' }]);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Explore
// ---------------------------------------------------------------------------------------------------------------------------

test('an Explore over several weapons runs them in order, shows live progress, and announces "complete" only when every sweep is', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a', 'b', 'a']));
  assert.deepEqual(h.runs.getState().explore, { phase: 'running', weaponIds: ['a', 'b'], tradeoff: 'recoil', runs: [] }, 'repeats are dropped; the latest request is recorded at once');
  await flush();

  assert.deepEqual(h.exploreApi.calls.map(c => c.request.weapon_id), ['a'], 'one weapon at a time');
  assert.deepEqual(h.runs.getState().explore.runs.map(r => [r.weaponId, r.weaponName, r.phase, r.response]), [['a', 'Gun a', 'running', null]]);

  const live = sweepOf('partial', 1);
  h.exploreApi.calls[0].options.onSnapshot?.({ launched: 2, scheduled: 5, response: live });
  assert.deepEqual(
    [h.runs.getState().explore.runs[0].response, h.runs.getState().explore.runs[0].launched, h.runs.getState().explore.runs[0].scheduled],
    [live, 2, 5], 'a verified snapshot patches the weapon being swept',
  );
  h.exploreApi.calls[0].options.onSnapshot?.({ not: 'a snapshot' });
  assert.equal(h.runs.getState().explore.runs[0].response, live, 'anything else is ignored');

  const a = sweepOf('complete', 3);
  h.exploreApi.calls[0].resolve(a);
  await flush();
  assert.deepEqual(
    [h.runs.getState().explore.runs[0].phase, h.runs.getState().explore.runs[0].response, h.runs.getState().explore.runs[0].launched],
    ['done', a, undefined], 'progress is dropped when the sweep is done',
  );
  assert.deepEqual(h.exploreApi.calls.map(c => c.request.weapon_id), ['a', 'b']);
  assert.equal(h.runs.getState().explore.phase, 'running');

  h.exploreApi.calls[1].resolve(sweepOf('complete', 2));
  await done;
  assert.equal(h.runs.getState().explore.phase, 'settled');
  assert.deepEqual(h.toasts, [{ type: 'success', key: 'toast.explore_success', params: {} }]);
  assert.deepEqual(h.controllers.explore.ended, h.controllers.explore.begun);
});

test('cancelling while a weapon is being swept keeps its points, marks it cancelled and does not start the weapons after it', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a', 'b', 'c']));
  await flush();
  h.controllers.explore.cancel();
  assert.equal(h.exploreApi.calls[0].options.signal?.aborted, true, 'the cancel reaches the request through its signal');

  const kept = cancelledSweep(2);
  h.exploreApi.calls[0].resolve(kept);
  await done;

  const state = h.runs.getState().explore;
  assert.deepEqual(state.runs.map(r => [r.weaponId, r.phase]), [['a', 'cancelled']], 'b and c never started');
  assert.equal(state.runs[0].response, kept);
  assert.equal(state.phase, 'settled');
  assert.equal(h.exploreApi.calls.length, 1);
  assert.deepEqual(h.toasts, [{ type: 'info', key: 'toast.explore_cancelled', params: { count: 2 } }]);
});

test('a hard-terminated Explore keeps the retained snapshot it was rejected with', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a', 'b']));
  await flush();
  const retained = sweepOf('partial', 3);
  h.controllers.explore.cancel();
  h.exploreApi.calls[0].reject(new CancellationError('Cancelled by user', { launched: 3, scheduled: 6, response: retained }));
  await done;

  const state = h.runs.getState().explore;
  assert.deepEqual(state.runs.map(r => [r.weaponId, r.phase]), [['a', 'cancelled']]);
  assert.equal(state.runs[0].response, retained);
  assert.deepEqual(h.toasts, [{ type: 'info', key: 'toast.explore_cancelled', params: { count: 3 } }]);
  assert.deepEqual(h.logs, [], 'a cancel is not an error');
});

test('a hard termination without a snapshot keeps the last live one', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a']));
  await flush();
  const live = sweepOf('partial', 1);
  h.exploreApi.calls[0].options.onSnapshot?.({ launched: 1, scheduled: 4, response: live });
  h.controllers.explore.cancel();
  h.exploreApi.calls[0].reject(new CancellationError('Cancelled by user', null));
  await done;
  assert.equal(h.runs.getState().explore.runs[0].response, live);
  assert.equal(h.runs.getState().explore.runs[0].phase, 'cancelled');
});

test('cancelling between two weapons stops the loop before the next one starts', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a', 'b']));
  await flush();
  // The sweep of `a` finishes in the same instant the cancel lands: the answer is complete, the controller is aborted.
  h.controllers.explore.cancel();
  const finished = sweepOf('complete', 2);
  h.exploreApi.calls[0].resolve(finished);
  await done;

  const state = h.runs.getState().explore;
  assert.deepEqual(state.runs.map(r => [r.weaponId, r.phase]), [['a', 'done']], 'a finished sweep is not rewritten as cancelled');
  assert.equal(h.exploreApi.calls.length, 1, 'b was never asked');
  assert.equal(state.phase, 'settled');
  assert.equal(h.toasts.length, 1, 'one toast for the whole request');
});

test('a later weapon that fails keeps its retained snapshot, and the weapons before it keep theirs', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a', 'b']));
  await flush();
  const first = sweepOf('complete', 2);
  h.exploreApi.calls[0].resolve(first);
  await flush();

  const live = sweepOf('partial', 1);
  h.exploreApi.calls[1].options.onSnapshot?.({ launched: 1, scheduled: 3, response: live });
  const nativeFailure = new SolverError('solve', new Error('out of memory'));
  h.exploreApi.calls[1].reject(nativeFailure);
  await done;

  const runs = h.runs.getState().explore.runs;
  assert.deepEqual(runs.map(r => [r.weaponId, r.phase]), [['a', 'done'], ['b', 'failed']]);
  assert.equal(runs[0].response, first);
  assert.equal(runs[1].response, live, 'the points published before the failure are kept');
  assert.equal(runs[1].error, nativeFailure.message);
  assert.deepEqual(h.logs, [{ message: 'Exploration failed for b', error: nativeFailure }]);
  assert.deepEqual(h.toasts, [{ type: 'warning', key: 'toast.explore_compare_partial', params: { failed: 1, total: 2 } }]);
});

test('when every weapon fails the toast is an error and no response is invented', async () => {
  const h = harness();
  const done = h.runs.explore(plan(['a']));
  await flush();
  h.exploreApi.calls[0].reject(new Error('worker lost'));
  await done;
  const run = h.runs.getState().explore.runs[0];
  assert.deepEqual([run.phase, run.response, run.error], ['failed', null, 'worker lost']);
  assert.deepEqual(h.toasts, [{ type: 'error', key: 'toast.explore_failed', params: {} }]);
});

test('an Explore waits for the floor like any request, and a newer Explore supersedes one still waiting', async () => {
  const h = harness();
  h.runs.watchFloor(floorRequest('a'), 'regular', 'en');
  h.clock.fire();
  await flush();

  const stale = h.runs.explore(plan(['a']));
  const fresh = h.runs.explore(plan(['b'], { tradeoff: 'ergo' }));
  await flush();
  assert.equal(h.exploreApi.calls.length, 0, 'nothing is sent while the floor settles');
  h.floorApi.calls[0].resolve(floorAnswer());
  await flush();

  assert.deepEqual(h.exploreApi.calls.map(c => c.request.weapon_id), ['b'], 'only the newest request runs');
  assert.deepEqual(h.runs.getState().explore.weaponIds, ['b']);
  assert.equal(h.runs.getState().explore.tradeoff, 'ergo');
  h.exploreApi.calls[0].resolve(sweepOf('complete', 1));
  await Promise.all([stale, fresh]);
  assert.equal(h.toasts.length, 1, 'the superseded request announces nothing');
  assert.equal(h.controllers.explore.begun.length, 1);
});

test('an Explore with no weapon does nothing', async () => {
  const h = harness();
  await h.runs.explore(plan([]));
  assert.deepEqual(h.runs.getState().explore, { phase: 'idle', weaponIds: [], tradeoff: 'price', runs: [] });
  assert.deepEqual(h.toasts, []);
  assert.equal(h.controllers.floor.cancels, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The MOA floor
// ---------------------------------------------------------------------------------------------------------------------------

test('the floor is asked after a pause, about the request it was given, and its answer is shown', async () => {
  const h = harness();
  h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  assert.deepEqual(h.runs.getState().floor, { computing: true, view: null, error: null });
  assert.deepEqual(h.clock.pending(), [FLOOR_DEBOUNCE_MS]);
  assert.equal(h.floorApi.calls.length, 0, 'nothing is asked during the pause');

  h.clock.fire();
  await flush();
  assert.deepEqual(h.floorApi.calls.map(c => c.request), [floorRequest('ak')]);
  assert.equal(h.runs.getState().floor.computing, true);

  h.floorApi.calls[0].resolve(floorAnswer());
  await flush();
  const floor = h.runs.getState().floor;
  assert.equal(floor.computing, false);
  assert.equal(floor.error, null);
  assert.deepEqual([floor.view?.kind, floor.view?.display, floor.view?.sliderMin], ['proved', '1.20', 1.2]);
  assert.deepEqual(h.controllers.floor.ended, h.controllers.floor.begun);
});

test('a change of the question inside the pause never reaches the API', async () => {
  const h = harness();
  const stop = h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  stop();
  assert.deepEqual(h.clock.pending(), []);
  h.runs.watchFloor(floorRequest('m4'), 'regular', 'en');
  h.clock.fire();
  await flush();
  assert.deepEqual(h.floorApi.calls.map(c => c.request.weapon_id), ['m4']);
});

test('a floor answer that arrives after a newer question was asked is ignored', async () => {
  const h = harness();
  const stopA = h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  h.clock.fire();
  await flush();
  stopA();
  assert.equal(h.floorApi.calls[0].options.signal?.aborted, true, 'the question in flight is aborted');

  h.runs.watchFloor(floorRequest('m4'), 'regular', 'en');
  // The aborted request still answers, late, with a complete-looking result.
  h.floorApi.calls[0].resolve(floorAnswer({ floor: 9, display_floor: 9 }));
  await flush();
  assert.deepEqual(h.runs.getState().floor, { computing: true, view: null, error: null }, 'the old answer shows nothing and does not stop the spinner');

  h.clock.fire();
  await flush();
  h.floorApi.calls[1].resolve(floorAnswer({ floor: 1.5, display_floor: 1.5 }));
  await flush();
  assert.deepEqual([h.runs.getState().floor.view?.display, h.runs.getState().floor.computing], ['1.50', false]);
});

test('a floor failure that arrives after a newer question was asked is ignored, but still released and logged', async () => {
  const h = harness();
  const stopA = h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  h.clock.fire();
  await flush();
  stopA();
  h.runs.watchFloor(floorRequest('m4'), 'regular', 'en');
  const failure = new SolverError('solve', new Error('wasm trap'));
  h.floorApi.calls[0].reject(failure);
  await flush();
  assert.deepEqual(h.runs.getState().floor, { computing: true, view: null, error: null });
  assert.deepEqual(h.logs, [{ message: 'Failed to compute MOA floor', error: failure }]);
  assert.equal(h.controllers.floor.ended.length, 1);
});

test('a failed floor shows its message, and what it had established is shown as an interrupted result', async () => {
  const h = harness();
  h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  h.clock.fire();
  await flush();
  const failure = new SolverError('solve', new Error('wasm trap'), true, {
    nodes: 4, termination: 'limit', witness: true, lower_bound: null, upper_bound: null, absolute_gap: null,
    floor: floorAnswer({ status: 'model_witnessed', proved_lower_bound: null }),
  });
  h.floorApi.calls[0].reject(failure);
  await flush();

  const floor = h.runs.getState().floor;
  assert.equal(floor.computing, false);
  assert.equal(floor.error, failure.message);
  assert.equal(floor.view?.kind, 'witnessed');
  assert.equal(floor.view?.interrupted, true);
  assert.equal(floor.view?.sliderMin, null, 'an interrupted floor does not narrow the MOA control');
  assert.deepEqual(h.logs, [{ message: 'Failed to compute MOA floor', error: failure }]);
});

test('a cancelled floor shows what it retained, with no error message and no log', async () => {
  const h = harness();
  h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  h.clock.fire();
  await flush();
  h.floorApi.calls[0].reject(new CancellationError('Cancelled by user', floorAnswer({ status: 'model_witnessed', proved_lower_bound: null })));
  await flush();
  const floor = h.runs.getState().floor;
  assert.deepEqual([floor.computing, floor.error, floor.view?.kind, floor.view?.interrupted], [false, null, 'witnessed', true]);
  assert.deepEqual(h.logs, []);
});

test('a floor that is not wanted is cleared and never asked', async () => {
  const h = harness();
  h.runs.watchFloor(floorRequest('ak'), 'regular', 'en');
  h.clock.fire();
  await flush();
  h.floorApi.calls[0].resolve(floorAnswer());
  await flush();
  assert.equal(h.runs.getState().floor.view?.kind, 'proved');

  const stop = h.runs.watchFloor(null, 'regular', 'en');
  assert.deepEqual(h.runs.getState().floor, { computing: false, view: null, error: null });
  assert.deepEqual(h.clock.pending(), []);
  stop();
  assert.equal(h.floorApi.calls.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Clearing and subscribing
// ---------------------------------------------------------------------------------------------------------------------------

test('reloading the data clears both single results and failures; a request in flight keeps running', async () => {
  const h = harness();
  const shown = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  h.optimizeApi.calls[0].resolve(optimum());
  await shown;
  const failing = h.runs.run('gunsmith', () => optimizeRequest('task-gun'), 'regular', 'en');
  await flush();
  h.optimizeApi.calls[1].reject(new Error('boom'));
  await failing;
  assert.equal(h.runs.getState().gunsmith.phase, 'failed');

  const running = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  h.runs.clearResults();
  assert.deepEqual(h.runs.getState().optimize, { phase: 'running', result: null, failure: null });
  assert.deepEqual(h.runs.getState().gunsmith, { phase: 'idle', result: null, failure: null });
  await flush();
  h.optimizeApi.calls[2].resolve(optimum());
  await running;
  assert.equal(h.runs.getState().optimize.phase, 'done');
});

test('changing the Optimize weapon drops its result but leaves a failure on screen', async () => {
  const h = harness();
  const shown = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  h.optimizeApi.calls[0].resolve(optimum());
  await shown;
  h.runs.clearOptimizeResult();
  assert.deepEqual(h.runs.getState().optimize, { phase: 'idle', result: null, failure: null });

  const failing = h.runs.run('optimize', () => optimizeRequest('ak'), 'regular', 'en');
  await flush();
  h.optimizeApi.calls[1].reject(new Error('boom'));
  await failing;
  h.runs.clearOptimizeResult();
  assert.equal(h.runs.getState().optimize.phase, 'failed');
  assert.deepEqual(h.runs.getState().optimize.failure, { kind: 'unknown', message: 'boom' });
});

test('subscribers are told of every change until they unsubscribe, and the state is the same object between changes', async () => {
  const h = harness();
  let calls = 0;
  const unsubscribe = h.runs.subscribe(() => { calls++; });
  const before = h.runs.getState();
  assert.equal(h.runs.getState(), before);
  h.runs.clearResults();
  assert.equal(calls, 2);
  assert.notEqual(h.runs.getState(), before);
  unsubscribe();
  h.runs.clearResults();
  assert.equal(calls, 2);
});
