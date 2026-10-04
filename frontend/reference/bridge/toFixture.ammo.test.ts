// Seam: toFixture.ts and loaded ammunition (INTERPRETATIONS.md choice 15, owner decision 2026-10-04).
//
// Loaded ammunition is outside the physical build domain (decision map #28), so a slot whose allowlist holds only
// ammunition templates (a revolver cylinder chamber, a camora) is REMOVED from the mapped fixture. It is not emptied:
// an emptied required slot would make its owner uninstallable and, on a required receiver slot, the whole weapon
// unbuildable. A slot that mixes ammunition with other candidates is refused (BridgeError), never split. Preset
// ammunition stays inert supply, as before. Every removed slot and template is recorded in provenance.
//
// Expected counts come from an independent breadth-first walk of the raw slot graph in this file (no skipping),
// cross-checked against the hand-read survey of items.json cited next to each constant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateTrees, runOracle } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import type { RawWorld, RefItem, RefSlot } from '../source/rawReader';
import { sliceFixture } from './slice';
import { BridgeError, fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');

const MAKAROV = '579204f224597773d619e051';
const MAKAROV_PRESET = '5841499024597759f825ff3e';
const PM_SLIDE = '6374a822e629013b9c0645c8'; // required mod_reciever of the Makarov
const RIP_AMMO = '5c0d591486f7744c505b416f'; // 12/70 RIP: ammunition (raw types: ammo)
const AKM = '59d6088586f774275f37482f';

// items.json survey (hand-read): exactly five items have slots whose every candidate is ammunition, all of them revolver
// cylinder magazines. Every chamber of one cylinder allows the same list, and each cylinder is reached by exactly one gun.
//   gun                       cylinder                        chambers  ammo templates per chamber
//   mts-255-12 shotgun        mts-255-12-12ga-cylinder        5         17
//   chiappa rhino 50ds        chiappa-rhino-357-6-round       6         4
//   chiappa rhino 200ds       chiappa-rhino-9x19-6-round      6         9
//   milkor m32a1              m32a1-40mm-cylinder             6         6
//   rsh-12                    rsh-12-127x55-5-round           5         3
// 5 + 6 + 6 + 6 + 5 = 28 slot records; 17 + 4 + 9 + 6 + 3 = 39 distinct templates (the lists are disjoint).
const REVOLVERS = [
  { gun: '60db29ce99594040e04c4a27', cylinder: '60dc519adf4c47305f6d410d', chambers: 5, templates: 17 },
  { gun: '61a4c8884f95bc3b2c5dc96f', cylinder: '619f54a1d25cbd424731fb99', chambers: 6, templates: 4 },
  { gun: '624c2e8614da335f1e034d8c', cylinder: '624c3074dbbd335e8e6becf3', chambers: 6, templates: 9 },
  { gun: '6275303a9f372d6ea97f9ec7', cylinder: '627bce33f21bc425b06ab967', chambers: 6, templates: 6 },
  { gun: '633ec7c2a6918cb895019c6c', cylinder: '633ec6ee025b096d320a3b15', chambers: 5, templates: 3 },
] as const;
const MTS255 = REVOLVERS[0];

const gunIds = [...world.items.values()].filter(i => i.types.includes('gun')).map(i => i.id);
const isAmmo = (id: string): boolean => world.items.get(id)?.types.includes('ammo') === true;
const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Independent expectation: walk the RAW slot graph (nothing skipped) and list every owner's ammunition-only slots. */
function rawAmmoOnlySlots(gunId: string): { ownerId: string; slotId: string; allowedItemIds: string[] }[] {
  const gun = world.items.get(gunId) as RefItem;
  const seen = new Set<string>([gunId]);
  const queue: RefItem[] = [gun];
  const out: { ownerId: string; slotId: string; allowedItemIds: string[] }[] = [];
  for (let i = 0; i < queue.length; i++) {
    const owner = queue[i];
    for (const slot of owner.slots) {
      if (slot.allowedItemIds.length > 0 && slot.allowedItemIds.every(isAmmo)) out.push({ ownerId: owner.id, slotId: slot.id, allowedItemIds: [...slot.allowedItemIds] });
      for (const id of slot.allowedItemIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(world.items.get(id) as RefItem);
      }
    }
  }
  return out.sort((a, b) => codeUnit(a.ownerId, b.ownerId));
}

// --- the real capture -------------------------------------------------------------------------------------------------

test('only five revolver guns have ammunition-only slots: 28 slot records and 39 ammunition templates, all recorded in provenance', () => {
  const withRemovals: string[] = [];
  let slotRecords = 0;
  const templates = new Set<string>();
  for (const gunId of gunIds) {
    const { provenance } = fixtureForWeapon(world, gunId);
    const expected = rawAmmoOnlySlots(gunId);
    assert.deepEqual(
      provenance.removedAmmoSlots.map(r => ({ ownerId: r.ownerId, slotId: r.slotId, allowedItemIds: r.allowedItemIds })),
      expected,
      `removed slots of ${world.items.get(gunId)?.normalizedName}`,
    );
    const expectedTemplates = [...new Set(expected.flatMap(r => r.allowedItemIds))].sort(codeUnit);
    assert.deepEqual(provenance.removedAmmoItemIds, expectedTemplates, `removed templates of ${world.items.get(gunId)?.normalizedName}`);
    if (expected.length > 0) withRemovals.push(gunId);
    slotRecords += provenance.removedAmmoSlots.length;
    provenance.removedAmmoItemIds.forEach(id => templates.add(id));
  }
  assert.deepEqual(withRemovals.sort(), REVOLVERS.map(r => r.gun).sort());
  assert.equal(slotRecords, 28);
  assert.equal(templates.size, 39);
});

test('per revolver: chambers and ammunition templates match the hand-read survey, and no chamber is a required slot', () => {
  for (const r of REVOLVERS) {
    const { provenance } = fixtureForWeapon(world, r.gun);
    assert.equal(provenance.removedAmmoSlots.length, r.chambers, r.gun);
    assert.ok(provenance.removedAmmoSlots.every(s => s.ownerId === r.cylinder), `${r.gun}: every removed slot is a chamber of its cylinder`);
    assert.ok(provenance.removedAmmoSlots.every(s => s.allowedItemIds.length === r.templates), `${r.gun}: ${r.templates} templates per chamber`);
    assert.equal(provenance.removedAmmoItemIds.length, r.templates, r.gun);
    assert.ok(provenance.removedAmmoSlots.every(s => s.required === false), `${r.gun}: chambers are optional in the raw data`);
  }
});

test('no slot of any receiver or item allows an ammunition template, over all 172 guns; every installable item is a mod', () => {
  for (const gunId of gunIds) {
    const { fixture, provenance } = fixtureForWeapon(world, gunId);
    const owners = [...fixture.weapons, ...fixture.items];
    const offenders = owners.flatMap(owner => (owner.slots ?? []).flatMap(s => s.allowedItemIds.filter(isAmmo).map(id => `${owner.id}/${s.id}:${id}`)));
    assert.deepEqual(offenders, [], `ammunition allowed in ${world.items.get(gunId)?.normalizedName}`);
    assert.deepEqual(provenance.nonModItemIds, [], `non-mod installable items of ${world.items.get(gunId)?.normalizedName}`);
  }
});

test('MTS-255: the cylinder stays a required, installable magazine; its chambers and their 17 ammunition templates are gone', () => {
  const { fixture, provenance } = fixtureForWeapon(world, MTS255.gun);
  const gun = fixture.weapons[0];
  // items.json: the receiver's MOD_MAGAZINE slot is required and allows exactly the cylinder.
  const magazineSlot = gun.slots?.find(s => s.allowedItemIds.length === 1 && s.allowedItemIds[0] === MTS255.cylinder);
  assert.ok(magazineSlot, 'the receiver slot that takes the cylinder survives');
  assert.equal(magazineSlot.required, true);
  const cylinder = fixture.items.find(i => i.id === MTS255.cylinder);
  assert.ok(cylinder, 'the cylinder magazine is still an installable item');
  assert.deepEqual(cylinder.slots, [], 'its five chambers are removed, not emptied');
  const rawChambers = (world.items.get(MTS255.cylinder) as RefItem).slots.map(s => s.id);
  assert.deepEqual(provenance.removedAmmoSlots.map(s => s.slotId), rawChambers);
  assert.equal(provenance.removedAmmoItemIds.length, 17);
  assert.equal(fixture.items.some(i => i.id === RIP_AMMO), false, 'ammunition reachable only through chambers leaves the closure');
  assert.equal(provenance.removedAmmoItemIds.includes(RIP_AMMO), true);
  for (const id of provenance.removedAmmoItemIds) assert.equal(fixture.items.some(i => i.id === id), false, id);
  // closure bookkeeping follows the mapped fixture: slots over the receiver and every item, none left on the cylinder
  assert.equal(provenance.closure.slots, (gun.slots?.length ?? 0) + fixture.items.reduce((n, i) => n + (i.slots?.length ?? 0), 0));
});

test('MTS-255 stays buildable: every build of its factory-preset micro-domain installs the cylinder', () => {
  // items.json: the one MTS-255 preset is the gun + cylinder + 755 mm ribbed barrel + choke + wooden stock + beechwood forestock, and
  // the receiver's four slots (magazine, barrel, stock, handguard) are all required. In the slice every required slot allows the
  // preset's own part only, so every feasible build installs the cylinder exactly once (an emptied chamber slot would instead
  // have made the cylinder uninstallable and the domain empty).
  const { fixture } = fixtureForWeapon(world, MTS255.gun);
  const preset = fixture.presets?.[0];
  assert.ok(preset);
  const ids = new Set(fixture.items.map(i => i.id));
  const keep = preset.components.map(c => c.itemId).filter(id => ids.has(id));
  assert.equal(keep.length, 5);
  const { fixture: slice } = sliceFixture(fixture, { keepItemIds: keep, keepPresetIds: [preset.id] });
  const result = runOracle(slice, { weapon_id: MTS255.gun });
  assert.equal(result.complete, true);
  assert.equal(result.empty, false);
  for (const projection of result.projections) {
    assert.deepEqual(projection.projection.items.filter(i => i.itemId === MTS255.cylinder), [{ itemId: MTS255.cylinder, count: 1 }]);
  }
});

test('preset ammunition stays inert supply: 60 rounds of 5.56 FMJ are an item no slot allows, and are not in removedAmmoItemIds', () => {
  const FMJ_556 = '59e6920f86f77411d82aa167';
  const { fixture, provenance } = fixtureForWeapon(world, '5447a9cd4bdc2dbd208b4567');
  assert.equal(provenance.supplyOnlyItemIds.includes(FMJ_556), true);
  assert.equal(provenance.removedAmmoItemIds.includes(FMJ_556), false);
  assert.equal(provenance.removedAmmoSlots.length, 0);
  assert.equal(fixture.items.find(i => i.id === FMJ_556) !== undefined, true);
});

// --- perturbations of a small pistol world ------------------------------------------------------------------------------

function patched(itemPatches: Record<string, (item: RefItem) => RefItem>): RawWorld {
  const items = new Map(world.items);
  for (const [id, patch] of Object.entries(itemPatches)) {
    const item = items.get(id);
    assert.ok(item, `patch target ${id} exists`);
    items.set(id, patch(item));
  }
  return { ...world, items };
}

const ammoSlot = (id: string, required: boolean, allowed: string[] = [RIP_AMMO]): RefSlot => ({
  id, nameKey: 'camora', nameId: 'camora', required, allowedItemIds: allowed,
  allowedCategoryIds: [], excludedItemIds: [], excludedCategoryIds: [],
});
const withExtraSlot = (slot: RefSlot) => (item: RefItem): RefItem => ({ ...item, slots: [...item.slots, slot] });
const evidenceError = (pattern: RegExp) => (error: unknown) => error instanceof BridgeError && pattern.test(error.message);

test('the unperturbed Makarov has no ammunition slot, so each perturbation below is the only cause of its effect', () => {
  const { provenance } = fixtureForWeapon(world, MAKAROV);
  assert.deepEqual(provenance.removedAmmoSlots, []);
  assert.deepEqual(provenance.removedAmmoItemIds, []);
});

test('a slot that mixes ammunition with other candidates is a BridgeError that names the slot, never silently split', () => {
  const w = patched({
    [PM_SLIDE]: item => ({ ...item, slots: item.slots.map((s, i) => (i === 0 ? { ...s, allowedItemIds: [...s.allowedItemIds, RIP_AMMO] } : s)) }),
  });
  const slot0 = (world.items.get(PM_SLIDE) as RefItem).slots[0];
  assert.throws(
    () => fixtureForWeapon(w, MAKAROV),
    error => evidenceError(/mixes ammunition/)(error) && (error as BridgeError).subject === `${PM_SLIDE}/${slot0.id}`,
  );
});

test('a REQUIRED ammunition-only slot is removed, not emptied: its owner stays installable and the weapon buildable', () => {
  const extra = ammoSlot('ffffffffffffffffffffff01', true);
  const w = patched({ [PM_SLIDE]: withExtraSlot(extra) });
  const { fixture, provenance } = fixtureForWeapon(w, MAKAROV);
  const slide = fixture.items.find(i => i.id === PM_SLIDE);
  assert.ok(slide);
  assert.equal(slide.slots?.some(s => s.id === extra.id), false, 'the slot is gone');
  assert.deepEqual(provenance.removedAmmoSlots, [{ ownerId: PM_SLIDE, slotId: extra.id, required: true, allowedItemIds: [RIP_AMMO] }]);
  assert.deepEqual(provenance.removedAmmoItemIds, [RIP_AMMO]);
  assert.equal(fixture.items.some(i => i.id === RIP_AMMO), false);
  const trees = enumerateTrees(fixture, MAKAROV);
  assert.equal(trees.complete, true);
  assert.ok(trees.trees.length > 0, 'the Makarov is still buildable');
  assert.ok(trees.trees.every(tree => tree.some(p => p.itemId === PM_SLIDE)), 'the required slide is installed in every tree');

  // Control: emptying the slot instead of removing it makes the slide uninstallable, hence the whole weapon unbuildable.
  const emptied = {
    ...fixture,
    items: fixture.items.map(i => (i.id === PM_SLIDE ? { ...i, slots: [...(i.slots ?? []), { id: extra.id, required: true, allowedItemIds: [] }] } : i)),
  };
  const none = enumerateTrees(emptied, MAKAROV);
  assert.equal(none.complete, true);
  assert.equal(none.trees.length, 0);
});

test('ammunition that is also listed as a preset component stays supply-only: an inert item that no slot allows', () => {
  const w = patched({
    [MAKAROV_PRESET]: item => ({ ...item, components: [...item.components, { itemId: RIP_AMMO, count: 3 }] }),
    [PM_SLIDE]: withExtraSlot(ammoSlot('ffffffffffffffffffffff02', false)),
  });
  const { fixture, provenance } = fixtureForWeapon(w, MAKAROV);
  assert.equal(provenance.supplyOnlyItemIds.includes(RIP_AMMO), true);
  assert.equal(provenance.removedAmmoItemIds.includes(RIP_AMMO), true, 'the chamber slot that allowed it is recorded as removed');
  assert.equal(fixture.items.some(i => i.id === RIP_AMMO), true);
  assert.equal([...fixture.weapons, ...fixture.items].some(o => o.slots?.some(s => s.allowedItemIds.includes(RIP_AMMO))), false);
  assert.deepEqual(fixture.presets?.find(p => p.id === MAKAROV_PRESET)?.components.filter(c => c.itemId === RIP_AMMO), [{ itemId: RIP_AMMO, count: 3 }]);
});

test('ammunition-only slots of a supply-only preset component are removed too, and the ammunition they reached stays out', () => {
  // The MTS-255 cylinder is a mod outside the Makarov closure; listing it as a Makarov preset component makes it a supply-only item.
  const w = patched({ [MAKAROV_PRESET]: item => ({ ...item, components: [...item.components, { itemId: MTS255.cylinder, count: 1 }] }) });
  const { fixture, provenance } = fixtureForWeapon(w, MAKAROV);
  assert.equal(provenance.supplyOnlyItemIds.includes(MTS255.cylinder), true);
  assert.deepEqual(fixture.items.find(i => i.id === MTS255.cylinder)?.slots, []);
  assert.equal(provenance.removedAmmoSlots.length, 5);
  assert.ok(provenance.removedAmmoSlots.every(s => s.ownerId === MTS255.cylinder));
  assert.equal(fixture.items.some(i => i.id === RIP_AMMO), false);
  assert.equal(provenance.supplyOnlyItemIds.includes(RIP_AMMO), false);
});

test('a slot with an empty allowlist is not ammunition-only: it is kept as is and never recorded as removed', () => {
  const w = patched({ [PM_SLIDE]: withExtraSlot(ammoSlot('ffffffffffffffffffffff03', false, [])) });
  const { fixture, provenance } = fixtureForWeapon(w, MAKAROV);
  assert.deepEqual(fixture.items.find(i => i.id === PM_SLIDE)?.slots?.find(s => s.id === 'ffffffffffffffffffffff03'), {
    id: 'ffffffffffffffffffffff03', required: false, allowedItemIds: [],
  });
  assert.deepEqual(provenance.removedAmmoSlots, []);
});

test('the real empty-allowlist slots of the capture (AK dust covers) survive mapping', () => {
  const { fixture, provenance } = fixtureForWeapon(world, AKM);
  const emptySlots = fixture.items.flatMap(i => (i.slots ?? []).filter(s => s.allowedItemIds.length === 0).map(s => `${i.id}/${s.id}`));
  const rawEmpty = [...world.items.values()].filter(i => fixture.items.some(f => f.id === i.id)).flatMap(i => i.slots.filter(s => s.allowedItemIds.length === 0).map(s => `${i.id}/${s.id}`));
  assert.ok(rawEmpty.length > 0, 'the AKM closure holds at least one real empty-allowlist slot (a dust cover)');
  assert.deepEqual(emptySlots.sort(), rawEmpty.sort());
  assert.deepEqual(provenance.removedAmmoSlots, []);
});

test('the removed-slot records survive a JSON round trip and are deterministic across languages', () => {
  const a = fixtureForWeapon(world, MTS255.gun);
  assert.deepEqual(JSON.parse(JSON.stringify(a.provenance)), a.provenance);
  const zh = fixtureForWeapon(loadPinnedWorld('zh').world, MTS255.gun);
  assert.deepEqual(zh.provenance.removedAmmoSlots, a.provenance.removedAmmoSlots);
  assert.deepEqual(zh.provenance.removedAmmoItemIds, a.provenance.removedAmmoItemIds);
});
