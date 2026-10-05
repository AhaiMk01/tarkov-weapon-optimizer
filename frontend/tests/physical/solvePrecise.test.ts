// The Precise solve pipeline (src/solver/physical/solvePrecise.ts) on hand-built lookups and the pinned native build: certified optimum,
// emptiness (no native call when it is proved, confirmed with presolve off when it is not), the presolve defect, the rejection cuts, the
// spatial search at a 1e-9 tolerance, the limits, and the memoized blueprint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolverError } from '../../src/solver/native';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { getPhysicalBlueprint, solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { PreciseResult } from '../../src/solver/physical/solvePrecise';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { gun, lookupOf, mod, slot, trader, WEAPON } from './lpFixtures';

const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
  ergoWeight: 1, recoilWeight: 0, priceWeight: 0, ...extra,
});

const FAR = (): number => performance.now() + 120_000;

/** A solver that counts calls and records whether presolve was forced off, then delegates to the pinned build. */
function counting(): { solve: SolveFn; calls: { presolveOff: boolean }[] } {
  const calls: { presolveOff: boolean }[] = [];
  return { calls, solve: async (lp, options) => { calls.push({ presolveOff: options.presolve === 'off' }); return nativeSolve(lp, options); } };
}

const fakeInfeasible = (real: NativeResult): NativeResult =>
  ({ ...real, modelStatus: { code: 8, name: 'Infeasible' }, colValues: null, objectiveValue: null }) as unknown as NativeResult;

/** Receiver 1 kg, one required slot holding exactly one of the parts; a part named `w<k>` weighs k kg in total (build weight). */
const choice = (parts: { id: string; weight: number; ergo: number }[]): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', parts.map(p => p.id), true)] }),
  ...parts.map(p => [p.id, mod(p.id, { weight: p.weight - 1, ergo: p.ergo })] as [string, ReturnType<typeof mod>]),
);

const build = (r: PreciseResult) => {
  assert.equal(r.kind, 'build', JSON.stringify(r, (_k, v) => (typeof v === 'object' && v !== null && 'decoded' in v ? '<build>' : v)));
  return r as Extract<PreciseResult, { kind: 'build' }>;
};
const installed = (r: PreciseResult): string[] => build(r).best.build.placements.map(p => p.itemId).sort();

test('a plain request is one native solve, a verified build and a certificate; the score and the statistics are the exact recomputation', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }, { id: 'b', weight: 2, ergo: 25 }]);
  const { solve, calls } = counting();
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.deepEqual(installed(result), ['b']);
  const { best, certified, summary } = build(result);
  assert.equal(certified, true);
  assert.equal(calls.length, 1);
  assert.equal(summary.nodes, 1);
  assert.equal(summary.spatial, false);
  assert.equal(summary.completed, true);
  assert.equal(best.stats.ergonomics, 25);
  assert.equal(best.stats.spend, 5100);
  assert.equal(best.score, 25, 'weight 1: (1 / 10) x fE, fE = 10 x 25');
  assert.equal(summary.lowerBound, 25);
});

test('an empty domain is proved with no native call: no accessible base', async () => {
  const lookup = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s', ['a'])] }), ['a', mod('a')]);
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: async () => assert.fail('no native call for an empty domain') });
  assert.equal(result.kind, 'empty');
  assert.equal(result.kind === 'empty' && result.source, 'domain');
  assert.match(result.kind === 'empty' ? result.detail : '', /no accessible base/);
  assert.equal(result.summary.telemetry.nativeSolves, 0);
});

test('a request the model text proves false is empty with no native call: an included item that is nowhere', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  const result = await solvePrecise({ params: paramsOf(lookup, { includeItems: ['ghost'] }), deadline: FAR(), solve: async () => assert.fail('no native call for a contradiction row') });
  assert.equal(result.kind, 'empty');
  assert.equal(result.kind === 'empty' && result.source, 'request');
  assert.equal(result.summary.telemetry.provedEmptyNodes, 1);
});

test('every solve of the physical models runs with presolve off, so an infeasible model is empty on that one solve', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  const { solve, calls } = counting();
  const result = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve });
  assert.equal(result.kind, 'empty');
  assert.equal(result.kind === 'empty' && result.source, 'native');
  assert.deepEqual(calls, [{ presolveOff: true }]);
  assert.equal(result.summary.telemetry.confirmedInfeasible, 1);
  assert.equal(result.summary.completed, true);
  const tedCalls = counting();
  const ted = lookupOf(gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b'], true)] }), ['a', mod('a', { weight: 1, ergo: 10 })], ['b', mod('b', { weight: 4, ergo: 40 })]);
  await solvePrecise({ params: paramsOf(ted, { useTrueErgo: true }), deadline: FAR(), solve: tedCalls.solve });
  assert.ok(tedCalls.calls.length >= 2 && tedCalls.calls.every(c => c.presolveOff), 'every spatial node too');
});

