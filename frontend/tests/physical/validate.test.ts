// The occurrence-level production validator (ADR 0010 section 5, ADR 0003 section 5): every reference violation code, accept and reject at
// each boundary, with exact rational arithmetic. The differential test (reference/harness/validator.differential.test.ts) holds the same
// validator to the reference on every ledger case; these tests pin each rule on a hand-built lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PhysicalModelError, preparePhysicalValidator, validatePhysicalBuild,
  type PhysicalBuild, type PhysicalPlacement, type PhysicalValidation, type PhysicalValidationRequest, type PhysicalViolationCode,
  type ValidatePhysicalOptions,
} from '../../src/solver/physical';
import { ratAdd, ratCmp, ratFromDouble } from '../../src/solver/physical/exact';
import { nextDown, nextUp } from '../../src/solver/physical/numeric';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { barter, flea, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';

const W = WEAPON;
const R = 'weapon_0';

const edge = (parent: string, slotId: string, itemId: string): PhysicalPlacement => ({
  parentInstanceId: parent, slotId, childInstanceId: `${parent}/${slotId}:${itemId}`, itemId,
});
const nakedOf = (...placements: PhysicalPlacement[]): PhysicalBuild => ({ base: { kind: 'naked' }, placements });
const presetOf = (presetId: string, ...placements: PhysicalPlacement[]): PhysicalBuild => ({ base: { kind: 'preset', presetId }, placements });
const at = (parent: string, slotId: string, itemId: string): string => `${parent}/${slotId}:${itemId}`;

const run = (lookup: ItemLookup, request: Partial<PhysicalValidationRequest>, build: PhysicalBuild, options?: ValidatePhysicalOptions): PhysicalValidation =>
  validatePhysicalBuild(lookup, { weaponId: W, ...request }, build, options);
const codesOf = (result: PhysicalValidation): PhysicalViolationCode[] => [...new Set(result.violations.map(v => v.code))].sort();
const codes = (lookup: ItemLookup, request: Partial<PhysicalValidationRequest>, build: PhysicalBuild, options?: ValidatePhysicalOptions) =>
  codesOf(run(lookup, request, build, options));
const accepts = (lookup: ItemLookup, request: Partial<PhysicalValidationRequest>, build: PhysicalBuild, options?: ValidatePhysicalOptions): PhysicalValidation => {
  const result = run(lookup, request, build, options);
  assert.deepEqual(result.violations, [], 'the build is accepted');
  assert.equal(result.ok, true);
  return result;
};
const rejects = (lookup: ItemLookup, request: Partial<PhysicalValidationRequest>, build: PhysicalBuild, ...expected: PhysicalViolationCode[]): PhysicalValidation => {
  const result = run(lookup, request, build);
  assert.equal(result.ok, false);
  assert.deepEqual(codesOf(result), [...expected].sort());
  return result;
};

// ---------------------------------------------------------------------------------------------
// Structure: instances, rootedness, slots
// ---------------------------------------------------------------------------------------------

const treeLookup = () => lookupOf(
  gunWith(W, { slots: [slot('s1', ['a']), slot('s2', ['a'])] }),
  ['a', mod('a', { slots: [slot('t', ['b'])] })],
  ['b', mod('b', { slots: [slot('u', ['a'])] })],
);

test('the empty build, a nested build and several copies under distinct physical slots are accepted', () => {
  const lookup = treeLookup();
  accepts(lookup, {}, nakedOf());
  accepts(lookup, {}, nakedOf(edge(R, 's1', 'a'), edge(at(R, 's1', 'a'), 't', 'b')));
  const copies = accepts(lookup, {}, nakedOf(edge(R, 's1', 'a'), edge(R, 's2', 'a')));
  assert.equal(copies.stats?.acquisition.occurrences.length, 2, 'each physical slot is its own occurrence');
});

test('duplicate instance ids are rejected, including a child that claims the receiver id', () => {
  const lookup = treeLookup();
  const dup: PhysicalBuild = nakedOf(
    { parentInstanceId: R, slotId: 's1', childInstanceId: 'same', itemId: 'a' },
    { parentInstanceId: R, slotId: 's2', childInstanceId: 'same', itemId: 'a' },
  );
  rejects(lookup, {}, dup, 'DUPLICATE_INSTANCE_ID');
  const asRoot = nakedOf({ parentInstanceId: R, slotId: 's1', childInstanceId: R, itemId: 'a' });
  const result = run(lookup, {}, asRoot);
  assert.ok(codesOf(result).includes('DUPLICATE_INSTANCE_ID'));
  assert.ok(codesOf(result).includes('UNROOTED_PLACEMENT'));
});

test('a child record whose parent has no record has an unknown parent, and its own children are unrooted', () => {
  const lookup = treeLookup();
  rejects(lookup, {}, nakedOf(edge(at(R, 's1', 'a'), 't', 'b')), 'UNKNOWN_PARENT_INSTANCE');
  // `a` hangs on a ghost; `b` hangs on `a`: the ghost is unknown, `a` is known but unrooted, so `b` is unrooted.
  const orphan = nakedOf(
    { parentInstanceId: 'ghost', slotId: 's1', childInstanceId: 'A', itemId: 'a' },
    { parentInstanceId: 'A', slotId: 't', childInstanceId: 'B', itemId: 'b' },
  );
  const result = rejects(lookup, {}, orphan, 'UNKNOWN_PARENT_INSTANCE', 'UNROOTED_PLACEMENT');
  assert.equal(result.violations.filter(v => v.code === 'UNKNOWN_PARENT_INSTANCE').length, 1);
  assert.equal(result.violations.filter(v => v.code === 'UNROOTED_PLACEMENT').length, 1);
});

test('a floating cycle of installed parts is unrooted', () => {
  const lookup = treeLookup();
  const cycle = nakedOf(
    { parentInstanceId: 'B', slotId: 'u', childInstanceId: 'A', itemId: 'a' },
    { parentInstanceId: 'A', slotId: 't', childInstanceId: 'B', itemId: 'b' },
  );
  rejects(lookup, {}, cycle, 'UNROOTED_PLACEMENT');
});

test('a physical slot holds at most one child', () => {
  const lookup = treeLookup();
  const crowded = nakedOf(
    { parentInstanceId: R, slotId: 's1', childInstanceId: 'x1', itemId: 'a' },
    { parentInstanceId: R, slotId: 's1', childInstanceId: 'x2', itemId: 'a' },
  );
  rejects(lookup, {}, crowded, 'SLOT_CAPACITY_EXCEEDED');
});

test('unknown slots, items outside the allowlist and unknown items are rejected', () => {
  const lookup = treeLookup();
  rejects(lookup, {}, nakedOf(edge(R, 'zz', 'a')), 'UNKNOWN_SLOT');
  rejects(lookup, {}, nakedOf(edge(R, 's1', 'b')), 'ITEM_NOT_ALLOWED_IN_SLOT');
  const ghost = run(lookup, {}, nakedOf(edge(R, 's1', 'ghost')));
  assert.deepEqual(codesOf(ghost), ['ITEM_NOT_ALLOWED_IN_SLOT', 'QUANTITY_CAP_EXCEEDED', 'UNKNOWN_ITEM']);
  assert.equal(ghost.stats, null, 'statistics need every installed item to be known');
  // The receiver template is a gun entry, not an installable mod.
  const asItem = run(lookup, {}, nakedOf(edge(R, 's1', W)));
  assert.ok(codesOf(asItem).includes('UNKNOWN_ITEM'));
  assert.ok(codesOf(asItem).includes('ANCESTOR_TEMPLATE_REPETITION'));
});

test('no template repeats an ancestor; siblings and cousins may repeat', () => {
  const lookup = treeLookup();
  const aboveItself = nakedOf(edge(R, 's1', 'a'), edge(at(R, 's1', 'a'), 't', 'b'), edge(at(R, 's1', 'a') + '/t:b', 'u', 'a'));
  rejects(lookup, {}, aboveItself, 'ANCESTOR_TEMPLATE_REPETITION');
  // a under s1 and a under s2 are cousins, each with its own b: legal.
  const cousins = nakedOf(
    edge(R, 's1', 'a'), edge(at(R, 's1', 'a'), 't', 'b'),
    edge(R, 's2', 'a'), edge(at(R, 's2', 'a'), 't', 'b'),
  );
  accepts(lookup, {}, cousins);
});

test('required occupancy: the receiver and every installed, rooted part with a required slot', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: [slot('r', ['a'], true)] }),
    ['a', mod('a', { slots: [slot('q', ['b'], true)] })],
    ['b', mod('b')],
  );
  rejects(lookup, {}, nakedOf(), 'MISSING_REQUIRED_SLOT');
  rejects(lookup, {}, nakedOf(edge(R, 'r', 'a')), 'MISSING_REQUIRED_SLOT');
  accepts(lookup, {}, nakedOf(edge(R, 'r', 'a'), edge(at(R, 'r', 'a'), 'q', 'b')));
  // An orphan `a` is not rooted: its own required slot is not checked, but the receiver's is.
  const orphan = run(lookup, {}, nakedOf({ parentInstanceId: 'ghost', slotId: 'r', childInstanceId: 'A', itemId: 'a' }));
  assert.deepEqual(codesOf(orphan), ['MISSING_REQUIRED_SLOT', 'UNKNOWN_PARENT_INSTANCE']);
  assert.equal(orphan.violations.filter(v => v.code === 'MISSING_REQUIRED_SLOT').length, 1);
});

