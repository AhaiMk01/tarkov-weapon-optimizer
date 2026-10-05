// How an Explore sweep is shown (src/components/explore/exploreView.ts; ADR 0013 section 6, Phase 2.8 / 2.8b): the plain default line of a sweep that is
// not complete, and, for Details, the curve status with its meaning (discrete
// schedule coverage, never continuous Pareto optimality), the per-target coverage (V / I / U / E counts and which targets are unresolved, with their
// reasons), the runs of several weapons, the points with their proof and qualification fields, snapshots, and the toast. The responses come from the
// real `runExplore`, so the view reads exactly what the worker publishes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, OptimizationMetadata, OptimizeResponse } from '../../src/api/client';
import {
  CURVE_STATUSES, CURVE_TONE, asExploreSnapshot, authorityCounts, coverageOf, curveMeaningKey, curveStatusKey, exploreLineOf, exploreMetaOf, exploreToastOf,
  isExploreResponse, pointsOfRuns, retainedExploreOf, runLineOf, runQualifiers, settledResponseOf, summarizeRuns,
} from '../../src/components/explore/exploreView';
import type { ExploreWeaponRun } from '../../src/components/explore/exploreView';
import { runExplore } from '../../src/solver/exploreSweep';
import type { ExploreRunRequest, OptimizeFn, SweepSchedule, SweepTarget } from '../../src/solver/exploreSweep';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import { CancellationError } from '../../src/solver/runtimeErrors';
import type { ItemLookup } from '../../src/solver/types';
import { WEAPON } from '../physical/lpFixtures';

const OPT: OptimizationMetadata = { lower_bound: 1, upper_bound: 1, absolute_gap: 0, tolerance: 1e-5, nodes: 1, termination: 'optimal' };
const LIMIT: OptimizationMetadata = { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 1e-5, nodes: 0, termination: 'limit' };

const witness = (ergo: number, over: Partial<OptimizeResponse> = {}): OptimizeResponse => ({
  status: 'optimal', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null,
  physical_certificate: 'certified_optimal', selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: 1, optimization: OPT,
  final_stats: { ergonomics: ergo, recoil_vertical: ergo + 20, recoil_horizontal: 40, total_price: ergo * 100, total_weight: 3, moa: 2 }, solve_time_ms: 5, ...over,
});
const noBuild = (over: Partial<OptimizeResponse>): OptimizeResponse => ({
  status: 'incomplete', precision_request: 'precise', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, physical_certificate: 'none',
  selected_items: [], selected_item_ids: [], slot_pairs: [], objective_value: null, optimization: LIMIT, solve_time_ms: 5, ...over,
});
const infeasible = (): OptimizeResponse => noBuild({ status: 'infeasible', physical_certificate: 'certified_infeasible', optimization: { ...LIMIT, termination: 'optimal' } });
const fastEmpty = (): OptimizeResponse => noBuild({ precision_resolved: 'fast', model_qualification: 'approximate', reason: PUBLIC_REASONS.approximateModelInfeasible, optimization: { ...LIMIT, termination: 'optimal' } });
const timeout = (): OptimizeResponse => noBuild({ reason: PUBLIC_REASONS.timeLimitReached });

const guard = (): RuntimeGuard => ({ deadline: 1_000_000, now: () => 0, cancelled: () => false, yieldMacrotask: async () => undefined });
const target = (i: number): SweepTarget => ({ target_index: i, target_value: 40 + i * 5, weights: { ergoWeight: 1, recoilWeight: 0, priceWeight: 0 }, overrides: {} });
const request = (): ExploreRunRequest => ({
  ignore: 'price', precisionRequest: 'precise', nakedRecoilV: 100,
  base: { weaponId: WEAPON, itemLookup: {} as ItemLookup, compatibilityMap: { reachable_items: {}, slot_items: {}, item_to_slots: {}, slot_owner: {} } },
});

/** A real sweep over scripted responses (a function entry throws). */
async function sweep(responses: (OptimizeResponse | (() => OptimizeResponse))[]): Promise<ExploreResponse> {
  const schedule: SweepSchedule = { targets: responses.map((_, i) => target(i)) };
  let n = 0;
  const optimize: OptimizeFn = async () => { const item = responses[n++]; return typeof item === 'function' ? item() : item; };
  return runExplore(request(), schedule, guard(), optimize);
}

