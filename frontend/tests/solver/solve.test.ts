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
import { PUBLIC_REASON_SET } from '../../src/solver/physical/reasons';
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
  assert.ok(response.objective_value !== null && Math.abs(response.objective_value - (17 - 0.014)) < 1e-9, String(response.objective_value));
  // One exact native solve: one outer call, a justified gap within the tolerance, the bounds of the exact optimum.
  assert.equal(response.optimization.nodes, 1);
  assert.equal(response.optimization.termination, 'optimal');
  assert.ok(response.optimization.lower_bound !== null && response.optimization.upper_bound !== null && response.optimization.absolute_gap !== null);
  assert.ok(response.optimization.lower_bound <= response.objective_value && response.objective_value <= response.optimization.upper_bound);
  assert.ok(response.optimization.absolute_gap <= response.optimization.tolerance);
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

test('a deadline that has passed is incomplete with the time-limit reason, an unstarted search (limit) and no bound', async () => {
  for (const preciseMode of [true, false]) {
    const response = await solve(paramsOf(small(), { preciseMode, timeLimitMs: 0 }));
    assert.equal(response.status, 'incomplete');
    assert.equal(response.physical_certificate, 'none');
    assert.equal(response.reason, 'Time limit reached');
    assert.equal(response.objective_value, null);
    assert.deepEqual(response.optimization, { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' });
  }
});

test('a TED request reports its search; a limit with a verified build is feasible with the factual reason, and an unknown bound is null', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b', 'c'], true)] }),
    ['a', mod('a', { weight: 1, ergo: 20 })], ['b', mod('b', { weight: 2, ergo: 30 })], ['c', mod('c', { weight: 3, ergo: 41 })],
  );
  const full = await solve(paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true }));
  assert.equal(full.status, 'optimal', full.reason);
  assert.equal(full.optimization?.termination, 'optimal');
  assert.ok(full.optimization.absolute_gap !== null && full.optimization.absolute_gap <= full.optimization.tolerance);
  assert.deepEqual(full.selected_item_ids, ['b']);
  const limited = await solve(paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxSpatialNodes: 1 }));
  assert.equal(limited.status, 'feasible');
  assert.equal(limited.reason, 'Node limit reached');
  assert.equal(limited.optimization?.termination, 'limit');
  assert.equal(limited.optimization?.upper_bound, null, 'an unproved upper bound travels as null, never Infinity or 0');
  assert.equal(limited.optimization?.absolute_gap, null);
  assert.ok(limited.optimization.lower_bound !== null, 'the verified build keeps its lower bound');
  assert.equal(limited.physical_certificate, 'feasible');
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
  assert.ok(response.optimization.absolute_gap !== null && response.optimization.absolute_gap <= 1e-9);
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

