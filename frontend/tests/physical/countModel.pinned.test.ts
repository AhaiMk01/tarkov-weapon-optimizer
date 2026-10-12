// The certifiable count model on the pinned capture (frontend/benchmarks/snapshot.json, SHA-256 219443b4...): every gun builds a model through the proof layer with
// nothing withheld and no coefficient HiGHS would filter; the parsed model of M4A1, AK-74N and MP5 (default, Tchebycheff, MOA and caps, a stash, TrueErgo on a weight
// node, Prevent Overswing) equals the text bit for bit with the padded right-hand sides dominating their exact needs (the qualification a certificate needs); and on
// the guns the occurrence model can still prove, the count model certifies the same optimum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import {
  assertCountModelApplies, computeActiveBounds, partGraphIsAcyclic, preparePhysicalWeapon, prepareSubproblemDomain, specializeCount, validatePhysicalBuild,
  type SpatialNode, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import { assessNativeResult } from '../../src/solver/physical/nativeProof';
import { nativeSolve, nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import { HIGHS_LARGE_MATRIX_VALUE, HIGHS_SMALL_MATRIX_VALUE } from '../../src/solver/physical/proof';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { solveOccurrence } from './occurrence/solveOccurrence';

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

interface RawGun { id: string; shortName: string }
let guns: RawGun[] = [];
let lookup: ItemLookup = {};
if (skip === false) {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: RawGun[]; mods: Record<string, unknown>[] };
  guns = snapshot.guns;
  lookup = buildItemLookup(guns as never, snapshot.mods as never);
}
/** As tests/physical/scale.test.ts: on this capture every allowed id the lookup does not hold is ammunition. */
const isAmmo = (id: string): boolean => !Object.hasOwn(lookup, id);
const gunId = (shortName: string): string => (guns.find(g => g.shortName === shortName) as RawGun).id;

type Request = SpecializeRequest & SubproblemRequest;

const VARIANTS: Record<string, { request: Request; node?: SpatialNode }> = {
  default: { request: {} },
  weights: { request: { ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5 } },
  tchebycheff: { request: { useTchebycheff: true, idealPoint: { zE: 500, nadE: 100, zR: -300, nadR: 0, zP: 1000, nadP: 100000 } } },
  capped: { request: { maxMOA: 5, maxPrice: 300000, minMagCapacity: 20, maxRecoilV: 300, maxRecoilSum: 450, minSightingRange: 50, maxWeight: 6, minErgonomics: 20 } },
  stash: { request: { ownedItems: ['5447a9cd4bdc2dbd208b4567'], barterAvailable: true } },
  trueErgo: { request: { useTrueErgo: true, equipErgoModifier: -0.15 }, node: { weightMin: 3, weightMax: 3.6 } },
  overswing: { request: { preventOverswing: true, maxWeight: 9 }, node: { weightMin: 4, weightMax: 5 } },
};

test('all 172 guns: every part graph is acyclic, every nonempty default domain passes the count-model assertion, and its certified model carries a proof with nothing withheld and no filtered coefficient', { skip, timeout: 900_000 }, t => {
  assert.equal(guns.length, 172);
  let eligible = 0, empty = 0, columns = 0, rows = 0, widest = 0, narrowest = Infinity;
  const started = performance.now();
  for (const gun of guns) {
    const blueprint = preparePhysicalWeapon(lookup, gun.id, { isAmmo });
    const domain = prepareSubproblemDomain(blueprint, lookup, {});
    if (domain.empty) { empty++; continue; }
    assert.equal(partGraphIsAcyclic(blueprint), true, `${gun.shortName}: the part graph of every pinned gun is acyclic`);
    assertCountModelApplies(blueprint, domain); // throws on a failure of Lemma 1
    eligible++;
    const model = specializeCount(blueprint, domain, { ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5 });
    assert.equal(model.proof.withheld, null, gun.shortName);
    assert.equal(model.matrixFilterRisk, false, `${gun.shortName}: smallest ${model.stats.minAbsCoefficient}, largest ${model.stats.maxAbsCoefficient}`);
    assert.ok(model.stats.minAbsCoefficient > HIGHS_SMALL_MATRIX_VALUE && model.stats.maxAbsCoefficient < HIGHS_LARGE_MATRIX_VALUE, gun.shortName);
    assert.equal(model.rowFamilies.reduce((n, f) => n + f.count, 0), model.stats.rows, `${gun.shortName}: the family accounting covers every row`);
    columns = Math.max(columns, model.stats.columns);
    rows = Math.max(rows, model.stats.rows);
    widest = Math.max(widest, model.stats.maxAbsCoefficient);
    narrowest = Math.min(narrowest, model.stats.minAbsCoefficient);
    // the accuracy sum can never pass 100 on real data (the MOA rows stay plain), the property the research measured
    assert.ok(computeActiveBounds(blueprint, domain).accuracy.hi <= 100, `${gun.shortName}: accuracy upper bound`);
  }
  t.diagnostic(`${eligible} eligible, ${empty} empty default domains; largest model ${columns} columns, ${rows} rows; coefficients in [${narrowest}, ${widest}]; ${((performance.now() - started) / 1000).toFixed(1)} s`);
  assert.equal(eligible + empty, 172);
  assert.equal(eligible, 153);
});

