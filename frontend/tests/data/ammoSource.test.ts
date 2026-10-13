// Where the blueprint learns that an allowed id is ammunition (INTERPRETATIONS.md choice 15, ADR 0013 section 4A).
//
// Ammunition is not an ItemLookup entry (the lookup holds guns and mods only), so "the id is absent from the lookup" no longer
// means "ammunition": an unpriced mod could be absent for other reasons. The data layer now carries the source item types:
// each converted item has `types`, and each slot lists which of its allowed items are ammunition (`SlotInfo.ammoItems`). The blueprint
// removes a slot only for ids so flagged; an unknown id that is neither ammunition nor in the lookup is a recorded drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItemLookup } from '../../src/solver/dataService';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import type { ItemLookup, ModLookupEntry } from '../../src/solver/types';
import { PhysicalModelError, preparePhysicalWeapon } from '../../src/solver/physical';
import { loadPinnedWorld } from '../../reference/source/pinnedWorld';
import { withPinnedFetch } from '../../reference/source/pinnedFetchStub';
import { PinError } from '../../reference/source/pins';
import { docsOf, rawItem, rawSlots, traderOffer, withStubbedJsonApi } from './syntheticWorld';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw GraphQL-shaped documents

const world = (slots: { id: string; allowed: string[]; required?: boolean }[], extra: ReturnType<typeof rawItem>[] = []) =>
  docsOf({
    items: [
      rawItem('gun', { types: ['gun'], buyFromTrader: [traderOffer(5000)], properties: { slots: rawSlots(slots), presets: [] } }),
      rawItem('grip', { types: ['mods'], buyFromTrader: [traderOffer(100)] }),
      rawItem('unpriced', { types: ['mods'], basePrice: 0 }),
      rawItem('r1', { types: ['ammo'], basePrice: 5 }),
      rawItem('r2', { types: ['ammo', 'noFlea'], basePrice: 5 }),
      ...extra,
    ],
  });

const load = (docs: Record<string, unknown>) => withStubbedJsonApi(docs, () => fetchAllDataFromJsonApi('en', 'regular'));

// ---------------------------------------------------------------------------------------------
// The data layer carries the types
// ---------------------------------------------------------------------------------------------

test('the adapter carries the raw item types of guns and mods, and the types of every allowed item', async () => {
  const out = await load(world([{ id: 'chamber', allowed: ['r1', 'r2'], required: true }, { id: 'grip', allowed: ['grip', 'unpriced', 'ghost'] }]));
  const gun = out.guns[0] as Loose;
  assert.deepEqual(gun.types, ['gun']);
  assert.deepEqual((out.mods.find((m: Loose) => m.id === 'grip') as Loose).types, ['mods']);
  const [chamber, grip] = gun.properties.slots as Loose[];
  assert.deepEqual(chamber.filters.allowedItems, [{ id: 'r1', types: ['ammo'] }, { id: 'r2', types: ['ammo', 'noFlea'] }], 'GraphQL allowedItems { id types } shape');
  assert.deepEqual(grip.filters.allowedItems, [{ id: 'grip', types: ['mods'] }, { id: 'unpriced', types: ['mods'] }, { id: 'ghost', types: [] }], 'an id the items document lacks has no types');
});

test('the extractor lists, per slot, the allowed items whose type is ammunition, and keeps allowedItems as the plain id list', async () => {
  const out = await load(world([{ id: 'chamber', allowed: ['r1', 'r2'], required: true }, { id: 'grip', allowed: ['grip', 'ghost'] }]));
  const lookup = buildItemLookup(out.guns, out.mods);
  const [chamber, grip] = lookup.gun.slots;
  assert.deepEqual(chamber.allowedItems, ['r1', 'r2']);
  assert.deepEqual(chamber.ammoItems, ['r1', 'r2']);
  assert.deepEqual(grip.allowedItems, ['grip', 'ghost']);
  assert.equal('ammoItems' in grip, false, 'no ammunition, no field');
  assert.deepEqual((lookup.gun.data as Loose).types, ['gun'], 'the raw item types stay on the lookup entry');
  assert.deepEqual(((lookup.grip as ModLookupEntry).data as Loose).types, ['mods']);
});

test('plain string allowed items (a payload with no item types) are never classified as ammunition', () => {
  const gun: Loose = {
    id: 'gun', name: 'gun', basePrice: 0, buyFor: [], bartersFor: [], handbookCategories: [], bsgCategory: null,
    properties: { slots: [{ id: 's', name: 's', nameId: 's', required: false, filters: { allowedItems: ['a', { id: 'b' }, { id: 'c', types: null }] } }] },
  };
  const lookup = buildItemLookup([gun], []);
  assert.deepEqual(lookup.gun.slots[0].allowedItems, ['a', 'b', 'c']);
  assert.equal('ammoItems' in lookup.gun.slots[0], false);
});

// ---------------------------------------------------------------------------------------------
// The blueprint's default classification
// ---------------------------------------------------------------------------------------------

