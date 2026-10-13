// Seam: toFixture.ts presets -- factory presets as bases with count-bearing component supply and their own offers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFixture, type ReferenceFixture, type ReferencePreset } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');

const M4A1 = '5447a9cd4bdc2dbd208b4567';
const M4A1_PRESET_2X_RAIL = '5a32808386f774764a3226d9'; // components include 2 x VLTOR CASV 4-inch rail and 60 x 5.56 FMJ
const SV98 = '55801eed4bdc2d89578b4588';
const SV98_PRESET = '629766c15c9e3c392f7c2db0'; // 2 x CNC Guns keymod 2-inch rail
const CNC_RAIL_2IN = '623c2f652febb22c2777d8d7';
const VLTOR_RAIL_4IN = '59e0be5d86f7742d48765bd2';
const FMJ_556 = '59e6920f86f77411d82aa167';
const AK74N = '5644bd2b4bdc2d3b4c8b4572';
const AK74N_PRESET = '5841474424597759ba49be91';

const presetOf = (fixture: ReferenceFixture, id: string): ReferencePreset => {
  const found = fixture.presets?.find(p => p.id === id);
  assert.ok(found, `preset ${id} is in the fixture`);
  return found;
};

test('every preset the gun lists is mapped, in source order, bound to the receiver', () => {
  const { fixture, provenance } = fixtureForWeapon(world, M4A1);
  const rawIds = world.items.get(M4A1)?.presetIds ?? [];
  assert.equal(rawIds.length, 19);
  assert.deepEqual(fixture.presets?.map(p => p.id), rawIds);
  assert.ok(fixture.presets?.every(p => p.weaponId === M4A1));
  assert.equal(provenance.closure.presets, 19);
  assert.equal(provenance.closure.presetComponentEntries, rawIds.reduce((n, id) => n + (world.items.get(id)?.components.length ?? 0), 0));
});

test('preset component counts are preserved verbatim, entry for entry, for every gun preset of several weapons', () => {
  for (const gunId of [M4A1, SV98, AK74N]) {
    const { fixture } = fixtureForWeapon(world, gunId);
    for (const presetId of world.items.get(gunId)?.presetIds ?? []) {
      assert.deepEqual(
        presetOf(fixture, presetId).components,
        world.items.get(presetId)?.components.map(c => ({ itemId: c.itemId, count: c.count })),
        presetId,
      );
    }
  }
});

test('a real count-2 mod component stays 2 (and a real 60-round ammunition entry stays 60)', () => {
  // items.json: SV-98 preset 629766c1... lists "cnc-guns-keymod-2-inch-rail" with count 2.
  const sv98 = presetOf(fixtureForWeapon(world, SV98).fixture, SV98_PRESET);
  assert.deepEqual(sv98.components.filter(c => c.itemId === CNC_RAIL_2IN), [{ itemId: CNC_RAIL_2IN, count: 2 }]);
  // M4A1 preset 5a328083...: 2 x VLTOR 4-inch rail and 60 x 5.56x45 FMJ.
  const m4a1 = presetOf(fixtureForWeapon(world, M4A1).fixture, M4A1_PRESET_2X_RAIL);
  assert.deepEqual(m4a1.components.filter(c => c.itemId === VLTOR_RAIL_4IN), [{ itemId: VLTOR_RAIL_4IN, count: 2 }]);
  assert.deepEqual(m4a1.components.filter(c => c.itemId === FMJ_556), [{ itemId: FMJ_556, count: 60 }]);
  // The receiver itself is a component (count 1) and is not turned into an installable item.
  assert.deepEqual(m4a1.components.filter(c => c.itemId === M4A1), [{ itemId: M4A1, count: 1 }]);
});

test('components outside the installable closure (ammunition) become inert supply-only items, recorded in provenance', () => {
  const { fixture, provenance } = fixtureForWeapon(world, M4A1);
  assert.ok(provenance.supplyOnlyItemIds.includes(FMJ_556));
  assert.ok(fixture.items.some(i => i.id === FMJ_556));
  assert.ok(!provenance.supplyOnlyItemIds.includes(M4A1));
  assert.ok(!fixture.items.some(i => i.id === M4A1));
  // inert: no slot of the receiver or of any item allows it
  const allowedAnywhere = [...fixture.weapons, ...fixture.items].some(owner => owner.slots?.some(s => s.allowedItemIds.includes(FMJ_556)));
  assert.equal(allowedAnywhere, false);
  assert.deepEqual(checkFixture(fixture), []);
});

test('preset offers: trader cash, the synthesized flea offer with its player-level gate, and no flea for noFlea presets', () => {
  // items.json SV-98 preset: jaeger L3 priceRUB 111746; flea avg24hPrice = lastLowPrice = 99999, minLevelForFlea 20.
  assert.deepEqual(presetOf(fixtureForWeapon(world, SV98).fixture, SV98_PRESET).offers, [
    { kind: 'trader', trader: 'jaeger', level: 3, price: 111746 },
    { kind: 'flea', price: 99999, minPlayerLevel: 20 },
  ]);
  // AK-74N preset: prapor L2 priceRUB 44791; flea avg24hPrice 43913 (lastLowPrice 28450 is ignored), minLevelForFlea 25.
  assert.deepEqual(presetOf(fixtureForWeapon(world, AK74N).fixture, AK74N_PRESET).offers, [
    { kind: 'trader', trader: 'prapor', level: 2, price: 44791 },
    { kind: 'flea', price: 43913, minPlayerLevel: 25 },
  ]);
  // M4A1 preset 5a328083...: noFlea, no trader offer, no barter -> an inaccessible base with no offers at all.
  assert.deepEqual(presetOf(fixtureForWeapon(world, M4A1).fixture, M4A1_PRESET_2X_RAIL).offers, []);
});
