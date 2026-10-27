/**
 * The Fast TED default tolerance (owner decision 2026-10-27, `resolveFastTolerance`): which requests get it, how large it is, and that a Fast TED solve runs
 * HiGHS at the uncapped native gap while every other solve keeps the capped one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HighsOptions } from '../../src/solver/native';
import { fastTedNativeSolveOptions, nativeSolve, nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { FAST_TED_TCHEBYCHEFF_TOLERANCE, FAST_TED_TOLERANCE_PER_WEIGHT, resolveFastTolerance, solveFast } from '../../src/solver/physical/solveFast';
import { DEFAULT_OBJECTIVE_TOLERANCE } from '../../src/solver/physical/solvePrecise';
import { randomTedWorld, randomWorld } from './randomWorlds';

const weights = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1 };

test('a request that reads no TED keeps the shared default', () => {
  assert.deepEqual(resolveFastTolerance({ ...weights }), { tolerance: DEFAULT_OBJECTIVE_TOLERANCE, tedDefault: false });
  assert.deepEqual(resolveFastTolerance({ ...weights, useTchebycheff: true }), { tolerance: DEFAULT_OBJECTIVE_TOLERANCE, tedDefault: false });
});

test('a TED request scales its tolerance with the summed weights; Tchebycheff gets its own', () => {
  const plain = resolveFastTolerance({ ...weights, useTrueErgo: true });
  assert.equal(plain.tedDefault, true);
  assert.ok(Math.abs(plain.tolerance - FAST_TED_TOLERANCE_PER_WEIGHT * 2.1) < 1e-12);
  // The ergonomics endpoint of the payoff table: weights 100 / 0 / 0, so 0.1 TED points.
  assert.equal(resolveFastTolerance({ ergoWeight: 100, recoilWeight: 0, priceWeight: 0, preventOverswing: true }).tolerance, 10);
  assert.deepEqual(resolveFastTolerance({ ...weights, useTrueErgo: true, useTchebycheff: true }), { tolerance: FAST_TED_TCHEBYCHEFF_TOLERANCE, tedDefault: true });
  // Never below the shared default (tiny weights).
  assert.equal(resolveFastTolerance({ ergoWeight: 1e-6, useTrueErgo: true }).tolerance, DEFAULT_OBJECTIVE_TOLERANCE);
});

test('an explicit objectiveTolerance is used as given, with the capped native gap', () => {
  assert.deepEqual(resolveFastTolerance({ ...weights, useTrueErgo: true, objectiveTolerance: 1e-3 }), { tolerance: 1e-3, tedDefault: false });
});

test('the Fast TED native options differ from the shared ones only in the uncapped gap', () => {
  const capped = nativeSolveOptions(10);
  const uncapped = fastTedNativeSolveOptions(10);
  assert.equal(capped.mip_abs_gap, 1e-9);
  assert.equal(uncapped.mip_abs_gap, 2.5);
  assert.deepEqual({ ...uncapped, mip_abs_gap: capped.mip_abs_gap }, capped);
});

/** Solves a world through solveFast and returns every native mip_abs_gap it asked for. */
async function gapsOf(params: Parameters<typeof solveFast>[0]['params']): Promise<number[]> {
  const gaps: number[] = [];
  const solve: SolveFn = (text, options: HighsOptions, extras) => { gaps.push(options.mip_abs_gap as number); return nativeSolve(text, options, extras); };
  await solveFast({ params, deadline: performance.now() + 60_000, presolve: 'off', solve });
  return gaps;
}

test('a Fast TED solve runs at the uncapped gap, a plain one at the capped gap', { timeout: 120_000 }, async () => {
  const ted = randomTedWorld(1).params;
  const tedGaps = await gapsOf({ ...ted, objectiveTolerance: undefined });
  assert.ok(tedGaps.length > 0);
  const expected = resolveFastTolerance({ ...ted, objectiveTolerance: undefined }).tolerance / 4;
  for (const gap of tedGaps) assert.equal(gap, expected);
  const plain = randomWorld(1).params;
  for (const gap of await gapsOf({ ...plain, useTrueErgo: false, preventOverswing: false })) assert.equal(gap, nativeSolveOptions(DEFAULT_OBJECTIVE_TOLERANCE).mip_abs_gap);
});
