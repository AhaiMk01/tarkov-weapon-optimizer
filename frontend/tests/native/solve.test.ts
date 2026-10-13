// Structured solves on the pinned native HiGHS build (ADR 0013 section 4B): full-precision primals, statuses, the MIP dual
// bound / gap / node count, the solution-limit stop, the time-limit stop, logging and the typed options.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { HighsOptionError, ModelReadError, NativeHighs } from '../../src/solver/native';
import {
  HIGHS_JS_README_LP, INFEASIBLE_LP, PRECISION_LP, PRECISION_X, PRECISION_Y, UNBOUNDED_LP, knapsackLp,
} from './fixtures';

const native = new NativeHighs();

test('a primal column value is the exact double, not the six-digit pretty-print', async () => {
  const result = await native.solveStructured(PRECISION_LP);
  assert.equal(result.modelStatus.name, 'Optimal');
  assert.equal(result.primalSolutionStatus.name, 'Feasible');
  const x = result.colValues![result.colIndexByName.get('x')!];
  const y = result.colValues![result.colIndexByName.get('y')!];
  assert.equal(x, PRECISION_X, 'x must be the exact binary64 value of the decimal 3.123456789012');
  assert.notEqual(x, 3.12346, 'the legacy pretty-print rounded this to 3.12346');
  assert.equal(y, PRECISION_Y);
  assert.ok(result.colValues instanceof Float64Array);
});

test('the objective value is the full-precision optimum', async () => {
  const result = await native.solveStructured(PRECISION_LP);
  assert.equal(result.objectiveValue, 3.561728394506);
  const readme = await native.solveStructured(HIGHS_JS_README_LP);
  assert.equal(readme.modelStatus.name, 'Optimal');
  assert.equal(readme.objectiveValue, 87.5);
  const values = Object.fromEntries(['x1', 'x2', 'x3', 'x4'].map(n => [n, readme.colValues![readme.colIndexByName.get(n)!]]));
  assert.deepEqual(values, { x1: 17.5, x2: 1, x3: 16.5, x4: 2 });
});

test('model status and primal status are reported with their HiGHS codes and names', async () => {
  const optimal = await native.solveStructured(PRECISION_LP);
  assert.deepEqual(optimal.modelStatus, { code: 7, name: 'Optimal' });
  assert.deepEqual(optimal.primalSolutionStatus, { code: 2, name: 'Feasible' });
  assert.deepEqual(optimal.runStatus, { code: 0, name: 'Ok' });
  assert.equal(optimal.highsVersion, '1.15.1');
});

test('infeasible: status 8, no primal solution, and every missing field says why', async () => {
  const result = await native.solveStructured(INFEASIBLE_LP);
  assert.deepEqual(result.modelStatus, { code: 8, name: 'Infeasible' });
  assert.equal(result.primalSolutionStatus.name, 'None');
  assert.equal(result.colValues, null);
  assert.equal(result.objectiveValue, null);
  assert.match(result.unavailable.colValues, /no primal solution/);
  assert.match(result.unavailable.objectiveValue, /no primal solution/);
});

test('unbounded: status 10, reported as such (the returned point is not an optimum)', async () => {
  const result = await native.solveStructured(UNBOUNDED_LP);
  assert.deepEqual(result.modelStatus, { code: 10, name: 'Unbounded' });
});

test('time limit: status 13 (TimeLimit), distinct from optimal, and never a fabricated bound', async () => {
  // time_limit runs on HiGHS's clock, which starts at handle creation, so reading the model already exceeds 1e-4 s.
  const result = await native.solveStructured(knapsackLp(120, 7), { time_limit: 1e-4 });
  assert.deepEqual(result.modelStatus, { code: 13, name: 'TimeLimit' });
  assert.notEqual(result.modelStatus.name, 'Optimal');
  assert.equal(result.runStatus.name, 'Warning', 'HiGHS returns a warning status for a limit stop');
  assert.equal(result.mipAbsoluteGap, null);
  assert.match(result.unavailable.mipAbsoluteGap, /finite/);
});

