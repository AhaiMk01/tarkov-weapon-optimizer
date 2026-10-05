// `solve` and `computeIdealPoint` (src/solver/solver.ts) end to end on hand-built lookups and the pinned native build: the published response
// (instances, placements, multiset, count-bearing base, exact statistics, per-occurrence provenance), the minimal statuses and reasons of this
// phase, the Tchebycheff payoff table, and the Fast path's gate (a template result is published only as a validated physical build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeResponse } from '../../src/api/client';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { computeIdealPoint, solve } from '../../src/solver/solver';
import type { ItemLookup, ModLookupEntry, SolveParams } from '../../src/solver/types';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { barter, gun, lookupOf, mod, slot, trader, WEAPON } from '../physical/lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true, ...extra,
});

/** The published build re-validated from scratch: the response must stand on its own. */
function revalidate(params: SolveParams, response: OptimizeResponse) {
  assert.ok(response.selected_preset && response.slot_pairs, 'the response carries a base and placements');
  return validatePhysicalBuild(params.itemLookup, params, {
    base: response.selected_preset.id === params.weaponId ? { kind: 'naked' } : { kind: 'preset', presetId: response.selected_preset.id },
    placements: response.slot_pairs,
  }, { requirePathInstanceIds: true });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The published build
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * A preset supplying one `a`, two slots for `a`, a slot for the owned `b`, and a slot for `c` bought at a trader: every kind of provenance.
 * Total spend: preset 1000 + the second `a` 100 + c 300 = 1400.
 */
const provenance = () => lookupOf(
  gun(WEAPON, {
    slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['b']), slot('s4', ['c'])],
    presets: [{ id: 'pre', items: [{ itemId: 'a', count: 1 }], offers: [trader('prapor', 1, 1000)] }],
    offers: [trader('prapor', 1, 5000)],
  }),
  ['a', mod('a', { ergo: 5, weight: 0.5, offers: [trader('prapor', 1, 100)] })],
  ['b', mod('b', { ergo: 4, weight: 0.25, offers: [trader('skier', 1, 250)] })],
  ['c', mod('c', { ergo: 3, weight: 0.125, offers: [trader('mechanic', 1, 300)] })],
);

test('the response carries unique instances, placements, the installed multiset, the count-bearing base and exact per-occurrence provenance', async () => {
  const params = paramsOf(provenance(), { ownedItems: ['b'], priceWeight: 0.01 });
  const response = await solve(params);
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['a', 'a', 'b', 'c'], 'duplicates are kept');
  assert.deepEqual(response.selected_items.map(i => i.instanceId), [
    'weapon_0/s1:a', 'weapon_0/s2:a', 'weapon_0/s3:b', 'weapon_0/s4:c',
  ]);
  assert.equal(new Set(response.selected_items.map(i => i.instanceId)).size, 4);
  assert.deepEqual(response.selected_items.map(i => i.id), ['a', 'a', 'b', 'c'], 'the template id repeats, the instance id does not');
  assert.deepEqual(response.slot_pairs, [
    { parentInstanceId: 'weapon_0', slotId: 's1', childInstanceId: 'weapon_0/s1:a', itemId: 'a' },
    { parentInstanceId: 'weapon_0', slotId: 's2', childInstanceId: 'weapon_0/s2:a', itemId: 'a' },
    { parentInstanceId: 'weapon_0', slotId: 's3', childInstanceId: 'weapon_0/s3:b', itemId: 'b' },
    { parentInstanceId: 'weapon_0', slotId: 's4', childInstanceId: 'weapon_0/s4:c', itemId: 'c' },
  ]);
  const byInstance = new Map(response.selected_items.map(i => [i.instanceId, i]));
  const first = byInstance.get('weapon_0/s1:a')!;
  assert.deepEqual(first.acquisition, { source: 'preset', presetId: 'pre', offerSource: null, offerIndex: null });
  assert.equal(first.price, 0);
  assert.equal(first.source, undefined);
  const second = byInstance.get('weapon_0/s2:a')!;
  assert.deepEqual(second.acquisition, { source: 'offer', presetId: null, offerSource: 'prapor', offerIndex: 0 });
  assert.equal(second.price, 100);
  assert.equal(second.source, 'prapor');
  const owned = byInstance.get('weapon_0/s3:b')!;
  assert.deepEqual(owned.acquisition, { source: 'owned', presetId: null, offerSource: null, offerIndex: null });
  assert.equal(owned.price, 0);
  assert.equal(byInstance.get('weapon_0/s4:c')!.price, 300);
  assert.deepEqual(response.selected_preset?.items, [{ itemId: 'a', count: 1 }]);
  assert.equal(response.selected_preset?.id, 'pre');
  assert.equal(response.selected_preset?.receiver_id, WEAPON);
  assert.equal(response.selected_preset?.price, 1000);
  assert.equal(response.selected_preset?.source, 'prapor');
  assert.equal(response.final_stats?.total_price, 1400);
  // The statistics are the validator's exact recomputation, and the objective is the exact score of that build.
  const exact = revalidate(params, response);
  assert.equal(exact.ok, true, JSON.stringify(exact.violations));
  assert.equal(response.final_stats?.ergonomics, exact.stats?.ergonomics);
  assert.equal(response.final_stats?.total_weight, exact.stats?.weight);
  assert.equal(response.final_stats?.true_ergo_delta, exact.stats?.ted);
  // score = (e / 10) fE - (p / 1000) fP with fE = 10 x 17 and fP = 1400.
  assert.ok(Math.abs(response.objective_value - (17 - 0.014)) < 1e-9, String(response.objective_value));
  assert.equal(response.optimization, undefined, 'a request with no TED has no spatial search to report');
});

