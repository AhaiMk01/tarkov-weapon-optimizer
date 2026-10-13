// The spatial search over total weight (src/solver/physical/search.ts), without HiGHS: a fake node evaluator over an enumerable set of
// "builds" (a value and a weight), whose node relaxation is exactly what specializeLP writes (the secant lower envelope of the weight
// penalty on the node), so the search logic, the bound composition and the limits are checked against a brute-force optimum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  combineUpperBounds, nodeUpperBound, ratRoundDown, ratRoundUp, runSpatialSearch, secantOfPenalty, splitInterval, transportedBounds, weightPenalty,
  type BoundEvidence, type NodeEvaluation, type SearchInterval, type SearchNode,
} from '../../src/solver/physical';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { gapUpward, nextUp } from '../../src/solver/physical/numeric';
import { rat, ratAdd, ratToNumber, type Rat } from '../../src/solver/physical/exact';

interface FakeBuild { name: string; value: number; weight: number }

/** A qualified native bound with no frame error: the evidence the fake relaxation proves. */
const proved = (nativeDual: number): BoundEvidence => ({ nativeDual, qualified: true, frameError: 0 });

const exactScore = (b: FakeBuild): number => b.value - weightPenalty(b.weight);

/** What a node model returns: the best build of the node under the penalty line of the node (an upper bound of the exact score). */
function relaxedNode(builds: FakeBuild[], node: SearchNode): NodeEvaluation<FakeBuild> {
  const interval = node.interval!;
  const inside = builds.filter(b => b.weight >= interval.lo && b.weight <= interval.hi);
  if (inside.length === 0) return { verdict: 'infeasible', evidence: null, candidate: null, exact: true };
  const penalty = secantOfPenalty(interval.lo, interval.hi);
  const relaxed = (b: FakeBuild): number => b.value - (penalty.line.slope * b.weight + penalty.line.intercept);
  const best = inside.reduce((a, b) => (relaxed(b) > relaxed(a) ? b : a));
  return {
    verdict: 'solved',
    evidence: proved(relaxed(best)),
    candidate: { score: exactScore(best), payload: best },
    exact: penalty.exact,
    splitAt: best.weight,
  };
}

const clock = () => {
  let t = 0;
  return { now: () => t, tick: (dt: number) => { t += dt; } };
};

const BUILDS: FakeBuild[] = [
  { name: 'a', value: 30, weight: 2 },
  { name: 'b', value: 80, weight: 4 }, // exact 80 - 25 = 55
  { name: 'c', value: 95, weight: 5 }, // exact 95 - 40 = 55 (tied with b)
  { name: 'd', value: 140, weight: 8 }, // exact 140 - 62.5 = 77.5, the maximum
  { name: 'e', value: 150, weight: 12 }, // exact 150 - 75 = 75
];
const OPTIMUM = Math.max(...BUILDS.map(exactScore));

const roots = [{ lo: 2, hi: 3 }, { lo: 3, hi: 12 }];

test('the single bound seams: a qualified native bound plus the frame error (exact), the tighter of parent and proof; the global bound is the largest of incumbent, live and fathomed', () => {
  assert.equal(nodeUpperBound(10, proved(7)), 7, 'an exactly representable bound is not widened: the sum is exact');
  assert.equal(nodeUpperBound(7, proved(10)), 7, 'the parent bound is tighter');
  assert.equal(nodeUpperBound(10, { nativeDual: 7, qualified: true, frameError: 0.5 }), 7.5);
  assert.equal(nodeUpperBound(10, { nativeDual: 1, qualified: true, frameError: 2 ** -60 }), nextUp(1), 'a sum that is not a double is reported by the smallest double above it');
  assert.equal(nodeUpperBound(7, null), 7, 'nothing proved: the parent bound stands');
  assert.equal(nodeUpperBound(Infinity, null), Infinity);
  assert.equal(nodeUpperBound(Infinity, { nativeDual: 3, qualified: false, frameError: 0 }), Infinity, 'an unqualified native bound proves nothing');
  assert.equal(nodeUpperBound(Infinity, { nativeDual: null, qualified: true, frameError: 0 }), Infinity, 'a qualified solve that reported no bound proves nothing');
  assert.equal(nodeUpperBound(Infinity, { nativeDual: Infinity, qualified: true, frameError: 0 }), Infinity, 'an infinite native bound is no bound');
  assert.equal(combineUpperBounds({ incumbent: 5, live: [], fathomed: -Infinity }), 5);
  assert.equal(combineUpperBounds({ incumbent: 5, live: [9, 6], fathomed: 7 }), 9);
  assert.equal(combineUpperBounds({ incumbent: 5, live: [], fathomed: 7 }), 7, 'a fathomed node still counts');
  assert.equal(combineUpperBounds({ incumbent: -Infinity, live: [], fathomed: -Infinity }), -Infinity);
  assert.equal(combineUpperBounds({ incumbent: 5, live: [Infinity], fathomed: 1 }), Infinity, 'an unproved live node is an unknown bound');
});

