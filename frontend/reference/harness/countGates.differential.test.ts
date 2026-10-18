// Formal Gates A, B and C on PRODUCTION Precise (the certified count model exactly as solvePrecise builds and solves it) against the Stage 1 oracle
// (Stage 3, workstream 3.1). See countGates.differential.ts for the gate definitions, the production pipeline they mirror, relaxed-first edges, TED,
// the precision rule and the out-of-scope rule for cyclic part data. The occurrence-model gates (lpGates.differential.test.ts) stay as the independent cross-check.
//
// Populations: every ledger case (the 5 cyclic ones out of scope, every other one gated) and seeded worlds with the Stage 1 oracle as the
// truth (lpFuzz worlds, TED and Tchebycheff included, and the adversarial MOA family whose accuracy sum passes 100 points, where the larger-COI rows bind).
// Sizes: the defaults take about a minute. COUNT_GATES_LONG=1 runs the campaign sizes; COUNT_GATES_SEED shifts the world seeds. Run alone:
// cd frontend && npx tsx --test reference/harness/countGates.differential.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import { adversarialCase } from './acyclicFastWorlds.differential';
import { generateCase } from './lpFuzz.differential';
import { OUT_OF_SCOPE_CASES } from './scoreboard';
import { CYCLIC_OUT_OF_SCOPE } from './toProduction.differential';
import { addCount, COUNT_GATES, formatCountTally, newCountTally, runCountGates, type CountCaseGates, type CountTally } from './countGates.differential';

const LONG = process.env.COUNT_GATES_LONG === '1';
const SEED = Number(process.env.COUNT_GATES_SEED ?? 0);
const size = (small: number, long: number): number => (LONG ? long : small);

// Keep the sub-tolerance near-cap exception. Recovered precision cells must not regress.
const ALLOWED_PRECISION_CELLS: readonly string[] = [
  'F04-near-cap-min-ergonomics-gap-2e-20 gateBObjective',
];

/**
 * Native defects the gates found and production now handles (Stage 3 follow-up, owner 2026-10-12; countGates.nativeDefects.differential.test.ts keeps the
 * minimal reproductions): a SolveError is an inconclusive solve and the next seed is tried, and a false Infeasible of a node's integer text is neutralized
 * by the "relaxation must agree" rule. Neither is a failing cell any more; both are counted in the tally. Every failing cell is unexpected.
 */
function report(t: { diagnostic: (message: string) => void }, label: string, tally: CountTally): { unexpected: string[] } {
  t.diagnostic(formatCountTally(label, tally));
  const unexpected = tally.failures.map(f => `${f.id} ${f.gate}: ${f.detail.slice(0, 300)}`);
  if (tally.precision.length > 0) t.diagnostic(`${label}: precision cells (decision 5b): ${tally.precision.map(p => `${p.id} ${p.gate} [${p.detail.slice(0, 120)}]`).join('; ')}`);
  return { unexpected };
}

