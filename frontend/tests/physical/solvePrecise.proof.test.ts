// The proof frame end to end (src/solver/physical/solvePrecise.ts with proof.ts and nativeProof.ts, Phase 2.5): every solve is verified against the
// text, a filtered coefficient withholds the bound and any infeasibility verdict while verified builds are still published, a wide Tchebycheff
// price normalization is rescaled exactly and certified, a bound that contradicts a verified witness is withheld, and unknown bounds travel as null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';
import { gunWith, modWith } from './lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-9, ...extra,
});
const FAR = (): number => performance.now() + 120_000;

const built = (r: PreciseResult) => {
  assert.equal(r.kind, 'build', r.kind === 'build' ? '' : JSON.stringify({ kind: r.kind, reason: 'reason' in r ? r.reason : undefined }));
  return r as Extract<PreciseResult, { kind: 'build' }>;
};
const installed = (r: PreciseResult): string[] => built(r).best.build.placements.map(p => p.itemId).sort();

test('every native solve is verified against its text: one readback check per solve, none unqualified, on a plain request and on a spatial search', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 4, ergo: 40 })]);
  const plain = await solvePrecise({ params: paramsOf(lookup), deadline: FAR() });
  const { telemetry } = plain.summary;
  assert.equal(telemetry.readbackChecks, telemetry.nativeSolves, 'the policy is every solve, not a sample');
  assert.equal(telemetry.unqualifiedSolves, 0);
  assert.deepEqual(telemetry.unqualifiedReasons, []);
  assert.ok(telemetry.readbackMs >= 0);
  assert.equal(built(plain).certified, true);
  const spatial = await solvePrecise({ params: paramsOf(lookup, { useTrueErgo: true }), deadline: FAR() });
  assert.ok(spatial.summary.telemetry.nativeSolves >= 2);
  assert.equal(spatial.summary.telemetry.readbackChecks, spatial.summary.telemetry.nativeSolves);
  assert.equal(spatial.summary.telemetry.unqualifiedSolves, 0);
  assert.equal(built(spatial).certified, true);
});

test('a filtered coefficient: the verified build is published, the bound and the certificate are withheld, and the upper bound travels as null', async () => {
  // a: recoil -1e-10 (a coefficient HiGHS drops), worth 1e7 x 1000 x 1e-10 = 1.0; b: +0.5 ergonomics. Same slot: the exact optimum is `a` (1.0).
  const lookup = lookupOf(
    gunWith(WEAPON, { slots: [slot('s', ['a', 'b'])] }),
    ['a', modWith('a', { ergo: 0, recoil: -1e-10 })],
    ['b', modWith('b', { ergo: 0.5 })],
  );
  const result = await solvePrecise({ params: paramsOf(lookup, { recoilWeight: 1e7 }), deadline: FAR() });
  const { certified, reason, summary, best } = built(result);
  // HiGHS solved a different model (it sees `a` as worthless), so what it calls optimal is `b`: a verified build, but NOT a proved optimum
  assert.deepEqual(installed(result), ['b']);
  assert.ok(Math.abs(best.score - 0.5) < 1e-12);
  assert.equal(certified, false, 'a naive pipeline would certify b as optimal; the exact optimum is a, 1.0');
  assert.equal(reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(summary.telemetry.unqualifiedSolves, 1);
  assert.ok(summary.telemetry.unqualifiedReasons.some(r => /different model/.test(r)), summary.telemetry.unqualifiedReasons.join(' | '));
  assert.equal(summary.bounds.upper, null, 'an unknown upper bound is null on the wire, never zero or infinite');
  assert.equal(summary.bounds.gap, null);
  assert.ok(summary.bounds.lower !== null && Math.abs(summary.bounds.lower - 0.5) < 1e-12, 'the lower bound is the downward enclosure of the verified build');
  assert.equal(summary.upperBound, Infinity);
  assert.equal(summary.completed, false);
});

test('an infeasibility verdict from a solve whose parsed model differs from the text is not emptiness: the request is incomplete, never infeasible', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, slots: [slot('s', ['a'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })]);
  // a genuine Infeasible (max price below every spend) whose readback is tampered with: the parsed model no longer equals the text
  const tampered: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    const readback = real.readback;
    if (readback === null) return real;
    const colCost = Float64Array.from(readback.colCost);
    colCost[0] += 1;
    return { ...real, readback: { ...readback, colCost } } as NativeResult;
  };
  const verdict = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve: tampered });
  assert.equal(verdict.kind, 'incomplete');
  assert.equal(verdict.kind === 'incomplete' && verdict.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(verdict.summary.telemetry.confirmedInfeasible, 0);
  // the same request with an honest solver is proved empty
  const honest = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR() });
  assert.equal(honest.kind, 'empty');
  assert.equal(honest.summary.telemetry.confirmedInfeasible, 1);
  // and a solver that ignores the readback request cannot prove emptiness either
  const blind: SolveFn = async (lp, options) => nativeSolve(lp, options);
  const none = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve: blind });
  assert.equal(none.kind, 'incomplete');
});

/** One slot, two parts of equal ergonomics: A costs 100, B costs 1000. Only the 0.01 augmentation of the price axis tells them apart. */
const priceTie = () => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('s', ['a', 'b'], true)] }),
  ['a', mod('a', { weight: 0, ergo: 5, offers: [trader('prapor', 1, 100)] })],
  ['b', mod('b', { weight: 0, ergo: 5, offers: [trader('prapor', 1, 1000)] })],
);

