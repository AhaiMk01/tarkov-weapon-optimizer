import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceItem, ReferenceRequest, ReferenceSlot, ReferenceWeapon } from './domain';
import { makeBuild, type PlacementEdge, type ReferenceBuild } from './build';
import { validateReference } from './validate';

const R = 'weapon_0';
const trader = (price = 100) => [{ kind: 'trader' as const, trader: 'prapor', level: 1, price }];
const slot = (id: string, allowedItemIds: string[], required = false): ReferenceSlot => ({ id, allowedItemIds, required });

/** Items default to a cheap trader offer so spend-related rules stay out of the way. */
function fixtureOf(items: ReferenceItem[], weapon: Partial<ReferenceWeapon> = {}, extra: Partial<ReferenceFixture> = {}): ReferenceFixture {
  return {
    schemaVersion: 1,
    items: items.map(i => ({ offers: trader(), ...i })),
    weapons: [{ id: 'gun', offers: trader(1000), ...weapon }],
    ...extra,
  };
}
const naked = (...edges: PlacementEdge[]): ReferenceBuild => makeBuild({ kind: 'naked' }, ...edges);
const codes = (fixture: ReferenceFixture, request: Partial<ReferenceRequest>, build: ReferenceBuild) =>
  validateReference(fixture, { weapon_id: 'gun', ...request }, build).violations.map(v => v.code);
const accepts = (fixture: ReferenceFixture, request: Partial<ReferenceRequest>, build: ReferenceBuild) => {
  const result = validateReference(fixture, { weapon_id: 'gun', ...request }, build);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
};
const rejects = (fixture: ReferenceFixture, request: Partial<ReferenceRequest>, build: ReferenceBuild, code: string) => {
  const result = validateReference(fixture, { weapon_id: 'gun', ...request }, build);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some(v => v.code === code), `expected ${code}, got ${result.violations.map(v => v.code).join(',') || 'none'}`);
};

// --- structure ---------------------------------------------------------------------------------

test('a well formed rooted build is accepted, including the empty build', () => {
  const f = fixtureOf([{ id: 'a', slots: [slot('t', ['b'])] }, { id: 'b' }], { slots: [slot('s', ['a'])] });
  accepts(f, {}, naked());
  accepts(f, {}, naked([R, 's', 'a'], [`${R}/s:a`, 't', 'b']));
});

test('external builds with arbitrary instance ids are accepted when the structure is sound', () => {
  const f = fixtureOf([{ id: 'a' }], { slots: [slot('s', ['a'])] });
  accepts(f, {}, { base: { kind: 'naked' }, placements: [{ parentInstanceId: R, slotId: 's', childInstanceId: 'inst-77', itemId: 'a' }] });
  accepts(f, {}, { base: { kind: 'naked' }, rootInstanceId: 'receiver', placements: [{ parentInstanceId: 'receiver', slotId: 's', childInstanceId: 'x', itemId: 'a' }] });
});

test('rootedness: a floating cycle and an unknown parent are rejected', () => {
  const f = fixtureOf([{ id: 'a', slots: [slot('t', ['b'])] }, { id: 'b', slots: [slot('u', ['a'])] }], { slots: [slot('s', ['a'])] });
  const cycle: ReferenceBuild = {
    base: { kind: 'naked' },
    placements: [
      { parentInstanceId: 'B', slotId: 't', childInstanceId: 'A', itemId: 'a' },
      { parentInstanceId: 'A', slotId: 'u', childInstanceId: 'B', itemId: 'b' },
    ],
  };
  rejects(f, {}, cycle, 'UNROOTED_PLACEMENT');
  const orphan: ReferenceBuild = {
    base: { kind: 'naked' },
    placements: [{ parentInstanceId: 'ghost', slotId: 't', childInstanceId: 'A', itemId: 'a' }],
  };
  rejects(f, {}, orphan, 'UNKNOWN_PARENT_INSTANCE');
});

test('a descendant whose parent is not installed is unrooted: deactivating a parent removes the subtree', () => {
  const f = fixtureOf([{ id: 'a', slots: [slot('t', ['b'])] }, { id: 'b' }], { slots: [slot('s', ['a'])] });
  // child b attached to an a-instance that is not in the build
  rejects(f, {}, naked([`${R}/s:a`, 't', 'b']), 'UNKNOWN_PARENT_INSTANCE');
});

