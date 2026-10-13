// TrueErgo and Prevent Overswing on the Fast pipeline (Phase 2.6b; src/solver/physical/solveFast.ts): the spatial search over total weight on the
// count model. Every published build is judged by the exact validator (Prevent Overswing exactly), a rejected point is cut, a relaxation optimum that
// overswings is refined, and the outcome rows are the Fast rows of ADR 0013 section 6: approximate, never a physical certificate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASON_SET, PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { solveFast } from '../../src/solver/physical/solveFast';
import type { FastResult } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { overfillEdges } from './tamper';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: true, allowRepeatedParts: true, ...extra,
});
const FAR = (): number => performance.now() + 120_000;

const built = (r: FastResult) => {
  assert.equal(r.kind, 'build', JSON.stringify(r.kind === 'build' ? '' : r));
  return r as Extract<FastResult, { kind: 'build' }>;
};
const installed = (r: FastResult): string[] => built(r).best.build.placements.map(p => p.itemId).sort();
const closeTo = (actual: number, expected: number, tolerance = 1e-6): void => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

/** A receiver of 1 kg with one required slot holding one part; part `id` weighs `weight` kg in total and adds `ergo` ergonomics. */
const choice = (parts: { id: string; weight: number; ergo: number }[]): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', parts.map(p => p.id), true)] }),
  ...parts.map(p => [p.id, mod(p.id, { weight: p.weight - 1, ergo: p.ergo })] as [string, ReturnType<typeof mod>]),
);
/** A (2 kg, 20 -> TED 20), B (3 kg, 30 -> TED 30, the knee), C (4 kg, 41 -> TED 41 - 25 = 16): TrueErgo prefers B, raw ergonomics C. */
const knee = (): ItemLookup => choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 30 }, { id: 'C', weight: 4, ergo: 41 }]);

/** The exact validator accepts the published build of a result, from scratch, and Prevent Overswing holds exactly. */
function assertValid(params: SolveParams, r: FastResult): void {
  const { best } = built(r);
  const verdict = validatePhysicalBuild(params.itemLookup, params, best.build, { requirePathInstanceIds: true });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.violations));
  if (params.preventOverswing) assert.ok(best.stats.ted >= 0, `Prevent Overswing: TED ${best.stats.ted} of the published build`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The search finds the exact TED optimum and reports it as a Fast optimum
// ---------------------------------------------------------------------------------------------------------------------------

test('TrueErgo: the weight search over the count model finds the Precise optimum, and the result is an approximate optimum with a spatial summary', async () => {
  const params = paramsOf(knee(), { ergoWeight: 100, useTrueErgo: true });
  const fast = await solveFast({ params, deadline: FAR() });
  const precise = await solvePrecise({ params, deadline: FAR() });
  assert.deepEqual(installed(fast), ['B'], 'the 3 kg part: ergonomics 30 at no penalty beats C (41 raw, 16 TED)');
  assert.equal(precise.kind === 'build' && precise.best.score, built(fast).best.score);
  closeTo(built(fast).best.score, 100 * 30, 1e-9);
  assertValid(params, fast);
  assert.deepEqual(built(fast).outcome, {
    status: 'optimal', physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: null, termination: 'optimal',
  });
  assert.equal(built(fast).optimal, true);
  assert.equal(fast.summary.spatial, true);
  assert.ok(fast.summary.nodes >= 2, `${fast.summary.nodes} nodes: the root is split at the 3 kg knee`);
  assert.ok(fast.summary.modelBound !== null && fast.summary.modelBound >= built(fast).best.score - 1e-9, 'the approximate-model bound sits at or above the witness');
  assert.ok(built(fast).best.scoreLower <= built(fast).best.score);
});

test('the raw-ergonomics request picks the heavy part and the TrueErgo request does not: the search reads TED, not the first clamp', async () => {
  const lookup = knee();
  assert.deepEqual(installed(await solveFast({ params: paramsOf(lookup, { ergoWeight: 100 }), deadline: FAR() })), ['C']);
  assert.deepEqual(installed(await solveFast({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true }), deadline: FAR() })), ['B']);
});

test('a weight cap clips the search range: the heavy part is out, and the best of the rest is the optimum', async () => {
  const lookup = knee();
  assert.deepEqual(installed(await solveFast({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxWeight: 3 }), deadline: FAR() })), ['B']);
  assert.deepEqual(installed(await solveFast({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxWeight: 2.5 }), deadline: FAR() })), ['A']);
});

