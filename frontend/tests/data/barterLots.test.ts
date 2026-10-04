// Barter lot sizes (INTERPRETATIONS.md choice 1, ADR 0013 section 4A): `offeredItem.count` of the JSON barter documents is the number of units
// one barter delivers. It is validated at the source (an integer >= 1, never defaulted), carried on `OfferInfo.lot_size`, and fed to the
// domain's acquisition offers, which the physical LP later covers with whole lots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItemLookup } from '../../src/solver/dataService';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import { barterLotSize, SourceDataError } from '../../src/solver/sourceErrors';
import { lotSizeOf, preparePhysicalWeapon, prepareSubproblemDomain } from '../../src/solver/physical';
import { barter, flea, gun, lookupOf, mod, slot, trader, WEAPON } from '../physical/fixtures';
import { docsOf, rawBarter, rawItem, rawSlots, traderOffer, withStubbedJsonApi } from './syntheticWorld';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw GraphQL-shaped documents

/** One gun with a rail slot, one rail mod, one ingredient, and one barter offering the rail for 3 ingredients. */
const docs = (offeredCount: unknown, extra: ReturnType<typeof rawItem>[] = [], barters?: unknown[]) =>
  docsOf({
    items: [
      rawItem('gun', { types: ['gun'], properties: { slots: rawSlots([{ id: 's', allowed: ['rail'] }]), presets: [] } }),
      rawItem('rail', { types: ['mods'], buyFromTrader: [traderOffer(50)] }),
      rawItem('ing', { types: ['barter'], basePrice: 10 }),
      ...extra,
    ],
    barters: barters ?? [rawBarter('rail', offeredCount, [{ item: 'ing', count: 3 }])],
  });

const run = (world: Record<string, unknown>) => withStubbedJsonApi(world, () => fetchAllDataFromJsonApi('en', 'regular'));

// ---------------------------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------------------------

