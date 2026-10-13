// The power-of-two read-through precondition (count-model proof section 3.3, review GAP 8a): an objective axis whose coefficient HiGHS would filter is
// read through `column_n = column / 2^k`, and the proof needs that division EXACT at both ends of the axis range (and the coefficient product `c 2^k`
// exact). It is now asserted (`readThroughRange`, `exactPowerOfTwoProduct` in src/solver/physical/specializeFast.ts): a range that underflows throws the
// internal `INEXACT_READ_THROUGH` error instead of giving a scaled column a domain that could exclude a build's value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalModelError } from '../../src/solver/physical/errors';
import { exactPowerOfTwoProduct, readThroughRange } from '../../src/solver/physical/specializeFast';

const inexact = (error: unknown): boolean => error instanceof PhysicalModelError && error.code === 'INEXACT_READ_THROUGH';

test('the read-through range round-trips exactly on game magnitudes and is returned scaled', () => {
  assert.deepEqual(readThroughRange({ lo: -1234.5678, hi: 9.87e6 }, 2 ** 20, 'price_axis'), { lo: -1234.5678 / 2 ** 20, hi: 9.87e6 / 2 ** 20 });
  assert.deepEqual(readThroughRange({ lo: 0, hi: 1e-290 }, 2 ** 40, 'rec_axis'), { lo: 0, hi: 1e-290 / 2 ** 40 }, 'tiny but normal after scaling: exact');
  assert.equal(exactPowerOfTwoProduct(3.14e-12, 2 ** 30, 'ergo_axis'), 3.14e-12 * 2 ** 30);
});

test('a range endpoint that underflows when divided by 2^k is an internal error, never a silent domain', () => {
  const subnormal = 3 * Number.MIN_VALUE; // 3 x 2^-1074: dividing by 4 cannot be exact
  assert.throws(() => readThroughRange({ lo: subnormal, hi: 1 }, 4, 'rec_axis'), inexact);
  assert.throws(() => readThroughRange({ lo: -1, hi: 2 ** -1000 }, 2 ** 80, 'price_axis'), inexact, 'a normal endpoint pushed below 2^-1074 loses bits');
  assert.throws(() => readThroughRange({ lo: Number.NaN, hi: 1 }, 2, 'ergo_axis'), inexact);
});

test('a coefficient product that overflows or underflows is an internal error', () => {
  assert.throws(() => exactPowerOfTwoProduct(Number.MAX_VALUE, 4, 'price_axis'), inexact);
  assert.throws(() => exactPowerOfTwoProduct(3 * Number.MIN_VALUE, 0.25, 'price_axis'), inexact);
});
