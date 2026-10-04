// Seam: toFixture.ts over the whole pinned capture -- every gun maps to a structurally valid oracle fixture.
// Also pins that fractional barter ingredient counts (every Ref barter, 377 of the 1128 entries) are mapped, not omitted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFixture } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { indexBartersByOfferedItem, type RefBarter } from '../source/rawReader';
import { fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');
const gunIds = [...world.items.values()].filter(i => i.types.includes('gun')).map(i => i.id);

test('the pinned capture holds 172 guns and every one maps to a fixture that passes checkFixture', () => {
  assert.equal(gunIds.length, 172);
  const failures: string[] = [];
  let items = 0;
  for (const gunId of gunIds) {
    try {
      const { fixture } = fixtureForWeapon(world, gunId);
      items += fixture.items.length;
      const issues = checkFixture(fixture);
      if (issues.length > 0) failures.push(`${world.items.get(gunId)?.normalizedName}: ${issues.slice(0, 3).map(i => `${i.code}(${i.detail})`).join('; ')}`);
    } catch (error) {
      failures.push(`${world.items.get(gunId)?.normalizedName}: threw ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
  assert.ok(items > 40_000, `mapped ${items} item records over all guns`);
});

test('every raw preset of every gun is mapped (399 presets, 4391 component entries, entry for entry)', () => {
  let presets = 0;
  let entries = 0;
  for (const gunId of gunIds) {
    const { fixture, provenance } = fixtureForWeapon(world, gunId);
    const raw = world.items.get(gunId)?.presetIds ?? [];
    assert.deepEqual(fixture.presets?.map(p => p.id), raw);
    presets += provenance.closure.presets;
    entries += provenance.closure.presetComponentEntries;
  }
  assert.equal(presets, 399);
  assert.equal(entries, 4391);
});

test('every self-conflicting item of the capture keeps its own id in conflictingItemIds wherever it is mapped', () => {
  const selfConflicting = [...world.items.values()].filter(i => i.conflictingItemIds.includes(i.id)).map(i => i.id);
  assert.equal(selfConflicting.length, 3);
  const seenAt = new Map<string, number>();
  for (const gunId of gunIds) {
    const { fixture } = fixtureForWeapon(world, gunId);
    for (const item of fixture.items) {
      const mappedSelf = item.conflictingItemIds?.includes(item.id) === true;
      assert.equal(mappedSelf, selfConflicting.includes(item.id), item.id);
      if (mappedSelf) seenAt.set(item.id, (seenAt.get(item.id) ?? 0) + 1);
    }
  }
  assert.deepEqual([...seenAt.keys()].sort(), [...selfConflicting].sort());
});

// ---------------------------------------------------------------------------------------------
// Fractional barter ingredient counts: 377 of the 1128 ingredient entries of the pinned barters are fractional
// (7.52, 25.02, 155.1; every one a Ref barter). The oracle accepts any finite nonnegative count and decodes it
// exactly, so the bridge maps every barter and the barter domain is not silently shrunk.
// ---------------------------------------------------------------------------------------------

const bartersByItem = indexBartersByOfferedItem(world.barters);
const isFractional = (barter: RefBarter): boolean => barter.requirements.some(r => !Number.isInteger(r.count));

test('the pinned capture holds 377 fractional-count barters, all offered by Ref, each with exactly one fractional entry', () => {
  const fractional = world.barters.filter(isFractional);
  assert.equal(fractional.length, 377);
  assert.equal(world.barters.reduce((n, b) => n + b.requirements.length, 0), 1128);
  assert.equal(world.barters.flatMap(b => b.requirements).filter(r => !Number.isInteger(r.count)).length, 377);
  assert.deepEqual([...new Set(fractional.map(b => world.traders.get(b.traderId)?.normalizedName))], ['ref']);
});

test('over the 172 closures no barter of an item or preset is dropped: 88 distinct fractional-count barters are mapped', () => {
  const mappedFractional = new Set<string>();
  const expectedFractional = new Set<string>();
  for (const gunId of gunIds) {
    const { fixture } = fixtureForWeapon(world, gunId);
    for (const subject of [...fixture.items, ...(fixture.presets ?? [])]) {
      const raw = bartersByItem.get(subject.id) ?? [];
      const mapped = subject.offers?.filter(o => o.kind === 'barter') ?? [];
      // the bridge keeps every raw barter, in raw order (counts verbatim)
      assert.deepEqual(
        mapped.map(o => (o.kind === 'barter' ? o.requirements.map(r => r.count) : [])),
        raw.map(b => b.requirements.map(r => r.count)),
        `${gunId}/${subject.id}`,
      );
      for (const b of raw.filter(isFractional)) expectedFractional.add(b.id);
      if (mapped.some(o => o.kind === 'barter' && o.requirements.some(r => !Number.isInteger(r.count)))) {
        for (const b of raw.filter(isFractional)) mappedFractional.add(b.id);
      }
    }
  }
  assert.equal(expectedFractional.size, 88);
  assert.deepEqual([...mappedFractional].sort(), [...expectedFractional].sort());
});

// ---------------------------------------------------------------------------------------------
// Observation only (no behaviour is pinned): the oracle's SLOT_CONFLICT rule blocks every occupied physical slot whose
// template slot id is in an installed item's conflictingSlotIds, including the slot the item itself occupies. An item
// that listed its own host slot id could therefore never be installed there. The pinned capture has no such item.
// ---------------------------------------------------------------------------------------------

test('observation: no real item lists in conflictingSlotIds a slot id whose allowlist contains that same item', () => {
  const withConflicts = [...world.items.values()].filter(i => i.conflictingSlotIds.length > 0);
  // the scan input is not vacuous: 9 items list 32 slot ids, 2 of them mods (VOMZ Pilad scope, AR-15 Aeroknox AX-15 handguard)
  assert.equal(withConflicts.length, 9);
  assert.equal(withConflicts.reduce((n, i) => n + i.conflictingSlotIds.length, 0), 32);
  assert.equal(withConflicts.filter(i => i.types.includes('mods')).length, 2);
  const selfBlocked: string[] = [];
  for (const host of world.items.values()) {
    for (const slot of host.slots) {
      for (const allowed of slot.allowedItemIds) {
        if (world.items.get(allowed)?.conflictingSlotIds.includes(slot.id)) selfBlocked.push(`${allowed} in ${host.id}/${slot.id}`);
      }
    }
  }
  assert.deepEqual(selfBlocked, []);
});
