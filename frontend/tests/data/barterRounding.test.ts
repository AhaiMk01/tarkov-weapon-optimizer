// Exact barter lot pricing (ADR 0010 section 2, INTERPRETATIONS.md choice 3, Phase 2.5): the price of one whole lot is floor(total + 1/2) of the EXACT total of
// the decoded binary64 counts and unit prices, never of a float sum. Ledger case F09-fractional-barter-count-is-decoded-exactly differs by 1 RUB otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barterLotPrice } from '../../src/solver/physical/barterPrice';
import { barterLotPrice as exported, buildItemLookup } from '../../src/solver/dataService';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import { docsOf, rawBarter, rawItem, rawSlots, traderOffer, withStubbedJsonApi } from './syntheticWorld';

test('155.1 x 5 is just BELOW 775.5 in truth (775.5 - 2^-45) and rounds to 775, where the float sum reads 775.5 and rounds to 776', () => {
  assert.equal(155.1 * 5, 775.5, 'binary64 multiplication rounds the product up to exactly 775.5');
  assert.equal(Math.round(155.1 * 5), 776);
  assert.equal(barterLotPrice([{ count: 155.1, unitPrice: 5 }]), 775);
  assert.equal(exported, barterLotPrice, 'the data service exports the same function');
});

test('exact totals round half up: a true .5 rounds up, just below it down, just above it up', () => {
  assert.equal(barterLotPrice([{ count: 0.5, unitPrice: 3 }]), 2, '1.5 exactly');
  assert.equal(barterLotPrice([{ count: 2.5, unitPrice: 1 }]), 3);
  assert.equal(barterLotPrice([{ count: 0.7, unitPrice: 5 }]), 3, '0.7 is just below the decimal 0.7, so 0.7 x 5 is just below 3.5');
  assert.equal(Math.round(0.7 * 5), 4, 'where the float product is exactly 3.5');
  assert.equal(barterLotPrice([{ count: 1, unitPrice: 0.5 }]), 1);
  assert.equal(barterLotPrice([{ count: 1, unitPrice: 0.4999999999999999 }]), 0 + 0, 'a total below one half rounds to 0, which is a positive total but the price 0');
  assert.equal(barterLotPrice([{ count: 3, unitPrice: 100 }, { count: 7.52, unitPrice: 25.5 }]), 492, 'sums are exact: 300 + 191.76');
});

test('a total that is not positive is no offer, and a non-finite unit price reads as zero like a missing one', () => {
  assert.equal(barterLotPrice([]), null);
  assert.equal(barterLotPrice([{ count: 0, unitPrice: 100 }]), null);
  assert.equal(barterLotPrice([{ count: 3, unitPrice: 0 }]), null);
  assert.equal(barterLotPrice([{ count: 2, unitPrice: Number.NaN }]), null);
  assert.equal(barterLotPrice([{ count: 2, unitPrice: Infinity }, { count: 1, unitPrice: 10 }]), 10);
  assert.equal(barterLotPrice([{ count: 1e9, unitPrice: 1e9 }]), 1e18, 'a large exact total');
});

test('the production extractor prices the boundary barter exactly: 155.1 x 5 of an ingredient worth 5 costs 775, undercutting a 776 cash offer', async () => {
  const world = docsOf({
    items: [
      rawItem('gun', { types: ['gun'], properties: { slots: rawSlots([{ id: 's', allowed: ['fb'] }]), presets: [] } }),
      rawItem('fb', { types: ['mods'], buyFromTrader: [traderOffer(776)] }),
      rawItem('ing', { types: ['barter'], basePrice: 5 }),
    ],
    barters: [rawBarter('fb', 1, [{ item: 'ing', count: 155.1 * 5 / 5 }])],
  });
  // the ingredient is worth 5 each and the barter asks for 155.1 of them
  const out = await withStubbedJsonApi(world, () => fetchAllDataFromJsonApi('en', 'regular'));
  const lookup = buildItemLookup(out.guns, out.mods);
  const offers = (lookup.fb as { stats: { offers: { source: string; price: number }[] } }).stats.offers;
  const bartered = offers.find(o => o.source.startsWith('barter:'));
  assert.ok(bartered, 'the barter is an offer');
  assert.equal(bartered.price, 775, 'the extractor rounds the exact total, not the float sum');
});
