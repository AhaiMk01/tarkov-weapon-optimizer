// Differential cross-check of the physical blueprint and the subproblem-domain masks against the oracle (Stage 2, phase 2.4a).
//
// For every ledger case (mapped with toProduction.differential.ts) the production blueprint and domain are built and compared with
// the oracle's own enumeration and acquisition model, ignoring caps and the objective:
//
//   1. the set of rooted occurrence trees the masks admit equals the oracle's trees filtered by the per-item bans a mask can express;
//   2. the same for the blueprint alone (structural viability) against the oracle's unfiltered trees minus receiver-banned items;
//   3. an occurrence is active exactly when it appears in some admissible oracle tree (identity by path-derived instance id);
//   4. the domain is empty exactly when the oracle has no accessible base or no admissible tree;
//   5. accessible bases, legal standalone offers (count, cheapest price and lot sizes), owned stock and preset supply agree;
//   6. instance ids follow the reference's `parent/slot:item` scheme.
//
// Cases whose fixtures the production inputs cannot carry (flea gates per base or per offer, non-canonical trader names) are
// skipped and listed, never silently dropped. See blueprint.differential.ts for the representation mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import { childInstanceId, ROOT_INSTANCE_ID as ORACLE_ROOT } from '../oracle/index';
import { fixtureForWeapon } from '../bridge/toFixture';
import { loadPinnedSnapshot, PinError } from '../source/pins';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { preparePhysicalWeapon, ROOT_INSTANCE_ID } from '../../src/solver/physical';
import type { ItemLookup } from '../../src/solver/types';
import {
  blueprintTrees, domainTrees, independentWalk, maskRelevantUnsupported, oracleSide, prepareProduction, treeKey,
  type OracleSide, type ProductionPhysical, type TreeSet,
} from './blueprint.differential';

// dataService.ts cannot be statically imported here: tsconfig.reference.json has no DOM lib and dataService references IndexedDB and typed
// Response APIs (see reference/source/extractors.differential.test.ts). A non-literal specifier keeps tsc from following the import while
// the runtime loads the real module; only `buildItemLookup` is used.
const DATA_SERVICE = '../../src/solver/dataService.ts';
type BuildItemLookup = (guns: unknown[], mods: unknown[]) => ItemLookup;
const { buildItemLookup } = (await import(DATA_SERVICE)) as { buildItemLookup: BuildItemLookup };

interface CaseRun {
  id: string;
  skipped: string[];
  production?: ProductionPhysical;
  oracle?: OracleSide;
  error?: string;
}

