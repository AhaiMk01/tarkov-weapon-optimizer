// Real-data smoke test of the occurrence-level validator on the pinned capture (ADR 0013 section 1: frontend/benchmarks/snapshot.json,
// SHA-256 219443b4..., restored from the hashed artifact when missing, never regenerated).
//
// Small real guns are specialized into the physical LP, solved on the pinned native HiGHS build and decoded; every decoded build must be accepted
// by the validator, which shares no code with the LP or the decoder. The decoder's own claims (spend, per-occurrence provenance) are
// cross-checked against the validator's exact recomputation, and the validator's exact statistics are checked against the objective the solver
// maximized. Corrupted copies of the same real builds must be rejected with the right codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import type { ItemLookup } from '../../src/solver/types';
import {
  preparePhysicalWeapon, prepareSubproblemDomain, preparePhysicalValidator, type PhysicalBuild, type PhysicalValidation, type PhysicalValidationRequest, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import { specializeLP } from './occurrence/specializeOccurrence';
import { decodeSolution, physicalBuildFromDecoded, type DecodedBuild } from './occurrence/decodeOccurrence';
import { barter, gun, lookupOf, mod, slot, trader } from './fixtures';
import { solveLp } from './lpHarness';

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

/** The pinned payload predates item types: every allowed id the lookup does not hold is ammunition (tests/data/ammoSource.test.ts). */
const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);

type Request = SpecializeRequest & SubproblemRequest;

interface Solved {
  weaponId: string;
  request: Request;
  build: DecodedBuild;
  objective: number;
}

/** Specialize, solve on the pinned native build and decode. Null when the request has no build (infeasible). */
async function solveReal(shortName: string, request: Request): Promise<Solved | null> {
  const gun = guns.find(g => g.shortName === shortName);
  assert.ok(gun, `${shortName} is in the snapshot`);
  const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
  const domain = prepareSubproblemDomain(blueprint, lookup, request);
  const model = specializeLP(blueprint, domain, request);
  if (model.provedEmpty) return null;
  const solution = await solveLp(model.lp);
  if (solution.status !== 'Optimal') {
    assert.equal(solution.status, 'Infeasible', `${shortName}: the solve ended ${solution.status}`);
    return null;
  }
  return { weaponId: gun.id, request, build: decodeSolution(model, solution.values), objective: solution.objective };
}

const validatorRequest = (weaponId: string, request: Request): PhysicalValidationRequest => ({ ...request, weaponId });

function validate(solved: Solved, build?: PhysicalBuild, request?: Request): PhysicalValidation {
  return preparePhysicalValidator(lookup, validatorRequest(solved.weaponId, request ?? solved.request), { isAmmo, requirePathInstanceIds: true })
    .validate(build ?? physicalBuildFromDecoded(solved.build));
}

const GUNS = ['M45A1', 'P226R', 'AA-12 Gen 1', 'CR 200DS', 'MP7A1', 'MP5K-N', 'Vector 9x19', 'M870'];
const WEIGHTED: Request = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0 };

test('every decoded build of the default weighted request is accepted, and its decoder claims equal the exact recomputation', { skip, timeout: 300_000 }, async t => {
  let multiCopy = 0;
  let placements = 0;
  for (const name of GUNS) {
    const solved = await solveReal(name, WEIGHTED);
    assert.ok(solved, `${name} has a build`);
    const result = validate(solved);
    assert.deepEqual(result.violations, [], `${name}: ${JSON.stringify(result.violations.slice(0, 3))}`);
    const stats = result.stats!;
    assert.equal(stats.spend, solved.build.spend, `${name}: the decoder's spend is the exact spend`);
    assert.equal(stats.basePrice, solved.build.basePrice);
    // The solver maximized e x ergonomics (first clamp) - r x 1000 x recoil modifier sum: the validator's independent statistics reproduce it.
    assert.ok(Math.abs(solved.objective - (stats.ergonomics - 1000 * stats.recoilModifierSum)) < 1e-6, `${name}: objective ${solved.objective} vs ${stats.ergonomics - 1000 * stats.recoilModifierSum}`);
    placements += solved.build.placements.length;
    if ([...solved.build.installed.values()].some(n => n > 1)) multiCopy++;
  }
  t.diagnostic(`${GUNS.length} guns, ${placements} placements validated; ${multiCopy} multi-copy build(s)`);
});

