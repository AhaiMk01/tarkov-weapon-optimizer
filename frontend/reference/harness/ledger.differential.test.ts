// Ledger-to-production differential harness with a ratchet baseline (Stage 2, phase 2.1).
//
// Every ledger case is mapped into production's inputs, solved by production's `solve()` (Precise primary, Fast
// secondary) and graded against the reference on four dimensions (see README.md). The scoreboard is compared with the
// committed baseline.json:
//
//   * a dimension that passed in the baseline and does not now is a REGRESSION (test failure);
//   * a dimension that passes now and did not in the baseline is an IMPROVEMENT: the test fails until the baseline is
//     updated in the same commit, so progress is recorded and can never silently be lost afterwards.
//
//   UPDATE_HARNESS_BASELINE=1 npx tsx --test reference/harness/ledger.differential.test.ts    rewrites baseline.json
//
// The update refuses to run while there are regressions, so it cannot launder one; an intended regression is
// recorded by editing baseline.json by hand, where it shows in review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER } from '../ledger/index';
import { gradeCase, probeNativeLoader, type GradedCase } from './compare.differential';
import { compareToBaseline, formatSummary, OUT_OF_SCOPE_CASES, OWNER_APPROVED_CERTIFICATE_LOSSES, parseBaseline, serializeBaseline, summarize, toBaseline } from './scoreboard';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, 'baseline.json');
const update = process.env.UPDATE_HARNESS_BASELINE === '1';

// the pinned native HiGHS build production solves on (see README.md)
const loader = await probeNativeLoader();

const started = performance.now();
const board: GradedCase[] = [];
for (const c of LEDGER) board.push(await gradeCase(c));
const wallMs = performance.now() - started;

const baseline = existsSync(baselinePath) ? parseBaseline(readFileSync(baselinePath, 'utf8')) : null;
const report = baseline ? compareToBaseline(baseline, board) : null;
let baselineWritten = false;
if (update && (!report || report.regressions.length === 0)) {
  writeFileSync(baselinePath, serializeBaseline(toBaseline(board)));
  baselineWritten = true;
}
// After a rewrite the committed file is the new one, so the checks below compare against it.
const current = baselineWritten ? parseBaseline(readFileSync(baselinePath, 'utf8')) : baseline;
const ratchet = current ? compareToBaseline(current, board) : null;

const count = (items: string[]) => [...items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

test('every ledger case is graded exactly once, in ledger order', () => {
  assert.deepEqual(board.map(g => g.id), LEDGER.map(c => c.id));
  assert.equal(new Set(board.map(g => g.id)).size, LEDGER.length);
  assert.ok(LEDGER.length >= 140);
});

test('scoreboard summary (informational)', t => {
  t.diagnostic(`native HiGHS ${loader.highsVersion} (githash ${loader.githash}), glue sha256 ${loader.jsSha256.slice(0, 16)}, wasm sha256 ${loader.wasmSha256.slice(0, 16)}`);
  for (const line of formatSummary(summarize(board)).split('\n')) t.diagnostic(line);
  for (const mode of ['precise', 'fast'] as const) {
    t.diagnostic(`production outcomes (${mode}): ${count(board.map(g => g.observed[mode])).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  const slowest = [...board].sort((a, b) => b.elapsedMs.precise + b.elapsedMs.fast - a.elapsedMs.precise - a.elapsedMs.fast).slice(0, 3);
  t.diagnostic(`ran ${board.length} cases x 2 modes in ${(wallMs / 1000).toFixed(1)} s; slowest: ${slowest.map(g => `${g.id} ${Math.round(g.elapsedMs.precise + g.elapsedMs.fast)} ms`).join(', ')}`);
  if (baselineWritten) t.diagnostic(`baseline.json rewritten (${LEDGER.length} cases)`);
});

test('the baseline exists and covers the ledger', () => {
  assert.ok(ratchet, 'reference/harness/baseline.json is missing: generate it with UPDATE_HARNESS_BASELINE=1 npx tsx --test reference/harness/ledger.differential.test.ts');
});

test('ratchet: no dimension that passed in the baseline fails now', () => {
  if (!ratchet) assert.fail('no baseline');
  assert.deepEqual(ratchet.regressions, [], `REGRESSION: a case that passed in baseline.json no longer does${update ? ' (the baseline was not updated: fix the regression, or edit baseline.json by hand if it is intended)' : ''}`);
});

test('ratchet: every newly passing dimension is recorded in baseline.json', () => {
  if (!ratchet) assert.fail('no baseline');
  assert.deepEqual(
    [...ratchet.improvements, ...ratchet.drift],
    [],
    'IMPROVEMENT or drift: baseline.json is out of date. Update it in the same commit: UPDATE_HARNESS_BASELINE=1 npx tsx --test reference/harness/ledger.differential.test.ts',
  );
});

test('every ledger case the oracle has an optimum for is certified `optimal` on Precise at its case tolerance, except the owner-approved scope', () => {
  // Owner-approved scope (README.md): the cases out of scope (cyclic part data, not run, every dimension n/a) and the certificates lost to the 1e-7
  // integrality tolerance at the 1e-9 case tolerance (decision 5b), which still return the validated optimum as `feasible`.
  const withOptimum = board.filter(g => g.precise.scoreOptimal.verdict !== 'n/a');
  assert.ok(withOptimum.length >= 125, `${withOptimum.length} cases have an oracle optimum`);
  assert.deepEqual(
    withOptimum.filter(g => g.observed.precise !== 'optimal' && !Object.hasOwn(OWNER_APPROVED_CERTIFICATE_LOSSES, g.id)).map(g => `${g.id}: ${g.observed.precise}`),
    [],
    'a case lost its certificate: the proved allowances are larger than the case tolerance, or a solve was unqualified',
  );
  for (const id of Object.keys(OWNER_APPROVED_CERTIFICATE_LOSSES)) {
    const graded = board.find(g => g.id === id);
    assert.ok(graded !== undefined, id);
    assert.ok(graded.observed.precise === 'feasible' || graded.observed.precise === 'optimal', `${id}: ${graded.observed.precise} (an approved loss still returns the validated optimum)`);
    assert.equal(graded.precise.scoreOptimal.verdict, 'pass', `${id}: the returned build is the exact optimum`);
  }
});

test('exactly the out-of-scope cases (cyclic part data) are not run; a loop the receiver cannot reach is in scope and keeps its certified optimum', () => {
  const outOfScope = board.filter(g => g.observed.precise === 'out_of_scope' || g.observed.fast === 'out_of_scope').map(g => g.id);
  assert.deepEqual(outOfScope, Object.keys(OUT_OF_SCOPE_CASES));
  const unreachableLoop = board.find(g => g.id === 'F10-no-disconnected-assembly') as GradedCase;
  assert.equal(unreachableLoop.observed.precise, 'optimal');
  assert.equal(unreachableLoop.precise.scoreOptimal.verdict, 'pass');
});
