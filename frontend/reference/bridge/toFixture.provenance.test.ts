// Seam: toFixture.ts provenance and defensive source checks.
//
//  * every default applied is recorded, and the recorded ids match an independent recomputation from raw;
//  * unknown, malformed or unrepresentable source data throws BridgeError (never an empty fixture);
//  * a non-empty slot filter list other than allowedItems fails loudly instead of being dropped.
//
// Defensive cases perturb a copy of the pinned world (a small pistol) so each rule is isolated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPinnedWorld } from '../source/pinnedWorld';
import type { RawWorld, RefBarter, RefItem, RefSlot, RefTraderOffer } from '../source/rawReader';
import { BridgeError, fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');

const M4A1 = '5447a9cd4bdc2dbd208b4567';
const MTS255 = '60db29ce99594040e04c4a27';
const RIP_AMMO = '5c0d591486f7744c505b416f';
const PLATE = '688b54a11cef2a61d005273b';
const MAKAROV = '579204f224597773d619e051'; // small closure: used for the perturbation tests
const MAKAROV_PRESET = '5841499024597759f825ff3e';
const PM_SLIDE = '6374a822e629013b9c0645c8'; // required mod_reciever of the Makarov
const PM_GRIP = '6374a7e7417239a7bf00f042'; // required mod_pistolgrip item (also in the preset)

// --- recorded defaults ------------------------------------------------------------------------

test('every field default is recorded with exactly the ids whose raw field is absent', () => {
  const { fixture, provenance } = fixtureForWeapon(world, M4A1);
  const idsOf = (scope: string, field: string) => provenance.defaults.find(d => d.scope === scope && d.field === field)?.ids ?? [];
  const sorted = (xs: string[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Items without a raw properties.centerOfImpact / capacity / sightingRange (derived from the raw reader).
  for (const [field, prop] of [['centerOfImpact', 'centerOfImpact'], ['magazineCapacity', 'capacity'], ['sightingRange', 'sightingRange']] as const) {
    const expected = fixture.items.filter(i => world.items.get(i.id)?.properties?.[prop] === undefined).map(i => i.id);
    assert.deepEqual(idsOf('item', field), sorted(expected), field);
    assert.ok(expected.length > 0 && expected.length < fixture.items.length, `${field} is a default for some items and a raw value for others`);
    for (const item of fixture.items) {
      assert.equal(item[field] === undefined, expected.includes(item.id), `${field} omitted exactly where defaulted (${item.id})`);
    }
  }
  // The M4A1 receiver has no capacity property: a documented default (0 rounds).
  assert.deepEqual(provenance.defaults.find(d => d.scope === 'weapon' && d.field === 'magazineCapacity'), {
    scope: 'weapon', field: 'magazineCapacity', value: 0, ids: [M4A1],
  });
  // No weight, receiver ergonomics or recoil is missing in the pinned capture, so none is recorded.
  assert.equal(provenance.defaults.some(d => d.field === 'weightKg'), false);
  assert.equal(provenance.defaults.some(d => d.scope === 'weapon' && d.field !== 'magazineCapacity'), false);
});

test('ammunition reached through camora slots gets every modifier default recorded, never an invented value', () => {
  const { fixture, provenance } = fixtureForWeapon(world, MTS255);
  assert.ok(provenance.nonModItemIds.includes(RIP_AMMO));
  const ammo = fixture.items.find(i => i.id === RIP_AMMO);
  assert.ok(ammo);
  assert.equal(ammo.ergonomics, undefined);
  assert.equal(ammo.recoilModifier, undefined); // properties.recoilModifier of ammunition is a different quantity, never a mod modifier
  assert.equal(ammo.accuracyModifier, undefined);
  for (const field of ['ergonomics', 'recoilModifier', 'accuracyModifier']) {
    assert.ok(provenance.defaults.find(d => d.scope === 'item' && d.field === field)?.ids.includes(RIP_AMMO), field);
  }
  assert.equal(world.items.get(RIP_AMMO)?.properties?.recoilModifier !== undefined, true);
});

test('the fixture is plain JSON: it survives a JSON round trip unchanged', () => {
  const { fixture, provenance } = fixtureForWeapon(world, MTS255);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture)), fixture);
  assert.deepEqual(JSON.parse(JSON.stringify(provenance)), provenance);
});