test('a barter lot is bought whole and is charged once, to the first unit taken; the rest of the lot rides on it', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])] }),
    ['a', mod('a', { ergo: 5, offers: [barter('mechanic', 1, 600, false, 2)] })],
  );
  const params = paramsOf(lookup, { barterAvailable: true });
  const response = await solve(params);
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['a', 'a', 'a']);
  assert.equal(response.final_stats?.total_price, 5000 + 1200, 'three units need two lots of two');
  assert.deepEqual(response.selected_items.map(i => i.price), [600, 0, 600]);
  assert.equal(response.selected_items[0].barter_requirements?.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Statuses and reasons
// ---------------------------------------------------------------------------------------------------------------------------

const small = (): ItemLookup => lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 5 })]);

test('Precise emptiness without a MOA cap is infeasible with no reason; with a MOA cap it is incomplete, provisional-model infeasible', async () => {
  const none = await solve(paramsOf(small(), { maxPrice: 10 }));
  assert.equal(none.status, 'infeasible');
  assert.equal(none.reason, undefined);
  assert.deepEqual(none.selected_items, []);
  assert.deepEqual(none.slot_pairs, []);
  const moa = await solve(paramsOf(small(), { maxPrice: 10, maxMOA: 100 }));
  assert.equal(moa.status, 'incomplete');
  assert.equal(moa.reason, 'Provisional MOA model infeasible');
  // An emptiness the domain proves (no legal base) is reported the same way, with no native call needed.
  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  assert.equal((await solve(paramsOf(noBase))).status, 'infeasible');
  assert.equal((await solve(paramsOf(noBase, { maxMOA: 5 }))).reason, 'Provisional MOA model infeasible');
});

test('Fast emptiness is incomplete: approximate model infeasible, or the Fast provisional MOA reason under a MOA cap', async () => {
  const plain = await solve(paramsOf(small(), { preciseMode: false, maxPrice: 10 }));
  assert.equal(plain.status, 'incomplete');
  assert.equal(plain.reason, 'Approximate model infeasible');
  const moa = await solve(paramsOf(small(), { preciseMode: false, maxPrice: 10, maxMOA: 100 }));
  assert.equal(moa.reason, 'Fast provisional MOA model infeasible');
});

test('an invalid owned_items list is incomplete with its reason, before any model work, in both modes', async () => {
  for (const preciseMode of [true, false]) {
    for (const ownedItems of [['a', ''], [1 as unknown as string], 'a' as unknown as string[], new Array<string>(3)]) {
      const response = await solve(paramsOf(small(), { preciseMode, ownedItems }));
      assert.equal(response.status, 'incomplete');
      assert.equal(response.reason, 'Invalid owned_items format');
      assert.deepEqual(response.selected_items, []);
    }
  }
});

test('a deadline that has passed is incomplete with the time-limit reason and no optimization claim', async () => {
  for (const preciseMode of [true, false]) {
    const response = await solve(paramsOf(small(), { preciseMode, timeLimitMs: 0 }));
    assert.equal(response.status, 'incomplete');
    assert.equal(response.reason, 'Time limit reached');
    assert.equal(response.optimization, undefined);
  }
});

