// Seam: toFixture.ts over the whole pinned capture -- every gun maps to a structurally valid oracle fixture.
// Also pins the one oracle limitation the bridge has to route around (fractional barter ingredient counts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFixture, type InputIssue, type ReferenceFixture } from '../oracle/index';
import { loadPinnedWorld } from '../source/pinnedWorld';
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
// Oracle limitation: ReferenceBarterRequirement.count must be a nonnegative INTEGER (domain.ts checkOffers),
// but 377 of the 1128 ingredient entries of the pinned barters are fractional (e.g. 7.52, 25.02, 155.1).
// The oracle's exact decoding (fromBinary64) would handle them; only the structural check refuses them.
// ---------------------------------------------------------------------------------------------

const M4A1 = '5447a9cd4bdc2dbd208b4567';

function fractionalRequirementCount(fixture: ReferenceFixture): number {
  let n = 0;
  for (const subject of [...fixture.items, ...fixture.weapons, ...(fixture.presets ?? [])]) {
    for (const offer of subject.offers ?? []) {
      if (offer.kind === 'barter') n += offer.requirements.filter(r => !Number.isInteger(r.count)).length;
    }
  }
  return n;
}

test('KNOWN ORACLE LIMITATION PRESENT: checkFixture refuses exactly the fractional barter ingredient counts', () => {
  const { fixture } = fixtureForWeapon(world, M4A1, { fractionalBarters: 'include' });
  const fractional = fractionalRequirementCount(fixture);
  assert.ok(fractional > 0);
  const issues: InputIssue[] = checkFixture(fixture);
  assert.equal(issues.length, fractional);
  assert.ok(issues.every(i => i.code === 'BAD_OFFER' && /requirements\[\d+\]\.count must be a nonnegative integer/.test(i.detail)));
  // and the default option leaves none of them in the fixture
  assert.equal(fractionalRequirementCount(fixtureForWeapon(world, M4A1).fixture), 0);
});

test('checkFixture accepts a fixture with fractional barter ingredient counts', {
  todo: 'oracle bug: domain.ts checkOffers requires integer ingredient counts but real barters have fractional ones (377 of 1128); relax to a finite nonnegative number, then flip the bridge default to include',
}, () => {
  const { fixture } = fixtureForWeapon(world, M4A1, { fractionalBarters: 'include' });
  assert.deepEqual(checkFixture(fixture), []);
});
