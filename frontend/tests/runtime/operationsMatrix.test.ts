// The Stage 3 operations transition matrix (workstream 3.5; ADR 0013 sections 4D, 5 and 6; owner decision 2d as amended). Every operation runs
// through the REAL worker runtime with the real solve, the real Explore and MOA floor drivers and the pinned native build (operationsMatrix.harness.ts):
//
//   operations  Optimize Fast, Optimize Precise, Optimize Auto, Gunsmith optimize (the same `optimize` message with the App's Gunsmith request), Explore,
//               MOA floor, and the metadata operations (loadData, getInfo, getWeaponMods, getGunsmithTasks, getStatus, clearCache);
//   causes      normal completion, queue expiry, cancel while queued, cancel while running (out of band, delivered as a task), invalid owned_items, the
//               deadline before the model, during the solve (before and after a verified witness) and during the second opinion, a withheld bound,
//               an independent validation failure, the cyclic-part-graph refusal, and (Explore) an invalid schedule;
//   precedence  every pair of those causes that can co-occur (ADR 0013 section 6).
//
// Each cell asserts the public envelope: status, certificate, reason, termination, and the points / witness. Cells already proved elsewhere are listed
// with their test in docs/stage3/operations-evidence.md; the ones here are the gaps and the uniform runtime-level row of each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, MOAFloorResponse, OptimizeResponse } from '../../src/api/client';
import { SolverError as NativeSolverError } from '../../src/solver/native/errors';
import { PUBLIC_REASON_SET, PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { SerializedWorkerError } from '../../src/solver/runtimeErrors';
import { yieldMacrotask } from '../../src/solver/runtimeGuard';
import type { WorkerDeps } from '../../src/solver/workerRuntime';
import {
  asTimeLimit, assertPreModelEnvelope, cancelOf, cyclicLookup, EXPLORE, FLOOR, GUNSMITH, messageOf, metadataMessage, METADATA_OPERATIONS, OPTIMIZE_AUTO,
  OPTIMIZE_FAST, OPTIMIZE_OPERATIONS, OPTIMIZE_PRECISE, overfilled, rig, SEARCH_OPERATIONS, sweepLookup, T0, tedLookup, withheld, withNative,
} from './operationsMatrix.harness';
import type { AnyResponse, NativeHook, Operation, Rig } from './operationsMatrix.harness';
import type { ItemLookup } from '../../src/solver/types';

const R = PUBLIC_REASONS;
const LATE = T0 + 1e9;
/** The TrueErgo form of an Optimize request: a spatial search with more than one node on `tedLookup`. */
const TED = { use_true_ergo: true, ergo_weight: 100, recoil_weight: 0 };

interface Run<T> { rig: Rig; response: T; calls: number }

/**
 * One request of `op` through a fresh real runtime. `setup` may arm the rig (a hook inside the data load) and return a native hook; `overrides`
 * replace runtime collaborators (the macrotask yield). The response is the terminal payload, which must not be an error.
 */
async function run<T = AnyResponse>(
  op: Operation,
  options: { extra?: Record<string, unknown>; lookup?: ItemLookup; setup?: (r: Rig) => NativeHook | void; overrides?: (r: { rig?: Rig }) => Partial<WorkerDeps>; deadline?: number } = {},
): Promise<Run<T>> {
  const holder: { rig?: Rig } = {};
  const r = rig(options.lookup ?? op.lookup(), options.overrides?.(holder) ?? {});
  holder.rig = r;
  const hook = options.setup?.(r) ?? null;
  let calls = 0;
  const counted: NativeHook = async (call, real) => { calls++; return hook === null ? real() : hook(call, real); };
  r.send(messageOf(op, 1, options.extra, options.deadline));
  await withNative(counted, () => r.runtime.idle());
  return { rig: r, response: r.result<T>(1), calls };
}

/** A macrotask yield that also passes the deadline when the test armed it: the clock moves while a stage runs and is observed at the next guard. */
const expiringYield = (state: { armed: boolean }) => (h: { rig?: Rig }): Partial<WorkerDeps> => ({
  yieldMacrotask: async () => {
    await yieldMacrotask();
    if (state.armed && h.rig !== undefined) h.rig.clock.t = LATE;
  },
});

const asOptimize = (x: AnyResponse) => x as OptimizeResponse;
const asExplore = (x: AnyResponse) => x as ExploreResponse;
const asFloor = (x: AnyResponse) => x as MOAFloorResponse;

/** Every reason a response carries is in the closed set (an Explore E row's diagnostic is the one documented exception). */
function assertClosedReasons(op: Operation, response: AnyResponse): void {
  const reasons: (string | undefined)[] = [response.reason];
  if (op.kind === 'explore') {
    const e = asExplore(response);
    for (const s of e.step_outcomes) if (s.outcome !== 'E') reasons.push(s.reason);
    for (const p of e.points) reasons.push(p.reason);
  }
  for (const reason of reasons) if (reason !== undefined) assert.ok(PUBLIC_REASON_SET.has(reason), `${op.name}: "${reason}" is outside the closed reason set`);
}

/**
 * A stop of an Optimize-family request: status / certificate, the reason, the termination and whether the verified build was kept. A kept build is a
 * nonempty manifest with a lower bound; none is an empty manifest, a null objective and a null lower bound.
 */
function assertOptimizeStop(op: Operation, response: AnyResponse, want: { status: string; reason: string; termination: 'optimal' | 'limit'; build: boolean }): void {
  const r = asOptimize(response);
  assert.equal(r.status, want.status, `${op.name}: ${r.status} ${r.reason ?? ''}`);
  assert.equal(r.physical_certificate, want.status === 'feasible' ? 'feasible' : want.status === 'incomplete' ? 'none' : r.physical_certificate, op.name);
  assert.equal(r.reason, want.reason, op.name);
  assert.equal(r.optimization.termination, want.termination, op.name);
  assert.equal(r.precision_request, op.precisionRequest, op.name);
  assert.equal(r.precision_resolved, op.precise ? 'precise' : 'fast', `${op.name}: the resolved model is reported for a request that reached the model`);
  assert.equal(r.model_qualification, op.precise ? 'exact' : 'approximate', op.name);
  if (want.build) {
    assert.ok(r.selected_items.length > 0 && r.slot_pairs.length > 0 && r.final_stats !== undefined, `${op.name}: the verified build is kept`);
    assert.ok(r.optimization.lower_bound !== null, `${op.name}: the witness keeps its lower bound`);
  } else {
    assert.deepEqual([r.selected_items, r.slot_pairs], [[], []], `${op.name}: no build`);
    assert.equal(r.objective_value, null, op.name);
    assert.equal(r.optimization.lower_bound, null, `${op.name}: no witness, no lower bound`);
  }
  if (!op.precise) assert.equal(r.optimization.upper_bound, null, `${op.name}: Fast never carries a physical upper bound`);
  assertClosedReasons(op, r);
}

// =====================================================================================================================================
// A. Each search operation, each cause
// =====================================================================================================================================

for (const op of SEARCH_OPERATIONS) {
  test(`${op.name}: normal completion — the public envelope of a finished request`, async () => {
    const { response } = await run(op);
    if (op.kind === 'optimize') {
      const r = asOptimize(response);
      assert.equal(r.status, 'optimal', r.reason);
      assert.equal(r.physical_certificate, op.precise ? 'certified_optimal' : 'approximate_optimal');
      assert.equal(r.reason, undefined);
      assert.equal(r.optimization.termination, 'optimal');
      assert.equal(r.precision_request, op.precisionRequest);
      assert.equal(r.precision_resolved, op.precise ? 'precise' : 'fast');
      assert.equal(r.model_qualification, op.precise ? 'exact' : 'approximate');
      assert.equal(r.moa_qualification, null);
      assert.ok(r.selected_items.length > 0 && r.final_stats !== undefined);
      assert.ok(r.optimization.lower_bound !== null);
      if (op.precise) {
        assert.ok(r.optimization.upper_bound !== null && r.optimization.absolute_gap !== null && r.optimization.absolute_gap <= r.optimization.tolerance, 'a justified gap');
      } else {
        assert.equal(r.optimization.upper_bound, null);
      }
      if (op === GUNSMITH) assert.ok(r.selected_item_ids.includes('g1'), 'the required part is installed');
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'complete');
      assert.equal(r.reason, undefined);
      assert.equal(r.step_outcomes.length, r.sweep_schedule.length);
      assert.ok(r.step_outcomes.every(s => s.outcome === 'V' && s.physical_certificate === 'certified_optimal' && s.optimization.termination === 'optimal'));
      assert.ok(r.points.length >= 2 && r.points.every(p => p.physical_certificate === 'certified_optimal'));
      assert.deepEqual([r.precision_resolved, r.model_qualification, r.moa_qualification], ['precise', 'exact', null]);
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'model_proved');
      assert.equal(r.reason, undefined);
      assert.equal(r.moa_qualification, 'provisional_model');
      assert.ok(r.witness !== undefined && r.floor === r.witness.achieved_moa);
      assert.ok(r.proved_lower_bound !== null && (r.floor as number) - r.proved_lower_bound <= 0.02);
      assert.ok(r.display_floor !== null && r.display_floor >= (r.floor as number));
    }
    assertClosedReasons(op, response);
  });

  test(`${op.name}: queue expiry — the operation envelope with Queue timeout before dispatch, nothing loaded or solved`, async () => {
    const r = rig(op.lookup());
    r.send(messageOf(op, 1, {}, T0 - 1));
    let calls = 0;
    await withNative(async (_c, real) => { calls++; return real(); }, () => r.runtime.idle());
    assert.equal(r.loads(), 0);
    assert.equal(calls, 0);
    assertPreModelEnvelope(op, r.result<AnyResponse>(1), R.queueTimeoutBeforeDispatch);
  });

  test(`${op.name}: cancel while queued — Cancelled by user, and the cancel outranks a coincident queue expiry`, async () => {
    for (const expired of [false, true]) {
      const r = rig(op.lookup());
      // A request ahead of it holds the worker; the request under test waits in the queue and is cancelled there (and, optionally, also expires).
      r.send(messageOf(OPTIMIZE_FAST, 99));
      r.send(messageOf(op, 1, {}, expired ? T0 + 1 : undefined));
      r.send(cancelOf(1));
      if (expired) r.clock.t = T0 + 10;
      await withNative(async (_c, real) => real(), () => r.runtime.idle());
      assertPreModelEnvelope(op, r.result<AnyResponse>(1), R.cancelledByUser);
      assert.equal(r.loads(), 1, 'only the blocking request loaded data');
    }
  });

  test(`${op.name}: invalid owned_items — the null envelope before any load or model work, and it outranks a coincident expiry and cancel`, async () => {
    for (const bad of [[''], ['a', 1], new Array<string>(2), 'a', Array.from({ length: 10_001 }, () => 'a')]) {
      const r = rig(op.lookup());
      r.send(messageOf(op, 1, { owned_items: bad }, T0 - 1));
      r.send(cancelOf(1));
      await withNative(async (_c, real) => real(), () => r.runtime.idle());
      assert.equal(r.loads(), 0);
      assertPreModelEnvelope(op, r.result<AnyResponse>(1), R.invalidOwnedItems);
    }
  });

  test(`${op.name}: deadline before the model (passed after dispatch, during the data load) — Time limit reached, nothing solved`, async () => {
    const { response, calls } = await run(op, { setup: r => { r.duringLoad(() => { r.clock.t = LATE; }); } });
    assert.equal(calls, 0, 'no native call');
    if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'incomplete', reason: R.timeLimitReached, termination: 'limit', build: false });
      assert.equal(asOptimize(response).optimization.nodes, 0);
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'invalid', 'rule 5: V = 0 with U');
      assert.equal(r.reason, R.timeLimitReached);
      assert.deepEqual(r.points, []);
      assert.ok(r.sweep_schedule.length >= 1 && r.step_outcomes.length === r.sweep_schedule.length);
      assert.ok(r.step_outcomes.every(s => s.outcome === 'U' && s.reason === R.timeLimitReached && s.physical_certificate === 'none'), 'unlaunched targets are U with the reason');
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'unresolved');
      assert.equal(r.reason, R.timeLimitReached);
      assert.deepEqual([r.floor, r.display_floor, r.proved_lower_bound, r.witness], [null, null, null, undefined]);
    }
  });

  test(`${op.name}: deadline during the solve before any verified build (the native call reaches its time allowance) — no build, Time limit reached`, async () => {
    const { response } = await run(op, {
      setup: r => async (call, real) => {
        const result = await real();
        if (call.index !== 0) return result;
        r.clock.t = LATE;
        return asTimeLimit(result);
      },
    });
    if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'incomplete', reason: R.timeLimitReached, termination: 'limit', build: false });
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'invalid');
      assert.equal(r.reason, R.timeLimitReached);
      assert.ok(r.step_outcomes.every(s => s.outcome === 'U' && s.reason === R.timeLimitReached));
      assert.deepEqual(r.points, []);
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'unresolved');
      assert.equal(r.reason, R.timeLimitReached);
      assert.equal(r.witness, undefined);
    }
  });

  test(`${op.name}: deadline during the second opinion — the verified build is kept without a certificate (Fast: there is no second opinion)`, async () => {
    const seeds: number[] = [];
    const { response } = await run(op, {
      setup: r => async (call, real) => {
        seeds.push(call.seed);
        const result = await real();
        if (call.seed !== 11) return result;
        r.clock.t = LATE;
        return asTimeLimit(result);
      },
    });
    if (!op.precise) {
      assert.ok(seeds.every(s => Number.isNaN(s)), 'Fast sets no random seed: no second opinion');
      assertOptimizeStop(op, response, { status: 'optimal', reason: undefined as unknown as string, termination: 'optimal', build: true });
      return;
    }
    assert.ok(seeds.includes(11), 'a second opinion ran');
    if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'feasible', reason: R.timeLimitReached, termination: 'limit', build: true });
      const r = asOptimize(response);
      assert.ok(r.optimization.upper_bound !== null, 'the first opinion\'s qualified bound is retained as justified');
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'partial', 'rule 3: V >= 1 with U');
      assert.equal(r.reason, R.timeLimitReached);
      assert.equal(r.step_outcomes[0].outcome, 'V');
      assert.deepEqual([r.step_outcomes[0].status, r.step_outcomes[0].physical_certificate, r.step_outcomes[0].reason], ['feasible', 'feasible', R.timeLimitReached]);
      assert.ok(r.step_outcomes.slice(1).every(s => s.outcome === 'U' && s.reason === R.timeLimitReached));
      assert.equal(r.points.length, 1);
      assert.equal(r.points[0].physical_certificate, 'feasible');
    } else {
      // A floor witness needs no second opinion (first-witness policy); the second opinion confirms an EMPTINESS, which is what raises lo. Cut short, it
      // raises nothing: the seed witness is kept, minimum not proved.
      const r = asFloor(response);
      assert.equal(r.status, 'model_witnessed');
      assert.equal(r.reason, R.timeLimitReached);
      assert.equal(r.proved_lower_bound, null, 'an unconfirmed emptiness never raises lo');
      assert.ok(r.witness !== undefined && r.floor === r.witness.achieved_moa);
    }
  });

  test(`${op.name}: cancel while running, delivered as a task during preparation — observed at the first macrotask yield, nothing evaluated`, async () => {
    const { response, calls } = await run(op, { setup: r => { r.duringLoad(() => { setTimeout(() => r.send(cancelOf(1)), 0); }); } });
    assert.equal(calls, 0);
    if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'incomplete', reason: R.cancelledByUser, termination: 'limit', build: false });
      assert.equal(asOptimize(response).optimization.nodes, 0);
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'invalid', 'rule 7: a cancel that stopped an unfinished schedule with V = 0');
      assert.equal(r.reason, R.cancelledByUser);
      assert.ok(r.step_outcomes.length >= 1 && r.step_outcomes.every(s => s.outcome === 'U' && s.reason === R.cancelledByUser));
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'unresolved');
      assert.equal(r.reason, R.cancelledByUser);
      assert.equal(r.witness, undefined);
    }
  });

  test(`${op.name}: cancel while running after a verified build, delivered as a task — the build is kept with Cancelled by user`, async () => {
    // Optimize: the TrueErgo form, whose second spatial node is never evaluated. Gunsmith never sends TrueErgo: its single-node search finishes before
    // the next macrotask yield, so the late cancel does not downgrade the certified optimum (a completed search is never downgraded).
    const ted = op.kind === 'optimize' && op !== GUNSMITH;
    const { response } = await run(op, {
      ...(ted ? { extra: TED, lookup: tedLookup() } : {}),
      setup: r => async (call, real) => {
        const result = await real();
        if (call.index === 0) setTimeout(() => r.send(cancelOf(1)), 0);
        return result;
      },
    });
    if (op === GUNSMITH) {
      assertOptimizeStop(op, response, { status: 'optimal', reason: undefined as unknown as string, termination: 'optimal', build: true });
      assert.equal(asOptimize(response).physical_certificate, 'certified_optimal');
    } else if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'feasible', reason: R.cancelledByUser, termination: 'limit', build: true });
      assert.equal(asOptimize(response).optimization.nodes, 1);
      assert.equal(asOptimize(response).optimization.upper_bound, null, 'an unfinished spatial search proves no upper bound');
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'partial', 'rule 6: a cancel that stopped an unfinished schedule with V >= 1');
      assert.equal(r.reason, R.cancelledByUser);
      assert.equal(r.step_outcomes[0].outcome, 'V');
      assert.equal(r.step_outcomes[0].physical_certificate, 'certified_optimal');
      assert.ok(r.step_outcomes.slice(1).every(s => s.outcome === 'U' && s.reason === R.cancelledByUser));
      assert.equal(r.points.length, 1);
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'model_witnessed');
      assert.equal(r.reason, R.cancelledByUser);
      assert.ok(r.witness !== undefined);
      assert.equal(r.proved_lower_bound, null);
    }
  });

  test(`${op.name}: deadline during the search after a verified build (observed at the next stage boundary) — the build is kept with Time limit reached`, async () => {
    const ted = op.kind === 'optimize' && op !== GUNSMITH;
    const state = { armed: false };
    const { response } = await run(op, {
      ...(ted ? { extra: TED, lookup: tedLookup() } : {}),
      overrides: expiringYield(state),
      setup: () => async (call, real) => {
        const result = await real();
        if (call.index === 0) state.armed = true;
        return result;
      },
    });
    if (op === GUNSMITH) {
      // One node, no yield before its search completes: the passed deadline is never observed and the certificate stands.
      assertOptimizeStop(op, response, { status: 'optimal', reason: undefined as unknown as string, termination: 'optimal', build: true });
    } else if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'feasible', reason: R.timeLimitReached, termination: 'limit', build: true });
      assert.equal(asOptimize(response).optimization.nodes, 1);
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'partial');
      assert.equal(r.reason, R.timeLimitReached);
      assert.equal(r.step_outcomes[0].outcome, 'V');
      assert.ok(r.step_outcomes.slice(1).every(s => s.outcome === 'U' && s.reason === R.timeLimitReached));
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'model_witnessed');
      assert.equal(r.reason, R.timeLimitReached);
      assert.ok(r.witness !== undefined);
    }
  });

  test(`${op.name}: withheld bound (every native read carries a warning, so no solve is qualified) — no certificate, Required proof prerequisite unavailable`, async () => {
    const { response } = await run(op, { setup: () => async (_call, real) => withheld(await real()) });
    if (!op.precise) {
      // Fast has no proof to withhold: it never reads a bound back and never carries a physical upper bound.
      assertOptimizeStop(op, response, { status: 'optimal', reason: undefined as unknown as string, termination: 'optimal', build: true });
      assert.equal(asOptimize(response).physical_certificate, 'approximate_optimal');
    } else if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'feasible', reason: R.requiredProofPrerequisiteUnavailable, termination: 'optimal', build: true });
      assert.equal(asOptimize(response).optimization.upper_bound, null, 'the withheld bound is null, never 0');
      assert.equal(asOptimize(response).optimization.absolute_gap, null);
    } else if (op.kind === 'explore') {
      // V counts a feasible witness: every target has one, so the discrete schedule is complete, with no certificate anywhere.
      const r = asExplore(response);
      assert.equal(r.curve_status, 'complete');
      assert.ok(r.step_outcomes.every(s => s.outcome === 'V' && s.physical_certificate === 'feasible' && s.reason === R.requiredProofPrerequisiteUnavailable));
      assert.ok(r.points.every(p => p.physical_certificate === 'feasible' && p.optimization.upper_bound === null));
    } else {
      // The seed witness stands; the first trial's emptiness is unqualified, so lo is never raised.
      const r = asFloor(response);
      assert.equal(r.status, 'model_witnessed');
      assert.equal(r.reason, R.requiredProofPrerequisiteUnavailable);
      assert.equal(r.proved_lower_bound, null);
      assert.ok(r.witness !== undefined);
    }
    assertClosedReasons(op, response);
  });

  test(`${op.name}: independent validation failure (every native point is one the validator rejects) — never published, Independent build validation failed`, async () => {
    const { response } = await run(op, { setup: () => async (_call, real) => overfilled(await real()) });
    if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'incomplete', reason: R.independentBuildValidationFailed, termination: 'optimal', build: false });
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'invalid', 'a rejected decoded build is not a point: V = 0');
      assert.equal(r.reason, R.independentBuildValidationFailed);
      assert.ok(r.step_outcomes.every(s => s.outcome === 'U' && s.reason === R.independentBuildValidationFailed));
      assert.deepEqual(r.points, []);
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'unresolved');
      assert.equal(r.reason, R.independentBuildValidationFailed);
      assert.equal(r.witness, undefined);
    }
  });

  test(`${op.name}: cyclic part graph — refused with the pre-model envelope before any solve`, async () => {
    const { response, calls } = await run(op, { lookup: cyclicLookup() });
    assert.equal(calls, 0);
    assertPreModelEnvelope(op, response, R.unsupportedCyclicPartGraph);
  });
}

