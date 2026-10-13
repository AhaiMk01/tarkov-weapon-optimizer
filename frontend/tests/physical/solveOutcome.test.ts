// The classifier wired into the two pipelines (src/solver/physical/solvePrecise.ts and solveFast.ts, ADR 0013 section 6): each result carries the
// outcome the classifier chose for what the search established, on the pinned native build with injected native statuses where a limit or a
// tampered read is needed. Termination is search completion only: a native solve that ran to Optimal and whose proof or candidate was then
// withheld is a FINISHED search; a clock stop, a node cap or a spatial interval too narrow to split is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASON_SET, PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { OptimizeOutcome } from '../../src/solver/physical/outcome';
import { solveFast } from '../../src/solver/physical/solveFast';
import type { FastResult } from '../../src/solver/physical/solveFast';
import { solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { overfillEdges } from './tamper';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, allowRepeatedParts: true, ...extra,
});
const FAR = (): number => performance.now() + 120_000;

const small = (): ItemLookup => lookupOf(gun(WEAPON, { slots: [slot('s', ['a', 'b'])] }), ['a', mod('a', { ergo: 5 })], ['b', mod('b', { ergo: 8 })]);

/** A receiver 1 kg with one required slot holding one part; part `w<k>` weighs k kg in total. */
const choice = (parts: { id: string; weight: number; ergo: number }[]): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', parts.map(p => p.id), true)] }),
  ...parts.map(p => [p.id, mod(p.id, { weight: p.weight - 1, ergo: p.ergo })] as [string, ReturnType<typeof mod>]),
);

const withStatus = (name: string, code: number): SolveFn => async (lp, options, extras) =>
  ({ ...(await nativeSolve(lp, options, extras)), modelStatus: { code, name } }) as unknown as NativeResult;

const closed = (outcome: OptimizeOutcome): void => {
  if (outcome.reason !== undefined) assert.ok(PUBLIC_REASON_SET.has(outcome.reason), `${outcome.reason} is outside the closed reason set`);
};

// ---------------------------------------------------------------------------------------------------------------------------
// Precise
// ---------------------------------------------------------------------------------------------------------------------------

test('Precise: a certified optimum, with and without a MOA cap, and the same request under a MOA cap is no physical certificate', async () => {
  const plain = await solvePrecise({ params: paramsOf(small()), deadline: FAR() });
  assert.equal(plain.kind, 'build');
  assert.deepEqual(plain.outcome, {
    status: 'optimal', physical_certificate: 'certified_optimal', precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: null, termination: 'optimal',
  });
  const moa = await solvePrecise({ params: paramsOf(small(), { maxMOA: 100 }), deadline: FAR() });
  assert.equal(moa.kind, 'build');
  assert.equal(moa.outcome.physical_certificate, 'approximate_optimal');
  assert.equal(moa.outcome.moa_qualification, 'provisional_model');
  assert.equal(moa.kind === 'build' && moa.certified, true, 'the search itself still certified its model optimum');
});

test('Precise: emptiness is a certified infeasibility only without a MOA cap; with one it is incomplete with the provisional reason; the domain and a constant row prove it with no native call', async () => {
  const empty = await solvePrecise({ params: paramsOf(small(), { maxPrice: 10 }), deadline: FAR() });
  assert.equal(empty.kind, 'empty');
  assert.equal(empty.outcome.status, 'infeasible');
  assert.equal(empty.outcome.physical_certificate, 'certified_infeasible');
  assert.equal(empty.outcome.termination, 'optimal');
  const moa = await solvePrecise({ params: paramsOf(small(), { maxPrice: 10, maxMOA: 100 }), deadline: FAR() });
  assert.equal(moa.kind, 'empty');
  assert.equal(moa.outcome.status, 'incomplete');
  assert.equal(moa.outcome.physical_certificate, 'none');
  assert.equal(moa.outcome.reason, PUBLIC_REASONS.provisionalMoaModelInfeasible);
  assert.equal(moa.outcome.termination, 'optimal', 'the internal proof is retained');
  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const domain = await solvePrecise({ params: paramsOf(noBase), deadline: FAR(), solve: async () => assert.fail('no native call') });
  assert.equal(domain.kind === 'empty' && domain.source, 'domain');
  assert.equal(domain.outcome.status, 'infeasible');
  assert.equal(domain.outcome.termination, 'optimal');
});