test('a required slot whose allowlist is empty can never be filled', () => {
  const lookup = lookupOf(gunWith(W, { slots: [slot('r', [], true)] }));
  rejects(lookup, {}, nakedOf(), 'MISSING_REQUIRED_SLOT');
});

test('camora ammunition slots are outside the physical domain: not required, not placeable', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: [slot('chamber', ['round'], true, ['round']), slot('s', ['a'])] }),
    ['a', mod('a')],
  );
  accepts(lookup, {}, nakedOf());
  accepts(lookup, {}, nakedOf(edge(R, 's', 'a')));
  assert.ok(codes(lookup, {}, nakedOf(edge(R, 'chamber', 'round'))).includes('UNKNOWN_SLOT'));
  // A classifier can flag ammunition for a payload that carries no item types (the pinned snapshot).
  const unflagged = lookupOf(gunWith(W, { slots: [slot('chamber', ['round'], true), slot('s', ['a'])] }), ['a', mod('a')]);
  rejects(unflagged, {}, nakedOf(), 'MISSING_REQUIRED_SLOT');
  accepts(unflagged, {}, nakedOf(), { isAmmo: id => id === 'round' });
  // A slot that mixes ammunition with parts is a data error, as it is for the blueprint.
  const mixed = lookupOf(gunWith(W, { slots: [slot('chamber', ['round', 'a'], false, ['round'])] }), ['a', mod('a')]);
  assert.throws(() => run(mixed, {}, nakedOf()), (e: unknown) => e instanceof PhysicalModelError && e.code === 'MIXED_AMMO_SLOT');
});

// ---------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------

test('template conflicts are symmetric by presence: one listing is enough', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: [slot('s1', ['a', 'c']), slot('s2', ['b', 'c'])] }),
    ['a', mod('a', { conflictsItems: ['b'] })],
    ['b', mod('b')],
    ['c', mod('c')],
  );
  const both = nakedOf(edge(R, 's1', 'a'), edge(R, 's2', 'b'));
  const result = rejects(lookup, {}, both, 'TEMPLATE_CONFLICT');
  assert.equal(result.violations.length, 1, 'the pair is reported once');
  accepts(lookup, {}, nakedOf(edge(R, 's1', 'a'), edge(R, 's2', 'c')));
  accepts(lookup, {}, nakedOf(edge(R, 's2', 'b')));
  // Listed the other way round the verdict is the same.
  const reversed = lookupOf(
    gunWith(W, { slots: [slot('s1', ['a']), slot('s2', ['b'])] }),
    ['a', mod('a')],
    ['b', mod('b', { conflictsItems: ['a'] })],
  );
  rejects(reversed, {}, both, 'TEMPLATE_CONFLICT');
});

test('the receiver conflicts with an item in either direction', () => {
  const receiverLists = lookupOf(gunWith(W, { slots: [slot('s', ['a'])], conflictsItems: ['a'] }), ['a', mod('a')]);
  rejects(receiverLists, {}, nakedOf(edge(R, 's', 'a')), 'TEMPLATE_CONFLICT');
  accepts(receiverLists, {}, nakedOf());
  const itemLists = lookupOf(gunWith(W, { slots: [slot('s', ['a'])] }), ['a', mod('a', { conflictsItems: [W] })]);
  rejects(itemLists, {}, nakedOf(edge(R, 's', 'a')), 'TEMPLATE_CONFLICT');
});

test('a template that lists itself caps its installed copies at one', () => {
  const lookup = lookupOf(gunWith(W, { slots: [slot('s1', ['c']), slot('s2', ['c'])] }), ['c', mod('c', { conflictsItems: ['c'] })]);
  accepts(lookup, {}, nakedOf(edge(R, 's1', 'c')));
  rejects(lookup, {}, nakedOf(edge(R, 's1', 'c'), edge(R, 's2', 'c')), 'SELF_CONFLICT_COPY_CAP');
});

