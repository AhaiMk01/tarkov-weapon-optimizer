// Decision F1 extended (owner, 2026-10-13): a first opinion WITH a verified build is split without a second opinion too, when its proved bound is more
// than the tolerance above the incumbent and every build the evaluation brings (src/solver/physical/solvePrecise.ts `leadsOnlyToSplit`, mode 'witness').
// The build is a witness (it updates the incumbent before the split); the single-solve bound is not used (G1). Tested here: the predicate (clearly above,
// within the tolerance, fathoming, the order of the incumbent update, unsplittable intervals), the search's handling of a split that carries a build,
// a defect-style solver whose too-low first bound must still get the full second opinion, and end-to-end equality of the 'witness' and 'f1' rules on
// seeded TrueErgo / Prevent Overswing worlds and on pinned guns (same certificate, same score).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NativeResult } from '../../src/solver/native';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { buildItemLookup } from '../../src/solver/dataService';
import type { ItemLookup, SolveParams } from '../../src/solver/types';
import { preparePhysicalWeapon } from '../../src/solver/physical';
import { ratFromDouble } from '../../src/solver/physical/exact';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import { runSpatialSearch } from '../../src/solver/physical/search';
import type { Candidate, NodeEvaluation, SearchNode } from '../../src/solver/physical/search';
import { leadsOnlyToSplit, PRECISE_RANDOM_SEEDS, PRECISE_SPLIT_SHORTCUT, solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { Opinion, PreciseResult, VerifiedBuild } from '../../src/solver/physical/solvePrecise';
import { gun, lookupOf, mod, slot, WEAPON } from './lpFixtures';
import { randomTedWorld } from './randomWorlds';

const TOL = 1e-5;
const build = (score: number, weight = 4.2): Candidate<VerifiedBuild> => ({ score, payload: { stats: { weight } } as unknown as VerifiedBuild });
const node = (incumbent: number | null, interval: { lo: number; hi: number } | null = { lo: 3, hi: 6 }) => ({
  interval, incumbentExact: incumbent === null ? null : ratFromDouble(incumbent),
});
const optimal = (bound: number, own: number | null, extra: Partial<Opinion> = {}): Opinion => ({
  verdict: 'optimal', evidence: { nativeDual: bound, qualified: true, frameError: 0 }, candidate: own === null ? null : build(own), finished: false, point: true,
  splitAt: 4.2, ...extra,
});

test('the production rule is the 2026-10-13 extension', () => {
  assert.equal(PRECISE_SPLIT_SHORTCUT, 'witness');
});

test('witness rule: a bound clearly above the incumbent AND the node\'s own build splits; within the tolerance of either, the full rule', () => {
  assert.equal(leadsOnlyToSplit(optimal(10, 6), false, node(5), TOL), true, 'clearly above both: the node is split whatever the exact bound');
  assert.equal(leadsOnlyToSplit(optimal(10, 6), false, node(null), TOL), true, 'no incumbent yet: the own build is the reference, still clearly above');
  assert.equal(leadsOnlyToSplit(optimal(10, 4), false, node(5), TOL), true, 'an own build below the incumbent changes nothing');
  assert.equal(leadsOnlyToSplit(optimal(5 + 2e-5, 5), false, node(5), TOL), true, 'just over the tolerance above both');
  // The incumbent update ordering: the search adds the node's build to the incumbent BEFORE it decides; a bound within the tolerance of the own build
  // would then fathom the node, which needs a settled verdict.
  assert.equal(leadsOnlyToSplit(optimal(6 + 0.5e-5, 6), false, node(5), TOL), false, 'within the tolerance of the own build (the new incumbent): full rule');
  assert.equal(leadsOnlyToSplit(optimal(6 + 1e-5, 6), false, node(5), TOL), false, 'exactly the tolerance above the own build: within it, full rule');
  assert.equal(leadsOnlyToSplit(optimal(6, 6), false, node(null), TOL), false, 'a bound equal to the own build (an exact secant point): full rule');
  assert.equal(leadsOnlyToSplit(optimal(5.9999, 6), false, node(5), TOL), false, 'a bound below the own build (noise or a defect): full rule');
  assert.equal(leadsOnlyToSplit(optimal(5 + 0.5e-5, 4), false, node(5), TOL), false, 'within the tolerance of the incumbent: fathoms, full rule');
  assert.equal(leadsOnlyToSplit(optimal(4.5, 4), false, node(5), TOL), false, 'below the incumbent: prunes, full rule');
  assert.equal(leadsOnlyToSplit(optimal(10, 6, { evidence: null }), false, node(null), TOL), false, 'no proved bound against a build: full rule');
  assert.equal(leadsOnlyToSplit(optimal(10, 6, { evidence: { nativeDual: 10, qualified: false, frameError: 0 } }), false, node(null), TOL), false, 'an unqualified bound proves nothing');
  // Another build the evaluation hands the search (the relaxed try's build kept through the fallback) is a reference too.
  assert.equal(leadsOnlyToSplit(optimal(10, 6), false, node(5), TOL, { others: [build(10 - 0.5e-5)] }), false, 'within the tolerance of a kept build: full rule');
  assert.equal(leadsOnlyToSplit(optimal(10, null), false, node(5), TOL, { others: [build(9.99999)] }), false, 'a kept build blocks the F1 case too');
  assert.equal(leadsOnlyToSplit(optimal(10, 6), false, node(5), TOL, { others: [build(7), null] }), true);
});

test('witness rule: everything that is not a qualified Optimal of a splittable inexact node keeps the full rule', () => {
  assert.equal(leadsOnlyToSplit(optimal(10, 6), true, node(null), TOL), false, 'an exact node: its settled verdict closes it');
  assert.equal(leadsOnlyToSplit(optimal(10, 6), false, node(null, null), TOL), false, 'a root without an interval');
  assert.equal(leadsOnlyToSplit(optimal(10, 6, { rejected: new Map() as never }), false, node(null), TOL), false, 'a rejected point is cut');
  assert.equal(leadsOnlyToSplit(optimal(10, 6, { splitAt: undefined }), false, node(null), TOL), false, 'no split point');
  assert.equal(leadsOnlyToSplit({ ...optimal(10, 6), verdict: 'none' }, false, node(null), TOL), false, 'a limit stop is no verdict');
  assert.equal(leadsOnlyToSplit({ ...optimal(10, 6), verdict: 'infeasible' }, false, node(null), TOL), false);
  // The resolution limit: an interval `splitInterval` cannot split would stop the search, which needs the node's settled verdict.
  assert.equal(leadsOnlyToSplit(optimal(10, 6, { splitAt: 4 }), false, node(5, { lo: 4, hi: 4 }), TOL), false, 'a singleton interval');
  assert.equal(leadsOnlyToSplit(optimal(10, null, { splitAt: 4 }), false, node(5, { lo: 4, hi: 4 + 1e-12 }), TOL), false, 'narrower than the numeric floor, F1 case too');
  assert.equal(leadsOnlyToSplit(optimal(10, null, { splitAt: 4 }), false, node(5, { lo: 4, hi: 4 + 1e-12 }), TOL, { mode: 'f1' }), true, "'f1' keeps the 2026-10-12 rule exactly");
});

test("'f1' rule: the 2026-10-12 predicate (no verified build), so the measured baseline is the code before the extension", () => {
  const f1 = { mode: 'f1' } as const;
  assert.equal(leadsOnlyToSplit(optimal(10, 6), false, node(5), TOL, f1), false, 'a verified build: full rule under F1');
  assert.equal(leadsOnlyToSplit(optimal(10, null), false, node(5), TOL, f1), true);
  assert.equal(leadsOnlyToSplit(optimal(10, null), false, node(null), TOL, f1), true);
  assert.equal(leadsOnlyToSplit(optimal(5 + 0.5e-5, null), false, node(5), TOL, f1), false);
  assert.equal(leadsOnlyToSplit(optimal(10, null), false, node(5), TOL, { mode: 'f1', others: [build(9.99999)] }), true, 'F1 never read kept builds');
});

test('search: a split that carries a build updates the incumbent first, then splits; the children inherit the node\'s own bound, never the opinion\'s', async () => {
  const seen: SearchNode[] = [];
  const evaluate = async (n: SearchNode): Promise<NodeEvaluation<VerifiedBuild>> => {
    seen.push(n);
    if (seen.length === 1) {
      return { verdict: 'split', evidence: { nativeDual: 7, qualified: true, frameError: 0 }, candidate: build(6, 4.5), exact: false, splitAt: 4.5 };
    }
    // The children: settled exact nodes at the incumbent's score, so the search completes.
    return { verdict: 'solved', evidence: { nativeDual: 6, qualified: true, frameError: 0 }, candidate: null, exact: true };
  };
  const result = await runSpatialSearch<VerifiedBuild>({ roots: [{ lo: 3, hi: 6 }], evaluate, tolerance: TOL, maxNodes: 10, now: () => 0, deadline: 1 });
  assert.equal(seen.length, 3);
  assert.equal(seen[0].incumbentExact, null);
  for (const child of seen.slice(1)) {
    assert.equal(child.bound, Infinity, 'the root\'s own bound (unknown), never the 7 of the unconfirmed opinion');
    assert.ok(child.incumbentExact !== null, 'the split\'s build is the incumbent when the children are handed out');
  }
  assert.deepEqual(seen.slice(1).map(c => c.interval), [{ lo: 3, hi: 4.5 }, { lo: 4.5, hi: 6 }]);
  assert.equal(result.incumbent?.score, 6);
  assert.equal(result.certified, true, 'certified by the children\'s settled verdicts alone');
  assert.ok(result.upperBound >= 6 && result.upperBound < 6 + 1e-9);
});

// ---------------------------------------------------------------------------------------------
// End to end on the pinned build
// ---------------------------------------------------------------------------------------------

/**
 * TrueErgo on a world with two roots: [1.5, 3] kg (exact, the free region) holds the optimum `a1 + b1` (score 55) and is solved first; [3, 8.5] kg is
 * inexact and its secant bound (about 59 at `a2` alone, 3.5 kg) is more than the tolerance above both the incumbent and its own build (`a2`, 50.7), so the
 * 'witness' rule splits it without a second opinion.
 */
const lookup: ItemLookup = lookupOf(
  gun(WEAPON, { weight: 1, ergo: 20, slots: [slot('a', ['a1', 'a2'], true), slot('b', ['b1', 'b2'], false)] }),
  ['a1', mod('a1', { weight: 0.5, ergo: 30 })], ['a2', mod('a2', { weight: 2.5, ergo: 45 })],
  ['b1', mod('b1', { weight: 0.5, ergo: 5 })], ['b2', mod('b2', { weight: 5, ergo: 20 })],
);
const params: SolveParams = {
  weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ergoWeight: 1, recoilWeight: 0, priceWeight: 0, useTrueErgo: true,
};
const FAR = (): number => performance.now() + 120_000;
const withRows = (lp: string, rows: string[]): string => {
  const at = lp.indexOf('\nBounds\n');
  return `${lp.slice(0, at)}\n${rows.map(r => `  ${r}`).join('\n')}${lp.slice(at)}`;
};
const built = (r: PreciseResult) => {
  assert.equal(r.kind, 'build');
  return r as Extract<PreciseResult, { kind: 'build' }>;
};

test('end to end: the heavy node is split on its first opinion with its build kept as a witness, and the certified optimum is unchanged', async () => {
  const witness = built(await solvePrecise({ params, deadline: FAR() }));
  const f1 = built(await solvePrecise({ params, deadline: FAR(), splitShortcut: 'f1' }));
  for (const r of [witness, f1]) {
    assert.equal(r.certified, true);
    assert.deepEqual(r.best.build.placements.map(p => p.itemId).sort(), ['a1', 'b1']);
    assert.equal(r.best.score, 55);
  }
  assert.ok(witness.summary.telemetry.splitWitnessNodes >= 1, 'the 2026-10-13 shortcut fired');
  assert.equal(f1.summary.telemetry.splitWitnessNodes, 0, "'f1' never splits a node with a build on one opinion");
  assert.ok(witness.summary.telemetry.secondOpinions < f1.summary.telemetry.secondOpinions, 'a second opinion saved');
  assert.equal(witness.summary.telemetry.disagreements, 0);
});

test('a defect-style first solve with a too-LOW bound is not clearly above the incumbent, so it gets the full second opinion and is caught', async () => {
  // Seed 0 answers every text as if `a2` were forbidden (a wrong Optimal with the matching wrong dual bound, the decision-5a defect mode): on the heavy
  // node its bound (about 29, at `a1 + b2`) is BELOW the incumbent 55, so the shortcut must not apply; the honest second seed disagrees, the third settles.
  const a2 = `n_${preparePhysicalWeapon(lookup, WEAPON).templateIndexOf('a2')}`;
  const seeds: number[] = [];
  const lying: SolveFn = async (lp, options, extras) => {
    const seed = Number(options.random_seed ?? 0);
    seeds.push(seed);
    const real = await nativeSolve(lp, options, extras);
    if (seed !== PRECISE_RANDOM_SEEDS[0]) return real;
    const wrong = await nativeSolve(withRows(lp, [`lie_a2: ${a2} = 0`]), options);
    return { ...real, modelStatus: wrong.modelStatus, colValues: wrong.colValues, objectiveValue: wrong.objectiveValue, mipDualBound: wrong.mipDualBound } as NativeResult;
  };
  const result = built(await solvePrecise({ params, deadline: FAR(), solve: lying }));
  assert.equal(result.certified, true);
  assert.deepEqual(result.best.build.placements.map(p => p.itemId).sort(), ['a1', 'b1']);
  assert.equal(result.best.score, 55);
  const t = result.summary.telemetry;
  assert.equal(t.splitWitnessNodes, 0, 'the too-low first bound never takes the shortcut');
  assert.ok(t.disagreements >= 1 && t.thirdOpinions >= 1, 'the full decision-5a rule ran and the tie-breaker settled the node');
  assert.ok(seeds.includes(PRECISE_RANDOM_SEEDS[1]) && seeds.includes(PRECISE_RANDOM_SEEDS[2]));
  assert.ok(result.summary.bounds.upper !== null && result.summary.bounds.upper >= 55, 'the published bound is never the lie');
});

const sameAnswer = (label: string, a: PreciseResult, b: PreciseResult): void => {
  assert.equal(a.kind, b.kind, `${label}: ${a.kind} against ${b.kind}`);
  assert.equal(a.outcome.status, b.outcome.status, `${label}: status`);
  assert.equal(a.outcome.physical_certificate, b.outcome.physical_certificate, `${label}: certificate`);
  if (a.kind === 'build' && b.kind === 'build') assert.equal(a.best.score, b.best.score, `${label}: score`);
};

test("seeded TrueErgo / Prevent Overswing worlds: 'witness' equals 'f1' (same kind, status, certificate and score)", { timeout: 900_000 }, async t => {
  let witnessSplits = 0;
  let saved = 0;
  for (let k = 1; k <= 100; k++) {
    const world = randomTedWorld(k);
    const p: SolveParams = { ...world.params, objectiveTolerance: 1e-6 };
    const on = await solvePrecise({ params: p, deadline: performance.now() + 60_000, splitShortcut: 'witness' });
    const off = await solvePrecise({ params: p, deadline: performance.now() + 60_000, splitShortcut: 'f1' });
    sameAnswer(`ted ${k}`, on, off);
    witnessSplits += on.summary.telemetry.splitWitnessNodes;
    saved += off.summary.telemetry.secondOpinions - on.summary.telemetry.secondOpinions;
  }
  t.diagnostic(`witness splits ${witnessSplits}; second opinions saved ${saved}`);
});

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';
/** Pinned guns that take the 2026-10-13 shortcut in the measurement (docs/stage3/split-shortcut.md), each quick under TrueErgo. */
const PINNED = ['60db29ce99594040e04c4a27', '6259b864ebedf17603599e88', '5e870397991fd70db46995c8']; // MTs-255-12, M3 Super 90, 590A1

test("pinned guns, TrueErgo and Prevent Overswing: 'witness' equals 'f1' with fewer second opinions", { skip, timeout: 900_000 }, async () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { guns: { id: string; shortName: string }[]; mods: unknown[] };
  const pinned = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const isAmmo = (id: string): boolean => !Object.hasOwn(pinned, id);
  let splits = 0;
  let secondOn = 0;
  let secondOff = 0;
  for (const id of PINNED) {
    for (const profile of ['trueErgo', 'trueErgoPO'] as const) {
      const p: SolveParams = {
        weaponId: id, itemLookup: pinned, compatibilityMap: buildCompatibilityMap(id, pinned), physicalOptions: { isAmmo },
        ergoWeight: 1, recoilWeight: 1, priceWeight: 0.1, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true, playerLevel: 50,
        traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, useTrueErgo: true,
        ...(profile === 'trueErgoPO' ? { preventOverswing: true, equipErgoModifier: -0.3 } : { equipErgoModifier: 0 }),
      };
      const on = await solvePrecise({ params: p, deadline: performance.now() + 60_000, splitShortcut: 'witness' });
      const off = await solvePrecise({ params: p, deadline: performance.now() + 60_000, splitShortcut: 'f1' });
      sameAnswer(`${id} ${profile}`, on, off);
      assert.equal(on.outcome.physical_certificate, 'certified_optimal', `${id} ${profile}`);
      assert.deepEqual(on.summary.bounds, off.summary.bounds, `${id} ${profile}: the same published bounds`);
      splits += on.summary.telemetry.splitWitnessNodes;
      secondOn += on.summary.telemetry.secondOpinions;
      secondOff += off.summary.telemetry.secondOpinions;
    }
  }
  assert.ok(splits > 0, 'the shortcut fired on the pinned guns');
  assert.ok(secondOn < secondOff, `fewer second opinions (${secondOn} against ${secondOff})`);
});
