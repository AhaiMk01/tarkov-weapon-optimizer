// The native stop of a floor query on the pinned HiGHS build (ADR 0013 section 6, ADR 0004 section 6): `mip_max_improving_sols = 1` is EFFECTIVE (the
// structured status is SolutionLimit after the first improving incumbent, the effective option the solver read back is 1) and SCOPED to the floor
// call (the next solve on the same engine, without the option, runs to Optimal). Effective values and statuses come from the structured native
// result, never from the presence of an option name in the build. Also the adapter from a Precise result to a floor query result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup } from '../../src/solver/types';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import {
  floorQueryParams, floorQueryResultOf, MOA_FLOOR_NATIVE_STOP, preciseFloorQuery, runMoaFloorDetailed,
} from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { nativeSolve, nativeSolveOptions, solveWithPresolvePolicy } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { knapsackLp } from '../native/fixtures';
import { gunWith, lookupOf, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

const generous = () => fixedGuard(performance.now() + 120_000);
/**
 * A solve that was not asked for the option has none in its effective options: the wrapper creates a fresh HiGHS handle per solve and reads back only
 * the options it set, so the absence (together with a run to Optimal on the same engine) is the evidence that the floor option did not leak.
 */
const UNSET = undefined;

test('mip_max_improving_sols = 1 stops a model with several improving incumbents at SolutionLimit; the next solve on the same engine runs to Optimal', async () => {
  const lp = knapsackLp(120, 7);
  const deadline = performance.now() + 120_000;
  const options = nativeSolveOptions(1e-5);

  const limited = await solveWithPresolvePolicy(lp, { options: { ...options, ...MOA_FLOOR_NATIVE_STOP }, deadline });
  assert.equal(limited.kind, 'solved');
  const first = (limited as Extract<typeof limited, { kind: 'solved' }>).result;
  assert.deepEqual(first.modelStatus, { code: 16, name: 'SolutionLimit' }, 'the structured status, not Optimal and not TimeLimit');
  assert.equal(first.effectiveOptions.mip_max_improving_sols, 1, 'the value HiGHS holds after the setters ran');
  assert.ok(first.colValues !== null, 'the first improving incumbent is returned');

  // Scoped: the very next solve on the same engine, with the floor option absent, is a normal solve to optimality.
  const plain = await solveWithPresolvePolicy(lp, { options, deadline });
  const second = (plain as Extract<typeof plain, { kind: 'solved' }>).result;
  assert.equal(second.modelStatus.name, 'Optimal');
  assert.equal(second.effectiveOptions.mip_max_improving_sols, UNSET, 'the option did not leak into the next call');
  assert.equal(second.runtimeId, first.runtimeId, 'both solves ran on the same engine instance');
  // Several improving incumbents existed: the first one is strictly worse than the optimum (a maximization).
  assert.ok((first.objectiveValue as number) < (second.objectiveValue as number) - 1e-6);
  // And the stop left a proven bound above the incumbent, which is information a floor query never claims as a proof of its own.
  assert.ok((first.mipDualBound as number) >= (second.objectiveValue as number) - 1e-6);
});

test('the floor pipeline asks every native solve for the single improving solution, and the following Optimize-style solve on the same engine does not inherit it', async () => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('barrel', ['b_wide', 'b_best'], true), slot('optic', ['scope'])] }),
    ['b_wide', modWith('b_wide', { coi: 0.125 })],
    ['b_best', modWith('b_best', { coi: 0.015625, offers: [trader('prapor', 1, 500)] })],
    ['scope', modWith('scope', { accuracy: 10, offers: [trader('prapor', 1, 300)] })],
  );
  const request: MoaFloorRequest = { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), fleaAvailable: true };
  const seen: { options: Record<string, unknown>; effective: unknown; status: string; runtime: unknown }[] = [];
  const recording: SolveFn = async (lpText, options, extras) => {
    const result: NativeResult = await nativeSolve(lpText, options, extras);
    seen.push({ options: { ...options }, effective: result.effectiveOptions.mip_max_improving_sols, status: result.modelStatus.name, runtime: result.runtimeId });
    return result;
  };
  const run = await runMoaFloorDetailed(request, generous(), { solve: recording });
  assert.equal(run.response.status, 'model_proved');
  assert.ok(seen.length >= 2, 'the seed and at least one trial reached the native build');
  for (const call of seen) {
    assert.equal(call.options.mip_max_improving_sols, 1, 'requested on every floor MIP sub-solve');
    assert.equal(call.effective, 1, 'and effective in the engine');
    assert.ok(['Optimal', 'SolutionLimit', 'Infeasible'].includes(call.status), call.status);
  }

  // An ordinary Precise solve on the same engine afterwards: no floor option, a normal optimum.
  const ordinary: { effective: unknown; status: string; runtime: unknown }[] = [];
  const ordinaryRecorder: SolveFn = async (lpText, options, extras) => {
    const result = await nativeSolve(lpText, options, extras);
    ordinary.push({ effective: result.effectiveOptions.mip_max_improving_sols, status: result.modelStatus.name, runtime: result.runtimeId });
    return result;
  };
  const params = { ...floorQueryParams(request, null), ergoWeight: 1, recoilWeight: 0, priceWeight: 0 };
  const normal = await solvePrecise({ params, guard: generous(), solve: ordinaryRecorder });
  assert.equal(normal.kind, 'build');
  assert.equal(normal.kind === 'build' && normal.certified, true);
  assert.equal(ordinary.length, 2, 'the solve and its second opinion (decision 5a)');
  for (const call of ordinary) {
    assert.equal(call.effective, UNSET, 'not scoped to the floor call: nothing leaked');
    assert.equal(call.status, 'Optimal');
    assert.equal(call.runtime, seen[0].runtime, 'the same engine served the floor and the ordinary solve');
  }
});

