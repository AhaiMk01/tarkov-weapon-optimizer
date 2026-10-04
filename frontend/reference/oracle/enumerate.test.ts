import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceFixture, ReferenceRequest } from './domain';
import { enumerateBuilds, enumerateTrees } from './enumerate';
import { installedMultiset } from './build';

const trader = (price = 100) => [{ kind: 'trader' as const, trader: 'prapor', level: 1, price }];
const shape = (tree: { slotId: string; itemId: string; parentInstanceId: string }[]) =>
  tree.map(p => `${p.parentInstanceId.split('/').pop()}>${p.slotId}=${p.itemId}`).sort().join(' ');

function fixtureOf(parts: Partial<ReferenceFixture> & Pick<ReferenceFixture, 'items' | 'weapons'>): ReferenceFixture {
  return { schemaVersion: 1, ...parts };
}

test('an optional slot offers "empty" plus every allowed item; a required slot has no empty option', () => {
  const optional = fixtureOf({
    items: [{ id: 'a' }, { id: 'b' }],
    weapons: [{ id: 'gun', slots: [{ id: 's', allowedItemIds: ['a', 'b'] }] }],
  });
  assert.deepEqual(enumerateTrees(optional, 'gun').trees.map(shape), ['', 'weapon_0>s=a', 'weapon_0>s=b']);
  const required = fixtureOf({
    items: [{ id: 'a' }, { id: 'b' }],
    weapons: [{ id: 'gun', slots: [{ id: 's', required: true, allowedItemIds: ['a', 'b'] }] }],
  });
  assert.deepEqual(enumerateTrees(required, 'gun').trees.map(shape), ['weapon_0>s=a', 'weapon_0>s=b']);
});

test('tree counts multiply across slots and add across nested options', () => {
  const f = fixtureOf({
    items: [{ id: 'a', slots: [{ id: 't', allowedItemIds: ['c'] }] }, { id: 'b' }, { id: 'c' }],
    weapons: [{ id: 'gun', slots: [{ id: 's1', allowedItemIds: ['a', 'b'] }, { id: 's2', allowedItemIds: ['b'] }] }],
  });
  // s1: empty | a(+empty|c) | b = 1 + 2 + 1 = 4 options, s2: empty | b = 2 options
  assert.equal(enumerateTrees(f, 'gun').trees.length, 8);
});

test('multi-copy: siblings may repeat a template and get distinct path-derived instance ids', () => {
  const f = fixtureOf({
    items: [{ id: 'a' }],
    weapons: [{ id: 'gun', slots: [{ id: 's1', allowedItemIds: ['a'] }, { id: 's2', allowedItemIds: ['a'] }] }],
  });
  const trees = enumerateTrees(f, 'gun').trees;
  assert.equal(trees.length, 4);
  const both = trees.find(t => t.length === 2)!;
  assert.deepEqual(installedMultiset({ base: { kind: 'naked' }, placements: both }), [{ itemId: 'a', count: 2 }]);
  assert.equal(new Set(both.map(p => p.childInstanceId)).size, 2);
});

test('cousins may repeat a template, ancestors may not', () => {
  const f = fixtureOf({
    items: [
      { id: 'a', slots: [{ id: 'sa', allowedItemIds: ['a', 'b'] }] },
      { id: 'b', slots: [{ id: 'sb', allowedItemIds: ['a', 'b'] }] },
    ],
    weapons: [{ id: 'gun', slots: [{ id: 'r1', allowedItemIds: ['a'] }, { id: 'r2', allowedItemIds: ['a'] }] }],
  });
  const trees = enumerateTrees(f, 'gun').trees;
  for (const tree of trees) {
    const byChild = new Map(tree.map(p => [p.childInstanceId, p]));
    for (const p of tree) {
      for (let cur = byChild.get(p.parentInstanceId); cur; cur = byChild.get(cur.parentInstanceId)) {
        assert.notEqual(cur.itemId, p.itemId, `ancestor repetition ${p.childInstanceId}`);
      }
    }
  }
  // a -> b is allowed (b under a), but a -> a, a -> b -> a, a -> b -> b are pruned
  assert.ok(trees.some(t => t.some(p => p.itemId === 'b')));
  assert.ok(!trees.some(t => t.some(p => p.itemId === 'a' && p.parentInstanceId !== 'weapon_0' && p.parentInstanceId.endsWith(':a'))));
  // cousins: a under r1 and a under r2 in the same tree
  assert.ok(trees.some(t => t.filter(p => p.itemId === 'a' && p.parentInstanceId === 'weapon_0').length === 2));
});

