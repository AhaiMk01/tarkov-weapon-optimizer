// The instance-aware manifest and the shopping list (src/components/common/manifest.ts, shoppingList.ts; ADR 0013 sections 4A and 4E, Phase 2.8):
// the split by per-occurrence provenance (preset supply / owned / purchased), repeated templates as separate occurrences with unique instance ids,
// preset components with counts, and a shopping list whose lines add up to the true spend. Real solver builds, not hand-built look-alikes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ItemDetail, OptimizeResponse } from '../../src/api/client';
import { partitionManifest, presetUsage, supplyOf } from '../../src/components/common/manifest';
import { manifestSpend, sellerLabelOf, shoppingListLines } from '../../src/components/common/shoppingList';
import type { ShoppingLabels } from '../../src/components/common/shoppingList';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { solve } from '../../src/solver/solver';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { barter, gun, lookupOf, mod, slot, trader, WEAPON } from '../physical/lpFixtures';

const LABELS: ShoppingLabels = { base: 'base', ownedBase: 'your own', preset: 'from preset', owned: 'owned', barter: 'barter', unknownSource: 'unknown' };

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, preciseMode: true, ...extra,
});

/**
 * A preset supplying one `a`; two slots for `a`; a slot for the owned `b`; a slot for `c` bought at a trader: every kind of provenance, and a
 * template (`a`) with two occurrences of different provenance. Spend: preset 1000 + the second `a` 100 + c 300 = 1400.
 */
const provenance = (): ItemLookup => lookupOf(
  gun(WEAPON, {
    slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['b']), slot('s4', ['c'])],
    presets: [{ id: 'pre', items: [{ itemId: 'a', count: 1 }], offers: [trader('prapor', 1, 1000)] }],
    offers: [trader('prapor', 1, 5000)],
  }),
  ['a', mod('a', { ergo: 5, weight: 0.5, offers: [trader('prapor', 1, 100)] })],
  ['b', mod('b', { ergo: 4, weight: 0.25, offers: [trader('skier', 1, 250)] })],
  ['c', mod('c', { ergo: 3, weight: 0.125, offers: [trader('mechanic', 1, 300)] })],
);

async function provenanceBuild(): Promise<OptimizeResponse> {
  const response = await solve(paramsOf(provenance(), { ownedItems: ['b'], priceWeight: 0.01 }));
  assert.equal(response.status, 'optimal', response.reason);
  return response;
}

test('the manifest is split by the provenance of each occurrence, not by template id: the preset\'s copy of `a` is on the card, the bought copy is listed', async () => {
  const response = await provenanceBuild();
  const { preset, listed } = partitionManifest(response);
  assert.deepEqual(preset.map(i => i.instanceId), ['weapon_0/s1:a'], 'the preset-supplied occurrence');
  assert.deepEqual(listed.map(i => i.instanceId), ['weapon_0/s2:a', 'weapon_0/s3:b', 'weapon_0/s4:c'], 'the purchased copy of `a`, the owned `b` and the bought `c`');
  assert.deepEqual(listed.map(i => supplyOf(i)), ['offer', 'owned', 'offer']);
  // Repeated templates stay separate occurrences: one template id, two instance ids, never merged.
  assert.deepEqual([...preset, ...listed].filter(i => i.id === 'a').map(i => i.instanceId), ['weapon_0/s1:a', 'weapon_0/s2:a']);
  assert.equal(new Set([...preset, ...listed].map(i => i.instanceId)).size, 4);
  assert.equal(preset.length + listed.length, response.selected_items.length, 'every occurrence is shown exactly once');
});

test('the preset keeps its component counts, and its usage is units supplied against occurrences installed from it', async () => {
  const response = await provenanceBuild();
  assert.deepEqual(response.selected_preset?.items, [{ itemId: 'a', count: 1 }]);
  assert.deepEqual(presetUsage(response), { supplied: 1, installed: 1 });
  // A preset that supplies two copies of a part and a build that installs one of them: the stripped copy is the difference.
  const stripped = await solve(paramsOf(lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a'])], presets: [{ id: 'pre', items: [{ itemId: 'a', count: 2 }], offers: [trader('prapor', 1, 1000)] }], offers: [trader('prapor', 1, 5000)] }),
    ['a', mod('a', { ergo: 5 })],
  )));
  assert.equal(stripped.status, 'optimal', stripped.reason);
  assert.deepEqual(stripped.selected_preset?.items, [{ itemId: 'a', count: 2 }]);
  assert.deepEqual(presetUsage(stripped), { supplied: 2, installed: 1 });
});

test('a naked receiver has no preset occurrences: every occurrence is listed', async () => {
  const lookup = lookupOf(gun(WEAPON, { slots: [slot('s1', ['a'])], offers: [trader('prapor', 1, 5000)] }), ['a', mod('a', { ergo: 5 })]);
  const response = await solve(paramsOf(lookup));
  assert.equal(response.status, 'optimal', response.reason);
  const { preset, listed } = partitionManifest(response);
  assert.equal(preset.length, 0);
  assert.equal(listed.length, 1);
  assert.deepEqual(presetUsage(response), { supplied: 0, installed: 0 });
});