test('with presolve on, an infeasible model is empty only after the presolve-off confirmation: two solves, the second with presolve off', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  const { solve, calls } = counting();
  const result = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve, presolve: 'choose' });
  assert.equal(result.kind, 'empty');
  assert.equal(result.kind === 'empty' && result.source, 'native');
  assert.deepEqual(calls, [{ presolveOff: false }, { presolveOff: true }]);
  assert.equal(result.summary.telemetry.confirmedInfeasible, 1);
});

test('a false Infeasible from presolve is never used: the presolve-off solve finds the build and the rescue is recorded', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }, { id: 'b', weight: 2, ergo: 25 }]);
  let calls = 0;
  const solve: SolveFn = async (lp, options) => {
    calls++;
    const real = await nativeSolve(lp, options);
    return options.presolve === 'off' ? real : fakeInfeasible(real);
  };
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve, presolve: 'choose' });
  assert.deepEqual(installed(result), ['b']);
  assert.equal(build(result).certified, true);
  assert.equal(calls, 2);
  assert.equal(result.summary.telemetry.presolveRescues, 1);
});

test('an infeasibility that cannot be confirmed leaves the request incomplete, never infeasible', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  const errored: SolveFn = async (lp, options) => {
    if (options.presolve === 'off') throw new SolverError('solve', new Error('wasm trap'));
    return fakeInfeasible(await nativeSolve(lp, options));
  };
  const a = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: errored, presolve: 'choose' });
  assert.equal(a.kind, 'incomplete');
  assert.equal(a.kind === 'incomplete' && a.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  const timedOut: SolveFn = async (lp, options) => {
    const real = await nativeSolve(lp, options);
    return options.presolve === 'off' ? ({ ...real, modelStatus: { code: 13, name: 'TimeLimit' }, colValues: null } as unknown as NativeResult) : fakeInfeasible(real);
  };
  const b = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: timedOut, presolve: 'choose' });
  assert.equal(b.kind === 'incomplete' && b.reason, PUBLIC_REASONS.timeLimitReached);
});

test('a solver solution the validator rejects is cut out and the node re-solved, so the valid build beside it is found', async () => {
  // u + v weigh 3 + 2^-52 kg: feasible to HiGHS at its tolerance under max_weight 3, infeasible exactly. v alone is the exact optimum.
  const lookup = lookupOf(
    gun(WEAPON, { weight: 1, slots: [slot('s1', ['u']), slot('s2', ['v'])] }),
    ['u', mod('u', { weight: 1, ergo: 1 })],
    ['v', mod('v', { weight: 1 + 2 ** -52, ergo: 2 })],
  );
  const result = await solvePrecise({ params: paramsOf(lookup, { maxWeight: 3, recoilWeight: 0 }), deadline: FAR() });
  assert.deepEqual(installed(result), ['v']);
  assert.equal(build(result).certified, true);
  assert.ok(result.summary.telemetry.rejectedCandidates >= 1, 'the over-cap pair was returned first and cut');
});

test('TrueErgo is certified at a tolerance of 1e-9 (the pre-cutover floor of 1e-7 plus a 1e-7 margin made that impossible)', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 30 }, { id: 'C', weight: 4, ergo: 41 }, { id: 'D', weight: 6, ergo: 95 }]);
  const result = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, objectiveTolerance: 1e-9 }), deadline: FAR() });
  const { best, certified, summary } = build(result);
  assert.equal(certified, true);
  assert.equal(summary.completed, true);
  assert.equal(summary.spatial, true);
  assert.ok(summary.gap !== null && summary.gap <= 1e-9, `gap ${summary.gap}`);
  assert.equal(summary.tolerance, 1e-9);
  assert.ok(summary.nodes >= 2, 'split at the 3 kg knee');
  assert.deepEqual(installed(result), ['D'], 'D: 95 ergo at 6 kg, TED 95 - 50 = 45 beats B at 3 kg (30)');
  assert.ok(Math.abs(best.stats.ted - 45) < 1e-12);
  assert.ok(summary.upperBound - summary.lowerBound! <= 1e-9);
});

test('Prevent Overswing refines until the exactly valid build is found and certified: a relaxed optimum that overswings is split, not trusted', async () => {
  const lookup = choice([{ id: 'Relaxed', weight: 6, ergo: 45 }, { id: 'Valid', weight: 3, ergo: 30 }, { id: 'Wide', weight: 10, ergo: 0 }]);
  const result = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 100, preventOverswing: true, objectiveTolerance: 1e-9 }), deadline: FAR() });
  assert.deepEqual(installed(result), ['Valid']);
  assert.equal(build(result).certified, true);
  assert.ok(result.summary.nodes >= 3, `${result.summary.nodes} nodes: the relaxed optimum was refined`);
});