test('mip_max_improving_sols=1 stops with SolutionLimit (not Optimal) and returns the incumbent', async () => {
  const lp = knapsackLp(120, 7);
  const limited = await native.solveStructured(lp, { mip_max_improving_sols: 1 });
  assert.deepEqual(limited.modelStatus, { code: 16, name: 'SolutionLimit' });
  assert.notEqual(limited.modelStatus.name, 'Optimal');
  assert.equal(limited.primalSolutionStatus.name, 'Feasible');
  assert.ok(limited.colValues, 'the first improving solution is returned');
  assert.equal(limited.colValues!.length, 120);
  assert.ok(limited.colValues!.every(v => v === 0 || v === 1 || Math.abs(v - Math.round(v)) < 1e-6));
  assert.equal(limited.effectiveOptions.mip_max_improving_sols, 1);

  const optimal = await native.solveStructured(lp, { mip_rel_gap: 0, mip_abs_gap: 1e-9 });
  assert.equal(optimal.modelStatus.name, 'Optimal');
  assert.ok(limited.objectiveValue! <= optimal.objectiveValue! + 1e-9, 'an incumbent cannot beat the optimum of a maximization');
  // The stop leaves a proven bound above the incumbent: that is the information a floor query needs.
  assert.ok(limited.mipDualBound! >= optimal.objectiveValue! - 1e-6);
});

test('a MIP reports dual bound, relative gap and node count; an LP reports null with a reason', async () => {
  const mip = await native.solveStructured(knapsackLp(40), { mip_rel_gap: 0, mip_abs_gap: 1e-9 });
  assert.equal(mip.model.isMip, true);
  assert.equal(mip.modelStatus.name, 'Optimal');
  assert.equal(typeof mip.mipDualBound, 'number');
  assert.equal(typeof mip.mipRelativeGap, 'number');
  assert.equal(typeof mip.mipNodeCount, 'number');
  assert.ok(mip.mipNodeCount! >= 0);
  // For a maximization the dual bound is an upper bound in the objective's own sense, equal to the optimum when proved.
  assert.ok(mip.mipDualBound! >= mip.objectiveValue! - 1e-6);
  assert.ok(Math.abs(mip.mipDualBound! - mip.objectiveValue!) <= 1e-6);
  assert.equal(mip.mipRelativeGap, 0);
  assert.equal(mip.mipAbsoluteGap, Math.abs(mip.mipDualBound! - mip.objectiveValue!));
  assert.equal(mip.unavailable.mipDualBound, undefined);

  const early = await native.solveStructured(knapsackLp(120, 7), { mip_max_improving_sols: 1 });
  assert.ok(early.mipRelativeGap! > 0, 'an unproven stop has a positive gap');
  assert.ok(early.mipAbsoluteGap! > 0);
  assert.ok(Math.abs(early.mipRelativeGap! - early.mipAbsoluteGap! / Math.abs(early.objectiveValue!)) < 1e-9, 'mip_gap is a fraction, not a percent');

  const lp = await native.solveStructured(PRECISION_LP);
  assert.equal(lp.model.isMip, false);
  for (const field of ['mipDualBound', 'mipRelativeGap', 'mipAbsoluteGap', 'mipNodeCount'] as const) {
    assert.equal(lp[field], null);
    assert.match(lp.unavailable[field], /no integer columns/);
  }
});

test('row values and names are available on request and match the model', async () => {
  const result = await native.solveStructured(HIGHS_JS_README_LP, undefined, { includeRows: true });
  assert.deepEqual(result.rowNames, ['c1', 'c2', 'c3']);
  assert.equal(result.rowValues!.length, 3);
  assert.equal(result.rowValues![2], 0, 'c3: x2 - 0.5 x4 = 0');
  const without = await native.solveStructured(HIGHS_JS_README_LP);
  assert.equal(without.rowValues, null);
  assert.match(without.unavailable.rowValues, /not requested/);
});