// ---------------------------------------------------------------------------------------------
// The adapter from a Precise result to a floor query result
// ---------------------------------------------------------------------------------------------

const fixture = (): { request: MoaFloorRequest; lookup: ItemLookup } => {
  const lookup = lookupOf(
    gunWith(WEAPON, { coi: 0.0625, slots: [slot('barrel', ['b_wide', 'b_best'], true)] }),
    ['b_wide', modWith('b_wide', { coi: 0.125 })],
    ['b_best', modWith('b_best', { coi: 0.015625, offers: [trader('prapor', 1, 500)] })],
  );
  return { lookup, request: { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), fleaAvailable: true } };
};

test('a Precise build is a witness whatever ended the native search: optimal, solution limit and a withheld proof all give hi, with the stop recorded', async () => {
  const { request } = fixture();
  const params = floorQueryParams(request, null);
  const result = await solvePrecise({ params, guard: generous(), nativeStop: MOA_FLOOR_NATIVE_STOP });
  assert.equal(result.kind, 'build');
  const build = result as Extract<PreciseResult, { kind: 'build' }>;

  const optimal = floorQueryResultOf(request, params, null, build);
  assert.equal(optimal.kind, 'witness');
  if (optimal.kind !== 'witness') return;
  // b_wide (4.297 MOA) or b_best (0.537 MOA): either is a witness; the achieved value is the upward enclosure of the validator's exact MOA.
  assert.ok(optimal.witness.achievedMoa >= Number(build.best.stats.moa));
  assert.equal(optimal.witness.moaExact, build.best.stats.exact.moa);
  assert.equal(optimal.witness.build.achieved_moa, optimal.witness.achievedMoa);
  assert.equal(optimal.witness.build.scope.max_moa, null, 'the seed has no cap');
  assert.equal(build.outcome.termination, 'optimal');
  assert.equal(optimal.witness.nativeStop, 'optimal', 'a single-root constant-zero solve finishes natively');

  // The label is the native status of the solve that produced the witness (F2, owner 2026-10-12), never inferred from the query's reason.
  assert.equal(build.best.nativeStatus, 'Optimal');
  const stopped = (nativeStatus: string, reason: string, termination: 'limit' | 'optimal') => floorQueryResultOf(request, params, null, {
    ...build, best: { ...build.best, nativeStatus }, certified: false, outcome: { ...build.outcome, status: 'feasible', physical_certificate: 'feasible', termination, reason },
  });
  const limited = stopped('SolutionLimit', PUBLIC_REASONS.nativeSolutionLimitReached, 'limit');
  assert.equal(limited.kind === 'witness' && limited.witness.nativeStop, 'solution_limit');
  const timed = stopped('TimeLimit', PUBLIC_REASONS.timeLimitReached, 'limit');
  assert.equal(timed.kind === 'witness' && timed.witness.nativeStop, 'other');
  const withheld = stopped('Optimal', PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, 'optimal');
  assert.equal(withheld.kind === 'witness' && withheld.witness.nativeStop, 'optimal', 'the native search completed; only the proof was withheld');
  const relabelled = stopped('Optimal', PUBLIC_REASONS.nativeSolutionLimitReached, 'limit');
  assert.equal(relabelled.kind === 'witness' && relabelled.witness.nativeStop, 'optimal', 'F2: a solution-limit REASON does not relabel a native Optimal');

  // A trial's witness must meet its cap exactly or it is rejected, never adopted.
  const tooTight = floorQueryResultOf(request, params, build.best.stats.moa - 0.001, build);
  assert.deepEqual(tooTight, { kind: 'stopped', reason: PUBLIC_REASONS.independentBuildValidationFailed });
});

