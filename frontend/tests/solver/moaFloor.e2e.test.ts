// The MOA floor (src/solver/moaFloor.ts) end to end on a small fixture with a KNOWN minimum and the pinned native build: the real Precise pipeline
// as the query, the witness record, zero and negative caps, hard constraints and TED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup } from '../../src/solver/types';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import {
  bracketWithinTolerance, floorQueryParams, MOA_FLOOR_MAX_TRIALS, MOA_FLOOR_NATIVE_STOP, preciseFloorQuery, runMoaFloorDetailed,
} from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { rat } from '../../src/solver/physical/exact';
import { ratRoundUp } from '../../src/solver/physical/rational';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { gunWith, lookupOf, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

const generous = () => fixedGuard(performance.now() + 120_000);

/**
 * Receiver COI 1/16 (2.149 MOA). A required barrel slot (4.297, 1.074 or 0.537 MOA by replacement), an optional scope (+10 percent accuracy) and an
 * optional suppressor (-5 percent). The minimum is best barrel + scope = 1/64 x 0.9 x K = 28125/58178 MOA = 0.48343; the next build above it is 0.5372.
 */
const minimumFixture = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { coi: 0.0625, slots: [slot('barrel', ['b_wide', 'b_mid', 'b_best'], true), slot('optic', ['scope']), slot('muzzle', ['sup'])] }),
  ['b_wide', modWith('b_wide', { coi: 0.125 })],
  ['b_mid', modWith('b_mid', { coi: 0.03125 })],
  ['b_best', modWith('b_best', { coi: 0.015625, offers: [trader('prapor', 1, 500)] })],
  ['scope', modWith('scope', { accuracy: 10, offers: [trader('prapor', 1, 300)] })],
  ['sup', modWith('sup', { accuracy: -5 })],
);

const requestOf = (lookup: ItemLookup, extra: Partial<MoaFloorRequest> = {}): MoaFloorRequest => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), fleaAvailable: true, ...extra,
});

const MINIMUM_ENCLOSURE = ratRoundUp(rat(28125n, 58178n));

test('end to end: the floor of a fixture with a known minimum is model_proved, hi encloses the minimum and the bracket is within 0.02', async () => {
  const request = requestOf(minimumFixture());
  const run = await runMoaFloorDetailed(request, generous());
  const r = run.response;
  assert.equal(r.status, 'model_proved', JSON.stringify({ reason: r.reason, trace: run.trace }));
  assert.equal(r.moa_qualification, 'provisional_model');
  // Only one build lies below 0.5034, so a proved bracket of width <= 0.02 forces the minimum itself.
  assert.equal(r.floor, MINIMUM_ENCLOSURE);
  assert.ok(r.proved_lower_bound !== null && r.proved_lower_bound < 28125 / 58178);
  assert.ok(bracketWithinTolerance(r.proved_lower_bound as number, r.floor as number));
  assert.ok(run.trials >= 1 && run.trials <= MOA_FLOOR_MAX_TRIALS);
  assert.equal(r.display_floor, 0.49, 'the smallest 2-decimal value at least 0.48343');
  assert.equal(r.reason, undefined);
  // The witness is a full instance-level build that the independent validator accepts under the cap it was found at.
  const w = r.witness!;
  assert.equal(w.achieved_moa, r.floor);
  assert.deepEqual([...w.selected_item_ids].sort(), ['b_best', 'scope']);
  assert.equal(w.selected_items.length, w.slot_pairs.length);
  assert.ok(w.selected_items.every(i => typeof i.instanceId === 'string' && i.instanceId.length > 0));
  assert.equal(w.base.kind, 'naked');
  assert.equal(w.scope.max_moa !== null && w.scope.max_moa >= (r.floor as number), true, 'the cap the last witness was found under admits it');
  const validation = validatePhysicalBuild(request.itemLookup, { ...request, maxMOA: w.scope.max_moa }, { base: w.base, placements: w.slot_pairs }, { requirePathInstanceIds: true });
  assert.equal(validation.ok, true, JSON.stringify(validation.violations));
});

