// Stage 3 evidence, item 2 (ADR 0013 section 4B, docs/stage3/native-evidence.md): primal values, the objective and the MIP dual bound are read from the
// native structure at full binary64 precision, never through a text round trip. A value that `toFixed(6)` (the pre-cutover reader) or HiGHS's six-digit
// pretty print would change survives bit for bit, and production Precise certifies at 1e-9 a request whose certificate the rounded value would break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNativeHighs } from '../../src/solver/native';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { nativeSolve, nativeSolveOptions, type SolveFn } from '../../src/solver/physical/nativeSolve';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import type { SolveParams } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';

/** What the pre-cutover text reader did to every value: six decimals. */
const viaText = (v: number): number => Number(v.toFixed(6));

const C_INT = 0.1234567890123;
const C_CONT = 0.3333333333333333;
const Z_UPPER = 0.987654321987;
/** maximize C_INT n + C_CONT z, n integer in [0, 3], z in [0, Z_UPPER]: optimum 3 C_INT + C_CONT Z_UPPER, a value with no short decimal form. */
const MIXED_LP = `Maximize\n obj: ${C_INT} n + ${C_CONT} z\nSubject To\n c1: n + z <= 10\nBounds\n 0 <= n <= 3\n 0 <= z <= ${Z_UPPER}\nGeneral\n n\nEnd\n`;

test('item 2, native: column values, the objective and the MIP dual bound come back as the exact doubles; the text reading would have moved each by more than 1e-7', async () => {
  const result = await getNativeHighs().solveStructured(MIXED_LP, { ...nativeSolveOptions(1e-9), presolve: 'off' });
  assert.equal(result.modelStatus.name, 'Optimal');
  assert.equal(result.model.isMip, true);
  assert.ok(result.colValues instanceof Float64Array, 'a typed binary64 array, not parsed text');
  const z = result.colValues[result.colIndexByName.get('z') as number];
  const n = result.colValues[result.colIndexByName.get('n') as number];
  assert.equal(z, Z_UPPER, 'the continuous value is the exact double of its bound');
  assert.equal(n, 3);
  assert.ok(Math.abs(viaText(z) - z) > 1e-7, 'toFixed(6) would have moved it');

  const exact = 3 * C_INT + C_CONT * Z_UPPER;
  const objective = result.objectiveValue as number;
  const dual = result.mipDualBound as number;
  assert.ok(Math.abs(objective - exact) <= 4 * Number.EPSILON * exact, `objective ${objective} vs ${exact}`);
  assert.ok(dual >= objective, 'a maximization dual bound is at least its incumbent');
  assert.ok(dual - objective <= 1e-9, `dual bound ${dual} is the proved optimum at full precision`);
  assert.ok(Math.abs(viaText(dual) - dual) > 1e-7, `the dual bound ${dual} has digits a six-decimal reading loses`);
  assert.ok(viaText(dual) < objective, 'read through text, this dual bound would fall BELOW the incumbent it bounds: a contradiction the structured value never shows');
  assert.equal(result.mipAbsoluteGap, Math.abs(dual - objective), 'the gap is computed from the two structured values');
});

const paramsOf = (extra: Partial<SolveParams> = {}): SolveParams => {
  // one required slot: `a` (ergonomics 0.123456789, no short decimal) or `b` (0.1); the optimum is `a`.
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('s', ['a', 'b'], true)] }), ['a', mod('a', { weight: 0.5, ergo: 0.123456789 })], ['b', mod('b', { weight: 0.5, ergo: 0.1 })]);
  return { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-9, ...extra };
};
const built = (r: PreciseResult) => {
  assert.equal(r.kind, 'build');
  return r as Extract<PreciseResult, { kind: 'build' }>;
};

test('item 2, production: Precise certifies at 1e-9 from structured values; the bound and the score it publishes carry digits that toFixed(6) would round past the tolerance', async () => {
  const seen: NativeResult[] = [];
  const spy: SolveFn = async (lp, options, extras) => {
    const result = await nativeSolve(lp, options, extras);
    seen.push(result);
    return result;
  };
  const result = built(await solvePrecise({ params: paramsOf(), deadline: performance.now() + 60_000, solve: spy }));
  assert.equal(result.certified, true);
  assert.deepEqual(result.best.build.placements.map(p => p.itemId), ['a']);
  const { lower, upper, gap } = result.summary.bounds;
  assert.ok(lower !== null && upper !== null && gap !== null);
  assert.ok(gap <= 1e-9, `gap ${gap}`);
  assert.ok(Math.abs(result.best.score - 0.123456789) < 1e-15, `score ${result.best.score}`);
  // the tolerance is 1e-9: a six-decimal reading of either side would put them 2.1e-7 apart (uncertifiable) or the bound below the witness
  assert.ok(Math.abs(viaText(upper) - upper) > 1e-9 && Math.abs(viaText(result.best.score) - result.best.score) > 1e-9);
  assert.ok(Math.abs(viaText(upper) - lower) > 1e-9, 'with text-rounded values this certificate would not exist');
  // what the pipeline consumed: the structured arrays and the structured dual bound of every solve
  assert.ok(seen.length >= 2, 'the solve and its second opinion');
  for (const r of seen) {
    assert.ok(r.colValues instanceof Float64Array);
    assert.equal(typeof r.mipDualBound, 'number');
    assert.ok(Math.abs(viaText(r.mipDualBound as number) - (r.mipDualBound as number)) > 1e-9, `dual bound ${String(r.mipDualBound)} at full precision`);
  }
  assert.ok(upper >= Math.max(...seen.map(r => r.mipDualBound as number)) - 1e-15, 'the published bound is the largest structured dual bound (plus its proved frame error)');
});

test('item 2, production: the pipeline never reads the printed solution: a garbled HiGHS log changes nothing, a text-rounded structured dual bound costs the certificate', async () => {
  const garbledText: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, { ...extras, captureLog: true });
    return { ...real, log: ['Objective value 999', 'Primal solution: n_1 = 7'], readMessages: real.readMessages } as NativeResult;
  };
  const honest = built(await solvePrecise({ params: paramsOf(), deadline: performance.now() + 60_000 }));
  const logged = built(await solvePrecise({ params: paramsOf(), deadline: performance.now() + 60_000, solve: garbledText }));
  assert.equal(logged.certified, true);
  assert.equal(logged.best.score, honest.best.score);
  assert.deepEqual(logged.summary.bounds, honest.summary.bounds);
  // one structured value: the dual bound lowered by 2e-7 (what a six-digit reading would do): the bound-shortfall guard sees it and withholds the bound
  const rounded: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    return { ...real, mipDualBound: viaText(real.mipDualBound as number) } as NativeResult;
  };
  const wrong = built(await solvePrecise({ params: paramsOf(), deadline: performance.now() + 60_000, solve: rounded }));
  // toFixed(6) of 0.123456789... rounds UP to 0.123457: a bound 2.1e-7 high, so the gap exceeds 1e-9 and the request is not certified
  assert.equal(wrong.certified, false, 'a text-rounded bound costs the certificate at the 1e-9 tolerance');
  assert.ok(wrong.summary.bounds.upper === null || wrong.summary.bounds.upper >= wrong.best.score, 'and never publishes a bound below the witness');
});
