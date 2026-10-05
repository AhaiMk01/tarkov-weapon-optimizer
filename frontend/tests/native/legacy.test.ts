// TEMPORARY (deleted with legacySolve in Phase 2.4b-3 / 2.6): the legacy `{ Status, Columns, Rows, ObjectiveValue }` shape built
// from the structured full-precision result keeps the current solver.ts working, and matches the old wrapper's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HighsOptionError, discardNativeHighs, legacySolve } from '../../src/solver/native';
import type { LegacySolveResult } from '../../src/solver/native';
import { HIGHS_JS_README_LP, INFEASIBLE_LP, PRECISION_LP, PRECISION_X, UNBOUNDED_LP, knapsackLp } from './fixtures';

test('legacySolve returns the old wrapper shape with exact primals', async () => {
  const result = await legacySolve(PRECISION_LP);
  assert.deepEqual(Object.keys(result).sort(), ['Columns', 'ObjectiveValue', 'Rows', 'Status']);
  assert.equal(result.Status, 'Optimal');
  assert.equal(result.ObjectiveValue, 3.561728394506);
  assert.deepEqual(result.Columns.x, { Index: 0, Name: 'x', Lower: 0, Upper: PRECISION_X, Type: 'Continuous', Primal: PRECISION_X });
  assert.deepEqual(result.Columns.y, { Index: 1, Name: 'y', Lower: 0, Upper: Infinity, Type: 'Continuous', Primal: (4 - PRECISION_X) / 2 });
  assert.deepEqual(result.Rows, [{ Index: 0, Name: 'c1', Lower: -Infinity, Upper: 4, Primal: result.Rows[0].Primal }]);
  assert.ok(Math.abs(result.Rows[0].Primal - 4) < 1e-12);
});

test('status strings are the ones the current solver compares against', async () => {
  assert.equal((await legacySolve(INFEASIBLE_LP)).Status, 'Infeasible');
  assert.equal((await legacySolve(UNBOUNDED_LP)).Status, 'Unbounded');
  assert.equal((await legacySolve(knapsackLp(120, 7), { time_limit: 1e-4 })).Status, 'Time limit reached');
  const limited = await legacySolve(knapsackLp(120, 7), { mip_max_improving_sols: 1 });
  assert.equal(limited.Status, 'Solution limit reached');
  assert.equal(Object.keys(limited.Columns).length, 120, 'the incumbent of a limit stop is returned');
  assert.equal(limited.Columns.x0.Type, 'Integer');
  assert.ok(limited.ObjectiveValue > 0);
});

test('no primal solution means empty Columns and Rows and a zero objective', async () => {
  const infeasible = await legacySolve(INFEASIBLE_LP);
  assert.deepEqual(infeasible.Columns, {});
  assert.deepEqual(infeasible.Rows, []);
  assert.equal(infeasible.ObjectiveValue, 0);
});

test('the six options the current solver passes are accepted; unknown options still throw', async () => {
  const result = await legacySolve(HIGHS_JS_README_LP, {
    mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_feasibility_tolerance: 1e-8,
    primal_feasibility_tolerance: 1e-9, dual_feasibility_tolerance: 1e-9, time_limit: 60,
  });
  assert.equal(result.Status, 'Optimal');
  assert.equal(result.ObjectiveValue, 87.5);
  await assert.rejects(legacySolve(PRECISION_LP, { bogus: 1 } as never), HighsOptionError);
});

test('discardNativeHighs() makes the next legacySolve re-instantiate and still answer', async () => {
  const before = await legacySolve(PRECISION_LP);
  discardNativeHighs();
  const after = await legacySolve(PRECISION_LP);
  assert.deepEqual(after, before);
});

test('shape parity with the stock highs-js 1.8 wrapper on a few LPs (Status, keys, indices, names, bounds, types; values to its 6 digits)', async (t) => {
  type Stock = { solve(problem: string, options?: Record<string, unknown>): LegacySolveResult & { Columns: Record<string, Record<string, unknown>>; Rows: Array<Record<string, unknown>> } };
  let stock: Stock;
  try {
    stock = await ((await import('highs')).default as unknown as () => Promise<Stock>)();
  } catch {
    t.skip('the stock highs package is not installed (removed in Phase 2.6, with this test)');
    return;
  }
  const close = (a: number, b: number, what: string): void => {
    if (!Number.isFinite(a) || !Number.isFinite(b)) { assert.equal(a, b, what); return; }
    assert.ok(Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b)), `${what}: ${a} vs ${b}`);
  };
  for (const lp of [PRECISION_LP, HIGHS_JS_README_LP, knapsackLp(30, 2), INFEASIBLE_LP]) {
    const old = stock.solve(lp);
    const now = await legacySolve(lp);
    assert.equal(now.Status, old.Status);
    if (now.Status !== 'Optimal') {
      // The old wrapper printed placeholder columns for a model without a solution; the shim returns none rather than invent values.
      assert.deepEqual(now.Columns, {});
      continue;
    }
    close(now.ObjectiveValue, old.ObjectiveValue, 'ObjectiveValue');
    assert.deepEqual(Object.keys(now.Columns), Object.keys(old.Columns));
    for (const [name, column] of Object.entries(old.Columns)) {
      const mine = now.Columns[name];
      assert.equal(mine.Index, column.Index);
      assert.equal(mine.Name, column.Name);
      assert.equal(mine.Type, column.Type);
      close(mine.Lower, column.Lower as number, `${name}.Lower`);
      close(mine.Upper, column.Upper as number, `${name}.Upper`);
      close(mine.Primal, column.Primal as number, `${name}.Primal`);
    }
    assert.equal(now.Rows.length, old.Rows.length);
    old.Rows.forEach((row, i) => {
      assert.equal(now.Rows[i].Index, row.Index);
      assert.equal(now.Rows[i].Name, row.Name);
      close(now.Rows[i].Lower, row.Lower as number, `row ${i} Lower`);
      close(now.Rows[i].Upper, row.Upper as number, `row ${i} Upper`);
      close(now.Rows[i].Primal, row.Primal as number, `row ${i} Primal`);
    });
  }
});
