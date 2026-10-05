// Tests of the ReferenceFixture/ReferenceRequest -> production inputs mapping (toProduction.differential.ts).
// Production is only the target type here: nothing is solved. Each test pins one mapping decision, in the
// units production uses, or one unsupported-feature detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModLookupEntry, GunLookupEntry } from '../../src/solver/types';
import { LEDGER } from '../ledger/index';
import type { ReferenceFixture, ReferenceRequest } from '../oracle/index';
import { detectUnsupported, mapFixture, mapRequest, toProduction, UNSUPPORTED_FEATURES } from './toProduction.differential';

const fixture = (parts: Partial<ReferenceFixture> & Pick<ReferenceFixture, 'items'>): ReferenceFixture => ({
  schemaVersion: 1,
  weapons: [{ id: 'gun', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1000 }] }],
  ...parts,
});
const request = (extra: Partial<ReferenceRequest> = {}): ReferenceRequest => ({ weapon_id: 'gun', ...extra });
const mod = (lookup: ReturnType<typeof mapFixture>, id: string): ModLookupEntry => {
  const entry = lookup[id];
  assert.equal(entry.type, 'mod');
  return entry as ModLookupEntry;
};
const gun = (lookup: ReturnType<typeof mapFixture>, id: string): GunLookupEntry => {
  const entry = lookup[id];
  assert.equal(entry.type, 'gun');
  return entry as GunLookupEntry;
};

// --- stats and units -----------------------------------------------------------------------------------

test('mod stats keep the reference units: kg, ergonomics points, recoil as a fraction, accuracy in percent points', () => {
  const lookup = mapFixture(fixture({
    items: [{
      id: 'm', categories: ['own', 'parent'], weightKg: 0.0155, ergonomics: -3.5, recoilModifier: -0.05, accuracyModifier: 12.5,
      centerOfImpact: 1.25, magazineCapacity: 30, sightingRange: 400,
    }],
  }));
  const stats = mod(lookup, 'm').stats;
  assert.equal(stats.weight, 0.0155);
  assert.equal(stats.ergonomics, -3.5);
  assert.equal(stats.recoil_modifier, -0.05);
  assert.equal(stats.accuracy_modifier, 12.5);
  assert.equal(stats.center_of_impact, 1.25);
  assert.equal(stats.capacity, 30);
  assert.equal(stats.sighting_range, 400);
  assert.equal(stats.category_id, 'own', 'production keeps only the own category id');
});

test('omitted mod fields take the reference defaults', () => {
  const lookup = mapFixture(fixture({ items: [{ id: 'm' }] }));
  const entry = mod(lookup, 'm');
  assert.deepEqual(
    [entry.stats.weight, entry.stats.ergonomics, entry.stats.recoil_modifier, entry.stats.accuracy_modifier, entry.stats.center_of_impact, entry.stats.capacity, entry.stats.sighting_range],
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(entry.slots, []);
  assert.deepEqual(entry.conflicting_items, []);
  assert.deepEqual(entry.conflicting_slot_ids, []);
  assert.equal(entry.stats.category_id, '');
  assert.deepEqual(entry.stats.offers, []);
  assert.equal(entry.stats.purchasable, false, 'no offers means not purchasable, as the extractor reads it');
  assert.equal(entry.stats.price, 0);
});

test('the receiver becomes a gun entry with naked stats, slots and every other weapon is a gun entry too', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'a' }],
    weapons: [
      { id: 'gun', weightKg: 3.2, ergonomics: 40, recoilVertical: 150, recoilHorizontal: 300, centerOfImpact: 3.5, sightingRange: 100, slots: [{ id: 's', required: true, allowedItemIds: ['a'] }] },
      { id: 'other', offers: [] },
    ],
  }));
  const g = gun(lookup, 'gun');
  assert.deepEqual(
    [g.stats.weight, g.stats.naked_ergonomics, g.stats.naked_recoil_v, g.stats.naked_recoil_h, g.stats.center_of_impact, g.stats.sighting_range],
    [3.2, 40, 150, 300, 3.5, 100],
  );
  assert.deepEqual(g.slots.map(s => [s.id, s.required, s.allowedItems]), [['s', true, ['a']]]);
  assert.equal(gun(lookup, 'other').stats.offers.length, 0);
});