const run = (id: string, response: ExploreResponse | null, over: Partial<ExploreWeaponRun> = {}): ExploreWeaponRun => ({
  weaponId: id, weaponName: id.toUpperCase(), response, phase: 'done', ...over,
});

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

test('every curve status has a tone, a headline key and a meaning key', () => {
  assert.deepEqual([...CURVE_STATUSES].sort(), ['complete', 'infeasible', 'invalid', 'partial']);
  assert.deepEqual(CURVE_TONE, { complete: 'success', partial: 'warning', infeasible: 'error', invalid: 'error' });
  assert.deepEqual(CURVE_STATUSES.map(curveStatusKey), ['explore.curve_complete', 'explore.curve_partial', 'explore.curve_infeasible', 'explore.curve_invalid']);
  assert.deepEqual(CURVE_STATUSES.map(curveMeaningKey), CURVE_STATUSES.map(s => `explore.curve_${s}_meaning`));
});

test('coverage of a mixed sweep: the V / I / U / E counts and exactly the unresolved targets, with their reasons and target values', async () => {
  const response = await sweep([witness(40), infeasible(), timeout(), () => { throw new Error('HiGHS native call failed during solve: out of memory'); }, fastEmpty()]);
  assert.equal(response.curve_status, 'partial');
  const coverage = coverageOf(response);
  assert.equal(coverage.total, 5);
  assert.deepEqual(coverage.counts, { V: 1, I: 1, U: 2, E: 1 });
  assert.deepEqual(coverage.unresolved.map(u => [u.targetIndex, u.targetValue, u.outcome]), [[2, 50, 'U'], [3, 55, 'E'], [4, 60, 'U']]);
  // A reason of the closed set is localized (a key); the diagnostic of the E row is shown as it came.
  assert.equal(coverage.unresolved[0].reason?.key, 'reasons.timeLimitReached');
  assert.equal(coverage.unresolved[0].reason?.adviceKey, 'reasons.advice_timeLimitReached');
  assert.equal(coverage.unresolved[1].reason?.key, null);
  assert.equal(coverage.unresolved[1].reason?.text, 'HiGHS native call failed during solve: out of memory');
  assert.equal(coverage.unresolved[1].reason?.kind, 'unknown');
  assert.equal(coverage.unresolved[2].reason?.key, 'reasons.approximateModelInfeasible');
});

test('a complete sweep has nothing unresolved; a complete sweep with a certified-empty target counts it as I; an all-infeasible sweep is I everywhere', async () => {
  const complete = coverageOf(await sweep([witness(40), witness(45), witness(50)]));
  assert.deepEqual([complete.counts, complete.unresolved.length], [{ V: 3, I: 0, U: 0, E: 0 }, 0]);
  const withEmpty = await sweep([witness(40), infeasible(), witness(50)]);
  assert.equal(withEmpty.curve_status, 'complete');
  assert.deepEqual(coverageOf(withEmpty).counts, { V: 2, I: 1, U: 0, E: 0 });
  const none = await sweep([infeasible(), infeasible()]);
  assert.equal(none.curve_status, 'infeasible');
  assert.deepEqual(coverageOf(none).counts, { V: 0, I: 2, U: 0, E: 0 });
});

test('a fallback reason names the cause of targets that carry none (the cancel of a retained snapshot), and never overrides a reason a target has', async () => {
  const live = await new Promise<ExploreResponse>(resolve => {
    void runExplore(request(), { targets: [target(0), target(1), target(2)] }, guard(), async () => witness(40), s => { if (s.launched === 1) resolve(s.response); });
  });
  const withCancel = coverageOf(live, PUBLIC_REASONS.cancelledByUser).unresolved;
  assert.deepEqual(withCancel.map(u => u.reason?.name), ['cancelledByUser', 'cancelledByUser']);
  const mixed = await sweep([witness(40), timeout()]);
  assert.equal(coverageOf(mixed, PUBLIC_REASONS.cancelledByUser).unresolved[0].reason?.name, 'timeLimitReached');
});

