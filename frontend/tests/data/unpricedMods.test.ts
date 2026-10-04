// Unpriced mods stay in the lookup (ADR 0013 section 4A, ADR 0008 section 5).
//
// A mod with no legal standalone purchase is still part of the physical domain: it is capped by preset supply plus owned stock
// (installed_i <= sum_b q_bi * base_b + owned_i). The data layer used to drop a mod with no offer and no reference price from the
// lookup entirely; it now keeps it with an empty offer list, never with a stand-in price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItemLookup } from '../../src/solver/dataService';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import type { ItemLookup, ModLookupEntry } from '../../src/solver/types';
import { InactiveReason, preparePhysicalWeapon, prepareSubproblemDomain } from '../../src/solver/physical';
import { PinError } from '../../reference/source/pins';
import { withPinnedFetch } from '../../reference/source/pinnedFetchStub';
import { docsOf, rawItem, rawSlots, traderOffer, withStubbedJsonApi } from './syntheticWorld';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw GraphQL-shaped documents

const graphqlMod = (id: string, over: Loose = {}): Loose => ({
  id,
  name: id,
  basePrice: 0,
  avg24hPrice: null,
  buyFor: [],
  bartersFor: [],
  conflictingSlotIds: [],
  conflictingItems: [],
  handbookCategories: [],
  bsgCategory: null,
  properties: null,
  ...over,
});

// ---------------------------------------------------------------------------------------------
// The extractor keeps them
// ---------------------------------------------------------------------------------------------

test('a mod with no offer and no reference price stays in the lookup with an empty offer list and no price', () => {
  const lookup = buildItemLookup([], [
    graphqlMod('zero'),
    graphqlMod('nullPrice', { basePrice: null }),
    graphqlMod('absentPrice', { basePrice: undefined, avg24hPrice: undefined, buyFor: undefined, bartersFor: undefined }),
    graphqlMod('zeroOffer', { buyFor: [{ source: 'prapor', priceRUB: 0, vendor: { normalizedName: 'prapor', minTraderLevel: 1 } }] }),
    graphqlMod('priced', { basePrice: 100, buyFor: [{ source: 'prapor', priceRUB: 100, vendor: { name: 'Prapor', normalizedName: 'prapor', minTraderLevel: 1 } }] }),
  ]);
  for (const id of ['zero', 'nullPrice', 'absentPrice', 'zeroOffer']) {
    const entry = lookup[id] as ModLookupEntry | undefined;
    assert.ok(entry, `${id} is kept`);
    assert.equal(entry.type, 'mod');
    assert.deepEqual(entry.stats.offers, [], `${id}: no legal offer, no stand-in`);
    assert.equal(entry.stats.purchasable, false);
    assert.equal(entry.stats.price, 0);
    assert.equal(entry.stats.price_source, 'not_purchasable');
    assert.equal(entry.stats.reference_price_rub, undefined, 'no reference price either');
  }
  assert.equal((lookup.priced as ModLookupEntry).stats.offers.length, 1);
  assert.equal(Object.keys(lookup).length, 5);
});

test('a mod known only by a reference price was already kept and still is, flagged unpurchasable', () => {
  const lookup = buildItemLookup([], [graphqlMod('reference', { basePrice: 1234 })]);
  const entry = lookup.reference as ModLookupEntry;
  assert.deepEqual(entry.stats.offers, []);
  assert.equal(entry.stats.purchasable, false);
  assert.equal(entry.stats.reference_price_rub, 1234, 'display reference only');
});

// ---------------------------------------------------------------------------------------------
// The blueprint and the domain tolerate them
// ---------------------------------------------------------------------------------------------

const world = (withPreset: boolean) =>
  docsOf({
    items: [
      rawItem('gun', {
        types: ['gun'],
        buyFromTrader: [traderOffer(5000)],
        properties: {
          slots: rawSlots([{ id: 'grip', allowed: ['free', 'cheap'] }, { id: 'chamber', allowed: ['round'], required: true }]),
          presets: withPreset ? ['pre'] : [],
        },
      }),
      // basePrice 0, no flea price, no trader offer, no barter: nothing legal to buy and no reference price.
      rawItem('free', { types: ['mods'], basePrice: 0 }),
      rawItem('cheap', { types: ['mods'], buyFromTrader: [traderOffer(100)] }),
      rawItem('round', { types: ['ammo'], basePrice: 5 }),
      ...(withPreset
        ? [rawItem('pre', { types: ['preset'], buyFromTrader: [traderOffer(1000)], containsItems: [{ item: 'gun', count: 1 }, { item: 'free', count: 2 }] })]
        : []),
    ],
  });

async function lookupOfWorld(withPreset: boolean): Promise<ItemLookup> {
  const out = await withStubbedJsonApi(world(withPreset), () => fetchAllDataFromJsonApi('en', 'regular'));
  return buildItemLookup(out.guns, out.mods);
}

