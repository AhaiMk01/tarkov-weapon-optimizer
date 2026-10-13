// Seam: rawReader.ts -- an independent parser of raw tarkov.dev JSON API documents.
// These tests use small synthetic documents so each source rule is pinned in isolation;
// sourceChecks.test.ts exercises the same reader on the pinned real capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceError, indexBartersByOfferedItem, readRawWorld } from './rawReader';
import { item, presetOf, texts } from './syntheticDocs';

test('preserves containsItems counts, repeated entries and order as {itemId,count}', () => {
  const world = readRawWorld(texts([
    presetOf([
      { item: 'A', count: 1, attributes: {} },
      { item: 'B', count: 2, attributes: {} },
      { item: 'A', count: 3, attributes: {} },
    ]),
    item('A'),
    item('B'),
  ]));
  assert.deepEqual(world.items.get('P')?.components, [
    { itemId: 'A', count: 1 },
    { itemId: 'B', count: 2 },
    { itemId: 'A', count: 3 },
  ]);
});

test('accepts a zero count: finite nonnegative integers are all legal', () => {
  const world = readRawWorld(texts([presetOf([{ item: 'A', count: 0 }]), item('A')]));
  assert.deepEqual(world.items.get('P')?.components, [{ itemId: 'A', count: 0 }]);
});

const badCounts: Array<[string, unknown, string]> = [
  ['absent', undefined, 'absent'],
  ['null', null, 'null'],
  ['fractional', 1.5, 'integer'],
  ['negative', -1, 'negative'],
  ['numeric string', '2', 'number'],
  ['boolean', true, 'number'],
];

for (const [label, value, fragment] of badCounts) {
  test(`rejects a ${label} containsItems count as a source error (no ?? 1 default)`, () => {
    const entry: Record<string, unknown> = { item: 'A' };
    if (value !== undefined) entry.count = value;
    assert.throws(
      () => readRawWorld(texts([presetOf([{ item: 'B', count: 1 }, entry]), item('A'), item('B')])),
      (error: unknown) =>
        error instanceof SourceError && /containsItems\[1\]\.count/.test(error.message) && error.message.includes(fragment),
    );
  });
}

test('rejects an overflowing count token (1e400 parses to Infinity)', () => {
  const t = texts([presetOf([{ item: 'A', count: 7 }]), item('A')]);
  const patched = { ...t, items: t.items.replace('"count":7', '"count":1e400') };
  assert.notEqual(patched.items, t.items);
  assert.throws(() => readRawWorld(patched), (error: unknown) => error instanceof SourceError && /finite/.test(error.message));
});

test('keeps each weight as the raw number plus its exact source token', () => {
  const base = texts([item('A', { weight: 4242.5 }), item('B', { weight: 0.0155 })]);
  const patched = { ...base, items: base.items.replace('"weight":4242.5', '"weight":0.01550000000000000001') };
  assert.notEqual(patched.items, base.items);
  const world = readRawWorld(patched);
  assert.deepEqual(world.items.get('B')?.weight, { value: 0.0155, text: '0.0155' });
  // The token that cannot survive binary64 is preserved as text so the loss is detectable.
  const lossy = world.items.get('A')?.weight;
  assert.equal(lossy?.text, '0.01550000000000000001');
  assert.equal(lossy?.value, 0.0155);
  assert.notEqual(String(lossy?.value), lossy?.text);
});

test('an item without a weight reads as null rather than a silent 0', () => {
  const noWeight = item('A');
  delete noWeight.weight;
  assert.equal(readRawWorld(texts([noWeight])).items.get('A')?.weight, null);
});