// --- slots and conflicts ---------------------------------------------------------------------------------

test('slots carry required and the allowed list; conflicts carry item and slot ids; a self-listing is kept', () => {
  const lookup = mapFixture(fixture({
    items: [
      { id: 'h', slots: [{ id: 'hs', allowedItemIds: ['c'] }, { id: 'hr', required: true, allowedItemIds: ['c', 'd'] }], conflictingItemIds: ['d', 'h'], conflictingSlotIds: ['x', 'y'] },
      { id: 'c' }, { id: 'd' },
    ],
  }));
  const h = mod(lookup, 'h');
  assert.deepEqual(h.slots.map(s => [s.id, s.required, s.allowedItems]), [['hs', false, ['c']], ['hr', true, ['c', 'd']]]);
  assert.deepEqual(h.conflicting_items, ['d', 'h']);
  assert.deepEqual(h.conflicting_slot_ids, ['x', 'y']);
});

test('a receiver-listed conflict is carried as a conflict of the listed mod with the receiver (the oracle symmetrizes it)', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'a' }, { id: 'b', conflictingItemIds: ['a'] }],
    weapons: [{ id: 'gun', conflictingItemIds: ['a'] }],
  }));
  assert.deepEqual(mod(lookup, 'a').conflicting_items, ['gun']);
  assert.deepEqual(mod(lookup, 'b').conflicting_items, ['a']);
});

// --- category -----------------------------------------------------------------------------------------------

test('the whole category chain is carried as production carries it, so an ancestor filter is representable (no unsupported feature)', () => {
  const items = [{ id: 'a', categories: ['leaf', 'mid', 'root'] }, { id: 'b', categories: ['other', 'root'] }];
  const f = fixture({ items });
  const lookup = mapFixture(f);
  assert.equal(mod(lookup, 'a').stats.category_id, 'leaf', 'the own category id');
  assert.deepEqual(mod(lookup, 'a').data.bsgCategory, { id: 'leaf', parent: { id: 'mid', parent: { id: 'root', parent: null } } }, 'the nested chain data.bsgCategory');
  assert.equal(mod(mapFixture(fixture({ items: [{ id: 'c' }] })), 'c').data.bsgCategory, null, 'an item with no category has no chain');
  assert.deepEqual(detectUnsupported(f, request({ exclude_categories: ['leaf'] })), []);
  assert.deepEqual(detectUnsupported(f, request({ include_categories: [['mid'], ['leaf']] })), [], 'an ancestor include is matched by the chain');
  assert.deepEqual(detectUnsupported(f, request({ exclude_categories: ['root'] })), [], 'an ancestor exclude is matched by the chain');
});

// --- offers ---------------------------------------------------------------------------------------------

test('trader offers keep seller, level and RUB price; the cheapest offer sets price and source, offers sort ascending', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'm', offers: [
      { kind: 'trader', trader: 'skier', level: 3, price: 900 },
      { kind: 'trader', trader: 'prapor', level: 1, price: 500 },
    ] }],
  }));
  const stats = mod(lookup, 'm').stats;
  assert.deepEqual(stats.offers.map(o => [o.source, o.vendor_normalized, o.trader_level, o.price]), [['prapor', 'prapor', 1, 500], ['skier', 'skier', 3, 900]]);
  assert.equal(stats.purchasable, true);
  assert.equal(stats.price, 500);
  assert.equal(stats.price_source, 'prapor');
});

test('a stored price <= 0 is not an offer: it is dropped, and an item with nothing left is not purchasable', () => {
  const lookup = mapFixture(fixture({ items: [{ id: 'm', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 0 }, { kind: 'flea', price: -5 }] }] }));
  const stats = mod(lookup, 'm').stats;
  assert.deepEqual(stats.offers, []);
  assert.equal(stats.purchasable, false);
  assert.equal(stats.price_source, 'not_purchasable');
});

