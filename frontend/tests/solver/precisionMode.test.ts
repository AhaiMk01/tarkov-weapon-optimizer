// Auto precision (src/solver/precisionMode.ts): Precise for a small exact model, Fast for a large one, decided by the occurrence count of the
// exact model, estimated from the compatibility map alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { buildItemLookup } from '../../src/solver/dataService';
import { preparePhysicalWeapon } from '../../src/solver/physical';
import { AUTO_PRECISE_MAX_OCCURRENCES, estimateOccurrences, normalizePrecisionRequest, resolvePreciseFlag } from '../../src/solver/precisionMode';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

test('an explicit request is never overridden; a boolean or missing request normalizes as before', () => {
  const empty = buildCompatibilityMap(WEAPON, lookupOf(gun(WEAPON)));
  assert.equal(resolvePreciseFlag('precise', empty), true);
  assert.equal(resolvePreciseFlag('fast', empty), false);
  assert.equal(normalizePrecisionRequest(true), 'precise');
  assert.equal(normalizePrecisionRequest(false), 'fast');
  assert.equal(normalizePrecisionRequest(undefined), 'fast');
  assert.equal(normalizePrecisionRequest('auto'), 'auto');
});

test('the estimate counts one occurrence per template per slot it can occupy, with the no-repetition-on-a-path rule', () => {
  // receiver: s1 -> [a, b], s2 -> [a]; a: r -> [c]; b: r2 -> [c, a]; c: loop -> [a, d] (a is an ancestor on the paths through a).
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'b']), slot('s2', ['a'])] }),
    ['a', mod('a', { slots: [slot('r', ['c'])] })],
    ['b', mod('b', { slots: [slot('r2', ['c', 'a'])] })],
    ['c', mod('c', { slots: [slot('loop', ['a', 'd'])] })],
    ['d', mod('d')],
  );
  const cmap = buildCompatibilityMap(WEAPON, lookup);
  const exact = preparePhysicalWeapon(lookup, WEAPON).stats.itemOccurrences;
  assert.equal(estimateOccurrences(cmap, 1e9), exact);
  // s1:a, a>c, a>c>d | s1:b, b>c, b>c>a, b>c>d, b>a, b>a>c, b>a>c>d | s2:a, a>c, a>c>d: 13 (c never lists its own ancestor a again)
  assert.equal(exact, 13);
});

test('the estimate stops counting past the limit, so a huge weapon costs no more than the threshold to classify', () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'b', 'c', 'd']), slot('s2', ['a', 'b', 'c', 'd'])] }),
    ['a', mod('a')], ['b', mod('b')], ['c', mod('c')], ['d', mod('d')],
  );
  const cmap = buildCompatibilityMap(WEAPON, lookup);
  assert.equal(estimateOccurrences(cmap, 1e9), 8);
  assert.equal(estimateOccurrences(cmap, 5), 6, 'limit + 1');
  assert.equal(AUTO_PRECISE_MAX_OCCURRENCES, 15_000);
});

// ---- the pinned capture ------------------------------------------------------------------------------------------------------------

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

test('on the pinned capture auto is Precise for the guns measured to solve to a proof quickly and Fast for the AK and M4A1 families', { skip, timeout: 120_000 }, () => {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: Record<string, unknown>[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);
  const auto = (shortName: string): { precise: boolean; estimated: number; exact: number } => {
    const entry = snapshot.guns.find(g => g.shortName === shortName);
    assert.ok(entry, shortName);
    const cmap = buildCompatibilityMap(entry.id, lookup);
    return {
      precise: resolvePreciseFlag('auto', cmap),
      estimated: estimateOccurrences(cmap, 1e9),
      exact: preparePhysicalWeapon(lookup, entry.id, { isAmmo }).stats.itemOccurrences,
    };
  };
  for (const name of ['M45A1', 'P226R', 'M870', 'MP5', 'PP-19-01', 'SR-25', 'HK 416A5', 'NL545 DI']) {
    const r = auto(name);
    assert.equal(r.precise, true, `${name}: ${r.exact} occurrences`);
    assert.ok(r.exact <= AUTO_PRECISE_MAX_OCCURRENCES);
  }
  for (const name of ['AK-74', 'AK-74N', 'AKM', 'M4A1']) {
    const r = auto(name);
    assert.equal(r.precise, false, `${name}: ${r.exact} occurrences`);
    assert.ok(r.exact > AUTO_PRECISE_MAX_OCCURRENCES);
  }
  // The estimate follows the blueprint closely wherever the two differ at all (the gap between the two classes is far wider).
  for (const name of ['M870', 'MPX', 'SR-25', 'HK 416A5', 'AK-74']) {
    const r = auto(name);
    assert.ok(Math.abs(r.estimated - r.exact) <= 0.25 * r.exact, `${name}: estimated ${r.estimated}, blueprint ${r.exact}`);
  }
});