test('a TED request reports its search; a limit with a verified build is feasible with the factual reason, and an unknown bound is Infinity', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b', 'c'], true)] }),
    ['a', mod('a', { weight: 1, ergo: 20 })], ['b', mod('b', { weight: 2, ergo: 30 })], ['c', mod('c', { weight: 3, ergo: 41 })],
  );
  const full = await solve(paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true }));
  assert.equal(full.status, 'optimal', full.reason);
  assert.equal(full.optimization?.termination, 'optimal');
  assert.ok(full.optimization!.absolute_gap <= full.optimization!.tolerance);
  assert.deepEqual(full.selected_item_ids, ['b']);
  const limited = await solve(paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxSpatialNodes: 1 }));
  assert.equal(limited.status, 'feasible');
  assert.equal(limited.reason, 'Node limit reached');
  assert.equal(limited.optimization?.termination, 'limit');
  assert.equal(limited.optimization?.upper_bound, Infinity);
  assert.deepEqual(limited.selected_item_ids, ['b']);
  const none = await solve(paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxSpatialNodes: 0 }));
  assert.equal(none.status, 'incomplete');
  assert.equal(none.reason, 'Node limit reached');
  assert.equal(none.final_stats, undefined);
});

test('a requested tolerance is honoured: 1e-9 certifies a TrueErgo request, and the response carries it', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b'], true)] }),
    ['a', mod('a', { weight: 2, ergo: 30 })], ['b', mod('b', { weight: 5, ergo: 60 })],
  );
  const response = await solve(paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, objectiveTolerance: 1e-9 }));
  assert.equal(response.status, 'optimal', response.reason);
  assert.equal(response.optimization?.tolerance, 1e-9);
  assert.equal(response.optimization?.termination, 'optimal');
  assert.ok(response.optimization!.absolute_gap <= 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The Tchebycheff payoff table
// ---------------------------------------------------------------------------------------------------------------------------

/** Three parts, each the best on one axis: p1 ergonomics (50), p2 recoil (-0.3), p3 price (10 RUB). */
const payoff = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['p1', 'p2', 'p3'], true)] }),
  ['p1', mod('p1', { ergo: 50, recoil: 0, offers: [trader('prapor', 1, 100)] })],
  ['p2', mod('p2', { ergo: 10, recoil: -0.3, offers: [trader('prapor', 1, 100)] })],
  ['p3', mod('p3', { ergo: 0, recoil: 0, offers: [trader('prapor', 1, 10)] })],
);

test('the payoff table comes from three single-axis solves of the exact model, in the frames of the objective', async () => {
  const table = await computeIdealPoint(paramsOf(payoff()));
  // fE = 10 x ergonomics, fR = 1000 x recoil modifier, fP = RUB spend (receiver 5000).
  assert.deepEqual(table, { zE: 500, nadE: 0, zR: -300, nadR: 0, zP: 5010, nadP: 5100 });
});

test('a Tchebycheff solve without a payoff table computes it and reports the table it used; a supplied table is reported as given', async () => {
  const params = paramsOf(payoff(), { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true });
  const computed = await solve(params);
  assert.equal(computed.status, 'optimal', computed.reason);
  assert.deepEqual(computed.ideal_point, { zE: 500, nadE: 0, zR: -300, nadR: 0, zP: 5010, nadP: 5100 });
  const given = { zE: 500, nadE: 0, zR: -300, nadR: 0, zP: 5010, nadP: 5100 };
  const supplied = await solve({ ...params, idealPoint: given });
  assert.deepEqual(supplied.ideal_point, given);
  assert.deepEqual(supplied.selected_item_ids, computed.selected_item_ids);
  // A weighted (non-Tchebycheff) request reports no table.
  assert.equal((await solve(paramsOf(payoff()))).ideal_point, undefined);
});

test('a payoff endpoint that cannot be certified is not papered over with the weighted objective: the request is incomplete', async () => {
  const params = paramsOf(payoff(), { useTchebycheff: true, useTrueErgo: true, maxSpatialNodes: 0 });
  const response = await solve(params);
  assert.equal(response.status, 'incomplete');
  assert.equal(response.reason, 'Required proof prerequisite unavailable');
  assert.deepEqual(response.selected_items, []);
  await assert.rejects(computeIdealPoint({ ...params, useTchebycheff: false }), /Ideal-point endpoint not certified/);
});