test('real guns: HiGHS reads the certified model of M4A1, AK-74N and MP5 back exactly as written, and the solve is QUALIFIED (padded right-hand sides dominate their needs, declared tolerances, presolve off)', { skip, timeout: 900_000 }, async t => {
  for (const name of ['MP5', 'AK-74N', 'M4A1']) {
    const blueprint = preparePhysicalWeapon(lookup, gunId(name), { isAmmo });
    for (const [variant, { request, node }] of Object.entries(VARIANTS)) {
      const domain = prepareSubproblemDomain(blueprint, lookup, request);
      const model = specializeCount(blueprint, domain, request, node);
      assert.equal(model.provedEmpty, null, `${name} ${variant}`);
      assert.equal(model.matrixFilterRisk, false, `${name} ${variant}`);
      // A short native run only to obtain the parsed model of the text HiGHS reads: the qualification does not depend on how the solve ends.
      const lpText = model.lp();
      const result = await nativeSolve(lpText, { ...nativeSolveOptions(1e-5), presolve: 'off', time_limit: 1 }, { includeReadback: true });
      const assessment = assessNativeResult({ lpText, proof: model.proof }, result);
      assert.equal(assessment.qualified, true, `${name} ${variant}: ${assessment.reasons.join(' | ')}`);
      assert.equal(assessment.readback.compared && assessment.readback.ok, true, `${name} ${variant}`);
      assert.equal(assessment.readback.differences, 0);
      assert.equal(assessment.readback.filtered, 0);
      assert.equal(assessment.allowances.violated, 0);
      assert.equal(assessment.allowances.checked, model.proof.rows.length);
      if (variant === 'trueErgo' || variant === 'overswing') assert.ok(model.proof.secant !== null && model.proof.gear !== null, `${name} ${variant}: the TED rows are recorded`);
      if (variant === 'capped') assert.ok(model.proof.rows.some(r => r.row.startsWith('moa_')) && model.proof.rows.some(r => r.row === 'lim_recoil_sum'), `${name}: the MOA and recoil rows are constructed`);
      if (name === 'M4A1' && variant === 'default') t.diagnostic(`M4A1 certified model: ${model.stats.columns} columns (${model.stats.binaries} binary, ${model.stats.integers} integer), ${model.stats.rows} rows, ${model.stats.nonzeros} nonzeros, ${(model.lp().length / 1e6).toFixed(2)} MB of text, ${assessment.allowances.checked} padded rows`);
    }
  }
});

/** The request of the measurement of 2026-10-04 (weights 1 / 1 / 0.5, flea, trader level 4, player level 50), with a tolerance a decade above the native noise. */
const measured = (id: string, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(id, lookup), physicalOptions: { isAmmo },
  ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
  traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, equipErgoModifier: 0, objectiveTolerance: 1e-8, ...extra,
});

test('guns the occurrence model can still prove: production Precise (the count model, with its second opinion) certifies the same optimum, plain and TrueErgo, and its build validates', { skip, timeout: 1_800_000 }, async t => {
  const cases: [string, Partial<SolveParams>][] = [
    ['MP5K-N', {}], ['MP5K-N', { useTrueErgo: true }], ['MP5K-N', { preventOverswing: true }],
    ['MP9-N', {}], ['SA58', {}], ['MP5', {}], ['MP9-N', { useTrueErgo: true, preventOverswing: true }],
  ];
  for (const [name, extra] of cases) {
    const params = measured(gunId(name), extra);
    const label = `${name} ${JSON.stringify(extra)}`;
    const started = performance.now();
    const precise = await solveOccurrence({ params, deadline: performance.now() + 120_000 });
    const preciseMs = performance.now() - started;
    const count = await solvePrecise({ params, deadline: performance.now() + 120_000 });
    const countMs = performance.now() - started - preciseMs;
    assert.equal(precise.kind, 'build', `${label}: occurrence model ${precise.kind}`);
    assert.equal(count.kind, 'build', `${label}: count model ${count.kind}`);
    if (precise.kind !== 'build' || count.kind !== 'build') continue;
    assert.equal(precise.certified, true, label);
    assert.equal(count.certified, true, `${label}: ${count.reason ?? ''}`);
    assert.equal(count.summary.telemetry.disagreements, 0, `${label}: the second opinion agreed`);
    assert.ok(Math.abs(count.best.score - precise.best.score) <= 3e-8 * Math.max(1, Math.abs(precise.best.score)), `${label}: count ${count.best.score} vs occurrence ${precise.best.score}`);
    assert.equal(count.summary.telemetry.unqualifiedSolves, 0, label);
    assert.equal(validatePhysicalBuild(lookup, params, count.best.build, { requirePathInstanceIds: true, isAmmo }).ok, true, label);
    t.diagnostic(`${label}: score ${count.best.score}; occurrence ${preciseMs.toFixed(0)} ms (${precise.summary.nodes} nodes), count ${countMs.toFixed(0)} ms (${count.summary.nodes} nodes, ${count.summary.telemetry.nativeSolves} solves)`);
  }
});