test('emptiness is qualified only for a completed Precise search: the seed needs a certificate, a trial the provisional-model emptiness', async () => {
  const { request } = fixture();
  const seedParams = floorQueryParams({ ...request, maxPrice: 10 }, null);
  const seed = await solvePrecise({ params: seedParams, guard: generous(), nativeStop: MOA_FLOOR_NATIVE_STOP });
  assert.equal(seed.kind, 'empty');
  const seedResult = floorQueryResultOf({ ...request, maxPrice: 10 }, seedParams, null, seed);
  assert.deepEqual(seedResult, { kind: 'empty', qualified: true });

  const trialParams = floorQueryParams(request, 0.1);
  const trial = await solvePrecise({ params: trialParams, guard: generous(), nativeStop: MOA_FLOOR_NATIVE_STOP });
  assert.equal(trial.kind, 'empty');
  assert.deepEqual(floorQueryResultOf(request, trialParams, 0.1, trial), { kind: 'empty', qualified: true, reason: PUBLIC_REASONS.provisionalMoaModelInfeasible });

  // Not qualified: a search that did not complete, or one that ran the Fast model, is not emptiness.
  const unfinished = { ...trial, outcome: { ...trial.outcome, termination: 'limit' as const } };
  assert.equal((floorQueryResultOf(request, trialParams, 0.1, unfinished) as { qualified: boolean }).qualified, false);
  const fast = { ...trial, outcome: { ...trial.outcome, precision_resolved: 'fast' as const, model_qualification: 'approximate' as const, reason: PUBLIC_REASONS.fastProvisionalMoaModelInfeasible } };
  assert.equal((floorQueryResultOf(request, trialParams, 0.1, fast) as { qualified: boolean }).qualified, false);
  const uncertified = { ...seed, outcome: { ...seed.outcome, status: 'incomplete' as const, physical_certificate: 'none' as const } };
  assert.equal((floorQueryResultOf(request, seedParams, null, uncertified) as { qualified: boolean }).qualified, false);
});

test('an incomplete Precise result is a stop with its public reason; a query with no time left launches no solve', async () => {
  const { request } = fixture();
  const params = floorQueryParams(request, null);
  const incomplete: PreciseResult = {
    kind: 'incomplete', reason: PUBLIC_REASONS.timeLimitReached,
    outcome: { status: 'incomplete', physical_certificate: 'none', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, termination: 'limit', reason: PUBLIC_REASONS.timeLimitReached },
    summary: {} as never,
  };
  assert.deepEqual(floorQueryResultOf(request, params, null, incomplete), { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached });

  let solves = 0;
  const query = preciseFloorQuery(request, async () => { solves++; throw new Error('no native call expected'); });
  const expired = await query(1, fixedGuard(performance.now() - 1));
  assert.deepEqual(expired, { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached });
  const cancelled = await query(1, fixedGuard(performance.now() + 60_000, { cancelled: () => true }));
  assert.deepEqual(cancelled, { kind: 'stopped', reason: PUBLIC_REASONS.cancelledByUser });
  assert.equal(solves, 0);
});