test('slot conflicts block every occupied physical slot with a listed template slot id, the blocker own host slot included', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: [slot('s1', ['d', 'e']), slot('s2', ['f']), slot('s3', ['f'])] }),
    ['d', mod('d', { conflictsSlots: ['s2'] })],
    ['e', mod('e', { conflictsSlots: ['s1'] })],
    ['f', mod('f')],
  );
  accepts(lookup, {}, nakedOf(edge(R, 's1', 'd'), edge(R, 's3', 'f')));
  rejects(lookup, {}, nakedOf(edge(R, 's1', 'd'), edge(R, 's2', 'f')), 'SLOT_CONFLICT');
  // interpretation 11: the blocker blocks the slot it sits in.
  rejects(lookup, {}, nakedOf(edge(R, 's1', 'e')), 'SLOT_CONFLICT');
  // Every physical slot with that template slot id is blocked, on every instance.
  const twoHosts = lookupOf(
    gunWith(W, { slots: [slot('h1', ['host']), slot('h2', ['host']), slot('k', ['blocker'])] }),
    ['host', mod('host', { slots: [slot('u', ['f'])] })],
    ['blocker', mod('blocker', { conflictsSlots: ['u'] })],
    ['f', mod('f')],
  );
  const onBoth = nakedOf(edge(R, 'k', 'blocker'), edge(R, 'h1', 'host'), edge(R, 'h2', 'host'), edge(at(R, 'h1', 'host'), 'u', 'f'), edge(at(R, 'h2', 'host'), 'u', 'f'));
  const result = rejects(twoHosts, {}, onBoth, 'SLOT_CONFLICT');
  assert.equal(result.violations.length, 2, 'one violation per blocked physical slot');
  accepts(twoHosts, {}, nakedOf(edge(R, 'k', 'blocker'), edge(R, 'h1', 'host'), edge(R, 'h2', 'host')));
});

test('a slot conflict against a required slot bans the blocker (interpretation 14)', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: [slot('r', ['f'], true), slot('s', ['g'])] }),
    ['f', mod('f')],
    ['g', mod('g', { conflictsSlots: ['r'] })],
  );
  accepts(lookup, {}, nakedOf(edge(R, 'r', 'f')));
  rejects(lookup, {}, nakedOf(edge(R, 'r', 'f'), edge(R, 's', 'g')), 'SLOT_CONFLICT');
  rejects(lookup, {}, nakedOf(edge(R, 's', 'g')), 'MISSING_REQUIRED_SLOT');
});

// ---------------------------------------------------------------------------------------------
// Includes and excludes
// ---------------------------------------------------------------------------------------------

const filterLookup = () => lookupOf(
  gunWith(W, { slots: [slot('s1', ['a', 'b']), slot('s2', ['b', 'c'])] }),
  ['a', mod('a', { categories: ['leaf-a', 'mid', 'root'] })],
  ['b', mod('b', { categories: ['leaf-b', 'mid', 'root'] })],
  ['c', mod('c', { categories: ['leaf-c', 'other', 'root'] })],
);

test('excluded items and excluded categories, the whole category chain matching', () => {
  const lookup = filterLookup();
  const build = nakedOf(edge(R, 's1', 'a'), edge(R, 's2', 'c'));
  accepts(lookup, { excludeItems: ['b'] }, build);
  rejects(lookup, { excludeItems: ['a'] }, build, 'EXCLUDED_ITEM');
  rejects(lookup, { excludeCategories: ['leaf-a'] }, build, 'EXCLUDED_CATEGORY');
  rejects(lookup, { excludeCategories: ['mid'] }, build, 'EXCLUDED_CATEGORY'); // an ancestor of a's own category
  rejects(lookup, { excludeCategories: ['root'] }, build, 'EXCLUDED_CATEGORY');
  accepts(lookup, { excludeCategories: ['leaf-b'] }, build);
  const twice = run(lookup, { excludeCategories: ['root'] }, build);
  assert.equal(twice.violations.length, 2, 'one violation per excluded occurrence');
});

test('the category chain can be supplied explicitly instead of read from the lookup', () => {
  const lookup = filterLookup();
  const build = nakedOf(edge(R, 's1', 'a'));
  const options: ValidatePhysicalOptions = { categoryChainOf: id => (id === 'a' ? ['only-a'] : []) };
  assert.deepEqual(codes(lookup, { excludeCategories: ['mid'] }, build), ['EXCLUDED_CATEGORY']);
  assert.deepEqual(codes(lookup, { excludeCategories: ['mid'] }, build, options), []);
  assert.deepEqual(codes(lookup, { excludeCategories: ['only-a'] }, build, options), ['EXCLUDED_CATEGORY']);
  assert.deepEqual(codes(lookup, { includeCategories: [['only-a']] }, build, options), []);
});

test('include items: at least once; a repeated entry adds nothing (interpretation 12)', () => {
  const lookup = filterLookup();
  accepts(lookup, { includeItems: ['a'] }, nakedOf(edge(R, 's1', 'a')));
  accepts(lookup, { includeItems: ['a', 'a', 'a'] }, nakedOf(edge(R, 's1', 'a')));
  rejects(lookup, { includeItems: ['a'] }, nakedOf(edge(R, 's1', 'b')), 'MISSING_INCLUDE_ITEM');
  const two = run(lookup, { includeItems: ['a', 'c'] }, nakedOf());
  assert.equal(two.violations.length, 2);
});

test('include category groups: OR inside a group, AND across groups, chain matching', () => {
  const lookup = filterLookup();
  const build = nakedOf(edge(R, 's1', 'a'), edge(R, 's2', 'c'));
  accepts(lookup, { includeCategories: [['leaf-a']] }, build);
  accepts(lookup, { includeCategories: [['missing', 'leaf-c']] }, build);
  accepts(lookup, { includeCategories: [['mid'], ['other']] }, build);
  const result = rejects(lookup, { includeCategories: [['leaf-a'], ['leaf-b']] }, build, 'MISSING_INCLUDE_CATEGORY_GROUP');
  assert.equal(result.violations.length, 1, 'only the unsatisfied group is reported');
  rejects(lookup, { includeCategories: [[]] }, build, 'MISSING_INCLUDE_CATEGORY_GROUP');
});

// ---------------------------------------------------------------------------------------------
// Acquisition: supply caps, whole-lot spend, base accessibility
// ---------------------------------------------------------------------------------------------

const lots = (n: number) => Array.from({ length: n }, (_, i) => slot(`s${i + 1}`, ['a']));
const installA = (n: number) => Array.from({ length: n }, (_, i) => edge(R, `s${i + 1}`, 'a'));

test('spend is the base lot plus the paid units, exactly: a cap at the spend accepts, one ulp below rejects', () => {
  const lookup = lookupOf(gunWith(W, { slots: lots(2) }), ['a', mod('a', { offers: [trader('prapor', 1, 100)] })]);
  const build = nakedOf(...installA(2));
  const result = accepts(lookup, { maxPrice: 5200 }, build);
  assert.equal(result.stats?.spend, 5200);
  assert.equal(result.stats?.exact.spend, '5200');
  assert.equal(result.stats?.basePrice, 5000);
  assert.equal(result.stats?.modSpend, 200);
  rejects(lookup, { maxPrice: nextDown(5200) }, build, 'MAX_PRICE_EXCEEDED');
  accepts(lookup, { maxPrice: nextUp(5200) }, build);
  rejects(lookup, { maxPrice: 0 }, nakedOf(), 'MAX_PRICE_EXCEEDED'); // a cap of 0 is a real cap
});

