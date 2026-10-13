// Stage 3 evidence, item 3 (ADR 0013 section 4B, docs/stage3/native-evidence.md): coefficients near HiGHS's matrix filters and very wide price
// normalizations. HiGHS 1.15.1 drops matrix entries at or below `small_matrix_value` (1e-9) and refuses entries at or above `large_matrix_value` (1e15).
// An option setting alone does not make arbitrary coefficients survive, so production must DETECT filtering or withhold the proof. Each sweep below
// runs production Precise across the thresholds and checks the dichotomy on every point: the outcome is either exact (certified, the true optimum, a bound
// at least the true optimum) or withheld/uncertified (no certificate; a published bound is still at least the true optimum). Never certified-and-wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelReadError } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { preparePhysicalWeapon, prepareSubproblemDomain, specializeCount } from '../../src/solver/physical';
import { nextDown, nextUp } from '../../src/solver/physical/numeric';
import { HIGHS_LARGE_MATRIX_VALUE, HIGHS_SMALL_MATRIX_VALUE } from '../../src/solver/physical/proof';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-9, ...extra,
});
const run = (params: SolveParams): Promise<PreciseResult> => solvePrecise({ params, deadline: performance.now() + 120_000 });
const installed = (r: PreciseResult): string[] => (r.kind === 'build' ? r.best.build.placements.map(p => p.itemId).sort() : []);

/** The dichotomy on one point: exact, or withheld/uncertified with any published bound still valid. Returns which branch held. */
function assertExactOrWithheld(label: string, r: PreciseResult, optimum: number, optimalParts: string[], scale = 1): 'exact' | 'withheld' {
  assert.equal(r.kind, 'build', `${label}: ${r.kind}`);
  if (r.kind !== 'build') throw new Error('unreachable');
  const { upper } = r.summary.bounds;
  const slack = 1e-12 * Math.max(1, Math.abs(optimum)) * scale;
  if (upper !== null) assert.ok(upper >= optimum - slack, `${label}: a published bound ${upper} below the true optimum ${optimum}`);
  assert.ok(r.best.score <= optimum + slack, `${label}: a verified build cannot beat the optimum`);
  if (r.certified) {
    assert.deepEqual(installed(r), optimalParts, `${label}: certified, so it must be the true optimum`);
    assert.ok(Math.abs(r.best.score - optimum) <= Math.max(1e-9, slack), `${label}: certified score ${r.best.score} vs ${optimum}`);
    assert.ok(upper !== null);
    return 'exact';
  }
  return 'withheld';
}

test('item 3, small coefficients: a recoil modifier swept across small_matrix_value (1e-11 .. 1e-6, both neighbours of 1e-9): at or below the filter the proof is withheld with the reason, above it the optimum is certified exactly', async t => {
  assert.equal(HIGHS_SMALL_MATRIX_VALUE, 1e-9);
  const sweep = [1e-11, 1e-10, nextDown(1e-9), 1e-9, nextUp(1e-9), 2e-9, 1e-8, 1e-7, 1e-6];
  const rows: string[] = [];
  for (const r of sweep) {
    // `a` (recoil -r) is worth exactly 1 at this recoil weight; `b` is worth 0.5. Same optional slot: the true optimum is `a`, score 1.
    const lookup = lookupOf(gunWith(WEAPON, { slots: [slot('s', ['a', 'b'])] }), ['a', modWith('a', { ergo: 0, recoil: -r })], ['b', modWith('b', { ergo: 0.5 })]);
    const params = paramsOf(lookup, { recoilWeight: 1 / (1000 * r) });
    const result = await run(params);
    const branch = assertExactOrWithheld(`recoil ${r}`, result, 1, ['a'], 1e3);
    const telemetry = result.summary.telemetry;
    if (r <= HIGHS_SMALL_MATRIX_VALUE) {
      assert.equal(branch, 'withheld', `recoil ${r}: HiGHS dropped the coefficient`);
      assert.equal(result.summary.bounds.upper, null, `recoil ${r}: the bound is withheld, not guessed`);
      assert.ok(telemetry.unqualifiedReasons.some(x => /adjusted the model|different model/.test(x)), `recoil ${r}: ${telemetry.unqualifiedReasons.join(' | ')}`);
    } else {
      assert.equal(branch, 'exact', `recoil ${r}: the coefficient survives, so the request certifies`);
      assert.equal(telemetry.unqualifiedSolves, 0);
    }
    // the a-priori flag of the model predicts the risk conservatively (it is not the proof: the readback is)
    const blueprint = preparePhysicalWeapon(lookup, WEAPON);
    const model = specializeCount(blueprint, prepareSubproblemDomain(blueprint, lookup, params), params);
    if (r <= HIGHS_SMALL_MATRIX_VALUE) assert.equal(model.matrixFilterRisk, true, `recoil ${r}: flagged`);
    rows.push(`${r}: ${branch}${model.matrixFilterRisk ? ' (flagged)' : ''}`);
  }
  t.diagnostic(rows.join('; '));
});