test('duplicate child instance ids are rejected', () => {
  const f = fixtureOf([{ id: 'a' }], { slots: [slot('s1', ['a']), slot('s2', ['a'])] });
  const dup: ReferenceBuild = {
    base: { kind: 'naked' },
    placements: [
      { parentInstanceId: R, slotId: 's1', childInstanceId: 'same', itemId: 'a' },
      { parentInstanceId: R, slotId: 's2', childInstanceId: 'same', itemId: 'a' },
    ],
  };
  rejects(f, {}, dup, 'DUPLICATE_INSTANCE_ID');
});

test('per-occurrence slot capacity: two children in one physical slot are rejected, siblings in distinct slots are fine', () => {
  const f = fixtureOf([{ id: 'a' }, { id: 'b' }], { slots: [slot('s', ['a', 'b']), slot('s2', ['a'])] });
  rejects(f, {}, naked([R, 's', 'a'], [R, 's', 'b']), 'SLOT_CAPACITY_EXCEEDED');
  accepts(f, {}, naked([R, 's', 'a'], [R, 's2', 'a'])); // multi-copy placement
});

test('the same template slot id on two parent instances is two independent physical slots', () => {
  const f = fixtureOf([{ id: 'p', slots: [slot('rail', ['x'])] }, { id: 'x' }], { slots: [slot('s1', ['p']), slot('s2', ['p'])] });
  accepts(f, {}, naked([R, 's1', 'p'], [R, 's2', 'p'], [`${R}/s1:p`, 'rail', 'x'], [`${R}/s2:p`, 'rail', 'x']));
});

test('allowed items, known slots and known items are enforced', () => {
  const f = fixtureOf([{ id: 'a' }, { id: 'z' }], { slots: [slot('s', ['a'])] });
  rejects(f, {}, naked([R, 's', 'z']), 'ITEM_NOT_ALLOWED_IN_SLOT');
  rejects(f, {}, naked([R, 'nope', 'a']), 'UNKNOWN_SLOT');
  rejects(f, {}, naked([R, 's', 'ghost']), 'UNKNOWN_ITEM');
  rejects(f, {}, naked([R, 's', 'gun']), 'UNKNOWN_ITEM'); // the receiver is not an installable mod
});

test('no ancestor-template repetition', () => {
  const f = fixtureOf(
    [{ id: 'a', slots: [slot('t', ['a', 'b'])] }, { id: 'b', slots: [slot('u', ['a'])] }],
    { slots: [slot('s', ['a'])] },
  );
  rejects(f, {}, naked([R, 's', 'a'], [`${R}/s:a`, 't', 'a']), 'ANCESTOR_TEMPLATE_REPETITION');
  rejects(f, {}, naked([R, 's', 'a'], [`${R}/s:a`, 't', 'b'], [`${R}/s:a/t:b`, 'u', 'a']), 'ANCESTOR_TEMPLATE_REPETITION');
  accepts(f, {}, naked([R, 's', 'a'], [`${R}/s:a`, 't', 'b']));
});

// --- required occupancy --------------------------------------------------------------------------

test('a required root slot must be filled', () => {
  const f = fixtureOf([{ id: 'a' }], { slots: [slot('s', ['a'], true)] });
  rejects(f, {}, naked(), 'MISSING_REQUIRED_SLOT');
  accepts(f, {}, naked([R, 's', 'a']));
});

test('a mod-owned required slot must be filled whenever its owner is present, and imposes nothing when absent', () => {
  const f = fixtureOf(
    [{ id: 'owner', slots: [slot('need', ['filler'], true)] }, { id: 'filler' }, { id: 'alt' }],
    { slots: [slot('s', ['owner', 'alt'])] },
  );
  rejects(f, {}, naked([R, 's', 'owner']), 'MISSING_REQUIRED_SLOT');
  accepts(f, {}, naked([R, 's', 'owner'], [`${R}/s:owner`, 'need', 'filler']));
  accepts(f, {}, naked([R, 's', 'alt'])); // alternative attachment survives
  accepts(f, {}, naked());
});

