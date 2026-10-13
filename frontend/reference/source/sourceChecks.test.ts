// Source checks over the raw upstream documents and the normalized snapshot (ADR 0013 §3).
// No production imports. Synthetic tests prove each check CAN fail; the pinned-capture tests
// record what the real, hash-verified bytes contain. Malformed/unresolved source is an
// input/evidence failure, never infeasibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPinnedWorld } from './pinnedWorld';
import { loadPinnedSnapshot, SNAPSHOT_SHA256 } from './pins';
import { buildWorld, parseRawDocuments, readRawWorld } from './rawReader';
import { item, presetOf, texts } from './syntheticDocs';
import {
  auditBarterCounts,
  auditContainsCounts,
  auditWeights,
  compareSnapshotPresetsToRaw,
  expandComponents,
  findCategoryChainMismatches,
  findItemsByWeightText,
  findUnresolvedReferences,
  gunPresetMultiplicities,
  readSnapshotPresets,
  reportSlotIds,
  summarizeUnresolved,
} from './sourceChecks';

// ----------------------------------------------------------------------------------------
// Each check can fail (synthetic documents)
// ----------------------------------------------------------------------------------------

test('findUnresolvedReferences reports every dangling id explicitly with its owner and kind', () => {
  const bartersText = JSON.stringify({
    data: [{ id: 'b1', trader: 'ghostTrader', minTraderLevel: 1, requiredItems: [{ item: 'ghostReq', count: 1 }], offeredItem: { item: 'ghostOffered', count: 1 } }],
  });
  const world = readRawWorld(texts([
    presetOf([{ item: 'ghostPart', count: 1 }]),
    item('A', {
      conflictingItems: ['ghostConflict'],
      categories: ['ghostCategory'],
      handbookCategories: ['ghostHandbook'],
      buyFromTrader: [{ trader: 'ghostSeller', price: 1, priceRUB: 1, currency: 'RUB', minTraderLevel: 1, buyLimit: 1, taskUnlock: null }],
      properties: {
        presets: ['ghostPreset'],
        defaultPreset: 'ghostDefault',
        slots: [{ id: 'S', name: 'MOD_X', nameId: 'x', required: false, filters: { allowedItems: ['ghostAllowed'], allowedCategories: ['ghostAllowedCat'], excludedItems: ['ghostExcluded'], excludedCategories: [] } }],
      },
    }),
  ], { barters: bartersText }));
  const found = findUnresolvedReferences(world);
  const byKind = summarizeUnresolved(found);
  assert.deepEqual(byKind, {
    'containsItems.item': 1,
    conflictingItems: 1,
    'slot.allowedItems': 1,
    'slot.excludedItems': 1,
    'slot.allowedCategories': 1,
    presets: 1,
    defaultPreset: 1,
    categories: 1,
    handbookCategories: 1,
    'buyFromTrader.trader': 1,
    'barter.trader': 1,
    'barter.requiredItems.item': 1,
    'barter.offeredItem.item': 1,
  });
  assert.ok(found.some(r => r.kind === 'containsItems.item' && r.ownerId === 'P' && r.ref === 'ghostPart'));
  assert.ok(found.some(r => r.kind === 'conflictingItems' && r.ownerId === 'A' && r.ref === 'ghostConflict'));
});

test('reportSlotIds separates within-template duplicates from cross-template collisions', () => {
  const slot = (id: string) => ({ id, name: 'MOD_X', nameId: 'x', required: false, filters: { allowedItems: [], allowedCategories: [], excludedItems: [], excludedCategories: [] } });
  const world = readRawWorld(texts([
    item('A', { properties: { slots: [slot('S1'), slot('S1'), slot('S2')] } }),
    item('B', { properties: { slots: [slot('S2'), slot('S3')] } }),
    item('C', { properties: { slots: [slot('S4')] } }),
  ]));
  const report = reportSlotIds(world);
  assert.deepEqual(report.duplicatesWithinTemplate, [{ templateId: 'A', slotId: 'S1', occurrences: 2 }]);
  assert.deepEqual(report.crossTemplateCollisions, [{ slotId: 'S2', templateIds: ['A', 'B'] }]);
  assert.equal(report.totalSlots, 6);
  assert.equal(report.templatesWithSlots, 3);
});

