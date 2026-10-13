import { test } from 'node:test';
import assert from 'node:assert/strict';
import { q, mul, eq, fromBinary64, toNumber } from './q';
import * as c from './constants';

test('declared constants are exact rationals', () => {
  assert.deepEqual(c.ERGO_SCALE, q(10));
  assert.deepEqual(c.SCALE, q(1000));
  assert.deepEqual(c.AUGMENTATION, q(1, 100));
  assert.deepEqual(c.MOA_K, q(1000000, 29089));
  assert.deepEqual(c.TED_FREE_WEIGHT_KG, q(3));
});

test('MOA_K is 100 / 2.9089 and not a binary64 decimal approximation', () => {
  assert.ok(eq(mul(c.MOA_K, q(29089, 10000)), q(100)));
  assert.ok(!eq(c.MOA_K, fromBinary64(100 / 2.9089)));
  assert.ok(Math.abs(toNumber(c.MOA_K) - 34.377256007) < 1e-8);
  // the production literal 34.3 is a known defect and must not be what we declare
  assert.ok(!eq(c.MOA_K, fromBinary64(34.3)));
});

test('AUGMENTATION is exactly one hundredth, not the double 0.01', () => {
  assert.ok(!eq(c.AUGMENTATION, fromBinary64(0.01)));
});

test('TED weight penalty constants encode q(W) = 100 - 300/W above 3 kg', () => {
  assert.deepEqual(c.TED_PENALTY_CAP, q(100));
  assert.deepEqual(c.TED_PENALTY_NUMERATOR, q(300));
  assert.deepEqual(c.TED_FREE_WEIGHT_KG, q(3));
  // continuity at the threshold: 100 - 300/3 = 0
  assert.ok(eq(c.TED_PENALTY_CAP, mul(c.TED_PENALTY_NUMERATOR, q(1, 3))));
});

test('operational integer constants', () => {
  assert.equal(c.TRADER_DISABLED, 0);
  assert.equal(c.DEFAULT_TRADER_LEVEL, 4);
  assert.equal(c.OWNED_ITEMS_MAX, 10000);
  assert.deepEqual(c.ERGO_CLAMP_MIN, q(0));
  assert.deepEqual(c.ERGO_CLAMP_MAX, q(100));
});
