// Exact rational arithmetic of the physical validator (ADR 0010 section 2, INTERPRETATIONS.md choice 3): every finite binary64 leaf denotes
// the exact value of its double, sums and comparisons are exact, and a result converts back to the nearest double.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RAT_ONE, RAT_ZERO, rat, ratAdd, ratCmp, ratDiv, ratFromDouble, ratMax, ratMin, ratMul, ratRoundHalfUp, ratString, ratSub, ratSum, ratToNumber,
} from '../../src/solver/physical/exact';

test('a double decodes to its exact value, not to its decimal spelling', () => {
  const tenth = ratFromDouble(0.2);
  assert.equal(tenth.n, 3602879701896397n);
  assert.equal(tenth.d, 1n << 54n);
  assert.equal(ratString(ratFromDouble(0.0155)), '1116892707587883/72057594037927936');
  assert.equal(ratString(ratFromDouble(-0.5)), '-1/2');
  assert.equal(ratString(ratFromDouble(0)), '0');
  assert.equal(ratString(ratFromDouble(-0)), '0');
  assert.equal(ratString(ratFromDouble(3)), '3');
  assert.equal(ratString(ratFromDouble(2 ** 70)), (2n ** 70n).toString());
  assert.ok(ratFromDouble(5e-324).d === 1n << 1074n, 'the smallest subnormal');
});

test('non-finite doubles are rejected', () => {
  for (const x of [Number.NaN, Infinity, -Infinity]) assert.throws(() => ratFromDouble(x), RangeError);
});

test('0.1 + 0.2 is not 0.3 exactly, and the sum is exact', () => {
  const sum = ratAdd(ratFromDouble(0.1), ratFromDouble(0.2));
  assert.equal(ratCmp(sum, ratFromDouble(0.3)), 1, 'the exact sum is a hair above the double 0.3');
  assert.equal(ratCmp(sum, ratFromDouble(0.1 + 0.2)), -1, 'and a hair below the rounded double sum');
  assert.equal(ratSum([]).n, 0n);
  assert.equal(ratString(ratSum([rat(1n, 2n), rat(1n, 3n), rat(1n, 6n)])), '1');
});

test('arithmetic normalizes: denominators positive, fractions in lowest terms', () => {
  assert.equal(ratString(rat(6n, -4n)), '-3/2');
  assert.equal(ratString(ratMul(rat(2n, 3n), rat(3n, 4n))), '1/2');
  assert.equal(ratString(ratDiv(rat(1n), rat(-3n))), '-1/3');
  assert.equal(ratString(ratSub(rat(1n, 3n), rat(1n, 3n))), '0');
  assert.throws(() => ratDiv(RAT_ONE, RAT_ZERO), RangeError);
  assert.throws(() => rat(1n, 0n), RangeError);
});

test('comparisons and min/max', () => {
  assert.equal(ratCmp(rat(1n, 3n), rat(2n, 6n)), 0);
  assert.equal(ratCmp(rat(-1n, 3n), rat(0n)), -1);
  assert.equal(ratString(ratMin(rat(1n, 3n), rat(1n, 2n))), '1/3');
  assert.equal(ratString(ratMax(rat(1n, 3n), rat(1n, 2n))), '1/2');
});

test('floor(x + 1/2) rounds half up, including negatives and exact halves', () => {
  assert.equal(ratString(ratRoundHalfUp(rat(5n, 2n))), '3');
  assert.equal(ratString(ratRoundHalfUp(rat(1n, 2n))), '1');
  assert.equal(ratString(ratRoundHalfUp(rat(14999n, 10000n))), '1');
  assert.equal(ratString(ratRoundHalfUp(rat(-1n, 2n))), '0');
  assert.equal(ratString(ratRoundHalfUp(rat(-3n, 2n))), '-1');
  assert.equal(ratString(ratRoundHalfUp(rat(0n))), '0');
});

test('conversion back to a double is the nearest double', () => {
  for (const x of [0.1, 0.2, 0.3, 1 / 3, 2 / 3, -7.52, 25.02, 155.1, 1e-300, 123456789.12345679, 5e-324, Number.MAX_VALUE, 2 ** -1022]) {
    assert.equal(ratToNumber(ratFromDouble(x)), x, `round trip ${x}`);
  }
  assert.equal(ratToNumber(rat(1n, 3n)), 1 / 3);
  assert.equal(ratToNumber(rat(2n, 3n)), 2 / 3);
  assert.equal(ratToNumber(rat(1000000n, 29089n)), 1000000 / 29089, 'K of ADR 0006');
  assert.equal(ratToNumber(rat(-22n, 7n)), -22 / 7);
  assert.equal(ratToNumber(RAT_ZERO), 0);
  assert.equal(ratToNumber(rat(10n ** 400n)), Infinity, 'beyond the double range');
});

test('the exact sum of many doubles is the true sum, which a running double sum is not', () => {
  const xs = Array.from({ length: 1000 }, () => 0.1);
  const exact = ratSum(xs.map(ratFromDouble));
  const running = xs.reduce((a, b) => a + b, 0);
  assert.notEqual(running, 100, 'the running double sum drifts');
  assert.equal(ratToNumber(exact), 100, 'the exact sum 100.0000000000000055... is nearest the double 100');
  assert.equal(ratCmp(exact, rat(100n)), 1, 'but it is exactly above 100');
});
