// Stage 3 evidence, item 6 (ADR 0013 section 4C, owner decisions 4 and 5b with the 2026-10-12 correction, docs/stage3/native-evidence.md): the bound-error
// statement. What a qualified bound assumes is STATED (`NATIVE_FRAME.assumptions`), the native arithmetic noise is MEASURED (`boundShortfall`) and a
// shortfall beyond `max(tolerance, BOUND_SANITY_RELATIVE x max(1, |bound|))` WITHHOLDS the bound; each native tolerance is qualified against its own declared
// value (integrality 1e-7, primal and dual feasibility 1e-9); the integrality shift is two-sided (a raised bound costs the certificate, a lowered one below the
// guard is the accepted residual assumption); and the defect fixture `solverDefects/count_presolve_off_wrong_optimal.lp` is right under the production frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getNativeHighs, type HighsOptions, type NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { preparePhysicalWeapon, prepareSubproblemDomain, specializeCount } from '../../src/solver/physical';
import { assessNativeResult, boundEvidenceOf, NATIVE_FRAME } from '../../src/solver/physical/nativeProof';
import {
  NATIVE_FEASIBILITY_TOLERANCE, NATIVE_INTEGRALITY_TOLERANCE, nativeSolve, nativeSolveOptions, type SolveFn,
} from '../../src/solver/physical/nativeSolve';
import { EMPTY_MODEL_PROOF, HIGHS_LARGE_MATRIX_VALUE, HIGHS_SMALL_MATRIX_VALUE, upperBoundOf } from '../../src/solver/physical/proof';
import { BOUND_SANITY_RELATIVE, PRECISE_RANDOM_SEEDS, solvePrecise, type PreciseResult } from '../../src/solver/physical/solvePrecise';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { gun, gunWith, lookupOf, mod, modWith, slot, WEAPON } from './lpFixtures';

test('item 6, the stated frame: NATIVE_FRAME carries the declared tolerances and thresholds, and its assumptions state the unbounded noise, the shortfall guard, the two-sided integrality shift and the second opinion', () => {
  assert.equal(NATIVE_FRAME.primalFeasibilityTolerance, 1e-9);
  assert.equal(NATIVE_FRAME.dualFeasibilityTolerance, 1e-9);
  assert.equal(NATIVE_FRAME.mipFeasibilityTolerance, 1e-7);
  assert.equal(NATIVE_FRAME.smallMatrixValue, 1e-9);
  assert.equal(NATIVE_FRAME.largeMatrixValue, 1e15);
  assert.equal(BOUND_SANITY_RELATIVE, 1e-9);
  const text = NATIVE_FRAME.assumptions.join('\n');
  assert.match(text, /NOT added/, 'decision 4: no allowance is added for the native floating-point error');
  assert.match(text, /boundShortfall/);
  assert.match(text, /BOUND_SANITY_RELATIVE/);
  assert.match(text, /EITHER direction/, 'decision 5b correction: the integrality shift is two-sided');
  assert.match(text, /not detected/, 'the residual assumption is stated, not hidden');
  assert.match(text, /F04-near-cap-min-ergonomics-gap-2e-20/, 'the observed case is cited');
  assert.match(text, /second solve with another random seed/, 'decision 5a');
  // every request tolerance gets the same native frame: integrality 1e-7 always, feasibility 1e-9, native gap never above 1e-9
  for (const tau of [0, 1e-12, 1e-9, 1e-7, 1e-5, 1e-3, 1]) {
    const options = nativeSolveOptions(tau);
    assert.equal(options.mip_feasibility_tolerance, NATIVE_INTEGRALITY_TOLERANCE, `tau ${tau}`);
    assert.equal(options.primal_feasibility_tolerance, NATIVE_FEASIBILITY_TOLERANCE, `tau ${tau}`);
    assert.equal(options.dual_feasibility_tolerance, NATIVE_FEASIBILITY_TOLERANCE, `tau ${tau}`);
    assert.ok((options.mip_abs_gap as number) <= 1e-9 && (options.mip_abs_gap as number) <= tau / 4 + 0, `tau ${tau}`);
    assert.equal(options.mip_rel_gap, 0);
  }
});