test('by default a slot is removed only for flagged ammunition; an unpriced mod stays a candidate, an unknown id is a recorded drop', async () => {
  const out = await load(world([
    { id: 'chamber', allowed: ['r1', 'r2'], required: true },
    { id: 'grip', allowed: ['grip', 'unpriced'] },
    { id: 'junk', allowed: ['ghost', 'grip'] },
  ]));
  const lookup = buildItemLookup(out.guns, out.mods);
  const bp = preparePhysicalWeapon(lookup, 'gun');
  assert.deepEqual(bp.removedAmmoSlots.map(r => [r.slotId, [...r.ammoItemIds]]), [['chamber', ['r1', 'r2']]]);
  assert.deepEqual([...bp.removedAmmoItemIds].sort(), ['r1', 'r2']);
  assert.ok(bp.occurrenceByInstanceId('weapon_0/grip:unpriced') > 0, 'the unpriced mod is a candidate, not ammunition');
  assert.deepEqual(bp.droppedAllowedItems.map(d => [d.slotId, d.itemId, d.reason]), [['junk', 'ghost', 'not_in_lookup']]);
  assert.equal(bp.structurallyViable[0], 1, 'the removed required chamber does not make the receiver unbuildable');
});

test('a slot that mixes flagged ammunition with parts is still an input error by default', async () => {
  const out = await load(world([{ id: 'mixed', allowed: ['grip', 'r1'] }]));
  const lookup = buildItemLookup(out.guns, out.mods);
  assert.throws(() => preparePhysicalWeapon(lookup, 'gun'), (e: unknown) => e instanceof PhysicalModelError && e.code === 'MIXED_AMMO_SLOT');
});

test('the same ids with no ammunition flags are NOT ammunition: nothing is inferred from absence from the lookup', () => {
  const lookup: ItemLookup = {
    gun: {
      type: 'gun', data: { id: 'gun' }, presets: [], all_presets: [],
      slots: [{ id: 'chamber', name: 'chamber', nameId: 'chamber', required: false, allowedItems: ['r1'] }],
      stats: {} as never,
    },
  };
  const bp = preparePhysicalWeapon(lookup, 'gun');
  assert.deepEqual(bp.removedAmmoSlots, []);
  assert.deepEqual(bp.droppedAllowedItems.map(d => [d.itemId, d.reason]), [['r1', 'not_in_lookup']]);
});

test('an explicit isAmmo classifier adds to the data-layer flags', () => {
  const lookup: ItemLookup = {
    gun: {
      type: 'gun', data: { id: 'gun' }, presets: [], all_presets: [],
      slots: [{ id: 'chamber', name: 'chamber', nameId: 'chamber', required: false, allowedItems: ['r1'] }],
      stats: {} as never,
    },
  };
  const bp = preparePhysicalWeapon(lookup, 'gun', { isAmmo: id => id === 'r1' });
  assert.deepEqual(bp.removedAmmoSlots.map(r => [r.slotId, [...r.ammoItemIds]]), [['chamber', ['r1']]]);
  assert.deepEqual(bp.droppedAllowedItems, []);
});

// ---------------------------------------------------------------------------------------------
// The whole pipeline on the pinned capture: adapter -> extractors -> blueprint, no classifier passed
// ---------------------------------------------------------------------------------------------

test('on the pinned capture the data-layer flags reproduce the raw-type ammunition set exactly: 5 guns, 28 slot records, 39 templates, 0 drops', async t => {
  let pinned: { result: { guns: Loose[]; mods: Loose[] } };
  let rawWorld: ReturnType<typeof loadPinnedWorld>['world'];
  try {
    pinned = await withPinnedFetch(() => fetchAllDataFromJsonApi('en', 'regular'));
    rawWorld = loadPinnedWorld('en').world;
  } catch (e) {
    if (e instanceof PinError) { t.skip(`pinned documents are not restored: ${e.message}`); return; }
    throw e;
  }
  const lookup = buildItemLookup(pinned.result.guns, pinned.result.mods);
  const rawIsAmmo = (id: string): boolean => rawWorld.items.get(id)?.types.includes('ammo') === true;

  const slotRecords = new Set<string>();
  const ammoIds = new Set<string>();
  const gunsWithAmmo: string[] = [];
  let guns = 0;
  for (const gun of pinned.result.guns) {
    guns++;
    const byFlags = preparePhysicalWeapon(lookup, gun.id);
    const byRawTypes = preparePhysicalWeapon(lookup, gun.id, { isAmmo: rawIsAmmo });
    assert.deepEqual(byFlags.droppedAllowedItems, [], `${gun.shortName}: no unknown non-ammunition id is dropped`);
    assert.deepEqual(byFlags.removedAmmoSlots, byRawTypes.removedAmmoSlots, `${gun.shortName}: the data-layer flags equal the raw item types`);
    assert.equal(byFlags.occurrenceCount, byRawTypes.occurrenceCount);
    assert.equal(byFlags.structurallyViable[0], 1, `${gun.shortName} stays buildable`);
    if (byFlags.removedAmmoSlots.length > 0) gunsWithAmmo.push(gun.shortName);
    for (const record of byFlags.removedAmmoSlots) slotRecords.add(`${record.ownerTemplateId}/${record.slotId}`);
    for (const id of byFlags.removedAmmoItemIds) ammoIds.add(id);
  }
  assert.equal(guns, 172);
  assert.deepEqual(gunsWithAmmo.sort(), ['CR 200DS', 'CR 50DS', 'MSGL', 'MTs-255-12', 'RSh-12']);
  assert.equal(slotRecords.size, 28);
  assert.equal(ammoIds.size, 39);
  for (const id of ammoIds) assert.equal(rawIsAmmo(id), true, `${id} is ammunition in the raw capture`);
});
