import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childInstanceId, makeBuild, projectBuild, projectionKey, installedMultiset, type ReferenceBuild } from './build';

const build: ReferenceBuild = {
  base: { kind: 'preset', presetId: 'p1' },
  placements: [
    { parentInstanceId: 'weapon_0', slotId: 's1', childInstanceId: 'weapon_0/s1:b', itemId: 'b' },
    { parentInstanceId: 'weapon_0', slotId: 's2', childInstanceId: 'weapon_0/s2:a', itemId: 'a' },
    { parentInstanceId: 'weapon_0/s1:b', slotId: 's3', childInstanceId: 'weapon_0/s1:b/s3:a', itemId: 'a' },
  ],
};

test('instance ids are path derived and distinct for distinct physical slots', () => {
  assert.equal(childInstanceId('weapon_0', 's1', 'b'), 'weapon_0/s1:b');
  assert.notEqual(childInstanceId('weapon_0', 's1', 'a'), childInstanceId('weapon_0', 's2', 'a'));
});

test('installed multiset keeps duplicates with counts, sorted by code unit', () => {
  assert.deepEqual(installedMultiset(build), [{ itemId: 'a', count: 2 }, { itemId: 'b', count: 1 }]);
});

test('projection is base plus multiset and ignores physical placement and instance ids', () => {
  const rearranged: ReferenceBuild = {
    base: { kind: 'preset', presetId: 'p1' },
    placements: [
      { parentInstanceId: 'weapon_0', slotId: 'x', childInstanceId: 'i1', itemId: 'a' },
      { parentInstanceId: 'weapon_0', slotId: 'y', childInstanceId: 'i2', itemId: 'a' },
      { parentInstanceId: 'weapon_0', slotId: 'z', childInstanceId: 'i3', itemId: 'b' },
    ],
  };
  assert.equal(projectionKey(projectBuild(build)), projectionKey(projectBuild(rearranged)));
});

test('projection key distinguishes base choice and copy counts', () => {
  const naked: ReferenceBuild = { ...build, base: { kind: 'naked' } };
  assert.notEqual(projectionKey(projectBuild(build)), projectionKey(projectBuild(naked)));
  const oneA: ReferenceBuild = { base: build.base, placements: build.placements.slice(0, 2) };
  assert.notEqual(projectionKey(projectBuild(build)), projectionKey(projectBuild(oneA)));
  // a preset literally named "naked" is not the naked base
  const tricky: ReferenceBuild = { base: { kind: 'preset', presetId: 'naked' }, placements: [] };
  assert.notEqual(projectionKey(projectBuild(tricky)), projectionKey(projectBuild({ base: { kind: 'naked' }, placements: [] })));
});

test('makeBuild derives child instance ids from edges', () => {
  const b = makeBuild({ kind: 'naked' }, ['weapon_0', 's', 'a'], ['weapon_0/s:a', 't', 'b']);
  assert.deepEqual(b.placements.map(p => p.childInstanceId), ['weapon_0/s:a', 'weapon_0/s:a/t:b']);
  assert.equal(b.placements[1].parentInstanceId, 'weapon_0/s:a');
});
