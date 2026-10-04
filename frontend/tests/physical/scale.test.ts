// Scale and parity of the physical blueprint on the pinned capture (ADR 0013 section 1: frontend/benchmarks/snapshot.json,
// SHA-256 219443b4..., restored from the hashed artifact when missing, never regenerated).
//
// The measured universe sizes below are the pinned-capture facts: the snapshot-versus-raw difference is zero for every
// figure asserted here (the counts equal the independent measurement exactly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { computeStructuralBounds } from '../../src/solver/structuralBounds';
import type { ItemLookup } from '../../src/solver/types';
import {
  InactiveReason, preparePhysicalWeapon, prepareSubproblemDomain, type PhysicalBlueprint,
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
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha, SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: RawGun[]; mods: Record<string, unknown>[] };
  guns = snapshot.guns;
  lookup = buildItemLookup(guns as never, snapshot.mods as never);
}

const gunId = (shortName: string): string => {
  const gun = guns.find(g => g.shortName === shortName);
  assert.ok(gun, `${shortName} is in the snapshot`);
  return gun.id;
};

/** Bytes held by the typed arrays of a blueprint (the memory that scales with the occurrence universe). */
function typedArrayBytes(bp: PhysicalBlueprint): number {
  let bytes = 0;
  for (const value of Object.values(bp)) if (ArrayBuffer.isView(value)) bytes += value.byteLength;
  return bytes;
}

const checksum = (bp: PhysicalBlueprint): number => {
  let h = 0;
  for (const array of [bp.occTemplate, bp.occParentSlot, bp.occSlotStart, bp.slotCandStart, bp.slotCandCount, bp.structurallyViable]) {
    for (let i = 0; i < array.length; i++) h = (Math.imul(h, 31) + array[i]) | 0;
  }
  return h;
};

test('M4A1 and AK-74N unroll to the measured occurrence universes, quickly and compactly', { skip }, t => {
  const m4 = gunId('M4A1');
  const started = performance.now();
  const bp = preparePhysicalWeapon(lookup, m4);
  const m4Ms = performance.now() - started;
  assert.equal(bp.occurrenceCount - 1, 151_479, 'M4A1 item occurrences');

  const akId = gunId('AK-74N');
  const akStarted = performance.now();
  const ak = preparePhysicalWeapon(lookup, akId);
  const akMs = performance.now() - akStarted;
  assert.equal(ak.occurrenceCount - 1, 41_153, 'AK-74N item occurrences');

  assert.ok(m4Ms < 3000, `M4A1 preparation took ${m4Ms.toFixed(0)} ms`);
  const mib = typedArrayBytes(bp) / 1024 / 1024;
  assert.ok(mib < 32, `M4A1 blueprint holds ${mib.toFixed(1)} MiB of typed arrays`);
  t.diagnostic(`M4A1: ${bp.occurrenceCount - 1} occurrences, ${bp.slotCount} slots, ${bp.templateCount} templates, ${m4Ms.toFixed(1)} ms, ${mib.toFixed(2)} MiB typed arrays (${(typedArrayBytes(bp) / (bp.occurrenceCount - 1)).toFixed(0)} B/occurrence)`);
  t.diagnostic(`AK-74N: ${ak.occurrenceCount - 1} occurrences, ${ak.slotCount} slots, ${akMs.toFixed(1)} ms, ${(typedArrayBytes(ak) / 1024 / 1024).toFixed(2)} MiB typed arrays`);
});

test('all 172 guns prepare; the occurrence distribution matches the pinned measurement', { skip }, t => {
  assert.equal(guns.length, 172);
  const counts: number[] = [];
  const started = performance.now();
  let largest = { shortName: '', occurrences: 0, ms: 0 };
  for (const gun of guns) {
    const gunStarted = performance.now();
    const bp = preparePhysicalWeapon(lookup, gun.id);
    const ms = performance.now() - gunStarted;
    const occurrences = bp.occurrenceCount - 1;
    counts.push(occurrences);
    if (occurrences > largest.occurrences) largest = { shortName: gun.shortName, occurrences, ms };
  }
  const totalMs = performance.now() - started;
  const sorted = [...counts].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.floor(p * sorted.length)];
  assert.equal(at(0.5), 2_113, 'median');
  assert.equal(at(0.75), 8_084, 'p75');
  assert.equal(at(0.9), 35_569, 'p90');
  assert.equal(sorted[sorted.length - 1], 151_479, 'the largest gun is the M4A1');
  assert.equal(largest.shortName, 'M4A1');
  assert.ok(sorted[sorted.length - 1] <= 1_000_000);
  assert.equal(sorted.filter(n => n === 0).length, 9, 'nine slotless launchers have an empty universe');
  assert.equal(sorted.filter(n => n > 0)[0], 1);
  t.diagnostic(`172 guns in ${totalMs.toFixed(0)} ms; sum ${counts.reduce((a, b) => a + b, 0)} occurrences; largest ${largest.shortName} ${largest.occurrences} (${largest.ms.toFixed(1)} ms)`);
});

