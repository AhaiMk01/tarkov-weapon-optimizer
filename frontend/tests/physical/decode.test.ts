// decodeSolution: robust binary reads, typed decode errors, exact allocation (preset, owned, paid in code-unit instanceId order) and spend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnValuesFromStructured, PhysicalModelError, type AcquisitionOffer } from '../../src/solver/physical';
import { cheapestLotCover, decodeSolution } from './occurrence/decodeOccurrence';
import { barter, gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';
import { prepare } from './lpHarness';

const isDecodeError = (e: unknown): boolean => e instanceof PhysicalModelError && e.code === 'DECODE_FAILED';

/** A solution vector: every decision column 0 except the named ones (instance ids resolve to occurrences). */
function vector(prepared: ReturnType<typeof prepare>, base: number, installed: readonly string[], overrides: Record<string, number> = {}): Record<string, number> {
  const { model, blueprint } = prepared;
  const values: Record<string, number> = {};
  prepared.domain.bases.forEach((_, b) => { values[model.columns.base(b)] = b === base ? 1 : 0; });
  for (const v of model.columns.activeOccurrences) values[model.columns.occurrence(v) as string] = 0;
  for (const id of installed) {
    const v = blueprint.occurrenceByInstanceId(id);
    assert.ok(v > 0, `${id} names an occurrence`);
    values[model.columns.occurrence(v) as string] = 1;
  }
  return { ...values, ...overrides };
}

const pair = () => lookupOf(
  gun(WEAPON, { slots: [slot('s', ['a'])] }),
  ['a', mod('a', { ergo: 1 })],
);

test('binary columns are read robustly: values within 1e-5 of 0 or 1 are integral', () => {
  const prepared = prepare(pair(), WEAPON);
  const column = prepared.model.columns.occurrence(1) as string;
  const build = decodeSolution(prepared.model, vector(prepared, 0, [], { [column]: 0.999999, base_0: 1.000001 }));
  assert.equal(build.placements.length, 1);
  const none = decodeSolution(prepared.model, vector(prepared, 0, [], { [column]: 4e-6 }));
  assert.equal(none.placements.length, 0);
});

test('anything that is not integral is a typed decode error, never a guess', () => {
  const prepared = prepare(pair(), WEAPON);
  const column = prepared.model.columns.occurrence(1) as string;
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 0, [], { [column]: 0.5 })), isDecodeError);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 0, [], { [column]: 1.0001 })), isDecodeError);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 0, [], { [column]: 2 })), isDecodeError);
  const missing = vector(prepared, 0, []);
  delete missing[column];
  assert.throws(() => decodeSolution(prepared.model, missing), isDecodeError);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 0, [], { base_0: Number.NaN })), isDecodeError);
});

test('exactly one base must be chosen', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['a'])], presets: [{ id: 'P', items: [] }] }),
    ['a', mod('a')],
  );
  const prepared = prepare(lookup, WEAPON);
  assert.equal(prepared.domain.bases.length, 2);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 0, [], { base_1: 1 })), isDecodeError);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, -1, [])), isDecodeError);
  assert.equal(decodeSolution(prepared.model, vector(prepared, 1, [])).base.kind, 'preset');
});

test('an installed child whose parent is not installed is a decode error', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('g', ['p'])] }),
    ['p', mod('p', { slots: [slot('c', ['k'])] })],
    ['k', mod('k')],
  );
  const prepared = prepare(lookup, WEAPON);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 0, ['weapon_0/g:p/c:k'])), isDecodeError);
  assert.equal(decodeSolution(prepared.model, vector(prepared, 0, ['weapon_0/g:p', 'weapon_0/g:p/c:k'])).placements.length, 2);
});

test('a decoded placement list names the parent instance, the template slot, the child instance and the template', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('g', ['p'])] }),
    ['p', mod('p', { slots: [slot('c', ['k'])] })],
    ['k', mod('k')],
  );
  const prepared = prepare(lookup, WEAPON);
  const build = decodeSolution(prepared.model, vector(prepared, 0, ['weapon_0/g:p', 'weapon_0/g:p/c:k']));
  assert.deepEqual(build.placements, [
    { parentInstanceId: 'weapon_0', slotId: 'g', childInstanceId: 'weapon_0/g:p', itemId: 'p' },
    { parentInstanceId: 'weapon_0/g:p', slotId: 'c', childInstanceId: 'weapon_0/g:p/c:k', itemId: 'k' },
  ]);
  assert.deepEqual([...build.installed], [['k', 1], ['p', 1]]);
});