// =====================================================================================================================================
// B. Precedence of simultaneous causes (ADR 0013 section 6)
// =====================================================================================================================================

for (const op of SEARCH_OPERATIONS) {
  test(`${op.name}: precedence — an observed validation failure outranks a coincident deadline and a coincident cancel`, async () => {
    for (const interrupt of ['deadline', 'cancel'] as const) {
      const { response } = await run(op, {
        setup: r => async (call, real) => {
          const result = overfilled(await real());
          if (call.index === 0) {
            if (interrupt === 'deadline') r.clock.t = LATE;
            else r.send(cancelOf(1));
          }
          return result;
        },
      });
      const label = `${op.name} + ${interrupt}`;
      if (op.kind === 'optimize') {
        // The cut model was never re-solved: an unfinished search (limit), but the failure is the reason.
        assertOptimizeStop(op, response, { status: 'incomplete', reason: R.independentBuildValidationFailed, termination: 'limit', build: false });
      } else if (op.kind === 'explore') {
        // The launched target keeps the validation reason; the aggregate reason is the cause that stopped the schedule (the per-target rows are authoritative).
        const r = asExplore(response);
        assert.equal(r.curve_status, 'invalid', label);
        assert.equal(r.step_outcomes[0].reason, R.independentBuildValidationFailed, label);
        assert.equal(r.reason, interrupt === 'deadline' ? R.timeLimitReached : R.cancelledByUser, label);
        assert.ok(r.step_outcomes.slice(1).every(s => s.outcome === 'U' && s.reason === r.reason), label);
      } else {
        const r = asFloor(response);
        assert.equal(r.status, 'unresolved', label);
        assert.equal(r.reason, R.independentBuildValidationFailed, label);
      }
    }
  });

  test(`${op.name}: precedence — pure simultaneous interrupts: cancel outranks the deadline`, async () => {
    const { response } = await run(op, {
      setup: r => async (call, real) => {
        const result = await real();
        if (call.index !== 0) return result;
        r.clock.t = LATE;
        r.send(cancelOf(1));
        return asTimeLimit(result);
      },
    });
    if (op.kind === 'optimize') {
      assertOptimizeStop(op, response, { status: 'incomplete', reason: R.cancelledByUser, termination: 'limit', build: false });
    } else if (op.kind === 'explore') {
      const r = asExplore(response);
      assert.equal(r.reason, R.cancelledByUser);
      assert.ok(r.step_outcomes.every(s => s.reason === R.cancelledByUser));
    } else {
      assert.equal(asFloor(response).reason, R.cancelledByUser);
    }
  });
}