test('camora ammunition slots are removed, not emptied: 5 guns, 28 slot records, 39 ammunition templates', { skip }, () => {
  const slotRecords = new Set<string>();
  const ammoIds = new Set<string>();
  const gunsWithAmmo: string[] = [];
  for (const gun of guns) {
    const bp = preparePhysicalWeapon(lookup, gun.id);
    if (bp.removedAmmoSlots.length > 0) gunsWithAmmo.push(gun.shortName);
    for (const record of bp.removedAmmoSlots) slotRecords.add(`${record.ownerTemplateId}/${record.slotId}`);
    for (const id of bp.removedAmmoItemIds) ammoIds.add(id);
    assert.equal(bp.droppedAllowedItems.length, 0, `${gun.shortName}: no unknown non-ammunition id is dropped`);
    assert.equal(bp.structurallyViable[0], 1, `${gun.shortName} stays buildable`);
  }
  assert.deepEqual(gunsWithAmmo.sort(), ['CR 200DS', 'CR 50DS', 'MSGL', 'MTs-255-12', 'RSh-12']);
  assert.equal(slotRecords.size, 28);
  assert.equal(ammoIds.size, 39);
});

test('direct raw bounds equal the legacy weight bounds and ergonomics minimum, and are never looser at the ergonomics maximum', { skip }, () => {
  // The legacy DP caps a required slot's best candidate at zero (it adds only a positive child), so its ergonomics maximum can
  // only be looser than the exact bound, never tighter. Weight and the ergonomics minimum agree on every gun.
  let tighterErgoMax = 0;
  for (const gun of guns) {
    const bp = preparePhysicalWeapon(lookup, gun.id);
    const legacy = computeStructuralBounds(gun.id, lookup, buildCompatibilityMap(gun.id, lookup));
    const raw = bp.rawBounds!;
    assert.ok(Math.abs(raw.weight.min - legacy.physicalWeightBounds[0]) < 1e-9, `${gun.shortName} weight min`);
    assert.ok(Math.abs(raw.weight.max - legacy.physicalWeightBounds[1]) < 1e-9, `${gun.shortName} weight max`);
    assert.ok(Math.abs(raw.ergonomics.min - legacy.ergoBounds[0]) < 1e-9, `${gun.shortName} ergonomics min`);
    assert.ok(raw.ergonomics.max <= legacy.ergoBounds[1] + 1e-9, `${gun.shortName} ergonomics max is looser than the legacy bound`);
    if (raw.ergonomics.max < legacy.ergoBounds[1] - 1e-9) tighterErgoMax++;
  }
  assert.equal(tighterErgoMax, 90);
});

test('M4A1 domain: masks cover every occurrence, the blueprint is untouched, reasons add up', { skip }, t => {
  const bp = preparePhysicalWeapon(lookup, gunId('M4A1'));
  const before = checksum(bp);
  const started = performance.now();
  const domain = prepareSubproblemDomain(bp, lookup, {});
  const ms = performance.now() - started;
  assert.equal(checksum(bp), before);
  assert.ok(ms < 3000);
  assert.equal(domain.empty, false);
  assert.ok(domain.bases.length >= 1);
  assert.equal(domain.occActive.length, bp.occurrenceCount);
  assert.equal(domain.reasonCounts.reduce((a, b) => a + b, 0), bp.occurrenceCount - 1, 'every item occurrence has exactly one status');
  let active = 0;
  for (let v = 1; v < bp.occurrenceCount; v++) active += domain.occActive[v];
  assert.equal(active, domain.reasonCounts[InactiveReason.ACTIVE]);
  assert.ok(active > 0 && active < bp.occurrenceCount - 1, 'default levels leave some items unobtainable');

  // Stable: a second preparation with the same request is identical.
  const again = prepareSubproblemDomain(bp, lookup, {});
  assert.deepEqual(Buffer.from(again.occActive), Buffer.from(domain.occActive));
  assert.deepEqual(Buffer.from(again.occInactiveReason), Buffer.from(domain.occInactiveReason));

  // Every trader disabled and no flea: no base can be bought.
  const none = prepareSubproblemDomain(bp, lookup, {
    traderLevels: { prapor: 0, skier: 0, peacekeeper: 0, mechanic: 0, jaeger: 0, ref: 0 },
    fleaAvailable: false,
  });
  assert.equal(none.empty, true);
  assert.equal(none.contradictions[0].code, 'NO_ACCESSIBLE_BASE');
  // With nothing buyable the required root slots (pistol grip, barrel, ...) lose every candidate as well.
  assert.ok(none.contradictions.slice(1).every(c => c.code === 'ROOT_REQUIRED_SLOT_EMPTY'));
  assert.equal(none.reasonCounts[InactiveReason.ACTIVE], 0);
  assert.equal(checksum(bp), before);
  t.diagnostic(`M4A1 default domain: ${ms.toFixed(1)} ms, ${domain.bases.length} bases, ${active} of ${bp.occurrenceCount - 1} occurrences active, reasons ${JSON.stringify(domain.reasonCounts)}`);
});
