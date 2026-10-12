// Emitted-versus-parsed model verification on the pinned build: readback of what HiGHS holds, the independent strict LP
// parser, and the detection of coefficients HiGHS filtered (small_matrix_value, large_matrix_value, infinite_bound).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LpParseError, ModelReadError, NativeHighs, compareReadback, parseLpText } from '../../src/solver/native';
import type { ExpectedModel, ReadbackDifference } from '../../src/solver/native';
import { HIGHS_JS_README_LP, PRECISION_LP, knapsackLp, randomModelLp } from './fixtures';

const native = new NativeHighs();
after(() => native.discard());

/** Emitted model with one tiny matrix coefficient: c1 carries 5e-10 x. */
const TINY_MATRIX_LP = 'Maximize\n obj: x + y\nSubject To\n c1: 5e-10 x + y <= 4\n c2: x + y <= 7\nEnd\n';

async function check(lp: string, options?: Parameters<NativeHighs['readbackModel']>[1]) {
  const readback = await native.readbackModel(lp, options);
  return { readback, comparison: compareReadback(parseLpText(lp), readback, {
    smallMatrixValue: options?.small_matrix_value, largeMatrixValue: options?.large_matrix_value, infiniteBound: options?.infinite_bound,
  }) };
}

test('readback returns the rows, bounds, objective, integrality and coefficients HiGHS holds', async () => {
  const readback = await native.readbackModel(HIGHS_JS_README_LP);
  assert.equal(readback.sense, 'max');
  assert.equal(readback.objectiveOffset, 0);
  assert.deepEqual(readback.colNames, ['x1', 'x2', 'x3', 'x4']);
  assert.deepEqual(readback.rowNames, ['c1', 'c2', 'c3']);
  assert.deepEqual([...readback.colCost], [1, 2, 4, 1], 'costs are stored unnegated; the sense says maximize');
  assert.deepEqual([...readback.colLower], [0, 0, 0, 2]);
  assert.deepEqual([...readback.colUpper], [40, Infinity, Infinity, 3]);
  assert.deepEqual([...readback.rowLower], [-Infinity, -Infinity, 0]);
  assert.deepEqual([...readback.rowUpper], [20, 30, 0]);
  assert.deepEqual([...readback.integrality], [0, 0, 0, 0]);
  assert.equal(readback.numNz, 9);
  assert.ok(readback.colCost instanceof Float64Array && readback.matrix.index instanceof Int32Array);
});

test('integer and binary markers, offsets and fixed rows are read back', async () => {
  const lp = 'Minimize\n obj: x + y + 2 z + 5\nSubject To\n c1: x + y + z >= 1.5\n c2: x - y = 0\nBounds\n 0 <= z <= 10\nGeneral\n z\nBinary\n x y\nEnd\n';
  const readback = await native.readbackModel(lp);
  assert.equal(readback.sense, 'min');
  assert.equal(readback.objectiveOffset, 5);
  assert.deepEqual([...readback.integrality], [1, 1, 1]);
  assert.deepEqual([...readback.colUpper], [1, 1, 10]);
  assert.deepEqual([readback.rowLower[1], readback.rowUpper[1]], [0, 0]);
});

test('a coefficient below small_matrix_value is dropped by default and the readback comparison detects it', async () => {
  const { readback, comparison } = await check(TINY_MATRIX_LP);
  assert.equal(readback.readStatus, 'warning', 'HiGHS reports the drop as a warning status');
  assert.ok(readback.readMessages.some(line => /less than or equal to 1e-09: ignored/.test(line)), `HiGHS says so: ${readback.readMessages.join(' | ')}`);
  assert.equal(readback.numNz, 3, 'one of the four emitted coefficients is gone');
  assert.equal(comparison.ok, false);
  assert.equal(comparison.counts['missing-coefficient'], 1);
  assert.equal(comparison.filtered, 1);
  const dropped = comparison.differences.find((d): d is Extract<ReadbackDifference, { kind: 'missing-coefficient' }> => d.kind === 'missing-coefficient')!;
  assert.deepEqual({ row: dropped.row, column: dropped.column, expected: dropped.expected, cause: dropped.cause }, { row: 'c1', column: 'x', expected: 5e-10, cause: 'small_matrix_value' });
});

test('the same coefficient survives when small_matrix_value is lowered explicitly, and the comparison then passes', async () => {
  const { readback, comparison } = await check(TINY_MATRIX_LP, { small_matrix_value: 1e-12 });
  assert.equal(readback.readStatus, 'ok');
  assert.equal(readback.numNz, 4);
  assert.equal(readback.matrix.value.includes(5e-10), true);
  assert.equal(comparison.ok, true, JSON.stringify(comparison.differences));
  assert.equal(readback.effectiveOptions.small_matrix_value, 1e-12);
});