test('barterLotSize accepts a safe integer >= 1 and rejects everything else with a typed source error', () => {
  const subject = { offeredItemId: 'rail', itemId: 'rail' };
  for (const ok of [1, 2, 30, 60, Number.MAX_SAFE_INTEGER]) assert.equal(barterLotSize(ok, subject), ok);
  const bad: [unknown, RegExp][] = [
    [undefined, /absent/],
    [null, /null/],
    [0, /at least 1/],
    [-1, /at least 1/],
    [1.5, /integer/],
    [0.5, /integer/],
    ['30', /string/],
    [true, /boolean/],
    [Number.NaN, /integer/],
    [Infinity, /integer/],
    [2 ** 53, /integer/],
  ];
  for (const [raw, message] of bad) {
    assert.throws(
      () => barterLotSize(raw, { ...subject, offeredItemName: 'Rail' }),
      (e: unknown) => e instanceof SourceDataError && e.kind === 'barter_lot_size' && e.subjectId === 'rail' && e.itemId === 'rail'
        && Object.is(e.rawValue, raw) && message.test(e.message) && e.message.includes('rail') && /lot/i.test(e.message),
      `${String(raw)} must be rejected`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// Adapter: JSON API documents -> GraphQL-shaped payload -> extractors
// ---------------------------------------------------------------------------------------------

test('the adapter carries offeredItem.count as the barter lot size, and the extractor puts it on the offer', async () => {
  const out = await run(docs(30));
  const rail = out.mods.find((m: Loose) => m.id === 'rail') as Loose;
  assert.deepEqual(rail.bartersFor[0].rewardItems, [{ item: { id: 'rail' }, count: 30 }], 'GraphQL Barter.rewardItems shape');
  const lookup = buildItemLookup(out.guns, out.mods);
  const offers = (lookup.rail as { stats: { offers: Loose[] } }).stats.offers;
  const bartered = offers.find(o => o.source.startsWith('barter:'));
  assert.ok(bartered);
  assert.equal(bartered.lot_size, 30);
  assert.equal(bartered.price, 30, 'the price is the price of one whole lot (3 x 10), not a per-unit share');
  assert.equal(bartered.barter_requirements.length, 1);
  const cash = offers.find(o => o.source === 'prapor');
  assert.ok(cash);
  assert.equal('lot_size' in cash, false, 'a cash offer is a single unit and carries no lot size');
});

test('a lot of one unit is carried as 1, not omitted', async () => {
  const lookup = buildItemLookup(...(await run(docs(1)).then(o => [o.guns, o.mods] as const)));
  const bartered = (lookup.rail as { stats: { offers: Loose[] } }).stats.offers.find(o => o.source.startsWith('barter:'));
  assert.equal(bartered?.lot_size, 1);
});

const BAD_COUNTS: [label: string, count: unknown, message: RegExp][] = [
  ['absent', undefined, /absent/],
  ['null', null, /null/],
  ['zero', 0, /at least 1/],
  ['negative', -3, /at least 1/],
  ['fractional', 2.5, /integer/],
  ['numeric string', '30', /string/],
  ['boolean', true, /boolean/],
  ['unsafe integer', 2 ** 53, /integer/],
];

for (const [label, count, message] of BAD_COUNTS) {
  test(`the adapter rejects a ${label} offeredItem.count as a source error naming the offered item`, async () => {
    await assert.rejects(
      () => run(docs(count)),
      (e: unknown) => e instanceof SourceDataError && e.kind === 'barter_lot_size' && e.subjectId === 'rail' && e.itemId === 'rail'
        && message.test(e.message) && e.message.includes('rail'),
    );
  });
}

test('a barter that offers an item the adapter never converts (ammunition) does not block loading, even with a bad lot count', async () => {
  const ammo = rawItem('ammo', { types: ['ammo'], basePrice: 5 });
  const world = docs(1, [ammo], [
    rawBarter('rail', 1, [{ item: 'ing', count: 3 }]),
    rawBarter('ammo', undefined, [{ item: 'ing', count: 1 }]),
    rawBarter('ammo', 30, [{ item: 'ing', count: 1 }]),
  ]);
  const out = await run(world);
  assert.equal(out.guns.length, 1);
  assert.equal((out.mods.find((m: Loose) => m.id === 'rail') as Loose).bartersFor.length, 1);
});

test('a preset barter lot is validated and carried like a mod barter lot', async () => {
  const world = docsOf({
    items: [
      rawItem('gun', { types: ['gun'], properties: { slots: [], presets: ['pre'] } }),
      rawItem('rail', { types: ['mods'], buyFromTrader: [traderOffer(50)] }),
      rawItem('pre', { types: ['preset'], containsItems: [{ item: 'rail', count: 1 }] }),
      rawItem('ing', { types: ['barter'], basePrice: 10 }),
    ],
    barters: [rawBarter('pre', 1, [{ item: 'ing', count: 4 }])],
  });
  const lookup = await run(world).then(o => buildItemLookup(o.guns, o.mods));
  const preset = (lookup.gun as { all_presets: { offers: Loose[] }[] }).all_presets[0];
  assert.equal(preset.offers[0].lot_size, 1);
  assert.equal(preset.offers[0].price, 40);

  const bad = docsOf({
    items: [
      rawItem('gun', { types: ['gun'], properties: { slots: [], presets: ['pre'] } }),
      rawItem('pre', { types: ['preset'] }),
      rawItem('ing', { types: ['barter'], basePrice: 10 }),
    ],
    barters: [rawBarter('pre', undefined, [{ item: 'ing', count: 4 }])],
  });
  await assert.rejects(() => run(bad), (e: unknown) => e instanceof SourceDataError && e.kind === 'barter_lot_size' && e.subjectId === 'pre');
});

// ---------------------------------------------------------------------------------------------
// Extractor on GraphQL-shaped payloads (the GraphQL fallback, cached payloads, the pinned snapshot)
// ---------------------------------------------------------------------------------------------

const graphqlMod = (rewardItems: unknown, over: Loose = {}): Loose => ({
  id: 'm',
  name: 'M',
  basePrice: 100,
  avg24hPrice: null,
  buyFor: [],
  bartersFor: [{
    trader: { name: 'Prapor', normalizedName: 'prapor' },
    level: 2,
    requiredItems: [{ item: { id: 'i', name: 'I', avg24hPrice: 10, basePrice: 10 }, count: 2 }],
    ...(rewardItems === undefined ? {} : { rewardItems }),
  }],
  conflictingSlotIds: [],
  conflictingItems: [],
  handbookCategories: [],
  bsgCategory: null,
  properties: null,
  ...over,
});

const lotOf = (rewardItems: unknown): number | undefined => {
  const lookup = buildItemLookup([], [graphqlMod(rewardItems)]);
  return (lookup.m as { stats: { offers: Loose[] } }).stats.offers[0].lot_size;
};

test('the extractor reads Barter.rewardItems for the offered item and sums repeated entries', () => {
  assert.equal(lotOf([{ item: { id: 'm' }, count: 5 }]), 5);
  assert.equal(lotOf([{ item: { id: 'm' }, count: 2 }, { item: { id: 'm' }, count: 3 }]), 5);
  assert.equal(lotOf([{ item: { id: 'other' }, count: 9 }, { item: { id: 'm' }, count: 4 }]), 4, 'other reward items are not this item\'s units');
});

test('a payload that predates lot sizes (no rewardItems at all) yields an offer with no lot size; it is never defaulted at the source', () => {
  assert.equal(lotOf(undefined), undefined);
});

test('malformed rewardItems are source errors: not a list, no entry for the offered item, a bad count', () => {
  const expectError = (rewardItems: unknown) =>
    assert.throws(() => lotOf(rewardItems), (e: unknown) => e instanceof SourceDataError && e.kind === 'barter_lot_size' && e.subjectId === 'm');
  expectError([]);
  expectError('30');
  expectError({ item: { id: 'm' }, count: 3 });
  expectError([{ item: { id: 'other' }, count: 9 }]);
  expectError([{ item: { id: 'm' } }]);
  expectError([{ item: { id: 'm' }, count: null }]);
  expectError([{ item: { id: 'm' }, count: 0 }]);
  expectError([{ item: { id: 'm' }, count: 1.5 }]);
  expectError([{ item: { id: 'm' }, count: 2 }, { item: { id: 'm' }, count: -1 }]);
});

// ---------------------------------------------------------------------------------------------
// Domain: acquisition offers carry the lot size
// ---------------------------------------------------------------------------------------------

const lotsOf = (lookup: ReturnType<typeof lookupOf>, request: Parameters<typeof prepareSubproblemDomain>[2], id = 'm') => {
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(bp, lookup, request);
  return domain.templates[bp.templateIndexOf(id)].standaloneLots.map(o => [o.index, o.source, o.price, o.lotSize]);
};

const lotLookup = () =>
  lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m'])] }),
    ['m', mod('m', { offers: [trader('prapor', 1, 200), flea(150), barter('prapor', 1, 300, false, 3), barter('skier', 1, 80, true, 30), barter('prapor', 1, 90)] })],
  );

test('standalone lots carry units per purchase: 1 for cash and flea, the barter lot size for a barter, 1 for a barter that states none', () => {
  assert.deepEqual(lotsOf(lotLookup(), { barterAvailable: true }), [
    [0, 'prapor', 200, 1],
    [1, 'fleaMarket', 150, 1],
    [2, 'barter:prapor', 300, 3],
    [3, 'barter:skier', 80, 30],
    [4, 'barter:prapor', 90, 1],
  ]);
  assert.deepEqual(lotsOf(lotLookup(), {}).map(o => o[0]), [0, 1], 'barters stay off unless enabled');
  assert.deepEqual(lotsOf(lotLookup(), { barterAvailable: true, barterExcludeDogtags: true }).map(o => o[0]), [0, 1, 2, 4]);
  assert.deepEqual(lotsOf(lotLookup(), { barterAvailable: true, traderLevels: { skier: 0 } }).map(o => o[0]), [0, 1, 2, 4]);
});

test('lots stay aligned with the legal offer indexes, and the cheapest price is the cheapest whole lot, not the cheapest unit', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s', ['m'])] }),
    ['m', mod('m', { offers: [trader('prapor', 1, 200), barter('prapor', 1, 300, false, 3)] })],
  );
  const bp = preparePhysicalWeapon(lookup, WEAPON);
  const domain = prepareSubproblemDomain(bp, lookup, { barterAvailable: true });
  const acquisition = domain.templates[bp.templateIndexOf('m')];
  assert.deepEqual(acquisition.standaloneLots.map(o => o.index), [...acquisition.standaloneOffers]);
  assert.equal(acquisition.cheapestPrice, 200, '300 / 3 = 100 per unit is irrelevant: a lot is bought whole');
});

test('lotSizeOf is the units of one purchase of an offer', () => {
  assert.equal(lotSizeOf(trader('prapor', 1, 10)), 1);
  assert.equal(lotSizeOf(flea(10)), 1);
  assert.equal(lotSizeOf(barter('prapor', 1, 10)), 1);
  assert.equal(lotSizeOf(barter('prapor', 1, 10, false, 60)), 60);
});

test('the lot size of a barter whose payload has a malformed lot_size is an error, never silently 1', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => lotSizeOf(barter('prapor', 1, 10, false, bad)), /lot/i);
  }
});