test('flea offers carry the fleaMarket source, no trader level and the player-level gate in min_level_flea', () => {
  const lookup = mapFixture(fixture({ items: [{ id: 'm', offers: [{ kind: 'flea', price: 700, minPlayerLevel: 20 }] }, { id: 'n', offers: [{ kind: 'flea', price: 800 }] }] }));
  const m = mod(lookup, 'm').stats;
  assert.deepEqual(m.offers.map(o => [o.source, o.trader_level, o.price]), [['fleaMarket', null, 700]]);
  assert.equal(m.min_level_flea, 20);
  assert.equal(mod(lookup, 'n').stats.min_level_flea, 0);
});

test('a barter is priced as the extractor prices it (float sum, rounded) and keeps its ingredients and dogtag flag', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'm', offers: [{
      kind: 'barter', trader: 'mechanic', level: 2, requiresDogtag: true,
      requirements: [
        { itemId: 'bolt', count: 2.5, avg24hPrice: 100, basePrice: 50 },
        { itemId: 'wire', count: 3, avg24hPrice: null, basePrice: 11 },
        { itemId: 'ghost', count: 1 },
      ],
    }, { kind: 'barter', trader: 'prapor', level: 1, requirements: [{ count: 1, avg24hPrice: 0, basePrice: 0 }] }] }],
  }));
  const offers = mod(lookup, 'm').stats.offers;
  assert.equal(offers.length, 1, 'a zero-total barter is not an offer');
  assert.equal(offers[0].price, Math.round(2.5 * 100 + 3 * 11));
  assert.equal(offers[0].source, 'barter:mechanic');
  assert.equal(offers[0].trader_level, 2);
  assert.equal(offers[0].requires_dogtag, true);
  assert.deepEqual(offers[0].barter_requirements?.map(r => [r.name, r.count, r.unit_price]), [['bolt', 2.5, 100], ['wire', 3, 11], ['ghost', 1, 0]]);
});

test('receiver and preset offers map like mod offers; presets carry count-bearing components with the base price from their cheapest offer', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'a' }, { id: 'b' }],
    weapons: [{ id: 'gun', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1000 }, { kind: 'flea', price: 1200 }] }],
    presets: [
      { id: 'p1', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }, { itemId: 'gun', count: 1 }, { itemId: 'b', count: 0 }], offers: [{ kind: 'trader', trader: 'skier', level: 2, price: 2500 }] },
      { id: 'p2', weaponId: 'gun', components: [{ itemId: 'b', count: 1 }], offers: [] },
    ],
  }));
  const g = gun(lookup, 'gun');
  assert.deepEqual(g.stats.offers.map(o => [o.source, o.price]), [['prapor', 1000], ['fleaMarket', 1200]]);
  assert.equal(g.stats.price, 1000);
  assert.deepEqual(g.all_presets.map(p => p.id), ['p1', 'p2']);
  assert.deepEqual(g.presets.map(p => p.id), ['p1'], 'presets lists the purchasable ones, as the extractor does');
  const p1 = g.all_presets[0];
  assert.deepEqual(p1.items, [{ itemId: 'a', count: 1 }, { itemId: 'b', count: 0 }], 'count-bearing components; a zero count stays a component that supplies nothing; the receiver entry is base identity, not stock');
  assert.equal(p1.receiver_id, 'gun');
  assert.equal(p1.price, 2500);
  assert.equal(p1.purchasable, true);
  assert.equal(g.all_presets[1].purchasable, false);
});

test('a preset is attached to the receiver it is built on', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'a' }],
    weapons: [{ id: 'gun' }, { id: 'other' }],
    presets: [{ id: 'p', weaponId: 'other', components: [{ itemId: 'a', count: 1 }], offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 10 }] }],
  }));
  assert.deepEqual(gun(lookup, 'gun').all_presets, []);
  assert.deepEqual(gun(lookup, 'other').all_presets.map(p => p.id), ['p']);
});

// --- request ---------------------------------------------------------------------------------------------