test('one filler does not satisfy two required slots on separate owners', () => {
  const f = fixtureOf(
    [{ id: 'owner', slots: [slot('need', ['filler'], true)] }, { id: 'filler' }],
    { slots: [slot('s1', ['owner']), slot('s2', ['owner'])] },
  );
  rejects(f, {}, naked([R, 's1', 'owner'], [R, 's2', 'owner'], [`${R}/s1:owner`, 'need', 'filler']), 'MISSING_REQUIRED_SLOT');
  accepts(f, {}, naked([R, 's1', 'owner'], [R, 's2', 'owner'], [`${R}/s1:owner`, 'need', 'filler'], [`${R}/s2:owner`, 'need', 'filler']));
});

// --- conflicts -----------------------------------------------------------------------------------

test('template presence conflicts are symmetric even when only one side lists the other; copies of A stay legal', () => {
  const f = fixtureOf(
    [{ id: 'a', conflictingItemIds: ['b'] }, { id: 'b' }],
    { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] },
  );
  rejects(f, {}, naked([R, 's1', 'a'], [R, 's2', 'b']), 'TEMPLATE_CONFLICT');
  rejects(f, {}, naked([R, 's1', 'b'], [R, 's2', 'a']), 'TEMPLATE_CONFLICT');
  accepts(f, {}, naked([R, 's1', 'a'], [R, 's2', 'a'])); // A + A without B
  accepts(f, {}, naked([R, 's1', 'b'], [R, 's2', 'b']));
});

test('an item that lists the receiver as a conflict cannot be installed', () => {
  const f = fixtureOf([{ id: 'a', conflictingItemIds: ['gun'] }], { slots: [slot('s', ['a'])] });
  rejects(f, {}, naked([R, 's', 'a']), 'TEMPLATE_CONFLICT');
});

test('self-conflict caps installed copies at one', () => {
  const f = fixtureOf([{ id: 'a', conflictingItemIds: ['a'] }], { slots: [slot('s1', ['a']), slot('s2', ['a'])] });
  accepts(f, {}, naked([R, 's1', 'a']));
  rejects(f, {}, naked([R, 's1', 'a'], [R, 's2', 'a']), 'SELF_CONFLICT_COPY_CAP');
});

test('slot conflicts force every matching physical slot empty, wherever it is, and nothing else', () => {
  const f = fixtureOf(
    [
      { id: 'blocker', conflictingSlotIds: ['rail'] },
      { id: 'host', slots: [slot('rail', ['x'])] },
      { id: 'x' },
    ],
    { slots: [slot('s1', ['blocker', 'host']), slot('s2', ['host', 'blocker'])] },
  );
  const hostRail = naked([R, 's1', 'host'], [`${R}/s1:host`, 'rail', 'x']);
  rejects(f, {}, { ...hostRail, placements: [...hostRail.placements, { parentInstanceId: R, slotId: 's2', childInstanceId: 'b', itemId: 'blocker' }] }, 'SLOT_CONFLICT');
  accepts(f, {}, naked([R, 's1', 'host'], [R, 's2', 'blocker'])); // the rail exists but is empty
  accepts(f, {}, hostRail); // no blocker present
  accepts(f, {}, naked([R, 's1', 'blocker'])); // blocker alone is fine: an unblocked alternative is used
});

test('interpretation 11: a blocker blocks every occupied slot with a listed id, including the slot it occupies itself', () => {
  // `x` lists its own host slot `s`: installing it there is a slot conflict, leaving `s` empty is fine.
  const f = fixtureOf([{ id: 'x', conflictingSlotIds: ['s'] }], { slots: [slot('s', ['x'])] });
  rejects(f, {}, naked([R, 's', 'x']), 'SLOT_CONFLICT');
  accepts(f, {}, naked());
});

// --- includes / excludes --------------------------------------------------------------------------