test('slot definitions keep all four filter lists and the required flag', () => {
  const world = readRawWorld(texts([
    item('A', {
      properties: {
        propertiesType: 'ItemPropertiesWeaponMod',
        slots: [{
          id: 'S1', name: 'MOD_MUZZLE', nameId: 'mod_muzzle', required: true,
          filters: { allowedItems: ['B'], allowedCategories: ['C1'], excludedItems: ['D'], excludedCategories: ['C2'] },
        }],
      },
    }),
    item('B'),
    item('D'),
  ]));
  assert.deepEqual(world.items.get('A')?.slots, [{
    id: 'S1', nameKey: 'MOD_MUZZLE', nameId: 'mod_muzzle', required: true,
    allowedItemIds: ['B'], allowedCategoryIds: ['C1'], excludedItemIds: ['D'], excludedCategoryIds: ['C2'],
  }]);
});

test('a malformed slot is a source error that names the slot', () => {
  const broken = item('A', {
    properties: { slots: [{ id: 'S1', name: 'MOD_X', nameId: 'x', required: 'yes', filters: {} }] },
  });
  assert.throws(
    () => readRawWorld(texts([broken])),
    (error: unknown) => error instanceof SourceError && /slots\[0\]\.required/.test(error.message),
  );
});

test('conflicts, including a self-conflict, are preserved verbatim', () => {
  const world = readRawWorld(texts([item('A', { conflictingItems: ['A', 'B'], conflictingSlotIds: ['S9'] }), item('B')]));
  assert.deepEqual(world.items.get('A')?.conflictingItemIds, ['A', 'B']);
  assert.deepEqual(world.items.get('A')?.conflictingSlotIds, ['S9']);
});

test('trader offers and flea fields are preserved raw, not synthesized', () => {
  const world = readRawWorld(texts([item('A', {
    types: ['mods', 'noFlea'],
    lastLowPrice: 5000,
    avg24hPrice: 6000,
    buyFromTrader: [{ trader: 't1', price: 15, priceRUB: 2513, currency: 'USD', minTraderLevel: 2, buyLimit: 4, taskUnlock: null }],
  })]));
  const a = world.items.get('A');
  assert.equal(a?.noFlea, true);
  assert.equal(a?.lastLowPrice, 5000);
  assert.equal(a?.avg24hPrice, 6000);
  assert.equal(a?.basePrice, 100);
  assert.deepEqual(a?.buyFromTrader, [
    { traderId: 't1', currency: 'USD', price: 15, priceRUB: 2513, minTraderLevel: 2, buyLimit: 4, taskUnlock: null },
  ]);
});

test('barters keep fractional ingredient counts and index by offered item', () => {
  const bartersText = JSON.stringify({
    data: [
      { id: 'b1', trader: 't1', minTraderLevel: 3, taskUnlock: 'task9', requiredItems: [{ item: 'A', count: 155.1 }, { item: 'B', count: 2 }], offeredItem: { item: 'C', count: 1 } },
      { id: 'b2', trader: 't1', minTraderLevel: 1, taskUnlock: null, requiredItems: [{ item: 'A', count: 1 }], offeredItem: { item: 'C', count: 1 } },
    ],
  });
  const world = readRawWorld(texts([item('A'), item('B'), item('C')], { barters: bartersText }));
  assert.equal(world.barters.length, 2);
  assert.deepEqual(world.barters[0].requirements, [{ itemId: 'A', count: 155.1 }, { itemId: 'B', count: 2 }]);
  assert.equal(world.barters[0].taskUnlock, 'task9');
  const byItem = indexBartersByOfferedItem(world.barters);
  assert.deepEqual(byItem.get('C')?.map(b => b.id), ['b1', 'b2']);
  assert.equal(byItem.get('A'), undefined);
});

for (const [label, requirement] of [
  ['absent count', { item: 'A' }],
  ['null count', { item: 'A', count: null }],
  ['negative count', { item: 'A', count: -2 }],
  ['string count', { item: 'A', count: '2' }],
] as const) {
  test(`rejects a barter requirement with ${label}`, () => {
    const bartersText = JSON.stringify({
      data: [{ id: 'b1', trader: 't1', minTraderLevel: 1, requiredItems: [requirement], offeredItem: { item: 'C', count: 1 } }],
    });
    assert.throws(
      () => readRawWorld(texts([item('A'), item('C')], { barters: bartersText })),
      (error: unknown) => error instanceof SourceError && /requiredItems\[0\]\.count/.test(error.message),
    );
  });
}

