// Seam: slice.ts -- sliceFixture(fixture, { keepItemIds, keepPresetIds? }) builds a derived real-data micro-domain.
//
// Semantics under test: a dropped item is ABSENT from the domain (removed from every allowlist), required slots
// stay required, and everything removed is recorded. A slice is a derived domain, never the full weapon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFixture, runOracle, type ReferenceFixture, type ReferenceItem, type ReferenceSlot } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { fixtureForWeapon } from './toFixture';
import { sliceFixture, SliceError } from './slice';

const trader = (price = 100) => [{ kind: 'trader' as const, trader: 'prapor', level: 1, price }];
const slot = (id: string, allowedItemIds: string[], required = false): ReferenceSlot => ({ id, allowedItemIds, required });
const item = (id: string, over: Partial<ReferenceItem> = {}): ReferenceItem => ({ id, offers: trader(), ...over });

function fixtureOf(): ReferenceFixture {
  return {
    schemaVersion: 1,
    description: 'hand-built',
    items: [
      item('a', { slots: [slot('sa', ['c', 'd'], true)], conflictingItemIds: ['b', 'd', 'a'] }),
      item('b', { ergonomics: 2 }),
      item('c', { ergonomics: 3, slots: [slot('sc', ['e'])] }),
      item('d', { ergonomics: 1 }),
      item('e', { ergonomics: 5 }),
    ],
    weapons: [{ id: 'gun', offers: trader(1000), slots: [slot('s1', ['a', 'b']), slot('s2', ['b', 'e'], true)] }],
    presets: [
      { id: 'p1', weaponId: 'gun', components: [{ itemId: 'gun', count: 1 }, { itemId: 'a', count: 1 }, { itemId: 'e', count: 2 }, { itemId: 'b', count: 3 }], offers: trader(5000) },
      { id: 'p2', weaponId: 'gun', components: [{ itemId: 'd', count: 1 }], offers: trader(6000) },
    ],
  };
}

const clone = <T>(x: T): T => structuredClone(x);
const idsOf = (f: ReferenceFixture) => f.items.map(i => i.id);

test('keeps only the named items, filtering every allowlist and keeping order and required flags', () => {
  const { fixture } = sliceFixture(fixtureOf(), { keepItemIds: ['a', 'c', 'e'] });
  assert.deepEqual(idsOf(fixture), ['a', 'c', 'e']);
  assert.deepEqual(fixture.weapons[0].slots, [slot('s1', ['a']), slot('s2', ['e'], true)]);
  assert.deepEqual(fixture.items[0].slots, [slot('sa', ['c'], true)]);
  assert.deepEqual(fixture.items[1].slots, [slot('sc', ['e'])]);
  assert.deepEqual(checkFixture(fixture), []);
});

test('provenance records exactly what was removed: items, allowlist entries, presets, preset components, conflict entries', () => {
  const { provenance } = sliceFixture(fixtureOf(), { keepItemIds: ['a', 'c', 'e'], keepPresetIds: ['p1'] });
  assert.deepEqual(provenance.kept, { itemIds: ['a', 'c', 'e'], presetIds: ['p1'] });
  assert.deepEqual(provenance.removed.itemIds, ['b', 'd']);
  assert.deepEqual(provenance.removed.presetIds, ['p2']);
  assert.deepEqual(provenance.removed.allowlistEntries, [
    { ownerId: 'gun', slotId: 's1', itemId: 'b' },
    { ownerId: 'gun', slotId: 's2', itemId: 'b' },
    { ownerId: 'a', slotId: 'sa', itemId: 'd' },
  ]);
  assert.deepEqual(provenance.removed.presetComponents, [{ presetId: 'p1', itemId: 'b', count: 3 }]);
  // a lists b and d (removed: a conflict with an absent item is vacuous) and itself (kept: the copy cap)
  assert.deepEqual(provenance.removed.conflictEntries, [{ ownerId: 'a', itemId: 'b' }, { ownerId: 'a', itemId: 'd' }]);
  assert.equal(provenance.claim, 'derived micro-domain, not the full weapon');
});

test('the self-conflict of a kept item survives the slice', () => {
  const { fixture } = sliceFixture(fixtureOf(), { keepItemIds: ['a', 'c', 'e'] });
  assert.deepEqual(fixture.items[0].conflictingItemIds, ['a']);
});

test('preset supply keeps the receiver component and the counts of kept items; keepPresetIds drops presets', () => {
  const { fixture } = sliceFixture(fixtureOf(), { keepItemIds: ['a', 'e'], keepPresetIds: ['p1'] });
  assert.deepEqual(fixture.presets?.map(p => p.id), ['p1']);
  assert.deepEqual(fixture.presets?.[0].components, [{ itemId: 'gun', count: 1 }, { itemId: 'a', count: 1 }, { itemId: 'e', count: 2 }]);
  assert.deepEqual(fixture.presets?.[0].offers, trader(5000));
  assert.deepEqual(sliceFixture(fixtureOf(), { keepItemIds: ['a'] }).fixture.presets?.map(p => p.id), ['p1', 'p2']); // default keeps all
  assert.deepEqual(sliceFixture(fixtureOf(), { keepItemIds: ['a'], keepPresetIds: [] }).fixture.presets, []);
});