test('item and category excludes reject installed matches', () => {
  const f = fixtureOf([{ id: 'a', categories: ['leaf', 'parent'] }], { slots: [slot('s', ['a'])] });
  rejects(f, { exclude_items: ['a'] }, naked([R, 's', 'a']), 'EXCLUDED_ITEM');
  rejects(f, { exclude_categories: ['leaf'] }, naked([R, 's', 'a']), 'EXCLUDED_CATEGORY');
  rejects(f, { exclude_categories: ['parent'] }, naked([R, 's', 'a']), 'EXCLUDED_CATEGORY'); // chain match
  accepts(f, { exclude_categories: ['other'] }, naked([R, 's', 'a']));
  accepts(f, { exclude_items: ['a'] }, naked());
});

test('item includes need at least one installed copy; duplicates in the request add nothing', () => {
  const f = fixtureOf([{ id: 'a' }, { id: 'b' }], { slots: [slot('s', ['a', 'b'])] });
  rejects(f, { include_items: ['a'] }, naked([R, 's', 'b']), 'MISSING_INCLUDE_ITEM');
  accepts(f, { include_items: ['a', 'a'] }, naked([R, 's', 'a']));
});

test('category group includes are OR within a group and AND across groups; an empty group is unsatisfiable', () => {
  const f = fixtureOf(
    [{ id: 'a', categories: ['c1'] }, { id: 'b', categories: ['c2'] }],
    { slots: [slot('s1', ['a', 'b']), slot('s2', ['a', 'b'])] },
  );
  accepts(f, { include_categories: [['c1', 'c2']] }, naked([R, 's1', 'b']));
  rejects(f, { include_categories: [['c1'], ['c2']] }, naked([R, 's1', 'a']), 'MISSING_INCLUDE_CATEGORY_GROUP');
  accepts(f, { include_categories: [['c1'], ['c2']] }, naked([R, 's1', 'a'], [R, 's2', 'b']));
  rejects(f, { include_categories: [[]] }, naked([R, 's1', 'a']), 'MISSING_INCLUDE_CATEGORY_GROUP');
});

test('include groups match through the category chain, like exclusions (interpretation 5, owner decision 2026-10-04)', () => {
  // a and b sit in sibling leaf categories under one parent; z is elsewhere. A group naming the parent is matched only through the ancestor
  // chain; a group naming the finest category agrees with the chain rule for items of that leaf.
  const f = fixtureOf(
    [
      { id: 'a', categories: ['leaf-a', 'parent'] },
      { id: 'b', categories: ['leaf-b', 'parent'] },
      { id: 'z', categories: ['elsewhere'] },
    ],
    { slots: [slot('s1', ['a', 'b', 'z']), slot('s2', ['a', 'b', 'z'])] },
  );
  accepts(f, { include_categories: [['parent']] }, naked([R, 's1', 'a']));
  accepts(f, { include_categories: [['parent']] }, naked([R, 's1', 'b']));
  rejects(f, { include_categories: [['parent']] }, naked([R, 's1', 'z']), 'MISSING_INCLUDE_CATEGORY_GROUP');
  accepts(f, { include_categories: [['leaf-a']] }, naked([R, 's1', 'a']));
  rejects(f, { include_categories: [['leaf-a']] }, naked([R, 's1', 'b']), 'MISSING_INCLUDE_CATEGORY_GROUP');
  // groups stay conjunctive: one item can satisfy two groups (its leaf and its parent), but two sibling leaves need two items
  accepts(f, { include_categories: [['leaf-a'], ['parent']] }, naked([R, 's1', 'a']));
  rejects(f, { include_categories: [['leaf-a'], ['leaf-b']] }, naked([R, 's1', 'a']), 'MISSING_INCLUDE_CATEGORY_GROUP');
  accepts(f, { include_categories: [['leaf-a'], ['leaf-b']] }, naked([R, 's1', 'a'], [R, 's2', 'b']));
});

// --- acquisition ----------------------------------------------------------------------------------

test('a standalone-inaccessible item is capped by owned stock', () => {
  const f = fixtureOf([{ id: 'rare', offers: [] }], { slots: [slot('s1', ['rare']), slot('s2', ['rare'])] });
  rejects(f, {}, naked([R, 's1', 'rare']), 'QUANTITY_CAP_EXCEEDED');
  accepts(f, { owned_items: ['rare'] }, naked([R, 's1', 'rare']));
  rejects(f, { owned_items: ['rare'] }, naked([R, 's1', 'rare'], [R, 's2', 'rare']), 'QUANTITY_CAP_EXCEEDED');
  accepts(f, { owned_items: ['rare', 'rare'] }, naked([R, 's1', 'rare'], [R, 's2', 'rare']));
});