test('the equipment modifier changes the effective ergonomics, and the search follows it (Fast and Precise agree)', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 25 }, { id: 'C', weight: 4, ergo: 60 }]);
  for (const equipErgoModifier of [0, -0.5, 0.5, -3]) {
    const params = paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, equipErgoModifier });
    const fast = await solveFast({ params, deadline: FAR() });
    const precise = await solvePrecise({ params, deadline: FAR() });
    assert.equal(precise.kind === 'build' && precise.best.score, built(fast).best.score, `modifier ${equipErgoModifier}`);
    assertValid(params, fast);
  }
});

/** Builds weigh 4, 4.5 (h or g) or 5 kg: on [4, 5] the chord credits h (ergonomics 60 at 4.5 kg) with TED 27.5 where its exact TED is 26.67. */
const chord = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 4, ergo: 50, slots: [slot('s1', ['h']), slot('s2', ['g'])] }),
  ['h', mod('h', { weight: 0.5, ergo: 10 })],
  ['g', mod('g', { weight: 0.5, ergo: -30 })],
);

test('the tolerance decides when the search stops: a loose one fathoms the secant node on the incumbent, a tight one refines it to the exact optimum', async () => {
  const params = paramsOf(chord(), { useTrueErgo: true });
  const loose = await solveFast({ params: { ...params, objectiveTolerance: 10 }, deadline: FAR() });
  const tight = await solveFast({ params: { ...params, objectiveTolerance: 1e-7 }, deadline: FAR() });
  // both searches finished; the loose one stopped at the root, the tight one split it
  assert.equal(built(loose).outcome.status, 'optimal');
  assert.equal(built(tight).outcome.status, 'optimal');
  assert.equal(loose.summary.nodes, 1, 'the root bound is within the tolerance of its own verified build');
  assert.ok(tight.summary.nodes >= 3, tight.summary.nodes + ' nodes: the root and the halves');
  // the exact score of the verified build: h with TED 60 - q(4.5), in both, never the relaxation's 27.5
  const exactH = 60 - (100 - 300 / 4.5);
  closeTo(built(loose).best.score, exactH, 1e-9);
  closeTo(built(tight).best.score, exactH, 1e-9);
  const precise = await solvePrecise({ params: { ...params, objectiveTolerance: 1e-7 }, deadline: FAR() });
  closeTo(built(tight).best.score, precise.kind === 'build' ? precise.best.score : Number.NaN, 1e-9);
  // the approximate-model bound of the loose search is the relaxation's, above the exact score by the secant gap; the tight search closes it
  assert.ok(loose.summary.modelBound !== null && loose.summary.modelBound > built(loose).best.score + 0.5);
  assert.ok(tight.summary.modelBound !== null && tight.summary.modelBound - built(tight).best.score <= 1e-6);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Prevent Overswing: the exact validator decides, a relaxation optimum that overswings is refined, never published
// ---------------------------------------------------------------------------------------------------------------------------

/**
 * Receiver 4 kg, ergonomics 30. Builds weigh 4, 4.5 (h or g) or 5 kg. The chord of the penalty on [4, 5] is 15 W - 35: at 4.5 kg it is 32.5 where q is 33.33.
 * Part h (+3 ergonomics) reaches 33 at 4.5 kg: feasible for the chord, overswinging exactly (TED -0.33). The only exact feasible build is the bare receiver.
 */
const relaxed = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 4, ergo: 30, slots: [slot('s1', ['h']), slot('s2', ['g'])] }),
  ['h', mod('h', { weight: 0.5, ergo: 3 })],
  ['g', mod('g', { weight: 0.5, ergo: -30 })],
);

test('Prevent Overswing: a relaxation optimum that overswings exactly is refined, not published and not cut; the exact feasible build is the answer', async () => {
  const params = paramsOf(relaxed(), { preventOverswing: true });
  const fast = await solveFast({ params, deadline: FAR() });
  assert.deepEqual(installed(fast), [], 'the bare receiver: TED 5');
  closeTo(built(fast).best.score, 30, 1e-9);
  assertValid(params, fast);
  assert.equal(fast.summary.rejectedPoints, 0, 'an overswinging relaxation point is refined at its weight, no no-good cut');
  assert.ok(fast.summary.nodes >= 3, `${fast.summary.nodes} nodes: the root, then the halves at 4.5 kg`);
  assert.equal(built(fast).outcome.status, 'optimal');
  const precise = await solvePrecise({ params, deadline: FAR() });
  assert.equal(precise.kind === 'build' && precise.best.score, built(fast).best.score);
  // Without Prevent Overswing the overswinging build is simply the better one.
  assert.deepEqual(installed(await solveFast({ params: paramsOf(relaxed()), deadline: FAR() })), ['h']);
});