test('price pressure, caps, stock, market and filters: every decoded build is accepted under its own request', { skip, timeout: 600_000 }, async t => {
  let solvedCount = 0;
  let infeasible = 0;
  let owned = 0;
  for (const name of GUNS) {
    const base = await solveReal(name, WEIGHTED);
    assert.ok(base);
    const stats = validate(base).stats!;
    const installedIds = [...base.build.installed.keys()];
    const bp = preparePhysicalWeapon(lookup, base.weaponId, { isAmmo });
    const category = installedIds.length > 0 ? (lookup[installedIds[0]].stats as { category_id: string }).category_id : '';
    const requests: Request[] = [
      { ergoWeight: 1, recoilWeight: 1, priceWeight: 1 },
      { ...WEIGHTED, maxPrice: Math.floor(stats.spend * 0.9), minErgonomics: Math.max(0, stats.ergonomics - 5) },
      { ...WEIGHTED, maxWeight: stats.weight + 0.5, maxRecoilV: stats.recoilVertical + 1 },
      { ...WEIGHTED, ownedItems: installedIds },
      { ...WEIGHTED, ownedItems: [...installedIds, ...installedIds], priceWeight: 1 },
      { ...WEIGHTED, barterAvailable: true, fleaAvailable: false, traderLevels: { prapor: 2, skier: 2, peacekeeper: 2, mechanic: 2, jaeger: 2, ref: 2 }, playerLevel: 15 },
      { ...WEIGHTED, barterAvailable: true, barterExcludeDogtags: true },
      ...(category ? [{ ...WEIGHTED, excludeCategories: [category] }] : []),
      ...(installedIds.length > 0 ? [{ ...WEIGHTED, excludeItems: [installedIds[0]] }] : []),
      ...(bp.templateCount > 2 ? [{ ...WEIGHTED, includeItems: [bp.templateIds[bp.templateCount - 1]] }] : []),
      { ...WEIGHTED, preventOverswing: false, equipErgoModifier: -0.15 },
    ];
    for (const request of requests) {
      const solved = await solveReal(name, request);
      if (!solved) {
        infeasible++;
        continue;
      }
      solvedCount++;
      const result = validate(solved);
      assert.deepEqual(result.violations, [], `${name} ${JSON.stringify(request)}: ${JSON.stringify(result.violations.slice(0, 3))}`);
      if (result.stats!.acquisition.occurrences.some(o => o.source === 'owned')) owned++;
    }
  }
  t.diagnostic(`${solvedCount} decoded builds accepted, ${infeasible} requests without a build, ${owned} builds drawing on owned stock`);
  assert.ok(solvedCount >= 60, `only ${solvedCount} requests produced a build`);
  assert.ok(owned >= 3, 'the owned-stock requests exercised the owned allocation');
});

