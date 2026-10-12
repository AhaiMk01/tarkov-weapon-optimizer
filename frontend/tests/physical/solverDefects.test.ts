// Small models on which HiGHS misbehaved, kept as a regression corpus for the pinned native build (ADR 0013 section 4B, Phase 2.3, HiGHS 1.15.1)
// and as the evidence behind a choice of this phase: a weight node is written as rows, never as a tightened column bound. Four were found on the
// RETIRED npm `highs` 1.8.0 WASM (wrong answers and aborts); a fifth, native_presolve_false_infeasible.lp, is a 6-row model the PINNED 1.15.1
// still reports 'Infeasible' with presolve on although it is plainly feasible.
//
// Each model has a truth that does not depend on any presolve:
//   presolve_wrong_optimal.lp   emitted for random case seed 20261190 (reference/harness/lpFuzz.differential.ts). The oracle's exact maximum of
//                               that case is 681/2 = 340.5 and two of its maximizers are attainable; npm highs reported 'Optimal' 312.25.
//   presolve_false_infeasible.lp  a 29-row reduction of the emitted model of seed 20261248 pinned to a projection the oracle accepts. Removing rows
//                               only enlarges the feasible set, so it is feasible; npm highs reported 'Infeasible'.
//   bound defect (inline)       `w = 4.5` with `w - x = 4`, x binary: x would be 0.5, so the model is infeasible; npm highs reported 'Optimal'
//                               with w = 4, outside its own bound.
//   presolve_off_crash.lp       the model of seed 7000444 (TED node W = 5.25, direction e 0.47, r 1.95, p 1512.08): npm highs aborted with presolve
//                               off; the value -6659.939357 is what both presolve settings of the pinned build return.
//
// npm highs misbehaved in the presolve rules FreeColSubstitution, DoubletonEquation and Aggregator (`presolve_rule_off` bits 8, 9, 12) and
// aborted with presolve off, so no setting of it was safe. The hard assertions here are on the pinned native build: every model has its truth with
// default presolve and with presolve off. The npm package, while it is still installed, is run only to REPORT whether it still misbehaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getNativeHighs, type HighsOptions } from '../../src/solver/native';
import { nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import { PRECISE_RANDOM_SEEDS } from '../../src/solver/physical/solvePrecise';

interface Solved { status: string; objective: number | null; values: Record<string, number> }

const BASE: HighsOptions = {
  mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_feasibility_tolerance: 1e-9, primal_feasibility_tolerance: 1e-9, dual_feasibility_tolerance: 1e-9,
};

async function native(lp: string, extra: HighsOptions): Promise<Solved> {
  const r = await getNativeHighs().solveStructured(lp, { ...BASE, ...extra });
  const values: Record<string, number> = {};
  if (r.colNames !== null && r.colValues !== null) r.colNames.forEach((name, k) => { values[name] = (r.colValues as Float64Array)[k]; });
  return { status: r.modelStatus.name, objective: r.objectiveValue, values };
}

/** The retired npm package, only to report; a message when it is no longer installed or aborts. */
async function legacy(lp: string, extra: Record<string, unknown>): Promise<string> {
  try {
    const loader = (await import('highs')).default as unknown as () => Promise<{
      solve(p: string, o?: Record<string, unknown>): { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal?: number }> };
    }>;
    const r = (await loader()).solve(lp, { ...BASE, ...extra });
    return `${r.Status} ${r.ObjectiveValue}`;
  } catch (e) {
    return `unavailable (${String(e).slice(0, 60)})`;
  }
}

const model = (name: string): string => readFileSync(fileURLToPath(new URL(`./solverDefects/${name}`, import.meta.url)), 'utf8');

const VARIANTS: Record<string, HighsOptions> = { 'default presolve': {}, 'presolve off': { presolve: 'off' } };
const LEGACY_VARIANTS: Record<string, Record<string, unknown>> = {
  default: {},
  'presolve off': { presolve: 'off' },
  'culprit rules off': { presolve_rule_off: 2 ** 8 + 2 ** 9 + 2 ** 12 },
};

const BOUND_DEFECT = [
  'Maximize', '  obj: total', 'Subject To', '  o: total - 0.1 raw = 0', '  raw_def: raw - 10 x = 50', '  w_def: w - x = 4',
  '  c1_hi: raw - 201 h >= -101', 'Bounds', '  0 <= total <= 100', '  50 <= raw <= 60', '  w = 4.5', 'Binary', '  x h', 'End',
].join('\n');