test('every request cap, list, weight and flag reaches the matching SolveParams field', () => {
  const r: ReferenceRequest = {
    weapon_id: 'gun', max_price: 5000, min_ergonomics: 35, max_recoil_v: 120, max_recoil_sum: 400, min_mag_capacity: 30,
    min_sighting_range: 200, max_weight: 4.5, max_moa: 4, prevent_overswing: true, equip_ergo_modifier: -0.15,
    include_items: ['a'], exclude_items: ['b'], include_categories: [['c1', 'c2'], ['c3']], exclude_categories: ['c4'],
    ergo_weight: 2, recoil_weight: 0, price_weight: 0.5, use_true_ergo: true, use_tchebycheff: true,
    ideal_point: { zE: 1, nadE: 2, zR: 3, nadR: 4, zP: 5, nadP: 6 },
    trader_levels: { prapor: 2, skier: 0 }, flea_available: false, barter_available: true, barter_exclude_dogtags: true, player_level: 15,
  };
  const p = mapRequest(r);
  assert.deepEqual(
    [p.maxPrice, p.minErgonomics, p.maxRecoilV, p.maxRecoilSum, p.minMagCapacity, p.minSightingRange, p.maxWeight, p.maxMOA],
    [5000, 35, 120, 400, 30, 200, 4.5, 4],
  );
  assert.equal(p.preventOverswing, true);
  assert.equal(p.equipErgoModifier, -0.15);
  assert.deepEqual(p.includeItems, ['a']);
  assert.deepEqual(p.excludeItems, ['b']);
  assert.deepEqual(p.includeCategories, [['c1', 'c2'], ['c3']]);
  assert.deepEqual(p.excludeCategories, ['c4']);
  assert.deepEqual([p.ergoWeight, p.recoilWeight, p.priceWeight], [2, 0, 0.5]);
  assert.equal(p.useTrueErgo, true);
  assert.equal(p.useTchebycheff, true);
  assert.deepEqual(p.idealPoint, { zE: 1, nadE: 2, zR: 3, nadR: 4, zP: 5, nadP: 6 });
  assert.deepEqual(p.traderLevels, { prapor: 2, skier: 0 });
  assert.equal(p.fleaAvailable, false);
  assert.equal(p.barterAvailable, true);
  assert.equal(p.barterExcludeDogtags, true);
  assert.equal(p.playerLevel, 15);
});

test('absent request fields stay absent so production applies its own defaults; a cap of 0 is a real cap', () => {
  const p = mapRequest(request({ max_price: 0, max_weight: 0, min_ergonomics: 0 }));
  assert.equal(p.maxPrice, 0);
  assert.equal(p.maxWeight, 0);
  assert.equal(p.minErgonomics, 0);
  assert.equal(p.maxRecoilV, null);
  assert.equal(p.ergoWeight, undefined);
  assert.equal(p.priceWeight, undefined);
  assert.equal(p.fleaAvailable, undefined);
  assert.equal(p.playerLevel, null);
  assert.equal(p.traderLevels, null);
  assert.equal(p.idealPoint, undefined);
  assert.equal(p.useTrueErgo, undefined);
});

test('toProduction assembles the lookup, the compatibility map and the solve params for the requested precision mode', () => {
  const f = fixture({ items: [{ id: 'a' }, { id: 'b' }], weapons: [{ id: 'gun', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 1 }], slots: [{ id: 's', allowedItemIds: ['a'] }] }] });
  const precise = toProduction(f, request({ max_price: 7 }), { preciseMode: true, timeLimitMs: 1234, objectiveTolerance: 1e-9 });
  assert.equal(precise.weaponId, 'gun');
  assert.equal(precise.params.weaponId, 'gun');
  assert.equal(precise.params.preciseMode, true);
  assert.equal(precise.params.timeLimitMs, 1234);
  assert.equal(precise.params.objectiveTolerance, 1e-9);
  assert.equal(precise.params.maxPrice, 7);
  assert.deepEqual(Object.keys(precise.compatibilityMap.reachable_items), ['a'], 'b is not reachable from any slot');
  assert.equal(precise.params.itemLookup, precise.itemLookup);
  assert.equal(precise.params.compatibilityMap, precise.compatibilityMap);
  assert.deepEqual(precise.unsupported, []);
  assert.equal(toProduction(f, request(), { preciseMode: false }).params.preciseMode, false);
});