/** One slot, two parts of equal ergonomics: A costs 100, B costs `pb`. A is the true optimum whenever price counts. */
const priceTie = (pb = 1000) => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('s', ['a', 'b'], true)] }),
  ['a', mod('a', { weight: 0, ergo: 5, offers: [trader('prapor', 1, 100)] })],
  ['b', mod('b', { weight: 0, ergo: 5, offers: [trader('prapor', 1, pb)] })],
);

test('item 3, very wide Tchebycheff price normalization (nadir price 1e4 .. 1e30): exact power-of-two rescaling certifies the true optimum up to 1e14, beyond that the proof is withheld at construction; never a wrong certificate', async t => {
  const rows: string[] = [];
  for (const nadP of [1e4, 1e6, 1e8, 1e10, 1e12, 1e14, 1e16, 1e20, 1e30]) {
    const ideal = { zE: 100, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP };
    const params = paramsOf(priceTie(), { priceWeight: 1, useTchebycheff: true, idealPoint: ideal });
    const result = await run(params);
    // the oracle score of `a` (ergonomics 5, spend 100 + the receiver's 5000) under this payoff table
    const optimum = 0.01 * (50 / 200 - 5100 / (2 * nadP)) - Math.max(50 / 200, 5100 / (2 * nadP));
    const branch = assertExactOrWithheld(`nadP ${nadP}`, result, optimum, ['a']);
    const blueprint = preparePhysicalWeapon(params.itemLookup, WEAPON);
    const model = specializeCount(blueprint, prepareSubproblemDomain(blueprint, params.itemLookup, params), params);
    if (nadP <= 1e14) {
      assert.equal(branch, 'exact', `nadP ${nadP}`);
      assert.equal(model.proof.withheld, null);
      if (nadP >= 1e8) assert.ok(model.proof.objective !== null && model.proof.objective.axisScales.some(s => s.exponent > 0), `nadP ${nadP}: read through a power of two`);
    } else {
      assert.equal(branch, 'withheld', `nadP ${nadP}`);
      assert.match(String(model.proof.withheld), /power-of-two|below/);
      assert.equal(result.summary.bounds.upper, null);
      assert.ok(result.summary.telemetry.unqualifiedReasons.some(x => /withheld at construction/.test(x)));
    }
    rows.push(`${nadP}: ${branch}`);
  }
  t.diagnostic(rows.join('; '));
});

test('item 3, very wide price range in the matrix (a part priced 1e6 .. just below 1e15): the cheaper part always wins; the outcome is exact or uncertified with a valid bound, and the bound-shortfall guard catches a dual bound the wide range pushed below a verified build', async t => {
  const rows: string[] = [];
  for (const pb of [1e6, 1e9, 1e12, 1e14, nextDown(HIGHS_LARGE_MATRIX_VALUE)]) {
    const result = await run(paramsOf(priceTie(pb), { priceWeight: 1 }));
    assert.equal(result.kind, 'build');
    if (result.kind !== 'build') continue;
    assert.deepEqual(installed(result), ['a'], `price ${pb}: the verified build is the cheaper part`);
    // `a` dominates `b` (same ergonomics, cheaper), so the verified build's exact score is the true optimum
    const branch = assertExactOrWithheld(`price ${pb}`, result, result.best.score, ['a']);
    rows.push(`${pb}: ${branch}, gap ${String(result.summary.bounds.gap)}, shortfall ${result.summary.telemetry.boundShortfall}, unqualified ${result.summary.telemetry.unqualifiedSolves}`);
    if (pb <= 1e9) assert.equal(branch, 'exact', `price ${pb}`);
    if (pb === 1e12) {
      // observed on the pinned build: one solve's dual bound sat 3e-9 below the exact score of the build it returned (about 3e-8 relative, far above
      // the 1e-15 noise of decision 4); the guard withheld that solve's bound and the request is not certified
      assert.equal(branch, 'withheld');
      assert.ok(result.summary.telemetry.boundShortfall > 1e-9, `shortfall ${result.summary.telemetry.boundShortfall}`);
      assert.ok(result.summary.telemetry.unqualifiedReasons.some(x => /above the node's proved upper bound/.test(x)));
    }
  }
  t.diagnostic(rows.join('; '));
});

test('item 3, at large_matrix_value: a coefficient of 1e15 is flagged on the model and HiGHS refuses the read; Precise fails loudly with a typed ModelReadError, never a result', async () => {
  for (const pb of [HIGHS_LARGE_MATRIX_VALUE, 1e16]) {
    const params = paramsOf(priceTie(pb), { priceWeight: 1 });
    const blueprint = preparePhysicalWeapon(params.itemLookup, WEAPON);
    const model = specializeCount(blueprint, prepareSubproblemDomain(blueprint, params.itemLookup, params), params);
    assert.equal(model.matrixFilterRisk, true, `price ${pb}: the model flags a coefficient at the large-value filter`);
    await assert.rejects(run(params), (error: unknown) => error instanceof ModelReadError && /greater than 1e\+15/.test(error.message), `price ${pb}`);
  }
});