test('a wide Tchebycheff price normalization is rescaled by an exact power of two and certified: the cheaper part wins by the 4.5e-8 the naive model could not see', async () => {
  const ideal = { zE: 100, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP: 1e8 };
  const result = await solvePrecise({ params: paramsOf(priceTie(), { ergoWeight: 1, recoilWeight: 0, priceWeight: 1, useTchebycheff: true, idealPoint: ideal }), deadline: FAR() });
  assert.deepEqual(installed(result), ['a'], 'A is cheaper by 900 RUB: 0.01 x 5e-9 x 900 = 4.5e-8 above the 1e-9 tolerance');
  const { certified, best, summary } = built(result);
  assert.equal(certified, true);
  assert.equal(summary.telemetry.unqualifiedSolves, 0, 'HiGHS kept every coefficient');
  assert.ok(summary.gap !== null && summary.gap <= 1e-9);
  // exact score of A: 0.01 (c_e fE - c_p fP) - max(c_e (zE - fE), c_p (fP - zP)) with c_e = 1/200, c_p = 1/(2e8), fE = 50, fP = 5100
  const expected = 0.01 * (50 / 200 - 5100 / 2e8) - Math.max((100 - 50) / 200, 5100 / 2e8);
  assert.ok(Math.abs(best.score - expected) < 1e-15, `${best.score} vs ${expected}`);
});

test('at a normalization of 1e12 the price term is below the tolerance: the request is still certified, within the tolerance of the exact optimum', async () => {
  const ideal = { zE: 100, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP: 1e12 };
  const result = await solvePrecise({ params: paramsOf(priceTie(), { ergoWeight: 1, recoilWeight: 0, priceWeight: 1, useTchebycheff: true, idealPoint: ideal }), deadline: FAR() });
  const { certified, best, summary } = built(result);
  assert.equal(certified, true);
  assert.equal(summary.telemetry.unqualifiedSolves, 0);
  const exactBest = 0.01 * (50 / 200 - 5100 / 2e12) - Math.max((100 - 50) / 200, 5100 / 2e12);
  assert.ok(Math.abs(best.score - exactBest) <= 1e-9, 'a part 4.5e-12 worse would be within the tolerance, so either may be returned, and the claim is the tolerance');
});

test('when no legal power-of-two rescaling exists the proof is withheld, the verified build is still published, and nothing certifies', async () => {
  const ideal = { zE: 100, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP: 1e30 };
  const result = await solvePrecise({ params: paramsOf(priceTie(), { ergoWeight: 1, recoilWeight: 0, priceWeight: 1, useTchebycheff: true, idealPoint: ideal }), deadline: FAR() });
  const { certified, reason, summary } = built(result);
  assert.equal(certified, false);
  assert.equal(reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(summary.bounds.upper, null);
  assert.ok(summary.telemetry.unqualifiedReasons.some(r => /withheld at construction.*no power-of-two scaling of the axis/.test(r)), summary.telemetry.unqualifiedReasons.join(' | '));
});

test('a bound that falls far below a build verified in its own node is withheld as a wrong bound; a few ulps of solver noise only count in boundShortfall', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 1, ergo: 25 })]);
  const lowered = (by: number): SolveFn => async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    return { ...real, mipDualBound: (real.mipDualBound as number) - by } as NativeResult;
  };
  // 1e-13 below: floating-point noise of the native solve, reported and tolerated
  const noisy = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: lowered(1e-13) });
  assert.equal(built(noisy).certified, true);
  assert.ok(noisy.summary.telemetry.boundShortfall > 0 && noisy.summary.telemetry.boundShortfall < 1e-12, `${noisy.summary.telemetry.boundShortfall}`);
  // 1 below: no noise but a wrong bound
  const wrong = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: lowered(1) });
  const w = built(wrong);
  assert.equal(w.certified, false);
  assert.equal(w.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(w.summary.bounds.upper, null);
  assert.ok(Math.abs(w.summary.telemetry.boundShortfall - 1) < 1e-9);
  assert.match(w.summary.telemetry.unqualifiedReasons[0], /above the node's proved upper bound/);
  assert.deepEqual(installed(wrong), ['b'], 'the verified witness is kept');
});

test('the reported bounds enclose the exact optimum: lower is a downward enclosure of the verified score, upper at least it, and the gap is the exact gap', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10.1 })], ['b', mod('b', { weight: 1, ergo: 25.3 })]);
  const result = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 0.3 }), deadline: FAR() });
  const { best, summary, certified } = built(result);
  assert.equal(certified, true);
  assert.deepEqual(installed(result), ['b']);
  assert.ok(summary.lowerBound !== null && summary.lowerBound <= best.score && summary.lowerBound === best.scoreLower);
  assert.ok(summary.upperBound >= best.scoreUpper, 'the upper bound is at least the incumbent\'s upward enclosure');
  assert.ok(summary.gap !== null && summary.gap >= 0 && summary.gap <= 1e-9);
  assert.deepEqual(summary.bounds, { lower: summary.lowerBound, upper: summary.upperBound, gap: summary.gap });
});

test('a presolved Optimal is a feasible witness only: the verified build is published, no bound, no certificate (presolve ON can report a suboptimal point as Optimal)', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 1, ergo: 25 })]);
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), presolve: 'choose' });
  const { certified, reason, summary } = built(result);
  assert.deepEqual(installed(result), ['b']);
  assert.equal(certified, false);
  assert.equal(reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(summary.bounds.upper, null);
  assert.ok(summary.telemetry.unqualifiedReasons.some(r => /presolve choose/.test(r)), summary.telemetry.unqualifiedReasons.join(' | '));
  // the default (presolve off) certifies the same request
  assert.equal(built(await solvePrecise({ params: paramsOf(lookup), deadline: FAR() })).certified, true);
});
