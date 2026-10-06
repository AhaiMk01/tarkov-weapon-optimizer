// The proof frame of the certifiable count model end to end, through the same qualification, bound evidence and search Precise uses (tests/physical/countHarness.ts
// drives them with the count model; the counterpart for the occurrence model is solvePrecise.proof.test.ts): a filtered coefficient withholds the bound and any
// infeasibility verdict while the verified build is still published, a wide Tchebycheff price normalization is rescaled exactly and certified, a bound that
// contradicts a verified witness is withheld, a tampered readback or a presolved solve proves nothing, and unknown bounds travel as null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { solveCount } from './countHarness';
import type { CountRun } from './countHarness';
import { gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-9, ...extra,
});

const built = (r: CountRun) => {
  assert.equal(r.kind, 'build', JSON.stringify(r.kind === 'ineligible' ? r : { kind: r.kind, reason: 'reason' in r ? r.reason : undefined }));
  return r as Extract<CountRun, { kind: 'build' }>;
};
const installed = (r: CountRun): string[] => built(r).best.build.placements.map(p => p.itemId).sort();

test('every native solve is qualified: none unqualified on a plain request and on a spatial search, and a certificate follows', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 4, ergo: 40 })]);
  const plain = await solveCount(paramsOf(lookup));
  assert.equal(plain.kind === 'ineligible' ? 0 : plain.telemetry.unqualifiedSolves, 0);
  assert.equal(built(plain).certified, true);
  const spatial = await solveCount(paramsOf(lookup, { useTrueErgo: true }));
  assert.ok(built(spatial).telemetry.nativeSolves >= 2);
  assert.equal(built(spatial).telemetry.unqualifiedSolves, 0);
  assert.equal(built(spatial).certified, true);
});

test('a filtered coefficient: the verified build is published, the bound and the certificate are withheld, and the upper bound travels as null', async () => {
  // a: recoil -1e-10 (a coefficient HiGHS drops), worth 1e7 x 1000 x 1e-10 = 1.0; b: +0.5 ergonomics. Same slot: the exact optimum is `a` (1.0).
  const lookup = lookupOf(
    gunWith(WEAPON, { slots: [slot('s', ['a', 'b'])] }),
    ['a', modWith('a', { ergo: 0, recoil: -1e-10 })],
    ['b', modWith('b', { ergo: 0.5 })],
  );
  const run = await solveCount(paramsOf(lookup, { recoilWeight: 1e7 }));
  const { certified, telemetry, bounds, best } = built(run);
  assert.deepEqual(installed(run), ['b'], 'HiGHS solved a different model: it sees `a` as worthless');
  assert.ok(Math.abs(best.score - 0.5) < 1e-12);
  assert.equal(certified, false, 'a naive pipeline would certify b; the exact optimum is a, 1.0');
  assert.equal(telemetry.unqualifiedSolves, 1);
  assert.ok(telemetry.unqualifiedReasons.some(r => /different model/.test(r)), telemetry.unqualifiedReasons.join(' | '));
  assert.equal(bounds.upper, null);
  assert.equal(bounds.gap, null);
  assert.ok(bounds.lower !== null && Math.abs(bounds.lower - 0.5) < 1e-12);
});

test('an infeasibility verdict from a solve whose parsed model differs from the text is not emptiness; with an honest solver the request is proved empty', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, slots: [slot('s', ['a'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })]);
  const tampered: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    const readback = real.readback;
    if (readback === null) return real;
    const colCost = Float64Array.from(readback.colCost);
    colCost[0] += 1;
    return { ...real, readback: { ...readback, colCost } } as NativeResult;
  };
  const verdict = await solveCount(paramsOf(lookup, { maxPrice: 10 }), { solve: tampered });
  assert.equal(verdict.kind, 'incomplete');
  assert.equal(verdict.kind === 'incomplete' && verdict.telemetry.confirmedInfeasible, 0);
  const honest = await solveCount(paramsOf(lookup, { maxPrice: 10 }));
  assert.equal(honest.kind, 'empty');
  assert.equal(honest.kind === 'empty' && honest.telemetry.confirmedInfeasible, 1);
  const blind: SolveFn = async (lp, options) => nativeSolve(lp, options);
  assert.equal((await solveCount(paramsOf(lookup, { maxPrice: 10 }), { solve: blind })).kind, 'incomplete', 'no readback, no emptiness');
});

