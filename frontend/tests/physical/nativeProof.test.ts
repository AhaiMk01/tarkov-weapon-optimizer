// Qualification of a native solve (src/solver/physical/nativeProof.ts): the parsed model is verified against the emitted text on EVERY solve, the
// parsed right-hand sides of constructed rows must dominate their exact needs, the native tolerances must be the declared ones, and anything
// else withholds the bound and the infeasibility verdict. Real HiGHS on the pinned build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNativeHighs } from '../../src/solver/native';
import type { NativeResult } from '../../src/solver/native';
import { nativeSolveOptions } from '../../src/solver/physical/nativeSolve';
import { NATIVE_FRAME, assessNativeResult, boundEvidenceOf } from '../../src/solver/physical/nativeProof';
import { upperBoundOf } from '../../src/solver/physical/proof';
import type { ModelProof } from '../../src/solver/physical/proof';
import { gunWith, lookupOf, modWith, slot, WEAPON } from './lpFixtures';
import { prepare } from './lpHarness';
import type { Prepared } from './lpHarness';

async function solved(prepared: Prepared, options: Record<string, number | string> = {}, extras: { includeReadback?: boolean } = { includeReadback: true }): Promise<NativeResult> {
  return getNativeHighs().solveStructured(prepared.model.lp, { ...nativeSolveOptions(1e-9), presolve: 'off', time_limit: 60, ...options }, extras);
}

/** A receiver with one optional barrel and one suppressor so the MOA rows (constructed, padded) are present. */
const moaWorld = () => lookupOf(
  gunWith(WEAPON, { coi: 0.0625, slots: [slot('b', ['barrel']), slot('m', ['sup'])] }),
  ['barrel', modWith('barrel', { ergo: 2, coi: 0.125 })],
  ['sup', modWith('sup', { ergo: 3, accuracy: -5 })],
);

const request = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0, maxMOA: 5, maxRecoilSum: 1000 } as const;

test('an ordinary solve is qualified: the parsed model equals the text, every constructed row dominates its need, the declared tolerances are in force', async () => {
  const prepared = prepare(moaWorld(), WEAPON, request);
  assert.ok(prepared.model.proof.rows.length >= 2, 'the MOA rows and the recoil cap are constructed rows');
  const result = await solved(prepared);
  const assessment = assessNativeResult({ lpText: prepared.model.lp, proof: prepared.model.proof }, result);
  assert.deepEqual(assessment.reasons, []);
  assert.equal(assessment.qualified, true);
  assert.equal(assessment.readback.compared, true);
  assert.equal(assessment.readback.ok, true);
  assert.equal(assessment.readback.differences, 0);
  assert.equal(assessment.readback.filtered, 0);
  assert.equal(assessment.allowances.checked, prepared.model.proof.rows.length);
  assert.equal(assessment.allowances.violated, 0);
  assert.equal(assessment.tolerancesInForce, true);
  const evidence = boundEvidenceOf(prepared.model.proof, result, assessment);
  assert.equal(evidence.qualified, true);
  assert.ok(evidence.nativeDual !== null && Number.isFinite(evidence.nativeDual));
  const bound = upperBoundOf(evidence);
  assert.ok(bound !== null && bound >= (result.objectiveValue as number) - 1e-9);
  assert.ok(NATIVE_FRAME.assumptions.length >= 3, 'the accepted-not-proved assumptions are stated, not silent');
});

test('a coefficient HiGHS filters (at or below small_matrix_value) is a different model: the solve is unqualified and its bound is withheld', async () => {
  // recoil modifier -1e-10 on part `a`: the row rec_mod_def carries -(-1e-10) = 1e-10, which HiGHS drops on read.
  const lookup = lookupOf(
    gunWith(WEAPON, { slots: [slot('s', ['a', 'b'])] }),
    ['a', modWith('a', { ergo: 0, recoil: -1e-10 })],
    ['b', modWith('b', { ergo: 0.5 })],
  );
  const prepared = prepare(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 1e7, priceWeight: 0 });
  assert.equal(prepared.model.matrixFilterRisk, true, 'the a-priori flag predicts it');
  const result = await solved(prepared);
  assert.equal(result.readStatus, 'warning', 'HiGHS itself says it adjusted the model');
  const assessment = assessNativeResult({ lpText: prepared.model.lp, proof: prepared.model.proof }, result);
  assert.equal(assessment.qualified, false);
  assert.equal(assessment.readback.ok, false);
  assert.ok(assessment.readback.filtered >= 1, 'the dropped coefficient is attributed to the documented filter');
  assert.ok(assessment.reasons.some(r => /different model/.test(r)), assessment.reasons.join(' | '));
  const evidence = boundEvidenceOf(prepared.model.proof, result, assessment);
  assert.equal(evidence.qualified, false);
  assert.equal(upperBoundOf(evidence), null, 'an unqualified bound is unknown, never a finite guess');
  // and the model HiGHS solved really is a different one: it sees `a` as worthless and returns the 0.5 of `b`, where the exact optimum is `a` (about 1)
  const picked = result.colNames?.map((name, i) => [name, (result.colValues as Float64Array)[i]] as const).filter(([n, v]) => n.startsWith('x_') && v > 0.5).map(([n]) => n);
  assert.equal(picked?.length, 1);
  assert.ok(Math.abs((result.objectiveValue as number) - 0.5) < 1e-9, `HiGHS optimum ${result.objectiveValue} is the 0.5 of the wrong part`);
});

