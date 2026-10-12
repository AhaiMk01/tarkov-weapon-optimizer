// DEFECT D1 (Stage 3 workstream 3.5; fixed in the Stage 3 follow-up of 2026-10-12): regression tests on solvePrecise.
//
// The relaxed-edge first try of a Precise node (`solvePrecise.ts` `evaluateNative`) judges its answer exactly: an integral relaxed optimum whose build the
// independent validator accepts is a VERIFIED build even when the solve is not qualified (a read warning, a native time limit), and `judge` returns it
// as `none({ candidate })`. Before the fix, `evaluate` then fell back to the integer model, yielded and read the guard, and on a stop returned
// `interrupted(model, stop)`: the verified candidate and the observed proof-prerequisite failure were both dropped, so the request was incomplete / none
// with "Time limit reached". ADR 0013 section 6 requires feasible / feasible (a verified current witness) with "Required proof prerequisite unavailable"
// (an observed prerequisite failure outranks a coincident interrupt). The fix keeps the relaxed opinion when it holds a verified build or a non-interrupt
// reason, returns it unconfirmed (unfinished) on a guard stop, and merges it into the integer model's evaluation otherwise.
// The second case: the build of a relaxed solve that stopped at a native time limit with a primal is kept too, with its factual reason.
// Fast (`solveFast.ts` `tryRelaxedEdges`) had the second case's loss as well: a relaxed-edge limit stop was treated as fractional and dropped even when
// its primal was integral and validated. It now returns that verified build as the node's witness with the stop's reason (last test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { NativeResult } from '../../src/solver/native';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { solveFast } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { fixedGuard } from '../../src/solver/runtimeGuard';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';

const lookup = lookupOf(gun(WEAPON, { slots: [slot('s', ['a', 'b'])] }), ['a', mod('a', { ergo: 5 })], ['b', mod('b', { ergo: 8 })]);
const params = { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0 };

/** The pinned solve with `tamper` applied to every answer; the clock passes the deadline during the first (relaxed-edge) call. */
async function runWith(tamper: (r: NativeResult, index: number) => NativeResult, expire: boolean) {
  let t = 0;
  let calls = 0;
  const solve: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    const index = calls++;
    if (expire && index === 0) t = 5_000;
    return tamper(real, index);
  };
  const result = await solvePrecise({ params, guard: fixedGuard(1_000, { now: () => t }), solve });
  return { result, calls };
}

const warned = (r: NativeResult): NativeResult => ({ ...r, readStatus: 'warning' }) as NativeResult;
const timeLimited = (r: NativeResult, index: number): NativeResult => (index === 0 ? ({ ...r, modelStatus: { code: 13, name: 'TimeLimit' } }) as unknown as NativeResult : r);

test('control: the relaxed-edge answer of this node is integral and verified (with time left, the same tampering yields the build)', async () => {
  const withheld = await runWith(warned, false);
  assert.equal(withheld.result.kind, 'build');
  assert.equal(withheld.result.outcome.status, 'feasible');
  assert.equal(withheld.result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(withheld.result.summary.telemetry.relaxedEdgeFallbacks, 1, 'the unqualified relaxed answer fell back to the integer model');
  const honest = await runWith(r => r, false);
  assert.equal(honest.result.summary.telemetry.relaxedEdgeFallbacks, 0, 'the honest relaxed answer is integral and accepted as is');
});

test('D1: a withheld relaxed-edge solve + the deadline before the integer re-solve keeps the verified build, feasible with the prerequisite reason', async () => {
  const { result, calls } = await runWith(warned, true);
  assert.equal(calls, 1, 'the integer model was never solved');
  assert.equal(result.kind, 'build', `got ${result.kind}: ${result.outcome.status} / ${result.outcome.reason}`);
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(result.outcome.termination, 'limit');
});

test('D1: a relaxed-edge solve stopped at a native time limit with a verified primal keeps that build when the deadline stops the integer re-solve', async () => {
  const { result } = await runWith(timeLimited, true);
  assert.equal(result.kind, 'build', `got ${result.kind}: ${result.outcome.status} / ${result.outcome.reason}`);
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.timeLimitReached);
});

test('Fast: a relaxed-edge solve stopped at a native time limit with an integral, verified primal keeps that build as a witness with Time limit reached', async () => {
  let t = 0;
  let calls = 0;
  const solve: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    const index = calls++;
    if (index === 0) t = 5_000;
    return timeLimited(real, index);
  };
  const result = await solveFast({ params, guard: fixedGuard(1_000, { now: () => t }), solve });
  assert.equal(calls, 1, 'the integer model was never solved');
  assert.equal(result.summary.relaxedEdgeSolves, 1);
  assert.equal(result.kind, 'build', `got ${result.kind}: ${result.outcome.status} / ${result.outcome.reason}`);
  assert.equal(result.optimal, false);
  assert.deepEqual([result.outcome.status, result.outcome.physical_certificate, result.outcome.reason, result.outcome.termination], ['feasible', 'feasible', PUBLIC_REASONS.timeLimitReached, 'limit']);
  assert.equal(result.outcome.model_qualification, 'approximate');
});
