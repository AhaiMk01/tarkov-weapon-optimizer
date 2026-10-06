// `allow_repeated_parts` (owner decision 2c) through the worker runtime: Fast uses one copy of each part by default and the option restores repeats.
// The request reaches the Optimize solve (and so its Tchebycheff payoff endpoints), every step of an Explore sweep and, as a field of the request, nothing of
// the MOA floor (always Precise); Precise ignores it. The cache keys: the endpoint (payoff) key never sees it, the full-solve key does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreRequest, ExploreResponse, MOAFloorRequest, OptimizeRequest, OptimizeResponse } from '../../src/api/client';
import type { LoadedState } from '../../src/solver/dataService';
import { paramsOfTarget } from '../../src/solver/exploreSweep';
import { buildSweepSchedule, exploreRunRequest } from '../../src/solver/paretoExplorer';
import type { ParetoParams } from '../../src/solver/paretoExplorer';
import { computeExactSolveCacheKey, computeIdealPointCacheKey } from '../../src/solver/reuseKey';
import { solveRequest } from '../../src/solver/solver';
import type { SolveReport } from '../../src/solver/solver';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import type { WorkerInMessage, WorkerOutMessage } from '../../src/solver/workerProtocol';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { FloorRunInput, WorkerDeps } from '../../src/solver/workerRuntime';
import { floorEnvelope } from '../../src/solver/operationEnvelopes';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

/** Two slots that both take `a` (ergonomics 10) or `b` (ergonomics 4): two copies of `a` are best (20), one copy of each (14) is best with one copy per part. */
const lookup = (): ItemLookup => lookupOf(
  gun(WEAPON, { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] }),
  ['a', mod('a', { ergo: 10 })],
  ['b', mod('b', { ergo: 4 })],
);

const stateOf = (): LoadedState => ({
  guns: [{ id: WEAPON, name: 'Test Gun', properties: { caliber: 'Caliber556x45NATO', centerOfImpact: 0.5, defaultPreset: {} }, bsgCategory: { name: 'Assault rifle' } }],
  mods: [],
  itemLookup: lookup(),
  loadedAt: 0,
  generation: 1,
});

interface Session {
  seen: SolveParams[];
  floors: FloorRunInput[];
  run<T>(message: WorkerInMessage): Promise<T>;
}

/** A runtime on the real solver: every solve it makes is recorded. */
function session(overrides: Partial<WorkerDeps> = {}): Session {
  const posted: WorkerOutMessage[] = [];
  const seen: SolveParams[] = [];
  const floors: FloorRunInput[] = [];
  const state = stateOf();
  const runtime = createWorkerRuntime({
    post: m => { posted.push(m); },
    loadData: async () => state,
    solve: async (params): Promise<SolveReport> => { seen.push(params); return solveRequest(params); },
    runMoaFloor: async input => { floors.push(input); return { ...floorEnvelope('cancelled'), status: 'model_witnessed', floor: 1.5 }; },
    ...overrides,
  });
  let next = 1;
  return {
    seen,
    floors,
    async run<T>(message: WorkerInMessage): Promise<T> {
      const id = next++;
      runtime.receive({ ...message, id } as WorkerInMessage);
      await runtime.idle();
      const terminal = posted.filter(p => p.id === id && p.type !== 'snapshot');
      assert.equal(terminal.length, 1, `one terminal message, got ${terminal.map(t => t.type).join(',')}`);
      assert.notEqual(terminal[0].type, 'error', JSON.stringify(terminal[0].payload));
      return terminal[0].payload as T;
    },
  };
}

const optimizeMsg = (request: Partial<OptimizeRequest>): WorkerInMessage => ({
  type: 'optimize', id: 0, payload: { request: { weapon_id: WEAPON, ergo_weight: 1, recoil_weight: 0, price_weight: 0, ...request }, lang: 'en', gameMode: 'regular' },
});
const exploreMsg = (request: Partial<ExploreRequest>): WorkerInMessage => ({
  type: 'explore', id: 0, payload: { request: { weapon_id: WEAPON, ignore: 'price', steps: 10, ...request } as ExploreRequest, lang: 'en', gameMode: 'regular' },
});
const floorMsg = (request: Partial<MOAFloorRequest>): WorkerInMessage => ({
  type: 'computeMOAFloor', id: 0, payload: { request: { weapon_id: WEAPON, ...request }, lang: 'en', gameMode: 'regular' },
});

