// The presolve policy (src/solver/physical/nativeSolve.ts): the physical models are solved with presolve off (one named constant), and no
// infeasibility verdict is ever accepted from a presolved solve: HiGHS 1.15.1 with presolve on reports some feasible models Infeasible, so
// such a verdict is confirmed with presolve off before it is used. The logic is checked with an injected solver, and the real defect is
// checked on the kept fixture with the pinned native build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SolverError, getNativeHighs } from '../../src/solver/native';
import type { HighsOptions, ModelStatusName, NativeResult } from '../../src/solver/native';
import { FAST_PRESOLVE, PRECISE_PRESOLVE, nativeSolveOptions, nativeTimeLimitSeconds, solveWithPresolvePolicy } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';

const CODES: Record<string, number> = { Optimal: 7, Infeasible: 8, UnboundedOrInfeasible: 9, TimeLimit: 13, SolveError: 4, ModelError: 2 };

function fakeResult(status: ModelStatusName, solution = false): NativeResult {
  return {
    modelStatus: { code: CODES[status] ?? 0, name: status },
    colValues: solution ? new Float64Array([1]) : null,
    colNames: solution ? ['x'] : null,
    readStatus: 'ok',
  } as unknown as NativeResult;
}

interface Call { options: HighsOptions }

/** A solver that answers from a script and records the options of every call. */
function scripted(...answers: (NativeResult | Error)[]): { solve: SolveFn; calls: Call[] } {
  const calls: Call[] = [];
  const solve: SolveFn = async (_lp, options) => {
    calls.push({ options });
    const answer = answers[calls.length - 1];
    if (answer === undefined) throw new Error('unexpected extra solve');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { solve, calls };
}

const NOW = { now: () => 0, deadline: 10_000, options: {} satisfies HighsOptions };
/** The confirmation path only exists for a first solve with presolve on. */
const ON = { ...NOW, presolve: 'choose' } as const;

test('both model families are solved with presolve off by default (a presolved Optimal is as untrustworthy as a presolved Infeasible), one named setting each', async () => {
  assert.equal(PRECISE_PRESOLVE, 'off');
  assert.equal(FAST_PRESOLVE, 'off');
  const { solve, calls } = scripted(fakeResult('Optimal', true));
  const outcome = await solveWithPresolvePolicy('lp', { ...NOW, solve });
  assert.equal(outcome.kind, 'solved');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.presolve, 'off');
  assert.equal(calls[0].options.time_limit, 10);
  assert.equal(outcome.kind === 'solved' && outcome.presolveRescue, false);
  const on = scripted(fakeResult('Optimal', true));
  await solveWithPresolvePolicy('lp', { ...ON, solve: on.solve });
  assert.equal(on.calls[0].options.presolve, 'choose', 'a caller can ask for presolve on');
});

test('an Infeasible from a presolve-off first solve is its own confirmation: one call, no re-solve, the verdict stands', async () => {
  for (const first of ['Infeasible', 'UnboundedOrInfeasible'] as const) {
    const { solve, calls } = scripted(fakeResult(first));
    const outcome = await solveWithPresolvePolicy('lp', { ...NOW, solve });
    assert.equal(outcome.kind, 'infeasible', first);
    assert.equal(outcome.kind === 'infeasible' && outcome.confirmation, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.presolve, 'off');
  }
});

test('a limit stop is not an infeasibility verdict: it is passed on with whatever solution it holds, with no confirmation solve', async () => {
  for (const solution of [false, true]) {
    const { solve, calls } = scripted(fakeResult('TimeLimit', solution));
    const outcome = await solveWithPresolvePolicy('lp', { ...ON, solve });
    assert.equal(outcome.kind, 'solved');
    assert.equal(calls.length, 1);
  }
});

test('an Infeasible with presolve on is re-solved with presolve off, and a solution found there is the answer', async () => {
  const { solve, calls } = scripted(fakeResult('Infeasible'), fakeResult('Optimal', true));
  const outcome = await solveWithPresolvePolicy('lp', { ...ON, solve });
  assert.equal(outcome.kind, 'solved');
  assert.equal(outcome.kind === 'solved' && outcome.presolveRescue, true, 'the presolve defect is recorded');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.presolve, 'choose', 'the first solve runs with presolve on');
  assert.equal(calls[1].options.presolve, 'off');
});

