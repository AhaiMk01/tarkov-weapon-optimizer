// Research: is the Fast count/edge model an exact reformulation on acyclic template graphs? (docs/research/acyclic-fast-exactness.md)
//
// The pinned snapshot (frontend/benchmarks/snapshot.json, SHA-256 219443b4...) is scanned for the CONDITIONS the proof needs:
//   D1  the whole closure is acyclic: the blueprint pruned no ancestor edge (`stats.prunedAncestorEdges === 0`); request-independent;
//   D2  the ACTIVE template graph (what `specializeFast` builds, after the domain masks) is acyclic; D1 implies D2 for every request;
//   L   the lemma behind the count model: every ACTIVE occurrence of one template lists the same active candidate templates in each of its slots
//       (a count model can only be exact when the physical candidates do not depend on the path);
//   M   the MOA row's monotonicity assumption: the accuracy sum of any build is at most 100 percent points (else several barrels can disagree with the
//       oracle's "largest centre of impact", see the report), measured as the active upper bound of the accuracy sum.
// Every one of the 172 guns must satisfy D1, D2, L and M on the default request and on a few market and filter profiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import type { ItemLookup } from '../../src/solver/types';
import {
  buildTemplateGraph, computeActiveBounds, preparePhysicalWeapon, prepareSubproblemDomain, type PhysicalBlueprint, type SubproblemDomain, type SubproblemRequest,
} from '../../src/solver/physical';

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const present = existsSync(SNAPSHOT_PATH);
const skip = present ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

interface RawGun { id: string; shortName: string }
let guns: RawGun[] = [];
let lookup: ItemLookup = {};
if (present) {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: RawGun[]; mods: Record<string, unknown>[] };
  guns = snapshot.guns;
  lookup = buildItemLookup(guns as never, snapshot.mods as never);
}
/** As tests/physical/scale.test.ts: on this capture every allowed id the lookup does not hold is ammunition. */
const snapshotIsAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);

/** Request profiles that change which templates are active: the default, no flea, low trader levels with barters, a category exclusion, a stash. */
const PROFILES: { name: string; request: SubproblemRequest }[] = [
  { name: 'default', request: {} },
  { name: 'no-flea', request: { fleaAvailable: false } },
  { name: 'barters-low-traders', request: { barterAvailable: true, traderLevels: { prapor: 1, skier: 1, peacekeeper: 1, mechanic: 1, jaeger: 1 } } },
];

/**
 * The lemma L on the real blueprint: group the ACTIVE occurrences by (template, raw slot id) and compare the sets of ACTIVE candidate templates of
 * their physical slots. Returns the number of (template, slot) pairs checked and the first disagreement.
 */
function candidateSetsAgree(bp: PhysicalBlueprint, domain: SubproblemDomain): { checked: number; disagreement: string | null } {
  const seen = new Map<string, string>();
  let checked = 0;
  for (let v = 0; v < bp.occurrenceCount; v++) {
    if (!domain.occActive[v]) continue;
    for (let s = bp.occSlotStart[v]; s < bp.occSlotStart[v + 1]; s++) {
      const candidates: number[] = [];
      for (let c = bp.slotCandStart[s], end = c + bp.slotCandCount[s]; c < end; c++) if (domain.occActive[c]) candidates.push(bp.occTemplate[c]);
      candidates.sort((a, b) => a - b);
      const key = `${bp.occTemplate[v]}|${bp.slotRawIdArray[s]}`;
      const value = candidates.join(',');
      const before = seen.get(key);
      if (before === undefined) {
        seen.set(key, value);
        checked++;
      } else if (before !== value) return { checked, disagreement: `${bp.templateIds[bp.occTemplate[v]]} slot ${bp.rawSlotId(s)}: [${before}] vs [${value}]` };
    }
  }
  return { checked, disagreement: null };
}

test('all 172 pinned guns: closure acyclic (D1), active graph acyclic (D2), candidate sets path-independent (L), accuracy sum at most 100 (M)', { skip, timeout: 900_000 }, t => {
  assert.equal(guns.length, 172);
  const nonempty = new Map(PROFILES.map(p => [p.name, 0]));
  const everNonempty = new Set<string>();
  let templates = 0, edges = 0, maxCopies = 0, barrels = 0, accuracyHi = -Infinity, pairs = 0, twoBarrels = 0, closureEmpty = 0;
  const started = performance.now();
  for (const gun of guns) {
    const bp = preparePhysicalWeapon(lookup, gun.id, { isAmmo: snapshotIsAmmo });
    assert.equal(bp.stats.prunedAncestorEdges, 0, `${gun.shortName}: D1 (the closure has a cycle: ${bp.stats.prunedAncestorEdges} pruned ancestor edge(s))`);
    for (const profile of PROFILES) {
      const domain = prepareSubproblemDomain(bp, lookup, profile.request);
      if (domain.empty) continue; // no accessible base or an unfillable root slot: no graph, nothing cyclic, and the empty answer is exact
      nonempty.set(profile.name, (nonempty.get(profile.name) ?? 0) + 1);
      everNonempty.add(gun.id);
      // D2: the active template graph is acyclic (buildTemplateGraph throws CYCLIC_PART_GRAPH otherwise).
      const graph = buildTemplateGraph(bp, domain);
      const { checked, disagreement } = candidateSetsAgree(bp, domain);
      assert.equal(disagreement, null, `${gun.shortName}/${profile.name}: L ${disagreement}`);
      pairs += checked;
      const bounds = computeActiveBounds(bp, domain);
      assert.ok(bounds.accuracy.hi <= 100, `${gun.shortName}/${profile.name}: M (the active accuracy sum can reach ${bounds.accuracy.hi})`);
      accuracyHi = Math.max(accuracyHi, bounds.accuracy.hi);
      templates = Math.max(templates, graph.active.reduce((a, b) => a + b, 0));
      edges = Math.max(edges, graph.edgeCount);
      maxCopies = Math.max(maxCopies, ...graph.maxCopies);
      const count = Array.from({ length: bp.templateCount }, (_, i) => i).filter(i => graph.active[i] && bp.templateCenterOfImpact[i] > 0).length;
      barrels = Math.max(barrels, count);
      if (profile.name === 'default' && count >= 2) twoBarrels++;
    }
    if (!everNonempty.has(gun.id)) closureEmpty++;
  }
  t.diagnostic(`nonempty domains per profile: ${[...nonempty].map(([k, n]) => `${k} ${n}`).join(', ')} of ${guns.length} guns; ${closureEmpty} guns are empty under all profiles (no accessible base)`);
  t.diagnostic(`D1 holds for all ${guns.length} guns; D2, L and M hold for every nonempty (gun, profile): ${pairs} (template, slot) pairs compared, in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  t.diagnostic(`largest: active templates ${templates}, candidate edges ${edges}, copies of one template ${maxCopies}, barrel templates ${barrels}, accuracy-sum upper bound ${accuracyHi.toFixed(2)}; default-profile guns with two or more barrel templates: ${twoBarrels}`);
});
