// Model-level gates A, B and C of the OCCURRENCE model against the Stage 1 oracle, for every ledger case (Stage 2, phase 2.4b-2): the independent
// cross-check of production Precise, which solves the certified count model since Phase 2.10 (its formal gates: countGates.differential.test.ts).
// See lpGates.differential.ts for the gate definitions and the exact handling of TED. The per-family table is printed as diagnostics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER } from '../ledger/index';
import { runGates, solverStats, type CaseGates, type GateStatus } from './lpGates.differential';

const GATES = ['gateC', 'gateBObjective', 'gateBBuild', 'gateBMaximizers', 'gateAComplete', 'gateASound', 'gateText'] as const;
type GateName = (typeof GATES)[number];

const results: CaseGates[] = [];

test('cross-check: every ledger case passes gates A, B and C on the occurrence model', { timeout: 20 * 60 * 1000 }, async t => {
  for (const c of LEDGER) results.push(await runGates(c));

  const failures: string[] = [];
  for (const r of results) {
    for (const gate of GATES) if (r[gate].status === 'fail') failures.push(`${r.id} ${gate}: ${r[gate].detail}`);
  }

  const table = new Map<number, Record<GateName | 'cases' | 'skipped', number> & { fail: number }>();
  const cell = (status: GateStatus): 'p' | 'f' | 'n' => (status === 'pass' ? 'p' : status === 'fail' ? 'f' : 'n');
  for (const r of results) {
    const row = table.get(r.family) ?? ({ cases: 0, skipped: 0, fail: 0, gateC: 0, gateBObjective: 0, gateBBuild: 0, gateBMaximizers: 0, gateAComplete: 0, gateASound: 0, gateText: 0 } as never);
    row.cases++;
    if (r.notApplicable !== null) row.skipped++;
    for (const gate of GATES) {
      if (r[gate].status === 'pass') row[gate]++;
      if (r[gate].status === 'fail') row.fail++;
    }
    table.set(r.family, row);
  }
  void cell;
  const lines = ['family  cases  C   B-obj  B-build  B-max  A-comp  A-sound  text  (pass counts; n/a cases are not counted)'];
  for (const [family, row] of [...table].sort((a, b) => a[0] - b[0])) {
    lines.push(`F${String(family).padStart(2, '0')}     ${String(row.cases).padStart(5)}  ${String(row.gateC).padStart(2)}  ${String(row.gateBObjective).padStart(5)}  ${String(row.gateBBuild).padStart(7)}  ${String(row.gateBMaximizers).padStart(5)}  ${String(row.gateAComplete).padStart(6)}  ${String(row.gateASound).padStart(7)}  ${String(row.gateText).padStart(4)}   skipped ${row.skipped}  failing cells ${row.fail}`);
  }
  for (const line of lines) t.diagnostic(line);
  const na = results.filter(r => r.notApplicable !== null);
  t.diagnostic(`not gated: ${na.length} case(s): ${na.map(r => `${r.id} [${r.notApplicable}]`).join('; ') || 'none'}`);
  const partial = results.filter(r => r.notApplicable === null && GATES.some(g => r[g].status === 'n/a'));
  const partialCells = new Map<string, number>();
  for (const r of partial) for (const g of GATES) if (r[g].status === 'n/a') partialCells.set(`${g}: ${r[g].detail}`, (partialCells.get(`${g}: ${r[g].detail}`) ?? 0) + 1);
  t.diagnostic(`n/a cells: ${[...partialCells].map(([k, n]) => `${k} x${n}`).join('; ') || 'none'}`);
  t.diagnostic(`TED cases solved as exact singleton weight nodes: ${results.filter(r => r.nodes > 0).map(r => `${r.id}(${r.nodes})`).join(', ') || 'none'}`);
  t.diagnostic(`HiGHS solves: ${results.reduce((a, r) => a + r.solves, 0)}; solver: ${JSON.stringify(solverStats)}`);
  assert.deepEqual(failures, []);
});
