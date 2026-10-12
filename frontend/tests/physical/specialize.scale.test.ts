// Scale of the physical LP on the pinned capture (ADR 0013 section 1: frontend/benchmarks/snapshot.json, SHA-256 219443b4..., restored from the
// hashed artifact when missing, never regenerated): M4A1 (151,479 occurrences, the largest gun) and AK-74N (41,153) with a typical weighted request.
//
// The sizes and the emit time are reported as diagnostics, and the text of both models is round-tripped through parseLpText and the model
// HiGHS actually read (that part runs by default). The solves are opt in (PHYSICAL_SCALE_SOLVE=1): on the pinned native build (HiGHS 1.15.1,
// structured full-precision primals) the UNREDUCED model is hard at this size. In the reported run a 120 s limit ends AK-74N at its first node
// (incumbent 546.5, dual bound 595) and a 120 s limit ends M4A1 without an incumbent; an incumbent, optimal or not, is decoded and checked
// against the objective recomputed from the templates alone. No assertion depends on a solve time or on optimality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { compareReadback, getNativeHighs, parseLpText, readbackModel, type HighsOptions } from '../../src/solver/native';
import type { ItemLookup } from '../../src/solver/types';
import {
  columnValuesFromStructured, preparePhysicalWeapon, prepareSubproblemDomain, type PhysicalBlueprint, type SubproblemDomain,
} from '../../src/solver/physical';
import { specializeLP, type SpecializedModel } from './occurrence/specializeOccurrence';
import { decodeSolution } from './occurrence/decodeOccurrence';

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

/** A typical weighted request: ergonomics and recoil weighted equally, no price pressure, default market. */
const TYPICAL = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0 } as const;

interface Measured {
  blueprint: PhysicalBlueprint;
  domain: SubproblemDomain;
  model: SpecializedModel;
  prepareMs: number;
  emitMs: number;
}

function measure(shortName: string): Measured {
  const gun = guns.find(g => g.shortName === shortName);
  assert.ok(gun, `${shortName} is in the snapshot`);
  const t0 = performance.now();
  const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
  const domain = prepareSubproblemDomain(blueprint, lookup, {});
  const t1 = performance.now();
  const model = specializeLP(blueprint, domain, TYPICAL);
  const t2 = performance.now();
  return { blueprint, domain, model, prepareMs: t1 - t0, emitMs: t2 - t1 };
}

const describe = (name: string, m: Measured): string => {
  const { stats } = m.model;
  const families = m.model.rowFamilies.filter(f => f.count > 0).map(f => `${f.id} ${f.count}`).join(', ');
  return `${name}: ${stats.columns} columns (${stats.binaries} binary, ${stats.integers} integer, ${stats.continuous} continuous), ${stats.rows} rows, ${stats.nonzeros} nonzeros, `
    + `LP text ${(stats.lpChars / 1024 / 1024).toFixed(2)} MiB, ${m.model.columns.activeOccurrences.length} of ${m.blueprint.occurrenceCount - 1} occurrences active, ${m.domain.bases.length} bases; `
    + `prepare ${m.prepareMs.toFixed(0)} ms, emit ${m.emitMs.toFixed(0)} ms; rows: ${families}`;
};

test('M4A1 and AK-74N models emit quickly with finite domains and no free column', { skip }, t => {
  for (const name of ['AK-74N', 'M4A1']) {
    const m = measure(name);
    t.diagnostic(describe(name, m));
    assert.equal(m.model.provedEmpty, null, `${name} has a build`);
    assert.ok(m.model.stats.columns > m.model.columns.activeOccurrences.length, 'decision columns plus bases and auxiliaries');
    assert.ok(!/\binf\b|\bfree\b/i.test(m.model.lp.slice(m.model.lp.indexOf('\nBounds\n'))), 'every column has finite bounds');
    assert.ok(m.model.auxiliaries.every(a => Number.isFinite(a.lo) && Number.isFinite(a.hi) && a.lo <= a.hi));
    assert.ok(m.emitMs < 5000, `${name} emit took ${m.emitMs.toFixed(0)} ms`);
  }
});

