// The Fast TED default tolerance through the public solver (owner decision 2026-10-27, docs/stage3/fast-ted-tolerance.md): a Fast Sweet Spot TrueErgo
// request runs its three payoff endpoints at 0.1 x 100 = 10 and its final Tchebycheff solve at 1e-4, each with the uncapped native gap (tolerance / 4);
// an Explore sweep sets the shared default on every target, so its solves keep the shared tolerance and the capped native gap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runExplore } from '../../src/solver/exploreSweep';
import type { OptimizeFn } from '../../src/solver/exploreSweep';
import { buildSweepSchedule, exploreRunRequest } from '../../src/solver/paretoExplorer';
import type { ParetoParams } from '../../src/solver/paretoExplorer';
import { nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import { FAST_TED_TCHEBYCHEFF_TOLERANCE, FAST_TED_TOLERANCE_PER_WEIGHT } from '../../src/solver/physical/solveFast';
import { DEFAULT_OBJECTIVE_TOLERANCE } from '../../src/solver/physical/solvePrecise';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import { configurePayoff, solveRequest } from '../../src/solver/solver';
import { randomTedWorld } from '../physical/randomWorlds';
import { withNative } from '../runtime/operationsMatrix.harness';

/** A small seeded TED world as a Fast TrueErgo request (no MOA cap or explicit tolerance, so nothing but the rule under test sets it). */
const tedRequest = (seed: number) => ({
  ...randomTedWorld(seed).params, useTrueErgo: true, preciseMode: false, precisionRequest: 'fast' as const, maxMOA: undefined, objectiveTolerance: undefined,
});

test('Fast Sweet Spot TrueErgo: the endpoints run at 0.1 x 100, the final Tchebycheff solve at 1e-4, both at the uncapped native gap', { timeout: 300_000 }, async () => {
  let checked = 0;
  for (let seed = 1; seed <= 20 && checked < 3; seed++) {
    /** The native gaps asked for by each endpoint (index 0-2, sequential) and by the final solve (index 3). */
    const gaps: number[][] = [[], [], [], []];
    let phase = 3;
    configurePayoff({ concurrent: false, endpointWrapper: async (index, run) => { phase = index; try { await run(); } finally { phase = 3; } } });
    let report;
    try {
      report = await withNative(async (call, real) => { gaps[phase].push(Number(call.options.mip_abs_gap)); return real(); },
        () => solveRequest({ ...tedRequest(seed), useTchebycheff: true, idealPoint: undefined, guard: fixedGuard(performance.now() + 120_000) }));
    } finally {
      configurePayoff({});
    }
    // Only a request whose payoff table was computed reached the final Tchebycheff solve.
    if (report.payoff === null) continue;
    checked++;
    const endpoint = FAST_TED_TOLERANCE_PER_WEIGHT * 100;
    assert.equal(endpoint, 10);
    for (const [i, endpointGaps] of gaps.slice(0, 3).entries()) {
      assert.ok(endpointGaps.length > 0, `seed ${seed}: endpoint ${i} solved natively`);
      for (const gap of endpointGaps) assert.ok(Math.abs(gap - endpoint / 4) < 1e-12, `seed ${seed}: endpoint ${i} gap ${gap}`);
    }
    assert.equal(report.response.optimization.tolerance, FAST_TED_TCHEBYCHEFF_TOLERANCE, `seed ${seed}: the final solve reports its tolerance`);
    assert.ok(gaps[3].length > 0, `seed ${seed}: the final solve ran natively`);
    for (const gap of gaps[3]) assert.equal(gap, FAST_TED_TCHEBYCHEFF_TOLERANCE / 4, `seed ${seed}: final gap ${gap}`);
  }
  assert.equal(checked, 3, 'three seeded requests computed a payoff table');
});

test('a Fast TED pre-model stop (an invalid stash) reports the Fast TED default', async () => {
  const { response } = await solveRequest({ ...tedRequest(1), ergoWeight: 100, recoilWeight: 0, priceWeight: 0, ownedItems: [42 as unknown as string] });
  assert.equal(response.reason !== undefined && response.selected_items.length === 0, true);
  assert.equal(response.optimization.tolerance, FAST_TED_TOLERANCE_PER_WEIGHT * 100);
});

test('Explore keeps the shared default: every Fast TrueErgo target reports it and runs at the capped native gap', { timeout: 300_000 }, async () => {
  const world = tedRequest(1);
  const params: ParetoParams = { ...world, ignore: 'price', steps: 2 };
  const gaps: number[] = [];
  const optimize: OptimizeFn = async (p, guard) => (await solveRequest({ ...p, guard })).response;
  const result = await withNative(async (call, real) => { gaps.push(Number(call.options.mip_abs_gap)); return real(); },
    () => runExplore(exploreRunRequest(params), buildSweepSchedule(params), fixedGuard(performance.now() + 120_000), optimize));
  assert.ok(result.step_outcomes.length >= 2);
  for (const row of result.step_outcomes) assert.equal(row.optimization.tolerance, DEFAULT_OBJECTIVE_TOLERANCE, `target ${row.target_index}`);
  assert.ok(gaps.length > 0);
  for (const gap of gaps) assert.equal(gap, nativeSolveOptions(DEFAULT_OBJECTIVE_TOLERANCE).mip_abs_gap);
});