test('Prevent Overswing with a TrueErgo objective: the best build whose TED is not negative', async () => {
  const params = paramsOf(relaxed(), { useTrueErgo: true, preventOverswing: true });
  const fast = await solveFast({ params, deadline: FAR() });
  assertValid(params, fast);
  const precise = await solvePrecise({ params, deadline: FAR() });
  assert.equal(precise.kind === 'build' && precise.best.score, built(fast).best.score);
  assert.ok(built(fast).best.stats.ted >= 0);
});

test('Prevent Overswing with no feasible build anywhere is a Fast emptiness: incomplete, the approximate-model reason, a finished search, never infeasible', async () => {
  // A 6 kg receiver with 10 ergonomics: TED -40 whatever is installed.
  const lookup = lookupOf(gun(WEAPON, { weight: 6, ergo: 10, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 0, ergo: 0 })]);
  const none = await solveFast({ params: paramsOf(lookup, { preventOverswing: true }), deadline: FAR() });
  assert.equal(none.kind, 'empty');
  assert.equal(none.kind === 'empty' && none.source, 'native');
  assert.deepEqual(none.outcome, {
    status: 'incomplete', physical_certificate: 'none', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: null, termination: 'optimal',
    reason: PUBLIC_REASONS.approximateModelInfeasible,
  });
  const moa = await solveFast({ params: paramsOf(lookup, { preventOverswing: true, maxMOA: 100 }), deadline: FAR() });
  assert.equal(moa.kind, 'empty');
  assert.equal(moa.outcome.reason, PUBLIC_REASONS.fastProvisionalMoaModelInfeasible);
  assert.equal(moa.outcome.moa_qualification, 'provisional_model');
  // a constant row of the request (an included item nobody has) is no native verdict
  const ghost = await solveFast({ params: paramsOf(lookup, { preventOverswing: true, includeItems: ['ghost'] }), deadline: FAR() });
  assert.equal(ghost.kind === 'empty' && ghost.source, 'request');
  // the precise model proves the same emptiness
  const precise = await solvePrecise({ params: paramsOf(lookup, { preventOverswing: true }), deadline: FAR() });
  assert.equal(precise.kind, 'empty');
});