test('mapping is deterministic and language independent (the Chinese capture yields the same fixture)', () => {
  const zh = loadPinnedWorld('zh').world;
  const a = fixtureForWeapon(world, M4A1);
  const b = fixtureForWeapon(world, M4A1);
  const c = fixtureForWeapon(zh, M4A1);
  assert.deepEqual(a, b);
  assert.deepEqual(c.fixture, a.fixture);
  assert.deepEqual({ ...c.provenance, lang: 'en' }, a.provenance);
  assert.equal(c.provenance.lang, 'zh');
});

// --- defensive checks -------------------------------------------------------------------------

function patched(
  itemPatches: Record<string, (item: RefItem) => RefItem> = {},
  extra: { barters?: (b: readonly RefBarter[]) => RefBarter[] } = {},
): RawWorld {
  const items = new Map(world.items);
  for (const [id, patch] of Object.entries(itemPatches)) {
    const item = items.get(id);
    assert.ok(item, `patch target ${id} exists`);
    items.set(id, patch(item));
  }
  return { ...world, items, barters: extra.barters ? extra.barters(world.barters) : world.barters };
}

const withSlot0 = (patch: Partial<RefSlot>) => (item: RefItem): RefItem => ({
  ...item, slots: item.slots.map((s, i) => (i === 0 ? { ...s, ...patch } : s)),
});
const evidenceError = (pattern: RegExp) => (error: unknown) => error instanceof BridgeError && pattern.test(error.message);

test('the baseline Makarov mapping passes, so every perturbation below is the only cause of its failure', () => {
  assert.doesNotThrow(() => fixtureForWeapon(world, MAKAROV));
});

test('an unknown weapon id and a non-gun id are evidence errors', () => {
  assert.throws(() => fixtureForWeapon(world, 'ffffffffffffffffffffffff'), evidenceError(/not an item/));
  assert.throws(() => fixtureForWeapon(world, PLATE), evidenceError(/not a gun/));
});

for (const [name, patch] of [
  ['allowedCategories', { allowedCategoryIds: ['5448fe124bdc2da5018b4567'] }],
  ['excludedItems', { excludedItemIds: [PM_GRIP] }],
  ['excludedCategories', { excludedCategoryIds: ['5448fe124bdc2da5018b4567'] }],
] as const) {
  test(`a non-empty slot filter ${name} fails loudly instead of being dropped`, () => {
    assert.throws(() => fixtureForWeapon(patched({ [PM_SLIDE]: withSlot0(patch) }), MAKAROV), evidenceError(new RegExp(`${name}.*non-empty`)));
    assert.throws(() => fixtureForWeapon(patched({ [MAKAROV]: withSlot0(patch) }), MAKAROV), evidenceError(new RegExp(name)));
  });
}

test('a slot that allows the receiver itself is an evidence error (no ancestor-repetition to model, no silent drop)', () => {
  const w = patched({ [PM_SLIDE]: item => ({ ...item, slots: [{ ...item.slots[0], allowedItemIds: [...item.slots[0].allowedItemIds, MAKAROV] }, ...item.slots.slice(1)] }) });
  assert.throws(() => fixtureForWeapon(w, MAKAROV), evidenceError(/reaches the receiver itself/));
});

test('an unresolved allowed item id is an evidence error that names the slot', () => {
  assert.throws(
    () => fixtureForWeapon(patched({ [MAKAROV]: withSlot0({ allowedItemIds: ['ffffffffffffffffffffffff'] }) }), MAKAROV),
    evidenceError(/ffffffffffffffffffffffff.*unresolved|unresolved/),
  );
});

