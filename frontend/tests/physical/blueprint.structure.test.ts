// Physical blueprint structure (ADR 0003, ADR 0012 Tier 1, ADR 0013 section 4A): path-qualified occurrences, physical
// slots, the cyclic-data guard, empty required slots kept, slot-id collision assertion, ammunition slots removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalModelError, preparePhysicalWeapon, type PhysicalBlueprint } from '../../src/solver/physical';
import { gun, lookupOf, mod, slot, WEAPON } from './fixtures';

const itemOccurrences = (bp: PhysicalBlueprint): number[] => Array.from({ length: bp.occurrenceCount - 1 }, (_, i) => i + 1);
const instanceIds = (bp: PhysicalBlueprint): string[] => itemOccurrences(bp).map(v => bp.instanceId(v));

test('occurrences are path-qualified: one item under two parents is two occurrences with distinct instance ids', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('sA', ['m1', 'm2']), slot('sB', ['m3'], true)] }),
    ['m1', mod('m1')],
    ['m2', mod('m2')],
    ['m3', mod('m3', { slots: [slot('sC', ['m1'])] })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);

  assert.equal(bp.weaponId, WEAPON);
  assert.equal(bp.occurrenceCount, 5, 'the receiver (occurrence 0) plus four item occurrences');
  assert.deepEqual(instanceIds(bp), [
    'weapon_0/sA:m1',
    'weapon_0/sA:m2',
    'weapon_0/sB:m3',
    'weapon_0/sB:m3/sC:m1',
  ]);
  // The same template appears twice (two parents): Instances(m1) has both, in occurrence order.
  const m1 = bp.templateIndexOf('m1');
  assert.deepEqual(Array.from(bp.instancesOf(m1)).map(v => bp.instanceId(v)), ['weapon_0/sA:m1', 'weapon_0/sB:m3/sC:m1']);
  // Each occurrence has exactly one parent slot; the child of m3 hangs from m3's slot, not from the receiver's.
  const deep = bp.occurrenceByInstanceId('weapon_0/sB:m3/sC:m1');
  assert.ok(deep > 0);
  assert.equal(bp.rawSlotId(bp.parentSlot(deep)), 'sC');
  assert.equal(bp.instanceId(bp.slotOwner(bp.parentSlot(deep))), 'weapon_0/sB:m3');
  assert.equal(bp.templateId(deep), 'm1');
  assert.equal(bp.occurrenceByInstanceId('weapon_0/sB:m3/sC:nope'), -1);
});

test('sibling slots of one parent hold independent copies of the same template', () => {
  // Two grip slots on one receiver, both allowing the same grip: two occurrences, one per physical slot.
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('grip1', ['g']), slot('grip2', ['g'])] }), ['g', mod('g')]);
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  assert.deepEqual(instanceIds(bp), ['weapon_0/grip1:g', 'weapon_0/grip2:g']);
  assert.equal(bp.slotCount, 2);
  assert.notEqual(bp.parentSlot(1), bp.parentSlot(2));
});

test('a cyclic part graph is bad data: the blueprint throws the internal CYCLIC_PART_GRAPH error; a loop the receiver cannot reach is never expanded', () => {
  // No gun has a cyclic part graph (owner decision 2026-10-12). The unrolling only terminates because a template never recurs on its own root path, so
  // a recurrence throws instead of hanging: m1 -> m2 -> m1.
  const cyclic = lookupOf(
    gun(WEAPON, { slots: [slot('s0', ['m1'])] }),
    ['m1', mod('m1', { slots: [slot('s1', ['m2'])] })],
    ['m2', mod('m2', { slots: [slot('s2', ['m1'])] })],
  );
  assert.throws(() => preparePhysicalWeapon(cyclic, WEAPON), (e: unknown) => e instanceof PhysicalModelError && e.code === 'CYCLIC_PART_GRAPH');
  // The same loop behind no slot of the receiver: the gun prepares normally.
  const unreachable = lookupOf(
    gun(WEAPON, { slots: [slot('s0', ['m3'])] }),
    ['m1', mod('m1', { slots: [slot('s1', ['m2'])] })],
    ['m2', mod('m2', { slots: [slot('s2', ['m1'])] })],
    ['m3', mod('m3')],
  );
  assert.deepEqual(instanceIds(preparePhysicalWeapon(unreachable, WEAPON)), ['weapon_0/s0:m3']);
});

test('empty required slots are kept: a mod-owned one stays attached to its owner, a root one stays on the receiver', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('rootReq', [], true), slot('opt', ['m1'])] }),
    ['m1', mod('m1', { slots: [slot('modReq', [], true), slot('modOpt', [])] })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  assert.equal(bp.slotCount, 4, 'rootReq, opt, modReq and modOpt are all physical slots');
  const bySlotName = new Map<string, number>();
  for (let s = 0; s < bp.slotCount; s++) bySlotName.set(bp.rawSlotId(s), s);

  const rootReq = bySlotName.get('rootReq')!;
  assert.equal(bp.slotRequired(rootReq), true);
  assert.equal(bp.candidateCount(rootReq), 0);
  assert.equal(bp.slotOwner(rootReq), 0, 'owned by the receiver');

  const modReq = bySlotName.get('modReq')!;
  assert.equal(bp.slotRequired(modReq), true);
  assert.equal(bp.candidateCount(modReq), 0);
  assert.equal(bp.instanceId(bp.slotOwner(modReq)), 'weapon_0/opt:m1');

  const modOpt = bySlotName.get('modOpt')!;
  assert.equal(bp.slotRequired(modOpt), false);
  assert.equal(bp.candidateCount(modOpt), 0, 'an empty allowlist is kept, not dropped');
});