test('targets that never launched are U with no reason in a live snapshot, and with the stop reason after a stop', async () => {
  const live = await new Promise<ExploreResponse>(resolve => {
    void runExplore(request(), { targets: [target(0), target(1), target(2)] }, guard(), async () => witness(40), s => { if (s.launched === 1) resolve(s.response); });
  });
  const unresolved = coverageOf(live).unresolved;
  assert.deepEqual(unresolved.map(u => [u.targetIndex, u.outcome, u.reason]), [[1, 'U', null], [2, 'U', null]]);
  const state = { cancelled: false };
  const stopped = await runExplore(request(), { targets: [target(0), target(1)] }, { ...guard(), cancelled: () => state.cancelled, yieldMacrotask: async () => { state.cancelled = true; } }, async () => witness(40));
  assert.deepEqual(coverageOf(stopped).unresolved.map(u => [u.outcome, u.reason?.name]), [['U', 'cancelledByUser']]);
});

// ---------------------------------------------------------------------------------------------
// Runs, points and qualifications
// ---------------------------------------------------------------------------------------------

test('a running sweep counts only the targets that have launched: the waiting ones are not "unresolved" yet', async () => {
  const live = await new Promise<ExploreResponse>(resolve => {
    void runExplore(request(), { targets: [target(0), target(1), target(2), target(3)] }, guard(), async () => witness(40), s => { if (s.launched === 2) resolve(s.response); });
  });
  const raw = coverageOf(live);
  assert.deepEqual(raw.counts, { V: 2, I: 0, U: 2, E: 0 }, 'the raw snapshot lists the two waiting targets as U');
  const running = settledResponseOf(run('a', live, { phase: 'running', launched: 2, scheduled: 4 }));
  assert.ok(running !== null);
  assert.deepEqual(coverageOf(running).counts, { V: 2, I: 0, U: 0, E: 0 }, 'only the launched targets are results');
  assert.deepEqual(coverageOf(running).unresolved, []);
  // A finished, cancelled or retained run is its response unchanged, and so is a run with no progress information.
  assert.equal(settledResponseOf(run('a', live, { phase: 'cancelled', launched: 2, scheduled: 4 })), live);
  assert.equal(settledResponseOf(run('a', live, { phase: 'running' })), live);
  assert.equal(settledResponseOf(run('a', null, { phase: 'running', launched: 1 })), null);
});

test('the points of the runs are tagged with their weapon; their proof and qualification fields survive', async () => {
  const fast = await sweep([witness(40, { physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate' }), witness(50, { physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate' })]);
  const exact = await sweep([witness(45), witness(55)]);
  const points = pointsOfRuns([run('a', fast), run('b', exact), run('c', null, { phase: 'running' })]);
  assert.deepEqual(points.map(p => [p.weapon_id, p.weapon_name]), [['a', 'A'], ['a', 'A'], ['b', 'B'], ['b', 'B']]);
  assert.ok(points.slice(0, 2).every(p => p.physical_certificate === 'approximate_optimal' && p.model_qualification === 'approximate'));
  assert.ok(points.slice(2).every(p => p.physical_certificate === 'certified_optimal'));
  assert.deepEqual(authorityCounts(points), { certified_optimal: 2, approximate_optimal: 2, feasible: 0, incomplete: 0, certified_infeasible: 0, error: 0 });
});