test('an absent weight is recorded as a defaulted field (omitted, then 0 kg in the oracle), never invented', () => {
  const w = patched({ [PM_GRIP]: item => ({ ...item, weight: null }) });
  const { fixture, provenance } = fixtureForWeapon(w, MAKAROV);
  assert.equal(fixture.items.find(i => i.id === PM_GRIP)?.weightKg, undefined);
  assert.deepEqual(provenance.defaults.find(d => d.field === 'weightKg'), { scope: 'item', field: 'weightKg', value: 0, ids: [PM_GRIP] });
});

test('a weight whose token does not decode to the stored binary64 is rejected', () => {
  const w = patched({ [PM_GRIP]: item => ({ ...item, weight: { value: 0.07, text: '0.08' } }) });
  assert.throws(() => fixtureForWeapon(w, MAKAROV), evidenceError(/weight token/));
});

test('top-level ergonomics, recoil and accuracy must agree with their properties twin (units proven, not assumed)', () => {
  const withProps = (props: Record<string, unknown>) => (item: RefItem): RefItem => ({ ...item, properties: { ...item.properties, ...props } });
  assert.throws(() => fixtureForWeapon(patched({ [PM_GRIP]: withProps({ ergonomics: 99 }) }), MAKAROV), evidenceError(/ergonomicsModifier/));
  assert.throws(() => fixtureForWeapon(patched({ [PM_GRIP]: withProps({ recoilModifier: 0.5 }) }), MAKAROV), evidenceError(/recoilModifier/));
  assert.throws(() => fixtureForWeapon(patched({ [PM_GRIP]: withProps({ accuracyModifier: 0.5 }) }), MAKAROV), evidenceError(/accuracyModifier/));
  // present in only one place: the unit cannot be proven
  assert.throws(() => fixtureForWeapon(patched({ [PM_GRIP]: item => ({ ...item, recoilModifier: null }) }), MAKAROV), evidenceError(/only one/));
});

test('a recoil percent and its fraction pass through as the raw fraction (no arithmetic on the leaf)', () => {
  const { fixture } = fixtureForWeapon(world, M4A1);
  // items.json: AR-15 NAROH pistol grip: recoilModifier -1.5 (percent) and properties.recoilModifier -0.015 (fraction)
  const grip = fixture.items.find(i => i.id === '59db3a1d86f77429e05b4e92');
  assert.equal(world.items.get('59db3a1d86f77429e05b4e92')?.recoilModifier, -1.5);
  assert.equal(grip?.recoilModifier, -0.015);
  // accuracy percent points pass through as the raw top-level value: the SV-98 muzzle brake has
  // accuracyModifier 6 (percent points) and properties.accuracyModifier 0.06 (fraction)
  const sv98 = fixtureForWeapon(world, '55801eed4bdc2d89578b4588').fixture;
  assert.equal(world.items.get('5c4ee3d62e2216152006f302')?.accuracyModifier, 6);
  assert.equal(sv98.items.find(i => i.id === '5c4ee3d62e2216152006f302')?.accuracyModifier, 6);
});

test('a trader offer without priceRUB or loyalty level, with an unresolved or non-canonical trader, is an evidence error', () => {
  const grip = (patch: Partial<RefTraderOffer>) => patched({ [PM_GRIP]: item => ({ ...item, buyFromTrader: item.buyFromTrader.map((o, i) => (i === 0 ? { ...o, ...patch } : o)) }) });
  assert.ok(world.items.get(PM_GRIP)?.buyFromTrader.length);
  assert.throws(() => fixtureForWeapon(grip({ priceRUB: null }), MAKAROV), evidenceError(/priceRUB/));
  assert.throws(() => fixtureForWeapon(grip({ minTraderLevel: null }), MAKAROV), evidenceError(/loyalty level/));
  assert.throws(() => fixtureForWeapon(grip({ minTraderLevel: 1.5 }), MAKAROV), evidenceError(/loyalty level/));
  assert.throws(() => fixtureForWeapon(grip({ traderId: 'ffffffffffffffffffffffff' }), MAKAROV), evidenceError(/unresolved/));
  const traders = new Map(world.traders);
  const prapor = [...traders.values()].find(t => t.normalizedName === 'prapor');
  assert.ok(prapor);
  traders.set(prapor.id, { ...prapor, normalizedName: 'Prapor' });
  assert.throws(() => fixtureForWeapon({ ...world, traders }, MAKAROV), evidenceError(/non-canonical/));
});

