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

test('over the 172 closures no barter of an item or preset is dropped: 86 distinct fractional-count barters are mapped', () => {
  const mappedFractional = new Set<string>();
  const expectedFractional = new Set<string>();
  const removedAmmo = new Set<string>();
  for (const gunId of gunIds) {
    const { fixture, provenance } = fixtureForWeapon(world, gunId);
    provenance.removedAmmoItemIds.forEach(id => removedAmmo.add(id));
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
  // Before the owner decision of 2026-10-04 (loaded camora ammunition leaves the domain) the full closures reached 88 of them. The two
  // that fell out are the fractional barters offering ammunition that only a removed chamber slot reached: 88 - 2 = 86.
  const droppedWithTheChambers = [...removedAmmo].flatMap(id => (bartersByItem.get(id) ?? []).filter(isFractional)).filter(b => !expectedFractional.has(b.id));
  assert.equal(droppedWithTheChambers.length, 2);
  assert.equal(expectedFractional.size, 86);
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

// ---------------------------------------------------------------------------------------------
// Observations behind the owner decisions of 2026-10-04 (INTERPRETATIONS.md choices 2, 4, 7 and 10): the pinned capture holds no
// instance of the situations whose handling the reference fixed by rule. Nothing here pins behaviour, it records that the rules are
// vacuous on this data (they are exercised by the ledger and the oracle unit tests instead).
// ---------------------------------------------------------------------------------------------

test('observation: no offer has a stored price <= 0, no offer is level <= 0 and no barter totals <= 0 (choices 2 and 10)', () => {
  const seen = new Set<string>();
  let offers = 0;
  const bad: string[] = [];
  for (const gunId of gunIds) {
    const { fixture } = fixtureForWeapon(world, gunId, { weaponOfferKinds: ['trader', 'flea', 'barter'] });
    for (const subject of [...fixture.items, ...(fixture.presets ?? []), ...fixture.weapons]) {
      for (const offer of subject.offers ?? []) {
        const key = `${subject.id}${JSON.stringify(offer)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        offers++;
        if (offer.kind !== 'flea' && offer.level <= 0) bad.push(`${subject.id}: level ${offer.level}`);
        if (offer.kind === 'barter') {
          const total = offer.requirements.reduce((n, r) => n + r.count * (r.avg24hPrice ?? r.basePrice ?? 0), 0);
          if (total <= 0) bad.push(`${subject.id}: barter total ${total}`);
        } else if (offer.price <= 0) bad.push(`${subject.id}: ${offer.kind} price ${offer.price}`);
      }
    }
  }
  assert.ok(offers > 4000, `the scan is not vacuous: ${offers} distinct offers`);
  assert.deepEqual(bad, []);
});

test('observation: no receiver carries a magazine capacity (choice 7)', () => {
  for (const gunId of gunIds) assert.equal(fixtureForWeapon(world, gunId).fixture.weapons[0].magazineCapacity, undefined, gunId);
});

test('observation: no gun can install two positive-COI items in one tree (choice 4), by a structural upper bound that ignores conflicts', () => {
  // Most positive-COI items one rooted tree could hold: the item itself plus, per slot, the best single candidate below it (a template
  // never repeats an ancestor). Conflicts and caps only lower this, so a bound of at most 1 proves the claim; the bound itself is not 0.
  let withAnyPositive = 0;
  for (const gunId of gunIds) {
    const { fixture } = fixtureForWeapon(world, gunId);
    const items = new Map(fixture.items.map(i => [i.id, i]));
    const best = (id: string, ancestors: Set<string>): number => {
      const item = items.get(id);
      if (!item || ancestors.has(id)) return 0;
      ancestors.add(id);
      let total = (item.centerOfImpact ?? 0) > 0 ? 1 : 0;
      for (const slot of item.slots ?? []) total += Math.max(0, ...[...new Set(slot.allowedItemIds)].map(a => best(a, ancestors)));
      ancestors.delete(id);
      return total;
    };
    const receiver = fixture.weapons[0];
    const ancestors = new Set([receiver.id]);
    let total = 0;
    for (const slot of receiver.slots ?? []) total += Math.max(0, ...[...new Set(slot.allowedItemIds)].map(a => best(a, ancestors)));
    assert.ok(total <= 1, `${world.items.get(gunId)?.normalizedName}: up to ${total} positive-COI items in one tree`);
    if (total === 1) withAnyPositive++;
  }
  assert.ok(withAnyPositive > 100, `the bound is not vacuous: ${withAnyPositive} guns can install a positive-COI barrel`);
});