test('the blueprint keeps the unpriced mod as a template: it is neither dropped nor mistaken for ammunition', async () => {
  const lookup = await lookupOfWorld(false);
  assert.ok(lookup.free, 'the unpriced mod is in the lookup');
  const bp = preparePhysicalWeapon(lookup, 'gun');
  assert.ok(bp.templateIndexOf('free') > 0, 'a template of the physical universe');
  assert.ok(bp.occurrenceByInstanceId('weapon_0/grip:free') > 0);
  assert.deepEqual(bp.droppedAllowedItems, []);
  assert.deepEqual([...bp.removedAmmoItemIds], ['round'], 'only the real ammunition is removed');
  assert.equal(bp.structurallyViable[bp.occurrenceByInstanceId('weapon_0/grip:free')], 1);
});

test('with no legal offer, no preset and no stock the unpriced template has supply none; its occurrence is masked, never priced', async () => {
  const lookup = await lookupOfWorld(false);
  const bp = preparePhysicalWeapon(lookup, 'gun');
  const domain = prepareSubproblemDomain(bp, lookup, {});
  const free = domain.templates[bp.templateIndexOf('free')];
  assert.equal(free.supply, 'none');
  assert.deepEqual(free.standaloneOffers, []);
  assert.deepEqual(free.standaloneLots, []);
  assert.equal(free.cheapestPrice, null, 'no stand-in price');
  const occurrence = bp.occurrenceByInstanceId('weapon_0/grip:free');
  assert.equal(domain.occActive[occurrence], 0);
  assert.equal(domain.occInactiveReason[occurrence], InactiveReason.NO_SUPPLY);
  assert.equal(domain.occActive[bp.occurrenceByInstanceId('weapon_0/grip:cheap')], 1);
  assert.equal(domain.empty, false);
});

test('owned stock makes the unpriced template installable up to its stock, capped, still without a price', async () => {
  const lookup = await lookupOfWorld(false);
  const bp = preparePhysicalWeapon(lookup, 'gun');
  const domain = prepareSubproblemDomain(bp, lookup, { ownedItems: ['free', 'free'] });
  const free = domain.templates[bp.templateIndexOf('free')];
  assert.equal(free.supply, 'capped');
  assert.equal(free.owned, 2);
  assert.equal(free.cheapestPrice, null);
  assert.equal(domain.occActive[bp.occurrenceByInstanceId('weapon_0/grip:free')], 1);
});

test('an accessible preset that contains the unpriced mod caps it by the preset quantity', async () => {
  const lookup = await lookupOfWorld(true);
  const bp = preparePhysicalWeapon(lookup, 'gun');
  const domain = prepareSubproblemDomain(bp, lookup, {});
  const free = domain.templates[bp.templateIndexOf('free')];
  assert.equal(free.supply, 'capped');
  assert.deepEqual(free.presetSupply.map(p => [p.base, p.quantity]), [[1, 2]], 'base 1 is the preset (the naked receiver is base 0)');
  assert.equal(free.cheapestPrice, null);
  assert.equal(domain.occActive[bp.occurrenceByInstanceId('weapon_0/grip:free')], 1);
  // A user exclusion still wins over supply.
  const excluded = prepareSubproblemDomain(bp, lookup, { excludeItems: ['free'] });
  assert.equal(excluded.occInactiveReason[bp.occurrenceByInstanceId('weapon_0/grip:free')], InactiveReason.USER_EXCLUDED);
});

// ---------------------------------------------------------------------------------------------
// The pinned capture: what the old price filter would have dropped
// ---------------------------------------------------------------------------------------------

/** The price test `buildItemLookup` used to apply to every mod (kept here only to measure what it dropped). */
function legacyHasValidPrice(item: Loose): boolean {
  for (const offer of item.buyFor ?? []) if (typeof offer === 'object' && offer && (offer.priceRUB ?? 0) > 0) return true;
  if (Array.isArray(item.bartersFor) && item.bartersFor.length > 0) return true;
  if (typeof item.avg24hPrice === 'number' && item.avg24hPrice > 0) return true;
  return typeof item.basePrice === 'number' && item.basePrice > 0;
}

test('pinned capture: every mod is in the lookup; the old price filter would have dropped none, and 93 mods have no offer at all', async t => {
  let pinned: { result: { guns: Loose[]; mods: Loose[] } };
  try {
    pinned = await withPinnedFetch(() => fetchAllDataFromJsonApi('en', 'regular'));
  } catch (e) {
    if (e instanceof PinError) { t.skip(`pinned documents are not restored: ${e.message}`); return; }
    throw e;
  }
  const lookup = buildItemLookup(pinned.result.guns, pinned.result.mods);
  const entries = Object.values(lookup).filter((e): e is ModLookupEntry => e.type === 'mod');
  assert.equal(pinned.result.mods.length, 2314);
  assert.equal(entries.length, 2314, 'no mod is dropped');
  const wouldDrop = pinned.result.mods.filter(m => !legacyHasValidPrice(m));
  assert.equal(wouldDrop.length, 0, 'every pinned mod has a reference price, so the restored count on this capture is zero');
  const noOffer = entries.filter(e => e.stats.offers.length === 0);
  assert.equal(noOffer.length, 93, 'mods with no legal-offer candidate at all: kept (they were already, through their reference price)');
  assert.ok(noOffer.every(e => e.stats.purchasable === false && (e.stats.reference_price_rub ?? 0) > 0), 'all carry a display reference price, never a stand-in');
});
