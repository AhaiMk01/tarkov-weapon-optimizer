// The second opinion of production Precise (owner decision 5a, Phase 2.10; src/solver/physical/solvePrecise.ts): every certificate-bearing node verdict is
// solved again with another random seed, a disagreement is broken by a third seed, the bound is the largest qualified bound of all the solves, the incumbent the
// best verified build, an infeasibility needs two qualified Infeasible verdicts and no verified build, and a timeout or an unqualified solve withholds the
// certificate. The settling rule is tested on its own (`settleOpinions`, pure), then end to end on the pinned build with solvers that lie on given seeds the
// way HiGHS 1.15.1 did on tests/physical/solverDefects/count_presolve_off_wrong_optimal.lp (a wrong Optimal with a matching wrong dual bound).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { preparePhysicalWeapon } from '../../src/solver/physical';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import type { Candidate } from '../../src/solver/physical/search';
import { opinionsAgree, PRECISE_RANDOM_SEEDS, settleOpinions, solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { Opinion, PreciseResult, VerifiedBuild } from '../../src/solver/physical/solvePrecise';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';

const [FIRST, SECOND, THIRD] = PRECISE_RANDOM_SEEDS;

// ---------------------------------------------------------------------------------------------
// The settling rule, pure
// ---------------------------------------------------------------------------------------------

const candidate = (score: number): Candidate<VerifiedBuild> => ({ score, payload: { stats: { weight: 1 } } as unknown as VerifiedBuild });
const optimal = (bound: number, build: number | null = bound): Opinion => ({
  verdict: 'optimal', evidence: { nativeDual: bound, qualified: true, frameError: 0 }, candidate: build === null ? null : candidate(build), finished: true,
});
const infeasible = (): Opinion => ({ verdict: 'infeasible', evidence: null, candidate: null, finished: true });
const none = (reason: string, finished = false, build: number | null = null): Opinion => ({ verdict: 'none', evidence: null, candidate: build === null ? null : candidate(build), reason, finished });
const TOL = 1e-5;

test('agreement: two Infeasible verdicts, or two Optimal bounds within the tolerance; never a solve that proved nothing', () => {
  assert.equal(opinionsAgree(infeasible(), infeasible(), TOL), true);
  assert.equal(opinionsAgree(optimal(100), optimal(100 + 0.9e-5), TOL), true);
  assert.equal(opinionsAgree(optimal(100), optimal(100 + 2e-5), TOL), false, 'bounds further apart than the tolerance');
  assert.equal(opinionsAgree(optimal(93.6), optimal(100), TOL), false, 'the defect: a wrong Optimal with a wrong bound');
  assert.equal(opinionsAgree(optimal(100), infeasible(), TOL), false);
  assert.equal(opinionsAgree(none(PUBLIC_REASONS.timeLimitReached), none(PUBLIC_REASONS.timeLimitReached), TOL), false);
  assert.equal(opinionsAgree(optimal(100), { ...optimal(100), evidence: { nativeDual: 100, qualified: false, frameError: 0 } }, TOL), false, 'an unqualified bound proves nothing');
});

test('settling: two agreeing solves settle a node, with the largest qualified bound of ALL the solves and the best verified build of all of them', () => {
  const agreed = settleOpinions([optimal(100, 99.99999), optimal(100.000001, 100)], TOL, true);
  assert.equal(agreed.settled, true);
  assert.equal(agreed.evaluation.verdict, 'solved');
  assert.equal(agreed.evaluation.evidence?.nativeDual, 100.000001, 'the larger of the two bounds');
  assert.equal(agreed.evaluation.candidate?.score, 100, 'the better verified build');
  // A disagreement broken by the third seed: the bound is the largest of the three, even the outvoted one's.
  const tie = settleOpinions([optimal(93.6), optimal(100), optimal(100)], TOL, true);
  assert.equal(tie.settled, true);
  assert.equal(tie.evaluation.evidence?.nativeDual, 100);
  assert.equal(tie.evaluation.candidate?.score, 100);
  const outvoted = settleOpinions([optimal(100), optimal(93.6), optimal(93.6)], TOL, true);
  assert.equal(outvoted.settled, true);
  assert.equal(outvoted.evaluation.evidence?.nativeDual, 100, 'two wrong solves cannot lower the bound below a qualified one');
  assert.equal(outvoted.evaluation.candidate?.score, 100, 'nor lose the better build');
});

test('settling: no two agreeing solves, a timeout, an unqualified solve or Infeasible verdicts against a verified build withhold the certificate', () => {
  const split = settleOpinions([optimal(93.6), optimal(100), optimal(97)], TOL, true);
  assert.equal(split.settled, false);
  assert.equal(split.evaluation.verdict, 'unresolved');
  assert.equal(split.evaluation.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(split.evaluation.evidence?.nativeDual, 100, 'the bound is still the largest qualified one');
  assert.equal(split.evaluation.candidate?.score, 100);
  assert.equal(split.evaluation.finished, true, 'every native search finished; only the certificate is withheld');
  const timedOut = settleOpinions([optimal(100), none(PUBLIC_REASONS.timeLimitReached)], TOL, true);
  assert.equal(timedOut.evaluation.verdict, 'unresolved');
  assert.equal(timedOut.evaluation.reason, PUBLIC_REASONS.timeLimitReached, 'the factual stop of the second solve');
  assert.equal(timedOut.evaluation.finished, false, 'the second opinion did not finish');
  assert.equal(timedOut.evaluation.candidate?.score, 100, 'the verified build is kept');
  const unqualified = settleOpinions([optimal(100), none(PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, true)], TOL, true);
  assert.equal(unqualified.evaluation.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(unqualified.evaluation.finished, true);
  const empty = settleOpinions([infeasible(), infeasible()], TOL, true);
  assert.deepEqual([empty.settled, empty.evaluation.verdict], [true, 'infeasible']);
  const twoOfThree = settleOpinions([infeasible(), optimal(5, null), infeasible()], TOL, true);
  assert.deepEqual([twoOfThree.settled, twoOfThree.evaluation.verdict], [true, 'infeasible'], 'two qualified Infeasible verdicts and no verified build');
  const contradicted = settleOpinions([infeasible(), optimal(5, 5), infeasible()], TOL, true);
  assert.deepEqual([contradicted.settled, contradicted.evaluation.verdict], [false, 'unresolved'], 'a verified build refutes the Infeasible verdicts');
  assert.equal(contradicted.evaluation.candidate?.score, 5);
  const lonely = settleOpinions([infeasible(), none(PUBLIC_REASONS.timeLimitReached)], TOL, true);
  assert.deepEqual([lonely.settled, lonely.evaluation.verdict, lonely.evaluation.reason], [false, 'unresolved', PUBLIC_REASONS.timeLimitReached], 'an infeasibility needs both verdicts');
});

// ---------------------------------------------------------------------------------------------
// End to end on the pinned build, with seeds that lie
// ---------------------------------------------------------------------------------------------

/** One required slot holding exactly one of the parts. */
const choice = (parts: { id: string; ergo: number }[]): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, ergo: 0, slots: [slot('choice', parts.map(p => p.id), true)] }),
  ...parts.map(p => [p.id, mod(p.id, { weight: 0, ergo: p.ergo })] as [string, ReturnType<typeof mod>]),
);
const paramsOf = (lookup: ItemLookup, extra: Partial<SolveParams> = {}): SolveParams => ({
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, ...extra,
});
const FAR = (): number => performance.now() + 120_000;
const countColumn = (lookup: ItemLookup, id: string): string => `n_${preparePhysicalWeapon(lookup, WEAPON).templateIndexOf(id)}`;

