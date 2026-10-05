// No-good cuts (src/solver/physical/nogood.ts): the row excludes exactly one 0/1 assignment and nothing else, so every build the validator
// accepts stays feasible while the rejected one is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNativeHighs, parseLpText } from '../../src/solver/native';
import { insertRows, noGoodRow } from '../../src/solver/physical';

/** The expected model of one row, evaluated at an assignment: does it hold? */
function holds(row: string, assignment: Record<string, number>): boolean {
  const model = parseLpText(['Maximize', '  obj: 0 z', 'Subject To', row, 'Bounds', ...Object.keys(assignment).map(n => `  0 <= ${n} <= 1`), 'Binary', `  ${Object.keys(assignment).join(' ')}`, 'End'].join('\n'));
  const r = model.rows[0];
  const activity = r.terms.reduce((sum, [name, coef]) => sum + coef * assignment[name], 0);
  return activity >= r.lower - 1e-12 && activity <= r.upper + 1e-12;
}

test('the row is violated by the rejected assignment and by no other assignment of the columns', () => {
  const columns = ['x_1', 'x_2', 'x_3', 'x_4'];
  for (let target = 0; target < 16; target++) {
    const values = Object.fromEntries(columns.map((c, k) => [c, (target >> k) & 1]));
    const row = noGoodRow('nogood_0', columns, values);
    for (let candidate = 0; candidate < 16; candidate++) {
      const assignment = Object.fromEntries(columns.map((c, k) => [c, (candidate >> k) & 1]));
      assert.equal(holds(row, assignment), candidate !== target, `target ${target}, candidate ${candidate}`);
    }
  }
});

test('the row text: ones first, zeros subtracted, a right-hand side of ones minus one, long rows wrapped', () => {
  assert.equal(noGoodRow('ng', ['a', 'b', 'c'], { a: 1, b: 0, c: 1 }), '  ng: a + c - b <= 1');
  assert.equal(noGoodRow('ng', ['a', 'b'], { a: 0, b: 0 }), '  ng: - a - b <= -1', 'a first negative term keeps its sign');
  const many = Array.from({ length: 45 }, (_, k) => `x_${k}`);
  const text = noGoodRow('ng', many, Object.fromEntries(many.map((c, k) => [c, k % 2]))); // 22 ones
  assert.equal(text.split('\n').length, 3, '45 terms in lines of 20');
  assert.ok(text.endsWith('<= 21'));
  assert.doesNotThrow(() => parseLpText(['Maximize', '  obj: 0 x_0', 'Subject To', text, 'Bounds', ...many.map(n => `  0 <= ${n} <= 1`), 'Binary', `  ${many.join(' ')}`, 'End'].join('\n')), 'the wrapped row parses');
});

test('rows are inserted in front of the Bounds section, and nothing changes without rows', () => {
  const lp = ['Maximize', '  obj: z', 'Subject To', '  r: z <= 1', '', 'Bounds', '  0 <= z <= 1', 'End'].join('\n');
  assert.equal(insertRows(lp, []), lp);
  const out = insertRows(lp, ['  c1: z >= 0', '  c2: z <= 1']);
  assert.ok(out.indexOf('c2:') < out.indexOf('\nBounds\n'));
  assert.ok(parseLpText(out).rows.some(r => r.name === 'c2'));
  assert.throws(() => insertRows('Maximize\n  obj: z\nEnd', ['  c: z >= 0']), /no Bounds section/);
});

test('on the native build the cut removes the best solution and the next best is returned; cutting every solution makes the model infeasible', async () => {
  // maximize 3a + 2b + c over binaries with a + b <= 1 (so the optima are {a,c}=4, {b,c}=3, {a}=3, ...).
  const base = ['Maximize', '  obj: 3 a + 2 b + 1 c', 'Subject To', '  cap: a + b <= 1', 'Bounds', '  0 <= a <= 1', '  0 <= b <= 1', '  0 <= c <= 1', 'Binary', '  a b c', 'End'].join('\n');
  const solve = async (lp: string) => {
    const r = await getNativeHighs().solveStructured(lp, { presolve: 'off' });
    const values = Object.fromEntries(r.colNames!.map((n, k) => [n, r.colValues?.[k] ?? Number.NaN]));
    return { status: r.modelStatus.name, objective: r.objectiveValue, values };
  };
  const first = await solve(base);
  assert.equal(first.objective, 4);
  const cut1 = noGoodRow('nogood_0', ['a', 'b', 'c'], first.values);
  const second = await solve(insertRows(base, [cut1]));
  assert.equal(second.status, 'Optimal');
  assert.equal(second.objective, 3, 'the next best: {a} or {b, c}');
  const cut2 = noGoodRow('nogood_1', ['a', 'b', 'c'], second.values);
  const third = await solve(insertRows(base, [cut1, cut2]));
  assert.equal(third.objective, 3);
  // Cutting all six feasible assignments leaves nothing.
  const feasible = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1]];
  const rows = feasible.map((v, k) => noGoodRow(`nogood_${k}`, ['a', 'b', 'c'], { a: v[0], b: v[1], c: v[2] }));
  assert.equal((await solve(insertRows(base, rows))).status, 'Infeasible');
});