for (const op of OPTIMIZE_OPERATIONS) {
  test(`${op.name}: precedence — a completed qualified proof is not downgraded by a cancel and a deadline that arrive during the last native solve`, async () => {
    // The flags are raised inside the last native call of the request (the second opinion for Precise, the only solve for Fast): no guard is read after it.
    const last = op.precise ? 11 : Number.NaN;
    const { response } = await run(op, {
      setup: r => async (call, real) => {
        const result = await real();
        if (Object.is(call.seed, last)) { r.clock.t = LATE; r.send(cancelOf(1)); }
        return result;
      },
    });
    const res = asOptimize(response);
    assert.equal(res.status, 'optimal', `${op.name}: ${res.reason ?? ''}`);
    assert.equal(res.physical_certificate, op.precise ? 'certified_optimal' : 'approximate_optimal');
    assert.equal(res.reason, undefined);
    assert.equal(res.optimization.termination, 'optimal');
  });
}

test('Explore and MOA floor: precedence — a completed schedule and a completed bracket proof survive a cancel and a deadline raised in their last native solve', async () => {
  for (const op of [EXPLORE, FLOOR]) {
    const dry = await run(op);
    const lastIndex = dry.calls - 1;
    const { response, calls } = await run(op, {
      setup: r => async (call, real) => {
        const result = await real();
        if (call.index === lastIndex) { r.clock.t = LATE; r.send(cancelOf(1)); }
        return result;
      },
    });
    assert.equal(calls, dry.calls, `${op.name}: the same native calls ran`);
    if (op === EXPLORE) {
      const r = asExplore(response);
      assert.equal(r.curve_status, 'complete', 'completed-schedule precedence');
      assert.equal(r.reason, undefined);
      assert.deepEqual(r.step_outcomes.map(s => s.outcome), asExplore(dry.response).step_outcomes.map(s => s.outcome));
    } else {
      const r = asFloor(response);
      assert.equal(r.status, 'model_proved', 'a completed bracket proof survives a late cancel');
      assert.equal(r.reason, undefined);
      assert.equal(r.floor, asFloor(dry.response).floor);
    }
  }
});