test('resolves translations as requested language, then English, then the key', () => {
  const base = texts([item('A'), item('B'), item('C')]);
  const world = readRawWorld({
    ...base,
    itemsEn: JSON.stringify({ data: { 'A Name': 'Alpha', 'B Name': 'Bravo' } }),
    itemsLang: JSON.stringify({ data: { 'A Name': 'Alpha-zh' } }),
    tradersEn: JSON.stringify({ data: { 't1 Nickname': 'Prapor' } }),
    tradersLang: JSON.stringify({ data: {} }),
  }, 'zh');
  assert.equal(world.translateItemKey('A Name'), 'Alpha-zh');
  assert.equal(world.translateItemKey('B Name'), 'Bravo');
  assert.equal(world.translateItemKey('C Name'), 'C Name');
  assert.equal(world.translateTraderKey('t1 Nickname'), 'Prapor');
  const english = readRawWorld({ ...base, itemsEn: JSON.stringify({ data: { 'A Name': 'Alpha' } }) });
  assert.equal(english.translateItemKey('A Name'), 'Alpha');
  assert.equal(english.translateItemKey('B Name'), 'B Name');
  assert.equal(english.translateItemKey('constructor'), 'constructor');
});

test('requesting a non-English language without its documents is a source error, not a silent empty map', () => {
  assert.throws(
    () => readRawWorld(texts([item('A')]), 'zh'),
    (error: unknown) => error instanceof SourceError && /zh/.test(error.message),
  );
});

test('the categories chain is read as ids; parents and children are preserved', () => {
  const world = readRawWorld(texts(
    [item('A', { categories: ['c1', 'c0'], handbookCategories: ['h1'] })],
    {},
    {
      itemCategories: {
        c1: { id: 'c1', name: 'c1 Name', normalizedName: 'child', parent: 'c0', children: [] },
        c0: { id: 'c0', name: 'c0 Name', normalizedName: 'root', parent: null, children: ['c1'] },
      },
      handbookCategories: { h1: { id: 'h1', name: 'h1', normalizedName: 'hb', parent: null, children: [] } },
    },
  ));
  assert.deepEqual(world.items.get('A')?.categoryIds, ['c1', 'c0']);
  assert.equal(world.categories.get('c1')?.parentId, 'c0');
  assert.deepEqual(world.categories.get('c0')?.childIds, ['c1']);
  assert.equal(world.categories.get('c0')?.parentId, null);
  assert.equal(world.handbookCategories.get('h1')?.nameKey, 'h1');
  assert.deepEqual(world.items.get('A')?.handbookCategoryIds, ['h1']);
});

test('an empty-string category parent is the root sentinel, recorded rather than treated as a dangling id', () => {
  const world = readRawWorld(texts(
    [item('A', { categories: ['c0'] })],
    {},
    { itemCategories: { c0: { id: 'c0', name: 'c0 Name', normalizedName: 'root', parent: '', children: [] } } },
  ));
  const root = world.categories.get('c0');
  assert.equal(root?.parentId, null);
  assert.equal(root?.parentWasEmptyString, true);
});

test('an item whose map key differs from its id is a source error', () => {
  const t = texts([item('A')]);
  const patched = { ...t, items: t.items.replace('"A":{"id":"A"', '"A":{"id":"Z"') };
  assert.notEqual(patched.items, t.items);
  assert.throws(() => readRawWorld(patched), (error: unknown) => error instanceof SourceError && /id/.test(error.message));
});

test('an envelope without data is a source error', () => {
  assert.throws(
    () => readRawWorld({ ...texts([item('A')]), traders: '{"oops":1}' }),
    (error: unknown) => error instanceof SourceError && /data/.test(error.message),
  );
});