test('filtering also changes the solve: the dropped coefficient is not in the model that is solved', async () => {
  // c1: 5e-10 x + y <= 4 does not bind with the coefficient dropped (x is limited only by c2).
  const lp = 'Maximize\n obj: x + y\nSubject To\n c1: 5e-10 x + 1e-9 y <= 1\n c2: x + y <= 7\nEnd\n';
  const filtered = await native.solveStructured(lp, undefined, { includeReadback: true });
  const kept = await native.solveStructured(lp, { small_matrix_value: 1e-12 }, { includeReadback: true });
  assert.equal(filtered.readStatus, 'warning');
  assert.equal(kept.readStatus, 'ok');
  assert.equal(filtered.objectiveValue, 7);
  assert.ok(kept.objectiveValue! <= 7 + 1e-9);
  assert.notEqual(filtered.readback!.numNz, kept.readback!.numNz);
});

test('an objective coefficient of 5e-10 survives on this build (it did not on the legacy 1.8 artifact)', async () => {
  const lp = 'Maximize\n obj: 5e-10 x + y\nSubject To\n c1: x + y <= 4\nEnd\n';
  const { readback, comparison } = await check(lp);
  assert.equal(readback.colCost[0], 5e-10);
  assert.equal(readback.readStatus, 'ok');
  assert.equal(comparison.ok, true);
});

test('a bound at or above infinite_bound is turned into infinity and the comparison names the filter', async () => {
  const lp = 'Maximize\n obj: x + y\nSubject To\n c1: x + y <= 1e25\nBounds\n 0 <= x <= 1e25\nEnd\n';
  const { comparison } = await check(lp);
  assert.equal(comparison.ok, false);
  const causes = comparison.differences.filter(d => 'cause' in d).map(d => (d as { cause: string }).cause);
  assert.deepEqual(causes, ['infinite_bound', 'infinite_bound']);
  assert.equal(comparison.filtered, 2);
});

test('a coefficient at or above large_matrix_value fails the read with a typed error; raising the limit admits it', async () => {
  const lp = 'Maximize\n obj: x + y\nSubject To\n c1: 1e16 x + y <= 4\nEnd\n';
  await assert.rejects(native.readbackModel(lp), (e: unknown) => e instanceof ModelReadError && /greater than 1e\+15/.test(e.message));
  const { readback, comparison } = await check(lp, { large_matrix_value: 1e17 });
  assert.equal(readback.matrix.value.includes(1e16), true);
  assert.equal(comparison.ok, true, JSON.stringify(comparison.differences));
});

test('compareReadback reports changed, missing and extra entries of every kind', async () => {
  const readback = await native.readbackModel(HIGHS_JS_README_LP);
  const expected = parseLpText(HIGHS_JS_README_LP);
  assert.equal(compareReadback(expected, readback).ok, true);

  const broken: ExpectedModel = structuredClone(expected);
  broken.sense = 'min';
  broken.objectiveOffset = 1;
  broken.columns[0].cost = 9;
  broken.columns[1].lower = -1;
  broken.columns[2].upper = 5;
  broken.columns[3].integer = true;
  broken.columns.push({ name: 'ghost', cost: 0, lower: 0, upper: 1, integer: false });
  broken.rows[0].terms = [...broken.rows[0].terms, ['x4', 0.5] as const].filter(([name]) => name !== 'x2');
  broken.rows[1].upper = 31;
  broken.rows[2].terms = [...broken.rows[2].terms, ['x1', 3]];
  broken.rows.push({ name: 'phantom', lower: 0, upper: 1, terms: [['x1', 1]] });
  broken.columns.splice(3, 1); // x4 no longer expected: extra column in the readback
  const comparison = compareReadback(broken, readback);
  const kinds = new Set(Object.keys(comparison.counts));
  for (const kind of ['changed-sense', 'changed-offset', 'changed-objective', 'changed-column-bound', 'changed-integrality', 'missing-column',
    'extra-column', 'changed-row-bound', 'missing-row', 'missing-coefficient', 'changed-coefficient', 'extra-coefficient']) {
    // changed-integrality needs x4 to stay expected; assert it separately below.
    if (kind === 'changed-integrality') continue;
    assert.ok(kinds.has(kind), `expected a ${kind} difference, got ${[...kinds].join(', ')}`);
  }
  const integer: ExpectedModel = structuredClone(expected);
  integer.columns[0].integer = true;
  assert.equal(compareReadback(integer, readback).counts['changed-integrality'], 1);
});

test('numeric tolerance is opt-in: the default comparison is bit-exact', async () => {
  const lp = 'Maximize\n obj: x\nSubject To\n c1: 0.1 x <= 1\nEnd\n';
  const readback = await native.readbackModel(lp);
  const expected = parseLpText(lp);
  expected.rows[0].terms = [['x', 0.1 + 1e-17 * 3]]; // still the same double? make it differ by one ulp
  expected.rows[0].terms = [['x', 0.10000000000000002]];
  assert.equal(compareReadback(expected, readback).counts['changed-coefficient'], 1);
  assert.equal(compareReadback(expected, readback, { relativeTolerance: 1e-12 }).ok, true);
});