test('a preset count of 2 supplies two copies of an otherwise inaccessible item, but not three', () => {
  const f = fixtureOf(
    [{ id: 'rare', offers: [] }],
    { slots: [slot('s1', ['rare']), slot('s2', ['rare']), slot('s3', ['rare'])] },
    { presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'rare', count: 2 }], offers: trader(5000) }] },
  );
  const pre = { kind: 'preset' as const, presetId: 'pre' };
  accepts(f, {}, makeBuild(pre, [R, 's1', 'rare'], [R, 's2', 'rare']));
  rejects(f, {}, makeBuild(pre, [R, 's1', 'rare'], [R, 's2', 'rare'], [R, 's3', 'rare']), 'QUANTITY_CAP_EXCEEDED');
  rejects(f, {}, naked([R, 's1', 'rare']), 'QUANTITY_CAP_EXCEEDED'); // naked base gets no preset supply
});

test('owned stock never overrides an exclusion', () => {
  const f = fixtureOf([{ id: 'a' }], { slots: [slot('s', ['a'])] });
  rejects(f, { owned_items: ['a'], exclude_items: ['a'] }, naked([R, 's', 'a']), 'EXCLUDED_ITEM');
});

test('base accessibility: unknown preset, preset of another weapon, and no legal offer', () => {
  const f = fixtureOf(
    [{ id: 'a' }],
    { slots: [slot('s', ['a'])] },
    {
      weapons: [{ id: 'gun', offers: trader(1000) }, { id: 'other', offers: trader() }],
      presets: [{ id: 'foreign', weaponId: 'other', components: [], offers: trader() }],
    },
  );
  rejects(f, {}, makeBuild({ kind: 'preset', presetId: 'nope' }), 'BASE_UNKNOWN_PRESET');
  rejects(f, {}, makeBuild({ kind: 'preset', presetId: 'foreign' }), 'BASE_WRONG_WEAPON');
  // prapor 0 and no preset of gun: nothing can be bought, so the naked receiver is the player's own (interpretation 18)
  accepts(f, { trader_levels: { prapor: 0 } }, naked());
  // a preset of gun sold by Skier: the locked naked receiver is inaccessible, stash or no stash
  const g = fixtureOf(
    [{ id: 'a' }],
    { slots: [slot('s', ['a'])] },
    {
      weapons: [{ id: 'gun', offers: trader(1000) }],
      presets: [{ id: 'own', weaponId: 'gun', components: [], offers: [{ kind: 'trader', trader: 'skier', level: 1, price: 2000 }] }],
    },
  );
  rejects(g, { trader_levels: { prapor: 0 } }, naked(), 'BASE_INACCESSIBLE');
  rejects(g, { owned_items: ['gun'], trader_levels: { prapor: 0 } }, naked(), 'BASE_INACCESSIBLE');
  // a preset is never owned: with nothing to buy, the preset base is still inaccessible and the naked receiver is accepted
  rejects(g, { trader_levels: { prapor: 0, skier: 0 } }, makeBuild({ kind: 'preset', presetId: 'own' }), 'BASE_INACCESSIBLE');
  accepts(g, { trader_levels: { prapor: 0, skier: 0 } }, naked());
});

// --- hard caps (exact boundaries) ------------------------------------------------------------------

const capFixture = fixtureOf(
  [{
    id: 'm', weightKg: 0.5, ergonomics: -10, recoilModifier: -0.5, accuracyModifier: 0, magazineCapacity: 30,
    sightingRange: 200, centerOfImpact: 0.5, offers: trader(400),
  }],
  { weightKg: 2, ergonomics: 50, recoilVertical: 100, recoilHorizontal: 60, centerOfImpact: 0.25, slots: [slot('s', ['m'])], offers: trader(1000) },
);
const withM = naked([R, 's', 'm']);

