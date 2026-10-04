// Physical blueprint data: direct raw bounds, conflict data, preset catalog, categories, stability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalModelError, preparePhysicalWeapon, type PhysicalBlueprint } from '../../src/solver/physical';
import { gun, lookupOf, mod, slot, WEAPON } from './fixtures';

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, message ?? `${actual} is not ${expected}`);

const occurrenceOf = (bp: PhysicalBlueprint, instanceId: string): number => {
  const v = bp.occurrenceByInstanceId(instanceId);
  assert.ok(v >= 0, `no occurrence ${instanceId}`);
  return v;
};

test('raw bounds are the exact min and max over buildable trees: optional slots may stay empty, required slots may not', () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, ergo: 10, slots: [slot('a', ['m1', 'm2']), slot('b', ['m3'], true)] }),
    ['m1', mod('m1', { weight: 2, ergo: 5, recoil: -0.05 })],
    ['m2', mod('m2', { weight: -0.5, ergo: -3, recoil: 0.1 })],
    ['m3', mod('m3', { weight: 4, ergo: 2, recoil: -0.1, slots: [slot('c', ['m4'])] })],
    ['m4', mod('m4', { weight: 1, ergo: 1 })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const raw = bp.rawBounds!;
  // weight: receiver 1, slot a in {empty, 2, -0.5} -> [-0.5, 2], slot b = m3 4 + slot c in {empty, 1} -> [4, 5]
  close(raw.weight.min, 1 - 0.5 + 4);
  close(raw.weight.max, 1 + 2 + 5);
  // ergonomics: 10 + a in {empty, 5, -3} -> [-3, 5] + b = 2 + c in {empty, 1} -> [2, 3]
  close(raw.ergonomics.min, 10 - 3 + 2);
  close(raw.ergonomics.max, 10 + 5 + 3);
  // recoil: a in {empty, -0.05, 0.1} -> [-0.05, 0.1]; b = -0.1
  close(raw.recoil.min, -0.05 - 0.1);
  close(raw.recoil.max, 0.1 - 0.1);

  // Each occurrence carries its own subtree range.
  const m3 = occurrenceOf(bp, 'weapon_0/b:m3');
  close(bp.weightMin[m3], 4);
  close(bp.weightMax[m3], 5);
  close(bp.ergonomicsMin[m3], 2);
  close(bp.ergonomicsMax[m3], 3);
  const m2 = occurrenceOf(bp, 'weapon_0/a:m2');
  close(bp.weightMin[m2], -0.5);
  close(bp.weightMax[m2], -0.5);
  assert.equal(bp.structurallyViable[m3], 1);
});

test('fractional mass is preserved exactly', () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 0.75, slots: [slot('s', ['mount'])] }), ['mount', mod('mount', { weight: 0.0155 })]);
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const mount = bp.templateIndexOf('mount');
  assert.equal(bp.templateWeight[mount], 0.0155);
  assert.equal(bp.weightMax[occurrenceOf(bp, 'weapon_0/s:mount')], 0.0155);
  assert.equal(bp.rawBounds!.weight.max, 0.75 + 0.0155);
});

test('a structurally impossible owner leaves the bounds, an alternative candidate in its slot still counts', () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s', ['broken', 'fine'], true)] }),
    ['broken', mod('broken', { weight: 100, slots: [slot('needs', [], true)] })],
    ['fine', mod('fine', { weight: 2 })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const broken = occurrenceOf(bp, 'weapon_0/s:broken');
  assert.equal(bp.structurallyViable[broken], 0);
  assert.ok(Number.isNaN(bp.weightMax[broken]));
  close(bp.rawBounds!.weight.max, 3, 'the 100 kg owner of an empty required slot never counts');
  close(bp.rawBounds!.weight.min, 3);
  assert.equal(bp.stats.structurallyImpossibleOccurrences, 1);
});