test('an Infeasible confirmed with presolve off is a confirmed verdict; UnboundedOrInfeasible is treated the same way', async () => {
  for (const first of ['Infeasible', 'UnboundedOrInfeasible'] as const) {
    const { solve, calls } = scripted(fakeResult(first), fakeResult('Infeasible'));
    const outcome = await solveWithPresolvePolicy('lp', { ...ON, solve });
    assert.equal(outcome.kind, 'infeasible', first);
    assert.ok(outcome.kind === 'infeasible' && outcome.confirmation !== null);
    assert.equal(calls.length, 2);
  }
});

test('a confirmation that times out, errors, or ends without an answer leaves the verdict unresolved, never infeasible', async () => {
  const timedOut = scripted(fakeResult('Infeasible'), fakeResult('TimeLimit'));
  const a = await solveWithPresolvePolicy('lp', { ...ON, solve: timedOut.solve });
  assert.deepEqual(a.kind === 'unresolved' && a.cause, 'deadline');
  const failed = scripted(fakeResult('Infeasible'), new SolverError('solve', new Error('wasm trap')));
  const b = await solveWithPresolvePolicy('lp', { ...ON, solve: failed.solve });
  assert.equal(b.kind, 'unresolved');
  assert.equal(b.kind === 'unresolved' && b.cause, 'native_error');
  const odd = scripted(fakeResult('Infeasible'), fakeResult('SolveError'));
  const c = await solveWithPresolvePolicy('lp', { ...ON, solve: odd.solve });
  assert.equal(c.kind === 'unresolved' && c.cause, 'native_error');
  // A limit stop that holds a solution proves the model feasible after all.
  const found = scripted(fakeResult('Infeasible'), fakeResult('TimeLimit', true));
  const d = await solveWithPresolvePolicy('lp', { ...ON, solve: found.solve });
  assert.equal(d.kind === 'solved' && d.presolveRescue, true);
});

test('no time left: nothing is solved to begin with, and an infeasibility that leaves no time to confirm is unresolved', async () => {
  const none = scripted();
  const start = await solveWithPresolvePolicy('lp', { options: {}, deadline: 0, now: () => 0, solve: none.solve });
  assert.equal(start.kind === 'unresolved' && start.cause, 'deadline');
  assert.equal(none.calls.length, 0);
  let clock = 0;
  const slow: SolveFn = async () => { clock = 10; return fakeResult('Infeasible'); };
  const late = await solveWithPresolvePolicy('lp', { options: {}, deadline: 10, now: () => clock, solve: slow, presolve: 'choose' });
  assert.equal(late.kind === 'unresolved' && late.cause, 'deadline');
});

test('a model status that is neither optimal, a limit nor an infeasibility claim is a typed native error, not a result', async () => {
  for (const status of ['SolveError', 'ModelError'] as const) {
    const { solve } = scripted(fakeResult(status));
    await assert.rejects(solveWithPresolvePolicy('lp', { ...NOW, solve }), (error: unknown) => error instanceof SolverError && /unexpected model status/.test(error.message));
  }
  const failing = scripted(new SolverError('solve', new Error('wasm trap')));
  await assert.rejects(solveWithPresolvePolicy('lp', { ...NOW, solve: failing.solve }), SolverError, 'a native failure of the first solve is not swallowed');
});

