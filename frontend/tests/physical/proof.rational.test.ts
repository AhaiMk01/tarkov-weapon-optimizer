// The directed-rounding foundation of the proof layer (src/solver/physical/rational.ts, numeric.ts): a rational is rounded to a double by an
// EXACT comparison, never by a platform rounding mode, and a padded right-hand side is derived from the exact need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rat, ratCmp, ratFromDouble, ratAdd, ratSub, ratToNumber, type Rat } from '../../src/solver/physical/exact';
import {
  ratAbs, ratFromString, ratMagnitude, ratRoundDown, ratRoundUp, ratRepresentationError,
} from '../../src/solver/physical/rational';
import { addDown, addUp, gapUpward, nextDown, nextUp, subDown, subUp } from '../../src/solver/physical/numeric';
import { paddedRhs, bigMOf, MIN_SURVIVING_COEFFICIENT } from '../../src/solver/physical/proof';

/** A deterministic generator: the tests are seeded, never random. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const exactSum = (a: number, b: number): Rat => ratAdd(ratFromDouble(a), ratFromDouble(b));

test('ratRoundDown and ratRoundUp are the neighbouring doubles of a rational, exact when it is representable', () => {
  const third = rat(1n, 3n);
  const down = ratRoundDown(third);
  const up = ratRoundUp(third);
  assert.ok(ratCmp(ratFromDouble(down), third) < 0 && ratCmp(ratFromDouble(up), third) > 0);
  assert.equal(up, nextUp(down), 'no double lies between them');
  assert.equal(ratRoundDown(rat(1n, 4n)), 0.25);
  assert.equal(ratRoundUp(rat(1n, 4n)), 0.25);
  assert.equal(ratRoundDown(rat(0n)), 0);
  assert.equal(Object.is(ratRoundUp(rat(0n)), 0), true, 'zero is +0, not -0');
  // negative values round the same way: down is more negative
  const minusThird = rat(-1n, 3n);
  assert.ok(ratRoundDown(minusThird) < -1 / 3 + 1e-18 && ratCmp(ratFromDouble(ratRoundDown(minusThird)), minusThird) < 0);
  assert.equal(ratRoundUp(minusThird), nextUp(ratRoundDown(minusThird)));
});

test('directed rounding of a rational agrees with a brute-force bracket over seeded cases, extremes and denormals included', () => {
  const next = lcg(20260410);
  const cases: Rat[] = [rat(1n, 10n), rat(-7n, 3n), rat(1n, 1n << 1074n), rat(3n, 1n << 1075n), rat(1000000n, 29089n), rat((1n << 53n) + 1n), rat(-(1n << 60n) - 1n)];
  for (let k = 0; k < 400; k++) {
    const n = BigInt(Math.floor(next() * 2 ** 40) - 2 ** 39);
    const d = BigInt(1 + Math.floor(next() * 2 ** 30));
    cases.push(rat(n, d));
  }
  for (const value of cases) {
    const down = ratRoundDown(value);
    const up = ratRoundUp(value);
    assert.ok(ratCmp(ratFromDouble(down), value) <= 0, `${value.n}/${value.d}: down is at most the value`);
    assert.ok(ratCmp(ratFromDouble(up), value) >= 0, `${value.n}/${value.d}: up is at least the value`);
    assert.ok(ratCmp(ratFromDouble(nextUp(down)), value) > 0 || down === up, `${value.n}/${value.d}: down is the LARGEST double at most the value`);
    assert.ok(ratCmp(ratFromDouble(nextDown(up)), value) < 0 || down === up, `${value.n}/${value.d}: up is the SMALLEST double at least the value`);
    assert.ok(up === down || up === nextUp(down));
    const nearest = ratToNumber(value);
    assert.ok(nearest === down || nearest === up, 'the nearest double is one of the two');
  }
});

test('a rational beyond the finite doubles is not silently turned into an infinity', () => {
  const huge = rat(1n << 1100n);
  assert.throws(() => ratRoundUp(huge), RangeError);
  assert.equal(ratRoundDown(huge), Number.MAX_VALUE, 'the largest double is still at most the value');
  assert.throws(() => ratRoundDown(rat(-(1n << 1100n))), RangeError);
});

test('canonical rational text round-trips and anything else is refused', () => {
  assert.deepEqual(ratFromString('5'), rat(5n));
  assert.deepEqual(ratFromString('-7/3'), rat(-7n, 3n));
  assert.deepEqual(ratFromString('0'), rat(0n));
  for (const bad of ['', '1.5', '1/', '/2', '1/-2', ' 3', 'abc']) assert.throws(() => ratFromString(bad), RangeError, bad);
});

test('the representation error of a double and the magnitude bound of a domain are exact', () => {
  // 0.1 is above 1/10 by exactly 0.1 - 1/10 = 1/18014398509481984 (2^-54 / ... : 0.1 = 3602879701896397 / 2^55)
  const error = ratRepresentationError(0.1, rat(1n, 10n));
  assert.deepEqual(error, rat(1n, 180143985094819840n));
  assert.deepEqual(ratAbs(rat(-3n, 4n)), rat(3n, 4n));
  assert.deepEqual(ratMagnitude(-5, 3), ratFromDouble(5));
  assert.deepEqual(ratMagnitude(-2, 7), ratFromDouble(7));
});

test('directed addition and subtraction bracket the exact result and do not widen an exact one', () => {
  const next = lcg(77);
  const check = (a: number, b: number): void => {
    const exact = exactSum(a, b);
    const up = addUp(a, b);
    const down = addDown(a, b);
    assert.ok(ratCmp(ratFromDouble(up), exact) >= 0 && ratCmp(ratFromDouble(down), exact) <= 0, `${a} + ${b}`);
    if (ratCmp(ratFromDouble(a + b), exact) === 0) {
      assert.equal(up, a + b);
      assert.equal(down, a + b);
    } else {
      assert.equal(up, nextUp(down), `${a} + ${b}: inexact sums are bracketed by neighbours`);
    }
    assert.equal(subUp(a, b), addUp(a, -b));
    assert.equal(subDown(a, b), addDown(a, -b));
  };
  check(0.1, 0.2);
  check(1, 2 ** -60);
  check(1e16, 1);
  check(-3, 3);
  check(0, 0);
  check(2500, -2499.999999999995);
  for (let k = 0; k < 500; k++) check((next() - 0.5) * 10 ** Math.floor(next() * 12), (next() - 0.5) * 10 ** Math.floor(next() * 12));
});

test('a gap is rounded up, never negative, and an unknown end is an unbounded gap, not zero', () => {
  assert.equal(gapUpward(5, 3), 2);
  assert.equal(gapUpward(1 + 2 ** -52, 1), 2 ** -52, 'an exact difference is not widened');
  const gap = gapUpward(1, 0.1);
  assert.ok(ratCmp(ratFromDouble(gap), ratSub(ratFromDouble(1), ratFromDouble(0.1))) >= 0 && gap === nextUp(1 - 0.1) || gap === 1 - 0.1, 'an inexact difference is rounded up');
  assert.ok(gapUpward(0.3, 0.1 + 0.2) >= 0);
  assert.equal(gapUpward(3, 5), 0, 'an upper end below the lower end is a zero gap');
  assert.equal(gapUpward(Infinity, 1), Infinity);
  assert.equal(gapUpward(1, Infinity), Infinity);
  assert.equal(gapUpward(Number.NaN, 1), Infinity);
});

test('a padded right-hand side is the exact need rounded outward: for >= the largest double at most target minus deficit, for <= the smallest at least target plus deficit', () => {
  const one = ratFromDouble(1);
  // a coefficient emitted 1 ulp above its target costs deficit = ulp x magnitude
  const target = rat(1n, 3n);
  const emitted = ratRoundUp(target);
  const magnitude = ratFromDouble(100);
  const deficit = ratMulExact(ratRepresentationError(emitted, target), magnitude);
  const rhsTarget = rat(7n, 10n);
  const ge = paddedRhs('>=', rhsTarget, [{ target, emitted, magnitude }]);
  assert.ok(ratCmp(ratFromDouble(ge.emitted), ratSub(rhsTarget, deficit)) <= 0, '>= moves down by at least the deficit');
  assert.ok(ratCmp(ratFromDouble(nextUp(ge.emitted)), ratSub(rhsTarget, deficit)) > 0, 'and by no more than one ulp beyond it');
  assert.ok(ge.coefficientError >= Number(deficit.n) / Number(deficit.d) && ge.allowance >= ge.coefficientError);
  const le = paddedRhs('<=', rhsTarget, [{ target, emitted, magnitude }]);
  assert.ok(ratCmp(ratFromDouble(le.emitted), ratAdd(rhsTarget, deficit)) >= 0, '<= moves up by at least the deficit');
  assert.ok(ratCmp(ratFromDouble(nextDown(le.emitted)), ratAdd(rhsTarget, deficit)) < 0);
  // exact coefficients and a representable right-hand side need no padding at all
  const none = paddedRhs('>=', ratFromDouble(2.5), [{ target: one, emitted: 1, magnitude }]);
  assert.equal(none.emitted, 2.5);
  assert.equal(none.coefficientError, 0);
  assert.equal(none.allowance, 0);
  // a right-hand side that is not a double is rounded in the relaxing direction even with exact coefficients
  assert.equal(paddedRhs('>=', rat(1n, 10n), []).emitted, ratRoundDown(rat(1n, 10n)));
  assert.equal(paddedRhs('<=', rat(1n, 10n), []).emitted, ratRoundUp(rat(1n, 10n)));
});

test('the Big-M of a row is the smallest double that dominates the exact need, raised to a surviving size when positive, and zero when none is needed', () => {
  const K = 1000000 / 29089;
  // coi 1/16 gives 2.149 MOA, accuracy range [-10, 0]: worst MOA 2.149 x 1.1 = 2.364; against a cap 2: M = 0.364...
  const m = bigMOf(0.0625, 2, { lo: -10, hi: 0 });
  assert.ok(Math.abs(m - (0.0625 * K * 1.1 - 2)) < 1e-12);
  // the cap above every MOA: nothing is needed
  assert.equal(bigMOf(0.0625, 10, { lo: -10, hi: 0 }), 0);
  // a cap a hair below the worst MOA: M is positive but tiny, so it is raised to the surviving floor (HiGHS would drop anything at or below 1e-9)
  const tiny = bigMOf(0.0625, 0.0625 * K * 1.1 - 1e-12, { lo: -10, hi: 0 });
  assert.equal(tiny, MIN_SURVIVING_COEFFICIENT);
  // a negative centre of impact is worst at the TOP of the accuracy range
  assert.ok(bigMOf(-0.5, -17, { lo: -10, hi: 10 }) > 0);
});

/** Exact product of two rationals (kept local: the test names the operation it checks). */
function ratMulExact(a: Rat, b: Rat): Rat {
  return rat(a.n * b.n, a.d * b.d);
}
