// Translation of the JSON API adapter (src/solver/jsonApiAdapter.ts), offline: names are translation keys resolved in the order requested
// language, then English, then the key itself; a missing language document falls back to English instead of failing the load. Replaces the
// live zh check of test_json_api_adapter.ts (Phase 2.9); the shape parity of that test is reference/source/adapter.differential.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import { docsOf, rawItem, rawSlots, traderOffer, withStubbedJsonApi } from './syntheticWorld';

const world = () => {
  const docs = docsOf({
    items: [
      rawItem('gun', { types: ['gun'], buyFromTrader: [traderOffer(5000)], properties: { slots: rawSlots([{ id: 'grip', allowed: ['a', 'b'] }]), presets: [] } }),
      rawItem('a', { types: ['mods'], buyFromTrader: [traderOffer(100)] }),
      rawItem('b', { types: ['mods'], buyFromTrader: [traderOffer(100)] }),
    ],
  }) as Record<string, Record<string, unknown>>;
  delete docs.items_en['b Name']; // no translation anywhere: the key itself is shown
  return docs;
};

/** The converted item with this id, read loosely (the adapter output is GraphQL-shaped raw data). */
const byId = (items: readonly object[], id: string) => items.find(i => (i as { id?: unknown }).id === id) as Record<string, unknown> | undefined;
const nameOf = (items: readonly object[], id: string) => byId(items, id)?.name;

test('a requested language wins, English fills its gaps, and a key with no translation is shown as the key', async () => {
  const docs = { ...world(), items_zh: { 'gun Name': '枪', 'a Short': '甲' }, traders_zh: { 't1 Nickname': '普拉波尔' } };
  const { guns, mods } = await withStubbedJsonApi(docs, () => fetchAllDataFromJsonApi('zh', 'regular'));
  assert.equal(nameOf(guns, 'gun'), '枪');
  assert.equal(nameOf(mods, 'a'), 'EN a', 'English where zh has no entry');
  assert.equal(byId(mods, 'a')?.shortName, '甲');
  assert.equal(nameOf(mods, 'b'), 'b Name', 'the key where neither language has one');
  const offer = (byId(mods, 'a')?.buyFor as { vendor?: { name?: string } }[] | undefined)?.[0];
  assert.equal(offer?.vendor?.name, '普拉波尔', 'trader names are translated the same way');
});

test('a language whose documents are missing loads in English', async () => {
  const { guns, mods } = await withStubbedJsonApi(world(), () => fetchAllDataFromJsonApi('ko', 'regular'));
  assert.equal(nameOf(guns, 'gun'), 'EN gun');
  assert.equal(nameOf(mods, 'a'), 'EN a');
});