test('Precise: native limits keep their factual reasons and terminate limit; a witness found under a limit is feasible, none is incomplete', async () => {
  const cases: [string, number, string][] = [
    ['TimeLimit', 13, PUBLIC_REASONS.timeLimitReached],
    ['SolutionLimit', 14, PUBLIC_REASONS.nativeSolutionLimitReached],
    ['IterationLimit', 15, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable],
  ];
  for (const [name, code, reason] of cases) {
    const result = await solvePrecise({ params: paramsOf(small()), deadline: FAR(), solve: withStatus(name, code) });
    assert.equal(result.kind, 'build', name);
    assert.equal(result.outcome.status, 'feasible', name);
    assert.equal(result.outcome.physical_certificate, 'feasible', name);
    assert.equal(result.outcome.reason, reason, name);
    assert.equal(result.outcome.termination, 'limit', `${name}: a native limit is an unfinished search`);
    assert.equal(result.kind === 'build' && result.reason, reason);
    closed(result.outcome);
    const none = await solvePrecise({
      params: paramsOf(small()), deadline: FAR(),
      solve: async (lp, options, extras) => ({ ...(await withStatus(name, code)(lp, options, extras)), colValues: null }) as unknown as NativeResult,
    });
    assert.equal(none.kind, 'incomplete', name);
    assert.equal(none.outcome.status, 'incomplete', name);
    assert.equal(none.outcome.physical_certificate, 'none', name);
    assert.equal(none.outcome.reason, reason, name);
    assert.equal(none.outcome.termination, 'limit', name);
  }
});

test('Precise: a node cap and a passed deadline stop an unfinished search (limit) with their own reasons, the cap before a witness or after one', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 30 }, { id: 'C', weight: 4, ergo: 41 }]);
  const params = paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true });
  const one = await solvePrecise({ params: { ...params, maxSpatialNodes: 1 }, deadline: FAR() });
  assert.equal(one.outcome.status, 'feasible');
  assert.equal(one.outcome.reason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(one.outcome.termination, 'limit');
  const none = await solvePrecise({ params: { ...params, maxSpatialNodes: 0 }, deadline: FAR() });
  assert.equal(none.outcome.status, 'incomplete');
  assert.equal(none.outcome.reason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(none.outcome.termination, 'limit');
  const late = await solvePrecise({ params, deadline: performance.now() - 1 });
  assert.equal(late.outcome.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(late.outcome.termination, 'limit');
});

test('Precise: a finished native solve whose parsed model differs is a finished search without proof: feasible, termination optimal, the prerequisite reason', async () => {
  const lookup = small();
  const tampered: SolveFn = async (lp, options, extras) => ({ ...(await nativeSolve(lp, options, extras)), readStatus: 'warning' }) as NativeResult;
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: tampered });
  assert.equal(result.kind, 'build');
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.physical_certificate, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(result.outcome.termination, 'optimal', 'the native search completed; only its proof is withheld');
  // The same for an infeasibility verdict nobody can trust: incomplete / none, the search finished, no emptiness claim.
  const verdict = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve: tampered });
  assert.equal(verdict.kind, 'incomplete');
  assert.equal(verdict.outcome.status, 'incomplete');
  assert.equal(verdict.outcome.physical_certificate, 'none');
  assert.equal(verdict.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(verdict.outcome.termination, 'optimal');
});

test('Precise: a node that is not finished stays limit even when its last native solve was Optimal: an unqualified solve of an inexact spatial node', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 30 }, { id: 'C', weight: 4, ergo: 41 }]);
  const tampered: SolveFn = async (lp, options, extras) => ({ ...(await nativeSolve(lp, options, extras)), readStatus: 'warning' }) as NativeResult;
  const result = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true }), deadline: FAR(), solve: tampered });
  assert.equal(result.outcome.status, 'feasible');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(result.outcome.termination, 'limit', 'an unfinished spatial search is limit even if its last native sub-solve completed');
});