test('a required slot that loses every candidate stays required, so the weapon has no build (and it is flagged)', () => {
  const { fixture, provenance } = sliceFixture(fixtureOf(), { keepItemIds: ['b'] });
  assert.deepEqual(fixture.weapons[0].slots, [slot('s1', ['b']), slot('s2', ['b'], true)]);
  assert.deepEqual(provenance.emptiedRequiredSlots, []);
  const emptied = sliceFixture(fixtureOf(), { keepItemIds: ['a', 'b'] });
  // a's required slot sa lost both candidates: a can never be installed, which empties only the paths through a
  assert.deepEqual(emptied.provenance.emptiedRequiredSlots, [{ ownerId: 'a', slotId: 'sa' }]);
  const result = runOracle(emptied.fixture, { weapon_id: 'gun' });
  assert.equal(result.complete, true);
  assert.equal(result.empty, false); // the receiver can still be completed with b: required-slot emptiness is conditional
  assert.ok(result.builds.every(b => b.build.placements.every(p => p.itemId !== 'a')));
  const dead = sliceFixture(fixtureOf(), { keepItemIds: ['a'] });
  assert.deepEqual(dead.provenance.emptiedRequiredSlots, [{ ownerId: 'gun', slotId: 's2' }, { ownerId: 'a', slotId: 'sa' }]); // weapons first
  assert.equal(runOracle(dead.fixture, { weapon_id: 'gun' }).empty, true); // the receiver's own required slot has no candidate
});

test('kept items that no kept allowlist reaches any more are reported as unreachable', () => {
  const { provenance } = sliceFixture(fixtureOf(), { keepItemIds: ['c', 'e'] });
  // c is allowed only by a's slot (a dropped): unreachable; e stays reachable through the receiver slot s2
  assert.deepEqual(provenance.unreachableKeptItemIds, ['c']);
});

test('slicing keeps everything it is not told to drop: the full item list is the identity', () => {
  const original = fixtureOf();
  const { fixture, provenance } = sliceFixture(original, { keepItemIds: idsOf(original) });
  assert.deepEqual({ ...fixture, description: undefined }, { ...original, description: undefined });
  assert.deepEqual(provenance.removed, { itemIds: [], presetIds: [], allowlistEntries: [], presetComponents: [], conflictEntries: [] });
});

test('the input fixture is never mutated and the slice shares no mutable structure with it', () => {
  const original = fixtureOf();
  const snapshot = clone(original);
  const { fixture } = sliceFixture(original, { keepItemIds: ['a', 'c', 'e'] });
  assert.deepEqual(original, snapshot);
  fixture.items[0].slots?.[0].allowedItemIds.push('zzz');
  fixture.items[0].offers?.push({ kind: 'flea', price: 1 });
  assert.deepEqual(original, snapshot);
});

test('the slice description says it is derived', () => {
  assert.match(sliceFixture(fixtureOf(), { keepItemIds: ['a'] }).fixture.description ?? '', /^Derived micro-domain \(slice\) of: hand-built/);
});

test('unknown ids, weapon ids and unknown presets are slice errors, never silently ignored', () => {
  assert.throws(() => sliceFixture(fixtureOf(), { keepItemIds: ['nope'] }), (e: unknown) => e instanceof SliceError && /nope/.test(e.message));
  assert.throws(() => sliceFixture(fixtureOf(), { keepItemIds: ['gun'] }), (e: unknown) => e instanceof SliceError && /weapon/.test(e.message));
  assert.throws(() => sliceFixture(fixtureOf(), { keepItemIds: ['a'], keepPresetIds: ['nope'] }), (e: unknown) => e instanceof SliceError && /nope/.test(e.message));
});

// --- real data ----------------------------------------------------------------------------------

const { world } = loadPinnedWorld('en');

test('a real SV-98 slice is a valid, small, exhaustively enumerable fixture and records what it dropped', () => {
  const SV98 = '55801eed4bdc2d89578b4588';
  const keep = [
    '623b2e9d11c3296b440d1638', // CNC Guns SV-98 chassis (required mod_stock of the receiver)
    '623c3be0484b5003161840dc', // AGR-47 pistol grip FDE (required by the chassis)
    '623c3c1f37b4b31470357737', // keymod handguard
    '623c2f652febb22c2777d8d7', // CNC keymod 2-inch rail
  ];
  const full = fixtureForWeapon(world, SV98).fixture;
  const { fixture, provenance } = sliceFixture(full, { keepItemIds: keep, keepPresetIds: ['629766c15c9e3c392f7c2db0'] });
  assert.deepEqual(checkFixture(fixture), []);
  assert.deepEqual(provenance.kept.itemIds, [...keep].sort());
  assert.equal(provenance.removed.itemIds.length, full.items.length - keep.length);
  assert.equal(provenance.removed.presetIds.length, (full.presets?.length ?? 0) - 1);
  assert.deepEqual(provenance.emptiedRequiredSlots, []);
  const result = runOracle(fixture, { weapon_id: SV98, flea_available: false });
  assert.equal(result.complete, true);
  assert.equal(result.empty, false);
  assert.ok(result.examined <= 20, `a micro-domain: ${result.examined} builds examined`);
});