test('auditContainsCounts classifies every malformed raw count without needing the strict reader', () => {
  const docs = parseRawDocuments(texts([
    presetOf([
      { item: 'A', count: 1 }, { item: 'A', count: 3 }, { item: 'A' }, { item: 'A', count: null },
      { item: 'A', count: 1.5 }, { item: 'A', count: -1 }, { item: 'A', count: '2' },
    ]),
    item('A'),
  ]));
  assert.deepEqual(auditContainsCounts(docs.itemsData), {
    entries: 7, absent: 1, nullCount: 1, nonNumber: 1, nonFinite: 0, nonInteger: 1, negative: 1, greaterThanOne: 1,
  });
});

test('auditBarterCounts reports fractional, absent and non-unit offered counts', () => {
  const audit = auditBarterCounts([
    { id: 'b1', requiredItems: [{ item: 'A', count: 155.1 }, { item: 'A', count: 2 }], offeredItem: { item: 'C', count: 20 } },
    { id: 'b2', requiredItems: [{ item: 'A' }], offeredItem: { item: 'C', count: 1 } },
  ]);
  assert.deepEqual(audit, { barters: 2, requirementEntries: 3, absentOrNull: 1, fractional: 1, negative: 0, offeredCountNotOne: 1 });
});

test('expandComponents sums repeated entries into per-item quantities', () => {
  assert.deepEqual([...expandComponents([
    { itemId: 'A', count: 1 }, { itemId: 'B', count: 2 }, { itemId: 'A', count: 3 },
  ])], [['A', 4], ['B', 2]]);
});

test('auditWeights flags tokens that binary64 cannot carry exactly', () => {
  const base = texts([item('A', { weight: 77.5 }), item('B', { weight: 0.0155 })]);
  const lossy = { ...base, items: base.items.replace('"weight":77.5', '"weight":0.01550000000000000001') };
  const audit = auditWeights(readRawWorld(lossy));
  assert.equal(audit.withWeight, 2);
  assert.equal(audit.absent, 0);
  assert.deepEqual(audit.nonCanonical, [{ id: 'A', text: '0.01550000000000000001', value: 0.0155 }]);
  assert.deepEqual(findItemsByWeightText(readRawWorld(lossy), '0.0155').map(i => i.id), ['B']);
});

test('findCategoryChainMismatches detects an item whose categories are not its parent chain', () => {
  const categories = {
    c2: { id: 'c2', name: 'c2', normalizedName: 'two', parent: 'c1', children: [] },
    c1: { id: 'c1', name: 'c1', normalizedName: 'one', parent: 'c0', children: ['c2'] },
    c0: { id: 'c0', name: 'c0', normalizedName: 'zero', parent: null, children: ['c1'] },
  };
  const world = readRawWorld(texts([
    item('ok', { categories: ['c2', 'c1', 'c0'] }),
    item('skips', { categories: ['c2', 'c0'] }),
  ], {}, { itemCategories: categories }));
  assert.deepEqual(findCategoryChainMismatches(world).map(m => m.itemId), ['skips']);
});

// ----------------------------------------------------------------------------------------
// Pinned raw capture (English)
// ----------------------------------------------------------------------------------------

const pinned = loadPinnedWorld('en');

test('every referenced id resolves in the pinned capture; unresolved references would be listed explicitly', t => {
  const unresolved = findUnresolvedReferences(pinned.world);
  t.diagnostic(`items=${pinned.world.items.size} categories=${pinned.world.categories.size} traders=${pinned.world.traders.size} barters=${pinned.world.barters.length}`);
  t.diagnostic(`unresolved references: ${unresolved.length} ${JSON.stringify(summarizeUnresolved(unresolved))}`);
  assert.deepEqual(unresolved, [], `unresolved references: ${JSON.stringify(unresolved.slice(0, 20))}`);
});

test('slot ids are unique within every template; cross-template collisions are reported (issue #29)', t => {
  const report = reportSlotIds(pinned.world);
  t.diagnostic(`slots=${report.totalSlots} templatesWithSlots=${report.templatesWithSlots} withinTemplateDuplicates=${report.duplicatesWithinTemplate.length} crossTemplateCollisions=${report.crossTemplateCollisions.length}`);
  for (const collision of report.crossTemplateCollisions.slice(0, 10)) {
    t.diagnostic(`slot id ${collision.slotId} shared by ${collision.templateIds.join(', ')}`);
  }
  assert.deepEqual(report.duplicatesWithinTemplate, []);
  // Observed on the pinned bytes. Issue #29 still stands: the SOURCE gives no global slot-id
  // guarantee, so this is an observation about this capture that a re-pin must re-check.
  assert.deepEqual(report.crossTemplateCollisions, []);
  assert.equal(report.totalSlots, 3673);
});

