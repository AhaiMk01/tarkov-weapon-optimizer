// Category chains on the GraphQL fallback path (INTERPRETATIONS.md choice 5, ADR 0013 section 4A).
//
// Category filters match the whole chain (own category or any ancestor). The JSON adapter hands every item its complete nested
// `bsgCategory` chain with ids. The GraphQL fallback used to ask `parent { name parent { name } }` for mods (no ids, two levels) and
// nothing at all for guns, so its chain degraded to the item's own category. The queries now select `id` on every level down to
// CATEGORY_CHAIN_LEVELS and one extra sentinel level, and a response that reaches the sentinel is rejected as truncated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemLookup, CATEGORY_CHAIN_LEVELS, fetchAllDataFromGraphQL, GUNS_QUERY, MODS_QUERY,
} from '../../src/solver/dataService';
import { fetchAllDataFromJsonApi } from '../../src/solver/jsonApiAdapter';
import { SourceDataError } from '../../src/solver/sourceErrors';
import { preparePhysicalWeapon } from '../../src/solver/physical';
import { loadPinnedWorld } from '../../reference/source/pinnedWorld';
import { categoryChain } from '../../reference/source/sourceChecks';
import { PinError } from '../../reference/source/pins';
import { docsOf, rawItem, rawSlots, traderOffer, withStubbedJsonApi } from './syntheticWorld';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw GraphQL-shaped documents

// ---------------------------------------------------------------------------------------------
// A tiny GraphQL selection-set parser, enough to read the structure of the query text
// ---------------------------------------------------------------------------------------------

interface Selection { [field: string]: Selection }

function parseSelection(text: string): Selection {
  // Argument lists and variable definitions are skipped; inline fragments `... on Type` become a field named after the type.
  const tokens = text.match(/\.\.\.\s*on\s+\w+|\w+|[{}]|\([^)]*\)/g) ?? [];
  let position = 0;
  const parseBlock = (): Selection => {
    const out: Selection = {};
    let last: string | null = null;
    while (position < tokens.length) {
      const token = tokens[position++];
      if (token === '}') return out;
      if (token === '{') {
        if (last === null) throw new Error('selection block with no field');
        out[last] = { ...out[last], ...parseBlock() };
        continue;
      }
      if (token.startsWith('(')) continue;
      last = token.replace(/^\.\.\.\s*on\s+/, '@');
      out[last] ??= {};
    }
    return out;
  };
  return parseBlock();
}

/** Every selection set found under a field name, anywhere in the tree. */
function allUnder(selection: Selection, field: string): Selection[] {
  const found: Selection[] = [];
  const walk = (node: Selection) => {
    for (const [name, child] of Object.entries(node)) {
      if (name === field) found.push(child);
      walk(child);
    }
  };
  walk(selection);
  return found;
}

const queries: [string, string][] = [['guns', GUNS_QUERY], ['mods', MODS_QUERY]];

// ---------------------------------------------------------------------------------------------
// The query text
// ---------------------------------------------------------------------------------------------

test('the pinned capture needs at most 7 category levels; the fallback queries reach well past that, plus a sentinel', t => {
  assert.ok(CATEGORY_CHAIN_LEVELS >= 8, `${CATEGORY_CHAIN_LEVELS} levels`);
  try {
    const { world } = loadPinnedWorld('en');
    let deepest = 0;
    for (const item of world.items.values()) {
      if (item.categoryIds.length === 0) continue;
      deepest = Math.max(deepest, categoryChain(world, item.categoryIds[0]).length);
    }
    assert.equal(deepest, 7, 'the deepest pinned chain');
    assert.ok(deepest < CATEGORY_CHAIN_LEVELS, 'the sentinel level is never reached by the pinned data');
  } catch (e) {
    if (e instanceof PinError) { t.skip(`pinned documents are not restored: ${e.message}`); return; }
    throw e;
  }
});

for (const [name, query] of queries) {
  test(`${name} query: bsgCategory selects the id of the item's category and of every ancestor level, then a sentinel`, () => {
    const selection = parseSelection(query);
    const blocks = allUnder(selection, 'bsgCategory');
    assert.equal(blocks.length, 1, 'one bsgCategory selection per item');
    let node: Selection | undefined = blocks[0];
    let levels = 0;
    const fullLevels: Selection[] = [];
    while (node) {
      levels++;
      assert.ok('id' in node, `level ${levels} selects id`);
      if (node.parent === undefined) break;
      fullLevels.push(node);
      node = node.parent;
    }
    // CATEGORY_CHAIN_LEVELS full levels, then one level that selects only `id` (the sentinel).
    assert.equal(levels, CATEGORY_CHAIN_LEVELS + 1, 'full levels plus the sentinel');
    assert.deepEqual(Object.keys(node), ['id'], 'the sentinel selects only id');
    for (const level of fullLevels) {
      assert.ok('name' in level && 'normalizedName' in level, 'every full level selects name and normalizedName');
    }
  });

  test(`${name} query: carries the raw item types, the types of every allowed item, and barter lot sizes`, () => {
    const selection = parseSelection(query);
    assert.ok('types' in allUnder(selection, 'items')[0], 'items select types');
    const allowed = allUnder(selection, 'allowedItems');
    assert.ok(allowed.length >= 1);
    for (const block of allowed) assert.ok('id' in block && 'types' in block, 'allowedItems { id types }');
    const rewards = allUnder(selection, 'rewardItems');
    assert.ok(rewards.length >= 1);
    for (const block of rewards) assert.ok('count' in block && 'id' in (block.item ?? {}), 'rewardItems { item { id } count }');
  });
}

