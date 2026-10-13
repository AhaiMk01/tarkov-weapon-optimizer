// Count-bearing preset quantities in the extractor (ADR 0013 section 4A, Stage 2 phase 2.2), offline on GraphQL-shaped raw items (the shape the
// JSON API adapter produces): counts kept, repeated entries summed, the receiver carried as `receiver_id`, and absent / null / malformed counts
// rejected as SourceDataErrors; presetSupply and mergeComponents are the one place that sums repeats. Migrated from test_preset_quantities.ts
// (Phase 2.9); its LP-row and structural-bound sections went with the pre-cutover LP builder, and the shopping list is tests/ui/manifest.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItemLookup, extractAllPresets } from '../../src/solver/dataService';
import { mergeComponents, presetSupply } from '../../src/solver/presetSupply';
import { SourceDataError } from '../../src/solver/sourceErrors';
import type { GunLookupEntry } from '../../src/solver/types';

type Raw = Parameters<typeof extractAllPresets>[0];

const PRESET_OFFER = [{ priceRUB: 1000, source: 'prapor', vendor: { name: 'Prapor', normalizedName: 'prapor', minTraderLevel: 1 } }];
const rawGun = (containsItems: unknown[], id = 'gun'): Raw => ({
  id,
  properties: { presets: [{ id: 'pre', name: 'The Preset', shortName: 'TP', containsItems, buyFor: PRESET_OFFER, bartersFor: [] }] },
}) as unknown as Raw;
const entry = (itemId: string, count: unknown) => ({ item: { id: itemId }, ...(count === undefined ? {} : { count }) });

test('counts above one survive; the receiver entry is carried as receiver_id, not as supplied stock', () => {
  const [preset] = extractAllPresets(rawGun([entry('gun', 1), entry('a', 2), entry('b', 1), entry('c', 60)]));
  assert.deepEqual(preset.items, [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 1 }, { itemId: 'c', count: 60 }]);
  assert.equal(preset.receiver_id, 'gun');
  assert.ok(!preset.items.some(c => c.itemId === 'gun'));
});

test('repeated entries sum, in first-appearance order', () => {
  const [preset] = extractAllPresets(rawGun([entry('a', 1), entry('gun', 1), entry('a', 1), entry('b', 2), entry('a', 3)]));
  assert.deepEqual(preset.items, [{ itemId: 'a', count: 5 }, { itemId: 'b', count: 2 }]);
});

test('a zero count is kept faithfully, but supplies nothing', () => {
  const [preset] = extractAllPresets(rawGun([entry('a', 0), entry('b', 1)]));
  assert.deepEqual(preset.items, [{ itemId: 'a', count: 0 }, { itemId: 'b', count: 1 }]);
  assert.deepEqual([...presetSupply(preset.items)], [['b', 1]]);
});

test('an absent, null or malformed count is a SourceDataError naming the preset and the item, never a default of 1', () => {
  const unusable: Array<[string, unknown, RegExp]> = [
    ['absent', undefined, /absent/],
    ['null', null, /null/],
    ['fractional', 1.5, /integer/],
    ['negative', -1, /nonnegative/],
    ['string', '2', /string/],
    ['infinite', Infinity, /finite/],
    ['unsafe', 2 ** 60, /integer/],
    ['NaN', NaN, /integer/],
  ];
  for (const [label, raw, message] of unusable) {
    assert.throws(
      () => extractAllPresets(rawGun([entry('gun', 1), entry('widget', raw)])),
      (error: unknown) => error instanceof SourceDataError
        && error.kind === 'preset_component_count'
        && error.subjectId === 'pre'
        && error.itemId === 'widget'
        && message.test(error.message)
        && error.message.includes('pre')
        && error.message.includes('widget'),
      `${label} count`,
    );
  }
  // The receiver's own entry is validated too: it is dropped from stock, not exempt from the rule.
  assert.throws(() => extractAllPresets(rawGun([entry('gun', undefined)])), SourceDataError);
  // buildItemLookup reaches the same rule.
  assert.throws(() => buildItemLookup([rawGun([entry('a', null)])], []), SourceDataError);
});

test('both preset lists of the lookup are count-bearing', () => {
  const gun = buildItemLookup([rawGun([entry('a', 2)])], []).gun as GunLookupEntry;
  assert.deepEqual(gun.presets[0].items, [{ itemId: 'a', count: 2 }]);
  assert.deepEqual(gun.all_presets[0].items, [{ itemId: 'a', count: 2 }]);
});

test('a barter ingredient quantity that is absent or null is a SourceDataError; a fractional one prices as count x unit price', () => {
  const withBarter = (count: unknown): Raw => {
    const gun = rawGun([entry('a', 1)]) as unknown as { properties: { presets: Record<string, unknown>[] } };
    gun.properties.presets[0].buyFor = [];
    gun.properties.presets[0].bartersFor = [{
      trader: { name: 'Mechanic', normalizedName: 'mechanic' }, level: 2,
      requiredItems: [{ item: { id: 'bolt', name: 'Bolt', avg24hPrice: 100, basePrice: 90 }, ...(count === undefined ? {} : { count }) }],
    }];
    return gun as unknown as Raw;
  };
  assert.throws(
    () => buildItemLookup([withBarter(undefined)], []),
    (error: unknown) => error instanceof SourceDataError && error.kind === 'barter_ingredient_count' && error.subjectId === 'pre' && error.itemId === 'bolt',
  );
  assert.throws(() => buildItemLookup([withBarter(null)], []), SourceDataError);
  const priced = (buildItemLookup([withBarter(2.5)], []).gun as GunLookupEntry).all_presets[0];
  assert.equal(priced.price, 250);
});

test('presetSupply sums repeats and drops zero supply; mergeComponents sums repeats and keeps zero entries', () => {
  assert.deepEqual([...presetSupply([{ itemId: 'a', count: 1 }, { itemId: 'b', count: 0 }, { itemId: 'a', count: 2 }])], [['a', 3]]);
  assert.deepEqual([...presetSupply(undefined)], []);
  assert.deepEqual(
    mergeComponents([{ itemId: 'a', count: 1 }, { itemId: 'b', count: 0 }, { itemId: 'a', count: 2 }]),
    [{ itemId: 'a', count: 3 }, { itemId: 'b', count: 0 }],
  );
});
