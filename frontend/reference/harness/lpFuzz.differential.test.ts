// Randomized model-level gates A, B and C of the physical LP against the oracle (Stage 2, phase 2.4b-2).
// Deterministic: case k of base seed S is `generateCase(S + k)`. LP_FUZZ_CASES (default 60; the 1500 and 600 case runs of the report used LP_FUZZ_SEED=7000000) and LP_FUZZ_SEED (default 20261004) tune a run;
// a failure prints the seed, the request and the fixture so it reproduces with `generateCase(seed)`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asLedgerCase, generateCase } from './lpFuzz.differential';
import { runGates, solverStats, type CaseGates } from './lpGates.differential';

const CASES = Number(process.env.LP_FUZZ_CASES ?? 60);
const BASE_SEED = Number(process.env.LP_FUZZ_SEED ?? 20261004);

const GATES = ['gateC', 'gateBObjective', 'gateBBuild', 'gateBMaximizers', 'gateAComplete', 'gateASound', 'gateText'] as const;

test(`randomized cases pass gates A, B and C (${CASES} cases from seed ${BASE_SEED})`, { timeout: 30 * 60 * 1000 }, async t => {
  const failures: string[] = [];
  const results: CaseGates[] = [];
  let skippedOracle = 0;
  let empty = 0;
  const features = { ted: 0, tchebycheff: 0, moa: 0, owned: 0, presets: 0, caps: 0 };
  for (let k = 0; k < CASES; k++) {
    const seed = BASE_SEED + k;
    const fuzz = generateCase(seed);
    const c = asLedgerCase(fuzz);
    if (c === null) {
      skippedOracle++;
      continue;
    }
    if (c.expected.empty) empty++;
    const r = fuzz.request;
    if (r.use_true_ergo || r.prevent_overswing) features.ted++;
    if (r.use_tchebycheff) features.tchebycheff++;
    if (r.max_moa != null) features.moa++;
    if (r.owned_items) features.owned++;
    if ((fuzz.fixture.presets ?? []).length > 0) features.presets++;
    if ([r.max_price, r.min_ergonomics, r.max_recoil_v, r.max_recoil_sum, r.max_weight, r.min_mag_capacity, r.min_sighting_range].some(v => v != null)) features.caps++;
    const gates = await runGates(c, { maxPinned: 30, randomDirections: 2 });
    results.push(gates);
    for (const gate of GATES) {
      if (gates[gate].status === 'fail') failures.push(`seed ${seed} ${gate}: ${gates[gate].detail}\n  request ${JSON.stringify(fuzz.request)}`);
    }
  }
  const gated = results.filter(r => r.notApplicable === null);
  t.diagnostic(`cases: ${results.length} gated of ${CASES} (${skippedOracle} skipped for an incomplete oracle, ${results.length - gated.length} not gated); empty ${empty}`);
  t.diagnostic(`features: ${JSON.stringify(features)}`);
  t.diagnostic(`passing gates: ${GATES.map(g => `${g} ${gated.filter(r => r[g].status === 'pass').length}`).join(', ')}`);
  t.diagnostic(`HiGHS solves: ${results.reduce((a, r) => a + r.solves, 0)}; solver: ${JSON.stringify(solverStats)} (a fallback follows an explicit HiGHS failure status)`);
  const skippedReasons = new Map<string, number>();
  for (const r of results) if (r.notApplicable) skippedReasons.set(r.notApplicable.split('(')[0], (skippedReasons.get(r.notApplicable.split('(')[0]) ?? 0) + 1);
  if (skippedReasons.size > 0) t.diagnostic(`not gated: ${[...skippedReasons].map(([k, n]) => `${k} x${n}`).join('; ')}`);
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} failing gate cell(s)`);
});