/** The objective of a decoded build, recomputed from the blueprint templates alone: e x ergonomics (first clamp) - r x 1000 x recoil modifier sum. */
function recomputedObjective(m: Measured, placements: { childInstanceId: string }[]): number {
  const { blueprint: bp } = m;
  let ergo = bp.templateErgonomics[0];
  let recoil = 0;
  for (const p of placements) {
    const v = bp.occurrenceByInstanceId(p.childInstanceId);
    ergo += bp.templateErgonomics[bp.occTemplate[v]];
    recoil += bp.templateRecoilModifier[bp.occTemplate[v]];
  }
  return Math.min(100, Math.max(0, ergo)) - 1000 * recoil;
}

const OPTIONS: HighsOptions = {
  mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_feasibility_tolerance: 1e-8, primal_feasibility_tolerance: 1e-9, dual_feasibility_tolerance: 1e-9,
};

/** Solve on the pinned native build and check the decoded build against the model: the LP objective is the objective of the build. */
async function solveAndCheck(t: { diagnostic(message: string): void }, name: string, m: Measured, timeLimitSeconds: number): Promise<void> {
  const started = performance.now();
  const result = await getNativeHighs().solveStructured(m.model.lp, { ...OPTIONS, time_limit: timeLimitSeconds });
  const solveMs = performance.now() - started;
  t.diagnostic(
    `${name} solve: ${result.modelStatus.name}, objective ${result.objectiveValue}, dual bound ${result.mipDualBound}, gap ${result.mipRelativeGap}, `
    + `${result.mipNodeCount} nodes, ${solveMs.toFixed(0)} ms (HiGHS ${result.highsVersion})`,
  );
  if (result.colValues === null) return; // no incumbent within the limit: nothing to check, and nothing here asserts on time
  const build = decodeSolution(m.model, columnValuesFromStructured(result.colNames, result.colValues));
  t.diagnostic(`${name} build: ${build.placements.length} placements, base ${build.base.kind}, spend ${build.spend}, ${build.purchases.length} purchased item(s)`);
  assert.ok(Math.abs(recomputedObjective(m, build.placements) - (result.objectiveValue as number)) < 1e-6, `${name}: the LP objective is the objective of the decoded build`);
  assert.ok(build.spend >= build.basePrice);
  const rooted = new Set(build.placements.map(p => p.childInstanceId).concat('weapon_0'));
  assert.ok(build.placements.every(p => rooted.has(p.parentInstanceId)), 'every placement hangs on an installed parent');
}

const solveSkip = skip || (process.env.PHYSICAL_SCALE_SOLVE === '1' ? false : 'set PHYSICAL_SCALE_SOLVE=1 to run the 120 s and 300 s native solves');
test('AK-74N: the incumbent of a 120 s solve on the pinned native build decodes (opt in: PHYSICAL_SCALE_SOLVE=1)', { skip: solveSkip, timeout: 600_000 }, async t => {
  await solveAndCheck(t, 'AK-74N', measure('AK-74N'), 120);
});

test('M4A1: a 300 s solve on the pinned native build (opt in: PHYSICAL_SCALE_SOLVE=1)', { skip: solveSkip, timeout: 900_000 }, async t => {
  await solveAndCheck(t, 'M4A1', measure('M4A1'), 300);
});

test('the emitted AK-74N and M4A1 texts parse strictly and HiGHS reads exactly that model (no dropped coefficient, no infinite bound)', { skip, timeout: 300_000 }, async t => {
  for (const name of ['AK-74N', 'M4A1']) {
    const m = measure(name);
    const started = performance.now();
    const expected = parseLpText(m.model.lp);
    const parsedMs = performance.now() - started;
    assert.equal(expected.columns.length, m.model.stats.columns);
    assert.equal(expected.rows.length, m.model.stats.rows);
    const readback = await readbackModel(m.model.lp, OPTIONS);
    assert.equal(readback.readStatus, 'ok', `${name}: ${readback.readMessages.join(' | ')}`);
    const comparison = compareReadback(expected, readback);
    t.diagnostic(`${name}: parseLpText ${parsedMs.toFixed(0)} ms; readback ${comparison.checked.columns} columns, ${comparison.checked.rows} rows, ${comparison.checked.coefficients} coefficients, ${comparison.filtered} filtered`);
    assert.ok(comparison.ok, `${name}: HiGHS read a different model: ${JSON.stringify(comparison.counts)}; first ${JSON.stringify(comparison.differences[0])}`);
  }
});