const runs: CaseRun[] = LEDGER.map(c => {
  const skipped = maskRelevantUnsupported(c.fixture, c.request);
  if (skipped.length > 0) return { id: c.id, skipped };
  try {
    return { id: c.id, skipped, production: prepareProduction(c.fixture, c.request), oracle: oracleSide(c.fixture, c.request) };
  } catch (e) {
    return { id: c.id, skipped, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
});

const compared = runs.filter(r => r.production && r.oracle) as (CaseRun & { production: ProductionPhysical; oracle: OracleSide })[];

const describeDifference = (actual: TreeSet, expected: TreeSet): string => {
  const missing = [...expected.trees].filter(t => !actual.trees.has(t));
  const extra = [...actual.trees].filter(t => !expected.trees.has(t));
  return `blueprint-only ${extra.length}${extra[0] ? ` e.g. ${extra[0]}` : ''}; oracle-only ${missing.length}${missing[0] ? ` e.g. ${missing[0]}` : ''}`;
};

test('the harness compares nearly every ledger case and lists the rest', t => {
  const skipped = runs.filter(r => r.skipped.length > 0);
  const errors = runs.filter(r => r.error);
  assert.deepEqual(errors.map(r => `${r.id}: ${r.error}`), [], 'a ledger case failed to prepare');
  assert.equal(compared.length + skipped.length, LEDGER.length);
  assert.ok(compared.length >= LEDGER.length - 10, `only ${compared.length} of ${LEDGER.length} cases are compared`);
  const reasons = new Map<string, number>();
  for (const r of skipped) for (const s of r.skipped) reasons.set(s.split(':')[0], (reasons.get(s.split(':')[0]) ?? 0) + 1);
  t.diagnostic(`compared ${compared.length} of ${LEDGER.length} ledger cases; skipped ${skipped.length}: ${[...reasons].map(([k, n]) => `${k} x${n}`).join(', ') || 'none'}`);
  t.diagnostic(`skipped ids: ${skipped.map(r => r.id).join(', ') || 'none'}`);
});

test('1. the masks admit exactly the oracle trees left after the per-item bans', t => {
  const mismatches: string[] = [];
  let trees = 0;
  let incomplete = 0;
  for (const r of compared) {
    const actual = domainTrees(r.production.blueprint, r.production.domain);
    if (!actual.complete || !r.oracle.masked.complete) { incomplete++; continue; }
    trees += r.oracle.masked.trees.size;
    const equal = actual.trees.size === r.oracle.masked.trees.size && [...r.oracle.masked.trees].every(k => actual.trees.has(k));
    if (!equal) mismatches.push(`${r.id}: ${describeDifference(actual, r.oracle.masked)}`);
  }
  assert.deepEqual(mismatches, []);
  assert.equal(incomplete, 0, 'every ledger enumeration is complete');
  t.diagnostic(`${compared.length} cases, ${trees} admissible trees compared in total`);
});

test('2. the blueprint alone admits exactly the oracle trees left after the receiver bans (structural viability)', () => {
  const mismatches: string[] = [];
  for (const r of compared) {
    const actual = blueprintTrees(r.production.blueprint, c => r.production.blueprint.structurallyViable[c] === 1);
    if (!actual.complete || !r.oracle.structural.complete) continue;
    const equal = actual.trees.size === r.oracle.structural.trees.size && [...r.oracle.structural.trees].every(k => actual.trees.has(k));
    if (!equal) mismatches.push(`${r.id}: ${describeDifference(actual, r.oracle.structural)}`);
  }
  assert.deepEqual(mismatches, []);
});

test('3. an occurrence is active exactly when some admissible oracle tree contains it', () => {
  const mismatches: string[] = [];
  for (const r of compared) {
    const { blueprint, domain } = r.production;
    const active = new Set<string>();
    for (let v = 1; v < blueprint.occurrenceCount; v++) if (domain.occActive[v]) active.add(blueprint.instanceId(v));
    const expected = r.oracle.masked.occurrences;
    const onlyActive = [...active].filter(id => !expected.has(id));
    const onlyOracle = [...expected].filter(id => !active.has(id));
    if (onlyActive.length || onlyOracle.length) mismatches.push(`${r.id}: active-only ${JSON.stringify(onlyActive)} oracle-only ${JSON.stringify(onlyOracle)}`);
  }
  assert.deepEqual(mismatches, []);
});

test('4. the domain is empty exactly when the oracle has no accessible base or no admissible tree', () => {
  const mismatches: string[] = [];
  for (const r of compared) {
    const oracleEmpty = r.oracle.masked.trees.size === 0; // includes the no-accessible-base case, see oracleSide
    if (r.production.domain.empty !== oracleEmpty) {
      mismatches.push(`${r.id}: domain.empty ${r.production.domain.empty}, oracle ${oracleEmpty} (bases ${r.oracle.bases.length}, trees ${r.oracle.masked.trees.size})`);
    }
    const codes = r.production.domain.contradictions.map(c => c.code);
    if (r.oracle.bases.length === 0 && !codes.includes('NO_ACCESSIBLE_BASE')) mismatches.push(`${r.id}: no NO_ACCESSIBLE_BASE contradiction`);
    if (r.oracle.bases.length > 0 && codes.includes('NO_ACCESSIBLE_BASE')) mismatches.push(`${r.id}: spurious NO_ACCESSIBLE_BASE`);
  }
  assert.deepEqual(mismatches, []);
});

/**
 * Production rounds the float barter total (`Math.round`), the oracle rounds the exact total of the decoded binary64 leaves (INTERPRETATIONS.md
 * choice 3). They can differ by 1 RUB at an exact .5 boundary; Stage 2 numerics (4C) repairs that, not this module. Only the one ledger case
 * built on such a boundary may differ, and only by 1.
 */
const BARTER_ROUNDING_BOUNDARY_CASES = new Set(['F09-fractional-barter-count-is-decoded-exactly']);
const priceMatches = (caseId: string, actual: number, expected: number): boolean =>
  Math.abs(actual - expected) < 1e-9 || (BARTER_ROUNDING_BOUNDARY_CASES.has(caseId) && Math.abs(actual - expected) === 1);

test('5. accessible bases, legal offers, owned stock and preset supply agree with the oracle acquisition model', () => {
  const mismatches: string[] = [];
  for (const r of compared) {
    const { blueprint, domain } = r.production;
    const bases = domain.bases.map(b => (b.kind === 'naked' ? 'naked' : `preset:${b.presetId}`)).sort();
    if (JSON.stringify(bases) !== JSON.stringify(r.oracle.bases)) mismatches.push(`${r.id}: bases ${JSON.stringify(bases)} vs oracle ${JSON.stringify(r.oracle.bases)}`);
    for (const b of domain.bases) {
      const key = b.kind === 'naked' ? 'naked' : `preset:${b.presetId}`;
      const expected = r.oracle.baseCheapest.get(key);
      if (expected === undefined || !priceMatches(r.id, b.cheapestPrice, expected)) mismatches.push(`${r.id}: base ${key} price ${b.cheapestPrice} vs oracle ${expected}`);
    }
    for (let t = 1; t < blueprint.templateCount; t++) {
      const id = blueprint.templateIds[t];
      const acquisition = domain.templates[t];
      const expected = r.oracle.templates.get(id);
      if (!expected) { mismatches.push(`${r.id}: ${id} unknown to the oracle`); continue; }
      const presets = acquisition.presetSupply
        .map(p => {
          const base = domain.bases[p.base];
          return `${base.kind === 'preset' ? base.presetId : '?'}x${p.quantity}`;
        })
        .sort();
      const cheapestMatches = expected.cheapest === null
        ? acquisition.cheapestPrice === null
        : acquisition.cheapestPrice !== null && priceMatches(r.id, acquisition.cheapestPrice, expected.cheapest);
      if (acquisition.standaloneOffers.length !== expected.standalone || !cheapestMatches || acquisition.owned !== expected.owned || JSON.stringify(presets) !== JSON.stringify(expected.presets)) {
        mismatches.push(`${r.id}: ${id} standalone ${acquisition.standaloneOffers.length}/${acquisition.cheapestPrice} owned ${acquisition.owned} presets ${JSON.stringify(presets)} vs oracle ${JSON.stringify(expected)}`);
      }
      const lotSizes = acquisition.standaloneLots.map(o => o.lotSize).sort((a, b) => a - b);
      if (JSON.stringify(lotSizes) !== JSON.stringify(expected.lotSizes)) mismatches.push(`${r.id}: ${id} lot sizes ${JSON.stringify(lotSizes)} vs oracle ${JSON.stringify(expected.lotSizes)}`);
      const supply = expected.standalone > 0 ? 'standalone' : expected.owned > 0 || expected.presets.length > 0 ? 'capped' : 'none';
      if (acquisition.supply !== supply) mismatches.push(`${r.id}: ${id} supply ${acquisition.supply} vs oracle ${supply}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('6. instance ids follow the reference scheme and are unique per occurrence', () => {
  assert.equal(ROOT_INSTANCE_ID, ORACLE_ROOT);
  const mismatches: string[] = [];
  for (const r of compared) {
    const { blueprint } = r.production;
    const seen = new Set<string>();
    for (let v = 0; v < blueprint.occurrenceCount; v++) {
      const id = blueprint.instanceId(v);
      if (seen.has(id)) mismatches.push(`${r.id}: duplicate ${id}`);
      seen.add(id);
      if (v === 0) continue;
      const owner = blueprint.slotOwner(blueprint.parentSlot(v));
      const expected = childInstanceId(blueprint.instanceId(owner), blueprint.rawSlotId(blueprint.parentSlot(v)), blueprint.templateId(v));
      if (id !== expected) mismatches.push(`${r.id}: ${id} != ${expected}`);
      if (blueprint.occurrenceByInstanceId(id) !== v) mismatches.push(`${r.id}: ${id} does not resolve back`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('the comparison is not vacuous: a corrupted mask is detected', () => {
  // Find a case whose domain admits several trees and flip one active occurrence off: the tree sets must then differ.
  const target = compared.find(r => !r.production.domain.empty && r.oracle.masked.trees.size >= 2);
  assert.ok(target, 'some ledger case admits at least two trees');
  const { blueprint, domain } = target.production;
  let flipped = -1;
  for (let v = 1; v < blueprint.occurrenceCount; v++) if (domain.occActive[v]) { flipped = v; break; }
  assert.ok(flipped > 0);
  const corrupted = blueprintTrees(blueprint, c => c !== flipped && domain.occActive[c] === 1);
  assert.notDeepEqual([...corrupted.trees].sort(), [...target.oracle.masked.trees].sort());
  // And the keys are canonical: reordering instance ids does not change a key.
  assert.equal(treeKey(['b', 'a']), treeKey(['a', 'b']));
});

test('7. real pinned guns: occurrence counts and raw ranges equal an independent walk over the raw-derived bridge fixture', t => {
  // The blueprint is built from the normalized snapshot through the production lookup; the walk runs over the oracle fixture the bridge
  // derives from the pinned RAW documents (camora slots removed there, ammunition-only slots removed here). Two captures, two code paths.
  let snapshot: { guns: { id: string; shortName: string }[]; mods: unknown[] };
  let world: ReturnType<typeof loadPinnedWorld>['world'];
  try {
    snapshot = loadPinnedSnapshot().snapshot as typeof snapshot;
    world = loadPinnedWorld('en').world;
  } catch (e) {
    if (e instanceof PinError) { t.skip(`pinned documents are not restored: ${e.message}`); return; }
    throw e;
  }
  const lookup = buildItemLookup(snapshot.guns, snapshot.mods);
  // The normalized snapshot predates item types, so its slots carry no ammunition flags; the raw documents do. The classifier is the
  // raw item type, not "absent from the lookup" (the data-layer flags are checked end to end in tests/data/ammoSource.test.ts).
  const isAmmo = (id: string): boolean => world.items.get(id)?.types.includes('ammo') === true;
  const mismatches: string[] = [];
  let compared = 0;
  let total = 0;
  const tol = 1e-9;
  for (const gun of snapshot.guns) {
    const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
    const walk = independentWalk(fixtureForWeapon(world, gun.id).fixture, gun.id);
    compared++;
    total += walk.occurrences;
    const raw = blueprint.rawBounds;
    const same = walk.occurrences === blueprint.occurrenceCount - 1
      && walk.buildable === (raw !== null)
      && (raw === null || (
        Math.abs(raw.weight.min - walk.weight.min) < tol && Math.abs(raw.weight.max - walk.weight.max) < tol
        && Math.abs(raw.ergonomics.min - walk.ergonomics.min) < tol && Math.abs(raw.ergonomics.max - walk.ergonomics.max) < tol
        && Math.abs(raw.recoil.min - walk.recoil.min) < tol && Math.abs(raw.recoil.max - walk.recoil.max) < tol));
    if (!same) mismatches.push(`${gun.shortName}: walk ${JSON.stringify(walk)} vs blueprint ${blueprint.occurrenceCount - 1} ${JSON.stringify(raw)}`);
  }
  assert.deepEqual(mismatches, []);
  assert.equal(compared, 172);
  t.diagnostic(`${compared} guns, ${total} occurrences counted independently`);
});