test('a parsed right-hand side that does not dominate the exact need of a constructed row is caught: the allowance that counts is the parsed one', async () => {
  const prepared = prepare(moaWorld(), WEAPON, request);
  const result = await solved(prepared);
  const rows = prepared.model.proof.rows.map((row, i) => (i === 0 ? { ...row, need: row.relation === '>=' ? { n: row.need.n - 1n * row.need.d, d: row.need.d } : { n: row.need.n + 1n * row.need.d, d: row.need.d } } : row));
  const tampered: ModelProof = { ...prepared.model.proof, rows };
  const assessment = assessNativeResult({ lpText: prepared.model.lp, proof: tampered }, result);
  assert.equal(assessment.qualified, false);
  assert.equal(assessment.allowances.violated, 1);
  assert.ok(assessment.reasons.some(r => r.includes(`row ${rows[0].row}`)));
});

test('a solve without a readback, with a read warning, with loosened native tolerances or with a withheld model proof is unqualified, each for its own reason', async () => {
  const prepared = prepare(moaWorld(), WEAPON, request);
  const withText = { lpText: prepared.model.lp, proof: prepared.model.proof };
  const noReadback = await solved(prepared, {}, {});
  const a = assessNativeResult(withText, noReadback);
  assert.equal(a.qualified, false);
  assert.ok(a.reasons.some(r => /no model readback/.test(r)));
  assert.equal(a.readback.compared, false);

  const real = await solved(prepared);
  const warned = assessNativeResult(withText, { ...real, readStatus: 'warning', readMessages: ['WARNING: something'] } as NativeResult);
  assert.equal(warned.qualified, false);
  assert.ok(warned.reasons.some(r => /adjusted the model/.test(r)));

  const loose = await solved(prepared, { primal_feasibility_tolerance: 1e-6 });
  const l = assessNativeResult(withText, loose);
  assert.equal(l.qualified, false);
  assert.equal(l.tolerancesInForce, false);
  assert.ok(l.reasons.some(r => /tolerances in force/.test(r)));

  const withheld = assessNativeResult({ ...withText, proof: { ...prepared.model.proof, withheld: 'a proof input failed' } }, real);
  assert.equal(withheld.qualified, false);
  assert.ok(withheld.reasons.some(r => /withheld at construction/.test(r)));
});

test('a solve with presolve ON is a witness at most: it is unqualified however clean its readback, because HiGHS 1.15.1 can report a suboptimal point as Optimal', async () => {
  const prepared = prepare(moaWorld(), WEAPON, request);
  const withText = { lpText: prepared.model.lp, proof: prepared.model.proof };
  const on = await solved(prepared, { presolve: 'choose' });
  const a = assessNativeResult(withText, on);
  assert.equal(a.readback.ok, true, 'the model HiGHS holds is the text');
  assert.equal(a.presolveOff, false);
  assert.equal(a.qualified, false);
  assert.ok(a.reasons.some(r => /presolve choose/.test(r)), a.reasons.join(' | '));
  assert.equal(upperBoundOf(boundEvidenceOf(prepared.model.proof, on, a)), null, 'no bound from a presolved solve');
  const off = assessNativeResult(withText, await solved(prepared));
  assert.equal(off.presolveOff, true);
  assert.equal(off.qualified, true);
  // a result that does not say which presolve ran cannot be trusted either
  const real = await solved(prepared);
  const unreported = assessNativeResult(withText, { ...real, effectiveOptions: { ...real.effectiveOptions, presolve: undefined as unknown as string } } as NativeResult);
  assert.equal(unreported.qualified, false);
  assert.ok(unreported.reasons.some(r => /unreported state/.test(r)));
});

test('a text outside the strict subset the independent parser reads is unqualified with the parser message, not a crash', async () => {
  const prepared = prepare(moaWorld(), WEAPON, request);
  const real = await solved(prepared);
  const garbled = assessNativeResult({ lpText: prepared.model.lp.replace('\nBounds\n', '\n  r_range: 1 x_1 <= 2 <= 3\nBounds\n'), proof: prepared.model.proof }, real);
  assert.equal(garbled.qualified, false);
  assert.ok(garbled.reasons.some(r => /strict subset/.test(r)), garbled.reasons.join(' | '));
});

test('a model with no integer column uses its optimal LP objective as its own bound, and a MIP never uses its primal objective as one', async () => {
  const lookup = lookupOf(gunWith(WEAPON, { slots: [] }));
  const prepared = prepare(lookup, WEAPON, { ergoWeight: 1, recoilWeight: 0 });
  const result = await solved(prepared);
  assert.equal(result.model.isMip, true, 'the base choice keeps a binary column even here');
  const assessment = assessNativeResult({ lpText: prepared.model.lp, proof: prepared.model.proof }, result);
  const evidence = boundEvidenceOf(prepared.model.proof, { ...result, mipDualBound: null } as NativeResult, assessment);
  assert.equal(evidence.nativeDual, null, 'a MIP with no reported dual bound has no bound: its primal objective is not one');
  const lp = boundEvidenceOf(prepared.model.proof, { ...result, mipDualBound: null, model: { ...result.model, isMip: false } } as NativeResult, assessment);
  assert.equal(lp.nativeDual, result.objectiveValue, 'a pure LP at its optimum is its own bound');
});