test('barter offeredCount must be a positive integer and ingredients must resolve', () => {
  const target = world.barters.find(b => b.offered.itemId === PM_GRIP) ?? world.barters.find(b => world.items.get(b.offered.itemId)?.types.includes('mods'));
  assert.ok(target);
  const withBarter = (patch: Partial<RefBarter>) => ({ barters: (all: readonly RefBarter[]) => all.map(b => (b === target ? { ...b, ...patch } : b)) });
  // the barter must belong to the Makarov closure to be mapped: retarget it to the grip
  const retarget = (patch: Partial<RefBarter>) => withBarter({ offered: { itemId: PM_GRIP, count: 1 }, requirements: [{ itemId: PM_SLIDE, count: 1 }], ...patch });
  assert.doesNotThrow(() => fixtureForWeapon(patched({}, retarget({})), MAKAROV));
  assert.throws(() => fixtureForWeapon(patched({}, retarget({ offered: { itemId: PM_GRIP, count: 1.5 } })), MAKAROV), evidenceError(/offered count/));
  assert.throws(() => fixtureForWeapon(patched({}, retarget({ offered: { itemId: PM_GRIP, count: 0 } })), MAKAROV), evidenceError(/offered count/));
  assert.throws(() => fixtureForWeapon(patched({}, retarget({ requirements: [{ itemId: 'ffffffffffffffffffffffff', count: 1 }] })), MAKAROV), evidenceError(/unresolved/));
});

test('a preset whose baseItem names another weapon, with an unresolved component, or with a foreign gun component is an evidence error', () => {
  const props = (patch: Record<string, unknown>) => (item: RefItem): RefItem => ({ ...item, properties: { ...item.properties, ...patch } });
  assert.throws(() => fixtureForWeapon(patched({ [MAKAROV_PRESET]: props({ baseItem: M4A1 }) }), MAKAROV), evidenceError(/baseItem/));
  assert.throws(
    () => fixtureForWeapon(patched({ [MAKAROV_PRESET]: item => ({ ...item, components: [...item.components, { itemId: 'ffffffffffffffffffffffff', count: 1 }] }) }), MAKAROV),
    evidenceError(/unresolved/),
  );
  assert.throws(
    () => fixtureForWeapon(patched({ [MAKAROV_PRESET]: item => ({ ...item, components: [...item.components, { itemId: M4A1, count: 1 }] }) }), MAKAROV),
    evidenceError(/gun other than the receiver/),
  );
  assert.throws(() => fixtureForWeapon(patched({ [MAKAROV_PRESET]: item => ({ ...item, types: ['mods'] }) }), MAKAROV), evidenceError(/preset/));
});

test('a gun carrying a modifier the receiver schema cannot hold, or a category chain that is not own-then-ancestors, is rejected', () => {
  assert.throws(() => fixtureForWeapon(patched({ [MAKAROV]: item => ({ ...item, accuracyModifier: 3 }) }), MAKAROV), evidenceError(/accuracyModifier/));
  assert.throws(() => fixtureForWeapon(patched({ [MAKAROV]: item => ({ ...item, recoilModifier: -2 }) }), MAKAROV), evidenceError(/recoilModifier/));
  assert.throws(
    () => fixtureForWeapon(patched({ [PM_GRIP]: item => ({ ...item, categoryIds: [...item.categoryIds].reverse() }) }), MAKAROV),
    evidenceError(/chain/),
  );
});

test('a non-mod item carrying a mod modifier has no rule and is rejected rather than defaulted', () => {
  assert.throws(
    () => fixtureForWeapon(patched({ [RIP_AMMO]: item => ({ ...item, ergonomicsModifier: 2 }) }), MTS255),
    evidenceError(/non-mod item/),
  );
});