test('Prevent Overswing at its exact boundary: TED of exactly 0 is published, a hair below is not', async () => {
  const at = (ergo: number): ItemLookup => lookupOf(gun(WEAPON, { weight: 6, ergo, slots: [slot('s', ['a'])] }), ['a', mod('a', { weight: 0, ergo: 0 })]);
  const boundary = await solveFast({ params: paramsOf(at(50), { preventOverswing: true }), deadline: FAR() });
  assert.equal(built(boundary).best.stats.ted, 0);
  assert.equal((await solveFast({ params: paramsOf(at(49.99), { preventOverswing: true }), deadline: FAR() })).kind, 'empty');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Limits and stops: the factual reason, a verified witness is kept
// ---------------------------------------------------------------------------------------------------------------------------

const withStatus = (name: string, code: number): SolveFn => async (lp, options, extras) =>
  ({ ...(await nativeSolve(lp, options, extras)), modelStatus: { code, name } }) as unknown as NativeResult;

test('a node cap keeps the verified witness (feasible, Node limit reached, an unfinished search) and with no node at all is incomplete', async () => {
  const params = paramsOf(knee(), { ergoWeight: 100, useTrueErgo: true });
  const one = await solveFast({ params: { ...params, maxSpatialNodes: 1 }, deadline: FAR() });
  assert.equal(built(one).optimal, false);
  assert.equal(one.outcome.status, 'feasible');
  assert.equal(one.outcome.physical_certificate, 'feasible');
  assert.equal(one.outcome.reason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(one.outcome.termination, 'limit');
  assert.equal(one.summary.nodes, 1);
  assertValid(params, one);
  const none = await solveFast({ params: { ...params, maxSpatialNodes: 0 }, deadline: FAR() });
  assert.equal(none.kind, 'incomplete');
  assert.equal(none.outcome.status, 'incomplete');
  assert.equal(none.outcome.physical_certificate, 'none');
  assert.equal(none.outcome.reason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(none.outcome.termination, 'limit');
  assert.equal(none.summary.nodes, 0);
  // a request with no TED has no spatial dimension: the cap does not apply
  const plain = await solveFast({ params: paramsOf(knee(), { ergoWeight: 100, maxSpatialNodes: 0 }), deadline: FAR() });
  assert.equal(built(plain).outcome.status, 'optimal');
  assert.equal(plain.summary.spatial, false);
  assert.equal(plain.summary.nodes, 0);
});

test('a deadline that has passed starts nothing, and a native limit stop keeps its factual reason with the witness it holds', async () => {
  const params = paramsOf(knee(), { ergoWeight: 100, useTrueErgo: true });
  const late = await solveFast({ params, deadline: performance.now() - 1 });
  assert.equal(late.kind, 'incomplete');
  assert.equal(late.outcome.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(late.outcome.termination, 'limit');
  assert.equal(late.summary.nodes, 0);
  for (const [name, code, reason] of [['TimeLimit', 13, PUBLIC_REASONS.timeLimitReached], ['SolutionLimit', 14, PUBLIC_REASONS.nativeSolutionLimitReached]] as const) {
    const limited = await solveFast({ params, deadline: FAR(), solve: withStatus(name, code) });
    assert.equal(limited.outcome.status, 'feasible', name);
    assert.equal(limited.outcome.reason, reason, name);
    assert.equal(limited.outcome.termination, 'limit', name);
    assert.equal(limited.outcome.physical_certificate, 'feasible', name);
    assertValid(params, limited);
    const empty = await solveFast({
      params, deadline: FAR(),
      solve: async (lp, options, extras) => ({ ...(await withStatus(name, code)(lp, options, extras)), colValues: null }) as unknown as NativeResult,
    });
    assert.equal(empty.kind, 'incomplete', name);
    assert.equal(empty.outcome.reason, reason, name);
    assert.equal(empty.outcome.termination, 'limit', name);
  }
});

test('a presolved solve gives no bound: an inexact node is never fathomed on it, so the search ends at the weight resolution with the verified witness and no optimum', async () => {
  // presolve 'choose' on the first round: the effective option is not 'off', so the dual bound is unusable (HiGHS 1.15.1 presolve can report a wrong
  // Optimal, nativeSolve.ts). The exact node [2, 3] is settled by its own solve; the secant node [3, 4] has no bound to fathom on and is refined until
  // it can be split no more. The witness is still the exactly validated optimum, and nothing is claimed about it.
  const params = paramsOf(knee(), { ergoWeight: 100, useTrueErgo: true });
  const result = await solveFast({ params, deadline: FAR(), presolve: 'choose' });
  assertValid(params, result);
  closeTo(built(result).best.score, 3000, 1e-9);
  assert.equal(built(result).optimal, false);
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(result.outcome.termination, 'limit');
  assert.equal(result.summary.modelBound, null, 'an unknown bound stays unknown');
});

test('rejected points are cut per node and a solver that keeps returning them ends in the validation reason, with the TED node loop', async () => {
  // One slot, two candidates; the tampered solver answers with both edges at 1, a point the decoder cannot place (tamper.ts).
  const rejectable = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s0', ['A', 'B'])] }),
    ['A', mod('A', { ergo: 20, weight: 0.5 })],
    ['B', mod('B', { ergo: 10, weight: 0.5 })],
  );
  const params = paramsOf(rejectable, { useTrueErgo: true, ergoWeight: 10 });
  const ok = await solveFast({ params, deadline: FAR(), solve: overfillEdges(1), edgeIntegrality: 'integer' });
  assert.ok(ok.summary.rejectedPoints >= 1, 'the tampered point is no physical tree');
  assertValid(params, ok);
  const rejected = await solveFast({ params, deadline: FAR(), solve: overfillEdges(), maxRejections: 2, edgeIntegrality: 'integer' });
  assert.equal(rejected.kind, 'incomplete');
  assert.equal(rejected.outcome.reason, PUBLIC_REASONS.independentBuildValidationFailed);
  assert.equal(rejected.summary.rejectedPoints, 2);
  for (const result of [ok, rejected]) if (result.outcome.reason !== undefined) assert.ok(PUBLIC_REASON_SET.has(result.outcome.reason));
});
