// HiGHS 1.15.1 presolve on the Fast (template-count) model: a model on which presolve ON reports a SUBOPTIMAL point as Optimal.
//
// tests/physical/solverDefects/fast_presolve_wrong_optimal.lp is the Fast model of the random world of seed 123 (tests/physical/randomWorlds.ts,
// acyclic): 39 columns, 43 rows. Its exact maximum is 335.35 (the Precise model of the same request, and the Fast model with presolve off, both
// return it; the physical build is t2 with t4 in two slots and t5, 6500 RUB). With HiGHS's default presolve the pinned build reports `Optimal`
// 123.37 with a dual bound of 123.37, i.e. a wrong proof, not just a missed incumbent. That is the Fast counterpart of the false `Infeasible`
// recorded in solverDefects.test.ts, and the reason the Fast model is solved with presolve OFF (nativeSolve.ts FAST_PRESOLVE is the one constant to
// change; this phase measured it on 400 random worlds: presolve off agreed with the exact optimum on every nonempty world, presolve on on all but
// this one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getNativeHighs, type HighsOptions } from '../../src/solver/native';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { randomWorld } from './randomWorlds';

const lp = readFileSync(fileURLToPath(new URL('./solverDefects/fast_presolve_wrong_optimal.lp', import.meta.url)), 'utf8');
const STRICT: HighsOptions = { mip_rel_gap: 0, mip_abs_gap: 1e-9, mip_feasibility_tolerance: 1e-9, primal_feasibility_tolerance: 1e-9, dual_feasibility_tolerance: 1e-9 };

test('the fixture model has the exact maximum 335.35 with presolve off, and the pinned build says what it says with presolve on', async t => {
  const off = await getNativeHighs().solveStructured(lp, { ...STRICT, presolve: 'off' });
  assert.equal(off.modelStatus.name, 'Optimal');
  assert.ok(Math.abs((off.objectiveValue as number) - 335.35) < 1e-6, String(off.objectiveValue));
  const on = await getNativeHighs().solveStructured(lp, { ...STRICT });
  t.diagnostic(`presolve on: ${on.modelStatus.name} ${on.objectiveValue}${Math.abs((on.objectiveValue as number) - 335.35) > 1e-6 ? ' (wrong: the maximum is 335.35)' : ''}`);
});

test('the Fast pipeline with presolve off returns the Precise optimum of that world', async () => {
  const { params } = randomWorld(123);
  const exact = await solvePrecise({ params, deadline: performance.now() + 60_000 });
  assert.equal(exact.kind, 'build');
  const fast = await solveFast({ params: { ...params, allowRepeatedParts: true }, deadline: performance.now() + 60_000, presolve: 'off' });
  assert.equal(fast.kind, 'build');
  if (exact.kind === 'build' && fast.kind === 'build') {
    assert.ok(Math.abs(fast.best.score - exact.best.score) < 1e-6, `${fast.best.score} against ${exact.best.score}`);
    assert.equal(exact.best.score, 335.35);
  }
});