test('a sweep of Fast results is approximate even though it is complete, and a provisional-MOA sweep says so', async () => {
  const fastPoint = witness(40, { physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate' });
  const fast = await sweep([fastPoint, { ...fastPoint, final_stats: { ...fastPoint.final_stats!, ergonomics: 50, recoil_vertical: 70 } }]);
  assert.equal(fast.curve_status, 'complete');
  assert.deepEqual(runQualifiers([run('a', fast)]), ['fast_model'], 'complete coverage is not a proof');
  const moa = await sweep([witness(40, { physical_certificate: 'approximate_optimal', moa_qualification: 'provisional_model' })]);
  assert.deepEqual(runQualifiers([run('a', moa)]), ['provisional_moa']);
  assert.deepEqual(runQualifiers([run('a', await sweep([witness(40), witness(50)]))]), []);
  assert.deepEqual(runQualifiers([run('a', null)]), []);
});

// ---------------------------------------------------------------------------------------------
// Several weapons and the toast
// ---------------------------------------------------------------------------------------------

test('summary of several runs: running is informational; all complete is success; nothing but empty or invalid sweeps is an error; anything else warns', async () => {
  const complete = await sweep([witness(40), witness(45)]);
  const partial = await sweep([witness(40), timeout()]);
  const empty = await sweep([infeasible(), infeasible()]);
  const invalid = await sweep([timeout(), timeout()]);
  assert.equal(summarizeRuns([run('a', complete), run('b', null, { phase: 'running' })], 2).tone, 'info');
  const done = summarizeRuns([run('a', complete), run('b', complete)], 2);
  assert.deepEqual([done.tone, done.allComplete, done.byCurve.complete], ['success', true, 2]);
  assert.equal(summarizeRuns([run('a', complete), run('b', partial)], 2).tone, 'warning');
  assert.equal(summarizeRuns([run('a', empty), run('b', invalid)], 2).tone, 'error');
  assert.equal(summarizeRuns([run('a', complete), run('b', empty)], 2).tone, 'warning', 'a weapon with no build among complete ones is not an all-clear');
  const failed = summarizeRuns([run('a', complete), run('b', null, { phase: 'failed', error: 'boom' })], 2);
  assert.deepEqual([failed.tone, failed.failed, failed.allComplete], ['warning', 1, false]);
  const cancelled = summarizeRuns([run('a', partial, { phase: 'cancelled' })], 3);
  assert.deepEqual([cancelled.cancelled, cancelled.allComplete, cancelled.tone], [1, false, 'info'], 'a cancel is informational, not an error');
  assert.equal(summarizeRuns([], 0).allComplete, false, 'nothing run is not complete');
});

test('the toast of a finished Explore: "complete" only for full coverage, a cancel is info and keeps its points, failures and gaps are said', async () => {
  const complete = await sweep([witness(40), witness(45)]);
  const partial = await sweep([witness(40), timeout()]);
  const empty = await sweep([infeasible(), infeasible()]);
  const invalid = await sweep([timeout()]);
  assert.deepEqual(exploreToastOf([run('a', complete)], 1), { type: 'success', key: 'toast.explore_success', params: {} });
  assert.deepEqual(exploreToastOf([run('a', partial)], 1), { type: 'warning', key: 'explore.notice_partial', params: {} });
  assert.deepEqual(exploreToastOf([run('a', partial, { phase: 'cancelled' })], 1), { type: 'info', key: 'toast.explore_cancelled', params: { count: partial.points.length } });
  assert.deepEqual(exploreToastOf([run('a', complete), run('b', null, { phase: 'failed', error: 'x' })], 2), { type: 'warning', key: 'toast.explore_compare_partial', params: { failed: 1, total: 2 } });
  assert.deepEqual(exploreToastOf([run('a', null, { phase: 'failed', error: 'x' })], 1), { type: 'error', key: 'toast.explore_failed', params: {} });
  assert.deepEqual(exploreToastOf([run('a', empty), run('b', empty)], 2), { type: 'error', key: 'toast.explore_infeasible', params: { names: 'A, B' } });
  assert.deepEqual(exploreToastOf([run('a', invalid)], 1), { type: 'warning', key: 'toast.explore_empty', params: {} });
});

// ---------------------------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------------------------

test('a published snapshot is validated before the UI reads it; a CancellationError carries one', async () => {
  const response = await sweep([witness(40), witness(45)]);
  assert.equal(isExploreResponse(response), true);
  assert.equal(isExploreResponse({ curve_status: 'bogus', points: [], step_outcomes: [], sweep_schedule: [] }), false);
  assert.equal(isExploreResponse({ curve_status: 'complete' }), false);
  assert.equal(isExploreResponse(null), false);
  const snapshot = { launched: 2, scheduled: 4, response };
  assert.deepEqual(asExploreSnapshot(snapshot), snapshot);
  assert.equal(asExploreSnapshot({ launched: 'x', scheduled: 4, response }), null);
  assert.equal(asExploreSnapshot({ launched: 2, scheduled: 4, response: { curve_status: 'complete' } }), null);
  assert.equal(asExploreSnapshot(undefined), null);
  assert.deepEqual(retainedExploreOf(new CancellationError('Cancelled by user', snapshot)), snapshot);
  assert.equal(retainedExploreOf(new CancellationError()), null);
  assert.equal(retainedExploreOf(new CancellationError('Cancelled by user', { status: 'model_witnessed' })), null, 'a floor snapshot is not an Explore one');
  assert.equal(retainedExploreOf(new Error('plain')), null);
});

// ---------------------------------------------------------------------------------------------
// The plain default line (owner decision 2026-10-05: the chart is the result; a plain line only when the sweep is not complete)
// ---------------------------------------------------------------------------------------------

test('the default line of a sweep, by curve status: none when complete, one plain sentence otherwise (invalid names its reason like an Optimize result)', async () => {
  const complete = await sweep([witness(40), witness(45)]);
  const withEmpty = await sweep([witness(40), infeasible(), witness(50)]);
  const partial = await sweep([witness(40), timeout()]);
  const empty = await sweep([infeasible(), infeasible()]);
  const invalidTimeout = await sweep([timeout(), timeout()]);
  const invalidFast = await sweep([fastEmpty()]);
  const invalidSchedule = await runExplore(request(), { targets: [] }, guard(), async () => witness(40));
  assert.equal(complete.curve_status, 'complete');
  assert.equal(runLineOf(run('a', complete)), null, 'complete: nothing but the chart');
  assert.equal(runLineOf(run('a', withEmpty)), null, 'complete with a proved-empty target: nothing');
  assert.deepEqual(runLineOf(run('a', partial)), { key: 'explore.notice_partial', params: {}, tone: 'warning' });
  assert.deepEqual(runLineOf(run('a', empty)), { key: 'explore.notice_infeasible', params: {}, tone: 'error' });
  assert.deepEqual(runLineOf(run('a', invalidTimeout)), { key: 'notice.none_time', params: {}, tone: 'warning' });
  assert.deepEqual(runLineOf(run('a', invalidFast)), { key: 'notice.fast_empty', params: {}, tone: 'warning' });
  assert.equal(invalidSchedule.curve_status, 'invalid');
  assert.deepEqual(runLineOf(run('a', invalidSchedule)), { key: 'notice.invalid_schedule', params: {}, tone: 'warning' });
});

test('every curve status and run phase has exactly one default line, and none of them uses the coverage wording (that is in Details)', async () => {
  const responses: Record<string, ExploreResponse> = {
    complete: await sweep([witness(40), witness(45)]),
    partial: await sweep([witness(40), timeout()]),
    infeasible: await sweep([infeasible(), infeasible()]),
    invalid: await sweep([timeout()]),
  };
  assert.deepEqual(Object.keys(responses).sort(), [...CURVE_STATUSES].sort(), 'every curve status is covered');
  for (const [status, response] of Object.entries(responses)) {
    for (const phase of ['done', 'cancelled', 'failed', 'running'] as const) {
      const line = runLineOf(run('a', response, { phase, launched: 1, scheduled: 3 }));
      const label = `${status} ${phase}`;
      if (phase === 'done' && status === 'complete') { assert.equal(line, null, label); continue; }
      assert.ok(line !== null, label);
      assert.ok(!line.key.startsWith('explore.curve_') && !line.key.includes('coverage'), `${label}: ${line.key}`);
    }
  }
  assert.deepEqual(runLineOf(run('a', responses.partial, { phase: 'running', launched: 2, scheduled: 4 })), { key: 'explore.running_progress', params: { launched: 2, scheduled: 4 }, tone: 'info' });
  assert.deepEqual(runLineOf(run('a', null, { phase: 'running' })), { key: 'explore.running', params: {}, tone: 'info' });
  assert.deepEqual(runLineOf(run('a', responses.partial, { phase: 'cancelled' })), { key: 'explore.cancelled_kept', params: { count: 1 }, tone: 'info' });
  assert.deepEqual(runLineOf(run('a', responses.invalid, { phase: 'cancelled' })), { key: 'notice.cancelled_none', params: {}, tone: 'info' }, 'a cancel that kept no point says only "Cancelled"');
  assert.deepEqual(runLineOf(run('a', null, { phase: 'failed', error: 'boom' })), { key: 'notice.error', params: {}, tone: 'error' });
  assert.deepEqual(runLineOf(run('a', responses.partial, { phase: 'failed', error: 'boom' })), { key: 'notice.error', params: {}, tone: 'warning' }, 'a failed sweep that kept points is a warning');
});

test('the default line of several weapons: progress of the live one, a cancel keeps and counts the points, partial when any point exists, else no builds / the reason', async () => {
  const complete = await sweep([witness(40), witness(45)]);
  const partial = await sweep([witness(40), timeout()]);
  const empty = await sweep([infeasible(), infeasible()]);
  const invalid = await sweep([timeout()]);
  assert.equal(exploreLineOf([run('a', complete), run('b', complete)], 2), null, 'every weapon complete: nothing');
  assert.equal(exploreLineOf([], 0), null);
  assert.equal(exploreLineOf([run('a', complete)], 1), null, 'a single complete weapon has no line');
  assert.deepEqual(exploreLineOf([run('a', complete), run('b', null, { phase: 'running', launched: 1, scheduled: 5 })], 2), { key: 'explore.running_progress', params: { launched: 1, scheduled: 5 }, tone: 'info' });
  assert.deepEqual(exploreLineOf([run('a', complete), run('b', partial, { phase: 'cancelled' })], 2), { key: 'explore.cancelled_kept', params: { count: 3 }, tone: 'info' });
  assert.deepEqual(exploreLineOf([run('a', complete), run('b', partial)], 2), { key: 'explore.notice_partial', params: {}, tone: 'warning' });
  assert.deepEqual(exploreLineOf([run('a', complete), run('b', null, { phase: 'failed', error: 'x' })], 2), { key: 'explore.notice_partial', params: {}, tone: 'warning' }, 'a failure beside a weapon with points is a gap in the points');
  assert.deepEqual(exploreLineOf([run('a', empty), run('b', empty)], 2), { key: 'explore.notice_infeasible', params: {}, tone: 'error' });
  assert.deepEqual(exploreLineOf([run('a', null, { phase: 'failed', error: 'x' }), run('b', null, { phase: 'failed', error: 'y' })], 2), { key: 'notice.error', params: {}, tone: 'error' });
  assert.deepEqual(exploreLineOf([run('a', empty), run('b', invalid)], 2), { key: 'notice.none_time', params: {}, tone: 'warning' });
  assert.deepEqual(exploreLineOf([run('a', partial)], 1), runLineOf(run('a', partial)), 'a single weapon uses its own line');
});

test('the quiet facts of an Explore request: total time, and the one mode every weapon ran in', async () => {
  const fast = { ...(await sweep([witness(40)])), precision_request: 'auto' as const, precision_resolved: 'fast' as const };
  const precise = { ...(await sweep([witness(40)])), precision_request: 'auto' as const, precision_resolved: 'precise' as const };
  assert.deepEqual(exploreMetaOf([run('a', fast)], 1234.4), { ms: 1234, request: 'auto', mode: 'fast' });
  assert.deepEqual(exploreMetaOf([run('a', fast), run('b', fast)], 10), { ms: 10, request: 'auto', mode: 'fast' });
  assert.deepEqual(exploreMetaOf([run('a', fast), run('b', precise)], 10), { ms: 10, request: 'auto', mode: null }, 'weapons that ran in different modes show no single mode');
  assert.deepEqual(exploreMetaOf([run('a', null, { phase: 'running' })], undefined), { ms: null, request: null, mode: null });
  assert.equal(exploreMetaOf([run('a', fast)], 0).ms, null);
});

test('the coverage wording is still computed for Details: the curve status keys, the V / I / U / E counts and the authority counts', async () => {
  const response = await sweep([witness(40), infeasible(), timeout()]);
  assert.equal(curveStatusKey(response.curve_status), 'explore.curve_partial');
  assert.deepEqual(coverageOf(response).counts, { V: 1, I: 1, U: 1, E: 0 });
  assert.deepEqual(authorityCounts(response.points), { certified_optimal: 1, approximate_optimal: 0, feasible: 0, incomplete: 0, certified_infeasible: 0, error: 0 });
});