test('precedence — a typed native failure is never rewritten as an interrupt: Optimize and floor fail with the SolverError, Explore records it as an E row', async () => {
  for (const op of SEARCH_OPERATIONS) {
    for (const interrupt of ['deadline', 'none'] as const) {
      const r = rig(op.lookup());
      r.send(messageOf(op, 1));
      const failAt = op.kind === 'explore' ? 2 : op.kind === 'floor' ? 1 : 0; // Explore: the first call of the second target; floor: the first trial
      await withNative(async (call, real) => {
        if (call.index !== failAt) return real();
        if (interrupt === 'deadline') r.clock.t = LATE;
        throw new NativeSolverError('solve', new Error('wasm trap'), false);
      }, () => r.runtime.idle());
      const label = `${op.name} (${interrupt})`;
      if (op.kind === 'explore') {
        const res = r.result<ExploreResponse>(1);
        assert.equal(res.step_outcomes[0].outcome, 'V', label);
        assert.equal(res.step_outcomes[1].outcome, 'E', label);
        assert.match(res.step_outcomes[1].reason ?? '', /HiGHS native call failed during solve/, `${label}: the E row's diagnostic is the failure`);
        assert.equal(res.curve_status, 'partial', `${label}: rule 3, V >= 1 with E`);
        if (interrupt === 'deadline') assert.ok(res.step_outcomes.slice(2).every(s => s.outcome === 'U' && s.reason === R.timeLimitReached), label);
        else {
          // The sweep goes on after an E row. The failed target is the high endpoint, so the steps fall back to the top of the axis (exploreSweep.ts)
          // and the targets beyond what any build reaches are certified infeasible: one real sweep with V, E and I rows.
          const rest = res.step_outcomes.slice(2).map(s => s.outcome);
          assert.ok(rest.length >= 1 && rest.every(o => o === 'V' || o === 'I'), `${label}: ${rest.join('')}`);
          assert.ok(rest.includes('V') && rest.includes('I'), `${label}: ${rest.join('')}`);
          assert.ok(res.step_outcomes.filter(s => s.outcome === 'I').every(s => s.physical_certificate === 'certified_infeasible'), label);
        }
      } else {
        const m = r.terminal(1);
        assert.equal(m.type, 'error', label);
        const payload = m.payload as Exclude<SerializedWorkerError, string>;
        assert.equal(typeof payload === 'object' && payload.kind, 'SolverError', label);
        if (op.kind === 'floor') {
          const snapshots = r.snapshots(1) as MOAFloorResponse[];
          assert.equal(snapshots.length, 1, `${label}: the retained floor state is published before the failure`);
          assert.equal(snapshots[0].status, 'model_witnessed', label);
        }
      }
    }
  }
});