/** The LP text with extra rows spliced in before `Bounds`. */
const withRows = (lp: string, rows: string[]): string => {
  const at = lp.indexOf('\nBounds\n');
  return `${lp.slice(0, at)}\n${rows.map(r => `  ${r}`).join('\n')}${lp.slice(at)}`;
};

/**
 * The pinned solve, except on the listed seeds: there it answers as if the model had the extra rows (forbidding parts), with the point, the objective and
 * the dual bound of that smaller model, while the readback, the options and the status are those of the honest solve of the text. A wrong Optimal with a
 * matching wrong bound, exactly the defect mode, and the solve stays QUALIFIED (the parsed model is the emitted one).
 */
function lyingOn(lies: Record<number, string[]>): SolveFn & { seeds: number[] } {
  const seeds: number[] = [];
  const solve = async (lp: string, options: Parameters<SolveFn>[1], extras?: Parameters<SolveFn>[2]): Promise<NativeResult> => {
    const seed = Number(options.random_seed ?? 0);
    seeds.push(seed);
    const real = await nativeSolve(lp, options, extras);
    const rows = lies[seed];
    if (rows === undefined) return real;
    const wrong = await nativeSolve(withRows(lp, rows), options);
    assert.deepEqual(wrong.colNames, real.colNames, 'the extra rows add no column');
    return { ...real, colValues: wrong.colValues, objectiveValue: wrong.objectiveValue, mipDualBound: wrong.mipDualBound };
  };
  return Object.assign(solve, { seeds });
}

const built = (r: PreciseResult) => {
  assert.equal(r.kind, 'build');
  return r as Extract<PreciseResult, { kind: 'build' }>;
};
const installed = (r: PreciseResult): string[] => built(r).best.build.placements.map(p => p.itemId).sort();