test('Precise: candidates the validator keeps rejecting end in the validation reason, and the finished search stays optimal', async () => {
  // u + v weigh 3 + 2^-52 kg under a cap of 3: the solver accepts the pair, the exact validator never does. A solver that ignores the cuts returns it forever.
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s1', ['u']), slot('s2', ['v'])] }),
    ['u', mod('u', { weight: 1, ergo: 1 })],
    ['v', mod('v', { weight: 1 + 2 ** -52, ergo: 2 })],
  );
  let first: NativeResult | null = null;
  const stuck: SolveFn = async (lp, options, extras) => {
    if (first === null) first = await nativeSolve(lp, options, extras);
    return first;
  };
  // The integer cut loop (no relaxed-edge try: a stuck answer to the relaxed text would not even read back as the integer text).
  const result = await solvePrecise({ params: paramsOf(lookup, { maxWeight: 3 }), deadline: FAR(), solve: stuck, edgeIntegrality: 'integer' });
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.outcome.status, 'incomplete');
  assert.equal(result.outcome.physical_certificate, 'none');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.independentBuildValidationFailed);
  assert.equal(result.outcome.termination, 'optimal', 'a completed search followed by failed validation remains optimal');
  assert.ok(result.summary.telemetry.rejectedCandidates >= 1);
});

test('Precise: every outcome reason of every result kind is in the closed set', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 30 }]);
  const results: PreciseResult[] = [
    await solvePrecise({ params: paramsOf(lookup), deadline: FAR() }),
    await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR() }),
    await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10, maxMOA: 5 }), deadline: FAR() }),
    await solvePrecise({ params: paramsOf(lookup, { useTrueErgo: true, maxSpatialNodes: 0 }), deadline: FAR() }),
    await solvePrecise({ params: paramsOf(lookup), deadline: performance.now() - 1 }),
  ];
  for (const r of results) closed(r.outcome);
});

// ---------------------------------------------------------------------------------------------------------------------------
// Fast
// ---------------------------------------------------------------------------------------------------------------------------

const fastParams = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => paramsOf(lookup, { fleaAvailable: true, ...extra });
const builtFast = (r: FastResult) => {
  assert.equal(r.kind, 'build', JSON.stringify(r.kind === 'build' ? '' : r));
  return r as Extract<FastResult, { kind: 'build' }>;
};

test('Fast: an optimum is approximate_optimal, never certified, with the lower bound of the witness and no physical upper bound; MOA stays provisional', async () => {
  const result = await solveFast({ params: fastParams(small()), deadline: FAR() });
  const { best, outcome } = builtFast(result);
  assert.deepEqual(outcome, {
    status: 'optimal', physical_certificate: 'approximate_optimal', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: null, termination: 'optimal',
  });
  assert.ok(best.scoreLower <= best.score, 'the lower bound encloses the exact score from below');
  assert.ok(best.score - best.scoreLower <= 1e-12 * Math.max(1, Math.abs(best.score)));
  assert.equal(result.summary.tolerance, 1e-5);
  const moa = await solveFast({ params: fastParams(small(), { maxMOA: 100 }), deadline: FAR() });
  assert.equal(builtFast(moa).outcome.moa_qualification, 'provisional_model');
});