test('a payoff endpoint that cannot be certified is not papered over with the weighted objective: the request is incomplete, with the factual stop of the endpoint', async () => {
  const params = paramsOf(payoff(), { useTchebycheff: true, useTrueErgo: true, maxSpatialNodes: 0 });
  const response = await solve(params);
  assert.equal(response.status, 'incomplete');
  assert.equal(response.physical_certificate, 'none');
  // The endpoint solve stopped on the spatial node cap: that is the reported cause, not a rewritten "prerequisite" (section 6, factual stop cause).
  assert.equal(response.reason, 'Node limit reached');
  assert.equal(response.optimization.termination, 'limit', 'the search of the objective itself never started');
  assert.equal(response.ideal_point, undefined, 'no table was used');
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
// Fast: a count-model result is published only as a validated physical build
// ---------------------------------------------------------------------------------------------------------------------------

test('Fast publishes the same shape, decoded into a rooted placement tree and validated', async () => {
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

test('Fast never publishes a result that is not a valid physical build: a boundary the solver tolerance admitted is cut out', async () => {
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
  // Two required slots, one part capped at one copy by its self-conflict: the count model states the cap, so no point exists.
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

test('Fast honours the stash: an owned part has no offer to buy and is still installed, free', async () => {
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

test('Fast installs several copies of one part with the same provenance and spend as Precise: preset supply, stash, purchase, distinct instances', async () => {
  const lookup = provenance();
  const precise = await solve(paramsOf(lookup, { ownedItems: ['b'], priceWeight: 0.01 }));
  const params = paramsOf(lookup, { preciseMode: false, ownedItems: ['b'], priceWeight: 0.01 });
  const fast = await solve(params);
  assert.equal(fast.status, 'optimal', fast.reason);
  assert.deepEqual(fast.selected_item_ids, ['a', 'a', 'b', 'c'], 'duplicates are kept');
  assert.equal(new Set(fast.selected_items.map(i => i.instanceId)).size, 4);
  assert.deepEqual(fast.selected_items.map(i => [i.instanceId, i.acquisition, i.price]), precise.selected_items.map(i => [i.instanceId, i.acquisition, i.price]));
  assert.deepEqual(fast.selected_preset?.id, 'pre');
  assert.equal(fast.final_stats?.total_price, 1400);
  assert.ok(fast.objective_value !== null && precise.objective_value !== null && Math.abs(fast.objective_value - precise.objective_value) < 1e-9);
  assert.equal(revalidate(params, fast).ok, true);
  // Fast has no proof frame: its lower bound is the verified witness's, its upper bound and gap are unknown, and there are no spatial calls.
  assert.equal(fast.optimization.upper_bound, null);
  assert.equal(fast.optimization.absolute_gap, null);
  assert.equal(fast.optimization.nodes, 0);
  assert.ok(fast.optimization.lower_bound !== null && fast.optimization.lower_bound <= fast.objective_value);
});

test('Fast emptiness after a rejected point is still emptiness, never infeasible: the cut loop ends in the approximate-model reason', async () => {
  // A cyclic graph: the model optimum (A, B, A below B, M) repeats an ancestor and is cut; the next best point is valid, so this is a build.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('req', ['M'], true), slot('s0', ['A']), slot('s1', ['B'])] }),
    ['M', mod('M', { conflictsSlots: ['s1'] })],
    ['A', mod('A', { ergo: 20, slots: [slot('toB', ['B'])] })],
    ['B', mod('B', { ergo: 10, slots: [slot('toA', ['A'])] })],
  );
  const fast = await solve(paramsOf(lookup, { preciseMode: false }));
  assert.equal(fast.status, 'optimal', fast.reason);
  assert.deepEqual([...(fast.selected_item_ids ?? [])].sort(), ['A', 'B', 'M']);
  assert.equal(fast.final_stats?.ergonomics, 30);
  // A minimum ergonomics that only the invalid chain reaches (50): the cut leaves no point, and Fast says so in the approximate-model terms.
  const none = await solve(paramsOf(lookup, { preciseMode: false, minErgonomics: 50 }));
  assert.equal(none.status, 'incomplete');
  assert.equal(none.reason, 'Approximate model infeasible');
});

// ---------------------------------------------------------------------------------------------------------------------------
// The transport (ADR 0013 sections 5 and 6): every response carries the whole contract
// ---------------------------------------------------------------------------------------------------------------------------

const PAIRS: Record<string, string[]> = { optimal: ['certified_optimal', 'approximate_optimal'], feasible: ['feasible'], incomplete: ['none'], infeasible: ['certified_infeasible'] };

/** The contract every response satisfies, whatever happened: required fields, nullable bounds, the closed reason set, status/certificate pairing. */
function assertTransport(response: OptimizeResponse, label: string): void {
  for (const key of [
    'status', 'precision_request', 'precision_resolved', 'model_qualification', 'moa_qualification', 'physical_certificate', 'selected_items', 'selected_item_ids',
    'slot_pairs', 'objective_value', 'optimization', 'solve_time_ms',
  ] as const) assert.notEqual(response[key], undefined, `${label}: ${key} is required (null is a value, absent is not)`);
  assert.ok(['optimal', 'feasible', 'incomplete', 'infeasible'].includes(response.status), `${label}: ${response.status}`);
  assert.ok(PAIRS[response.status].includes(response.physical_certificate), `${label}: ${response.status} / ${response.physical_certificate}`);
  const o = response.optimization;
  for (const key of ['lower_bound', 'upper_bound', 'absolute_gap'] as const) {
    assert.ok(o[key] === null || Number.isFinite(o[key]), `${label}: ${key} is a finite number or null, never Infinity or NaN: ${String(o[key])}`);
  }
  assert.ok(Number.isFinite(o.tolerance) && Number.isInteger(o.nodes) && o.nodes >= 0, label);
  assert.ok(o.termination === 'optimal' || o.termination === 'limit', label);
  if (response.reason !== undefined) assert.ok(PUBLIC_REASON_SET.has(response.reason), `${label}: "${response.reason}" is outside the closed reason set`);
  const hasBuild = response.status === 'optimal' || response.status === 'feasible';
  assert.equal(response.objective_value !== null, hasBuild, `${label}: the objective is a number exactly when there is a build`);
  assert.equal(response.selected_item_ids.length, response.selected_items.length, label);
  assert.equal(response.slot_pairs.length, response.selected_items.length, label);
  assert.equal(response.final_stats !== undefined, hasBuild, label);
  assert.equal(response.selected_preset !== undefined, hasBuild, label);
  if (!hasBuild) {
    assert.deepEqual(response.selected_items, [], label);
    assert.deepEqual(response.slot_pairs, [], label);
  }
  if (o.lower_bound !== null && response.objective_value !== null) assert.ok(o.lower_bound <= response.objective_value, label);
  if (o.upper_bound !== null && response.objective_value !== null) assert.ok(response.objective_value <= o.upper_bound, label);
}

test('every response kind carries the full contract: required qualifiers, nullable bounds, the closed reason set, the status/certificate pairing', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b', 'c'], true)] }),
    ['a', mod('a', { weight: 1, ergo: 20 })], ['b', mod('b', { weight: 2, ergo: 30 })], ['c', mod('c', { weight: 3, ergo: 41 })],
  );
  const responses: [string, OptimizeResponse][] = [];
  for (const [mode, preciseMode] of [['precise', true], ['fast', false]] as const) {
    responses.push([`${mode} optimum`, await solve(paramsOf(lookup, { preciseMode }))]);
    responses.push([`${mode} MOA optimum`, await solve(paramsOf(lookup, { preciseMode, maxMOA: 100 }))]);
    responses.push([`${mode} emptiness`, await solve(paramsOf(lookup, { preciseMode, maxPrice: 10 }))]);
    responses.push([`${mode} MOA emptiness`, await solve(paramsOf(lookup, { preciseMode, maxPrice: 10, maxMOA: 100 }))]);
    responses.push([`${mode} deadline`, await solve(paramsOf(lookup, { preciseMode, timeLimitMs: 0 }))]);
    responses.push([`${mode} invalid stock`, await solve(paramsOf(lookup, { preciseMode, ownedItems: [''] }))]);
  }
  responses.push(['TED optimum', await solve(paramsOf(lookup, { useTrueErgo: true, ergoWeight: 100 }))]);
  responses.push(['TED node cap with a witness', await solve(paramsOf(lookup, { useTrueErgo: true, ergoWeight: 100, maxSpatialNodes: 1 }))]);
  responses.push(['TED node cap without one', await solve(paramsOf(lookup, { useTrueErgo: true, ergoWeight: 100, maxSpatialNodes: 0 }))]);
  for (const [label, response] of responses) assertTransport(response, label);
  const by = Object.fromEntries(responses);
  const row = (r: OptimizeResponse) => [r.status, r.physical_certificate, r.model_qualification, r.moa_qualification, r.reason];
  // the rows of section 6, as published
  assert.deepEqual(row(by['precise optimum']), ['optimal', 'certified_optimal', 'exact', null, undefined]);
  assert.deepEqual(row(by['precise MOA optimum']), ['optimal', 'approximate_optimal', 'exact', 'provisional_model', undefined]);
  assert.deepEqual(row(by['fast optimum']), ['optimal', 'approximate_optimal', 'approximate', null, undefined]);
  assert.deepEqual(row(by['fast MOA optimum']), ['optimal', 'approximate_optimal', 'approximate', 'provisional_model', undefined]);
  assert.deepEqual(row(by['precise emptiness']), ['infeasible', 'certified_infeasible', 'exact', null, undefined]);
  assert.deepEqual(row(by['precise MOA emptiness']), ['incomplete', 'none', 'exact', 'provisional_model', 'Provisional MOA model infeasible']);
  assert.deepEqual(row(by['fast emptiness']), ['incomplete', 'none', 'approximate', null, 'Approximate model infeasible']);
  assert.deepEqual(row(by['fast MOA emptiness']), ['incomplete', 'none', 'approximate', 'provisional_model', 'Fast provisional MOA model infeasible']);
  assert.equal(by['precise emptiness'].optimization.termination, 'optimal');
  assert.equal(by['fast emptiness'].optimization.termination, 'optimal', 'every completed search, emptiness included, terminates optimal');
  assert.equal(by['precise deadline'].optimization.termination, 'limit');
  assert.equal(by['TED node cap with a witness'].status, 'feasible');
  assert.equal(by['TED node cap without one'].status, 'incomplete');
});

test('an invalid owned_items list publishes the null envelope: nothing resolved, empty manifest, null objective and bounds, no nodes, the search never started', async () => {
  const response = await solve(paramsOf(small(), { ownedItems: ['a', ''], precisionRequest: 'auto', objectiveTolerance: 1e-7 }));
  const { solve_time_ms, ...rest } = response;
  assert.ok(solve_time_ms >= 0);
  assert.deepEqual(rest, {
    status: 'incomplete',
    precision_request: 'auto',
    precision_resolved: null,
    model_qualification: null,
    moa_qualification: null,
    physical_certificate: 'none',
    selected_items: [],
    selected_item_ids: [],
    slot_pairs: [],
    objective_value: null,
    optimization: { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-7, nodes: 0, termination: 'limit' },
    reason: 'Invalid owned_items format',
  });
  // a Tchebycheff request that supplies a table does not echo it: no table was used
  const table = { zE: 1, nadE: 0, zR: 0, nadR: 0, zP: 1, nadP: 0 };
  assert.equal((await solve(paramsOf(small(), { ownedItems: [''], useTchebycheff: true, idealPoint: table }))).ideal_point, undefined);
  // the MOA qualification is the request's, even before the model runs
  assert.equal((await solve(paramsOf(small(), { ownedItems: [''], maxMOA: 3 }))).moa_qualification, 'provisional_model');
});

test('precision_request echoes what was asked and precision_resolved says what ran: an Auto request resolved by the caller, and a Fast request for TrueErgo that must run Precise', async () => {
  const lookup = small();
  const precise = await solve(paramsOf(lookup, { preciseMode: true }));
  assert.deepEqual([precise.precision_request, precise.precision_resolved], ['precise', 'precise']);
  const fast = await solve(paramsOf(lookup, { preciseMode: false }));
  assert.deepEqual([fast.precision_request, fast.precision_resolved], ['fast', 'fast']);
  const auto = await solve(paramsOf(lookup, { preciseMode: false, precisionRequest: 'auto' }));
  assert.deepEqual([auto.precision_request, auto.precision_resolved, auto.model_qualification], ['auto', 'fast', 'approximate']);
  // The Fast model has no TED rows: a TrueErgo request runs Precise whatever was asked, and the response says so (never labelled Fast).
  for (const request of [{ useTrueErgo: true }, { preventOverswing: true }]) {
    const ted = await solve(paramsOf(lookup, { preciseMode: false, ergoWeight: 100, ...request }));
    assert.equal(ted.precision_request, 'fast');
    assert.equal(ted.precision_resolved, 'precise');
    assert.equal(ted.model_qualification, 'exact');
    assert.equal(ted.status, 'optimal', ted.reason);
  }
});

test('the Tchebycheff result reports the payoff table it used on every response that used one: computed, supplied, MOA-dependent, Fast, and a stop after the table', async () => {
  const table = { zE: 500, nadE: 0, zR: -300, nadR: 0, zP: 5010, nadP: 5100 };
  const params = paramsOf(payoff(), { ergoWeight: 34, recoilWeight: 33, priceWeight: 33, useTchebycheff: true });
  const computed = await solve(params);
  assert.deepEqual(computed.ideal_point, table);
  assert.deepEqual(computed.ideal_point, await computeIdealPoint(params), 'the reported table is the one three single-axis solves give');
  assert.deepEqual((await solve({ ...params, idealPoint: table })).ideal_point, table);
  assert.deepEqual((await solve({ ...params, maxMOA: 100 })).ideal_point, table);
  assert.deepEqual((await solve({ ...params, preciseMode: false })).ideal_point, table);
  // a response under a supplied table that stops before the search still reports the table the request carried
  const stopped = await solve({ ...params, idealPoint: table, maxSpatialNodes: 0, useTrueErgo: true });
  assert.equal(stopped.status, 'incomplete');
  assert.deepEqual(stopped.ideal_point, table);
  // a weighted request used none
  assert.equal((await solve(paramsOf(payoff()))).ideal_point, undefined);
});