test('allocation order: preset supply first, owned stock second, the paid remainder last', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: lots(4), presets: [{ id: 'P', items: [{ itemId: 'a', count: 2 }], offers: [trader('prapor', 1, 1000)] }] }),
    ['a', mod('a', { offers: [trader('prapor', 1, 100)] })],
  );
  const result = accepts(lookup, { ownedItems: ['a'], maxPrice: 1200 }, presetOf('P', ...installA(4)));
  const sources = result.stats?.acquisition.occurrences.map(o => [o.instanceId, o.source, o.price] as const);
  assert.deepEqual(sources, [
    [at(R, 's1', 'a'), 'preset', 0],
    [at(R, 's2', 'a'), 'preset', 0],
    [at(R, 's3', 'a'), 'owned', 0],
    [at(R, 's4', 'a'), 'offer', 100],
  ]);
  assert.equal(result.stats?.spend, 1100);
  assert.deepEqual(result.stats?.acquisition.deficits.get('a'), 1);
  rejects(lookup, { ownedItems: ['a'], maxPrice: 1099 }, presetOf('P', ...installA(4)), 'MAX_PRICE_EXCEEDED');
  // Stock covers the deficit entirely: the spend is the base alone.
  assert.equal(accepts(lookup, { ownedItems: ['a', 'a'] }, presetOf('P', ...installA(4))).stats?.spend, 1000);
});

test('an item with no legal standalone offer is capped by preset supply plus owned stock', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: lots(3), presets: [{ id: 'P', items: [{ itemId: 'a', count: 1 }] }] }),
    ['a', mod('a', { offers: [] })],
  );
  rejects(lookup, {}, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  accepts(lookup, { ownedItems: ['a'] }, nakedOf(...installA(1)));
  rejects(lookup, { ownedItems: ['a'] }, nakedOf(...installA(2)), 'QUANTITY_CAP_EXCEEDED');
  accepts(lookup, { ownedItems: ['a', 'a'] }, nakedOf(...installA(2)));
  accepts(lookup, {}, presetOf('P', ...installA(1)));
  rejects(lookup, {}, presetOf('P', ...installA(2)), 'QUANTITY_CAP_EXCEEDED');
  accepts(lookup, { ownedItems: ['a'] }, presetOf('P', ...installA(2)));
  rejects(lookup, { ownedItems: ['a'] }, presetOf('P', ...installA(3)), 'QUANTITY_CAP_EXCEEDED');
  // The shortfall is never priced.
  assert.equal(run(lookup, { ownedItems: ['a'] }, presetOf('P', ...installA(3))).stats?.spend, 1000);
});