test('splitInterval splits at the relaxed optimum, clamped to the middle 80 percent, else at the midpoint, and refuses a point', () => {
  assert.deepEqual(splitInterval({ lo: 0, hi: 10 }), [{ lo: 0, hi: 5 }, { lo: 5, hi: 10 }]);
  assert.deepEqual(splitInterval({ lo: 0, hi: 10 }, 4), [{ lo: 0, hi: 4 }, { lo: 4, hi: 10 }]);
  assert.deepEqual(splitInterval({ lo: 0, hi: 10 }, 0.01), [{ lo: 0, hi: 1 }, { lo: 1, hi: 10 }], 'near an end it is pulled in so both children shrink');
  assert.deepEqual(splitInterval({ lo: 0, hi: 10 }, 99), [{ lo: 0, hi: 9 }, { lo: 9, hi: 10 }]);
  assert.deepEqual(splitInterval({ lo: 0, hi: 10 }, Number.NaN), [{ lo: 0, hi: 5 }, { lo: 5, hi: 10 }]);
  assert.equal(splitInterval({ lo: 4, hi: 4 }), null);
  assert.equal(splitInterval({ lo: 4, hi: 4 + 1e-12 }), null, 'narrower than the numeric floor');
});

test('the search finds the exact optimum of an enumerable instance and certifies it within the tolerance', async () => {
  const c = clock();
  const result = await runSpatialSearch({ roots, evaluate: async node => relaxedNode(BUILDS, node), tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9 });
  assert.equal(result.incumbent?.payload.name, 'd');
  assert.equal(result.incumbent?.score, OPTIMUM);
  assert.equal(result.completed, true);
  assert.equal(result.certified, true);
  assert.ok(result.gap !== null && result.gap <= 1e-9, `gap ${result.gap}`);
  assert.ok(result.upperBound >= OPTIMUM && result.upperBound - OPTIMUM <= 1e-9);
  assert.equal(result.stopReason, null);
  assert.ok(result.nodes >= 2 && result.nodes < 60, `${result.nodes} nodes`);
});

test('a node closed by exactness or by tolerance still contributes its bound: a coarse tolerance reports the slack, not zero', async () => {
  const c = clock();
  const loose = await runSpatialSearch({ roots, evaluate: async node => relaxedNode(BUILDS, node), tolerance: 1e6, maxNodes: 512, now: c.now, deadline: 1e9 });
  assert.equal(loose.completed, true);
  assert.ok(loose.incumbent !== null);
  // Everything is within the tolerance after the first nodes, so the answer is whatever was found first, and the bound says how far it may be.
  assert.ok(loose.upperBound >= OPTIMUM, 'the bound never drops below the true optimum');
  assert.equal(loose.gap, gapUpward(loose.upperBound, loose.lowerBound!));
  assert.equal(loose.nodes, 2, 'two roots, nothing split');
  // The same search at a fine tolerance explores more and tightens the gap.
  const fine = await runSpatialSearch({ roots, evaluate: async node => relaxedNode(BUILDS, node), tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9 });
  assert.ok(fine.nodes > loose.nodes);
  assert.ok(fine.gap! < loose.gap! || loose.gap === 0);
});

test('best-first by bound, lighter first on a tie: the first node evaluated is the light root, then the highest bound', async () => {
  const c = clock();
  const seen: [number, number][] = [];
  await runSpatialSearch({
    roots,
    evaluate: async node => { seen.push([node.interval!.lo, node.interval!.hi]); return relaxedNode(BUILDS, node); },
    tolerance: 1e-9, maxNodes: 4, now: c.now, deadline: 1e9,
  });
  assert.deepEqual(seen[0], [2, 3], 'both roots have bound Infinity: the lighter one first');
  assert.deepEqual(seen[1], [3, 12]);
});