test('precedence at entry — invalid owned_items outranks the cyclic refusal; queue expiry and a queued cancel outrank it too (nothing is loaded)', async () => {
  for (const op of SEARCH_OPERATIONS) {
    const invalid = rig(cyclicLookup());
    invalid.send(messageOf(op, 1, { owned_items: [''] }));
    await invalid.runtime.idle();
    assertPreModelEnvelope(op, invalid.result<AnyResponse>(1), R.invalidOwnedItems);

    const expired = rig(cyclicLookup());
    expired.send(messageOf(op, 1, {}, T0 - 1));
    await expired.runtime.idle();
    assertPreModelEnvelope(op, expired.result<AnyResponse>(1), R.queueTimeoutBeforeDispatch);
    assert.equal(expired.loads(), 0);

    const cancelled = rig(cyclicLookup());
    cancelled.send(messageOf(OPTIMIZE_FAST, 99, {}, T0 - 1)); // a blocker that expires at once, so request 1 is queued when its cancel arrives
    cancelled.send(messageOf(op, 1));
    cancelled.send(cancelOf(1));
    await cancelled.runtime.idle();
    assertPreModelEnvelope(op, cancelled.result<AnyResponse>(1), R.cancelledByUser);
    assert.equal(cancelled.loads(), 0);
  }
});