const choiceLookup = (ergoA: number, ergoB: number): ItemLookup =>
  lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: ergoA })], ['b', mod('b', { weight: 1, ergo: ergoB })]);
const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-9, ...extra,
});

test('item 6, per-tolerance qualification on the certified count model: each native tolerance is held to its own declared value (integrality <= 1e-7, primal and dual <= 1e-9) and the matrix thresholds to theirs', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, recoilV: 100, slots: [slot('b', ['barrel']), slot('m', ['sup'])] }),
    ['barrel', modWith('barrel', { ergo: 2, coi: 0.125, recoil: -0.05 })],
    ['sup', modWith('sup', { ergo: 3, accuracy: -5, recoil: -0.1 })],
  );
  const request = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0, maxMOA: 5, maxRecoilSum: 1000, maxRecoilV: 90 } as const;
  const blueprint = preparePhysicalWeapon(lookup, WEAPON);
  const model = specializeCount(blueprint, prepareSubproblemDomain(blueprint, lookup, {}), request);
  assert.ok(model.proof.rows.length >= 2, 'constructed rows are present');
  const lp = model.lp();
  const assess = async (override: HighsOptions) => {
    const result = await nativeSolve(lp, { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 60, ...override }, { includeReadback: true });
    return assessNativeResult({ lpText: lp, proof: model.proof }, result);
  };
  const cases: [string, HighsOptions, boolean][] = [
    ['production frame', {}, true],
    ['integrality at its declared 1e-7', { mip_feasibility_tolerance: 1e-7 }, true],
    ['integrality stricter, 1e-8', { mip_feasibility_tolerance: 1e-8 }, true],
    ['integrality looser, 2e-7', { mip_feasibility_tolerance: 2e-7 }, false],
    ['integrality 1e-6', { mip_feasibility_tolerance: 1e-6 }, false],
    ['primal stricter, 1e-10', { primal_feasibility_tolerance: 1e-10 }, true],
    ['primal looser, 1e-8 (the integrality value is NOT a feasibility allowance)', { primal_feasibility_tolerance: 1e-8 }, false],
    ['dual looser, 1e-8', { dual_feasibility_tolerance: 1e-8 }, false],
    ['dual 1e-7', { dual_feasibility_tolerance: 1e-7 }, false],
    ['small_matrix_value changed', { small_matrix_value: 1e-10 }, false],
    ['large_matrix_value changed', { large_matrix_value: 1e16 }, false],
  ];
  for (const [label, override, qualified] of cases) {
    const a = await assess(override);
    assert.equal(a.qualified, qualified, `${label}: ${a.reasons.join(' | ')}`);
    assert.equal(a.readback.ok, true, `${label}: the model read is unchanged, only the frame differs`);
    if (!qualified) assert.ok(a.reasons.some(r => /tolerances in force|matrix thresholds in force/.test(r)), `${label}: ${a.reasons.join(' | ')}`);
  }
});

const built = (r: PreciseResult) => {
  assert.equal(r.kind, 'build', JSON.stringify({ kind: r.kind }));
  return r as Extract<PreciseResult, { kind: 'build' }>;
};
/** The pinned solve with every dual bound moved by `by` (positive: raised; negative: lowered), all seeds alike. */
const shifted = (by: number): SolveFn => async (lp, options, extras) => {
  const real = await nativeSolve(lp, options, extras);
  return { ...real, mipDualBound: (real.mipDualBound as number) + by } as NativeResult;
};