test('readback equals the independent parse for 12 seeded random mixed models (integers, binaries, ranges, free columns)', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const lp = randomModelLp(seed, 60 + seed * 5, 40 + seed * 3);
    const { readback, comparison } = await check(lp);
    assert.equal(readback.readStatus, 'ok', `seed ${seed}: ${readback.readMessages.join(' | ')}`);
    assert.equal(comparison.ok, true, `seed ${seed}: ${JSON.stringify(comparison.differences.slice(0, 5))}`);
    assert.ok(comparison.checked.coefficients > 100);
  }
});

test('HiGHS silently reads `Maximise` as a minimization: the sense mismatch is visible in the readback, and the strict parser refuses the text', async () => {
  const lp = 'Maximise\n obj: x\nSubject To\n c1: x <= 4\nEnd\n';
  const readback = await native.readbackModel(lp);
  assert.equal(readback.sense, 'min');
  assert.throws(() => parseLpText(lp), LpParseError);
  assert.equal(compareReadback(parseLpText(lp.replace('Maximise', 'Maximize')), readback).counts['changed-sense'], 1);
});

test('the knapsack and precision fixtures round-trip', async () => {
  for (const lp of [PRECISION_LP, knapsackLp(60, 3), HIGHS_JS_README_LP]) {
    const { comparison } = await check(lp);
    assert.equal(comparison.ok, true, JSON.stringify(comparison.differences));
  }
});

// The text the retired pre-cutover LP writer emitted for the AK-74 (formerly frontend/test_AK-74.lp), kept as a parser regression fixture.
const AK74_LP_PATH = fileURLToPath(new URL('./lp/legacy_AK-74.lp', import.meta.url));
test('the committed legacy AK-74 model (about 3300 rows, 395 kB): the readback check catches `x_-1`, and the repaired text reads back identically',
  { skip: existsSync(AK74_LP_PATH) ? false : 'lp/legacy_AK-74.lp is not present' }, async () => {
    const lp = readFileSync(AK74_LP_PATH, 'utf8');
    // The legacy writer emits `x_-1` for index -1. HiGHS reads that as the column `x_` and the number -1: a different model.
    assert.ok(lp.includes('x_-1'));
    assert.throws(() => parseLpText(lp), (e: unknown) => e instanceof LpParseError && /x_-1.*column x_ followed by -1/.test(e.message));
    const repaired = lp.replaceAll('x_-1', 'x_none');
    const { readback, comparison } = await check(repaired);
    assert.equal(readback.readStatus, 'ok', readback.readMessages.join(' | '));
    assert.equal(comparison.ok, true, JSON.stringify(comparison.differences.slice(0, 5)));
    assert.ok(comparison.checked.rows > 1000 && comparison.checked.coefficients > 10_000, JSON.stringify(comparison.checked));
    // And the unrepaired text really does parse differently in HiGHS (the phantom column `x_`).
    const original = await native.readbackModel(lp);
    assert.ok(original.colNames.includes('x_'), 'HiGHS split the token into x_ and -1');
    assert.ok(!original.colNames.includes('x_-1'));
  });

test('the strict parser rejects text outside the supported subset instead of guessing', () => {
  const bad = (lp: string, pattern: RegExp) => assert.throws(() => parseLpText(lp), (e: unknown) => e instanceof LpParseError && pattern.test(e.message));
  bad('Maximize\n obj: x\nSubject To\n c1: x + x <= 4\nEnd\n', /repeats/);
  bad('Maximize\n obj: x\nSubject To\n x <= 4\nEnd\n', /label/);
  bad('Maximize\n obj: x\nSubject To\n c1: -1 <= x <= 4\nEnd\n', /range|relational|right-hand/);
  bad('Maximize\n obj: x\nSubject To\n c1: x <= 4\nBounds\n x <= -3\nEnd\n', /below the default lower bound/);
  bad('Maximize\n obj: x\nSubject To\n c1: 2 + x <= 4\nEnd\n', /constants on the left/);
  bad('Maximize\n obj: x\nSubject To\n c1: x <= 4\n c1: y <= 3\nEnd\n', /duplicate row/);
  bad('Subject To\n c1: x <= 4\nEnd\n', /objective/);
  bad('Maximize\n obj: 3x\nEnd\n', /unsupported token/);
  bad('Maximise\n obj: x\nSubject To\n c1: x <= 4\nEnd\n', /before the objective section/);
  const ok = parseLpText('\\ comment\nMaximize\n obj: 2 x - 3 y + 1.5\nSubject To\n c1: x + y >= 1 \\ trailing comment\nBounds\n x free\n -inf <= y <= +inf\nEnd\n');
  assert.equal(ok.objectiveOffset, 1.5);
  assert.deepEqual(ok.columns.map(c => [c.name, c.cost, c.lower, c.upper]), [['x', 2, -Infinity, Infinity], ['y', -3, -Infinity, Infinity]]);
});