test('a node limit stops the search with a factual reason, keeps the incumbent, and leaves an unproved bound unknown', async () => {
  const c = clock();
  const result = await runSpatialSearch({ roots, evaluate: async node => relaxedNode(BUILDS, node), tolerance: 1e-9, maxNodes: 1, now: c.now, deadline: 1e9 });
  assert.equal(result.nodes, 1);
  assert.equal(result.stopReason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(result.completed, false);
  assert.equal(result.certified, false);
  assert.equal(result.incumbent?.payload.name, 'a', 'the light root holds only a');
  assert.equal(result.upperBound, Infinity, 'the heavy root was never evaluated: no bound is known');
  assert.equal(result.gap, Infinity);
  const none = await runSpatialSearch({ roots, evaluate: async node => relaxedNode(BUILDS, node), tolerance: 1e-9, maxNodes: 0, now: c.now, deadline: 1e9 });
  assert.equal(none.nodes, 0);
  assert.equal(none.incumbent, null);
  assert.equal(none.stopReason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(none.empty, false, 'a node limit is not evidence of emptiness');
});

test('a passed deadline stops the search before any evaluation, and one that passes during a node ends it with the incumbent', async () => {
  const c = clock();
  const late = await runSpatialSearch({ roots, evaluate: async () => assert.fail('no node may start after the deadline'), tolerance: 1e-9, maxNodes: 512, now: () => 100, deadline: 100 });
  assert.equal(late.stopReason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(late.nodes, 0);
  assert.equal(late.empty, false);
  const during = await runSpatialSearch({
    roots,
    evaluate: async node => { c.tick(60); return relaxedNode(BUILDS, node); },
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 100,
  });
  assert.equal(during.stopReason, PUBLIC_REASONS.timeLimitReached);
  assert.equal(during.nodes, 2);
  assert.ok(during.incumbent !== null);
  assert.equal(during.completed, false);
});

test('an unresolved or failed node stops the search with its reason; an earlier incumbent is kept and the node stays live', async () => {
  const c = clock();
  let calls = 0;
  const unresolved = await runSpatialSearch({
    roots,
    evaluate: async node => {
      calls++;
      if (calls === 1) return relaxedNode(BUILDS, node);
      return { verdict: 'unresolved', evidence: proved(90), candidate: null, exact: false, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable };
    },
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.equal(unresolved.stopReason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  assert.equal(unresolved.incumbent?.payload.name, 'a');
  assert.equal(unresolved.upperBound, 90, 'the unresolved node keeps the bound it proved');
  const failed = await runSpatialSearch({
    roots: [{ lo: 2, hi: 12 }],
    evaluate: async () => ({ verdict: 'failed', evidence: null, candidate: null, exact: false }),
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.equal(failed.stopReason, PUBLIC_REASONS.independentBuildValidationFailed, 'a failed node defaults to the validation reason');
  assert.equal(failed.incumbent, null);
});

test('every node proved empty completes the search with no incumbent: that, and only that, is emptiness', async () => {
  const c = clock();
  const result = await runSpatialSearch({
    roots, evaluate: async () => ({ verdict: 'infeasible', evidence: null, candidate: null, exact: true }),
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.equal(result.empty, true);
  assert.equal(result.completed, true);
  assert.equal(result.upperBound, -Infinity);
  assert.equal(result.gap, null);
  assert.equal(result.certified, false);
});

test('a node that cannot be split while its bound still exceeds the incumbent stops the search with the resolution reason', async () => {
  const c = clock();
  const result = await runSpatialSearch({
    roots: [{ lo: 5, hi: 5 + 1e-12 }],
    evaluate: async () => ({ verdict: 'solved', evidence: proved(100), candidate: { score: 1, payload: 'x' }, exact: false }),
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.match(result.stopReason ?? '', /Numerical interval resolution/);
  assert.equal(result.upperBound, 100);
  assert.equal(result.certified, false);
});

test('a request with no spatial dimension is one null root solved once', async () => {
  const c = clock();
  const result = await runSpatialSearch({
    roots: [null],
    evaluate: async node => { assert.equal(node.interval, null); return { verdict: 'solved', evidence: proved(12.5), candidate: { score: 12.5, payload: 'built' }, exact: true }; },
    tolerance: 1e-9, maxNodes: 0, now: c.now, deadline: 1e9,
  });
  assert.equal(result.nodes, 0, 'maxNodes 0 stops even the single root: callers pass Infinity for a request with no spatial dimension');
  const run = await runSpatialSearch({
    roots: [null],
    evaluate: async () => ({ verdict: 'solved', evidence: proved(12.5), candidate: { score: 12.5, payload: 'built' }, exact: true }),
    tolerance: 1e-9, maxNodes: Infinity, now: c.now, deadline: 1e9,
  });
  assert.equal(run.certified, true);
  assert.equal(run.nodes, 1);
  assert.equal(run.gap, 0, 'a native bound equal to the exact score leaves no gap');
});

// ---------------------------------------------------------------------------------------------
// The proof frame (Phase 2.5): exact bounds, the correction is used, unknown stays unknown
// ---------------------------------------------------------------------------------------------

const solvedOnce = (evidence: BoundEvidence | null, candidate: { score: number; scoreExact?: Rat } | null) => async (): Promise<NodeEvaluation<string>> =>
  ({ verdict: 'solved', evidence, candidate: candidate === null ? null : { ...candidate, payload: 'built' }, exact: true });

test('the frame error is added to the native bound: a bound 3e-9 below the optimum with a 5e-9 frame error is NOT enough to certify at 1e-9, where the bare bound would be', async () => {
  const c = clock();
  const optimum = 100;
  const run = (evidence: BoundEvidence) => runSpatialSearch({ roots: [null], evaluate: solvedOnce(evidence, { score: optimum }), tolerance: 1e-9, maxNodes: Infinity, now: c.now, deadline: 1e9 });
  const naive = await run({ nativeDual: optimum - 3e-9, qualified: true, frameError: 0 });
  assert.equal(naive.certified, true, 'a bare bound below the incumbent says the incumbent is optimal');
  const corrected = await run({ nativeDual: optimum - 3e-9, qualified: true, frameError: 5e-9 });
  assert.ok(corrected.upperBound > optimum, 'the corrected bound is above the optimum: the construction error could hide that much');
  assert.ok(corrected.gap !== null && corrected.gap > 1e-9 && corrected.gap < 3e-9, `gap ${corrected.gap}`);
  assert.equal(corrected.certified, false);
  assert.equal(corrected.completed, true, 'the search finished; it simply cannot justify the tolerance');
});

test('the certificate is decided on the EXACT gap: at an objective of 9e6, where one ulp is 1.9e-9, a 5e-15 frame error still certifies a 1e-9 tolerance', async () => {
  const c = clock();
  const score = -9_000_000;
  assert.ok(nextUp(score) - score > 1e-9, 'a double-rounded bound could never be within 1e-9 of this score');
  const result = await runSpatialSearch({
    roots: [null], evaluate: solvedOnce({ nativeDual: score, qualified: true, frameError: 5e-15 }, { score }),
    tolerance: 1e-9, maxNodes: Infinity, now: c.now, deadline: 1e9,
  });
  assert.equal(result.certified, true);
  assert.ok(result.gap !== null && result.gap < 1e-14, `the exact gap is 5e-15, reported as ${result.gap}`);
  assert.ok(result.upperBound >= score, 'the reported double upper bound is still an enclosure');
});

test('an unqualified solve proves nothing: the bound is unknown (Infinity here, null on the wire), the search cannot certify, and no finite sibling hides it', async () => {
  const c = clock();
  const unqualified = await runSpatialSearch({
    roots: [{ lo: 2, hi: 3 }, { lo: 3, hi: 12 }],
    evaluate: async node => (node.interval!.lo === 2
      ? { verdict: 'solved', evidence: proved(10), candidate: { score: 10, payload: 'a' }, exact: true }
      : { verdict: 'solved', evidence: { nativeDual: 11, qualified: false, frameError: 0 }, candidate: { score: 10, payload: 'b' }, exact: true }),
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.equal(unqualified.completed, true);
  assert.equal(unqualified.upperBound, Infinity);
  assert.equal(unqualified.gap, Infinity);
  assert.equal(unqualified.certified, false);
  assert.deepEqual(transportedBounds(unqualified), { lower: 10, upper: null, gap: null });
  // with every node qualified the same search is certified and its bounds are all finite
  const qualified = await runSpatialSearch({
    roots: [{ lo: 2, hi: 3 }, { lo: 3, hi: 12 }],
    evaluate: async () => ({ verdict: 'solved', evidence: proved(10), candidate: { score: 10, payload: 'a' }, exact: true }),
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.equal(qualified.certified, true);
  assert.deepEqual(transportedBounds(qualified), { lower: 10, upper: 10, gap: 0 });
});

test('the incumbent contributes its exact score both ways: the lower bound rounds down, the upper bound up, and the gap is exact', async () => {
  const c = clock();
  const third = rat(1n, 3n);
  const lower = ratRoundDown(third);
  const upper = ratRoundUp(third);
  const result = await runSpatialSearch({
    roots: [null],
    evaluate: async () => ({ verdict: 'solved', evidence: proved(lower), candidate: { score: lower, scoreLower: lower, scoreUpper: upper, scoreExact: third, payload: 'x' }, exact: true }),
    tolerance: 1e-9, maxNodes: Infinity, now: c.now, deadline: 1e9,
  });
  assert.equal(result.lowerBound, lower);
  assert.equal(result.upperBound, upper, 'the node bound is a double just below 1/3: the exact score of the incumbent is the larger contribution');
  assert.equal(result.gap, 0, 'the exact gap UB - score is zero');
  assert.deepEqual(result.upperBoundExact, third);
});

test('a better incumbent is chosen on the EXACT score, even when two doubles cannot tell the scores apart', async () => {
  const c = clock();
  const a = rat(1n, 3n);
  const b = ratAdd(a, rat(1n, 1n << 80n)); // above 1/3 by 2^-80, far below one ulp
  let call = 0;
  const result = await runSpatialSearch({
    roots: [{ lo: 2, hi: 3 }, { lo: 3, hi: 12 }],
    evaluate: async () => {
      call++;
      const exact = call === 1 ? a : b;
      return { verdict: 'solved', evidence: null, candidate: { score: ratToNumber(exact), scoreExact: exact, payload: call === 1 ? 'first' : 'second' }, exact: true };
    },
    tolerance: 1e-9, maxNodes: Infinity, now: c.now, deadline: 1e9,
  });
  assert.equal(result.incumbent?.payload, 'second');
});

// ---------------------------------------------------------------------------------------------------------------------------
// Search completion (termination) is not proof completion
// ---------------------------------------------------------------------------------------------------------------------------

test('"finished" is search completion only: a finished last node whose proof or candidate was withheld finishes the search without completing it', async () => {
  const c = clock();
  const run = (roots: (SearchInterval | null)[], evaluate: (node: SearchNode) => Promise<NodeEvaluation<string>>, extra: { maxNodes?: number; deadline?: number } = {}) =>
    runSpatialSearch<string>({ roots, evaluate, tolerance: 1e-9, maxNodes: extra.maxNodes ?? Infinity, now: c.now, deadline: extra.deadline ?? 1e9 });
  const withheld = (finished: boolean | undefined, verdict: 'unresolved' | 'failed' = 'unresolved'): NodeEvaluation<string> => ({
    verdict, evidence: null, candidate: { score: 1, payload: 'x' }, exact: true, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, ...(finished === undefined ? {} : { finished }),
  });
  // one exact root, its native search finished, only the proof withheld: finished, not completed, never emptiness
  const single = await run([null], async () => withheld(true));
  assert.equal(single.finished, true);
  assert.equal(single.completed, false);
  assert.equal(single.empty, false);
  assert.equal(single.certified, false);
  assert.equal(single.stopReason, PUBLIC_REASONS.requiredProofPrerequisiteUnavailable);
  // the same through a failed verdict (a candidate the validator kept rejecting)
  assert.equal((await run([null], async () => withheld(true, 'failed'))).finished, true);
  // a node that was not finished (a limit stop, or one that still needs refining) leaves the search unfinished
  assert.equal((await run([null], async () => withheld(false))).finished, false);
  assert.equal((await run([null], async () => withheld(undefined))).finished, false);
  // another live node was never evaluated: the executed search is unfinished even though this node's solve finished
  const two = await run([{ lo: 2, hi: 3 }, { lo: 3, hi: 12 }], async () => withheld(true));
  assert.equal(two.finished, false);
  assert.equal(two.nodes, 1);
  // an unresolved infeasibility verdict (finished, no proof) with nothing else live finishes the search with no emptiness
  const unconfirmed = await run([null], async () => ({ verdict: 'unresolved', evidence: null, candidate: null, exact: true, reason: PUBLIC_REASONS.requiredProofPrerequisiteUnavailable, finished: true }));
  assert.equal(unconfirmed.finished, true);
  assert.equal(unconfirmed.empty, false);
  // the clock, the node cap and an unsplittable interval are never finished
  const late = await run([null], async () => withheld(true), { deadline: -1 });
  assert.equal(late.finished, false);
  assert.equal(late.nodes, 0);
  assert.equal((await run([null], async () => withheld(true), { maxNodes: 0 })).finished, false);
  const narrow = await run([{ lo: 5, hi: 5 + 1e-12 }], async () => ({ verdict: 'solved', evidence: proved(100), candidate: { score: 1, payload: 'x' }, exact: false }));
  assert.match(narrow.stopReason ?? '', /Numerical interval resolution/);
  assert.equal(narrow.finished, false);
  // a search that settles every node by proof is completed and finished
  const done = await run([null], async () => ({ verdict: 'solved', evidence: proved(12.5), candidate: { score: 12.5, payload: 'built' }, exact: true }));
  assert.equal(done.completed, true);
  assert.equal(done.finished, true);
});

// Owner decision F1 (2026-10-12): a `split` evaluation only splits its node. It discards nothing and contributes no bound: a bogus evidence that would
// fathom everything is ignored, the children inherit the node's own bound, and an interrupted search after a split publishes no bound from it.
test('a split verdict splits without pruning and without a bound: its evidence is ignored, the children inherit the node\'s own bound', async () => {
  const c = clock();
  const seen: (Rat | null)[] = [];
  let splits = 0;
  const evaluate = async (node: SearchNode): Promise<NodeEvaluation<FakeBuild>> => {
    seen.push(node.incumbentExact);
    if (node.interval !== null && node.interval.lo === 3 && node.interval.hi === 12) {
      splits++;
      // A bound below every build: if it were read, the search would fathom the heavy region and miss the optimum `d`.
      return { verdict: 'split', evidence: proved(-1000), candidate: null, exact: false, splitAt: 6 };
    }
    return relaxedNode(BUILDS, node);
  };
  const result = await runSpatialSearch({ roots, evaluate, tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9 });
  assert.equal(splits, 1);
  assert.equal(result.incumbent?.payload.name, 'd', 'nothing was pruned: the optimum is found');
  assert.equal(result.certified, true);
  assert.ok(result.upperBound >= OPTIMUM, 'the ignored evidence never entered the bound');
  assert.ok(seen.some(s => s !== null), 'the evaluator sees the incumbent once there is one');
  // Stopped right after the split: the two children are live with the node's own (root: unknown) bound, so no bound is published.
  const stopped = await runSpatialSearch({ roots: [{ lo: 3, hi: 12 }], evaluate, tolerance: 1e-9, maxNodes: 1, now: c.now, deadline: 1e9 });
  assert.equal(stopped.stopReason, PUBLIC_REASONS.nodeLimitReached);
  assert.equal(stopped.upperBound, Infinity);
  assert.equal(transportedBounds(stopped).upper, null);
  // A split of an interval too narrow to split stops with the resolution reason; the node stays live with its own bound.
  const narrow = await runSpatialSearch({
    roots: [{ lo: 5, hi: 5 + 1e-12 }],
    evaluate: async () => ({ verdict: 'split', evidence: proved(-1000), candidate: null, exact: false, splitAt: 5 }),
    tolerance: 1e-9, maxNodes: 512, now: c.now, deadline: 1e9,
  });
  assert.match(narrow.stopReason ?? '', /Numerical interval resolution/);
  assert.equal(narrow.upperBound, Infinity, 'the split evidence is no bound');
  assert.equal(narrow.empty, false);
});