test('Fast: emptiness is incomplete with the approximate-model reason (the Fast provisional reason under a MOA cap), terminated optimal, from every source', async () => {
  const native = await solveFast({ params: fastParams(small(), { maxPrice: 10 }), deadline: FAR() });
  assert.equal(native.kind === 'empty' && native.source, 'native');
  assert.deepEqual(native.outcome, {
    status: 'incomplete', physical_certificate: 'none', precision_resolved: 'fast', model_qualification: 'approximate', moa_qualification: null, termination: 'optimal',
    reason: PUBLIC_REASONS.approximateModelInfeasible,
  });
  const moa = await solveFast({ params: fastParams(small(), { maxPrice: 10, maxMOA: 100 }), deadline: FAR() });
  assert.equal(moa.outcome.reason, PUBLIC_REASONS.fastProvisionalMoaModelInfeasible);
  assert.equal(moa.outcome.moa_qualification, 'provisional_model');
  const noBase = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const domain = await solveFast({ params: fastParams(noBase), deadline: FAR() });
  assert.equal(domain.kind === 'empty' && domain.source, 'domain');
  assert.equal(domain.outcome.status, 'incomplete');
  const ghost = await solveFast({ params: fastParams(small(), { includeItems: ['ghost'] }), deadline: FAR() });
  assert.equal(ghost.kind === 'empty' && ghost.source, 'request');
  assert.equal(ghost.outcome.reason, PUBLIC_REASONS.approximateModelInfeasible);
});

test('Fast: a native limit with a verified build is feasible with the factual reason and an unfinished search; a limit with no solution is incomplete', async () => {
  for (const [name, code, reason] of [['TimeLimit', 13, PUBLIC_REASONS.timeLimitReached], ['SolutionLimit', 14, PUBLIC_REASONS.nativeSolutionLimitReached]] as const) {
    const result = await solveFast({ params: fastParams(small()), deadline: FAR(), solve: withStatus(name, code) });
    assert.equal(builtFast(result).optimal, false, name);
    assert.equal(result.outcome.status, 'feasible', name);
    assert.equal(result.outcome.physical_certificate, 'feasible', name);
    assert.equal(result.outcome.reason, reason, name);
    assert.equal(result.outcome.termination, 'limit', name);
    const none = await solveFast({
      params: fastParams(small()), deadline: FAR(),
      solve: async (lp, options, extras) => ({ ...(await withStatus(name, code)(lp, options, extras)), colValues: null }) as unknown as NativeResult,
    });
    assert.equal(none.kind, 'incomplete', name);
    assert.equal(none.outcome.status, 'incomplete', name);
    assert.equal(none.outcome.reason, reason, name);
    assert.equal(none.outcome.termination, 'limit', name);
  }
});

test('Fast: a deadline that has passed starts nothing (limit); candidates the validator keeps rejecting end in the validation reason', async () => {
  const late = await solveFast({ params: fastParams(small()), deadline: performance.now() - 1 });
  assert.equal(late.kind, 'incomplete');
  assert.equal(late.outcome.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(late.outcome.termination, 'limit');
  assert.equal(late.outcome.physical_certificate, 'none');
  // A solver whose every answer is a point the decoder cannot place (tamper.ts): the rejection limit ends the loop.
  const rejectable = lookupOf(
    gun(WEAPON, { slots: [slot('s0', ['A', 'B'])] }),
    ['A', mod('A', { ergo: 20 })],
    ['B', mod('B', { ergo: 10 })],
  );
  const rejected = await solveFast({ params: fastParams(rejectable), deadline: FAR(), solve: overfillEdges(), maxRejections: 2 });
  assert.equal(rejected.kind, 'incomplete');
  assert.equal(rejected.outcome.reason, PUBLIC_REASONS.independentBuildValidationFailed);
  assert.equal(rejected.outcome.termination, 'optimal', 'the last native solve was Optimal: a completed search followed by failed validation');
  // The same rejection coinciding with the deadline: the failure outranks the clock, and the cut model was never solved (unfinished).
  let t = 0;
  const clock = (): number => t;
  const overfill = overfillEdges();
  const ticking: SolveFn = async (lp, options, extras) => {
    const answer = await overfill(lp, options, extras);
    t += 1_000;
    return answer;
  };
  const coincident = await solveFast({ params: fastParams(rejectable), deadline: 500, now: clock, solve: ticking });
  assert.equal(coincident.kind, 'incomplete');
  assert.equal(coincident.outcome.reason, PUBLIC_REASONS.independentBuildValidationFailed);
  assert.equal(coincident.outcome.termination, 'limit');
});