test('the trace shows the seed, then discovery probes below hi, then bisection; every query is Precise and the seed has no cap', async () => {
  const run = await runMoaFloorDetailed(requestOf(minimumFixture(), { precisionRequest: 'auto' }), generous());
  assert.equal(run.trace[0].step, 'seed');
  assert.equal(run.trace[0].cap, null);
  assert.equal(run.trace[0].trial, null);
  assert.ok(run.trace.every(e => e.precision_resolved === 'precise' && e.precision_request === 'auto'));
  const steps = run.trace.map(e => e.step);
  const firstBisection = steps.indexOf('bisection');
  if (firstBisection >= 0) assert.ok(steps.slice(0, firstBisection).every(s => s !== 'bisection') && steps.slice(firstBisection).every(s => s === 'bisection'));
  // Each trial witness lowers hi to an achieved value at most its cap; each empty trial is below every witness so far.
  let hi = run.trace[0].achieved_moa as number;
  for (const e of run.trace.slice(1)) {
    if (e.result === 'witness') {
      assert.ok((e.achieved_moa as number) <= (e.cap as number));
      assert.ok((e.achieved_moa as number) < hi);
      hi = e.achieved_moa as number;
    } else {
      assert.equal(e.result, 'empty');
      assert.ok((e.cap as number) < hi);
    }
  }
  assert.ok(run.trace.filter(e => e.step === 'discovery').length >= 1, 'with no proved lower bound the search starts with discovery');
});

test('every hard constraint of the caller is preserved: a budget that excludes the best barrel raises the floor to the best affordable build', async () => {
  // The receiver costs 5000, the barrels 100 (b_wide, b_mid) and 500 (b_best), the scope 300. Under a budget of 5100 only a 100 barrel fits.
  const request = requestOf(minimumFixture(), { maxPrice: 5100 });
  const run = await runMoaFloorDetailed(request, generous());
  assert.equal(run.response.status, 'model_proved', JSON.stringify(run.trace));
  // b_mid alone: 1/32 x K = 1.0744 MOA.
  assert.equal(run.response.floor, ratRoundUp(rat(31250n, 29089n)), 'b_mid alone: 1/32 x 1000000/29089');
  assert.deepEqual(run.response.witness!.selected_item_ids, ['b_mid']);
  assert.equal(run.response.witness!.scope.feasibility.max_price, 5100);
});

test('seed emptiness is model_infeasible; a request the model proves empty resolves no witness and no bounds', async () => {
  const run = await runMoaFloorDetailed(requestOf(minimumFixture(), { maxPrice: 10 }), generous());
  assert.equal(run.response.status, 'model_infeasible');
  assert.equal(run.response.floor, null);
  assert.equal(run.response.display_floor, null);
  assert.equal(run.response.proved_lower_bound, null);
  assert.equal(run.response.witness, undefined);
  assert.equal(run.trials, 0, 'the seed is not a trial and nothing follows a qualified seed emptiness');
});

test('the query parameters: constant-zero weights, Precise, no TrueErgo or Tchebycheff, the caller domain kept, the cap set (zero and negative included)', () => {
  const request = requestOf(minimumFixture(), {
    ergoWeight: 1, recoilWeight: 1, priceWeight: 1, useTrueErgo: true, useTchebycheff: true, preciseMode: false, precisionRequest: 'fast',
    maxPrice: 5000, preventOverswing: true, equipErgoModifier: -0.1, ownedItems: ['scope'], timeLimitMs: 5, includeItems: ['scope'],
  });
  for (const cap of [null, 2.5, 0, -1.25]) {
    const p = floorQueryParams({ ...request, maxMOA: 99 } as MoaFloorRequest, cap);
    assert.deepEqual([p.ergoWeight, p.recoilWeight, p.priceWeight], [0, 0, 0]);
    assert.equal(p.useTrueErgo, false);
    assert.equal(p.useTchebycheff, false);
    assert.equal(p.idealPoint, undefined);
    assert.equal(p.preciseMode, true);
    assert.equal(p.precisionRequest, 'fast', 'the requested mode is recorded, the resolved mode is Precise');
    assert.equal(p.maxMOA, cap, 'a stray cap of the caller is replaced; zero and negative caps are kept, not dropped');
    assert.equal(p.timeLimitMs, undefined, 'the guard carries the deadline');
    assert.equal(p.maxPrice, 5000);
    assert.equal(p.preventOverswing, true);
    assert.equal(p.equipErgoModifier, -0.1);
    assert.deepEqual(p.ownedItems, ['scope']);
    assert.deepEqual(p.includeItems, ['scope']);
  }
});

