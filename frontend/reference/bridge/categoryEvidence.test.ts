// Observation only (INTERPRETATIONS.md choice 5, owner decision 2026-10-04): the evidence for keeping category matching over the whole
// category chain while production matches only an item's own category. Nothing here pins oracle behaviour; it records how little the
// two readings differ on the pinned capture and on the Gunsmith task catalogue, so Stage 2 knows the cost of adopting the chain rule.
//
// frontend/public/tasks.json is read as DATA (the Gunsmith task catalogue); no production code is imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { fixtureForWeapon } from './toFixture';

const { world } = loadPinnedWorld('en');
const mods = [...world.items.values()].filter(i => i.types.includes('mods'));
const ownCategory = (id: string): string => (world.items.get(id)?.categoryIds ?? [])[0];
const nameOf = (id: string): string | undefined => world.categories.get(id)?.normalizedName ?? undefined;

interface TaskRecord {
  task_name: string;
  weapon_id: string;
  required_category_group_ids?: string[][];
}
const tasks = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../public/tasks.json'), 'utf8')) as TaskRecord[];
const groups = tasks.flatMap(t => (t.required_category_group_ids ?? []).map(group => ({ task: t, group })));

test('only 3 mod categories are both some mod\'s own category and an ancestor of another mod\'s own category', () => {
  const own = new Set(mods.map(m => m.categoryIds[0]).filter(c => c !== undefined));
  const ancestors = new Set(mods.flatMap(m => m.categoryIds.slice(1)));
  const both = [...own].filter(c => ancestors.has(c)).map(nameOf).sort();
  assert.deepEqual(both, ['cylinder-magazine', 'magazine', 'special-scope']);
});

test('all 19 Gunsmith task category groups name categories that are some mod\'s own category', () => {
  assert.equal(groups.length, 19);
  const own = new Set(mods.map(m => m.categoryIds[0]));
  for (const { task, group } of groups) for (const category of group) assert.ok(own.has(category), `${task.task_name}: ${category} (${nameOf(category)}) is no mod's own category`);
});

test('on every task group the own-category rule and the chain rule select the same items of the task weapon closure', () => {
  // One group names `magazine`, the only group category that is also an ancestor (of the 5 cylinder magazines); no Gunsmith weapon reaches a
  // cylinder, so the two rules still coincide there. Over the whole catalogue they differ: `magazine` has 219 own and 224 chain members.
  let compared = 0;
  for (const { task, group } of groups) {
    const { fixture } = fixtureForWeapon(world, task.weapon_id);
    const leaf = fixture.items.filter(i => group.includes(ownCategory(i.id))).map(i => i.id);
    const chain = fixture.items.filter(i => (i.categories ?? []).some(c => group.includes(c))).map(i => i.id);
    assert.deepEqual(chain, leaf, `${task.task_name}: ${group.map(nameOf).join('|')}`);
    compared++;
  }
  assert.equal(compared, 19);
  const magazine = [...world.categories.values()].find(c => c.normalizedName === 'magazine');
  assert.ok(magazine);
  assert.equal(mods.filter(m => m.categoryIds[0] === magazine.id).length, 219);
  assert.equal(mods.filter(m => m.categoryIds.includes(magazine.id)).length, 224);
});