test('logging off works (no lines, solve still succeeds); captureLog returns the HiGHS log as a diagnostic', async () => {
  const quiet = await native.solveStructured(knapsackLp(40), { log_to_console: false, output_flag: false });
  assert.equal(quiet.modelStatus.name, 'Optimal');
  assert.deepEqual(quiet.log, []);
  assert.equal(quiet.effectiveOptions.log_to_console, false);

  const noisy = await native.solveStructured(knapsackLp(40), undefined, { captureLog: true });
  assert.equal(noisy.modelStatus.name, 'Optimal');
  assert.ok(noisy.log.length > 0, 'the log is captured');
  assert.ok(noisy.log.some(line => /optimal|Status/i.test(line)));
  assert.equal(noisy.objectiveValue, quiet.objectiveValue, 'the log is a diagnostic: logging never changes the answer');
});

test('typed options: known names and types only, effective values reported', async () => {
  const result = await native.solveStructured(PRECISION_LP, {
    time_limit: 30, mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_max_improving_sols: 5, small_matrix_value: 1e-12,
    large_matrix_value: 1e20, presolve: 'off', log_to_console: false,
  });
  assert.equal(result.effectiveOptions.time_limit, 30);
  assert.equal(result.effectiveOptions.mip_abs_gap, 1e-9);
  assert.equal(result.effectiveOptions.mip_max_improving_sols, 5);
  assert.equal(result.effectiveOptions.small_matrix_value, 1e-12);
  assert.equal(result.effectiveOptions.large_matrix_value, 1e20);
  assert.equal(result.effectiveOptions.presolve, 'off');
  assert.equal(result.effectiveOptions.threads, 1, 'threads is pinned to 1 by default');

  // The filtering thresholds are explicit defaults, reported back, not whatever HiGHS happens to default to.
  const defaults = await native.solveStructured(PRECISION_LP);
  assert.deepEqual(
    [defaults.effectiveOptions.small_matrix_value, defaults.effectiveOptions.large_matrix_value, defaults.effectiveOptions.infinite_bound, defaults.effectiveOptions.infinite_cost],
    [1e-9, 1e15, 1e20, 1e20],
  );

  await assert.rejects(native.solveStructured(PRECISION_LP, { not_an_option: 1 } as never), (e: unknown) => e instanceof HighsOptionError && e.option === 'not_an_option');
  await assert.rejects(native.solveStructured(PRECISION_LP, { time_limit: 'soon' } as never), HighsOptionError);
  await assert.rejects(native.solveStructured(PRECISION_LP, { mip_max_improving_sols: 1.5 }), HighsOptionError);
  await assert.rejects(native.solveStructured(PRECISION_LP, { log_to_console: 1 } as never), HighsOptionError);
  await assert.rejects(native.solveStructured(PRECISION_LP, { mip_max_improving_sols: 0 }), (e: unknown) => e instanceof HighsOptionError && /rejected/.test(e.message), 'HiGHS itself rejects an out-of-range value');
  await assert.rejects(native.solveStructured(PRECISION_LP, { presolve: 'sometimes' }), HighsOptionError);
});

test('a model HiGHS cannot parse is a typed ModelReadError carrying the HiGHS message; the instance survives', async () => {
  const before = native.instanceId;
  await assert.rejects(
    native.solveStructured('Maximize\n obj: x +\nSubject To\n c1: x <= <= 4\nEnd\n'),
    (e: unknown) => e instanceof ModelReadError && e.log.length > 0,
  );
  assert.equal(native.instanceId, before, 'a parse failure is not corruption: the wasm instance is kept');
  const ok = await native.solveStructured(PRECISION_LP);
  assert.equal(ok.modelStatus.name, 'Optimal');
  assert.equal(ok.runtimeId, before);
});

test('concurrent calls on one instance each get their own answer', async () => {
  const results = await Promise.all([
    native.solveStructured(PRECISION_LP),
    native.solveStructured(HIGHS_JS_README_LP),
    native.solveStructured(INFEASIBLE_LP),
    native.solveStructured(knapsackLp(40)),
  ]);
  assert.deepEqual(results.map(r => r.modelStatus.name), ['Optimal', 'Optimal', 'Infeasible', 'Optimal']);
  assert.equal(results[1].objectiveValue, 87.5);
  assert.equal(new Set(results.map(r => r.runtimeId)).size, 1);
});

after(() => native.discard());