test('precedence after dispatch — the cyclic refusal versus an interrupt observed before the solve: pinned per operation (ADR 0013 is silent, see the evidence doc)', async () => {
  // Optimize-family: solve() reads its entry guard before the part-graph check, so the interrupt is reported (with the resolved model).
  // Explore and the floor check the part graph before their first guard, so the refusal is reported. Both are pre-model stops with no build, no proof
  // and no native call; only the reason and the resolved-model fields differ. Recorded as an owner question, not a defect.
  for (const op of SEARCH_OPERATIONS) {
    for (const interrupt of ['deadline', 'cancel'] as const) {
      const { response, calls } = await run(op, {
        lookup: cyclicLookup(),
        setup: r => { r.duringLoad(() => { if (interrupt === 'deadline') r.clock.t = LATE; else r.send(cancelOf(1)); }); },
      });
      assert.equal(calls, 0, `${op.name} + ${interrupt}`);
      if (op.kind === 'optimize') {
        assertOptimizeStop(op, response, { status: 'incomplete', reason: interrupt === 'deadline' ? R.timeLimitReached : R.cancelledByUser, termination: 'limit', build: false });
      } else {
        assertPreModelEnvelope(op, response, R.unsupportedCyclicPartGraph);
      }
    }
  }
});

test('Explore precedence at entry — invalid stash before an invalid schedule; queue expiry before it; the schedule check before the cyclic refusal and before a passed deadline', async () => {
  const bad = { steps: Number.NaN };
  const stash = rig(sweepLookup());
  stash.send(messageOf(EXPLORE, 1, { ...bad, owned_items: [''] }));
  await stash.runtime.idle();
  assertPreModelEnvelope(EXPLORE, stash.result<AnyResponse>(1), R.invalidOwnedItems);

  const expired = rig(sweepLookup());
  expired.send(messageOf(EXPLORE, 1, bad, T0 - 1));
  await expired.runtime.idle();
  assertPreModelEnvelope(EXPLORE, expired.result<AnyResponse>(1), R.queueTimeoutBeforeDispatch);

  const cyclic = await run(EXPLORE, { extra: bad, lookup: cyclicLookup() });
  assertPreModelEnvelope(EXPLORE, cyclic.response, R.invalidExploreSchedule);

  const late = await run(EXPLORE, { extra: bad, setup: r => { r.duringLoad(() => { r.clock.t = LATE; }); } });
  assertPreModelEnvelope(EXPLORE, late.response, R.invalidExploreSchedule);
  assert.equal(late.calls + cyclic.calls, 0);
});