test('corrupted copies of a real build are rejected with the matching codes', { skip, timeout: 120_000 }, async () => {
  const solved = await solveReal('MP5K-N', WEIGHTED);
  assert.ok(solved);
  const good = physicalBuildFromDecoded(solved.build);
  const codes = (build: PhysicalBuild, request?: Request): string[] => [...new Set(validate(solved, build, request).violations.map(v => v.code))].sort();
  assert.deepEqual(codes(good), []);

  const placements = good.placements;
  assert.ok(placements.length >= 3);
  // Drop a part that has descendants: its children lose their parent (and the part may be required).
  const parent = placements.find(p => placements.some(q => q.parentInstanceId === p.childInstanceId));
  if (parent) {
    const dropped: PhysicalBuild = { ...good, placements: placements.filter(p => p !== parent) };
    assert.ok(codes(dropped).includes('UNKNOWN_PARENT_INSTANCE'));
  }
  // A second child in a physical slot, a repeated instance id, a parent that does not exist, a part the slot does not allow, an unknown part.
  const first = placements[0];
  assert.ok(codes({ ...good, placements: [...placements, { ...first, childInstanceId: `${first.childInstanceId}#2` }] }).includes('SLOT_CAPACITY_EXCEEDED'));
  assert.ok(codes({ ...good, placements: [...placements, { ...first }] }).includes('DUPLICATE_INSTANCE_ID'));
  assert.ok(codes({ ...good, placements: placements.map(p => (p === first ? { ...p, parentInstanceId: 'weapon_0/ghost:slot' } : p)) }).includes('UNKNOWN_PARENT_INSTANCE'));
  assert.ok(codes({ ...good, placements: placements.map(p => (p === first ? { ...p, itemId: 'ghost-item' } : p)) }).includes('UNKNOWN_ITEM'));
  // Caps one unit past the build, the base swapped, a wrong claimed spend.
  const stats = validate(solved).stats!;
  assert.deepEqual(codes(good, { ...solved.request, maxPrice: stats.spend - 1 }), ['MAX_PRICE_EXCEEDED']);
  assert.deepEqual(codes(good, { ...solved.request, maxWeight: stats.weight - 1e-9 }), ['MAX_WEIGHT_EXCEEDED']);
  assert.deepEqual(codes(good, { ...solved.request, minErgonomics: stats.ergonomics + 1 }), ['MIN_ERGONOMICS_NOT_MET']);
  assert.deepEqual(codes({ ...good, base: { kind: 'preset', presetId: 'ghost-preset' } }).filter(c => c === 'BASE_UNKNOWN_PRESET'), ['BASE_UNKNOWN_PRESET']);
  assert.deepEqual(codes({ ...good, claimed: { ...good.claimed, spend: stats.spend + 1 } }), ['CLAIMED_SPEND_MISMATCH']);
  assert.deepEqual(codes(good, { ...solved.request, excludeItems: [first.itemId] }).filter(c => c === 'EXCLUDED_ITEM'), ['EXCLUDED_ITEM']);
});

test('a hand-built multi-copy build decodes and validates: several copies of one template in distinct physical slots', { timeout: 60_000 }, async () => {
  const tiny = lookupOf(
    gun('gun', { slots: [slot('s1', ['a']), slot('s2', ['a']), slot('s3', ['a'])], presets: [{ id: 'P', items: [{ itemId: 'a', count: 1 }], offers: [trader('prapor', 1, 1000)] }] }),
    ['a', mod('a', { ergo: 5, weight: 0.1, offers: [trader('prapor', 1, 200), barter('prapor', 1, 300, false, 3)] })],
  );
  const request: Request = { ergoWeight: 1, recoilWeight: 0, priceWeight: 0, barterAvailable: true, ownedItems: ['a'] };
  const blueprint = preparePhysicalWeapon(tiny, 'gun');
  const domain = prepareSubproblemDomain(blueprint, tiny, request);
  const model = specializeLP(blueprint, domain, request);
  const solution = await solveLp(model.lp);
  assert.equal(solution.status, 'Optimal');
  const decoded = decodeSolution(model, solution.values);
  assert.equal(decoded.placements.length, 3, 'all three slots take a copy');
  const result = preparePhysicalValidator(tiny, { ...request, weaponId: 'gun' }, { requirePathInstanceIds: true }).validate(physicalBuildFromDecoded(decoded));
  assert.deepEqual(result.violations, []);
  assert.equal(result.stats?.acquisition.occurrences.length, 3);
});