test('an endpoint that proves the request empty proves it for every objective: the emptiness outcome is returned', async () => {
  const response = await solve(paramsOf(payoff(), { useTchebycheff: true, maxPrice: 10 }));
  assert.equal(response.status, 'infeasible');
  const moa = await solve(paramsOf(payoff(), { useTchebycheff: true, maxPrice: 10, maxMOA: 100 }));
  assert.equal(moa.reason, 'Provisional MOA model infeasible');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Fast: a template result is published only as a validated physical build
// ---------------------------------------------------------------------------------------------------------------------------

test('Fast publishes the same shape, mapped onto a rooted placement tree and validated', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host']), slot('stock', ['butt'])] }),
    ['host', mod('host', { ergo: 1, slots: [slot('rail', ['sight'])] })],
    ['sight', mod('sight', { ergo: 3 })],
    ['butt', mod('butt', { ergo: 2 })],
  );
  const params = paramsOf(lookup, { preciseMode: false });
  const response = await solve(params);
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['host', 'butt', 'sight'], 'in placement order: the receiver slots first, then what hangs on the placed parts');
  assert.deepEqual(response.slot_pairs?.map(p => p.childInstanceId).sort(), ['weapon_0/mount:host', 'weapon_0/mount:host/rail:sight', 'weapon_0/stock:butt']);
  assert.equal(revalidate(params, response).ok, true);
  assert.equal(response.final_stats?.ergonomics, 6);
  assert.equal(response.final_stats?.total_price, 5300);
});

test('Fast no longer installs a part nobody sells and no preset supplies (no found-in-raid stand-in), and has no free base', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['bought', 'raid'])] }),
    ['bought', mod('bought', { ergo: 1 })],
    ['raid', mod('raid', { ergo: 90, offers: [] })],
  );
  const fast = await solve(paramsOf(lookup, { preciseMode: false }));
  assert.deepEqual(fast.selected_item_ids, ['bought']);
  const precise = await solve(paramsOf(lookup));
  assert.deepEqual(precise.selected_item_ids, ['bought'], 'the exact model caps it at zero copies too');
  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const none = await solve(paramsOf(noBase, { preciseMode: false }));
  assert.equal(none.status, 'incomplete');
  assert.equal(none.reason, 'Approximate model infeasible');
});

test('Fast never publishes a template result that is not a valid physical build: a boundary the solver tolerance admitted is cut out', async () => {
  // u + v weigh 3 + 2^-52 kg, over the cap of 3 exactly: HiGHS accepts the pair, the exact validator does not. v alone is valid.
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s1', ['u']), slot('s2', ['v'])] }),
    ['u', mod('u', { weight: 1, ergo: 1 })],
    ['v', mod('v', { weight: 1 + 2 ** -52, ergo: 2 })],
  );
  const params = paramsOf(lookup, { preciseMode: false, maxWeight: 3 });
  const response = await solve(params);
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['v']);
  assert.equal(revalidate(params, response).ok, true);
  // Required slots that the one-copy model counts twice: no valid build exists for it.
  const twice = lookupOf(
    gun(WEAPON, { slots: [slot('left', ['only'], true), slot('right', ['only'], true)] }),
    ['only', mod('only', { ergo: 4 })],
  );
  (twice.only as ModLookupEntry).conflicting_items = ['only'];
  const fast = await solve(paramsOf(twice, { preciseMode: false }));
  assert.equal(fast.status, 'incomplete');
  assert.equal(fast.reason, 'Approximate model infeasible');
  assert.equal((await solve(paramsOf(twice))).status, 'infeasible', 'the exact model agrees: one copy cannot fill two required slots');
});

test('Fast honours the stash for its one copy: an owned part has no offer to buy and is still installed, free', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['rare'])] }), ['rare', mod('rare', { ergo: 9, offers: [] })]);
  const params = paramsOf(lookup, { preciseMode: false, ownedItems: ['rare'] });
  const response = await solve(params);
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['rare']);
  assert.equal(response.final_stats?.total_price, 5000);
  assert.equal(response.selected_items[0].acquisition?.source, 'owned');
  const without = await solve(paramsOf(lookup, { preciseMode: false }));
  assert.deepEqual(without.selected_item_ids, [], 'without the stash the part has no source and is not installed');
});