test('the native time allowance is positive and at least a millisecond; the options follow the requested tolerance with no floor', () => {
  assert.equal(nativeTimeLimitSeconds(0.2), 0.001);
  assert.equal(nativeTimeLimitSeconds(2500), 2.5);
  const strict = nativeSolveOptions(1e-9);
  assert.equal(strict.mip_abs_gap, 2.5e-10, 'a 1e-9 request is not floored at 1e-7');
  assert.equal(strict.mip_rel_gap, 0);
  // owner decision 5b: integrality 1e-7 for EVERY request tolerance, primal and dual feasibility 1e-9
  for (const tau of [0, 1e-9, 1e-7, 1e-5, 1]) {
    const options = nativeSolveOptions(tau);
    assert.equal(options.mip_feasibility_tolerance, 1e-7, `integrality at tolerance ${tau}`);
    assert.equal(options.primal_feasibility_tolerance, 1e-9);
    assert.equal(options.dual_feasibility_tolerance, 1e-9);
  }
  assert.equal(nativeSolveOptions(1e-5).mip_abs_gap, 1e-9, 'a loose request never loosens the native search past the pre-cutover value');
  assert.equal(nativeSolveOptions(0).mip_abs_gap, 0);
  assert.equal(nativeSolveOptions(-1).mip_abs_gap, 0, 'a negative tolerance is read as zero');
});

// ---- the real defect, on the pinned native build ---------------------------------------------------------

const fixture = readFileSync(fileURLToPath(new URL('./solverDefects/native_presolve_false_infeasible.lp', import.meta.url)), 'utf8');

test('the kept fixture: the pinned build calls a feasible model Infeasible with presolve on; the default (presolve off) never sees it, and presolve on is caught', async () => {
  // x_3 or x_7 is installed (pin), so u_2 >= 1, one lot of 150 covers it, and price 5000 + 150 <= 5850: plainly feasible.
  const raw = await getNativeHighs().solveStructured(fixture);
  assert.equal(raw.modelStatus.name, 'Infeasible', 'the pinned HiGHS 1.15.1 presolve defect (every option at its default); if this fails the artifact changed');
  const off = await getNativeHighs().solveStructured(fixture, { presolve: 'off' });
  assert.equal(off.modelStatus.name, 'Optimal', 'with presolve off the model is feasible');

  const byDefault = await solveWithPresolvePolicy(fixture, { options: {}, deadline: performance.now() + 60_000 });
  assert.equal(byDefault.kind, 'solved', 'presolve off solves it on the first call');
  assert.ok(byDefault.kind === 'solved' && !byDefault.presolveRescue);

  const outcome = await solveWithPresolvePolicy(fixture, { options: {}, deadline: performance.now() + 60_000, presolve: 'choose' });
  assert.equal(outcome.kind, 'solved', 'the false verdict is never used');
  assert.ok(outcome.kind === 'solved' && outcome.presolveRescue, 'it was rescued by the presolve-off confirmation');
  if (outcome.kind !== 'solved') return;
  assert.equal(outcome.result.modelStatus.name, 'Optimal');
  const values = new Map(outcome.result.colNames!.map((name, k) => [name, outcome.result.colValues![k]]));
  assert.ok((values.get('x_3') ?? 0) + (values.get('x_7') ?? 0) > 0.5);
  assert.ok((values.get('price_axis') ?? Infinity) <= 5850 + 1e-6);
});

test('the policy flags a result of a presolved first solve; a presolve-off solve, and a rescue by one, are not presolved', async () => {
  const off = await solveWithPresolvePolicy('lp', { ...NOW, solve: scripted(fakeResult('Optimal', true)).solve });
  assert.equal(off.kind === 'solved' && off.presolved, false);
  const on = await solveWithPresolvePolicy('lp', { ...ON, solve: scripted(fakeResult('Optimal', true)).solve });
  assert.equal(on.kind === 'solved' && on.presolved, true, 'a presolved Optimal is a witness, never a proof');
  const limited = await solveWithPresolvePolicy('lp', { ...ON, solve: scripted(fakeResult('TimeLimit', true)).solve });
  assert.equal(limited.kind === 'solved' && limited.presolved, true);
  const rescued = await solveWithPresolvePolicy('lp', { ...ON, solve: scripted(fakeResult('Infeasible'), fakeResult('Optimal', true)).solve });
  assert.equal(rescued.kind === 'solved' && rescued.presolveRescue, true);
  assert.equal(rescued.kind === 'solved' && rescued.presolved, false, 'the rescuing solve ran with presolve off');
});
