// Decoding a Fast solution into a rooted occurrence tree (src/solver/physical/decodeFast.ts), on hand-built models and hand-written column values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFast, preparePhysicalWeapon, preparePhysicalValidator, prepareSubproblemDomain, specializeFast, type FastModel, type SubproblemRequest, type SpecializeRequest,
} from '../../src/solver/physical';
import type { ItemLookup } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';

function fast(lookup: ItemLookup, request: SpecializeRequest & SubproblemRequest = {}): FastModel {
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  return specializeFast(blueprint, prepareSubproblemDomain(blueprint, lookup, request), request);
}

/** Column values of a model: every decision column 0 unless named, bases chosen by index. */
function point(model: FastModel, edges: Record<string, number>, base = 0): Record<string, number> {
  const values: Record<string, number> = {};
  for (const d of model.decision) values[d.name] = 0;
  for (let b = 0; b < model.domain.bases.length; b++) values[model.base(b)] = b === base ? 1 : 0;
  const idOf = (t: number): string => model.blueprint.templateIds[t];
  for (const edge of model.edges) {
    const key = `${edge.slot.slotId}>${idOf(edge.child)}`;
    if (key in edges) values[edge.column] = edges[key];
  }
  for (const key of Object.keys(edges)) assert.ok(model.edges.some(e => `${e.slot.slotId}>${model.blueprint.templateIds[e.child]}` === key), `no edge ${key}`);
  return values;
}

test('a count point becomes a rooted tree with path-derived instances: copies below one host take its slots, siblings are distinct instances', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('m1', ['host']), slot('m2', ['host']), slot('top', ['a'])] }),
    ['host', mod('host', { slots: [slot('left', ['a']), slot('right', ['a'])] })],
    ['a', mod('a')],
  );
  const model = fast(lookup);
  const decoded = decodeFast(model, point(model, { 'm1>host': 1, 'm2>host': 1, 'left>a': 2, 'right>a': 1, 'top>a': 1 }));
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.build.placements.map(p => p.childInstanceId).sort(), [
    'weapon_0/m1:host', 'weapon_0/m1:host/left:a', 'weapon_0/m1:host/right:a',
    'weapon_0/m2:host', 'weapon_0/m2:host/left:a',
    'weapon_0/top:a',
  ]);
  assert.deepEqual(decoded.build.base, { kind: 'naked' });
  assert.equal(preparePhysicalValidator(lookup, { weaponId: WEAPON }, { requirePathInstanceIds: true }).validate(decoded.build).ok, true);
});

test('the base is the selected accessible base: a preset is carried by id, and exactly one base must be selected', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 1 }] }] }), ['a', mod('a')]);
  const model = fast(lookup);
  const preset = decodeFast(model, point(model, {}, 1));
  assert.equal(preset.ok && preset.baseIndex, 1);
  assert.deepEqual(preset.ok && preset.build.base, { kind: 'preset', presetId: 'P' });
  const none = point(model, {});
  none[model.base(0)] = 0;
  assert.throws(() => decodeFast(model, none), /No base is selected/);
  const two = point(model, {});
  two[model.base(1)] = 1;
  assert.throws(() => decodeFast(model, two), /More than one base/);
});

test('a column that is missing or not an integer is a solver fault (a typed error), a value within the reading tolerance is read as its integer', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a'])] }), ['a', mod('a')]);
  const model = fast(lookup);
  const values = point(model, { 's1>a': 1 });
  const column = model.edges.find(e => e.slot.slotId === 's1')!.column;
  assert.equal(decodeFast(model, { ...values, [column]: 1 - 1e-7 }).ok, true);
  assert.throws(() => decodeFast(model, { ...values, [column]: 0.5 }), /not an integer/);
  assert.throws(() => decodeFast(model, { ...values, [column]: 5 }), /not an integer within/);
  const missing = { ...values };
  delete missing[column];
  assert.throws(() => decodeFast(model, missing), /missing from the solution/);
  assert.throws(() => decodeFast(model, { ...values, [column]: Number.NaN }), /missing from the solution/);
});

test('an empty domain has nothing to decode', () => {
  const lookup = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  assert.throws(() => decodeFast(fast(lookup), {}), /domain is empty/);
});

test('a count point that is no tree is rejected, not repaired: a floating cycle, and a chain that would repeat an ancestor', () => {
  // A and B can host each other; the root fits both.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s0', ['A']), slot('s1', ['B'])] }),
    ['A', mod('A', { slots: [slot('toB', ['B'])] })],
    ['B', mod('B', { slots: [slot('toA', ['A'])] })],
  );
  const model = fast(lookup);
  // Floating cycle: B below A and A below B with nothing at the root.
  const floating = decodeFast(model, point(model, { 'toB>B': 1, 'toA>A': 1 }));
  assert.equal(floating.ok, false);
  assert.match(floating.ok ? '' : floating.reason, /not reachable from the receiver/);
  // Chain root -> A -> B -> A: the second A repeats its ancestor.
  const chain = decodeFast(model, point(model, { 's0>A': 1, 'toB>B': 1, 'toA>A': 1 }));
  assert.equal(chain.ok, false);
  // The valid arrangement of the same two parts decodes: A at the root with B below, B at the root with A below.
  const valid = decodeFast(model, point(model, { 's0>A': 1, 's1>B': 1, 'toB>B': 1, 'toA>A': 1 }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.ok && valid.build.placements.map(p => p.childInstanceId).sort(), [
    'weapon_0/s0:A', 'weapon_0/s0:A/toB:B', 'weapon_0/s1:B', 'weapon_0/s1:B/toA:A',
  ]);
});

test('the decode is deterministic: the same point gives the same placements in the same order', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b']), slot('s3', ['a', 'b'])] }), ['a', mod('a')], ['b', mod('b')]);
  const model = fast(lookup);
  const values = point(model, { 's1>a': 1, 's2>b': 1, 's3>a': 1 });
  const first = decodeFast(model, values);
  const second = decodeFast(model, values);
  assert.deepEqual(first, second);
  assert.deepEqual(first.ok && first.build.placements.map(p => p.itemId), ['a', 'b', 'a']);
});