test('a required mod slot with no satisfiable candidate removes its owner but keeps alternatives', () => {
  const f = fixtureOf({
    items: [
      { id: 'owner', slots: [{ id: 'need', required: true, allowedItemIds: [] }] },
      { id: 'alt' },
    ],
    weapons: [{ id: 'gun', slots: [{ id: 's', allowedItemIds: ['owner', 'alt'] }] }],
  });
  assert.deepEqual(enumerateTrees(f, 'gun').trees.map(shape), ['', 'weapon_0>s=alt']);
});

test('excluded items cannot be installed, so a required slot that needs them forces its owner off', () => {
  const f = fixtureOf({
    items: [
      { id: 'owner', slots: [{ id: 'need', required: true, allowedItemIds: ['banned'] }] },
      { id: 'banned', categories: ['cat-x'] },
      { id: 'alt' },
    ],
    weapons: [{ id: 'gun', offers: trader(), slots: [{ id: 's', allowedItemIds: ['owner', 'alt'] }] }],
  });
  const req: ReferenceRequest = { weapon_id: 'gun', exclude_categories: ['cat-x'] };
  const { builds } = enumerateBuilds(f, req);
  assert.deepEqual(builds.map(b => shape(b.placements)), ['', 'weapon_0>s=alt']);
});

test('a duplicated allowed id does not duplicate trees', () => {
  const f = fixtureOf({
    items: [{ id: 'a' }],
    weapons: [{ id: 'gun', slots: [{ id: 's', allowedItemIds: ['a', 'a'] }] }],
  });
  assert.equal(enumerateTrees(f, 'gun').trees.length, 2);
});

test('enumeration is deterministic and trees are pairwise distinct', () => {
  const f = fixtureOf({
    items: [{ id: 'a', slots: [{ id: 't', allowedItemIds: ['b'] }] }, { id: 'b' }],
    weapons: [{ id: 'gun', slots: [{ id: 's1', allowedItemIds: ['a', 'b'] }, { id: 's2', allowedItemIds: ['a', 'b'] }] }],
  });
  const first = enumerateTrees(f, 'gun').trees;
  assert.deepEqual(enumerateTrees(f, 'gun').trees, first);
  assert.equal(new Set(first.map(t => JSON.stringify(t))).size, first.length);
  for (const tree of first) assert.equal(new Set(tree.map(p => p.childInstanceId)).size, tree.length);
});

test('hitting the node cap reports complete: false and returns only a prefix', () => {
  const f = fixtureOf({
    items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    weapons: [{ id: 'gun', slots: [{ id: 's1', allowedItemIds: ['a', 'b', 'c'] }, { id: 's2', allowedItemIds: ['a', 'b', 'c'] }] }],
  });
  const full = enumerateTrees(f, 'gun');
  assert.equal(full.complete, true);
  assert.equal(full.trees.length, 16);
  const capped = enumerateTrees(f, 'gun', { maxNodes: 3 });
  assert.equal(capped.complete, false);
  assert.ok(capped.trees.length < full.trees.length);
  const limited = enumerateTrees(f, 'gun', { maxTrees: 5 });
  assert.equal(limited.complete, false);
  assert.equal(limited.trees.length, 5);
});

test('builds pair every tree with every accessible base; inaccessible bases yield nothing and the result is still complete', () => {
  const f = fixtureOf({
    items: [{ id: 'a', offers: trader() }],
    weapons: [{ id: 'gun', offers: trader(5000), slots: [{ id: 's', allowedItemIds: ['a'] }] }],
    presets: [{ id: 'pre', weaponId: 'gun', components: [{ itemId: 'a', count: 1 }], offers: trader(9000) }],
  });
  const both = enumerateBuilds(f, { weapon_id: 'gun' });
  assert.equal(both.builds.length, 4);
  assert.deepEqual([...new Set(both.builds.map(b => b.base.kind))], ['naked', 'preset']);
  assert.equal(both.complete, true);
  const none = enumerateBuilds(f, { weapon_id: 'gun', trader_levels: { prapor: 0 }, owned_items: ['gun', 'a', 'pre'] });
  assert.deepEqual(none.builds, []);
  assert.equal(none.complete, true);
});

test('the build cap marks the enumeration incomplete', () => {
  const f = fixtureOf({
    items: [{ id: 'a' }, { id: 'b' }],
    weapons: [{ id: 'gun', offers: trader(), slots: [{ id: 's', allowedItemIds: ['a', 'b'] }] }],
  });
  const capped = enumerateBuilds(f, { weapon_id: 'gun' }, { maxBuilds: 2 });
  assert.equal(capped.builds.length, 2);
  assert.equal(capped.complete, false);
});