const sortedIds = (r: { selected_item_ids: string[] }): string[] => [...r.selected_item_ids].sort();

// ---------------------------------------------------------------------------------------------------------------------------
// Optimize
// ---------------------------------------------------------------------------------------------------------------------------

test('Optimize in Fast: one copy of each part by default, repeats with allow_repeated_parts, and the option reaches the solve', async () => {
  const s = session();
  const single = await s.run<OptimizeResponse>(optimizeMsg({ precise_mode: 'fast' }));
  assert.deepEqual(sortedIds(single), ['a', 'b']);
  assert.equal(single.single_copy, true);
  assert.equal(s.seen[0].allowRepeatedParts, false, 'an absent option is false');

  const explicitOff = await s.run<OptimizeResponse>(optimizeMsg({ precise_mode: 'fast', allow_repeated_parts: false }));
  assert.deepEqual(sortedIds(explicitOff), ['a', 'b']);
  assert.equal(s.seen[1].allowRepeatedParts, false);

  const wide = await s.run<OptimizeResponse>(optimizeMsg({ precise_mode: 'fast', allow_repeated_parts: true }));
  assert.deepEqual(sortedIds(wide), ['a', 'a']);
  assert.ok(!('single_copy' in wide));
  assert.equal(s.seen[2].allowRepeatedParts, true);
});

test('Optimize in Precise ignores the option: the same two-copy build and no single-copy note, whatever the request says', async () => {
  const s = session();
  for (const allow_repeated_parts of [undefined, false, true]) {
    const precise = await s.run<OptimizeResponse>(optimizeMsg({ precise_mode: 'precise', allow_repeated_parts }));
    assert.deepEqual(sortedIds(precise), ['a', 'a'], String(allow_repeated_parts));
    assert.equal(precise.precision_resolved, 'precise');
    assert.ok(!('single_copy' in precise));
  }
});

test('Auto resolves per weapon as before and the one-copy note follows the model that ran', async () => {
  const s = session();
  const auto = await s.run<OptimizeResponse>(optimizeMsg({ precise_mode: 'auto' }));
  // The tiny world resolves to Precise: repeats, no note.
  assert.equal(auto.precision_resolved, 'precise');
  assert.deepEqual(sortedIds(auto), ['a', 'a']);
  assert.ok(!('single_copy' in auto));
});