test('the pinned capture contains no slot filter the production adapter would drop', () => {
  let nonEmptyAllowedCategories = 0;
  let nonEmptyExcludedItems = 0;
  let nonEmptyExcludedCategories = 0;
  for (const item of pinned.world.items.values()) {
    for (const slot of item.slots) {
      if (slot.allowedCategoryIds.length) nonEmptyAllowedCategories++;
      if (slot.excludedItemIds.length) nonEmptyExcludedItems++;
      if (slot.excludedCategoryIds.length) nonEmptyExcludedCategories++;
    }
  }
  assert.deepEqual({ nonEmptyAllowedCategories, nonEmptyExcludedItems, nonEmptyExcludedCategories }, {
    nonEmptyAllowedCategories: 0, nonEmptyExcludedItems: 0, nonEmptyExcludedCategories: 0,
  });
});

test('all containsItems counts are finite nonnegative integers (no absent/null/malformed entries)', t => {
  const audit = auditContainsCounts(pinned.docs.itemsData);
  t.diagnostic(`containsItems audit: ${JSON.stringify(audit)}`);
  assert.deepEqual(audit, {
    entries: 6112, absent: 0, nullCount: 0, nonNumber: 0, nonFinite: 0, nonInteger: 0, negative: 0, greaterThanOne: 381,
  });
  // The strict reader accepted the whole capture, so the same property holds per component.
  let readerEntries = 0;
  for (const item of pinned.world.items.values()) {
    for (const component of item.components) {
      readerEntries++;
      assert.ok(Number.isInteger(component.count) && component.count >= 0);
    }
  }
  assert.equal(readerEntries, audit.entries);
});

test('preset multiplicities (entries with count > 1) are recorded for the gun presets', t => {
  const { presetIds, summary } = gunPresetMultiplicities(pinned.world);
  t.diagnostic(`gun presets=${presetIds.length} entries=${summary.entries} entriesGt1=${summary.entriesGt1} presetsWithGt1=${summary.presetsWithGt1} presetsWithRepeatedItemIds=${summary.presetsWithRepeatedItemIds}`);
  assert.equal(presetIds.length, 399);
  assert.equal(summary.entries, 4391);
  assert.equal(summary.entriesGt1, 56);
  assert.equal(summary.multiplicities.length, 56);
  assert.equal(summary.presetsWithRepeatedItemIds, 0);
  for (const m of summary.multiplicities) {
    assert.ok(m.count > 1);
    assert.ok(pinned.world.items.has(m.presetId));
    assert.ok(pinned.world.items.has(m.itemId));
  }
});

test('barter ingredient counts: fractional counts are real source data, none are absent', t => {
  const audit = auditBarterCounts(pinned.docs.barters);
  t.diagnostic(`barter audit: ${JSON.stringify(audit)}`);
  assert.equal(audit.barters, 855);
  assert.equal(audit.requirementEntries, 1128);
  assert.equal(audit.absentOrNull, 0);
  assert.equal(audit.negative, 0);
  assert.equal(audit.fractional, 377);
});

test('fractional weights are preserved exactly from the raw text (0.0155 kg mount)', () => {
  const audit = auditWeights(pinned.world);
  assert.equal(audit.absent, 0);
  assert.equal(audit.withWeight, pinned.world.items.size);
  assert.deepEqual(audit.nonCanonical, [], 'every raw weight token round-trips through binary64 unchanged');
  const mounts = findItemsByWeightText(pinned.world, '0.0155');
  assert.deepEqual(mounts.map(m => m.id), ['688b54a11cef2a61d005273b']);
  assert.equal(mounts[0].normalizedName, 'elcan-specterdr-mounting-plate-for-trijicon');
  assert.deepEqual(mounts[0].weight, { value: 0.0155, text: '0.0155' });
  assert.ok(audit.fractional > 1000, 'fractional weights are the norm, not an exception');
});

test('every item category list is exactly its parent chain (the adapter\'s categories[0] claim)', () => {
  assert.deepEqual(findCategoryChainMismatches(pinned.world), []);
});

// ----------------------------------------------------------------------------------------
// Pinned Chinese translation documents (full requested -> English -> key chain)
// ----------------------------------------------------------------------------------------