test('a record without provenance is listed, never hidden as preset stock', () => {
  const bare = { id: 'x', instanceId: 'weapon_0/s:x', name: 'x', price: 10, ergonomics: 0, recoil_modifier: 0 } as ItemDetail;
  assert.equal(supplyOf(bare), null);
  const split = partitionManifest({ selected_items: [bare], selected_preset: { id: 'p', name: 'p', price: 0, receiver_id: 'g', items: [{ itemId: 'x', count: 1 }], acquisition: { source: 'offer' } } });
  assert.deepEqual([split.preset.length, split.listed.length], [0, 1]);
});

test('the shopping list reflects per-occurrence provenance and its lines add up to the true spend', async () => {
  const response = await provenanceBuild();
  const lines = shoppingListLines(response, LABELS);
  assert.deepEqual(lines, [
    `pre — base — ₽${(1000).toLocaleString()}`,
    'a — from preset',
    `a — Prapor — ₽${(100).toLocaleString()}`,
    'b — owned',
    `c — Mechanic — ₽${(300).toLocaleString()}`,
  ], 'the preset copy, the bought copy, the owned part and the bought part are four different lines, even for one template');
  assert.equal(manifestSpend(response), 1400);
  assert.equal(manifestSpend(response), response.final_stats?.total_price, 'the manifest spend equals the validator\'s exact spend');
});

test('copies of one template with one provenance are counted on a line (×n) with their summed charge, copies with another provenance are not merged in', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])], offers: [trader('prapor', 1, 5000)] }),
    ['a', mod('a', { ergo: 5, offers: [trader('prapor', 1, 100)] })],
  );
  const response = await solve(paramsOf(lookup, { ownedItems: ['a'] }));
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_item_ids, ['a', 'a', 'a']);
  const lines = shoppingListLines(response, LABELS);
  assert.deepEqual(lines, [`gun — base — ₽${(5000).toLocaleString()}`, 'a — owned', `a ×2 — Prapor — ₽${(200).toLocaleString()}`]);
  assert.equal(manifestSpend(response), 5200);
  assert.equal(manifestSpend(response), response.final_stats?.total_price);
});

test('a barter lot is charged once, on its first unit: the rider unit is listed at no charge and the spend still adds up', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])], offers: [trader('prapor', 1, 5000)] }),
    ['a', mod('a', { ergo: 5, offers: [barter('mechanic', 1, 600, false, 2)] })],
  );
  const response = await solve(paramsOf(lookup, { barterAvailable: true }));
  assert.equal(response.status, 'optimal', response.reason);
  assert.deepEqual(response.selected_items.map(i => i.price), [600, 0, 600], 'two lots of two for three units');
  assert.equal(manifestSpend(response), 5000 + 1200);
  assert.equal(manifestSpend(response), response.final_stats?.total_price);
  const lines = shoppingListLines(response, LABELS);
  assert.equal(lines.length, 2);
  assert.equal(lines[1], `a ×3 — Mechanic (barter) — ₽${(1200).toLocaleString()}`);
});

test('a gun nobody sells is the player’s own: the base line has no price, it is never a purchase, and the spend is the parts only', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a'])], offers: [], presets: [{ id: 'pre', items: [], offers: [] }] }),
    ['a', mod('a', { ergo: 5, offers: [trader('prapor', 1, 100)] })],
  );
  const response = await solve(paramsOf(lookup));
  assert.equal(response.status, 'optimal', response.reason);
  assert.equal(response.selected_preset?.id, WEAPON, 'the naked receiver, never the preset');
  assert.deepEqual(response.selected_preset?.acquisition, { source: 'owned' });
  assert.equal(response.selected_preset?.price, 0);
  assert.equal(response.selected_preset?.source, undefined, 'no seller');
  assert.equal(response.selected_preset?.purchase_label, undefined);
  assert.deepEqual(shoppingListLines(response, LABELS), ['gun — your own', `a — Prapor — ₽${(100).toLocaleString()}`]);
  assert.equal(manifestSpend(response), 100);
  assert.equal(manifestSpend(response), response.final_stats?.total_price);
  // a bought base is still a priced base line
  const bought = await solve(paramsOf(lookupOf(gun(WEAPON, { slots: [slot('s1', ['a'])], offers: [trader('prapor', 1, 5000)] }), ['a', mod('a', { ergo: 5 })])));
  assert.deepEqual(bought.selected_preset?.acquisition, { source: 'offer' });
});

test('seller labels: the flea market, a trader and a barter name their source; an unknown source says so', () => {
  assert.equal(sellerLabelOf('fleaMarket', LABELS), 'Flea Market');
  assert.equal(sellerLabelOf('prapor', LABELS), 'Prapor');
  assert.equal(sellerLabelOf('barter:mechanic', LABELS), 'Mechanic (barter)');
  assert.equal(sellerLabelOf(null, LABELS), 'unknown');
  assert.equal(sellerLabelOf('', LABELS), 'unknown');
});