test('ledger: Gates A, B and C on production Precise (certified count model) for every case in scope; the cyclic cases are out of scope', { timeout: 30 * 60_000 }, async t => {
  const tally = newCountTally();
  const results: CountCaseGates[] = [];
  for (const c of LEDGER) {
    const r = await runCountGates({ id: c.id, family: c.family, fixture: c.fixture, request: c.request, tolerance: c.runtimeTolerance }, { todo: c.todo });
    results.push(r);
    addCount(tally, r);
  }
  // per-family table
  const lines = [`family  cases  gated  skipped  ${COUNT_GATES.map(g => g.replace('gate', '')).join(' ')}  (pass counts)`];
  for (const family of [...new Set(results.map(r => r.family))].sort((a, b) => a - b)) {
    const rows = results.filter(r => r.family === family);
    const gated = rows.filter(r => r.scope === 'gated');
    lines.push(`F${String(family).padStart(2, '0')}     ${String(rows.length).padStart(5)}  ${String(gated.length).padStart(5)}  ${String(rows.filter(r => r.scope === 'skipped').length).padStart(7)}  ${COUNT_GATES.map(g => `${g.replace('gate', '')}=${gated.filter(r => r[g].status === 'pass').length}`).join(' ')}`);
  }
  for (const line of lines) t.diagnostic(line);
  const naCells = new Map<string, number>();
  for (const r of results) if (r.scope === 'gated') for (const g of COUNT_GATES) if (r[g].status === 'n/a') naCells.set(`${g}: ${r[g].detail.replace(/\d+/g, 'N').slice(0, 90)}`, (naCells.get(`${g}: ${r[g].detail.replace(/\d+/g, 'N').slice(0, 90)}`) ?? 0) + 1);
  t.diagnostic(`n/a cells: ${[...naCells].map(([k, n]) => `${k} x${n}`).join('; ') || 'none'}`);
  t.diagnostic(`TED cases on singleton weight nodes: ${results.filter(r => r.nodes > 0).map(r => `${r.id}(${r.nodes})`).join(', ') || 'none'}`);
  const { unexpected } = report(t, 'ledger', tally);

  assert.deepEqual(unexpected, [], `${unexpected.length} unexpected failing cell(s)`);
  const skipped = results.filter(r => r.scope === 'skipped');
  assert.deepEqual(skipped.map(r => r.id).sort(), Object.keys(OUT_OF_SCOPE_CASES).sort(), 'exactly the out-of-scope (cyclic) cases are skipped');
  assert.ok(skipped.every(r => r.scopeDetail === CYCLIC_OUT_OF_SCOPE), 'they are skipped as out of scope, nothing else');
  assert.equal(tally.gated, LEDGER.length - skipped.length);
  const newPrecisionCells = tally.precision.map(p => `${p.id} ${p.gate}`).filter(cell => !ALLOWED_PRECISION_CELLS.includes(cell));
  assert.deepEqual(newPrecisionCells, [], 'precision cells (decision 5b) must stay within the existing allowlist');
});

test('seeded worlds (lpFuzz, TED and Tchebycheff included): Gates A, B and C on production Precise; cyclic worlds are out of scope', { timeout: 240 * 60_000 }, async t => {
  const cases = size(120, 2000);
  const tally = newCountTally();
  for (let k = 0; k < cases; k++) {
    const seed = 30_000_000 + SEED + k;
    const world = generateCase(seed);
    addCount(tally, await runCountGates({ id: `fuzz-${seed}`, family: 0, fixture: world.fixture, request: world.request, tolerance: { absolute: 1e-9, kind: 'well_separated', resolvableAtTolerance: true } }, { maxPinned: 200 }));
  }
  const { unexpected } = report(t, `lpFuzz (${cases} seeds from ${30_000_000 + SEED})`, tally);
  assert.deepEqual(unexpected, [], `${unexpected.length} unexpected failing cell(s)`);
  assert.ok(tally.gated >= cases / 3, `${tally.gated} of ${cases} worlds were gated`);
  // A world's precision cell is reported, not listed: the worlds are drawn, so the set is not fixed in advance. It must stay rare and tiny.
  assert.ok(tally.precision.length <= Math.max(2, cases / 50), `${tally.precision.length} precision cell(s)`);
});

test('adversarial MOA worlds (several barrels, accuracy sum above 100, negative caps): Gates A, B and C on production Precise', { timeout: 240 * 60_000 }, async t => {
  const cases = size(40, 600);
  const tally = newCountTally();
  for (let k = 0; k < cases; k++) {
    const seed = 40_000_000 + SEED + k;
    const world = adversarialCase(seed, { moa: true, bigAccuracy: true });
    addCount(tally, await runCountGates({ id: `moa-${seed}`, family: 8, fixture: world.fixture, request: world.request, tolerance: { absolute: 1e-9, kind: 'well_separated', resolvableAtTolerance: true } }, { maxPinned: 200 }));
  }
  const { unexpected } = report(t, `adversarial MOA (${cases} seeds from ${40_000_000 + SEED})`, tally);
  assert.deepEqual(unexpected, [], `${unexpected.length} unexpected failing cell(s)`);
  assert.ok(tally.precision.length <= Math.max(2, cases / 50), `${tally.precision.length} precision cell(s)`);
});
