// The per-step snapshot hook of `runExplore` (Phase 2.8, ADR 0013 section 4D): the verified partial result after every launched target, what it
// contains (points so far, per-target coverage with unlaunched targets as U without a reason), that the last snapshot of a finished sweep is the
// final response, that an observer that throws or is absent changes nothing, and that nothing is published for an invalid schedule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, ExploreSnapshot, OptimizationMetadata, OptimizeResponse } from '../../src/api/client';
import { runExplore } from '../../src/solver/exploreSweep';
import type { ExploreRunRequest, OptimizeFn, SweepSchedule, SweepTarget } from '../../src/solver/exploreSweep';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import type { ItemLookup } from '../../src/solver/types';
import { WEAPON } from '../physical/lpFixtures';

const OPT: OptimizationMetadata = { lower_bound: 1, upper_bound: 1, absolute_gap: 0, tolerance: 1e-5, nodes: 1, termination: 'optimal' };
const LIMIT: OptimizationMetadata = { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' };

/** A published witness: ergonomics and vertical recoil rise together, so witnesses of a sweep do not dominate each other on the displayed frontier. */
const witness = (ergo: number, price: number): OptimizeResponse => ({
  status: 'optimal', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
  physical_certificate: 'certified_optimal', selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: 1, optimization: OPT,
  final_stats: { ergonomics: ergo, recoil_vertical: ergo + 20, recoil_horizontal: 40, total_price: price, total_weight: 3, moa: 2 }, solve_time_ms: 5,
});
const timeout = (): OptimizeResponse => ({
  status: 'incomplete', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
  physical_certificate: 'none', selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: null, optimization: LIMIT,
  reason: PUBLIC_REASONS.timeLimitReached, solve_time_ms: 5,
});

const guardOf = (): { guard: RuntimeGuard; state: { cancelled: boolean; onYield: (n: number) => void } } => {
  const state = { cancelled: false, yields: 0, onYield: (_n: number): void => undefined };
  return {
    state,
    guard: { deadline: 1_000_000, now: () => 0, cancelled: () => state.cancelled, yieldMacrotask: async () => { state.yields++; state.onYield(state.yields); } },
  };
};

const target = (index: number): SweepTarget => ({
  target_index: index, target_value: index * 10, weights: { ergoWeight: 1, recoilWeight: 0, priceWeight: 0 }, overrides: { minErgonomics: index * 10 },
});
const schedule = (n: number): SweepSchedule => ({ targets: Array.from({ length: n }, (_, i) => target(i)) });
const request = (): ExploreRunRequest => ({
  ignore: 'price',
  base: { weaponId: WEAPON, itemLookup: {} as ItemLookup, compatibilityMap: { reachable_items: {}, slot_items: {}, item_to_slots: {}, slot_owner: {} } },
  precisionRequest: 'precise',
  nakedRecoilV: 100,
});
const scripted = (items: OptimizeResponse[]): OptimizeFn => { let n = 0; return async () => items[n++]; };

test('a snapshot follows every launched target: launched grows by one, the points so far and the unlaunched targets as U without a reason', async () => {
  const snapshots: ExploreSnapshot[] = [];
  const final = await runExplore(request(), schedule(3), guardOf().guard, scripted([witness(40, 3000), witness(50, 4000), witness(60, 5000)]), s => snapshots.push(s));
  assert.deepEqual(snapshots.map(s => [s.launched, s.scheduled]), [[1, 3], [2, 3], [3, 3]]);
  assert.deepEqual(snapshots.map(s => s.response.points.length), [1, 2, 3]);

  const first = snapshots[0].response;
  assert.equal(first.curve_status, 'partial', 'unlaunched targets are U, so a sweep in progress is partial');
  assert.deepEqual(first.step_outcomes.map(r => r.outcome), ['V', 'U', 'U']);
  assert.equal(first.step_outcomes[1].reason, undefined, 'a target that has not started yet has no reason');
  assert.equal(first.step_outcomes[1].status, 'incomplete');
  assert.equal(first.step_outcomes[1].physical_certificate, 'none');
  assert.equal(first.step_outcomes[1].precision_resolved, null);
  assert.deepEqual(first.sweep_schedule.map(t => t.target_index), [0, 1, 2]);
  assert.equal(first.step_outcomes[0].point_index, 0, 'the witness row references its point');

  // The last snapshot of a finished sweep is the final response.
  assert.deepEqual(snapshots[2].response, final);
  assert.equal(final.curve_status, 'complete');
});

test('a snapshot carries only verified witnesses: a target that ended unresolved adds no point and keeps its factual reason', async () => {
  const snapshots: ExploreSnapshot[] = [];
  await runExplore(request(), schedule(3), guardOf().guard, scripted([witness(40, 3000), timeout(), witness(60, 5000)]), s => snapshots.push(s));
  assert.deepEqual(snapshots.map(s => s.response.points.length), [1, 1, 2]);
  const second = snapshots[1].response;
  assert.deepEqual(second.step_outcomes.map(r => r.outcome), ['V', 'U', 'U']);
  assert.equal(second.step_outcomes[1].reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(second.reason, PUBLIC_REASONS.timeLimitReached, 'the sweep-level reason is the first unresolved target\'s factual reason');
});

test('an adaptive schedule shows its growth: the next target is generated before the snapshot, so scheduled can exceed the targets known up front', async () => {
  const snapshots: ExploreSnapshot[] = [];
  const adaptive: SweepSchedule = {
    targets: [target(0)],
    extend: settled => (settled.length < 3 ? [target(settled.length)] : []),
  };
  await runExplore(request(), adaptive, guardOf().guard, scripted([witness(40, 3000), witness(50, 4000), witness(60, 5000)]), s => snapshots.push(s));
  assert.deepEqual(snapshots.map(s => [s.launched, s.scheduled]), [[1, 2], [2, 3], [3, 3]]);
  assert.deepEqual(snapshots[0].response.step_outcomes.map(r => r.outcome), ['V', 'U']);
});

test('a hook that throws changes nothing: the sweep finishes with the same response as without a hook', async () => {
  const without = await runExplore(request(), schedule(3), guardOf().guard, scripted([witness(40, 3000), witness(50, 4000), witness(60, 5000)]));
  let calls = 0;
  const throwing = await runExplore(request(), schedule(3), guardOf().guard, scripted([witness(40, 3000), witness(50, 4000), witness(60, 5000)]), () => { calls++; throw new Error('observer failed'); });
  assert.equal(calls, 3, 'the observer is still called for every target');
  assert.deepEqual(throwing, without);
});

test('no hook: the response is exactly the pre-hook one (the hook is optional)', async () => {
  const r: ExploreResponse = await runExplore(request(), schedule(2), guardOf().guard, scripted([witness(40, 3000), witness(50, 4000)]));
  assert.equal(r.curve_status, 'complete');
  assert.equal(r.points.length, 2);
});

test('a sweep stopped by a cancel publishes the snapshots of the targets it solved, none after the stop, and the final response has the stop reason', async () => {
  const h = guardOf();
  h.state.onYield = n => { if (n === 2) h.state.cancelled = true; };
  const snapshots: ExploreSnapshot[] = [];
  const final = await runExplore(request(), schedule(4), h.guard, scripted([witness(40, 3000), witness(50, 4000), witness(60, 5000), witness(70, 6000)]), s => snapshots.push(s));
  assert.deepEqual(snapshots.map(s => s.launched), [1, 2], 'nothing is published for a target that never launched');
  assert.equal(final.reason, PUBLIC_REASONS.cancelledByUser);
  assert.equal(final.curve_status, 'partial');
  assert.equal(final.points.length, 2, 'the points published so far are the points kept');
  assert.deepEqual(snapshots[1].response.points, final.points);
  assert.equal(snapshots[1].response.reason, undefined, 'a snapshot is taken before any stop, so it carries no stop reason');
});

test('an invalid schedule publishes nothing', async () => {
  const snapshots: ExploreSnapshot[] = [];
  const r = await runExplore(request(), { targets: [] }, guardOf().guard, scripted([]), s => snapshots.push(s));
  assert.equal(r.curve_status, 'invalid');
  assert.equal(snapshots.length, 0);
});
