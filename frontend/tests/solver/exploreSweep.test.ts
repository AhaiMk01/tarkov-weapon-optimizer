// The Explore sweep and its total classification (src/solver/exploreSweep.ts, paretoExplorer.ts; ADR 0013 section 6 "Explore: total classification
// and precedence"): the V/I/U/E rules, the seven curve rules and the completed-schedule precedence, invalid schedules, unlaunched targets after a cancel
// or the deadline, errors, points from verified witnesses only, the aggregates, the adaptive sweep generation against the pre-cutover loop, and the
// real solver end to end. Injected fakes stand in for Optimize where the solver is not the point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, OptimizationMetadata, OptimizeResponse } from '../../src/api/client';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import {
  classifyCurve, classifyResponse, countOutcomes, displayFrontier, explorePointOf, isCertifiedInfeasible, isVerifiedWitness,
  paramsOfTarget, runExplore, scheduleProblem, targetsProblem,
} from '../../src/solver/exploreSweep';
import type { ExploreRunRequest, OptimizeFn, SettledTarget, SweepSchedule, SweepTarget } from '../../src/solver/exploreSweep';
import { buildSweepSchedule, exploreRunRequest } from '../../src/solver/paretoExplorer';
import type { ParetoParams } from '../../src/solver/paretoExplorer';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { DEFAULT_OBJECTIVE_TOLERANCE } from '../../src/solver/physical/solvePrecise';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import { solve } from '../../src/solver/solver';
import type { GunLookupEntry, ItemLookup, SolveParams } from '../../src/solver/types';
import { gunWith, lookupOf, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

interface Harness { guard: RuntimeGuard; state: { cancelled: boolean; yields: number; time: number; onYield: (n: number) => void } }

function harness(deadline = 1_000_000): Harness {
  const state = { cancelled: false, yields: 0, time: 0, onYield: (_n: number): void => undefined };
  const guard: RuntimeGuard = {
    deadline, now: () => state.time, cancelled: () => state.cancelled, yieldMacrotask: async () => { state.yields++; state.onYield(state.yields); },
  };
  return { guard, state };
}

const OPT: OptimizationMetadata = { lower_bound: 1, upper_bound: 1, absolute_gap: 0, tolerance: 1e-5, nodes: 1, termination: 'optimal' };
const LIMIT: OptimizationMetadata = { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' };

interface Stats { ergo?: number; recoilV?: number; price?: number }

/** A published witness: optimal and certified by default. */
function witness(stats: Stats = {}, over: Partial<OptimizeResponse> = {}): OptimizeResponse {
  return {
    status: 'optimal', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
    physical_certificate: 'certified_optimal',
    selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: 1, optimization: OPT,
    final_stats: { ergonomics: stats.ergo ?? 50, recoil_vertical: stats.recoilV ?? 80, recoil_horizontal: 40, total_price: stats.price ?? 1000, total_weight: 3, moa: 2 },
    solve_time_ms: 5, ...over,
  };
}
const feasible = (stats: Stats = {}): OptimizeResponse => witness(stats, { status: 'feasible', physical_certificate: 'feasible', optimization: { ...OPT, termination: 'limit' }, reason: PUBLIC_REASONS.timeLimitReached });
const noBuild = (over: Partial<OptimizeResponse>): OptimizeResponse => ({
  status: 'incomplete', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, physical_certificate: 'none',
  selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: null, optimization: LIMIT, solve_time_ms: 5, ...over,
});
const infeasible = (): OptimizeResponse => noBuild({ status: 'infeasible', physical_certificate: 'certified_infeasible', optimization: { ...LIMIT, termination: 'optimal' } });
const fastEmpty = (): OptimizeResponse => noBuild({
  precision_resolved: 'fast', model_qualification: 'approximate', reason: PUBLIC_REASONS.approximateModelInfeasible, optimization: { ...LIMIT, termination: 'optimal' },
});
const provisionalEmpty = (): OptimizeResponse => noBuild({
  moa_qualification: 'provisional_model', reason: PUBLIC_REASONS.provisionalMoaModelInfeasible, optimization: { ...LIMIT, termination: 'optimal' },
});
const timeout = (): OptimizeResponse => noBuild({ reason: PUBLIC_REASONS.timeLimitReached });
const errored = (): OptimizeResponse => noBuild({ status: 'error', precision_resolved: null, model_qualification: null });

const target = (index: number, value = index * 10): SweepTarget => ({
  target_index: index, target_value: value, weights: { ergoWeight: 1, recoilWeight: 0, priceWeight: 0 }, overrides: { minErgonomics: value },
});
const staticSchedule = (n: number): SweepSchedule => ({ targets: Array.from({ length: n }, (_, i) => target(i)) });

const baseRequest = (extra: Partial<ExploreRunRequest> = {}, baseExtra: Partial<ExploreRunRequest['base']> = {}): ExploreRunRequest => ({
  ignore: 'price',
  base: { weaponId: WEAPON, itemLookup: {} as ItemLookup, compatibilityMap: { reachable_items: {}, slot_items: {}, item_to_slots: {}, slot_owner: {} }, ...baseExtra },
  precisionRequest: 'precise',
  nakedRecoilV: 100,
  ...extra,
});

/** An Optimize that plays a script by call order; a function entry may throw. */
const scripted = (items: (OptimizeResponse | (() => OptimizeResponse))[]): { optimize: OptimizeFn; calls: SolveParams[] } => {
  const calls: SolveParams[] = [];
  return { calls, optimize: async params => { calls.push(params); const item = items[calls.length - 1]; if (item === undefined) throw new Error('unexpected extra call'); return typeof item === 'function' ? item() : item; } };
};

const outcomesOf = (r: ExploreResponse): string => r.step_outcomes.map(s => s.outcome).join('');

// ---------------------------------------------------------------------------------------------
// V / I / U / E
// ---------------------------------------------------------------------------------------------

test('V is an independently valid optimal OR feasible witness; a published status without the build is not one', () => {
  assert.equal(classifyResponse(witness()), 'V');
  assert.equal(classifyResponse(feasible()), 'V', 'a feasible witness (time limit, no proof) is a valid point');
  assert.equal(classifyResponse(witness({}, { physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate' })), 'V', 'Fast optimum');
  assert.equal(isVerifiedWitness(witness({}, { final_stats: undefined })), false);
  assert.equal(isVerifiedWitness(witness({}, { objective_value: null })), false);
  assert.equal(isVerifiedWitness(witness({}, { objective_value: NaN })), false);
  assert.equal(isVerifiedWitness(witness({}, { physical_certificate: 'none' })), false, 'optimal needs a certificate of an optimum');
  assert.equal(isVerifiedWitness(witness({}, { status: 'feasible' })), false, 'feasible needs the feasible certificate');
  assert.equal(isVerifiedWitness(witness({}, { slot_pairs: [{ parentInstanceId: 'w', slotId: 's', childInstanceId: 'w/s:a', itemId: 'a' }] })), false, 'one placement per installed occurrence');
  assert.equal(classifyResponse(witness({}, { final_stats: undefined })), 'U');
});

test('I is status infeasible AND certified_infeasible from a Precise MOA-independent proof; Fast and provisional-MOA emptiness are U', () => {
  assert.equal(classifyResponse(infeasible()), 'I');
  assert.equal(isCertifiedInfeasible(infeasible()), true);
  assert.equal(classifyResponse(fastEmpty()), 'U');
  assert.equal(classifyResponse(provisionalEmpty()), 'U');
  assert.equal(classifyResponse(noBuild({ ...fastEmpty(), moa_qualification: 'provisional_model', reason: PUBLIC_REASONS.fastProvisionalMoaModelInfeasible })), 'U');
  assert.equal(classifyResponse({ ...infeasible(), moa_qualification: 'provisional_model' }), 'U', 'a MOA-dependent response is never a physical certificate');
  assert.equal(classifyResponse({ ...infeasible(), precision_resolved: 'fast', model_qualification: 'approximate' }), 'U');
  assert.equal(classifyResponse({ ...infeasible(), physical_certificate: 'none' }), 'U');
  assert.equal(classifyResponse(timeout()), 'U');
  assert.equal(classifyResponse(noBuild({ reason: PUBLIC_REASONS.independentBuildValidationFailed })), 'U');
});

test('E is a response with status error', () => {
  assert.equal(classifyResponse(errored()), 'E');
});

// ---------------------------------------------------------------------------------------------
// The seven curve rules and the precedence
// ---------------------------------------------------------------------------------------------

test('curve_status: the seven rules of ADR 0013 section 6', () => {
  const c = (V: number, I: number, U: number, E: number) => classifyCurve({ V, I, U, E });
  assert.equal(c(5, 0, 0, 0), 'complete', 'rule 1: V = N');
  assert.equal(c(3, 2, 0, 0), 'complete', 'rule 2: V >= 1, I >= 1, V + I = N');
  assert.equal(c(1, 1, 0, 0), 'complete');
  assert.equal(c(3, 0, 2, 0), 'partial', 'rule 3: V >= 1 with U');
  assert.equal(c(3, 0, 0, 1), 'partial', 'rule 3: V >= 1 with E');
  assert.equal(c(2, 2, 1, 1), 'partial', 'rule 3 with I present too');
  assert.equal(c(0, 4, 0, 0), 'infeasible', 'rule 4: I = N');
  assert.equal(c(0, 0, 3, 0), 'invalid', 'rule 5: V = 0 with U');
  assert.equal(c(0, 0, 0, 2), 'invalid', 'rule 5: V = 0 with E');
  assert.equal(c(0, 3, 1, 0), 'invalid', 'rule 5: I with U and no V');
  assert.equal(c(0, 0, 0, 0), 'invalid', 'an empty schedule is never complete or infeasible');
});

test('rules 6 and 7: a cancel that stopped an unfinished schedule is partial with a witness and invalid without (unlaunched targets are U)', async () => {
  // Cancel dispatched across the first yield: target 0 done, targets 1 and 2 never launched.
  for (const [first, status, expected] of [[witness(), 'partial', 'VUU'], [timeout(), 'invalid', 'UUU']] as const) {
    const h = harness();
    h.state.onYield = n => { if (n === 1) h.state.cancelled = true; };
    const { optimize, calls } = scripted([first]);
    const r = await runExplore(baseRequest(), staticSchedule(3), h.guard, optimize);
    assert.equal(calls.length, 1);
    assert.equal(r.curve_status, status);
    assert.equal(outcomesOf(r), expected);
    assert.equal(r.reason, PUBLIC_REASONS.cancelledByUser);
    for (const row of r.step_outcomes.slice(1)) {
      assert.equal(row.outcome, 'U');
      assert.equal(row.reason, PUBLIC_REASONS.cancelledByUser);
      assert.equal(row.status, 'incomplete');
      assert.equal(row.physical_certificate, 'none');
      assert.equal(row.precision_resolved, null);
      assert.equal(row.point_index, null);
      assert.equal(row.optimization.termination, 'limit');
    }
  }
});

test('completed-schedule precedence: a cancel or deadline that arrives after every target is V or I does not downgrade complete or infeasible', async () => {
  const h = harness(100);
  const flip = (r: OptimizeResponse) => () => { h.state.cancelled = true; h.state.time = 1000; return r; };
  const complete = await runExplore(baseRequest(), staticSchedule(3), h.guard, scripted([witness(), infeasible(), flip(witness())]).optimize);
  assert.equal(complete.curve_status, 'complete');
  assert.equal(outcomesOf(complete), 'VIV');
  assert.equal(complete.reason, undefined, 'no stop applies to a finished schedule');
  const h2 = harness(100);
  const flip2 = (r: OptimizeResponse) => () => { h2.state.cancelled = true; return r; };
  const none = await runExplore(baseRequest(), staticSchedule(2), h2.guard, scripted([infeasible(), flip2(infeasible())]).optimize);
  assert.equal(none.curve_status, 'infeasible');
  assert.equal(outcomesOf(none), 'II');
  // The same cancel one target earlier leaves an unfinished schedule.
  const h3 = harness(100);
  const early = await runExplore(baseRequest(), staticSchedule(3), h3.guard, scripted([witness(), () => { h3.state.cancelled = true; return witness(); }]).optimize);
  assert.equal(early.curve_status, 'partial');
  assert.equal(outcomesOf(early), 'VVU');
});

test('every classification of a finished schedule through runExplore: complete, complete with I, partial with U and with E, infeasible, invalid', async () => {
  const run = async (responses: (OptimizeResponse | (() => OptimizeResponse))[]) => runExplore(baseRequest(), staticSchedule(responses.length), harness().guard, scripted(responses).optimize);
  const a = await run([witness({ ergo: 40 }), witness({ ergo: 50 }), feasible({ ergo: 60 })]);
  assert.deepEqual([a.curve_status, outcomesOf(a)], ['complete', 'VVV']);
  const b = await run([witness(), infeasible(), witness({ ergo: 60 })]);
  assert.deepEqual([b.curve_status, outcomesOf(b)], ['complete', 'VIV']);
  const c = await run([witness(), timeout(), witness({ ergo: 60 })]);
  assert.deepEqual([c.curve_status, outcomesOf(c)], ['partial', 'VUV']);
  const d = await run([witness(), () => { throw new Error('boom'); }, fastEmpty()]);
  assert.deepEqual([d.curve_status, outcomesOf(d)], ['partial', 'VEU']);
  const e = await run([infeasible(), infeasible(), infeasible()]);
  assert.deepEqual([e.curve_status, outcomesOf(e)], ['infeasible', 'III']);
  const f = await run([fastEmpty(), provisionalEmpty(), timeout()]);
  assert.deepEqual([f.curve_status, outcomesOf(f)], ['invalid', 'UUU']);
  const g = await run([infeasible(), timeout()]);
  assert.deepEqual([g.curve_status, outcomesOf(g)], ['invalid', 'IU']);
  const h = await run([errored(), () => { throw new Error('boom'); }]);
  assert.deepEqual([h.curve_status, outcomesOf(h)], ['invalid', 'EE']);
  assert.equal(countOutcomes(['V', 'I', 'U', 'E', 'V']).V, 2);
});

// ---------------------------------------------------------------------------------------------
// Errors, deadline, launching
// ---------------------------------------------------------------------------------------------

test('a runtime error is a row (E) and the sweep goes on; its message is the only record of the cause', async () => {
  const { optimize, calls } = scripted([witness(), () => { throw new Error('wasm trap'); }, witness({ ergo: 60, recoilV: 90 })]);
  const r = await runExplore(baseRequest(), staticSchedule(3), harness().guard, optimize);
  assert.equal(calls.length, 3);
  assert.equal(outcomesOf(r), 'VEV');
  const row = r.step_outcomes[1];
  assert.equal(row.status, 'error');
  assert.equal(row.reason, 'wasm trap');
  assert.equal(row.physical_certificate, 'none');
  assert.equal(row.precision_resolved, null);
  assert.equal(row.point_index, null);
  assert.equal(r.curve_status, 'partial');
  assert.equal(r.points.length, 2);
  // A response with status error is the same row.
  const viaStatus = await runExplore(baseRequest(), staticSchedule(1), harness().guard, scripted([errored()]).optimize);
  assert.equal(outcomesOf(viaStatus), 'E');
});

test('a failure that surfaces while a cancel is pending is an unresolved target, not a runtime error', async () => {
  const h = harness();
  const r = await runExplore(baseRequest(), staticSchedule(2), h.guard, scripted([() => { h.state.cancelled = true; throw new Error('worker terminated'); }]).optimize);
  assert.equal(outcomesOf(r), 'UU');
  assert.equal(r.step_outcomes[0].reason, PUBLIC_REASONS.cancelledByUser);
  assert.equal(r.curve_status, 'invalid');
});

test('targets never launched because of the deadline are U with the time-limit reason; the guard is checked before every step including the first', async () => {
  const h = harness(100);
  const calls: number[] = [];
  const optimize: OptimizeFn = async (params) => { calls.push(params.minErgonomics as number); h.state.time += 60; return witness({ ergo: 40 + calls.length }); };
  const r = await runExplore(baseRequest(), staticSchedule(4), h.guard, optimize);
  assert.deepEqual(calls, [0, 10], 'the third step finds the deadline passed (120 >= 100)');
  assert.equal(outcomesOf(r), 'VVUU');
  assert.equal(r.curve_status, 'partial');
  assert.equal(r.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(r.step_outcomes[2].reason, PUBLIC_REASONS.timeLimitReached);
  assert.deepEqual(r.sweep_schedule.map(t => t.target_index), [0, 1, 2, 3], 'every scheduled target is recorded exactly once');
  assert.equal(r.step_outcomes.length, 4);
  // A guard that has already expired launches nothing: every target U, invalid.
  const none = await runExplore(baseRequest(), staticSchedule(2), harness(0).guard, async () => assert.fail('no solve expected'));
  assert.equal(outcomesOf(none), 'UU');
  assert.equal(none.curve_status, 'invalid');
  // Cancel outranks the deadline when both are observed.
  const both = harness(0);
  both.state.cancelled = true;
  assert.equal((await runExplore(baseRequest(), staticSchedule(1), both.guard, async () => assert.fail('no solve expected'))).reason, PUBLIC_REASONS.cancelledByUser);
});

test('an explicit macrotask yield separates steps (none before the first or after the last) and each target is solved once with base + weights + overrides', async () => {
  const h = harness();
  const { optimize, calls } = scripted([witness(), witness({ ergo: 60 }), witness({ ergo: 70 })]);
  const request = baseRequest({}, { maxPrice: 5000, maxMOA: 0, ownedItems: ['x'], fleaAvailable: true });
  const r = await runExplore(request, staticSchedule(3), h.guard, optimize);
  assert.equal(h.state.yields, 2);
  assert.equal(calls.length, 3, 'no solution or certificate is reused across targets');
  assert.equal(calls[1].minErgonomics, 10);
  assert.equal(calls[1].maxPrice, 5000);
  assert.deepEqual(calls[1].ownedItems, ['x']);
  assert.deepEqual([calls[2].ergoWeight, calls[2].recoilWeight, calls[2].priceWeight], [1, 0, 0]);
  assert.equal(calls[2].maxMOA, 0, 'a zero MOA cap is a cap');
  assert.deepEqual(paramsOfTarget(request, target(2, 33)), { ...request.base, objectiveTolerance: DEFAULT_OBJECTIVE_TOLERANCE, ergoWeight: 1, recoilWeight: 0, priceWeight: 0, minErgonomics: 33 });
  assert.equal(r.curve_status, 'complete');
});

// ---------------------------------------------------------------------------------------------
// Invalid schedules
// ---------------------------------------------------------------------------------------------

test('an empty or invalid schedule is invalid with no points, no records and no solve, with the schedule reason', async () => {
  const bad: (SweepSchedule | null | undefined)[] = [
    { targets: [] },
    { targets: [target(1)] },
    { targets: [target(0), target(2)] },
    { targets: [{ ...target(0), target_value: NaN }] },
    { targets: [{ ...target(0), target_value: Infinity }] },
    { targets: [{ ...target(0), weights: { ergoWeight: -1, recoilWeight: 0, priceWeight: 0 } }] },
    { targets: [{ ...target(0), weights: { ergoWeight: 1, recoilWeight: NaN, priceWeight: 0 } }] },
    { targets: [{ ...target(0), overrides: null as never }] },
    { targets: null as never },
    null,
    undefined,
  ];
  for (const schedule of bad) {
    let solved = 0;
    const r = await runExplore(baseRequest(), schedule as SweepSchedule, harness().guard, async () => { solved++; return witness(); });
    assert.equal(solved, 0);
    assert.equal(r.curve_status, 'invalid');
    assert.deepEqual(r.points, []);
    assert.deepEqual(r.sweep_schedule, []);
    assert.deepEqual(r.step_outcomes, []);
    assert.equal(r.reason, PUBLIC_REASONS.invalidExploreSchedule);
    assert.equal(r.precision_resolved, null);
    assert.equal(r.model_qualification, null);
    assert.equal(r.precision_request, 'precise');
    assert.notEqual(scheduleProblem(schedule), null);
  }
  assert.equal(scheduleProblem(staticSchedule(3)), null);
  assert.equal(targetsProblem([target(2), target(3)], 2), null);
});

test('an invalid extension of an adaptive schedule is a programming error, not a silent end of the sweep', async () => {
  const schedule: SweepSchedule = { targets: [target(0)], extend: () => [target(5)] };
  await assert.rejects(runExplore(baseRequest(), schedule, harness().guard, scripted([witness()]).optimize), /extension is invalid/);
});

// ---------------------------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------------------------

test('points come only from verified witnesses and carry the proof fields of their generating result; step rows refer to them', async () => {
  const feas = feasible({ ergo: 55, recoilV: 90, price: 900 });
  const r = await runExplore(baseRequest(), staticSchedule(5), harness().guard, scripted([
    witness({ ergo: 50, recoilV: 80, price: 1000 }), timeout(), infeasible(), feas, errored(),
  ]).optimize);
  assert.equal(outcomesOf(r), 'VUIVE');
  assert.equal(r.points.length, 2, 'U, I and E targets produce no point');
  for (const row of r.step_outcomes) {
    if (row.outcome === 'V') assert.ok(row.point_index !== null && r.points[row.point_index] !== undefined);
    else assert.equal(row.point_index, null);
  }
  const p = r.points[r.step_outcomes[3].point_index as number];
  assert.equal(p.status, 'feasible');
  assert.equal(p.physical_certificate, 'feasible');
  assert.equal(p.precision_request, 'precise');
  assert.equal(p.precision_resolved, 'precise');
  assert.equal(p.model_qualification, 'exact');
  assert.equal(p.moa_qualification, null);
  assert.equal(p.reason, PUBLIC_REASONS.timeLimitReached);
  assert.deepEqual(p.optimization, feas.optimization);
  assert.equal(p.objective_value, 1);
  assert.deepEqual([p.ergo, p.recoil_v, p.price], [55, 90, 900]);
  // The step row repeats the proof fields of the same result.
  const row = r.step_outcomes[3];
  assert.deepEqual([row.status, row.physical_certificate, row.precision_resolved, row.model_qualification, row.moa_qualification], ['feasible', 'feasible', 'precise', 'exact', null]);
  assert.deepEqual(row.optimization, feas.optimization);
  assert.equal(row.reason, PUBLIC_REASONS.timeLimitReached);
});

test('the plotted coordinates are display-rounded as before: 0.1 for ergonomics and recoil, whole roubles', () => {
  const p = explorePointOf(witness({ ergo: 50.04, recoilV: 79.96, price: 1000.4 }), 100);
  assert.deepEqual([p.ergo, p.recoil_v, p.price], [50, 80, 1000]);
  assert.equal(p.recoil_pct, -20);
  assert.equal(explorePointOf(witness({ recoilV: 80 }), 0).recoil_pct, 0, 'no naked recoil: no percentage');
});

test('duplicate and dominated displayed builds keep their V records (point_index null) and the displayed frontier stays sorted', async () => {
  // ignore price: x = ergo, y = recoil_v, cost = price. Points: A (50, 80, 1000), B same plot as A but cheaper, C dominated by B, D on the frontier.
  const r = await runExplore(baseRequest(), staticSchedule(4), harness().guard, scripted([
    witness({ ergo: 50, recoilV: 80, price: 1000 }),
    witness({ ergo: 50, recoilV: 80, price: 800 }),
    witness({ ergo: 45, recoilV: 85, price: 700 }),
    witness({ ergo: 60, recoilV: 90, price: 1200 }),
  ]).optimize);
  assert.equal(outcomesOf(r), 'VVVV', 'coverage is a record of the schedule, not of the display');
  assert.equal(r.curve_status, 'complete');
  assert.deepEqual(r.points.map(p => [p.ergo, p.recoil_v, p.price]), [[50, 80, 800], [60, 90, 1200]], 'the cheaper duplicate wins, the dominated build is dropped, sorted by ergonomics');
  assert.deepEqual(r.step_outcomes.map(s => s.point_index), [null, 0, null, 1]);
  // The same filter for the other axes.
  const mk = (ergo: number, recoilV: number, price: number) => ({ targetIndex: 0, point: explorePointOf(witness({ ergo, recoilV, price }), 100) });
  assert.deepEqual(displayFrontier('recoil', [mk(50, 80, 1000), mk(50, 70, 1000), mk(40, 90, 500)]).map(c => [c.point.ergo, c.point.recoil_v]), [[40, 90], [50, 70]], 'the lower-recoil duplicate wins; the cheaper lower-ergonomics build is not dominated');
  assert.deepEqual(displayFrontier('ergo', [mk(50, 80, 1000), mk(55, 80, 1000), mk(40, 60, 1500)]).map(c => c.point.ergo), [40, 55], 'higher ergonomics wins a tie; sorted by recoil');
});

// ---------------------------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------------------------

test('aggregate precision and model: the uniform resolved mode, the caller resolved mode when nothing ran, null when mixed', async () => {
  const uniform = await runExplore(baseRequest(), staticSchedule(2), harness().guard, scripted([witness(), witness({ ergo: 60 })]).optimize);
  assert.equal(uniform.precision_request, 'precise');
  assert.equal(uniform.precision_resolved, 'precise');
  assert.equal(uniform.model_qualification, 'exact');
  const fast = witness({}, { precision_request: 'auto', precision_resolved: 'fast', model_qualification: 'approximate', physical_certificate: 'approximate_optimal' });
  const fastRun = await runExplore(baseRequest({ precisionRequest: 'auto', preciseMode: false }), staticSchedule(2), harness().guard, scripted([fast, fast]).optimize);
  assert.equal(fastRun.precision_request, 'auto');
  assert.equal(fastRun.precision_resolved, 'fast');
  assert.equal(fastRun.model_qualification, 'approximate');
  const mixed = await runExplore(baseRequest(), staticSchedule(2), harness().guard, scripted([witness(), fast]).optimize);
  assert.equal(mixed.precision_resolved, null, 'per-target fields stay authoritative');
  assert.equal(mixed.model_qualification, null);
  assert.equal(mixed.step_outcomes[1].precision_resolved, 'fast');
  const idle = await runExplore(baseRequest({ preciseMode: true }), staticSchedule(2), harness(0).guard, async () => assert.fail('nothing runs'));
  assert.equal(idle.precision_resolved, 'precise', 'no target resolved a mode: the mode the caller resolved the request to');
  assert.equal(idle.model_qualification, 'exact');
  const unknown = await runExplore(baseRequest(), staticSchedule(2), harness(0).guard, async () => assert.fail('nothing runs'));
  assert.equal(unknown.precision_resolved, null);
});

test('aggregate moa_qualification is provisional_model when the sweep carries a MOA cap (zero included), otherwise null', async () => {
  const withCap = await runExplore(baseRequest({}, { maxMOA: 0 }), staticSchedule(1), harness().guard, scripted([witness({}, { moa_qualification: 'provisional_model', physical_certificate: 'approximate_optimal' })]).optimize);
  assert.equal(withCap.moa_qualification, 'provisional_model');
  const without = await runExplore(baseRequest(), staticSchedule(1), harness().guard, scripted([witness()]).optimize);
  assert.equal(without.moa_qualification, null);
  const unlaunched = await runExplore(baseRequest({}, { maxMOA: 1.5 }), staticSchedule(1), harness(0).guard, async () => assert.fail('nothing runs'));
  assert.equal(unlaunched.moa_qualification, 'provisional_model');
  assert.equal(unlaunched.step_outcomes[0].moa_qualification, 'provisional_model');
  // A MOA-dependent Precise emptiness is U, never I: the sweep cannot be certified infeasible.
  const empty = await runExplore(baseRequest({}, { maxMOA: 1 }), staticSchedule(2), harness().guard, scripted([provisionalEmpty(), provisionalEmpty()]).optimize);
  assert.equal(outcomesOf(empty), 'UU');
  assert.equal(empty.curve_status, 'invalid');
  assert.equal(empty.reason, PUBLIC_REASONS.provisionalMoaModelInfeasible);
  assert.equal(empty.moa_qualification, 'provisional_model');
});

test('total_solve_time_ms is the sweep wall time on the guard clock', async () => {
  const h = harness();
  const r = await runExplore(baseRequest(), staticSchedule(2), h.guard, async () => { h.state.time += 25; return witness(); });
  assert.equal(r.total_solve_time_ms, 50);
});

// ---------------------------------------------------------------------------------------------
// The sweep generation (buildSweepSchedule) against the pre-cutover loop
// ---------------------------------------------------------------------------------------------

const sweepLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { weight: 1, ergo: 40, recoilV: 100, recoilH: 50, slots: [slot('grip', ['g1', 'g2']), slot('stock', ['s1', 's2'])] }),
  ['g1', modWith('g1', { ergo: 5, recoil: -0.02, weight: 0.2, offers: [trader('prapor', 1, 200)] })],
  ['g2', modWith('g2', { ergo: 10, recoil: -0.05, weight: 0.4, offers: [trader('prapor', 1, 800)] })],
  ['s1', modWith('s1', { ergo: 3, recoil: -0.1, weight: 0.5, offers: [trader('prapor', 1, 300)] })],
  ['s2', modWith('s2', { ergo: 12, recoil: 0, weight: 0.3, offers: [trader('prapor', 1, 1500)] })],
);

const paretoParams = (ignore: ParetoParams['ignore'], extra: Partial<ParetoParams> = {}): ParetoParams => {
  const itemLookup = sweepLookup();
  return { weaponId: WEAPON, itemLookup, compatibilityMap: buildCompatibilityMap(WEAPON, itemLookup), ignore, preciseMode: true, ...extra };
};

/** The sweep-target generation of the pre-cutover `explorePareto`, written out: the constraint values it solved, in order. */
function legacyTargets(
  ignore: 'price' | 'recoil' | 'ergo', o: { minErgonomics?: number | null; maxRecoilV?: number | null; steps: number; nakedRecoilV: number },
  low: Stats, high: Stats | null, at: (value: number) => Stats | null,
): number[] {
  const out: number[] = [];
  const steps = Math.max(o.steps, 10);
  if (ignore !== 'ergo') {
    let rangeMin = Math.floor(low.ergo as number);
    let rangeMax = high ? Math.ceil(high.ergo as number) : 100;
    if (o.minErgonomics != null) rangeMin = Math.max(rangeMin, o.minErgonomics);
    rangeMin = Math.max(0, rangeMin);
    rangeMax = Math.min(100, rangeMax);
    if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
    const stepSize = Math.max(1, (rangeMax - rangeMin) / steps);
    let cur = rangeMin;
    while (cur < rangeMax) {
      cur += stepSize;
      if (cur >= rangeMax) break;
      out.push(cur);
      const s = at(cur);
      if (s && (s.ergo as number) > cur) cur = s.ergo as number;
    }
  } else {
    const rangeMin = low.recoilV as number;
    let rangeMax = high ? (high.recoilV as number) : o.nakedRecoilV;
    if (o.maxRecoilV != null) rangeMax = Math.min(rangeMax, o.maxRecoilV);
    if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
    const stepSize = (rangeMax - rangeMin) / steps;
    let cur = rangeMin;
    while (cur < rangeMax) {
      cur += stepSize;
      if (cur >= rangeMax) break;
      out.push(cur);
      const s = at(cur);
      if (s && (s.recoilV as number) > cur) cur = s.recoilV as number;
    }
  }
  return out;
}

/** Run the generated schedule with a response function by constraint value; returns the step constraint values the sweep solved. */
async function generated(
  params: ParetoParams, low: Stats, high: Stats | null, at: (value: number) => Stats | null,
): Promise<{ values: number[]; response: ExploreResponse; schedule: SweepSchedule }> {
  const schedule = buildSweepSchedule(params);
  const values: number[] = [];
  let call = 0;
  const response = await runExplore(exploreRunRequest(params), schedule, harness().guard, async (p) => {
    const i = call++;
    if (i === 0) return witness(low);
    if (i === 1) return high === null ? timeout() : witness(high);
    const value = params.ignore === 'ergo' ? (p.maxRecoilV as number) : (p.minErgonomics as number);
    values.push(value);
    const s = at(value);
    return s === null ? infeasible() : witness(s);
  });
  return { values, response, schedule };
}

test('the generated sweep reproduces the pre-cutover target sequence for all three axes, with the jump to the achieved value', async () => {
  const fns: { name: string; at: (v: number) => Stats | null }[] = [
    { name: 'achieves exactly the constraint', at: v => ({ ergo: v, recoilV: v }) },
    { name: 'overshoots by 0.7', at: v => ({ ergo: v + 0.7, recoilV: v + 0.7 }) },
    { name: 'overshoots by a whole step now and then', at: v => ({ ergo: v + (Math.floor(v) % 3 === 0 ? 9 : 0), recoilV: v + (Math.floor(v) % 3 === 0 ? 9 : 0) }) },
    { name: 'some constraints infeasible', at: v => (Math.floor(v) % 2 === 0 ? null : { ergo: v, recoilV: v }) },
  ];
  for (const ignore of ['price', 'recoil', 'ergo'] as const) {
    for (const extra of [{}, { steps: 25 }, { minErgonomics: 30 }, { maxRecoilV: 95, steps: 4 }] as Partial<ParetoParams>[]) {
      for (const fn of fns) {
        const params = paretoParams(ignore, extra);
        const low = { ergo: 33.4, recoilV: 62.5 };
        const high = { ergo: 71.2, recoilV: 100 };
        const { values, response } = await generated(params, low, high, fn.at);
        const expected = legacyTargets(ignore, { minErgonomics: extra.minErgonomics, maxRecoilV: extra.maxRecoilV, steps: extra.steps ?? 10, nakedRecoilV: 100 }, low, high, fn.at);
        assert.deepEqual(values, expected, `${ignore} ${JSON.stringify(extra)} ${fn.name}`);
        assert.equal(response.sweep_schedule.length, 2 + expected.length);
        assert.deepEqual(response.sweep_schedule.slice(2).map(t => t.target_value), expected, 'step target values are the recorded constraint values');
        assert.deepEqual(response.sweep_schedule.map(t => t.target_index), response.sweep_schedule.map((_, i) => i));
        assert.equal(response.step_outcomes.length, response.sweep_schedule.length, 'one record per scheduled target');
      }
    }
  }
});

test('the endpoints are the first two scheduled targets with the pre-cutover weights; steps use the augmentation weights', () => {
  const TB = 0.0001;
  const w = (t: SweepTarget) => [t.weights.ergoWeight, t.weights.recoilWeight, t.weights.priceWeight];
  const price = buildSweepSchedule(paretoParams('price', { minErgonomics: 25 }));
  assert.deepEqual(price.targets.map(w), [[TB, 1, TB], [1, TB, TB]]);
  assert.deepEqual(price.targets.map(t => t.target_value), [25, 100], 'ends of the ergonomics axis the endpoints solve for');
  const recoil = buildSweepSchedule(paretoParams('recoil'));
  assert.deepEqual(recoil.targets.map(w), [[TB, TB, 1], [1, TB, TB]]);
  const ergo = buildSweepSchedule(paretoParams('ergo', { maxRecoilV: 90 }));
  assert.deepEqual(ergo.targets.map(w), [[TB, 1, TB], [TB, TB, 1]]);
  assert.deepEqual(ergo.targets.map(t => t.target_value), [0, 90], 'the recoil axis: from 0 to the user maximum');
  assert.deepEqual(buildSweepSchedule(paretoParams('ergo')).targets.map(t => t.target_value), [0, 100], 'or to the naked recoil');
});

test('a request that cannot be swept builds an empty schedule, which runExplore reports as invalid without a solve', async () => {
  const bad: ParetoParams[] = [
    paretoParams('price', { weaponId: 'not-a-gun' }),
    paretoParams('price', { steps: NaN }),
    paretoParams('price', { steps: Infinity }),
    { ...paretoParams('price'), ignore: 'bogus' as never },
  ];
  for (const params of bad) {
    const schedule = buildSweepSchedule(params);
    assert.deepEqual(schedule.targets, []);
    const r = await runExplore(exploreRunRequest(params), schedule, harness().guard, async () => assert.fail('no solve for an invalid schedule'));
    assert.equal(r.curve_status, 'invalid');
    assert.equal(r.reason, PUBLIC_REASONS.invalidExploreSchedule);
    assert.deepEqual(r.step_outcomes, []);
  }
});

test('with no usable low endpoint the sweep ends at the endpoints; a failed high endpoint falls back to the top of the axis', async () => {
  const params = paretoParams('price');
  // Low endpoint certified infeasible: no range, no step; both endpoints I (second also infeasible) -> infeasible.
  let call = 0;
  const r = await runExplore(exploreRunRequest(params), buildSweepSchedule(params), harness().guard, async () => { call++; return infeasible(); });
  assert.equal(call, 2);
  assert.equal(outcomesOf(r), 'II');
  assert.equal(r.curve_status, 'infeasible');
  assert.deepEqual(r.points, []);
  // Low endpoint times out, so the high endpoint runs and the sweep is invalid (V = 0 with U).
  call = 0;
  const t = await runExplore(exploreRunRequest(params), buildSweepSchedule(params), harness().guard, async () => (call++ === 0 ? timeout() : witness()));
  assert.equal(outcomesOf(t), 'UV');
  assert.equal(t.curve_status, 'partial');
  // High endpoint not a witness: rangeMax is 100, as before.
  const low = { ergo: 40.5, recoilV: 90 };
  const noHigh = await generated(paretoParams('price'), low, null, v => ({ ergo: v, recoilV: 80 }));
  const expected = legacyTargets('price', { steps: 10, nakedRecoilV: 100 }, low, null, v => ({ ergo: v, recoilV: 80 }));
  assert.deepEqual(noHigh.values, expected);
  assert.ok(expected.length > 0 && expected[expected.length - 1] < 100);
});

test('a stop between the endpoints and the steps leaves the generated next step as an unlaunched U: a sweep that stopped early is never complete', async () => {
  const h = harness();
  const params = paretoParams('price');
  // Cancel dispatched across the yield after the second endpoint: the first step target was generated at that moment, and stays U.
  h.state.onYield = n => { if (n === 2) h.state.cancelled = true; };
  let call = 0;
  const r = await runExplore(exploreRunRequest(params), buildSweepSchedule(params), h.guard, async () => (call++ === 0 ? witness({ ergo: 33.4 }) : witness({ ergo: 71.2 })));
  assert.equal(call, 2);
  assert.equal(r.step_outcomes.length, 3, 'two endpoints and the first generated step');
  assert.equal(outcomesOf(r), 'VVU');
  assert.equal(r.curve_status, 'partial');
  assert.equal(r.reason, PUBLIC_REASONS.cancelledByUser);
  assert.equal(r.sweep_schedule.length, 3);
});

test('exploreRunRequest carries the shared request: constraints, stash, precision flags and the naked recoil', () => {
  const owned = ['g1', 'g1'];
  const params = paretoParams('price', { ownedItems: owned, maxPrice: 9000, maxMOA: 0, precisionRequest: 'auto', fleaAvailable: false });
  const request = exploreRunRequest(params);
  assert.deepEqual(request.base.ownedItems, owned);
  assert.equal(request.base.maxPrice, 9000);
  assert.equal(request.base.maxMOA, 0);
  assert.equal(request.base.fleaAvailable, false);
  assert.equal(request.precisionRequest, 'auto');
  assert.equal(request.preciseMode, true);
  assert.equal(request.nakedRecoilV, 100);
  assert.equal(exploreRunRequest(paretoParams('price')).precisionRequest, 'precise', 'derived from the resolved mode when the caller gave none');
  assert.equal(exploreRunRequest(paretoParams('price', { preciseMode: false })).precisionRequest, 'fast');
  assert.equal('ownedItems' in exploreRunRequest(paretoParams('price')).base, false, 'omitted stash stays omitted');
});

// ---------------------------------------------------------------------------------------------
// The real solver end to end
// ---------------------------------------------------------------------------------------------

const realOptimize: OptimizeFn = (params, guard) => solve({ ...params, guard });
const real = (guard: RuntimeGuard = fixedGuard(performance.now() + 120_000)) => guard;

test('end to end on the real Precise solver: every target a certified optimum, a complete curve, points that the independent validator accepts', async () => {
  for (const ignore of ['price', 'recoil', 'ergo'] as const) {
    const params = paretoParams(ignore);
    const r = await runExplore(exploreRunRequest(params), buildSweepSchedule(params), real(), realOptimize);
    assert.equal(r.curve_status, 'complete', `${ignore}: ${JSON.stringify(r.step_outcomes.map(s => [s.outcome, s.reason]))}`);
    assert.ok(r.step_outcomes.every(s => s.outcome === 'V' && s.status === 'optimal' && s.physical_certificate === 'certified_optimal'));
    assert.equal(r.step_outcomes.length, r.sweep_schedule.length);
    assert.equal(r.precision_resolved, 'precise');
    assert.equal(r.model_qualification, 'exact');
    assert.equal(r.moa_qualification, null);
    assert.ok(r.points.length >= 2);
    for (const p of r.points) {
      const v = validatePhysicalBuild(params.itemLookup, params as SolveParams, {
        base: p.selected_preset?.id === WEAPON ? { kind: 'naked' } : { kind: 'preset', presetId: p.selected_preset?.id as string }, placements: p.slot_pairs,
      }, { requirePathInstanceIds: true });
      assert.equal(v.ok, true, JSON.stringify(v.violations));
    }
  }
});

test('end to end: a budget no build meets is certified infeasible at every target (I = N), Fast and MOA-dependent emptiness are only unresolved', async () => {
  const precise = paretoParams('price', { maxPrice: 10 });
  const r = await runExplore(exploreRunRequest(precise), buildSweepSchedule(precise), real(), realOptimize);
  assert.equal(r.curve_status, 'infeasible');
  assert.equal(outcomesOf(r), 'II');
  assert.ok(r.step_outcomes.every(s => s.status === 'infeasible' && s.physical_certificate === 'certified_infeasible'));
  assert.deepEqual(r.points, []);

  const fast = paretoParams('price', { maxPrice: 10, preciseMode: false });
  const f = await runExplore(exploreRunRequest(fast), buildSweepSchedule(fast), real(), realOptimize);
  assert.equal(outcomesOf(f), 'UU', 'Fast model infeasibility is approximate: not a certificate');
  assert.equal(f.curve_status, 'invalid');
  assert.equal(f.reason, PUBLIC_REASONS.approximateModelInfeasible);
  assert.equal(f.precision_resolved, 'fast');
  assert.equal(f.model_qualification, 'approximate');

  const withCoi = sweepLookup();
  (withCoi[WEAPON] as GunLookupEntry).stats.center_of_impact = 0.0625; // 2.149 MOA: a cap of 0.001 has no build
  const moa = { ...paretoParams('price', { maxMOA: 0.001 }), itemLookup: withCoi, compatibilityMap: buildCompatibilityMap(WEAPON, withCoi) };
  const m = await runExplore(exploreRunRequest(moa), buildSweepSchedule(moa), real(), realOptimize);
  assert.equal(outcomesOf(m), 'UU', 'provisional-MOA emptiness is a model result, not a physical proof');
  assert.equal(m.curve_status, 'invalid');
  assert.equal(m.moa_qualification, 'provisional_model');
  assert.equal(m.reason, PUBLIC_REASONS.provisionalMoaModelInfeasible);
});

test('end to end with a cancel dispatched mid-sweep: the completed targets stay, the generated rest is U, the curve is partial', async () => {
  const h = harness();
  const guard: RuntimeGuard = { ...h.guard, now: () => performance.now(), deadline: performance.now() + 120_000 };
  const params = paretoParams('price');
  let finished = 0;
  // The cancel is dispatched right after the second target's solve returns (the second endpoint); it is observed at the guard check before the first step.
  const optimize: OptimizeFn = async (p, g) => { const response = await realOptimize(p, g); if (++finished === 2) h.state.cancelled = true; return response; };
  const r = await runExplore(exploreRunRequest(params), buildSweepSchedule(params), guard, optimize);
  assert.equal(r.curve_status, 'partial');
  assert.equal(r.step_outcomes.filter(s => s.outcome === 'V').length, 2);
  assert.ok(r.step_outcomes.length >= 3, 'the first generated step is recorded');
  assert.ok(r.step_outcomes.slice(2).every(s => s.outcome === 'U' && s.reason === PUBLIC_REASONS.cancelledByUser));
  assert.equal(r.points.length > 0, true);
});

// settled targets are exposed to extension generators
test('SettledTarget carries the classification and the response the generator reads', () => {
  const st: SettledTarget = { target: target(0), outcome: 'V', response: witness() };
  assert.equal(st.outcome, 'V');
});