// --- unsupported features --------------------------------------------------------------------------------

const flags = (f: ReferenceFixture, r: ReferenceRequest = request()) => detectUnsupported(f, r).map(u => u.feature);

test('owned_items is carried to SolveParams.ownedItems as a multiset copy, so it is no longer an unsupported feature', () => {
  const f = fixture({ items: [{ id: 'a' }] });
  for (const owned of [['a'], ['a', 'a', 'unknown'], [], null, undefined]) {
    assert.deepEqual(flags(f, request({ owned_items: owned })), [], 'production inputs can represent every stash');
  }
  assert.ok(!(UNSUPPORTED_FEATURES as readonly string[]).includes('owned_items'), 'the detector was removed with the transport');
  const source = ['a', 'a', 'unknown'];
  const mapped = mapRequest(request({ owned_items: source })).ownedItems;
  assert.deepEqual(mapped, ['a', 'a', 'unknown'], 'duplicates keep their multiplicity, unknown ids stay');
  assert.notEqual(mapped, source, 'a copy, never the fixture array');
  assert.deepEqual(mapRequest(request({ owned_items: [] })).ownedItems, []);
  assert.equal(mapRequest(request({ owned_items: null })).ownedItems, undefined, 'null reads as omitted');
  assert.equal(mapRequest(request()).ownedItems, undefined, 'absent stays absent');
  assert.deepEqual(toProduction(f, request({ owned_items: ['a', 'a'] }), { preciseMode: true }).params.ownedItems, ['a', 'a']);
});

test('preset component quantities of every size are representable, so none is reported as unsupported', () => {
  const mk = (components: { itemId: string; count: number }[]) => fixture({
    items: [{ id: 'a' }], presets: [{ id: 'p', weaponId: 'gun', components, offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 5 }] }],
  });
  assert.deepEqual(flags(mk([{ itemId: 'a', count: 1 }])), []);
  assert.deepEqual(flags(mk([{ itemId: 'a', count: 0 }])), []);
  assert.deepEqual(flags(mk([{ itemId: 'a', count: 2 }])), []);
  assert.deepEqual(flags(mk([{ itemId: 'a', count: 1 }, { itemId: 'a', count: 1 }])), []);
  assert.deepEqual(flags(mk([{ itemId: 'gun', count: 1 }])), []);
  assert.ok(!(UNSUPPORTED_FEATURES as readonly string[]).includes('preset_component_count_gt_1'), 'the detector was removed with the repair');
});

test('preset components keep their quantities: repeated entries sum, counts above one survive, the receiver entry is identity', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    presets: [{
      id: 'p', weaponId: 'gun',
      components: [{ itemId: 'gun', count: 1 }, { itemId: 'a', count: 2 }, { itemId: 'b', count: 1 }, { itemId: 'b', count: 1 }, { itemId: 'c', count: 60 }],
      offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 5 }],
    }],
  }));
  const p = gun(lookup, 'gun').all_presets[0];
  assert.deepEqual(p.items, [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 2 }, { itemId: 'c', count: 60 }]);
  assert.equal(p.receiver_id, 'gun');
});

test('a barter lot of any size is representable: the lot size is carried on the offer, so it is no longer an unsupported feature', () => {
  const mk = (offeredCount?: number) => fixture({
    items: [{ id: 'a', offers: [{ kind: 'barter', trader: 'prapor', level: 1, requirements: [{ count: 1, basePrice: 10 }], ...(offeredCount === undefined ? {} : { offeredCount }) }] }],
  });
  const lotOf = (offeredCount?: number): number | undefined => {
    const entry = mapFixture(mk(offeredCount)).a;
    assert.equal(entry.type, 'mod');
    return entry.type === 'mod' ? entry.stats.offers[0].lot_size : undefined;
  };
  for (const count of [undefined, 1, 3, 60]) assert.deepEqual(flags(mk(count)), []);
  assert.ok(!(UNSUPPORTED_FEATURES as readonly string[]).includes('barter_offered_count_gt_1'), 'the detector was removed with the lot size');
  assert.equal(lotOf(), 1, 'an absent offeredCount is one unit, as in the oracle');
  assert.equal(lotOf(1), 1);
  assert.equal(lotOf(3), 3);
  assert.equal(lotOf(60), 60);
  // The price stays the price of one whole lot (the rounded barter total), never a per-unit share.
  const priced = mapFixture(mk(3)).a;
  assert.equal(priced.type === 'mod' ? priced.stats.offers[0].price : -1, 10);
});

