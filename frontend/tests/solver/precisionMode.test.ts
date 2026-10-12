// Auto precision (src/solver/precisionMode.ts, owner decision 2026-10-12): Precise for every plain request; for a TrueErgo or Prevent
// Overswing request, Precise up to AUTO_PRECISE_MAX_TED_EDGES candidate slot edges (read from the compatibility map) and Fast above.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { buildItemLookup } from '../../src/solver/dataService';
import { AUTO_PRECISE_MAX_TED_EDGES, countCandidateEdges, normalizePrecisionRequest, resolvePreciseFlag } from '../../src/solver/precisionMode';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

test('an explicit request is never overridden; a boolean or missing request normalizes as before', () => {
  const empty = buildCompatibilityMap(WEAPON, lookupOf(gun(WEAPON)));
  for (const ted of [false, true]) {
    assert.equal(resolvePreciseFlag('precise', empty, ted), true);
    assert.equal(resolvePreciseFlag('fast', empty, ted), false);
  }
  assert.equal(normalizePrecisionRequest(true), 'precise');
  assert.equal(normalizePrecisionRequest(false), 'fast');
  assert.equal(normalizePrecisionRequest(undefined), 'fast');
  assert.equal(normalizePrecisionRequest('auto'), 'auto');
});

test('candidate edges: one per distinct reachable candidate of every slot of the weapon or a reachable mod', () => {
  // receiver: s1 -> [a, b, a], s2 -> [a, ghost]; a: r -> [c]; b: r2 -> [c, a]; c: none. ghost is not in the lookup.
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a', 'b', 'a']), slot('s2', ['a', 'ghost'])] }),
    ['a', mod('a', { slots: [slot('r', ['c'])] })],
    ['b', mod('b', { slots: [slot('r2', ['c', 'a'])] })],
    ['c', mod('c')],
  );
  // s1: a, b | s2: a | r: c | r2: c, a
  assert.equal(countCandidateEdges(buildCompatibilityMap(WEAPON, lookup)), 6);
});

test('auto: Precise for every plain request, Precise for a TED request only up to the edge threshold', () => {
  const small = buildCompatibilityMap(WEAPON, lookupOf(gun(WEAPON, { slots: [slot('s', ['a'])] }), ['a', mod('a')]));
  assert.equal(resolvePreciseFlag('auto', small, false), true);
  assert.equal(resolvePreciseFlag('auto', small, true), true);
  const ids = Array.from({ length: AUTO_PRECISE_MAX_TED_EDGES + 1 }, (_, k) => `m${k}`);
  const large = buildCompatibilityMap(WEAPON, lookupOf(gun(WEAPON, { slots: [slot('s', ids)] }), ...ids.map(id => [id, mod(id)] as [string, ReturnType<typeof mod>])));
  assert.equal(countCandidateEdges(large), AUTO_PRECISE_MAX_TED_EDGES + 1);
  assert.equal(resolvePreciseFlag('auto', large, false), true);
  assert.equal(resolvePreciseFlag('auto', large, true), false);
  assert.equal(AUTO_PRECISE_MAX_TED_EDGES, 3_000);
});

// ---- the pinned capture ------------------------------------------------------------------------------------------------------------

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

test('on the pinned capture auto is Precise for every plain request, and Fast for a TED request only on the AK and M4/AR-15 families', { skip, timeout: 120_000 }, () => {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: { id: string; shortName: string }[]; mods: Record<string, unknown>[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const cmapOf = (shortName: string) => {
    const entry = snapshot.guns.find(g => g.shortName === shortName);
    assert.ok(entry, shortName);
    return buildCompatibilityMap(entry.id, lookup);
  };
  for (const name of ['M45A1', 'P226R', 'M870', 'MP5', 'PP-19-01', 'SR-25', 'HK 416A5', 'Saiga-12K', 'AK-74N', 'NL545 DI', 'M4A1']) {
    assert.equal(resolvePreciseFlag('auto', cmapOf(name), false), true, `${name}: plain`);
  }
  for (const name of ['M45A1', 'P226R', 'M870', 'MP5', 'PP-19-01', 'SR-25', 'HK 416A5', 'Saiga-12K']) {
    const edges = countCandidateEdges(cmapOf(name));
    assert.ok(edges <= 2_600, `${name}: ${edges} edges`);
    assert.equal(resolvePreciseFlag('auto', cmapOf(name), true), true, `${name}: TED`);
  }
  for (const name of ['AKMS', 'AK-74N', 'AKM', 'NL545 DI', 'M16A2', 'M4A1']) {
    const edges = countCandidateEdges(cmapOf(name));
    assert.ok(edges >= 3_400, `${name}: ${edges} edges`);
    assert.equal(resolvePreciseFlag('auto', cmapOf(name), true), false, `${name}: TED`);
  }
  // No pinned gun lies near the threshold (measured: 2,513 below it, 3,476 above it).
  for (const entry of snapshot.guns) {
    const edges = countCandidateEdges(buildCompatibilityMap(entry.id, lookup));
    assert.ok(edges <= 2_600 || edges >= 3_400, `${entry.shortName}: ${edges} edges`);
  }
});