test('wrong optimal: the true maximum 340.5 is found, with and without presolve', async t => {
  const lp = model('presolve_wrong_optimal.lp');
  for (const [name, options] of Object.entries(VARIANTS)) {
    const r = await native(lp, options);
    assert.equal(r.status, 'Optimal', name);
    assert.ok(Math.abs((r.objective as number) - 340.5) < 1e-6, `${name}: ${r.objective}`);
  }
  for (const [name, options] of Object.entries(LEGACY_VARIANTS)) t.diagnostic(`npm highs, ${name}: ${await legacy(lp, options)}`);
});

test('false infeasibility: the feasible model is feasible, with and without presolve', async t => {
  const lp = model('presolve_false_infeasible.lp');
  for (const [name, options] of Object.entries(VARIANTS)) assert.equal((await native(lp, options)).status, 'Optimal', name);
  for (const [name, options] of Object.entries(LEGACY_VARIANTS)) t.diagnostic(`npm highs, ${name}: ${await legacy(lp, options)}`);
});

test('a tightened bound on a continuous column tied to a binary: infeasible, with and without presolve', async t => {
  for (const [name, options] of Object.entries(VARIANTS)) assert.equal((await native(BOUND_DEFECT, options)).status, 'Infeasible', name);
  for (const [name, options] of Object.entries(LEGACY_VARIANTS)) t.diagnostic(`npm highs, ${name}: ${await legacy(BOUND_DEFECT, options)}`);
});

test('the same restriction written as a row is infeasible too (why a weight node is a row, whatever the solver)', async () => {
  const asRows = BOUND_DEFECT.replace('  w = 4.5\n', '  4 <= w <= 5\n').replace('Bounds', '  wfix: w = 4.5\nBounds');
  for (const options of Object.values(VARIANTS)) assert.equal((await native(asRows, options)).status, 'Infeasible');
});

test('the model npm highs aborted on: the pinned build solves it to -6659.939357 with and without presolve', async t => {
  const lp = model('presolve_off_crash.lp');
  for (const [name, options] of Object.entries(VARIANTS)) {
    const r = await native(lp, options);
    assert.equal(r.status, 'Optimal', name);
    assert.ok(Math.abs((r.objective as number) - -6659.939357142857) < 1e-5, `${name}: ${r.objective}`);
  }
  for (const [name, options] of Object.entries(LEGACY_VARIANTS)) t.diagnostic(`npm highs, ${name}: ${await legacy(lp, options)}`);
});

test('the PINNED build (HiGHS 1.15.1) still reports a feasible 6-row model Infeasible with presolve on; presolve off solves it', async t => {
  // x_3 or x_7 is installed (pin), so u_2 >= 1, one lot of 150 covers it, and price 5000 + 150 <= 5850: plainly feasible.
  const lp = model('native_presolve_false_infeasible.lp');
  const off = await native(lp, { presolve: 'off' });
  assert.equal(off.status, 'Optimal');
  assert.ok(off.values.x_3 + off.values.x_7 > 0.5 && off.values.price_axis <= 5850 + 1e-6);
  const on = (await getNativeHighs().solveStructured(lp)).modelStatus.name; // every option at its default: no tolerance of ours is involved
  t.diagnostic(`all-default options, presolve on: ${on}${on === 'Infeasible' ? ' (wrong: the model is feasible)' : ''}`);
});

test('the Fast template model of random world 123 (fast_presolve_wrong_optimal.lp): presolve OFF finds the true optimum 335.35 and proves it; presolve ON may call a suboptimal point Optimal', async t => {
  // 39 columns, 43 rows. Exact maximum 335.35 (the Precise model of the same request and the Fast model with presolve off agree: tests/physical/fastPresolve.test.ts).
  // Phase 2.4c measured HiGHS 1.15.1 with presolve ON reporting Optimal 123.37 with a dual bound of 123.37: a wrong PROOF, which is why no claim is accepted from a
  // presolved solve (nativeSolve.ts, nativeProof.ts) and why both model families run with presolve off.
  const lp = model('fast_presolve_wrong_optimal.lp');
  const off = await getNativeHighs().solveStructured(lp, { ...BASE, presolve: 'off' });
  assert.equal(off.modelStatus.name, 'Optimal');
  assert.ok(Math.abs((off.objectiveValue as number) - 335.35) < 1e-6, `presolve off: ${off.objectiveValue}`);
  assert.ok(off.mipDualBound !== null && Math.abs(off.mipDualBound - 335.35) < 1e-6, `presolve off proves it: dual bound ${off.mipDualBound}`);
  const on = await getNativeHighs().solveStructured(lp, { ...BASE });
  const wrong = on.modelStatus.name === 'Optimal' && Math.abs((on.objectiveValue as number) - 335.35) > 1e-6;
  t.diagnostic(`presolve on: ${on.modelStatus.name} ${on.objectiveValue}, dual bound ${on.mipDualBound}${wrong ? ' (wrong: the maximum is 335.35)' : ''}`);
});

