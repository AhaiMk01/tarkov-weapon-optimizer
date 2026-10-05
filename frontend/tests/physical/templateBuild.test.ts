// A template-level selection as a rooted physical build (src/solver/physical/templateBuild.ts): the mapping of the Fast model's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFromTemplates, preparePhysicalValidator } from '../../src/solver/physical';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';

const NAKED = { kind: 'naked' } as const;

test('a selection is placed from the root outward with path-derived instance ids, and the validator accepts it', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host']), slot('stock', ['butt'])] }),
    ['host', mod('host', { slots: [slot('rail', ['sight'])] })],
    ['sight', mod('sight', { ergo: 3 })],
    ['butt', mod('butt', { ergo: 2 })],
  );
  const { build, unplaced } = buildFromTemplates(lookup, WEAPON, ['sight', 'butt', 'host'], NAKED);
  assert.deepEqual(unplaced, []);
  assert.deepEqual(build.placements.map(p => p.childInstanceId).sort(), [
    'weapon_0/mount:host', 'weapon_0/mount:host/rail:sight', 'weapon_0/stock:butt',
  ]);
  const sight = build.placements.find(p => p.itemId === 'sight');
  assert.equal(sight?.parentInstanceId, 'weapon_0/mount:host');
  assert.equal(preparePhysicalValidator(lookup, { weaponId: WEAPON }, { requirePathInstanceIds: true }).validate(build).ok, true);
});

test('a part no rooted owner can hold stays unplaced: a child whose host is not selected, and a cycle that is not rooted', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('mount', ['host'])] }),
    ['host', mod('host', { slots: [slot('rail', ['sight'])] })],
    ['sight', mod('sight')],
    ['loopA', mod('loopA', { slots: [slot('a', ['loopB'])] })],
    ['loopB', mod('loopB', { slots: [slot('b', ['loopA'])] })],
  );
  assert.deepEqual(buildFromTemplates(lookup, WEAPON, ['sight'], NAKED).unplaced, ['sight']);
  assert.deepEqual(buildFromTemplates(lookup, WEAPON, ['loopA', 'loopB'], NAKED).unplaced, ['loopA', 'loopB'], 'two parts that only mount on each other are not rooted');
});

test('a required slot is served before an optional one: a part wanted for the required slot of a later owner is not spent on an earlier optional slot', () => {
  // `part` fits the optional slot `opt` of the receiver and the required slot `need` of `host`; `host` sits in the receiver's `mount` slot.
  // Visiting the receiver's slots in order would put `part` into `opt` and leave host's required slot empty.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('opt', ['part']), slot('mount', ['host'])] }),
    ['host', mod('host', { slots: [slot('need', ['part'], true)] })],
    ['part', mod('part', { ergo: 4 })],
  );
  const { build, unplaced } = buildFromTemplates(lookup, WEAPON, ['host', 'part'], NAKED);
  assert.deepEqual(unplaced, []);
  assert.equal(build.placements.find(p => p.itemId === 'part')?.slotId, 'need');
  assert.equal(preparePhysicalValidator(lookup, { weaponId: WEAPON }, { requirePathInstanceIds: true }).validate(build).ok, true);
});

test('the base is carried unchanged, an unknown id is unplaced, and an empty selection is an empty build', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('mount', ['host'])] }), ['host', mod('host')]);
  assert.deepEqual(buildFromTemplates(lookup, WEAPON, [], { kind: 'preset', presetId: 'p' }).build, { base: { kind: 'preset', presetId: 'p' }, placements: [] });
  assert.deepEqual(buildFromTemplates(lookup, WEAPON, ['ghost'], NAKED).unplaced, ['ghost']);
});