/** One slot, two parts of equal ergonomics: A costs 100, B costs 1000. Only the 0.01 augmentation of the price axis tells them apart. */
const priceTie = () => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('s', ['a', 'b'], true)] }),
  ['a', mod('a', { weight: 0, ergo: 5, offers: [trader('prapor', 1, 100)] })],
  ['b', mod('b', { weight: 0, ergo: 5, offers: [trader('prapor', 1, 1000)] })],
);

test('a wide Tchebycheff price normalization is rescaled by an exact power of two and certified: the cheaper part wins by the 4.5e-8 the naive model could not see', async () => {
  const ideal = { zE: 100, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP: 1e8 };
  const run = await solveCount(paramsOf(priceTie(), { priceWeight: 1, useTchebycheff: true, idealPoint: ideal }));
  const { certified, best, telemetry, model, bounds } = built(run);
  assert.deepEqual(installed(run), ['a']);
  assert.equal(certified, true);
  assert.equal(telemetry.unqualifiedSolves, 0, 'HiGHS kept every coefficient');
  assert.ok(bounds.gap !== null && bounds.gap <= 1e-9);
  assert.ok(model !== null && model.proof.objective !== null && model.proof.objective.axisScales.some(s => s.exponent > 0), 'the price axis is read through a power-of-two scale');
  const expected = 0.01 * (50 / 200 - 5100 / 2e8) - Math.max((100 - 50) / 200, 5100 / 2e8);
  assert.ok(Math.abs(best.score - expected) < 1e-15, `${best.score} vs ${expected}`);
});

test('when no legal power-of-two rescaling exists the proof is withheld, the verified build is still published, and nothing certifies', async () => {
  const ideal = { zE: 100, nadE: 0, zR: 0, nadR: 0, zP: 0, nadP: 1e30 };
  const run = await solveCount(paramsOf(priceTie(), { priceWeight: 1, useTchebycheff: true, idealPoint: ideal }));
  const { certified, telemetry, bounds } = built(run);
  assert.equal(certified, false);
  assert.equal(bounds.upper, null);
  assert.ok(telemetry.unqualifiedReasons.some(r => /withheld at construction.*no power-of-two scaling of the axis/.test(r)), telemetry.unqualifiedReasons.join(' | '));
});

test('a bound that falls far below a build verified in its own node is withheld as a wrong bound; a few ulps of solver noise only count in boundShortfall', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 1, ergo: 25 })]);
  const lowered = (by: number): SolveFn => async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    return { ...real, mipDualBound: (real.mipDualBound as number) - by } as NativeResult;
  };
  const noisy = await solveCount(paramsOf(lookup), { solve: lowered(1e-13) });
  assert.equal(built(noisy).certified, true);
  assert.ok(built(noisy).telemetry.boundShortfall > 0 && built(noisy).telemetry.boundShortfall < 1e-12);
  const wrong = await solveCount(paramsOf(lookup), { solve: lowered(1) });
  assert.equal(built(wrong).certified, false);
  assert.equal(built(wrong).bounds.upper, null);
  assert.ok(Math.abs(built(wrong).telemetry.boundShortfall - 1) < 1e-9);
  assert.deepEqual(installed(wrong), ['b'], 'the verified witness is kept');
});

test('a presolved Optimal is a feasible witness only: the verified build is published, no bound, no certificate', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 1, ergo: 25 })]);
  const run = await solveCount(paramsOf(lookup), { presolve: 'choose' });
  const { certified, telemetry, bounds } = built(run);
  assert.deepEqual(installed(run), ['b']);
  assert.equal(certified, false);
  assert.equal(bounds.upper, null);
  assert.ok(telemetry.unqualifiedReasons.some(r => /presolve choose/.test(r)), telemetry.unqualifiedReasons.join(' | '));
  assert.equal(built(await solveCount(paramsOf(lookup))).certified, true);
});