test('a node limit keeps the verified incumbent, reports the factual reason and leaves the unproved bound unknown; zero nodes is incomplete', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }, { id: 'B', weight: 3, ergo: 30 }, { id: 'C', weight: 4, ergo: 41 }]);
  const one = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxSpatialNodes: 1 }), deadline: FAR() });
  const limited = build(one);
  assert.equal(limited.certified, false);
  assert.equal(limited.reason, PUBLIC_REASONS.nodeLimitReached);
  assert.deepEqual(installed(one), ['B']);
  assert.equal(limited.summary.completed, false);
  assert.equal(limited.summary.upperBound, Infinity);
  assert.equal(limited.summary.gap, Infinity);
  const none = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 100, useTrueErgo: true, maxSpatialNodes: 0 }), deadline: FAR() });
  assert.equal(none.kind, 'incomplete');
  assert.equal(none.kind === 'incomplete' && none.reason, PUBLIC_REASONS.nodeLimitReached);
});

test('a deadline that has passed starts nothing: incomplete with the time-limit reason and no native call', async () => {
  const lookup = choice([{ id: 'A', weight: 2, ergo: 20 }]);
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: performance.now() - 1, solve: async () => assert.fail('no native call after the deadline') });
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.kind === 'incomplete' && result.reason, PUBLIC_REASONS.timeLimitReached);
});

test('a read that HiGHS adjusted proves nothing: the verified build is still returned, the bound is withheld and the result is not certified', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }, { id: 'b', weight: 2, ergo: 25 }]);
  const solve: SolveFn = async (lp, options) => ({ ...(await nativeSolve(lp, options)), readStatus: 'warning' }) as NativeResult;
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  const { certified, reason, summary } = build(result);
  assert.deepEqual(installed(result), ['b']);
  assert.equal(certified, false);
  assert.equal(reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(summary.upperBound, Infinity);
  // Nor is an infeasibility verdict taken from such a read.
  const infeasible = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 10 }), deadline: FAR(), solve });
  assert.equal(infeasible.kind, 'incomplete');
});

test('an invalid weapon is a typed error, not a result', async () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  await assert.rejects(solvePrecise({ params: { ...paramsOf(lookup), weaponId: 'a' }, deadline: FAR() }), /not a gun entry/);
});

test('the blueprint is memoized per lookup object, weapon and classifier pair, and re-prepared when the weapon entry is replaced', () => {
  const lookup = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  const first = getPhysicalBlueprint(lookup, WEAPON);
  assert.equal(getPhysicalBlueprint(lookup, WEAPON), first, 'the same lookup and weapon reuse it');
  const isAmmo = (id: string): boolean => id === 'x';
  const withClassifier = getPhysicalBlueprint(lookup, WEAPON, { isAmmo });
  assert.notEqual(withClassifier, first, 'another classifier is another blueprint');
  assert.equal(getPhysicalBlueprint(lookup, WEAPON, { isAmmo }), withClassifier);
  const copy = choice([{ id: 'a', weight: 2, ergo: 10 }]);
  assert.notEqual(getPhysicalBlueprint(copy, WEAPON), first, 'another lookup object shares nothing');
  const weapon = lookup[WEAPON];
  weapon.slots = [...weapon.slots];
  assert.notEqual(getPhysicalBlueprint(lookup, WEAPON), first, 'a replaced slot list is noticed');
});

test('a stash is honoured: owned copies supply the installed parts at no cost, and an owned part never grants a receiver', async () => {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('s1', ['a']), slot('s2', ['a'])] }),
    ['a', mod('a', { ergo: 5, offers: [trader('prapor', 1, 700)] })],
  );
  const bought = await solvePrecise({ params: paramsOf(lookup, { ergoWeight: 1 }), deadline: FAR() });
  assert.equal(build(bought).best.stats.modSpend, 1400, 'two copies, both paid');
  const owned = await solvePrecise({ params: paramsOf(lookup, { ownedItems: ['a', 'a'] }), deadline: FAR() });
  assert.equal(build(owned).best.stats.modSpend, 0);
  assert.equal(build(owned).best.stats.spend, 5000, 'only the receiver is paid');
  const noReceiver = lookupOf(gun(WEAPON, { offers: [], slots: [slot('s1', ['a'])] }), ['a', mod('a')]);
  const none = await solvePrecise({ params: paramsOf(noReceiver, { ownedItems: [WEAPON, 'a'] }), deadline: FAR(), solve: async () => assert.fail('no native call') });
  assert.equal(none.kind, 'empty');
});
