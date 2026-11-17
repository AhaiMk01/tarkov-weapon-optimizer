// Arrow-key steps on the weight triangle (src/components/ternaryKeys.ts): integer weights, total stays 100, clamping at the edges, deterministic odd points, Shift = 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepWeights, type TernaryKey, type Weights } from '../../src/components/ternaryKeys';

const w = (ergo: number, recoil: number, price: number): Weights => ({ ergo, recoil, price });
const KEYS: TernaryKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

test('Up moves one point to ergonomics, Down gives it back, Right moves price to recoil, Left the reverse', () => {
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowUp', false), w(41, 29, 30));
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowDown', false), w(39, 31, 30));
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowRight', false), w(40, 31, 29));
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowLeft', false), w(40, 29, 31));
});

test('Shift steps by 5', () => {
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowRight', true), w(40, 35, 25));
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowLeft', true), w(40, 25, 35));
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowUp', true), w(45, 27, 28), '5 from a tie: 2 + 2, the odd point from recoil');
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowDown', true), w(35, 33, 32), '5 to a tie: 2 + 2, the odd point to recoil');
});

test('an odd point comes from the larger pool going up and goes to the smaller pool going down, ties to recoil', () => {
  assert.deepEqual(stepWeights(w(40, 30, 30), 'ArrowUp', false), w(41, 29, 30), 'tie: recoil gives the odd point');
  assert.deepEqual(stepWeights(w(40, 20, 40), 'ArrowUp', false), w(41, 20, 39));
  assert.deepEqual(stepWeights(w(40, 40, 20), 'ArrowUp', true), w(45, 37, 18), '5 = 2 + 2 + odd from the larger recoil');
  assert.deepEqual(stepWeights(w(50, 30, 20), 'ArrowDown', true), w(45, 32, 23), 'odd point to the smaller price: 2 + 2 + 1');
});

test('never below 0: a short pool is topped up from the other', () => {
  assert.deepEqual(stepWeights(w(60, 0, 40), 'ArrowUp', true), w(65, 0, 35));
  assert.deepEqual(stepWeights(w(60, 1, 39), 'ArrowUp', true), w(65, 0, 35));
  assert.deepEqual(stepWeights(w(98, 1, 1), 'ArrowUp', true), w(100, 0, 0), 'only 2 points are left to take');
  assert.deepEqual(stepWeights(w(40, 3, 57), 'ArrowRight', true), w(40, 8, 52));
  assert.deepEqual(stepWeights(w(40, 57, 3), 'ArrowRight', true), w(40, 60, 0));
  assert.deepEqual(stepWeights(w(40, 3, 57), 'ArrowLeft', true), w(40, 0, 60));
  assert.deepEqual(stepWeights(w(3, 40, 57), 'ArrowDown', true), w(0, 42, 58));
});

test('a key that cannot move returns the same weights', () => {
  assert.deepEqual(stepWeights(w(100, 0, 0), 'ArrowUp', false), w(100, 0, 0));
  assert.deepEqual(stepWeights(w(0, 50, 50), 'ArrowDown', true), w(0, 50, 50));
  assert.deepEqual(stepWeights(w(40, 60, 0), 'ArrowRight', false), w(40, 60, 0));
  assert.deepEqual(stepWeights(w(40, 0, 60), 'ArrowLeft', true), w(40, 0, 60));
});

test('the total stays 100 and every weight stays an integer in [0, 100] from any start', () => {
  for (let ergo = 0; ergo <= 100; ergo += 3) {
    for (let recoil = 0; recoil <= 100 - ergo; recoil += 2) {
      const start = w(ergo, recoil, 100 - ergo - recoil);
      for (const key of KEYS) {
        for (const shift of [false, true]) {
          const next = stepWeights(start, key, shift);
          assert.equal(next.ergo + next.recoil + next.price, 100);
          for (const v of [next.ergo, next.recoil, next.price]) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${JSON.stringify(start)} ${key}`);
        }
      }
    }
  }
});