test('a template the receiver conflicts with never counts toward the bounds', () => {
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s', ['heavy', 'listed', 'light'], true)], conflictsItems: ['listed'] }),
    ['heavy', mod('heavy', { weight: 100, conflictsItems: [WEAPON] })],
    ['listed', mod('listed', { weight: 50 })],
    ['light', mod('light', { weight: 2 })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  assert.equal(bp.structurallyViable[occurrenceOf(bp, 'weapon_0/s:heavy')], 0);
  assert.equal(bp.structurallyViable[occurrenceOf(bp, 'weapon_0/s:listed')], 0);
  close(bp.rawBounds!.weight.max, 3);
  assert.equal(bp.stats.structurallyImpossibleOccurrences, 2);
});

test('an empty root required slot makes the receiver unbuildable: no raw bounds', () => {
  const bp = preparePhysicalWeapon(lookupOf(gun(WEAPON, { slots: [slot('r', [], true)] })), WEAPON);
  assert.equal(bp.structurallyViable[0], 0);
  assert.equal(bp.rawBounds, null);
  assert.equal(bp.slotCount, 1, 'the empty required slot is still a physical slot');
});

test('a required slot whose only candidates are ancestors is empty, not a throw', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m1'])] }),
    ['m1', mod('m1', { slots: [slot('loop', ['m1'], true)] })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const m1 = occurrenceOf(bp, 'weapon_0/s:m1');
  assert.equal(bp.structurallyViable[m1], 0, 'its required slot has no non-repeating candidate');
  assert.ok(bp.rawBounds, 'the optional root slot can stay empty');
});

test('template conflicts are symmetrized pairs, self-conflicts and receiver bans are flags, unknown ids are ignored', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'])], conflictsItems: ['m5'] }),
    ['m1', mod('m1', { conflictsItems: ['m2'] })],
    ['m2', mod('m2', { conflictsItems: ['m1'] })], // listed from both sides: still one pair
    ['m3', mod('m3', { conflictsItems: ['m3'] })], // self-conflict
    ['m4', mod('m4', { conflictsItems: [WEAPON] })], // lists the receiver
    ['m5', mod('m5')], // the receiver lists it
    ['m6', mod('m6', { conflictsItems: ['m1', 'nobody'] })], // m1 one-sided; 'nobody' has no template
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const t = (id: string) => bp.templateIndexOf(id);
  const pairs: string[] = [];
  for (let i = 0; i < bp.templateConflictPairs.length; i += 2) {
    pairs.push(`${bp.templateIds[bp.templateConflictPairs[i]]}|${bp.templateIds[bp.templateConflictPairs[i + 1]]}`);
  }
  assert.deepEqual(pairs, ['m1|m2', 'm1|m6']);
  assert.deepEqual([t('m1'), t('m2'), t('m3'), t('m4'), t('m5'), t('m6')].map(i => bp.templateSelfConflict[i]), [0, 0, 1, 0, 0, 0]);
  assert.deepEqual([t('m1'), t('m2'), t('m3'), t('m4'), t('m5'), t('m6')].map(i => bp.templateReceiverBanned[i]), [0, 0, 0, 1, 1, 0]);
});

test('slot conflicts match every physical slot of the raw slot id, across parents; ids matching no slot are dropped', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('a', ['holder']), slot('b', ['holder']), slot('x', ['blocker'])] }),
    ['holder', mod('holder', { slots: [slot('target', ['filler'])] })],
    ['filler', mod('filler')],
    ['blocker', mod('blocker', { conflictsSlots: ['target', 'noSuchSlot'] })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const blocked = bp.slotConflictsOf(bp.templateIndexOf('blocker'));
  assert.equal(blocked.length, 1);
  assert.equal(bp.rawSlotIds[blocked[0]], 'target');
  const physical = Array.from(bp.physicalSlotsOfRawId(blocked[0]));
  assert.equal(physical.length, 2, 'one physical slot per holder occurrence');
  assert.deepEqual(physical.map(s => bp.instanceId(bp.slotOwner(s))), ['weapon_0/a:holder', 'weapon_0/b:holder']);
  assert.equal(bp.rawSlotIndexOf('noSuchSlot'), -1);
  assert.equal(bp.slotConflictsOf(bp.templateIndexOf('filler')).length, 0);
});

test('the preset catalog keeps integer supply and rejects malformed presets', () => {
  const ok = lookupOf(
    gun(WEAPON, {
      slots: [slot('s', ['m1'])],
      presets: [
        { id: 'p1', items: [{ itemId: 'm1', count: 2 }, { itemId: 'm1', count: 1 }, { itemId: 'zero', count: 0 }, { itemId: 'ammo', count: 60 }] },
        { id: 'p2', items: [] },
      ],
    }),
    ['m1', mod('m1')],
  );
  const bp = preparePhysicalWeapon(ok, WEAPON);
  assert.deepEqual(bp.presets.map(p => [p.id, p.lookupIndex, [...p.supply]]), [
    ['p1', 0, [['m1', 3], ['ammo', 60]]],
    ['p2', 1, []],
  ]);

  const expectBad = (lookup: ReturnType<typeof lookupOf>) =>
    assert.throws(() => preparePhysicalWeapon(lookup, WEAPON), (e: unknown) => e instanceof PhysicalModelError && e.code === 'BAD_PRESET');
  expectBad(lookupOf(gun(WEAPON, { presets: [{ id: 'p', items: [{ itemId: 'm', count: 1.5 }] }] })));
  expectBad(lookupOf(gun(WEAPON, { presets: [{ id: 'p', items: [{ itemId: 'm', count: -1 }] }] })));
  expectBad(lookupOf(gun(WEAPON, { presets: [{ id: 'p', items: [] }, { id: 'p', items: [] }] })));
  const wrong = gun(WEAPON, { presets: [{ id: 'p', items: [] }] });
  wrong.all_presets[0].receiver_id = 'another-gun';
  expectBad(lookupOf(wrong));
});