test('a slot id defined by two distinct templates is an ambiguous input and throws', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('shared', ['m1']), slot('other', ['m2'])] }),
    ['m1', mod('m1')],
    ['m2', mod('m2', { slots: [slot('shared', ['m1'])] })],
  );
  assert.throws(
    () => preparePhysicalWeapon(lookup, WEAPON),
    (e: unknown) => e instanceof PhysicalModelError && e.code === 'SLOT_ID_COLLISION' && /shared/.test(e.message),
  );
});

test('a slot id repeated inside one template throws, and a template reached twice is not a collision', () => {
  const dup = lookupOf(gun(WEAPON, { slots: [slot('dup', ['m1']), slot('dup', ['m1'])] }), ['m1', mod('m1')]);
  assert.throws(() => preparePhysicalWeapon(dup, WEAPON), (e: unknown) => e instanceof PhysicalModelError && e.code === 'SLOT_ID_COLLISION');

  // m3 is reached under two parents: the same template defines slot 'sC' twice over, which is no collision.
  const twice = lookupOf(
    gun(WEAPON, { slots: [slot('a', ['m3']), slot('b', ['m3'])] }),
    ['m3', mod('m3', { slots: [slot('sC', ['m1'])] })],
    ['m1', mod('m1')],
  );
  const bp = preparePhysicalWeapon(twice, WEAPON);
  assert.equal(bp.occurrenceCount, 1 + 4);
});

test('collisions among templates this weapon cannot reach do not matter', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m1'])] }),
    ['m1', mod('m1', { slots: [slot('x', [])] })],
    ['elsewhere', mod('elsewhere', { slots: [slot('x', [])] })],
  );
  assert.doesNotThrow(() => preparePhysicalWeapon(lookup, WEAPON));
});

test('ammunition-only slots are removed from the physical domain, required or not, and recorded', () => {
  // 'ammo*' ids are not in the lookup (ammunition is no ItemLookup entry); the data layer flags them per slot (`ammoItems`).
  // A removed required slot must not make the owner unbuildable.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('chamber', ['ammo1', 'ammo2'], true, ['ammo1', 'ammo2']), slot('grip', ['m1'])] }),
    ['m1', mod('m1', { slots: [slot('mag', ['ammo1', 'ammo3'], false, ['ammo1', 'ammo3'])] })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  assert.deepEqual(instanceIds(bp), ['weapon_0/grip:m1']);
  assert.equal(bp.slotCount, 1, 'the chamber and the mag slot are gone; grip is the only physical slot');
  assert.deepEqual(
    bp.removedAmmoSlots.map(r => [r.ownerTemplateId, r.slotId, [...r.ammoItemIds]]),
    [[WEAPON, 'chamber', ['ammo1', 'ammo2']], ['m1', 'mag', ['ammo1', 'ammo3']]],
  );
  assert.deepEqual([...bp.removedAmmoItemIds].sort(), ['ammo1', 'ammo2', 'ammo3']);
});

test('a slot that mixes ammunition with parts is an input error, never silently split', () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('mixed', ['m1', 'ammo1'], false, ['ammo1'])] }), ['m1', mod('m1')]);
  assert.throws(
    () => preparePhysicalWeapon(lookup, WEAPON),
    (e: unknown) => e instanceof PhysicalModelError && e.code === 'MIXED_AMMO_SLOT',
  );
});

test('with an ammunition classifier, an unknown non-ammunition id is dropped from its allowlist and recorded', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m1', 'ghost']), slot('chamber', ['ammo1'])] }),
    ['m1', mod('m1')],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON, { isAmmo: id => id.startsWith('ammo') });
  assert.deepEqual(instanceIds(bp), ['weapon_0/s:m1']);
  assert.deepEqual(bp.droppedAllowedItems.map(d => [d.ownerTemplateId, d.slotId, d.itemId]), [[WEAPON, 's', 'ghost']]);
  assert.deepEqual(bp.removedAmmoSlots.map(r => r.slotId), ['chamber']);
});

test('an unknown weapon id throws a typed error', () => {
  assert.throws(
    () => preparePhysicalWeapon(lookupOf(gun(WEAPON)), 'missing'),
    (e: unknown) => e instanceof PhysicalModelError && e.code === 'UNKNOWN_WEAPON',
  );
  assert.throws(
    () => preparePhysicalWeapon(lookupOf(gun(WEAPON), ['m', mod('m')]), 'm'),
    (e: unknown) => e instanceof PhysicalModelError && e.code === 'UNKNOWN_WEAPON',
  );
});