test('a stored price of 0 is not an offer; a zero-total barter is not either, a barter rounded to 0 is', () => {
  const zeroCash = lookupOf(gunWith(W, { slots: lots(1) }), ['a', mod('a', { offers: [trader('prapor', 1, 0)] })]);
  rejects(zeroCash, {}, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  const zeroBarter = lookupOf(gunWith(W, { slots: lots(1) }), ['a', mod('a', { offers: [barter('prapor', 1, 0)] })]);
  accepts(zeroBarter, { barterAvailable: true, maxPrice: 5000 }, nakedOf(...installA(1)));
  rejects(zeroBarter, { barterAvailable: false }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  const negative = lookupOf(gunWith(W, { slots: lots(1) }), ['a', mod('a', { offers: [barter('prapor', 1, -5)] })]);
  rejects(negative, { barterAvailable: true }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
});

test('market gating: trader levels (default 4, 0 disables), flea gate and flag, barter flag and dogtags', () => {
  const offers = (list: ReturnType<typeof trader>[]) => lookupOf(gunWith(W, { slots: lots(1) }), ['a', mod('a', { offers: list })]);
  const level3 = offers([trader('skier', 3, 100)]);
  accepts(level3, {}, nakedOf(...installA(1))); // a missing trader is level 4
  accepts(level3, { traderLevels: { skier: 3 } }, nakedOf(...installA(1)));
  rejects(level3, { traderLevels: { skier: 2 } }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  rejects(level3, { traderLevels: { skier: 0 } }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  accepts(level3, { traderLevels: { Skier: 3, prapor: 4 } }, nakedOf(...installA(1)));

  const onFlea = lookupOf(gunWith(W, { slots: lots(1) }), ['a', mod('a', { offers: [flea(100)], fleaMinLevel: 15 })]);
  accepts(onFlea, {}, nakedOf(...installA(1))); // no player level: no gating
  accepts(onFlea, { playerLevel: 15 }, nakedOf(...installA(1)));
  rejects(onFlea, { playerLevel: 14 }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  rejects(onFlea, { fleaAvailable: false }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');

  const barterOnly = lookupOf(gunWith(W, { slots: lots(1) }), ['a', mod('a', { offers: [barter('jaeger', 2, 100, true)] })]);
  rejects(barterOnly, {}, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED'); // barters are off by default
  accepts(barterOnly, { barterAvailable: true }, nakedOf(...installA(1)));
  rejects(barterOnly, { barterAvailable: true, barterExcludeDogtags: true }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  rejects(barterOnly, { barterAvailable: true, traderLevels: { jaeger: 1 } }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  rejects(barterOnly, { barterAvailable: true, traderLevels: { jaeger: 0 } }, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
});

test('offers are lots bought whole: the cheapest cover of the paid deficit, surplus unused', () => {
  // cash 200 per unit, or a barter delivering 3 units for 300.
  const lookup = lookupOf(
    gunWith(W, { slots: lots(4), offers: [trader('prapor', 1, 1000)] }),
    ['a', mod('a', { offers: [trader('prapor', 1, 200), barter('prapor', 1, 300, false, 3)] })],
  );
  const spendOf = (n: number): number => accepts(lookup, { barterAvailable: true }, nakedOf(...installA(n))).stats?.modSpend as number;
  assert.equal(spendOf(0), 0);
  assert.equal(spendOf(1), 200, 'one unit: cash is cheaper than a whole barter lot');
  assert.equal(spendOf(2), 300, 'two units: one barter lot (surplus unit unused) beats two cash units');
  assert.equal(spendOf(3), 300);
  assert.equal(spendOf(4), 500, 'four units: one lot of three plus one cash unit');
  // Without barters only cash is legal.
  assert.equal(accepts(lookup, { barterAvailable: false }, nakedOf(...installA(2))).stats?.modSpend, 400);
  // Provenance: paid occurrences take the lot units in offer order, the lot price on the first unit taken from a lot.
  const four = accepts(lookup, { barterAvailable: true }, nakedOf(...installA(4)));
  const charges = four.stats?.acquisition.occurrences.map(o => [o.source, o.offerSource, o.price]);
  assert.deepEqual(charges, [['offer', 'prapor', 200], ['offer', 'barter:prapor', 300], ['offer', 'barter:prapor', 0], ['offer', 'barter:prapor', 0]]);
  assert.equal(four.stats?.acquisition.purchases[0].lots.length, 2);
  assert.equal(four.stats?.acquisition.purchases[0].lots[1].used, 3);
});

test('the base is one unit: the cheapest legal lot price of the receiver or the preset', () => {
  const lookup = lookupOf(
    gunWith(W, { offers: [trader('prapor', 1, 5000), flea(4000)], presets: [{ id: 'P', items: [], offers: [barter('jaeger', 1, 900, false, 5), trader('prapor', 1, 1000)] }] }),
  );
  assert.equal(accepts(lookup, {}, nakedOf()).stats?.spend, 4000);
  assert.equal(accepts(lookup, { fleaAvailable: false }, nakedOf()).stats?.spend, 5000);
  assert.equal(accepts(lookup, {}, presetOf('P')).stats?.spend, 1000);
  assert.equal(accepts(lookup, { barterAvailable: true }, presetOf('P')).stats?.spend, 900, 'a lot of 5 still costs its whole price for the one base');
});

test('base accessibility: owned stock never grants a receiver or a preset; the receiver is owned only when no base can be bought', () => {
  const lookup = lookupOf(
    gunWith(W, { presets: [{ id: 'P', items: [], offers: [trader('prapor', 1, 1000)] }, { id: 'none', items: [], offers: [] }] }),
  );
  // prapor 0 and no flea: neither the receiver nor any preset can be bought, so the naked receiver is the player's own at price 0
  const closed = { traderLevels: { prapor: 0 }, fleaAvailable: false };
  const owned = accepts(lookup, closed, nakedOf());
  assert.equal(owned.stats?.baseSource, 'owned');
  assert.equal(owned.stats?.basePrice, 0);
  assert.equal(owned.stats?.spend, 0);
  assert.equal(accepts(lookup, { ...closed, ownedItems: [W, 'P', 'none'] }, nakedOf()).stats?.baseSource, 'owned', 'the stash plays no part');
  // a preset is never owned
  rejects(lookup, closed, presetOf('P'), 'BASE_INACCESSIBLE');
  rejects(lookup, {}, presetOf('none'), 'BASE_INACCESSIBLE');
  // the receiver locked but preset P buyable from Skier: the naked receiver is inaccessible, stash or no stash, and never priced
  const viaSkier = lookupOf(
    gunWith(W, { presets: [{ id: 'P', items: [], offers: [trader('skier', 1, 1000)] }] }),
  );
  rejects(viaSkier, closed, nakedOf(), 'BASE_INACCESSIBLE');
  rejects(viaSkier, { ...closed, ownedItems: [W] }, nakedOf(), 'BASE_INACCESSIBLE');
  assert.equal(run(viaSkier, closed, nakedOf()).stats?.spend, 0, 'an inaccessible base is rejected, never priced');
  assert.equal(run(viaSkier, closed, nakedOf()).stats?.baseSource, null);
  assert.equal(accepts(viaSkier, closed, presetOf('P')).stats?.baseSource, 'offer');
  // a bought receiver
  assert.equal(accepts(lookup, {}, nakedOf()).stats?.baseSource, 'offer');
  rejects(lookup, {}, presetOf('nope'), 'BASE_UNKNOWN_PRESET');
  const twoGuns: ItemLookup = { ...lookup, ...lookupOf(gunWith('other', { presets: [{ id: 'po', items: [] }] })) };
  rejects(twoGuns, {}, presetOf('po'), 'BASE_WRONG_WEAPON');
});

test('preset supply serves only a build made on that preset; a malformed preset count is a data error', () => {
  const lookup = lookupOf(
    gunWith(W, { slots: lots(1), presets: [{ id: 'P', items: [{ itemId: 'a', count: 1 }], offers: [trader('prapor', 1, 1000)] }] }),
    ['a', mod('a', { offers: [] })],
  );
  accepts(lookup, {}, presetOf('P', ...installA(1)));
  rejects(lookup, {}, nakedOf(...installA(1)), 'QUANTITY_CAP_EXCEEDED');
  // A malformed preset count is a data error, not a build verdict.
  const bad = lookupOf(
    gunWith(W, { slots: lots(1), presets: [{ id: 'P', items: [{ itemId: 'a', count: 1.5 }] }] }),
    ['a', mod('a', { offers: [] })],
  );
  assert.throws(() => run(bad, {}, presetOf('P', ...installA(1))), (e: unknown) => e instanceof PhysicalModelError && e.code === 'BAD_PRESET');
});

// ---------------------------------------------------------------------------------------------
// Hard caps, statistics, exact arithmetic
// ---------------------------------------------------------------------------------------------

const statLookup = () => lookupOf(
  gunWith(W, { weight: 1.5, ergo: 40, recoilV: 100, recoilH: 50, coi: 2, sighting: 50, slots: [slot('s1', ['x']), slot('s2', ['y'])] }),
  ['x', modWith('x', { weight: 0.5, ergo: 30, recoil: -0.25, accuracy: 8, capacity: 30, sighting: 100 })],
  ['y', modWith('y', { weight: 1, ergo: 50, recoil: -0.125, accuracy: 4, coi: 0.5 })],
);

test('exact statistics of a build', () => {
  const stats = accepts(statLookup(), {}, nakedOf(edge(R, 's1', 'x'), edge(R, 's2', 'y'))).stats!;
  assert.deepEqual(
    {
      raw: stats.exact.rawErgonomics, clamp: stats.exact.ergonomics, effective: stats.exact.effectiveErgonomics, recoilSum: stats.exact.recoilModifierSum,
      v: stats.exact.recoilVertical, h: stats.exact.recoilHorizontal, weight: stats.exact.weight, penalty: stats.exact.weightPenalty, ted: stats.exact.ted,
      accuracy: stats.exact.accuracyModifierSum, coi: stats.exact.effectiveCenterOfImpact, moa: stats.exact.moa, magazine: stats.exact.magazineCapacity,
      sighting: stats.exact.sightingRange, spend: stats.exact.spend, overswing: stats.exact.overswingPercent,
    },
    {
      raw: '120', clamp: '100', effective: '100', recoilSum: '-3/8', v: '125/2', h: '125/4', weight: '3', penalty: '0', ted: '100',
      accuracy: '12', coi: '1/2', moa: '440000/29089', magazine: '30', sighting: '100', spend: '5200', overswing: '0',
    },
  );
  assert.equal(stats.recoilVertical, 62.5);
  assert.equal(stats.moa, 440000 / 29089);
  assert.equal(stats.weight, 3);
});

test('ergonomics clamp twice: the displayed value, then after the gear factor', () => {
  const lookup = lookupOf(
    gunWith(W, { ergo: 60, slots: [slot('s', ['up', 'down'])] }),
    ['up', mod('up', { ergo: 60 })],
    ['down', mod('down', { ergo: -80 })],
  );
  const up = nakedOf(edge(R, 's', 'up'));
  const down = nakedOf(edge(R, 's', 'down'));
  assert.equal(accepts(lookup, {}, up).stats?.exact.ergonomics, '100');
  assert.equal(accepts(lookup, {}, down).stats?.exact.rawErgonomics, '-20');
  assert.equal(accepts(lookup, {}, down).stats?.exact.ergonomics, '0');
  // The gear factor scales the clamped value and is clamped again.
  assert.equal(accepts(lookup, { equipErgoModifier: -0.5 }, up).stats?.exact.effectiveErgonomics, '50');
  assert.equal(accepts(lookup, { equipErgoModifier: 0.5 }, up).stats?.exact.effectiveErgonomics, '100');
  assert.equal(accepts(lookup, { equipErgoModifier: -2 }, up).stats?.exact.effectiveErgonomics, '0');
  assert.equal(accepts(lookup, { equipErgoModifier: -1 }, up).stats?.exact.effectiveErgonomics, '0');
  assert.equal(accepts(lookup, { equipErgoModifier: -0.5 }, down).stats?.exact.effectiveErgonomics, '0');
});

test('min_ergonomics reads the first clamp, before the gear factor (interpretation 8), exactly', () => {
  const lookup = lookupOf(gunWith(W, { ergo: 60, slots: [slot('s', ['up'])] }), ['up', mod('up', { ergo: 60 })]);
  const up = nakedOf(edge(R, 's', 'up'));
  accepts(lookup, { minErgonomics: 100 }, up);
  rejects(lookup, { minErgonomics: nextUp(100) }, up, 'MIN_ERGONOMICS_NOT_MET');
  // With gear the effective value is 50, but the cap still reads 100.
  accepts(lookup, { minErgonomics: 100, equipErgoModifier: -0.5 }, up);
  const cap = lookupOf(gunWith(W, { ergo: 50, slots: [slot('s', ['m'])] }), ['m', mod('m', { ergo: -0.25 })]);
  accepts(cap, { minErgonomics: 49.75 }, nakedOf(edge(R, 's', 'm')));
  rejects(cap, { minErgonomics: nextUp(49.75) }, nakedOf(edge(R, 's', 'm')), 'MIN_ERGONOMICS_NOT_MET');
});

test('recoil caps apply to the final values: naked recoil times one plus the modifier sum', () => {
  const lookup = lookupOf(
    gunWith(W, { recoilV: 100, recoilH: 50, slots: [slot('s', ['m'])] }),
    ['m', mod('m', { recoil: -0.25 })],
  );
  const build = nakedOf(edge(R, 's', 'm'));
  accepts(lookup, { maxRecoilV: 75 }, build);
  rejects(lookup, { maxRecoilV: nextDown(75) }, build, 'MAX_RECOIL_V_EXCEEDED');
  accepts(lookup, { maxRecoilSum: 112.5 }, build);
  rejects(lookup, { maxRecoilSum: nextDown(112.5) }, build, 'MAX_RECOIL_SUM_EXCEEDED');
  // The empty build has the naked recoil.
  accepts(lookup, { maxRecoilV: 100 }, nakedOf());
  rejects(lookup, { maxRecoilV: 99.5 }, nakedOf(), 'MAX_RECOIL_V_EXCEEDED');
  // A nonpositive cap is a real cap: positive recoil never meets 0.
  rejects(lookup, { maxRecoilV: 0 }, build, 'MAX_RECOIL_V_EXCEEDED');
  const flat = lookupOf(gunWith(W, { recoilV: 0, recoilH: 0 }));
  accepts(flat, { maxRecoilV: 0, maxRecoilSum: 0 }, nakedOf());
});

test('magazine and sighting minimums take the maximum over the receiver and the items (interpretation 7)', () => {
  const lookup = lookupOf(
    gunWith(W, { sighting: 100, slots: [slot('s1', ['m1']), slot('s2', ['m2'])] }),
    ['m1', modWith('m1', { capacity: 20, sighting: 150 })],
    ['m2', modWith('m2', { capacity: 20, sighting: 300 })],
  );
  const both = nakedOf(edge(R, 's1', 'm1'), edge(R, 's2', 'm2'));
  accepts(lookup, { minMagCapacity: 20 }, both);
  rejects(lookup, { minMagCapacity: 21 }, both, 'MIN_MAGAZINE_NOT_MET');
  rejects(lookup, { minMagCapacity: 40 }, both, 'MIN_MAGAZINE_NOT_MET'); // the maximum, not the sum
  accepts(lookup, { minMagCapacity: 0 }, nakedOf()); // the receiver carries no capacity
  rejects(lookup, { minMagCapacity: 1 }, nakedOf(), 'MIN_MAGAZINE_NOT_MET');
  accepts(lookup, { minSightingRange: 300 }, both);
  rejects(lookup, { minSightingRange: nextUp(300) }, both, 'MIN_SIGHTING_NOT_MET');
  accepts(lookup, { minSightingRange: 100 }, nakedOf()); // the receiver's own range
  rejects(lookup, { minSightingRange: 101 }, nakedOf(), 'MIN_SIGHTING_NOT_MET');
});

test('weight is exact: decimal masses, fractional kilograms and a sum a double hides', () => {
  const mountOf = (mass: number) => lookupOf(gunWith(W, { weight: 1, slots: [slot('s', ['m'])] }), ['m', mod('m', { weight: mass })]);
  const build = nakedOf(edge(R, 's', 'm'));
  // 1 + 0.0155 exactly is (2^56 + 1116892707587883) / 2^56: the mass 0.0155 is the exact double, not the decimal.
  assert.equal(run(mountOf(0.0155), {}, build).stats!.exact.weight, `${(1n << 56n) + 1116892707587883n}/${1n << 56n}`);
  // The exact sum 1 + m is not a double. A cap equal to the double nearest it must follow the exact value: when that double lies below the
  // exact sum the build is over the cap (a rounded sum would accept it), when it lies above the build is under it.
  const lies = (m: number) => ratCmp(ratFromDouble(1 + m), ratAdd(ratFromDouble(1), ratFromDouble(m)));
  const masses = Array.from({ length: 99 }, (_, k) => (k + 1) / 1000);
  const below = masses.find(m => lies(m) < 0);
  const above = masses.find(m => lies(m) > 0);
  assert.ok(below !== undefined && above !== undefined, 'both roundings occur among the masses');
  rejects(mountOf(below), { maxWeight: 1 + below }, build, 'MAX_WEIGHT_EXCEEDED');
  accepts(mountOf(below), { maxWeight: nextUp(1 + below) }, build);
  accepts(mountOf(above), { maxWeight: 1 + above }, build);
  rejects(mountOf(above), { maxWeight: nextDown(1 + above) }, build, 'MAX_WEIGHT_EXCEEDED');

  // 1e16 + 1 + 1 is 1e16 + 2 exactly; a double running sum stays at 1e16 and would accept a cap of 1e16.
  const huge = lookupOf(
    gunWith(W, { weight: 1e16, slots: [slot('s1', ['m']), slot('s2', ['m'])] }),
    ['m', mod('m', { weight: 1 })],
  );
  const two = nakedOf(edge(R, 's1', 'm'), edge(R, 's2', 'm'));
  assert.equal(1e16 + 1 + 1, 1e16, 'the naive double sum cannot see the two units');
  rejects(huge, { maxWeight: 1e16 }, two, 'MAX_WEIGHT_EXCEEDED');
  accepts(huge, { maxWeight: 1e16 + 2 }, two);

  // Negative masses are exact too.
  const light = lookupOf(gunWith(W, { weight: 1, slots: [slot('s', ['m'])] }), ['m', mod('m', { weight: -0.25 })]);
  accepts(light, { maxWeight: 0.75 }, nakedOf(edge(R, 's', 'm')));
  rejects(light, { maxWeight: nextDown(0.75) }, nakedOf(edge(R, 's', 'm')), 'MAX_WEIGHT_EXCEEDED');
});

test('MOA: a positive barrel replaces the intrinsic centre of impact, K is 1000000 / 29089', () => {
  const lookup = lookupOf(
    gunWith(W, { coi: 1, slots: [slot('s1', ['barrel']), slot('s2', ['flat']), slot('s3', ['neg']), slot('s4', ['b2'])] }),
    ['barrel', modWith('barrel', { coi: 2, accuracy: 0 })],
    ['flat', modWith('flat', { coi: 0, accuracy: 50 })],
    ['neg', modWith('neg', { coi: -3, accuracy: -50 })],
    ['b2', modWith('b2', { coi: 4 })],
  );
  const moaOf = (...placements: PhysicalPlacement[]) => accepts(lookup, {}, nakedOf(...placements)).stats!.exact.moa;
  assert.equal(moaOf(), '1000000/29089', 'no barrel: the intrinsic COI 1');
  assert.equal(moaOf(edge(R, 's1', 'barrel')), '2000000/29089', 'a positive barrel replaces it');
  assert.equal(moaOf(edge(R, 's2', 'flat')), '500000/29089', 'a zero COI falls back; signed accuracy scales (1 - 50/100)');
  assert.equal(moaOf(edge(R, 's3', 'neg')), '1500000/29089', 'a nonpositive COI falls back; negative accuracy worsens MOA');
  assert.equal(moaOf(edge(R, 's1', 'barrel'), edge(R, 's4', 'b2')), '4000000/29089', 'several positive barrels: the largest applies (interpretation 4)');
  const build = nakedOf(edge(R, 's1', 'barrel'));
  accepts(lookup, { maxMOA: 2000000 / 29089 + 1e-9 }, build);
  rejects(lookup, { maxMOA: 2 }, build, 'MAX_MOA_EXCEEDED');
});

test('MOA with a zero intrinsic COI is constant 0 until a barrel is installed', () => {
  const lookup = lookupOf(gunWith(W, { coi: 0, slots: [slot('s', ['barrel'])] }), ['barrel', modWith('barrel', { coi: 1 })]);
  assert.equal(accepts(lookup, { maxMOA: 0 }, nakedOf()).stats?.exact.moa, '0');
  rejects(lookup, { maxMOA: 0 }, nakedOf(edge(R, 's', 'barrel')), 'MAX_MOA_EXCEEDED');
  const constantAboveCap = lookupOf(gunWith(W, { coi: 3 }));
  rejects(constantAboveCap, { maxMOA: 1 }, nakedOf(), 'MAX_MOA_EXCEEDED');
});

test('overswing: TED = effective ergonomics minus the weight penalty; nonzero strength exactly when TED < 0', () => {
  const heavy = (ergo: number) => lookupOf(gunWith(W, { weight: 6, ergo }));
  // W = 6: penalty 100 - 300/6 = 50. At E = 50 TED = 0 (allowed); below it TED < 0.
  const atZero = accepts(heavy(50), { preventOverswing: true }, nakedOf());
  assert.equal(atZero.stats?.exact.ted, '0');
  assert.equal(atZero.stats?.exact.overswingPercent, '0');
  const under = rejects(heavy(49.5), { preventOverswing: true }, nakedOf(), 'OVERSWING_PREVENTED');
  assert.equal(under.stats?.exact.ted, '-1/2');
  assert.equal(under.stats?.exact.overswingPercent, '3/4');
  accepts(heavy(49.5), {}, nakedOf()); // reported, not prevented
  // Free weight: at or below 3 kg there is no penalty, even with zero ergonomics.
  assert.equal(accepts(lookupOf(gunWith(W, { weight: 3, ergo: 0 })), { preventOverswing: true }, nakedOf()).stats?.exact.weightPenalty, '0');
  rejects(lookupOf(gunWith(W, { weight: nextUp(3), ergo: 0 })), { preventOverswing: true }, nakedOf(), 'OVERSWING_PREVENTED');
  // The gear factor enters TED.
  const gear = lookupOf(gunWith(W, { weight: 6, ergo: 60 }));
  accepts(gear, { preventOverswing: true }, nakedOf());
  rejects(gear, { preventOverswing: true, equipErgoModifier: -0.5 }, nakedOf(), 'OVERSWING_PREVENTED');
  // Strength saturates at 100.
  assert.equal(run(lookupOf(gunWith(W, { weight: 10, ergo: 0 })), {}, nakedOf()).stats?.exact.overswingPercent, '100');
});

test('several caps are reported together, each with its own code', () => {
  const lookup = statLookup();
  const build = nakedOf(edge(R, 's1', 'x'), edge(R, 's2', 'y'));
  const result = run(lookup, {
    maxPrice: 1, minErgonomics: 101, maxRecoilV: 1, maxRecoilSum: 1, minMagCapacity: 99, minSightingRange: 999, maxWeight: 1, maxMOA: 0.001, preventOverswing: true,
    equipErgoModifier: -1,
  }, build);
  assert.deepEqual(codesOf(result), [
    'MAX_MOA_EXCEEDED', 'MAX_PRICE_EXCEEDED', 'MAX_RECOIL_SUM_EXCEEDED', 'MAX_RECOIL_V_EXCEEDED', 'MAX_WEIGHT_EXCEEDED', 'MIN_ERGONOMICS_NOT_MET',
    'MIN_MAGAZINE_NOT_MET', 'MIN_SIGHTING_NOT_MET',
  ].sort());
  // Weight 3 means no penalty, so with zero gear TED = 0 and overswing is not triggered here.
  assert.ok(!codesOf(result).includes('OVERSWING_PREVENTED'));
});

// ---------------------------------------------------------------------------------------------
// Production-only checks: claims and strict instance ids
// ---------------------------------------------------------------------------------------------

const claimLookup = () => lookupOf(
  gunWith(W, { slots: lots(3), presets: [{ id: 'P', items: [{ itemId: 'a', count: 1 }], offers: [trader('prapor', 1, 1000)] }] }),
  ['a', mod('a', { offers: [trader('prapor', 1, 100)] })],
);

test('a claimed spend or acquisition is cross-checked against the exact recomputation', () => {
  const lookup = claimLookup();
  const placements = installA(3);
  const truth = run(lookup, { ownedItems: ['a'] }, presetOf('P', ...placements)).stats!;
  assert.equal(truth.spend, 1100);
  const claimed = {
    spend: 1100, basePrice: 1000, modSpend: 100,
    acquisition: truth.acquisition.occurrences.map(o => ({
      instanceId: o.instanceId, itemId: o.itemId, source: o.source as 'preset' | 'owned' | 'offer', presetId: o.presetId, offerSource: o.offerSource, offerIndex: o.offerIndex, price: o.price,
    })),
  };
  accepts(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed });
  const wrongSpend = run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, spend: 1099 } });
  assert.deepEqual(codesOf(wrongSpend), ['CLAIMED_SPEND_MISMATCH']);
  const wrongBase = run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, basePrice: 900 } });
  assert.deepEqual(codesOf(wrongBase), ['CLAIMED_SPEND_MISMATCH']);
  const wrongMod = run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, modSpend: 0 } });
  assert.deepEqual(codesOf(wrongMod), ['CLAIMED_SPEND_MISMATCH']);
  // A different provenance for one occurrence.
  const swapped = claimed.acquisition.map((o, k) => (k === 0 ? { ...o, source: 'owned' as const, presetId: null } : o));
  assert.deepEqual(codesOf(run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, acquisition: swapped } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  // A missing record and a record for an instance that is not installed.
  const missing = claimed.acquisition.slice(1);
  assert.deepEqual(codesOf(run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, acquisition: missing } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  const extra = [...claimed.acquisition, { ...claimed.acquisition[0], instanceId: 'weapon_0/zz:a' }];
  assert.deepEqual(codesOf(run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, acquisition: extra } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  // A wrong charge, and an offer index the item does not have.
  const charged = claimed.acquisition.map(o => (o.source === 'offer' ? { ...o, price: 99 } : o));
  assert.deepEqual(codesOf(run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, acquisition: charged } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  const badIndex = claimed.acquisition.map(o => (o.source === 'offer' ? { ...o, offerIndex: 7 } : o));
  assert.deepEqual(codesOf(run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, acquisition: badIndex } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  // A claim that is not a finite number never matches.
  assert.deepEqual(codesOf(run(lookup, { ownedItems: ['a'] }, { ...presetOf('P', ...placements), claimed: { ...claimed, spend: Number.NaN } })), ['CLAIMED_SPEND_MISMATCH']);
});

test('a claimed base source is cross-checked: offer for a bought base, owned only when no base can be bought', () => {
  const lookup = claimLookup();
  accepts(lookup, {}, { ...presetOf('P'), claimed: { baseSource: 'offer', basePrice: 1000 } });
  assert.deepEqual(codesOf(run(lookup, {}, { ...presetOf('P'), claimed: { baseSource: 'owned' } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  // prapor 0 and no flea: neither the receiver nor P can be bought, so the naked receiver is owned at price 0
  const closed = { traderLevels: { prapor: 0 }, fleaAvailable: false };
  accepts(lookup, closed, { ...nakedOf(), claimed: { baseSource: 'owned', basePrice: 0, spend: 0 } });
  assert.deepEqual(codesOf(run(lookup, closed, { ...nakedOf(), claimed: { baseSource: 'offer' } })), ['CLAIMED_ACQUISITION_MISMATCH']);
  assert.deepEqual(codesOf(run(lookup, closed, { ...nakedOf(), claimed: { basePrice: 5000 } })), ['CLAIMED_SPEND_MISMATCH']);
});

test('instance ids are not checked against the path scheme unless asked', () => {
  const lookup = treeLookup();
  const custom: PhysicalBuild = nakedOf({ parentInstanceId: R, slotId: 's1', childInstanceId: 'inst-77', itemId: 'a' });
  accepts(lookup, {}, custom);
  assert.deepEqual(codes(lookup, {}, custom, { requirePathInstanceIds: true }), ['INSTANCE_ID_NOT_PATH_DERIVED']);
  accepts(lookup, {}, nakedOf(edge(R, 's1', 'a')), { requirePathInstanceIds: true });
  // The receiver id may be named by the build.
  accepts(lookup, {}, { base: { kind: 'naked' }, rootInstanceId: 'receiver', placements: [{ parentInstanceId: 'receiver', slotId: 's1', childInstanceId: 'x', itemId: 'a' }] });
});

// ---------------------------------------------------------------------------------------------
// Input errors are typed failures, never verdicts
// ---------------------------------------------------------------------------------------------

test('a malformed request is a typed input error, not a violation', () => {
  const lookup = treeLookup();
  const invalid = (code: string) => (e: unknown) => e instanceof PhysicalModelError && e.code === code;
  assert.throws(() => run(lookup, { weaponId: 'nope' }, nakedOf()), invalid('UNKNOWN_WEAPON'));
  assert.throws(() => run(lookup, { weaponId: 'a' }, nakedOf()), invalid('UNKNOWN_WEAPON')); // a mod is not a receiver
  assert.throws(() => run(lookup, { ownedItems: ['a', ''] }, nakedOf()), invalid('INVALID_OWNED_ITEMS'));
  assert.throws(() => run(lookup, { maxPrice: Number.NaN }, nakedOf()), invalid('INVALID_REQUEST'));
  assert.throws(() => run(lookup, { maxWeight: Infinity }, nakedOf()), invalid('INVALID_REQUEST'));
  assert.throws(() => run(lookup, { equipErgoModifier: Number.NaN }, nakedOf()), invalid('INVALID_REQUEST'));
  assert.throws(() => run(lookup, { traderLevels: { prapor: Number.NaN } }, nakedOf()), invalid('INVALID_REQUEST'));
  assert.throws(() => run(lookup, { playerLevel: Number.NaN }, nakedOf()), invalid('INVALID_REQUEST'));
});

test('a prepared validator checks many builds against one resolved request', () => {
  const validator = preparePhysicalValidator(treeLookup(), { weaponId: W, maxPrice: 5100 });
  assert.equal(validator.validate(nakedOf(edge(R, 's1', 'a'))).ok, true);
  assert.equal(validator.validate(nakedOf(edge(R, 's1', 'a'), edge(R, 's2', 'a'))).ok, false);
  assert.equal(validator.validate(nakedOf()).ok, true);
});

test('every SolveParams field the validator reads is accepted under its own name', () => {
  const lookup = lookupOf(gunWith(W, { slots: [slot('s1', ['a'])] }), ['a', mod('a', { categories: ['cat'] })]);
  const params: SolveParams = {
    weaponId: W, itemLookup: lookup, compatibilityMap: { reachable_items: {}, slot_items: {}, item_to_slots: {}, slot_owner: {} },
    maxPrice: 1e9, minErgonomics: 0, maxRecoilV: 1e9, maxRecoilSum: 1e9, minMagCapacity: 0, minSightingRange: 0, maxWeight: 1e9, maxMOA: 1e9,
    includeItems: ['a'], excludeItems: ['zz'], includeCategories: [['cat']], excludeCategories: ['zz'], useTrueErgo: true, preventOverswing: true,
    equipErgoModifier: -0.1, traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, fleaAvailable: false, barterAvailable: true,
    barterExcludeDogtags: true, playerLevel: 20, ownedItems: ['a'],
  };
  const asRequest = (p: SolveParams): PhysicalValidationRequest => p; // a SolveParams is a request: the names are the same
  const result = validatePhysicalBuild(lookup, asRequest(params), nakedOf(edge(R, 's1', 'a')));
  assert.deepEqual(result.violations, []);
  assert.equal(result.stats?.spend, 5000, 'the owned part costs nothing; the receiver is bought from prapor');
});
