import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFixture, checkRequest, ReferenceInputError, type ReferenceFixture } from './domain';
import { resolveFixture, resolveRequest, traderLevelOf } from './resolve';
import { fromBinary64, q } from './q';

const base: ReferenceFixture = {
  schemaVersion: 1,
  items: [
    { id: 'mount', weightKg: 0.0155, ergonomics: 2, slots: [{ id: 's1', allowedItemIds: [] }] },
    { id: 'grip', recoilModifier: -0.05, accuracyModifier: -3, centerOfImpact: 0.053 },
  ],
  weapons: [{ id: 'gun', ergonomics: 45, recoilVertical: 100, recoilHorizontal: 200, slots: [{ id: 'r1', allowedItemIds: ['mount', 'grip'] }] }],
  presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'grip', count: 1 }, { itemId: 'grip', count: 1 }, { itemId: 'mount', count: 3 }] }],
};

test('well formed fixture has no issues and resolves with defaults applied once', () => {
  assert.deepEqual(checkFixture(base), []);
  const rf = resolveFixture(base);
  const grip = rf.items.get('grip')!;
  assert.deepEqual(grip.weight, q(0));
  assert.deepEqual(grip.recoilModifier, fromBinary64(-0.05));
  assert.deepEqual(grip.centerOfImpact, fromBinary64(0.053));
  assert.deepEqual(grip.slots, []);
  assert.equal(grip.conflictingItemIds.size, 0);
  assert.equal(rf.weapons.get('gun')!.slots[0].required, false);
});

test('fractional kilograms decode to the exact binary64 value, not a decimal or an integer rounding', () => {
  const mount = resolveFixture(base).items.get('mount')!;
  assert.deepEqual(mount.weight, fromBinary64(0.0155));
  assert.notDeepEqual(mount.weight, q(31, 2000));
  assert.notDeepEqual(mount.weight, q(0));
});

test('preset supply sums repeated component entries and preserves counts above one', () => {
  const pre = resolveFixture(base).presets.get('pre')!;
  assert.equal(pre.supply.get('grip'), 2);
  assert.equal(pre.supply.get('mount'), 3);
});

test('resolveFixture memoizes per fixture object', () => {
  assert.equal(resolveFixture(base), resolveFixture(base));
});

test('checkFixture reports structural problems with stable codes', () => {
  const broken: ReferenceFixture = {
    schemaVersion: 1,
    items: [
      { id: 'a', slots: [{ id: 's', allowedItemIds: ['ghost'] }, { id: 's', allowedItemIds: [] }], weightKg: Number.NaN },
      { id: 'a' },
      { id: 'b', offers: [{ kind: 'barter', trader: 't', level: 1, requirements: [{ count: 1.5 }], offeredCount: 0 }] },
    ],
    weapons: [{ id: 'a' }, { id: 'w' }],
    presets: [
      { id: 'p', weaponId: 'nowhere', components: [{ itemId: 'zzz', count: -1 }] },
      { id: 'p', weaponId: 'w', components: [] },
    ],
  };
  const codes = checkFixture(broken).map(i => i.code);
  for (const code of ['DUPLICATE_ID', 'UNKNOWN_ALLOWED_ITEM', 'DUPLICATE_SLOT_ID', 'BAD_NUMBER', 'BAD_OFFER',
    'UNKNOWN_PRESET_WEAPON', 'BAD_COUNT', 'UNKNOWN_PRESET_COMPONENT', 'DUPLICATE_PRESET_ID']) {
    assert.ok(codes.includes(code), `missing ${code} in ${codes.join(',')}`);
  }
  assert.throws(() => resolveFixture(broken), ReferenceInputError);
  assert.equal(checkFixture({ ...base, schemaVersion: 2 as unknown as 1 })[0].code, 'BAD_SCHEMA_VERSION');
});

test('request defaults: weights 1,1,0, flea on, barter off, no caps, empty stock', () => {
  const rr = resolveRequest(base, { weapon_id: 'gun' });
  assert.deepEqual(rr.objective, { kind: 'weighted', weights: { e: q(1), r: q(1), p: q(0) } });
  assert.equal(rr.fleaAvailable, true);
  assert.equal(rr.barterAvailable, false);
  assert.equal(rr.barterExcludeDogtags, false);
  assert.equal(rr.maxPrice, null);
  assert.equal(rr.playerLevel, null);
  assert.equal(rr.owned.size, 0);
  assert.deepEqual(rr.gearFactor, q(1));
  assert.equal(rr.useTrueErgo, false);
  assert.equal(rr.preventOverswing, false);
});

test('zero caps are real caps, and negative weights resolve to zero', () => {
  const rr = resolveRequest(base, { weapon_id: 'gun', max_price: 0, max_moa: 0, ergo_weight: -2, recoil_weight: 0.4 });
  assert.deepEqual(rr.maxPrice, q(0));
  assert.deepEqual(rr.maxMoa, q(0));
  assert.deepEqual(rr.objective.weights.e, q(0));
  assert.deepEqual(rr.objective.weights.r, fromBinary64(0.4));
});

test('gear factor is max(0, 1 + modifier)', () => {
  assert.deepEqual(resolveRequest(base, { weapon_id: 'gun', equip_ergo_modifier: -0.5 }).gearFactor, q(1, 2));
  assert.deepEqual(resolveRequest(base, { weapon_id: 'gun', equip_ergo_modifier: -3 }).gearFactor, q(0));
  assert.deepEqual(resolveRequest(base, { weapon_id: 'gun', equip_ergo_modifier: 0.25 }).gearFactor, q(5, 4));
});

test('owned_items is a multiset and trader levels default to 4 with 0 disabling', () => {
  const rr = resolveRequest(base, { weapon_id: 'gun', owned_items: ['a', 'b', 'a'], trader_levels: { prapor: 0, skier: 2 } });
  assert.equal(rr.owned.get('a'), 2);
  assert.equal(rr.owned.get('b'), 1);
  assert.equal(traderLevelOf(rr, 'prapor'), 0);
  assert.equal(traderLevelOf(rr, 'skier'), 2);
  assert.equal(traderLevelOf(rr, 'jaeger'), 4);
});

test('malformed requests are input errors, not infeasibility', () => {
  assert.throws(() => resolveRequest(base, { weapon_id: 'nope' }), ReferenceInputError);
  assert.throws(() => resolveRequest(base, { weapon_id: 'gun', use_tchebycheff: true }), ReferenceInputError);
  assert.throws(() => resolveRequest(base, { weapon_id: 'gun', max_price: Number.POSITIVE_INFINITY }), ReferenceInputError);
  // eslint-disable-next-line no-sparse-arrays
  assert.throws(() => resolveRequest(base, { weapon_id: 'gun', owned_items: ['a', , 'b'] as string[] }), ReferenceInputError);
  assert.throws(() => resolveRequest(base, { weapon_id: 'gun', owned_items: [''] }), ReferenceInputError);
  assert.deepEqual(checkRequest(base, { weapon_id: 'gun' }), []);
});

test('tchebycheff request decodes the ideal point exactly', () => {
  const rr = resolveRequest(base, {
    weapon_id: 'gun', use_tchebycheff: true, ideal_point: { zE: 600, nadE: 300, zR: -400, nadR: -100, zP: 0, nadP: 90000 },
  });
  assert.equal(rr.objective.kind, 'tchebycheff');
  if (rr.objective.kind === 'tchebycheff') assert.deepEqual(rr.objective.ideal.nadP, q(90000));
});