test('the COUNT model node [1.5, 3] of TED world 2105 (count_presolve_off_wrong_optimal.lp): at the production integrality tolerance of 1e-7 (owner decision 5b) presolve off with the default seed returns the true optimum 100 with a dual bound of at least 100; at 1e-9 HiGHS 1.15.1 may report Optimal 93.6 with a dual bound of 93.6', async t => {
  // Seeded world `randomTedWorld(2105, false)`, weight node [1.5, 3], request weights 1 / 0 / 0, TrueErgo, equipment modifier +0.2. Three templates (t1: 22 ergonomics and two
  // slots, t3: 9, t2: 5). The physical build {t1, t1, t3, t3} (2.75 kg, raw ergonomics 87, x 1.2 = 104.4, clamped 100, no weight penalty below 3 kg) scores 100, and the
  // occurrence model of the same request returns it (tests/physical/countVsOccurrence.test.ts). The truth below does not depend on the defect: the model pinned to that
  // build is FEASIBLE and its objective is 100, so the maximum is at least 100. With an integrality tolerance of 1e-9 the root LP of the unpinned model is mis-solved with
  // the default random seed: an Optimal verdict AND a dual bound below 100, which is the number a certificate would be built on (likely a derived integer bound such as
  // 1.9999999982 rounded down). At 1e-7, the tolerance production always uses, the same solve is right; the second opinion (decision 5a) is the other safeguard.
  const lp = model('count_presolve_off_wrong_optimal.lp');
  const at = lp.indexOf('\nBounds\n');
  const pinned = `${lp.slice(0, at)}\n  pin_t1: n_1 = 2\n  pin_t3: n_2 = 2\n  pin_t2: n_3 = 0\n  pin_base: base_0 = 1${lp.slice(at)}`;
  const truth = await native(pinned, { presolve: 'off' });
  assert.equal(truth.status, 'Optimal');
  assert.ok(Math.abs((truth.objective as number) - 100) < 1e-6, `the pinned build scores ${truth.objective}`);
  // The FIXED behavior: the production options (integrality 1e-7, primal and dual feasibility 1e-9), presolve off, every seed production uses.
  const production = nativeSolveOptions(1e-9);
  assert.equal(production.mip_feasibility_tolerance, 1e-7);
  assert.equal(production.primal_feasibility_tolerance, 1e-9);
  assert.equal(production.dual_feasibility_tolerance, 1e-9);
  for (const seed of PRECISE_RANDOM_SEEDS) {
    const fixed = await getNativeHighs().solveStructured(lp, { ...production, presolve: 'off', random_seed: seed });
    assert.equal(fixed.modelStatus.name, 'Optimal', `seed ${seed}`);
    assert.ok(Math.abs((fixed.objectiveValue as number) - 100) < 1e-6, `seed ${seed}: the optimum is found (${fixed.objectiveValue})`);
    assert.ok(fixed.mipDualBound !== null && fixed.mipDualBound >= 100 - 1e-6, `seed ${seed}: the dual bound ${fixed.mipDualBound} is an upper bound of the maximum`);
  }
  // The defect at the old integrality tolerance, reported only (it depends on the default seed of this build).
  const first = await getNativeHighs().solveStructured(lp, { ...BASE, presolve: 'off' });
  const wrong = first.modelStatus.name === 'Optimal' && (first.objectiveValue as number) < 100 - 1e-6;
  t.diagnostic(`integrality 1e-9, presolve off, default seed: ${first.modelStatus.name} ${first.objectiveValue}, dual bound ${first.mipDualBound}${wrong ? ' (WRONG: the maximum is at least 100, so this dual bound is not an upper bound)' : ''}`);
  if (wrong) assert.ok(first.mipDualBound !== null && first.mipDualBound < 100, 'the wrong verdict carries a wrong bound, not only a wrong point');
});