test('the Chinese pin parses with the same item set and every key translated', () => {
  const zh = loadPinnedWorld('zh');
  assert.equal(zh.world.items.size, pinned.world.items.size);
  let unresolvedKeys = 0;
  for (const item of zh.world.items.values()) {
    if (zh.world.translateItemKey(item.nameKey) === item.nameKey) unresolvedKeys++;
  }
  assert.equal(unresolvedKeys, 0);
  assert.equal(zh.world.translateItemKey('FleaMarket'), '跳蚤市场');
  assert.equal(pinned.world.translateItemKey('FleaMarket'), 'Flea Market');
});

// ----------------------------------------------------------------------------------------
// Normalized snapshot
// ----------------------------------------------------------------------------------------

test('the normalized snapshot hash matches the pin and its preset component counts are present', t => {
  const { pin, snapshot } = loadPinnedSnapshot();
  assert.equal(pin.sha256, SNAPSHOT_SHA256);
  const report = readSnapshotPresets(snapshot);
  t.diagnostic(`snapshot guns=${report.gunCount} presetIds=${report.presets.size} entries=${report.entries} entriesGt1=${report.entriesGt1} (mods ${report.entriesGt1Mods}) invalidCounts=${report.invalidCounts}`);
  assert.equal(report.gunCount, 172);
  assert.equal(report.presets.size, 399);
  assert.equal(report.invalidCounts, 0, 'every snapshot component has an explicit finite nonnegative integer count');
  assert.equal(report.entriesGt1, 56);
  assert.equal(report.entriesGt1Mods, 35);
  assert.equal(report.conflictingDuplicates, 0, 'a preset id never carries two different component lists');
  assert.equal(report.presetsWithRepeatedItemIds, 0);
});

test('snapshot presets vs the pinned raw capture (different capture times: informational, not a provenance claim)', t => {
  const { snapshot } = loadPinnedSnapshot();
  const report = readSnapshotPresets(snapshot);
  const comparison = compareSnapshotPresetsToRaw(report, pinned.world);
  t.diagnostic(`common presets=${comparison.common} onlyInSnapshot=${comparison.onlyInSnapshot.length} onlyInRaw=${comparison.onlyInRaw.length} quantityDifferences=${comparison.quantityDifferences.length}`);
  for (const d of comparison.quantityDifferences.slice(0, 10)) t.diagnostic(`quantity difference: ${JSON.stringify(d)}`);
  // This is deliberately NOT asserted equal: the two captures are separate fetches. It only
  // checks that the comparison actually covered presets, so a vacuous pass is impossible.
  assert.ok(comparison.common > 300, `only ${comparison.common} presets were comparable`);
});

test('raw cardinalities agree with the normalized snapshot (consistency, not provenance)', () => {
  const { snapshot } = loadPinnedSnapshot();
  const root = snapshot as { guns: Array<{ id: string }>; mods: Array<{ id: string }> };
  const rawGuns = [...pinned.world.items.values()].filter(i => i.types.includes('gun'));
  const rawMods = [...pinned.world.items.values()].filter(i => i.types.includes('mods'));
  assert.equal(rawGuns.length, 172);
  assert.equal(rawMods.length, 2314);
  assert.deepEqual(root.guns.map(g => g.id), rawGuns.map(g => g.id));
  assert.deepEqual(root.mods.map(m => m.id), rawMods.map(m => m.id));
});

test('snapshot weights equal the raw weights, including the 0.0155 kg mount (observed equal across the two pinned captures)', t => {
  const { snapshot } = loadPinnedSnapshot();
  const root = snapshot as { guns: Array<{ id: string; weight: number }>; mods: Array<{ id: string; weight: number }> };
  let compared = 0;
  const differences: string[] = [];
  for (const entry of [...root.guns, ...root.mods]) {
    const raw = pinned.world.items.get(entry.id);
    if (!raw?.weight) continue;
    compared++;
    if (entry.weight !== raw.weight.value) differences.push(`${entry.id}: snapshot ${entry.weight} raw ${raw.weight.text}`);
  }
  t.diagnostic(`compared ${compared} weights; differences=${differences.length}`);
  for (const d of differences.slice(0, 10)) t.diagnostic(d);
  assert.ok(compared > 2400);
  assert.deepEqual(differences, []);
  const mount = root.mods.find(m => m.id === '688b54a11cef2a61d005273b');
  assert.equal(mount?.weight, 0.0155);
});

test('a world can be rebuilt from parsed documents (reader is deterministic)', () => {
  const again = buildWorld(pinned.docs, 'en');
  assert.equal(again.items.size, pinned.world.items.size);
  assert.deepEqual(again.items.get('5447a9cd4bdc2dbd208b4567')?.components, pinned.world.items.get('5447a9cd4bdc2dbd208b4567')?.components);
});
