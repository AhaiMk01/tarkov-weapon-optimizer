// The proof frame of production Precise on the certified count model, end to end (`solvePrecise`, Phase 2.10): a filtered coefficient withholds the bound and any
// infeasibility verdict while the verified build is still published, a wide Tchebycheff price normalization is rescaled exactly and certified, a bound that
// contradicts a verified witness is withheld, a tampered readback or a presolved solve proves nothing, and unknown bounds travel as null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { preparePhysicalWeapon, prepareSubproblemDomain, specializeCount } from '../../src/solver/physical';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseContext, PreciseResult } from '../../src/solver/physical/solvePrecise';
import { validatePhysicalBuild } from '../../src/solver/physical/validate';
import { gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from './lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-9, ...extra,
});

type Run = PreciseResult & { telemetry: PreciseResult['summary']['telemetry']; bounds: PreciseResult['summary']['bounds'] };
/** Production Precise with a generous deadline; the telemetry and bounds are lifted to the top for the assertions below. */
const solveCount = async (params: SolveParams, options: Omit<PreciseContext, 'params'> = {}): Promise<Run> => {
  const result = await solvePrecise({ params, deadline: performance.now() + 120_000, ...options });
  return Object.assign(result, { telemetry: result.summary.telemetry, bounds: result.summary.bounds });
};
const built = (r: Run) => {
  assert.equal(r.kind, 'build', JSON.stringify({ kind: r.kind, reason: 'reason' in r ? r.reason : undefined }));
  return r as Extract<PreciseResult, { kind: 'build' }> & Run;
};
const installed = (r: Run): string[] => built(r).best.build.placements.map(p => p.itemId).sort();

test('every native solve is qualified: none unqualified on a plain request and on a spatial search, and a certificate follows', async () => {
  const lookup = lookupOf(gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 4, ergo: 40 })]);
  const plain = await solveCount(paramsOf(lookup));
  assert.equal(plain.telemetry.unqualifiedSolves, 0);
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
  const params = paramsOf(lookup, { recoilWeight: 1e7 });
  const run = await solveCount(params);
  const { certified, telemetry, bounds, best } = built(run);
  // Filtering changes the native model, so its choice of witness is not an exact-optimality claim.
  const verified = validatePhysicalBuild(lookup, params, best.build, { requirePathInstanceIds: true });
  assert.equal(verified.ok, true, JSON.stringify(verified.violations));
  assert.deepEqual(best.stats, verified.stats);
  assert.equal(certified, false, 'a naive pipeline would certify it; the exact optimum is a, 1.0');
  assert.ok(telemetry.unqualifiedSolves >= 1, 'the relaxed-edge try and the integer fallback read the same filtered coefficient');
  assert.ok(telemetry.unqualifiedReasons.some(r => /different model/.test(r)), telemetry.unqualifiedReasons.join(' | '));
  assert.equal(bounds.upper, null);
  assert.equal(bounds.gap, null);
  assert.equal(bounds.lower, best.scoreLower, 'the lower bound is the downward enclosure of the verified build');
  assert.ok(bounds.lower !== null && bounds.lower <= best.score);
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
  assert.equal(verdict.telemetry.confirmedInfeasible, 0);
  const honest = await solveCount(paramsOf(lookup, { maxPrice: 10 }));
  assert.equal(honest.kind, 'empty');
  assert.equal(honest.telemetry.confirmedInfeasible, 1);
  assert.equal(honest.telemetry.secondOpinions, 1, 'the infeasibility was confirmed by a second seed');
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
  const params = paramsOf(priceTie(), { priceWeight: 1, useTchebycheff: true, idealPoint: ideal });
  const run = await solveCount(params);
  const { certified, best, telemetry, bounds } = built(run);
  assert.deepEqual(installed(run), ['a']);
  assert.equal(certified, true);
  assert.equal(telemetry.unqualifiedSolves, 0, 'HiGHS kept every coefficient');
  assert.ok(bounds.gap !== null && bounds.gap <= 1e-9);
  const blueprint = preparePhysicalWeapon(params.itemLookup, WEAPON);
  const model = specializeCount(blueprint, prepareSubproblemDomain(blueprint, params.itemLookup, params), params);
  assert.ok(model.proof.objective !== null && model.proof.objective.axisScales.some(s => s.exponent > 0), 'the price axis is read through a power-of-two scale');
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

test('bound-specialized first clamps certify every regime and keep min-ergonomics feasibility with zero objective weights', async () => {
  for (const [receiver, addition, expected] of [[-10, 1, 0], [110, 1, 100], [37, 1, 38], [-5, 10, 5], [99, 2, 100], [-5, 110, 100]]) {
    const lookup = lookupOf(gun(WEAPON, { ergo: receiver, slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: addition })]);
    const run = await solveCount(paramsOf(lookup, { objectiveTolerance: 1e-6 }));
    assert.equal(built(run).certified, true);
    assert.equal(run.telemetry.unqualifiedSolves, 0);
    assert.ok(Math.abs(built(run).best.score - expected) <= 1e-9);
  }
  const lookup = lookupOf(gun(WEAPON, { ergo: -5, slots: [slot('s', ['a'])] }), ['a', mod('a', { ergo: 110 })]);
  const weights = { ergoWeight: 0, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-6 };
  for (const minErgonomics of [0, 99.99, 100]) {
    const run = await solveCount(paramsOf(lookup, { ...weights, minErgonomics }));
    assert.equal(built(run).certified, true);
    assert.equal(built(run).best.score, 0);
    if (minErgonomics > 0) assert.deepEqual(installed(run), ['a']);
  }
  const empty = await solveCount(paramsOf(lookup, { ...weights, minErgonomics: 100.01 }));
  assert.equal(empty.kind, 'empty');
});

test('repeated parts remain available to zero weighted or Tchebycheff objectives when the capped minimum requires both copies', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: -10, slots: [slot('s1', ['a']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 60 })],
  );
  for (const useTchebycheff of [false, true]) {
    const run = await solveCount(paramsOf(lookup, {
      ergoWeight: 0, recoilWeight: 0, priceWeight: 0, minErgonomics: 100, useTchebycheff,
      idealPoint: { zE: 1000, nadE: 0, zR: 0, nadR: 0, zP: 5000, nadP: 10000 }, objectiveTolerance: 1e-6,
    }));
    assert.equal(built(run).certified, true);
    assert.equal(run.telemetry.unqualifiedSolves, 0);
    assert.equal(built(run).best.score, 0);
    assert.deepEqual(installed(run), ['a', 'a']);
  }
});

test('second-clamp zero, identity, neighboring-factor and saturation requests retain qualified nonlinear search', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { ergo: 60, weight: 4, slots: [slot('s', ['a'])] }),
    ['a', mod('a', { ergo: 30, weight: 1 })],
  );
  for (const equipErgoModifier of [-1, -0.2, 0, 1, 3]) {
    const run = await solveCount(paramsOf(lookup, { useTrueErgo: true, equipErgoModifier, objectiveTolerance: 1e-6 }));
    assert.equal(built(run).certified, true);
    assert.equal(run.telemetry.unqualifiedSolves, 0);
  }
  for (const useTrueErgo of [false, true]) {
    const run = await solveCount(paramsOf(lookup, {
      useTrueErgo, preventOverswing: true, equipErgoModifier: 1,
      ergoWeight: 0, recoilWeight: 0, priceWeight: 0, objectiveTolerance: 1e-6,
    }));
    assert.equal(built(run).certified, true);
    assert.equal(run.telemetry.unqualifiedSolves, 0);
    assert.equal(built(run).best.score, 0);
  }
});