test('item 6, the shortfall guard at its limit max(tolerance, 1e-9 x max(1, |bound|)): just inside it the shortfall is measured and the bound kept, just outside it the bound is withheld; absolute and relative regimes', async () => {
  // the score is ergoWeight x ergonomics (ergonomics clamp at 100, so the magnitude comes from the weight)
  const cases: { label: string; ergoWeight: number; tolerance: number; limit: number }[] = [
    { label: 'absolute floor (bound 25, tolerance 1e-9)', ergoWeight: 1, tolerance: 1e-9, limit: Math.max(1e-9, 1e-9 * 25) },
    { label: 'relative (bound 2500, tolerance 1e-9)', ergoWeight: 100, tolerance: 1e-9, limit: 1e-9 * 2500 },
    { label: 'request tolerance dominates (bound 25, tolerance 1e-5)', ergoWeight: 1, tolerance: 1e-5, limit: 1e-5 },
  ];
  for (const { label, ergoWeight, tolerance, limit } of cases) {
    const ergo = 25 * ergoWeight;
    const params = paramsOf(choiceLookup(10, 25), { objectiveTolerance: tolerance, ergoWeight });
    const inside = built(await solvePrecise({ params, deadline: performance.now() + 60_000, solve: shifted(-0.8 * limit) }));
    assert.deepEqual(inside.best.build.placements.map(p => p.itemId), ['b'], label);
    assert.ok(Math.abs(inside.best.score - ergo) < 1e-12 * ergo, label);
    assert.ok(inside.summary.telemetry.boundShortfall > 0.7 * limit && inside.summary.telemetry.boundShortfall <= limit, `${label}: shortfall ${inside.summary.telemetry.boundShortfall} measured`);
    assert.ok(inside.summary.bounds.upper !== null, `${label}: kept`);
    assert.equal(inside.summary.telemetry.unqualifiedSolves, 0, label);
    // the residual assumption made concrete: a bound lowered below the exact optimum, but inside the guard, is NOT detected and the request certifies
    assert.equal(inside.certified, true, `${label}: a lowered bound inside the guard is the accepted, stated assumption`);
    // the transported upper bound includes the incumbent's upward enclosure (ADR 0013 section 4C), so it never shows below the witness
    assert.ok((inside.summary.bounds.upper as number) >= inside.best.score, `${label}: published ${String(inside.summary.bounds.upper)} vs witness ${inside.best.score}`);

    const outside = built(await solvePrecise({ params, deadline: performance.now() + 60_000, solve: shifted(-1.5 * limit) }));
    assert.deepEqual(outside.best.build.placements.map(p => p.itemId), ['b'], `${label}: the verified witness is kept`);
    assert.equal(outside.certified, false, label);
    assert.equal(outside.summary.bounds.upper, null, `${label}: withheld, transported as null`);
    assert.ok(outside.summary.telemetry.unqualifiedReasons.some(r => /above the node's proved upper bound/.test(r)), label);
    assert.ok(Math.abs(outside.summary.telemetry.boundShortfall - 1.5 * limit) <= 1e-3 * limit, `${label}: ${outside.summary.telemetry.boundShortfall}`);
  }
});

test('item 6, two-sided integrality shift, upward side: a bound raised by 1e-7 costs the certificate at a 1e-9 tolerance (feasible, honest gap) and keeps it at 1e-5; it is never a wrong claim', async () => {
  const lookup = choiceLookup(10, 25);
  const strict = built(await solvePrecise({ params: paramsOf(lookup), deadline: performance.now() + 60_000, solve: shifted(1e-7) }));
  assert.equal(strict.certified, false);
  assert.equal(strict.outcome.status, 'feasible');
  assert.ok(strict.summary.bounds.gap !== null && strict.summary.bounds.gap > 1e-9 && strict.summary.bounds.gap < 2e-7, `gap ${String(strict.summary.bounds.gap)}`);
  assert.ok((strict.summary.bounds.upper as number) >= strict.best.score);
  const loose = built(await solvePrecise({ params: paramsOf(lookup, { objectiveTolerance: 1e-5 }), deadline: performance.now() + 60_000, solve: shifted(1e-7) }));
  assert.equal(loose.certified, true);
});

test('item 6, the defect fixture count_presolve_off_wrong_optimal.lp under the production frame: every production seed returns the true optimum 100 with a dual bound of at least 100, the solve is qualified, and its bound evidence encloses the truth; production never solves at an integrality below 1e-7', async t => {
  const lp = readFileSync(fileURLToPath(new URL('./solverDefects/count_presolve_off_wrong_optimal.lp', import.meta.url)), 'utf8');
  for (const seed of PRECISE_RANDOM_SEEDS) {
    const result = await getNativeHighs().solveStructured(lp, { ...nativeSolveOptions(1e-9), presolve: 'off', random_seed: seed }, { includeReadback: true });
    assert.equal(result.modelStatus.name, 'Optimal', `seed ${seed}`);
    assert.ok(Math.abs((result.objectiveValue as number) - 100) < 1e-6, `seed ${seed}: ${result.objectiveValue}`);
    const assessment = assessNativeResult({ lpText: lp, proof: EMPTY_MODEL_PROOF }, result);
    assert.equal(assessment.qualified, true, `seed ${seed}: ${assessment.reasons.join(' | ')}`);
    const bound = upperBoundOf(boundEvidenceOf(EMPTY_MODEL_PROOF, result, assessment));
    assert.ok(bound !== null && bound >= 100 - 1e-6, `seed ${seed}: bound ${String(bound)} encloses the maximum (at least 100)`);
  }
  // At integrality 1e-9 (STRICTER than declared, so the gate calls it qualified) the default seed may return the wrong Optimal 93.6: the gate alone would not
  // catch it. What protects production is that it never solves at 1e-9 (below) and the second opinion (tests/physical/solvePrecise.secondOpinion.test.ts).
  const old = await getNativeHighs().solveStructured(lp, { ...nativeSolveOptions(1e-9), mip_feasibility_tolerance: 1e-9, presolve: 'off' }, { includeReadback: true });
  const oldAssessment = assessNativeResult({ lpText: lp, proof: EMPTY_MODEL_PROOF }, old);
  const wrong = old.modelStatus.name === 'Optimal' && (old.objectiveValue as number) < 100 - 1e-6;
  t.diagnostic(`integrality 1e-9, default seed: ${old.modelStatus.name} ${old.objectiveValue}, dual ${old.mipDualBound}, gate qualified=${oldAssessment.qualified}${wrong ? ' (WRONG optimum the gate accepts)' : ''}`);
  // production: every native solve of a request carries integrality 1e-7, whatever the request tolerance
  for (const tolerance of [1e-9, 1e-5, 1e-2]) {
    const seen: number[] = [];
    const spy: SolveFn = async (text, options, extras) => {
      const result = await nativeSolve(text, options, extras);
      seen.push(result.effectiveOptions.mip_feasibility_tolerance as number);
      return result;
    };
    await solvePrecise({ params: paramsOf(choiceLookup(10, 25), { objectiveTolerance: tolerance, useTrueErgo: true }), deadline: performance.now() + 60_000, solve: spy });
    assert.ok(seen.length >= 2 && seen.every(v => v === 1e-7), `tolerance ${tolerance}: ${seen.join(',')}`);
  }
});

test('item 6, the matrix thresholds production declares are the ones HiGHS holds on every solve', async () => {
  const result = await nativeSolve('Maximize\n obj: x\nSubject To\n c: x <= 1\nEnd\n', { ...nativeSolveOptions(1e-9), presolve: 'off' });
  assert.equal(result.effectiveOptions.small_matrix_value, HIGHS_SMALL_MATRIX_VALUE);
  assert.equal(result.effectiveOptions.large_matrix_value, HIGHS_LARGE_MATRIX_VALUE);
});

test('item 6, defence in depth (REPORTED, not fixed: production code is out of scope for this workstream): the gate accepts any integrality tolerance at or below 1e-7, so a solve at the defect-prone 1e-9 is called qualified', { todo: 'decision 5b says integrality is always 1e-7; assessNativeResult accepts a stricter value ("a stricter one is fine"), which is exactly the setting under which count_presolve_off_wrong_optimal.lp returns a wrong Optimal with a wrong bound. Production never solves at 1e-9 (nativeSolveOptions pins 1e-7 and nativeStop admits only mip_max_improving_sols), so this is not a live defect; owner to decide whether the gate should require exactly 1e-7' }, async () => {
  const lp = readFileSync(fileURLToPath(new URL('./solverDefects/count_presolve_off_wrong_optimal.lp', import.meta.url)), 'utf8');
  const old = await getNativeHighs().solveStructured(lp, { ...nativeSolveOptions(1e-9), mip_feasibility_tolerance: 1e-9, presolve: 'off' }, { includeReadback: true });
  const assessment = assessNativeResult({ lpText: lp, proof: EMPTY_MODEL_PROOF }, old);
  assert.equal(assessment.qualified, false, 'a solve outside the declared integrality frame should not be qualified');
});