test('Optimize with Sweet Spot in Fast: the payoff endpoints run on the same model, so the ideal point follows the option', async () => {
  const s = session();
  const request = { precise_mode: 'fast', use_tchebycheff: true, ergo_weight: 34, recoil_weight: 33, price_weight: 33 } as const;
  const single = await s.run<OptimizeResponse>(optimizeMsg(request));
  const wide = await s.run<OptimizeResponse>(optimizeMsg({ ...request, allow_repeated_parts: true }));
  assert.ok(single.ideal_point && wide.ideal_point);
  assert.equal(wide.ideal_point.zE - single.ideal_point.zE, 60, 'fE = 10 x ergonomics: 14 with one copy of each part, 20 with repeats');
  assert.equal(single.endpoint_cache, 'miss');
  assert.equal(wide.endpoint_cache, 'miss', 'a Fast table is never cached');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Explore
// ---------------------------------------------------------------------------------------------------------------------------

test('Explore in Fast: every step is solved with the option, and the sweep says it ran one copy of each part', async () => {
  const s = session();
  const single = await s.run<ExploreResponse>(exploreMsg({ precise_mode: 'fast' }));
  assert.ok(s.seen.length >= 2, 'the endpoint targets and the steps are separate solves');
  assert.ok(s.seen.every(p => p.allowRepeatedParts === false && p.preciseMode === false), 'every step carries the default');
  assert.equal(single.precision_resolved, 'fast');
  assert.equal(single.single_copy, true);
  assert.ok(single.points.length > 0);
  assert.ok(single.points.every(p => p.selected_item_ids.filter(id => id === 'a').length <= 1), 'no point repeats a part');
  const bestSingle = Math.max(...single.points.map(p => p.selected_item_ids.filter(id => id === 'a').length * 10 + p.selected_item_ids.filter(id => id === 'b').length * 4));
  assert.equal(bestSingle, 14);

  const before = s.seen.length;
  const wide = await s.run<ExploreResponse>(exploreMsg({ precise_mode: 'fast', allow_repeated_parts: true }));
  const wideSteps = s.seen.slice(before);
  assert.ok(wideSteps.length >= 2 && wideSteps.every(p => p.allowRepeatedParts === true), 'every step carries the option');
  assert.ok(!('single_copy' in wide));
  assert.ok(wide.points.some(p => p.selected_item_ids.filter(id => id === 'a').length === 2), 'the repeats-allowed sweep reaches the two-copy build');
});

test('Explore in Precise: the option is carried but ignored, and the sweep makes no one-copy claim', async () => {
  const s = session();
  const precise = await s.run<ExploreResponse>(exploreMsg({ precise_mode: 'precise', allow_repeated_parts: false }));
  assert.equal(precise.precision_resolved, 'precise');
  assert.ok(!('single_copy' in precise));
  assert.ok(precise.points.some(p => p.selected_item_ids.filter(id => id === 'a').length === 2), 'Precise repeats a part regardless');
});

test('the Explore sweep builds its step parameters from the option: base, schedule targets and overrides', () => {
  const itemLookup = lookup();
  const base: ParetoParams = { weaponId: WEAPON, itemLookup, compatibilityMap: buildCompatibilityMap(WEAPON, itemLookup), ignore: 'price', steps: 10, preciseMode: false };
  const off = exploreRunRequest(base);
  assert.equal(off.base.allowRepeatedParts, undefined, 'an absent option stays absent: the Fast default (one copy) applies');
  const on = exploreRunRequest({ ...base, allowRepeatedParts: true });
  assert.equal(on.base.allowRepeatedParts, true);
  const schedule = buildSweepSchedule({ ...base, allowRepeatedParts: true });
  assert.ok(schedule.targets.length > 0);
  for (const target of schedule.targets) assert.equal(paramsOfTarget(on, target).allowRepeatedParts, true);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The MOA floor
// ---------------------------------------------------------------------------------------------------------------------------

test('the MOA floor domain never carries the option: it is always Precise and a request field is dropped', async () => {
  const s = session();
  await s.run(floorMsg({ ...({ allow_repeated_parts: true } as Partial<MOAFloorRequest>) }));
  assert.equal(s.floors.length, 1);
  assert.equal(s.floors[0].baseParams.allowRepeatedParts, undefined);
  assert.equal(s.floors[0].baseParams.preciseMode, true);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------------------------------------

test('cache keys: the endpoint (payoff) key ignores the option because only certified Precise tables are stored; the full-solve key includes it', () => {
  const request: OptimizeRequest = { weapon_id: WEAPON, precise_mode: 'auto', use_tchebycheff: true };
  const endpoint = computeIdealPointCacheKey('en', 'regular', request);
  assert.equal(computeIdealPointCacheKey('en', 'regular', { ...request, allow_repeated_parts: true }), endpoint, 'Precise ignores the option, so a table is the same table');
  assert.equal(computeIdealPointCacheKey('en', 'regular', { ...request, allow_repeated_parts: false }), endpoint);

  const solveOff = computeExactSolveCacheKey('en', 'regular', request);
  const solveExplicitOff = computeExactSolveCacheKey('en', 'regular', { ...request, allow_repeated_parts: false });
  const solveOn = computeExactSolveCacheKey('en', 'regular', { ...request, allow_repeated_parts: true });
  assert.equal(solveOff, solveExplicitOff, 'absent and false are the same question');
  assert.notEqual(solveOff, solveOn, 'a Fast full solve differs with the option');
});
