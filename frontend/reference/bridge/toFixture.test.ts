// Seam: toFixture.ts -- fixtureForWeapon(world, weaponId, options?) maps the independent raw reader's
// world into the oracle's ReferenceFixture for one weapon's full reachable closure.
//
// Slice 1 (this block): receiver, items, exact weights, slot structure and conflicts.
// Later blocks in this file: offers, presets, provenance/defaults and defensive source checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFixture, fromBinary64, resolveFixture } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');

const M4A1 = '5447a9cd4bdc2dbd208b4567'; // Colt M4A1 5.56x45 assault rifle
const MOUNT_0155 = '688b54a11cef2a61d005273b'; // ELCAN SpecterDR mounting plate for Trijicon, raw weight token 0.0155
const SPECTER_SCOPE = '57ac965c24597706be5f975c'; // ELCAN SpecterDR 1x/4x scope: its mod_mount slot allows the plate

test('maps the M4A1 closure into a structurally valid oracle fixture', () => {
  const { fixture } = fixtureForWeapon(world, M4A1);
  assert.deepEqual(checkFixture(fixture), []);
  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(fixture.weapons.map(w => w.id), [M4A1]);
  assert.ok(fixture.items.length > 500, `closure has ${fixture.items.length} items`);
  assert.ok(resolveFixture(fixture).items.has(MOUNT_0155), 'the 0.0155 kg plate is inside the M4A1 closure');
});

test('receiver stats come from the gun properties exactly as the raw documents hold them', () => {
  // items.json: M4A1 weight 0.75, properties.ergonomics 48, recoilVertical 119, recoilHorizontal 342,
  // centerOfImpact 0.01, sightingRange 100; the gun has no `capacity` property (a default, see provenance tests).
  const { fixture } = fixtureForWeapon(world, M4A1);
  const weapon = fixture.weapons[0];
  assert.equal(weapon.weightKg, 0.75);
  assert.equal(weapon.ergonomics, 48);
  assert.equal(weapon.recoilVertical, 119);
  assert.equal(weapon.recoilHorizontal, 342);
  assert.equal(weapon.centerOfImpact, 0.01);
  assert.equal(weapon.sightingRange, 100);
  assert.equal(weapon.magazineCapacity, undefined);
});

test('the 0.0155 kg plate carries the exact binary64 of its raw token and decodes to the exact ratio', () => {
  const { fixture } = fixtureForWeapon(world, M4A1);
  const plate = fixture.items.find(i => i.id === MOUNT_0155);
  assert.ok(plate);
  assert.equal(world.items.get(MOUNT_0155)?.weight?.text, '0.0155'); // the raw JSON token
  assert.equal(plate.weightKg, Number('0.0155')); // the nearest binary64 to that token, passed through unchanged
  // Fraction(0.0155) in Python: 1116892707587883 / 2^56 -- the double's exact value, not 31/2000.
  assert.deepEqual(fromBinary64(plate.weightKg as number), { n: 1116892707587883n, d: 72057594037927936n });
});

test('the plate and its scope parent sit in the real slot structure (ids, required flags, allowlists)', () => {
  const { fixture } = fixtureForWeapon(world, M4A1);
  const scope = fixture.items.find(i => i.id === SPECTER_SCOPE);
  assert.ok(scope);
  const raw = world.items.get(SPECTER_SCOPE);
  assert.deepEqual(
    scope.slots,
    raw?.slots.map(s => ({ id: s.id, required: s.required, allowedItemIds: [...s.allowedItemIds] })),
  );
  assert.ok(scope.slots?.some(s => s.allowedItemIds.includes(MOUNT_0155)));
});