test('category chains come from the nested bsgCategory chain, or an override', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m1', 'm2'])] }),
    ['m1', mod('m1', { categories: ['leaf', 'branch', 'root'] })],
    ['m2', mod('m2')],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  assert.deepEqual(bp.templateCategoryChain[bp.templateIndexOf('m1')], ['leaf', 'branch', 'root']);
  assert.deepEqual(bp.templateCategoryChain[bp.templateIndexOf('m2')], []);

  const own = preparePhysicalWeapon(lookup, WEAPON, { categoryChainOf: id => [`own-${id}`, 'all'] });
  assert.deepEqual(own.templateCategoryChain[own.templateIndexOf('m1')], ['own-m1', 'all']);
});

test('preparation is deterministic, never mutates the lookup, and returns a frozen blueprint', () => {
  const build = () => lookupOf(
    gun(WEAPON, { slots: [slot('a', ['m1', 'm2']), slot('b', ['m2'], true)] }),
    ['m1', mod('m1', { slots: [slot('c', ['m2'])] })],
    ['m2', mod('m2', { weight: 0.5 })],
  );
  const lookup = build();
  const before = JSON.stringify(lookup);
  const first = preparePhysicalWeapon(lookup, WEAPON);
  const second = preparePhysicalWeapon(lookup, WEAPON);
  assert.equal(JSON.stringify(lookup), before, 'the lookup is untouched');
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(first.templateIds, second.templateIds);
  for (const key of ['occTemplate', 'occParentSlot', 'occSlotStart', 'slotOwnerArray', 'slotRawIdArray', 'slotRequiredArray', 'slotCandStart', 'slotCandCount', 'weightMin', 'weightMax'] as const) {
    assert.deepEqual(Array.from(first[key]), Array.from(second[key]), key);
  }
  // A structurally equal lookup built independently yields the same indexes (no dependence on object identity).
  const third = preparePhysicalWeapon(build(), WEAPON);
  assert.deepEqual(Array.from(third.occTemplate), Array.from(first.occTemplate));
  assert.deepEqual(Array.from({ length: first.occurrenceCount }, (_, v) => first.instanceId(v)), Array.from({ length: third.occurrenceCount }, (_, v) => third.instanceId(v)));
});

test('every instance id resolves back to its occurrence', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('a', ['m1', 'm2']), slot('b', ['m1'])] }),
    ['m1', mod('m1', { slots: [slot('c', ['m2', 'm3'])] })],
    ['m2', mod('m2', { slots: [slot('d', ['m3'])] })],
    ['m3', mod('m3')],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const ids = new Set<string>();
  for (let v = 0; v < bp.occurrenceCount; v++) {
    const id = bp.instanceId(v);
    assert.ok(!ids.has(id), `duplicate instance id ${id}`);
    ids.add(id);
    assert.equal(bp.occurrenceByInstanceId(id), v);
  }
  assert.equal(bp.occurrenceByInstanceId('weapon_0/zzz:m1'), -1);
  assert.equal(bp.occurrenceByInstanceId('other_0/a:m1'), -1);
});

test('an exploding universe stops at the safety limit with a typed error, not an infeasibility', () => {
  // Three slots of three candidates, each candidate with three slots of the same three candidates, and so on, over distinct templates.
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const mods = ids.map(id => [id, mod(id, { slots: [slot(`${id}1`, ids), slot(`${id}2`, ids), slot(`${id}3`, ids)] })] as [string, ReturnType<typeof mod>]);
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('r1', ids), slot('r2', ids)] }), ...mods);
  assert.throws(
    () => preparePhysicalWeapon(lookup, WEAPON, { maxOccurrences: 50 }),
    (e: unknown) => e instanceof PhysicalModelError && e.code === 'OCCURRENCE_LIMIT',
  );
});
