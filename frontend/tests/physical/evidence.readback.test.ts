// Stage 3 evidence, item 1 (ADR 0013 section 4B, docs/stage3/native-evidence.md): on the PINNED native build, the model HiGHS parsed equals the model
// the production writers emitted (rows, row bounds, column bounds, objective, integrality and every coefficient, bit for bit), for
//   - the certified count model of production Precise, both texts it solves (`lp()` and the relaxed-first `lpRelaxedEdges()`), and
//   - the plain Fast count model, both texts (`lp()` and `lpRelaxedEdges()`),
// on real pinned guns (MP5, both SR-25 entries, AK-74N, M4A1) under several requests, and on seeded random worlds (plain and TED). The comparison is
// `compareReadback` against the strict independent parser `parseLpText` (no HiGHS code), plus independent size counts read straight off both sides.
// Certified texts are also run through `assessNativeResult`, the per-solve gate of production Precise, which must call them qualified. Finally,
// production `solvePrecise` on seeded worlds verifies EVERY native solve it makes (one readback check per solve, none unqualified).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReadback, parseLpText, readbackModel, type ExpectedModel, type ModelReadback } from '../../src/solver/native';
import {
  computeActiveBounds, preparePhysicalWeapon, prepareSubproblemDomain, specializeCount, specializeFast,
  type PhysicalBlueprint, type SpatialNode, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import { assessNativeResult } from '../../src/solver/physical/nativeProof';
import { nativeSolve, nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import { HIGHS_LARGE_MATRIX_VALUE, HIGHS_SMALL_MATRIX_VALUE, type ModelProof } from '../../src/solver/physical/proof';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { ItemLookup } from '../../src/solver/types';
import { loadPinned, pinnedSkip } from '../native/evidence/pinned';
import { randomTedWorld, randomWorld } from './randomWorlds';
import { WEAPON } from './lpFixtures';

const READ_OPTIONS = { ...nativeSolveOptions(1e-9), presolve: 'off' } as const;

interface Tally { texts: number; rows: number; columns: number; coefficients: number }
const tally: Tally = { texts: 0, rows: 0, columns: 0, coefficients: 0 };

/** The emitted text and HiGHS's parsed model agree exactly; the size counts are re-derived independently on both sides. */
function assertSameModel(label: string, lp: string, expected: ExpectedModel, readback: ModelReadback): void {
  const comparison = compareReadback(expected, readback, { smallMatrixValue: HIGHS_SMALL_MATRIX_VALUE, largeMatrixValue: HIGHS_LARGE_MATRIX_VALUE });
  assert.equal(comparison.ok, true, `${label}: ${JSON.stringify(comparison.counts)}; first ${JSON.stringify(comparison.differences[0])}`);
  assert.equal(comparison.differences.length, 0, label);
  assert.equal(comparison.filtered, 0, `${label}: no coefficient, objective entry or bound was filtered`);
  // Independent counts: nothing extra on either side, so the per-entry comparison above saw the whole model.
  const nonzeros = expected.rows.reduce((n, r) => n + r.terms.filter(([, c]) => c !== 0).length, 0);
  assert.equal(readback.numCol, expected.columns.length, `${label}: columns`);
  assert.equal(readback.numRow, expected.rows.length, `${label}: rows`);
  assert.equal(readback.numNz, nonzeros, `${label}: matrix nonzeros`);
  assert.equal(comparison.checked.coefficients, nonzeros, `${label}: every coefficient compared`);
  assert.equal(Array.from(readback.integrality).filter(c => c === 1).length, expected.columns.filter(c => c.integer).length, `${label}: integer columns`);
  assert.equal(Array.from(readback.colCost).filter(c => c !== 0).length, expected.columns.filter(c => c.cost !== 0).length, `${label}: objective entries`);
  assert.equal(readback.sense, 'max', `${label}: HiGHS reads a maximization`);
  assert.equal(expected.sense, 'max', label);
  assert.ok(lp.startsWith('Maximize\n'), label);
  tally.texts++;
  tally.rows += readback.numRow;
  tally.columns += readback.numCol;
  tally.coefficients += readback.numNz;
}

/** A text with no proof record (the plain Fast model): read it back without solving. */
async function checkPlainText(label: string, lp: string): Promise<void> {
  const readback = await readbackModel(lp, READ_OPTIONS);
  assert.equal(readback.readStatus, 'ok', `${label}: HiGHS adjusted the model while reading it: ${readback.readMessages.join(' | ')}`);
  assertSameModel(label, lp, parseLpText(lp), readback);
}

/**
 * A certified text: a short native run on the production options (presolve off, declared tolerances) returns the parsed model taken from the solving handle
 * before the run, and the production gate must call the solve qualified. How the run ends does not matter to the readback.
 */
async function checkCertifiedText(label: string, lp: string, proof: ModelProof): Promise<void> {
  const result = await nativeSolve(lp, { ...READ_OPTIONS, time_limit: 1 }, { includeReadback: true });
  assert.equal(result.readStatus, 'ok', label);
  assert.ok(result.readback !== null, label);
  assertSameModel(label, lp, parseLpText(lp), result.readback);
  const assessment = assessNativeResult({ lpText: lp, proof }, result);
  assert.equal(assessment.qualified, true, `${label}: ${assessment.reasons.join(' | ')}`);
  assert.equal(assessment.readback.compared && assessment.readback.ok, true, label);
  assert.equal(assessment.allowances.checked, proof.rows.length, label);
  assert.equal(assessment.allowances.violated, 0, label);
  assert.equal(assessment.presolveOff, true, label);
  assert.equal(assessment.tolerancesInForce, true, label);
}

type Request = SpecializeRequest & SubproblemRequest;
const tedNode = (blueprint: PhysicalBlueprint, lookup: ItemLookup, request: Request): SpatialNode => {
  const weight = computeActiveBounds(blueprint, prepareSubproblemDomain(blueprint, lookup, request)).weight;
  return { weightMin: weight.lo, weightMax: Math.min(weight.hi, weight.lo + (weight.hi - weight.lo) / 2) };
};

const REAL_VARIANTS: Record<string, { request: Request; ted?: true }> = {
  default: { request: { ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5 } },
  tchebycheff: { request: { priceWeight: 1, useTchebycheff: true, idealPoint: { zE: 500, nadE: 100, zR: -300, nadR: 0, zP: 1000, nadP: 100000 } } },
  capped: { request: { maxMOA: 5, maxPrice: 300000, minMagCapacity: 20, maxRecoilV: 300, maxRecoilSum: 450, minSightingRange: 50, maxWeight: 6, minErgonomics: 20 } },
  trueErgo: { request: { useTrueErgo: true, equipErgoModifier: -0.15 }, ted: true },
  overswing: { request: { preventOverswing: true, maxWeight: 9 }, ted: true },
};

test('item 1, real guns: HiGHS parses exactly the emitted certified Precise text and relaxed-first text, and the Fast text and its relaxed text, of MP5, both SR-25s, AK-74N and M4A1 under five requests; every certified solve is qualified', { skip: pinnedSkip, timeout: 1_800_000 }, async t => {
  const pinned = loadPinned();
  const started = performance.now();
  let certifiedTexts = 0, fastTexts = 0;
  for (const name of ['MP5', 'SR-25', 'AK-74N', 'M4A1']) {
    for (const gun of pinned.gunsNamed(name)) {
      const blueprint = preparePhysicalWeapon(pinned.lookup, gun.id, { isAmmo: pinned.isAmmo });
      for (const [variant, { request, ted }] of Object.entries(REAL_VARIANTS)) {
        const label = `${name} (${gun.id}) ${variant}`;
        const domain = prepareSubproblemDomain(blueprint, pinned.lookup, request);
        if (domain.empty) { t.diagnostic(`${label}: empty domain, nothing emitted`); continue; }
        const node = ted ? tedNode(blueprint, pinned.lookup, request) : undefined;
        const count = specializeCount(blueprint, domain, request, node);
        assert.equal(count.certified, true, label);
        assert.equal(count.proof.withheld, null, label);
        if (count.provedEmpty !== null) { t.diagnostic(`${label}: proved empty by the writer (${count.provedEmpty}), no text`); continue; }
        await checkCertifiedText(`${label} certified lp()`, count.lp(), count.proof);
        certifiedTexts++;
        if (count.edges.length > 0) { await checkCertifiedText(`${label} certified lpRelaxedEdges()`, count.lpRelaxedEdges(), count.proof); certifiedTexts++; }
        const fast = specializeFast(blueprint, domain, request, node);
        assert.equal(fast.certified, false, label);
        if (fast.provedEmpty !== null) continue;
        await checkPlainText(`${label} Fast lp()`, fast.lp());
        fastTexts++;
        if (fast.edges.length > 0) { await checkPlainText(`${label} Fast lpRelaxedEdges()`, fast.lpRelaxedEdges()); fastTexts++; }
      }
    }
  }
  assert.ok(certifiedTexts >= 40, `${certifiedTexts} certified texts`);
  assert.ok(fastTexts >= 40, `${fastTexts} Fast texts`);
  t.diagnostic(`${certifiedTexts} certified + ${fastTexts} Fast texts; ${tally.texts} readbacks so far, ${tally.rows} rows, ${tally.columns} columns, ${tally.coefficients} coefficients compared bit for bit; ${((performance.now() - started) / 1000).toFixed(1)} s`);
});

test('item 1, seeded worlds: the certified text, the relaxed-first text and both Fast texts read back exactly on 40 plain and 40 TED worlds', { timeout: 600_000 }, async t => {
  let checked = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const [kind, world] of [['plain', randomWorld(seed, false)], ['ted', randomTedWorld(seed, false)]] as const) {
      const label = `${kind} world ${seed}`;
      const blueprint = preparePhysicalWeapon(world.lookup, WEAPON);
      const domain = prepareSubproblemDomain(blueprint, world.lookup, world.params);
      if (domain.empty) continue;
      const tedRequest = world.params.useTrueErgo === true || world.params.preventOverswing === true;
      const node = tedRequest ? tedNode(blueprint, world.lookup, world.params) : undefined;
      const count = specializeCount(blueprint, domain, world.params, node);
      if (count.provedEmpty === null) {
        await checkCertifiedText(`${label} certified lp()`, count.lp(), count.proof);
        if (count.edges.length > 0) await checkCertifiedText(`${label} certified lpRelaxedEdges()`, count.lpRelaxedEdges(), count.proof);
        checked++;
      }
      const fast = specializeFast(blueprint, domain, world.params, node);
      if (fast.provedEmpty === null) {
        await checkPlainText(`${label} Fast lp()`, fast.lp());
        if (fast.edges.length > 0) await checkPlainText(`${label} Fast lpRelaxedEdges()`, fast.lpRelaxedEdges());
      }
    }
  }
  assert.ok(checked >= 50, `${checked} worlds with a certified text`);
  t.diagnostic(`${checked} seeded worlds with certified texts; ${tally.texts} readbacks in total`);
});

test('item 1, production path: solvePrecise verifies every native solve it makes against its text (one readback check per solve, none unqualified) on 15 plain and 15 TED seeded worlds', { timeout: 900_000 }, async t => {
  let solves = 0, certified = 0;
  for (let seed = 1; seed <= 15; seed++) {
    for (const [kind, world] of [['plain', randomWorld(seed, false)], ['ted', randomTedWorld(seed, false)]] as const) {
      const result = await solvePrecise({ params: world.params, deadline: performance.now() + 120_000 });
      const telemetry = result.summary.telemetry;
      assert.equal(telemetry.readbackChecks, telemetry.nativeSolves, `${kind} world ${seed}: every native solve was compared with its text`);
      assert.equal(telemetry.unqualifiedSolves, 0, `${kind} world ${seed}: ${telemetry.unqualifiedReasons.join(' | ')}`);
      solves += telemetry.nativeSolves;
      if (result.kind === 'build' && result.certified) certified++;
    }
  }
  assert.ok(solves > 30, `${solves} native solves`);
  t.diagnostic(`${solves} production native solves, each verified; ${certified} certified builds`);
});