test('cash and flea offers carry no lot size; a barter lot size reaches a preset offer too', () => {
  const lookup = mapFixture(fixture({
    items: [{ id: 'a', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 5 }, { kind: 'flea', price: 7 }] }],
    presets: [{ id: 'p', weaponId: 'gun', components: [], offers: [{ kind: 'barter', trader: 'prapor', level: 1, offeredCount: 2, requirements: [{ count: 1, basePrice: 9 }] }] }],
  }));
  const a = lookup.a;
  assert.ok(a.type === 'mod' && a.stats.offers.length === 2 && a.stats.offers.every(o => !('lot_size' in o)));
  assert.equal(gun(lookup, 'gun').all_presets[0].offers[0].lot_size, 2);
});

test('a player-level flea gate is unsupported on a receiver or a preset, and on a mod with two flea offers at different levels', () => {
  const flea = (minPlayerLevel?: number) => ({ kind: 'flea' as const, price: 100, ...(minPlayerLevel === undefined ? {} : { minPlayerLevel }) });
  assert.deepEqual(flags(fixture({ items: [], weapons: [{ id: 'gun', offers: [flea(15)] }] })), ['flea_player_level_on_base']);
  assert.deepEqual(flags(fixture({ items: [], weapons: [{ id: 'gun', offers: [flea(0)] }] })), []);
  assert.deepEqual(flags(fixture({ items: [{ id: 'a' }], presets: [{ id: 'p', weaponId: 'gun', components: [], offers: [flea(5)] }] })), ['flea_player_level_on_base']);
  assert.deepEqual(flags(fixture({ items: [{ id: 'a', offers: [flea(10)] }] })), [], 'one gate on a mod fits min_level_flea');
  assert.deepEqual(flags(fixture({ items: [{ id: 'a', offers: [flea(10), flea(10)] }] })), []);
  assert.deepEqual(flags(fixture({ items: [{ id: 'a', offers: [flea(10), flea(30)] }] })), ['flea_offers_distinct_player_levels']);
});

test('a receiver magazine capacity matters only when the request has a magazine minimum', () => {
  const f = fixture({ items: [], weapons: [{ id: 'gun', magazineCapacity: 10 }] });
  assert.deepEqual(flags(f), []);
  assert.deepEqual(flags(f, request({ min_mag_capacity: 8 })), ['weapon_magazine_capacity']);
  assert.deepEqual(flags(fixture({ items: [], weapons: [{ id: 'gun' }] }), request({ min_mag_capacity: 8 })), []);
});

test('trader names production would canonicalize differently are unsupported (offers and trader_levels)', () => {
  assert.deepEqual(flags(fixture({ items: [{ id: 'a', offers: [{ kind: 'trader', trader: 'Prapor', level: 1, price: 10 }] }] })), ['non_canonical_trader_name']);
  assert.deepEqual(flags(fixture({ items: [] }), request({ trader_levels: { ' skier': 2 } })), ['non_canonical_trader_name']);
  assert.deepEqual(flags(fixture({ items: [{ id: 'a', offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 10 }] }] }), request({ trader_levels: { prapor: 2 } })), []);
});

test('a preset id equal to its receiver id or to the naked-base marker cannot be told apart from the naked base in the response', () => {
  const mk = (id: string) => fixture({ items: [], presets: [{ id, weaponId: 'gun', components: [], offers: [{ kind: 'trader', trader: 'prapor', level: 1, price: 10 }] }] });
  assert.deepEqual(flags(mk('gun')), ['ambiguous_preset_id']);
  assert.deepEqual(flags(mk('naked')), ['ambiguous_preset_id']);
  assert.deepEqual(flags(mk('p1')), []);
});

