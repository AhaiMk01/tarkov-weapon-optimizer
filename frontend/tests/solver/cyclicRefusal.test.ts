// A gun whose part graph has a cycle is unsupported data (owner decision 2d as amended, 2026-10-12, Phase 2.10): every operation refuses it before any solve,
// with `Unsupported data: cyclic part graph` and its own pre-model envelope. Optimize in every mode is covered in solve.test.ts; this file covers Explore and the
// MOA floor, and the per-gun check itself (the blueprint's ancestor rule as the detector, loops the receiver cannot reach left alone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { runExplore } from '../../src/solver/exploreSweep';
import type { ExploreRunRequest, OptimizeFn, SweepSchedule } from '../../src/solver/exploreSweep';
import { runMoaFloorDetailed } from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import { partGraphIsAcyclic, preparePhysicalWeapon } from '../../src/solver/physical';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { partGraphRefusal, partGraphSupported } from '../../src/solver/physical/solvePrecise';
import type { ItemLookup } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

/** A and B can host each other below the receiver: a cycle reachable from the receiver. */
const cyclic = (): ItemLookup => lookupOf(
  gun(WEAPON, { slots: [slot('s0', ['A']), slot('s1', ['B'])] }),
  ['A', mod('A', { ergo: 20, slots: [slot('toB', ['B'])] })],
  ['B', mod('B', { ergo: 10, slots: [slot('toA', ['A'])] })],
);
/** The same loop between parts the receiver cannot reach: the part graph reachable from the receiver is acyclic (ledger F10-no-disconnected-assembly). */
const unreachableLoop = (): ItemLookup => lookupOf(
  gun(WEAPON, { slots: [slot('s0', ['C'])] }),
  ['C', mod('C', { ergo: 5 })],
  ['A', mod('A', { ergo: 20, slots: [slot('toB', ['B'])] })],
  ['B', mod('B', { ergo: 10, slots: [slot('toA', ['A'])] })],
);

test('the per-gun check: a cycle reachable from the receiver fails it, a loop among unreachable parts does not; it reads the memoized blueprint', () => {
  const bad = cyclic();
  assert.equal(partGraphIsAcyclic(preparePhysicalWeapon(bad, WEAPON)), false);
  assert.equal(partGraphSupported(bad, WEAPON), false);
  assert.equal(partGraphRefusal({ itemLookup: bad, weaponId: WEAPON }), PUBLIC_REASONS.unsupportedCyclicPartGraph);
  const fine = unreachableLoop();
  assert.equal(partGraphIsAcyclic(preparePhysicalWeapon(fine, WEAPON)), true);
  assert.equal(partGraphRefusal({ itemLookup: fine, weaponId: WEAPON }), null);
  assert.equal(partGraphRefusal({ itemLookup: fine, weaponId: 'not-a-gun' }), null, 'a weapon the lookup does not hold is the operation\'s own error to report');
});

test('Explore refuses a cyclic gun before any target is solved: invalid, no points, no schedule, the reason', async () => {
  const lookup = cyclic();
  let calls = 0;
  const optimize: OptimizeFn = async () => { calls++; throw new Error('no target may be solved'); };
  const request: ExploreRunRequest = {
    ignore: 'price', precisionRequest: 'precise', nakedRecoilV: 100,
    base: { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), preciseMode: true },
  };
  const schedule: SweepSchedule = { targets: [{ target_index: 0, target_value: 0, weights: { ergoWeight: 1, recoilWeight: 0, priceWeight: 0 }, overrides: {} }] };
  const response = await runExplore(request, schedule, fixedGuard(performance.now() + 60_000), optimize);
  assert.equal(calls, 0);
  assert.equal(response.curve_status, 'invalid');
  assert.equal(response.reason, PUBLIC_REASONS.unsupportedCyclicPartGraph);
  assert.deepEqual([response.points, response.sweep_schedule, response.step_outcomes], [[], [], []]);
  assert.equal(response.precision_resolved, null);
  assert.equal(response.model_qualification, null);
});

test('the MOA floor refuses a cyclic gun before the seed: unresolved, no witness, no bound, no trial, always provisional_model', async () => {
  const lookup = cyclic();
  let natives = 0;
  const request: MoaFloorRequest = { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup) };
  const run = await runMoaFloorDetailed(request, fixedGuard(performance.now() + 60_000), { solve: async () => { natives++; throw new Error('no solve'); } });
  assert.equal(natives, 0);
  assert.equal(run.trials, 0);
  assert.deepEqual(run.trace, []);
  assert.equal(run.response.status, 'unresolved');
  assert.equal(run.response.reason, PUBLIC_REASONS.unsupportedCyclicPartGraph);
  assert.equal(run.response.moa_qualification, 'provisional_model');
  assert.equal(run.response.floor, null);
  assert.equal(run.response.display_floor, null);
  assert.equal(run.response.proved_lower_bound, null);
  assert.equal(run.response.witness, undefined);
});