test('the gun query asks for the barter lot size of the gun and of its presets (two bartersFor blocks), the mod query for the mod\'s', () => {
  assert.equal(allUnder(parseSelection(GUNS_QUERY), 'rewardItems').length, 2);
  assert.equal(allUnder(parseSelection(MODS_QUERY), 'rewardItems').length, 1);
});

// ---------------------------------------------------------------------------------------------
// The fallback end to end (stubbed GraphQL endpoint answering with a GraphQL-shaped payload)
// ---------------------------------------------------------------------------------------------

const CHAIN = ['leaf', 'branch', 'trunk', 'root'];

const chainWorld = () =>
  docsOf({
    categories: [
      { id: 'root', parent: null }, { id: 'trunk', parent: 'root' }, { id: 'branch', parent: 'trunk' }, { id: 'leaf', parent: 'branch' },
      { id: 'gunLeaf', parent: 'root' },
    ],
    items: [
      rawItem('gun', { types: ['gun'], categories: ['gunLeaf', 'root'], buyFromTrader: [traderOffer(5000)], properties: { slots: rawSlots([{ id: 's', allowed: ['m'] }]), presets: [] } }),
      rawItem('m', { types: ['mods'], categories: CHAIN, buyFromTrader: [traderOffer(100)] }),
    ],
  });

async function withGraphQl<T>(payload: { guns: unknown[]; mods: unknown[] }, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== 'https://api.tarkov.dev/graphql') throw new Error(`stub refuses ${url}`);
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    const items = query.includes('AllGuns') ? payload.guns : payload.mods;
    return new Response(JSON.stringify({ data: { items } }), { status: 200 });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('through the GraphQL fallback, a mod and a gun carry their full category chain with ids, as on the JSON path', async () => {
  const json = await withStubbedJsonApi(chainWorld(), () => fetchAllDataFromJsonApi('en', 'regular'));
  const viaJson = buildItemLookup(json.guns, json.mods);
  const fallback = await withGraphQl(json, () => fetchAllDataFromGraphQL('en', 'regular'));
  const viaGraphQl = buildItemLookup(fallback.guns, fallback.mods);
  for (const lookup of [viaJson, viaGraphQl]) {
    const bp = preparePhysicalWeapon(lookup, 'gun');
    assert.deepEqual(bp.templateCategoryChain[bp.templateIndexOf('m')], CHAIN, 'chain matching sees every ancestor id');
    assert.deepEqual(bp.templateCategoryChain[0], ['gunLeaf', 'root'], 'the gun has a chain too');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(viaGraphQl)), JSON.parse(JSON.stringify(viaJson)), 'both paths build the same lookup');
});

test('a response whose category chain reaches the sentinel level is rejected as truncated, never silently cut', async () => {
  const chainOf = (length: number): Loose => {
    let node: Loose | null = null;
    for (let i = length; i >= 1; i--) node = { id: `c${i}`, name: `C${i}`, normalizedName: `c${i}`, children: [], parent: node };
    return node as Loose;
  };
  const item = (id: string, depth: number, extra: Loose = {}): Loose => ({ id, name: id, bsgCategory: chainOf(depth), ...extra });
  const ok = { guns: [item('g', CATEGORY_CHAIN_LEVELS)], mods: [item('m', CATEGORY_CHAIN_LEVELS)] };
  const fetched = await withGraphQl(ok, () => fetchAllDataFromGraphQL('en', 'regular'));
  assert.equal(fetched.mods.length, 1, 'exactly CATEGORY_CHAIN_LEVELS levels is a complete chain');

  for (const bad of [{ guns: ok.guns, mods: [item('m', CATEGORY_CHAIN_LEVELS + 1)] }, { guns: [item('g', CATEGORY_CHAIN_LEVELS + 1)], mods: ok.mods }]) {
    await assert.rejects(
      () => withGraphQl(bad, () => fetchAllDataFromGraphQL('en', 'regular')),
      (e: unknown) => e instanceof SourceDataError && e.kind === 'category_chain_truncated' && /category/i.test(e.message),
    );
  }
});
