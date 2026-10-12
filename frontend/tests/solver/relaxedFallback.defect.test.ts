// DEFECT D1 (Stage 3 workstream 3.5, reported, not fixed here: production is out of scope for this workstream). Minimal reproduction on solvePrecise.
//
// The relaxed-edge first try of a Precise node (`solvePrecise.ts` `evaluate`) judges its answer exactly: an integral relaxed optimum whose build the
// independent validator accepts is a VERIFIED build even when the solve is not qualified (a read warning, a native time limit), and `judge` returns it
// as `none({ candidate })`. `evaluate` then falls back to the integer model, yields and reads the guard, and on a stop returns `interrupted(model, stop)`:
// the verified candidate and the observed proof-prerequisite failure are both dropped, so the request is incomplete / none with "Time limit reached".
// ADR 0013 section 6 requires feasible / feasible (a verified current witness) with "Required proof prerequisite unavailable" (an observed prerequisite
// failure outranks a coincident interrupt). Nothing false is published (the answer is conservative), but the witness and the factual cause are lost.
// The same path drops the build of a relaxed solve that stopped at a native time limit with a primal (the second case).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { NativeResult } from '../../src/solver/native';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
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

test('D1: a withheld relaxed-edge solve + the deadline before the integer re-solve keeps the verified build, feasible with the prerequisite reason', { todo: 'production defect D1 (Stage 3 report): solvePrecise relaxed-edge fallback' }, async () => {
  const { result, calls } = await runWith(warned, true);
  assert.equal(calls, 1, 'the integer model was never solved');
  assert.equal(result.kind, 'build', `got ${result.kind}: ${result.outcome.status} / ${result.outcome.reason}`);
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(result.outcome.termination, 'limit');
});

test('D1: a relaxed-edge solve stopped at a native time limit with a verified primal keeps that build when the deadline stops the integer re-solve', { todo: 'production defect D1 (Stage 3 report): solvePrecise relaxed-edge fallback' }, async () => {
  const { result } = await runWith(timeLimited, true);
  assert.equal(result.kind, 'build', `got ${result.kind}: ${result.outcome.status} / ${result.outcome.reason}`);
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.timeLimitReached);
});