test('max_price boundary is exact and a zero cap is a real cap', () => {
  accepts(capFixture, { max_price: 1400 }, withM);
  rejects(capFixture, { max_price: 1399.9999999999998 }, withM, 'MAX_PRICE_EXCEEDED');
  rejects(capFixture, { max_price: 0 }, naked(), 'MAX_PRICE_EXCEEDED');
});

test('min_ergonomics compares the clamped ergonomics', () => {
  accepts(capFixture, { min_ergonomics: 40 }, withM);
  rejects(capFixture, { min_ergonomics: 40.00000000000001 }, withM, 'MIN_ERGONOMICS_NOT_MET');
});

test('recoil caps convert to final recoil: vertical and vertical + horizontal', () => {
  // final V = 100 x 0.5 = 50, H = 30
  accepts(capFixture, { max_recoil_v: 50, max_recoil_sum: 80 }, withM);
  rejects(capFixture, { max_recoil_v: 49.99999999999999 }, withM, 'MAX_RECOIL_V_EXCEEDED');
  rejects(capFixture, { max_recoil_sum: 79.99999999999999 }, withM, 'MAX_RECOIL_SUM_EXCEEDED');
  accepts(capFixture, { max_recoil_v: 100 }, withM);
});

test('magazine and sighting minimums are boundaries on the best installed value', () => {
  accepts(capFixture, { min_mag_capacity: 30, min_sighting_range: 200 }, withM);
  rejects(capFixture, { min_mag_capacity: 31 }, withM, 'MIN_MAGAZINE_NOT_MET');
  rejects(capFixture, { min_sighting_range: 201 }, withM, 'MIN_SIGHTING_NOT_MET');
  rejects(capFixture, { min_mag_capacity: 1 }, naked(), 'MIN_MAGAZINE_NOT_MET');
});

test('max_weight boundary is exact in rationals', () => {
  accepts(capFixture, { max_weight: 2.5 }, withM);
  rejects(capFixture, { max_weight: 2.4999999999999996 }, withM, 'MAX_WEIGHT_EXCEEDED');
});

test('max_moa uses the replacement barrel COI and the provisional K', () => {
  // barrel COI 0.5 replaces 0.25: MOA = 0.5 x 1000000/29089 = 17.188628...
  accepts(capFixture, { max_moa: 17.2 }, withM);
  rejects(capFixture, { max_moa: 17.18 }, withM, 'MAX_MOA_EXCEEDED');
  accepts(capFixture, { max_moa: 8.6 }, naked()); // intrinsic COI 0.25 -> 8.594314
  rejects(capFixture, { max_moa: 8.59 }, naked(), 'MAX_MOA_EXCEEDED');
});

test('prevent_overswing is the exact TED >= 0 boundary at 3 kg', () => {
  const heavy = (weightKg: number) => fixtureOf([], { weightKg, ergonomics: 0, offers: trader() });
  accepts(heavy(3), { prevent_overswing: true }, naked());
  rejects(heavy(3.0625), { prevent_overswing: true }, naked(), 'OVERSWING_PREVENTED');
  accepts(heavy(3.0625), {}, naked());
  accepts(fixtureOf([], { weightKg: 3.0625, ergonomics: 10, offers: trader() }), { prevent_overswing: true }, naked());
});

test('prevent_overswing honours the gear factor', () => {
  const f = fixtureOf([], { weightKg: 4, ergonomics: 40, offers: trader() });
  // factor 1: effective 40, penalty 25 -> TED 15; factor 1/2: effective 20 -> TED -5
  accepts(f, { prevent_overswing: true }, naked());
  rejects(f, { prevent_overswing: true, equip_ergo_modifier: -0.5 }, naked(), 'OVERSWING_PREVENTED');
});

test('violations carry stable codes and details, and ok mirrors them', () => {
  const f = fixtureOf([{ id: 'a' }], { slots: [slot('s', ['a'], true)] });
  const res = validateReference(f, { weapon_id: 'gun' }, naked());
  assert.equal(res.ok, false);
  assert.deepEqual(res.violations.map(v => v.code), ['MISSING_REQUIRED_SLOT']);
  assert.match(res.violations[0].detail, /s/);
  assert.deepEqual(codes(f, {}, naked([R, 's', 'a'])), []);
});