// -------------------------------------------------------------------------------------------------------------------------------------
// The one precedence gap (a production defect, reported, not fixed here): see docs/stage3/operations-evidence.md "Defect D1".
// -------------------------------------------------------------------------------------------------------------------------------------

test('DEFECT D1 (todo): a verified build of a withheld relaxed-edge solve is dropped when the deadline stops the integer re-solve', { todo: 'production solvePrecise relaxed-edge fallback discards the candidate and the observed prerequisite failure (Stage 3 report)' }, async () => {
  // Expected by ADR 0013 section 6: a verified witness exists and an observed proof-prerequisite failure coincides with the deadline, so the request is
  // feasible / feasible with "Required proof prerequisite unavailable" (the failure outranks the interrupt; the retained witness decides the status).
  const failures: string[] = [];
  for (const op of [OPTIMIZE_PRECISE, OPTIMIZE_AUTO, GUNSMITH]) {
    const { response } = await run(op, {
      setup: r => async (call, real) => {
        const result = withheld(await real());
        if (call.index === 0) r.clock.t = LATE;
        return result;
      },
    });
    const res = asOptimize(response);
    if (res.status !== 'feasible' || res.reason !== R.requiredProofPrerequisiteUnavailable || res.selected_items.length === 0) {
      failures.push(`${op.name}: ${res.status} / ${res.physical_certificate} / ${res.reason} / ${res.selected_items.length} items`);
    }
  }
  // Explore: the first target has the verified build, so it is V (feasible) and the curve is partial. Floor: the seed query ends at its first verified full
  // witness, so the floor is model_witnessed.
  const sweep = asExplore((await run(EXPLORE, { setup: r => async (call, real) => { const x = withheld(await real()); if (call.index === 0) r.clock.t = LATE; return x; } })).response);
  if (sweep.step_outcomes[0]?.outcome !== 'V' || sweep.curve_status !== 'partial') failures.push(`Explore: ${sweep.curve_status}, first target ${sweep.step_outcomes[0]?.outcome} ${sweep.step_outcomes[0]?.reason ?? ''}`);
  const floor = asFloor((await run(FLOOR, { setup: r => async (call, real) => { const x = withheld(await real()); if (call.index === 0) r.clock.t = LATE; return x; } })).response);
  if (floor.status !== 'model_witnessed') failures.push(`MOA floor: ${floor.status} ${floor.reason ?? ''}`);
  assert.deepEqual(failures, []);
});