test('a wrong Optimal on the first seed (the defect mode): the second seed disagrees, the third breaks the tie, and the certified optimum is the true one', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const solve = lyingOn({ [FIRST]: [`lie_b: ${countColumn(lookup, 'b')} = 0`] });
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.deepEqual(solve.seeds, [FIRST, SECOND, THIRD]);
  assert.deepEqual(installed(result), ['b']);
  const { certified, summary } = built(result);
  assert.equal(certified, true);
  assert.equal(summary.telemetry.secondOpinions, 1);
  assert.equal(summary.telemetry.disagreements, 1);
  assert.equal(summary.telemetry.thirdOpinions, 1);
  assert.equal(summary.telemetry.unsettledDisagreements, 0);
  assert.equal(summary.telemetry.unqualifiedSolves, 0, 'the lie is qualified: only a second solve can catch it');
  assert.ok(summary.bounds.upper !== null && summary.bounds.upper >= 25, 'the bound is the largest qualified one, never the wrong 10');
});

test('the same lie on the third seed only: the first two agree, no third solve is spent', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const solve = lyingOn({ [THIRD]: [`lie_b: ${countColumn(lookup, 'b')} = 0`] });
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.deepEqual(solve.seeds, [FIRST, SECOND]);
  assert.equal(built(result).certified, true);
  assert.equal(built(result).summary.telemetry.thirdOpinions, 0);
});

test('three solves that all disagree: no certificate (two agreeing solves are needed), the best verified build and the largest bound are kept', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }, { id: 'c', ergo: 17 }]);
  const b = countColumn(lookup, 'b');
  const c = countColumn(lookup, 'c');
  const solve = lyingOn({ [FIRST]: [`lie_b: ${b} = 0`, `lie_c: ${c} = 0`], [THIRD]: [`lie_b: ${b} = 0`] });
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.deepEqual(installed(result), ['b']);
  const { certified, outcome, summary } = built(result);
  assert.equal(certified, false);
  assert.equal(outcome.status, 'feasible');
  assert.equal(outcome.physical_certificate, 'feasible');
  assert.equal(outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(outcome.termination, 'optimal', 'every native search finished; only the certificate is withheld');
  assert.equal(summary.telemetry.unsettledDisagreements, 1);
  assert.ok(summary.bounds.upper !== null && summary.bounds.upper >= 25);
});

test('a second opinion that times out or is not qualified withholds the certificate; the verified build stays, with the factual reason', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const timing: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    return options.random_seed === SECOND ? ({ ...real, modelStatus: { code: 13, name: 'TimeLimit' }, colValues: null } as unknown as NativeResult) : real;
  };
  const timed = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: timing });
  assert.deepEqual(installed(timed), ['b']);
  assert.equal(built(timed).certified, false);
  assert.equal(built(timed).outcome.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(built(timed).outcome.termination, 'limit');
  assert.equal(built(timed).summary.telemetry.thirdOpinions, 0, 'a solve that proved nothing is no disagreement');
  const tampering: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    if (options.random_seed !== SECOND || real.readback === null) return real;
    const colCost = Float64Array.from(real.readback.colCost);
    colCost[0] += 1;
    return { ...real, readback: { ...real.readback, colCost } } as NativeResult;
  };
  const unqualified = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve: tampering });
  assert.deepEqual(installed(unqualified), ['b']);
  assert.equal(built(unqualified).certified, false);
  assert.equal(built(unqualified).outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(built(unqualified).outcome.termination, 'optimal');
});

test('an infeasibility needs both verdicts: a timed-out second opinion leaves the request incomplete; a qualified Optimal with no valid build is outvoted by a third Infeasible', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }]);
  const params = paramsOf(lookup, { maxPrice: 10 }); // every spend is above 10: infeasible
  const timing: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    return options.random_seed === SECOND ? ({ ...real, modelStatus: { code: 13, name: 'TimeLimit' }, colValues: null } as unknown as NativeResult) : real;
  };
  const open = await solvePrecise({ params, deadline: FAR(), solve: timing });
  assert.equal(open.kind, 'incomplete');
  assert.equal(open.outcome.reason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(open.summary.telemetry.confirmedInfeasible, 0);
  // The second seed claims Optimal with the point of the model WITHOUT the price cap (installing `a`, which the cap forbids): qualified, but no verified build.
  const claiming: SolveFn = async (lp, options, extras) => {
    const real = await nativeSolve(lp, options, extras);
    if (options.random_seed !== SECOND) return real;
    const uncapped = await nativeSolve(lp.replace(/\n {2}lim_price:[^\n]*/, ''), options);
    return { ...real, modelStatus: uncapped.modelStatus, colNames: uncapped.colNames, colValues: uncapped.colValues, objectiveValue: uncapped.objectiveValue, mipDualBound: uncapped.mipDualBound } as NativeResult;
  };
  const empty = await solvePrecise({ params, deadline: FAR(), solve: claiming });
  assert.equal(empty.kind, 'empty');
  assert.equal(empty.outcome.status, 'infeasible');
  assert.equal(empty.outcome.physical_certificate, 'certified_infeasible');
  assert.equal(empty.summary.telemetry.disagreements, 1);
  assert.equal(empty.summary.telemetry.thirdOpinions, 1);
  assert.equal(empty.summary.telemetry.confirmedInfeasible, 1);
});

