import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  q, fromBinary64, parseQ, add, sub, mul, div, neg, abs, sum, cmp, eq, lt, le, gt, ge, min, max,
  floorQ, ceilQ, roundHalfUp, isInteger, sign, toString, toNumber, ZERO, ONE,
} from './q';

test('q normalizes sign and gcd', () => {
  const x = q(6, -8);
  assert.equal(x.n, -3n);
  assert.equal(x.d, 4n);
  assert.equal(q(0, 5).d, 1n);
  assert.equal(q(0, -5).n, 0n);
  assert.ok(eq(q(2, 4), q(1, 2)));
});

test('q rejects non-integer number inputs and zero denominators', () => {
  assert.throws(() => q(0.5), RangeError);
  assert.throws(() => q(1, 0), RangeError);
  assert.throws(() => q(NaN), RangeError);
  assert.throws(() => q(1n, 0n), RangeError);
});

test('fromBinary64 decodes the exact binary value', () => {
  const x = fromBinary64(0.35);
  assert.equal(x.n, 3152519739159347n);
  assert.equal(x.d, 9007199254740992n);
  assert.deepEqual(fromBinary64(0.5), q(1, 2));
  assert.deepEqual(fromBinary64(-0.75), q(-3, 4));
  assert.deepEqual(fromBinary64(3), q(3));
  assert.deepEqual(fromBinary64(-0), ZERO);
  assert.deepEqual(fromBinary64(0), ZERO);
});

test('fromBinary64 decodes subnormals and large magnitudes exactly', () => {
  const tiny = fromBinary64(Number.MIN_VALUE);
  assert.equal(tiny.n, 1n);
  assert.equal(tiny.d, 1n << 1074n);
  const big = fromBinary64(2 ** 100);
  assert.equal(big.n, 1n << 100n);
  assert.equal(big.d, 1n);
  const maxNormal = fromBinary64(Number.MAX_VALUE);
  assert.equal(maxNormal.d, 1n);
  assert.equal(maxNormal.n, ((1n << 53n) - 1n) << 971n);
});

test('fromBinary64 throws on non-finite input', () => {
  assert.throws(() => fromBinary64(NaN), RangeError);
  assert.throws(() => fromBinary64(Infinity), RangeError);
  assert.throws(() => fromBinary64(-Infinity), RangeError);
});

test('binary64 0.1 + 0.2 is not the rational 3/10, and neither is 0.3', () => {
  assert.ok(!eq(fromBinary64(0.1 + 0.2), q(3, 10)));
  assert.ok(!eq(fromBinary64(0.3), q(3, 10)));
  assert.ok(!eq(fromBinary64(0.1 + 0.2), fromBinary64(0.3)));
  // exact rational addition of the two decoded leaves is a third distinct value
  const exactSum = add(fromBinary64(0.1), fromBinary64(0.2));
  assert.ok(!eq(exactSum, q(3, 10)));
});

test('arithmetic is exact', () => {
  assert.deepEqual(add(q(1, 3), q(1, 6)), q(1, 2));
  assert.deepEqual(sub(q(1, 3), q(1, 2)), q(-1, 6));
  assert.deepEqual(mul(q(2, 3), q(9, 4)), q(3, 2));
  assert.deepEqual(div(q(2, 3), q(4, 9)), q(3, 2));
  assert.deepEqual(div(q(1), q(-3)), q(-1, 3));
  assert.deepEqual(neg(q(-5, 7)), q(5, 7));
  assert.deepEqual(abs(q(-5, 7)), q(5, 7));
  assert.deepEqual(sum([q(1, 2), q(1, 3), q(1, 6)]), ONE);
  assert.deepEqual(sum([]), ZERO);
});

test('division by zero throws', () => {
  assert.throws(() => div(ONE, ZERO), RangeError);
  assert.throws(() => div(ZERO, ZERO), RangeError);
});

test('comparison and extrema', () => {
  assert.equal(cmp(q(1, 3), q(1, 2)), -1);
  assert.equal(cmp(q(1, 2), q(1, 2)), 0);
  assert.equal(cmp(q(-1, 2), q(-1, 3)), -1);
  assert.equal(cmp(q(5), q(-5)), 1);
  assert.ok(lt(q(1, 3), q(1, 2)) && le(q(1, 2), q(1, 2)) && gt(q(2), q(1)) && ge(q(2), q(2)));
  assert.deepEqual(min(q(1, 3), q(1, 2)), q(1, 3));
  assert.deepEqual(max(q(1, 3), q(1, 2)), q(1, 2));
  assert.equal(sign(q(-1, 9)), -1);
  assert.equal(sign(ZERO), 0);
  assert.equal(sign(q(1, 9)), 1);
});

test('floor, ceil and roundHalfUp including negatives and exact halves', () => {
  assert.deepEqual(floorQ(q(7, 2)), q(3));
  assert.deepEqual(floorQ(q(-7, 2)), q(-4));
  assert.deepEqual(floorQ(q(4)), q(4));
  assert.deepEqual(floorQ(q(-4)), q(-4));
  assert.deepEqual(ceilQ(q(7, 2)), q(4));
  assert.deepEqual(ceilQ(q(-7, 2)), q(-3));
  assert.deepEqual(roundHalfUp(q(5, 2)), q(3)); // 2.5 -> 3, not banker's rounding
  assert.deepEqual(roundHalfUp(q(3, 2)), q(2));
  assert.deepEqual(roundHalfUp(q(499, 1000)), q(0));
  assert.deepEqual(roundHalfUp(q(-1, 2)), q(0)); // floor(-1/2 + 1/2) = 0
  assert.deepEqual(roundHalfUp(q(-3, 2)), q(-1));
  assert.ok(isInteger(q(6, 3)));
  assert.ok(!isInteger(q(7, 3)));
});

test('toString round-trips through parseQ', () => {
  assert.equal(toString(q(3)), '3');
  assert.equal(toString(q(-3, 6)), '-1/2');
  assert.deepEqual(parseQ('3152519739159347/9007199254740992'), fromBinary64(0.35));
  assert.deepEqual(parseQ('-7'), q(-7));
  assert.throws(() => parseQ('1/0'), RangeError);
  assert.throws(() => parseQ('abc'), RangeError);
});

test('toNumber is approximate and display-only', () => {
  assert.equal(toNumber(q(1, 2)), 0.5);
  assert.equal(toNumber(fromBinary64(0.35)), 0.35);
  assert.equal(toNumber(q(-7, 4)), -1.75);
  assert.ok(Math.abs(toNumber(q(1, 3)) - 1 / 3) < 1e-15);
  assert.equal(toNumber(ZERO), 0);
});