// =====================================================================================================================================
// C. Explore and floor classification through the runtime (the cases the driver tests prove on injected solves, here on the real pipeline)
// =====================================================================================================================================

test('Explore I = N through the runtime: a budget no build meets is certified infeasible at every target, and the curve is infeasible (rule 4)', async () => {
  const { response } = await run(EXPLORE, { extra: { max_price: 100 } });
  const r = asExplore(response);
  assert.equal(r.curve_status, 'infeasible');
  assert.ok(r.step_outcomes.length >= 1);
  assert.ok(r.step_outcomes.every(s => s.outcome === 'I' && s.status === 'infeasible' && s.physical_certificate === 'certified_infeasible'));
  assert.deepEqual(r.points, []);
});

test('Explore: Fast and provisional-MOA emptiness are U, never I, so V = 0 with U is invalid (rule 5)', async () => {
  for (const extra of [{ max_price: 100, precise_mode: 'fast' }, { max_price: 100, max_moa: 50 }]) {
    const { response } = await run(EXPLORE, { extra });
    const r = asExplore(response);
    assert.equal(r.curve_status, 'invalid', JSON.stringify(extra));
    assert.ok(r.step_outcomes.every(s => s.outcome === 'U' && s.physical_certificate === 'none'), JSON.stringify(extra));
    const reason = extra.precise_mode === 'fast' ? R.approximateModelInfeasible : R.provisionalMoaModelInfeasible;
    assert.ok(r.step_outcomes.every(s => s.reason === reason), JSON.stringify(extra));
    if ('max_moa' in extra) assert.equal(r.moa_qualification, 'provisional_model');
  }
});

test('MOA floor through the runtime: a qualified seed emptiness is model_infeasible with no witness and no bounds', async () => {
  const { response } = await run(FLOOR, { extra: { max_price: 100 } });
  const r = asFloor(response);
  assert.equal(r.status, 'model_infeasible');
  assert.equal(r.reason, undefined);
  assert.deepEqual([r.floor, r.display_floor, r.proved_lower_bound, r.witness], [null, null, null, undefined]);
});

// =====================================================================================================================================
// D. Metadata operations
// =====================================================================================================================================

test('metadata operations complete normally and ignore a stash, a stamped deadline long past, and a cancel (queued or running)', async () => {
  for (const type of METADATA_OPERATIONS) {
    const r = rig(sweepLookup());
    r.clock.t = LATE;
    r.send(metadataMessage(type, 1, { deadline: T0, request: { weapon_id: 'gun', owned_items: [''] } }));
    r.send(metadataMessage(type, 2));
    r.send(cancelOf(2)); // queued behind request 1
    r.duringLoad(() => { r.send(cancelOf(1)); }); // running
    await r.runtime.idle();
    for (const id of [1, 2]) {
      const m = r.terminal(id);
      assert.notEqual(m.type, 'error', `${type} ${id}: ${JSON.stringify(m.payload)}`);
      const payload = m.payload as Record<string, unknown> | null;
      if (type === 'loadData') assert.equal(m.type, 'dataLoaded');
      if (type === 'clearCache') assert.deepEqual(payload, { cleared: true });
      if (type === 'getInfo') assert.equal((payload!.guns as unknown[]).length, 0, 'the rig loads no gun records');
      if (type === 'getWeaponMods') assert.deepEqual((payload!.mods as { id: string }[]).map(x => x.id).sort(), ['g1', 'g2', 's1', 's2']);
      if (type === 'getGunsmithTasks') assert.equal((payload!.tasks as unknown[]).length, 1);
      if (type === 'getStatus') assert.ok('capabilities' in payload!);
      assert.ok(payload === null || !('reason' in payload), `${type}: no operation reason`);
    }
  }
});

test('metadata operations on a gun with a cyclic part graph: the refusal belongs to the search operations, the mod list and its compatibility graph still load', async () => {
  const r = rig(cyclicLookup());
  r.send(metadataMessage('getWeaponMods', 1, { withCompat: true }));
  r.send(metadataMessage('getGunsmithTasks', 2));
  r.send(metadataMessage('getStatus', 3));
  await r.runtime.idle();
  const mods = r.result<{ mods: { id: string }[]; slots_by_item: Record<string, string[]> }>(1);
  assert.deepEqual(mods.mods.map(m => m.id).sort(), ['A', 'B']);
  assert.ok(mods.slots_by_item.A.length > 0 && mods.slots_by_item.B.length > 0);
  r.result(2);
  r.result(3);
});

test('the matrix covers every search operation and every metadata operation of the protocol', () => {
  assert.deepEqual(SEARCH_OPERATIONS.map(o => o.name), ['Optimize Fast', 'Optimize Precise', 'Optimize Auto', 'Gunsmith', 'Explore', 'MOA floor']);
  assert.deepEqual(new Set(SEARCH_OPERATIONS.map(o => o.type)), new Set(['optimize', 'explore', 'computeMOAFloor']));
  assert.deepEqual([...METADATA_OPERATIONS].sort(), ['clearCache', 'getGunsmithTasks', 'getInfo', 'getStatus', 'getWeaponMods', 'loadData']);
  assert.equal(OPTIMIZE_FAST.precise, false);
});