test('allocation runs in code-unit instanceId order, not creation order: the slot named `a` takes the preset copy before `b`', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('b', ['x']), slot('a', ['x'])], presets: [{ id: 'P', items: [{ itemId: 'x', count: 1 }] }] }),
    ['x', mod('x', { offers: [trader('prapor', 1, 70)] })],
  );
  const prepared = prepare(lookup, WEAPON);
  const build = decodeSolution(prepared.model, vector(prepared, 1, ['weapon_0/b:x', 'weapon_0/a:x']));
  assert.deepEqual(build.acquisition.map(o => [o.instanceId, o.source, o.price]), [
    ['weapon_0/a:x', 'preset', 0],
    ['weapon_0/b:x', 'offer', 70],
  ]);
  assert.equal(build.spend, 1000 + 70);
  assert.equal(build.deficits.get('x'), 1);
});

test('preset first, owned second, paid last, across several copies, and the spend is base + the exact cover', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: ['s1', 's2', 's3', 's4'].map(id => slot(id, ['x'])), presets: [{ id: 'P', items: [{ itemId: 'x', count: 1 }] }] }),
    ['x', mod('x', { offers: [trader('prapor', 1, 100)] })],
  );
  const prepared = prepare(lookup, WEAPON, { ownedItems: ['x', 'x'] });
  const build = decodeSolution(prepared.model, vector(prepared, 1, ['s1', 's2', 's3', 's4'].map(id => `weapon_0/${id}:x`)));
  assert.deepEqual(build.acquisition.map(o => [o.source, o.price]), [['preset', 0], ['owned', 0], ['owned', 0], ['offer', 100]]);
  assert.equal(build.deficits.get('x'), 1);
  assert.equal(build.modSpend, 100);
  assert.equal(build.spend, 1100);
});

test('a copy past the supply of a template with no legal offer cannot be decoded', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['c']), slot('s2', ['c'])], presets: [{ id: 'P', items: [{ itemId: 'c', count: 1 }] }] }),
    ['c', mod('c', { offers: [] })],
  );
  const prepared = prepare(lookup, WEAPON);
  assert.throws(() => decodeSolution(prepared.model, vector(prepared, 1, ['weapon_0/s1:c', 'weapon_0/s2:c'])), isDecodeError);
});

test('an empty domain has no build to decode', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('r', [], true)] }));
  const prepared = prepare(lookup, WEAPON);
  assert.throws(() => decodeSolution(prepared.model, {}), isDecodeError);
});

test('column values come from the structured native result: names and full-precision primals, nothing without a solution', () => {
  assert.deepEqual(columnValuesFromStructured(['a', 'd'], Float64Array.of(1, 0.1 + 0.2)), { a: 1, d: 0.1 + 0.2 });
  assert.deepEqual(columnValuesFromStructured(null, null), {});
  assert.throws(() => columnValuesFromStructured(['a'], [1, 2]), isDecodeError);
});

const offer = (index: number, price: number, lotSize: number, source = `o${index}`): AcquisitionOffer => ({ index, source, price, lotSize });

test('the cheapest whole-lot cover is exact: lots are bought whole, ties keep the earlier offer, surplus is unused', () => {
  assert.deepEqual(cheapestLotCover([offer(0, 200, 1)], 0), { cost: 0, picks: [] });
  assert.equal(cheapestLotCover([], 1), null);
  // lot of 3 for 300 versus cash 200 each
  const mixed = [offer(0, 200, 1), offer(1, 300, 3)];
  assert.deepEqual(cheapestLotCover(mixed, 1), { cost: 200, picks: [0] });
  assert.deepEqual(cheapestLotCover(mixed, 2), { cost: 300, picks: [1] }); // one lot of three beats two cash units
  assert.deepEqual(cheapestLotCover(mixed, 4), { cost: 500, picks: [0, 1] }); // 3 + 1 = 300 + 200
  assert.deepEqual(cheapestLotCover([offer(0, 100, 2), offer(1, 100, 2)], 2), { cost: 100, picks: [0] }, 'an exact tie keeps the earlier offer');
  assert.deepEqual(cheapestLotCover([offer(0, 50, 30)], 31), { cost: 100, picks: [0, 0] }, 'a lot of 30 does not cover 31 units');
});

test('a barter lot is charged to the first unit it supplies, the rest ride free', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: ['s1', 's2', 's3'].map(id => slot(id, ['a'])) }),
    ['a', mod('a', { offers: [barter('mechanic', 1, 300, false, 2), trader('prapor', 1, 1000)] })],
  );
  const prepared = prepare(lookup, WEAPON, { barterAvailable: true });
  const build = decodeSolution(prepared.model, vector(prepared, 0, ['s1', 's2', 's3'].map(id => `weapon_0/${id}:a`)));
  // three units: two cash units cost 2000, a lot of 2 (300) plus one cash unit (1000) costs 1300, two lots of 2 cost 600.
  assert.equal(build.modSpend, 600);
  assert.deepEqual(build.acquisition.map(o => o.price), [300, 0, 300]);
  assert.deepEqual(build.purchases[0].lots.map(l => l.used), [2, 1]);
});