test('zero and negative caps are real caps on the real pipeline: a negative cap is qualified emptiness, a zero cap on a zero-COI receiver has a witness at MOA 0', async () => {
  const zero = lookupOf(gunWith(WEAPON, { coi: 0, slots: [slot('s', ['a'])] }), ['a', modWith('a', { ergo: 4 })]);
  const request = requestOf(zero);
  const query = preciseFloorQuery(request);
  const atZero = await query(0, generous());
  assert.equal(atZero.kind, 'witness', 'cap 0 is a cap, not "no cap": the constant intrinsic MOA 0 satisfies it');
  if (atZero.kind === 'witness') assert.equal(atZero.witness.achievedMoa, 0);
  const negative = await query(-0.5, generous());
  assert.deepEqual(negative, { kind: 'empty', qualified: true, reason: 'Provisional MOA model infeasible' });
  // The whole search on this receiver: seed MOA 0, discovery probes below it, a qualified lower bound, and a bracket within 0.02 of the minimum 0.
  const run = await runMoaFloorDetailed(request, generous());
  assert.equal(run.response.status, 'model_proved', JSON.stringify(run.trace));
  assert.equal(run.response.floor, 0);
  assert.ok(run.trace.some(e => e.cap !== null && e.cap < 0 && e.result === 'empty'));
  assert.ok((run.response.proved_lower_bound as number) < 0 && bracketWithinTolerance(run.response.proved_lower_bound as number, 0));
  assert.equal(run.response.display_floor, 0);
});

test('Prevent Overswing stays a hard constraint of every query: the witness has TED >= 0', async () => {
  // A heavy required part makes the build weigh more than 3 kg, where the weight penalty applies; a light alternative has less accuracy.
  const lookup = lookupOf(
    gunWith(WEAPON, { weight: 2, ergo: 30, coi: 0.0625, slots: [slot('barrel', ['heavy', 'light'], true)] }),
    ['heavy', modWith('heavy', { weight: 6, ergo: -10, coi: 0.015625 })],
    ['light', modWith('light', { weight: 0.5, ergo: 5, coi: 0.03125 })],
  );
  const request = requestOf(lookup, { preventOverswing: true });
  const run = await runMoaFloorDetailed(request, generous());
  assert.ok(['model_proved', 'model_witnessed'].includes(run.response.status), JSON.stringify({ r: run.response.reason, t: run.trace }));
  const w = run.response.witness!;
  const validation = validatePhysicalBuild(lookup, { ...request, maxMOA: w.scope.max_moa }, { base: w.base, placements: w.slot_pairs }, { requirePathInstanceIds: true });
  assert.equal(validation.ok, true, JSON.stringify(validation.violations));
  assert.ok((validation.stats?.ted ?? -1) >= 0);
});

test('an invalid stash resolves nothing: the pre-model floor envelope, no solve', async () => {
  const run = await runMoaFloorDetailed(requestOf(minimumFixture(), { ownedItems: ['ok', ''] }), generous());
  assert.equal(run.response.status, 'unresolved');
  assert.equal(run.response.reason, 'Invalid owned_items format');
  assert.equal(run.response.floor, null);
  assert.equal(run.response.witness, undefined);
  assert.equal(run.trace.length, 0);
});

test('the native stop of a floor call is the single improving solution', () => {
  assert.deepEqual({ ...MOA_FLOOR_NATIVE_STOP }, { mip_max_improving_sols: 1 });
});