// ---------------------------------------------------------------------------------------------
// Inconclusive solves (owner, 2026-10-12: retry seeds, never throw)
// ---------------------------------------------------------------------------------------------

/** The pinned solve, except that the listed seeds reach no verdict: HiGHS's `SolveError` with no primal (the defect of countGates.nativeDefects). */
function inconclusiveOn(seeds: readonly (number | undefined)[]): SolveFn & { seeds: (number | undefined)[] } {
  const asked: (number | undefined)[] = [];
  const solve = async (lp: string, options: Parameters<SolveFn>[1], extras?: Parameters<SolveFn>[2]): Promise<NativeResult> => {
    const seed = options.random_seed === undefined ? undefined : Number(options.random_seed);
    asked.push(seed);
    const real = await nativeSolve(lp, options, extras);
    if (!seeds.includes(seed)) return real;
    return { ...real, modelStatus: { code: 4, name: 'SolveError' }, colValues: null, objectiveValue: null, mipDualBound: null } as unknown as NativeResult;
  };
  return Object.assign(solve, { seeds: asked });
}

test('a SolveError on the first two seeds is no opinion: the node moves on to the next seeds, two agreeing qualified verdicts still certify', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const solve = inconclusiveOn([PRECISE_RANDOM_SEEDS[0], PRECISE_RANDOM_SEEDS[1]]);
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.deepEqual(solve.seeds, PRECISE_RANDOM_SEEDS.slice(0, 4), 'seeds 0 and 11 inconclusive, 29 the first opinion, 47 the second');
  assert.deepEqual(installed(result), ['b']);
  const { certified, summary } = built(result);
  assert.equal(certified, true);
  assert.equal(summary.telemetry.inconclusiveSolves, 2);
  assert.equal(summary.telemetry.extraSeedSolves, 3, 'the solves of seeds 11, 29 and 47 followed an inconclusive solve of the same text');
  assert.equal(summary.telemetry.disagreements, 0);
});

test('every seed inconclusive: the request never throws; it is unresolved with the proof-prerequisite reason and nothing is certified', async () => {
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const solve = inconclusiveOn([...PRECISE_RANDOM_SEEDS]);
  const result = await solvePrecise({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.equal(result.kind, 'incomplete');
  assert.equal(result.outcome.status, 'incomplete');
  assert.equal(result.outcome.reason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(result.summary.telemetry.inconclusiveSolves, solve.seeds.length, 'every solve was inconclusive');
  assert.ok(solve.seeds.length <= 2 * PRECISE_RANDOM_SEEDS.length, 'a bounded number of tries: the relaxed text and the integer text, each over the seed list');
  // An infeasible request whose solves are all inconclusive is not proved empty either.
  const capped = await solvePrecise({ params: paramsOf(lookup, { maxPrice: 1 }), deadline: FAR(), solve: inconclusiveOn([...PRECISE_RANDOM_SEEDS]) });
  assert.notEqual(capped.kind, 'empty');
  assert.notEqual(capped.outcome.physical_certificate, 'certified_infeasible');
});

test('Fast: a SolveError on the default seed is retried with the next seed instead of failing the request', async () => {
  const { solveFast } = await import('../../src/solver/physical/solveFast');
  const lookup = choice([{ id: 'a', ergo: 10 }, { id: 'b', ergo: 25 }]);
  const solve = inconclusiveOn([undefined]);
  const result = await solveFast({ params: paramsOf(lookup), deadline: FAR(), solve });
  assert.equal(result.kind, 'build');
  assert.deepEqual((result as Extract<typeof result, { kind: 'build' }>).best.build.placements.map(p => p.itemId), ['b']);
  assert.ok(result.summary.inconclusiveSolves >= 1);
  assert.ok(solve.seeds.includes(PRECISE_RANDOM_SEEDS[1]), 'the retry used the next seed of the list');
  const never = await solveFast({ params: paramsOf(lookup), deadline: FAR(), solve: inconclusiveOn([undefined, ...PRECISE_RANDOM_SEEDS]) });
  assert.equal(never.kind, 'incomplete', 'every seed inconclusive: no build, no throw');
});