test('several unsupported features are all listed, once per feature id per subject, in a stable order', () => {
  const f = fixture({
    items: [{ id: 'a', categories: ['leaf', 'branch'], offers: [{ kind: 'trader', trader: 'Prapor', level: 1, price: 5 }] }],
    presets: [{ id: 'p', weaponId: 'gun', components: [{ itemId: 'a', count: 3 }], offers: [{ kind: 'flea', price: 5, minPlayerLevel: 20 }] }],
  });
  const found = flags(f, request({ exclude_categories: ['branch'] }));
  assert.deepEqual(found, ['flea_player_level_on_base', 'non_canonical_trader_name']);
  assert.deepEqual(found, flags(f, request({ exclude_categories: ['branch'] })), 'deterministic');
});

// --- the real ledger -----------------------------------------------------------------------------------

test('every ledger case maps without throwing and into a lookup that holds every fixture template', () => {
  const known = new Set<string>(UNSUPPORTED_FEATURES);
  for (const c of LEDGER) {
    const inputs = toProduction(c.fixture, c.request, { preciseMode: true });
    for (const w of c.fixture.weapons) assert.equal(inputs.itemLookup[w.id]?.type, 'gun', `${c.id}: ${w.id}`);
    for (const i of c.fixture.items) assert.equal(inputs.itemLookup[i.id]?.type, 'mod', `${c.id}: ${i.id}`);
    assert.equal(inputs.params.weaponId, c.request.weapon_id, c.id);
    for (const u of inputs.unsupported) assert.ok(known.has(u.feature), `${c.id}: ${u.feature}`);
  }
  // Phase 2.4b-3b removed the last detector a ledger case triggered (the chain is carried now): every case runs.
});

test('every ledger case with owned_items hands its stash to production, and none is reported unsupported for it', () => {
  const withStock = LEDGER.filter(c => (c.request.owned_items ?? []).length > 0);
  assert.ok(withStock.length >= 10);
  for (const c of withStock) {
    const inputs = toProduction(c.fixture, c.request, { preciseMode: true });
    assert.deepEqual(inputs.params.ownedItems, c.request.owned_items, c.id);
    assert.ok(!inputs.unsupported.some(u => (u.feature as string) === 'owned_items'), c.id);
  }
  for (const c of LEDGER.filter(x => (x.request.owned_items ?? []).length === 0)) {
    const stash = toProduction(c.fixture, c.request, { preciseMode: true }).params.ownedItems;
    assert.ok(stash === undefined || stash.length === 0, c.id);
  }
});

test('every ledger barter lot reaches production as OfferInfo.lot_size, and none is reported unsupported for it', () => {
  let lots = 0;
  let multi = 0;
  for (const c of LEDGER) {
    const lookup = mapFixture(c.fixture);
    const inputs = toProduction(c.fixture, c.request, { preciseMode: true });
    assert.ok(!inputs.unsupported.some(u => (u.feature as string) === 'barter_offered_count_gt_1'), c.id);
    const subjects = [
      ...c.fixture.items.map(i => ({ id: i.id, offers: i.offers ?? [], mapped: lookup[i.id] })),
      ...c.fixture.weapons.map(w => ({ id: w.id, offers: w.offers ?? [], mapped: lookup[w.id] })),
    ];
    for (const s of subjects) {
      const barters = s.offers.filter(o => o.kind === 'barter');
      if (barters.length === 0) continue;
      const mappedOffers = s.mapped.stats.offers;
      const mappedBarters = mappedOffers.filter(o => o.source.startsWith('barter:'));
      for (const o of mappedBarters) {
        lots++;
        assert.ok(Number.isInteger(o.lot_size) && (o.lot_size as number) >= 1, `${c.id}: ${s.id}`);
        if ((o.lot_size as number) > 1) multi++;
      }
    }
  }
  assert.ok(lots > 0 && multi >= 1, `barter offers ${lots}, multi-unit lots ${multi}`);
});
