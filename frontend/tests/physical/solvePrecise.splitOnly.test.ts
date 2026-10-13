// Owner decision F1 (2026-10-12): a node verdict that leads ONLY to a split of the weight range (a qualified Optimal of an inexact node with no verified
// build and a split point, whose bound would not fathom the node) needs no second opinion: splitting discards nothing, and the shortcut issues no bound,
// no pruning and no certificate (src/solver/physical/solvePrecise.ts `leadsOnlyToSplit`, src/solver/physical/search.ts verdict `split`).
// The predicate is tested on its own, then end to end on the Stage 3 floor finding F1 (frozen case R1-SR25-PO, trial 2), whose query used to stop with
// `Native solution limit reached` because the second opinion of the split-only node ran under the floor's `mip_max_improving_sols = 1`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildItemLookup } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { floorQueryParams, preciseFloorQuery } from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { ratFromDouble } from '../../src/solver/physical/exact';
import { nativeSolve } from '../../src/solver/physical/nativeSolve';
import type { SolveFn } from '../../src/solver/physical/nativeSolve';
import type { Candidate } from '../../src/solver/physical/search';
import { leadsOnlyToSplit, solvePrecise } from '../../src/solver/physical/solvePrecise';
import type { Opinion, VerifiedBuild } from '../../src/solver/physical/solvePrecise';
import { MOA_FLOOR_NATIVE_STOP } from '../../src/solver/moaFloor';
import { fixedGuard } from '../../src/solver/runtimeGuard';

const TOL = 1e-5;
const node = (incumbent: number | null) => ({ interval: { lo: 3, hi: 6 }, incumbentExact: incumbent === null ? null : ratFromDouble(incumbent) });
const optimalPoint = (bound: number, extra: Partial<Opinion> = {}): Opinion => ({
  verdict: 'optimal', evidence: { nativeDual: bound, qualified: true, frameError: 0 }, candidate: null, finished: false, point: true, splitAt: 4.2, ...extra,
});
const build = { score: 1, payload: { stats: { weight: 4.2 } } as unknown as VerifiedBuild } as Candidate<VerifiedBuild>;

test('leadsOnlyToSplit: only a qualified Optimal of an inexact node, with no verified build, no rejected point and a split point, whose bound would not fathom', () => {
  assert.equal(leadsOnlyToSplit(optimalPoint(10), false, node(null), TOL), true, 'no incumbent: nothing can be fathomed, the node is split');
  assert.equal(leadsOnlyToSplit(optimalPoint(10), false, node(5), TOL), true, 'a bound well above the incumbent: the search would split anyway');
  assert.equal(leadsOnlyToSplit(optimalPoint(5 + 0.5e-5), false, node(5), TOL), false, 'a bound within the tolerance would FATHOM the node: full rule');
  assert.equal(leadsOnlyToSplit(optimalPoint(4), false, node(5), TOL), false, 'a bound below the incumbent would prune: full rule');
  assert.equal(leadsOnlyToSplit(optimalPoint(10, { evidence: null }), false, node(5), TOL), false, 'no proved bound against an incumbent: full rule');
  assert.equal(leadsOnlyToSplit(optimalPoint(10), true, node(null), TOL), false, 'an exact node is never split');
  assert.equal(leadsOnlyToSplit(optimalPoint(10), false, { interval: null, incumbentExact: null }, TOL), false, 'a root with no interval cannot be split');
  assert.equal(leadsOnlyToSplit(optimalPoint(10, { candidate: build }), false, node(null), TOL, { mode: 'f1' }), false, "'f1': a verified build takes the full rule");
  // The 2026-10-13 extension (production): a build is a witness, and the bound need only clear it too (tests/physical/solvePrecise.splitWitness.test.ts).
  assert.equal(leadsOnlyToSplit(optimalPoint(10, { candidate: build }), false, node(null), TOL), true, 'a bound clearly above the own build: split');
  assert.equal(leadsOnlyToSplit(optimalPoint(10, { rejected: new Map() as never }), false, node(null), TOL), false, 'a rejected point is cut, not split');
  assert.equal(leadsOnlyToSplit(optimalPoint(10, { splitAt: undefined }), false, node(null), TOL), false, 'a fractional relaxed point has no split point');
  assert.equal(leadsOnlyToSplit({ ...optimalPoint(10), verdict: 'none' }, false, node(null), TOL), false, 'a limit stop is no verdict');
  assert.equal(leadsOnlyToSplit({ ...optimalPoint(10), verdict: 'infeasible' }, false, node(null), TOL), false);
});

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';
const SR25 = '5df8ce05b11454561e39243b';
/** Trial 2 of frozen case R1-SR25-PO (benchmarks/stage3-floor/cases.json): bisection between lo 0.5315067551308055 and the seed's hi 1.5315067551308055. */
const CAP = 1.0315067551308055;

test('F1 end to end: the Prevent Overswing floor trial that used to stop on the second opinion of a split-only node now finds its witness', { skip }, async () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { guns: unknown[]; mods: unknown[] };
  const lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
  const request: MoaFloorRequest = {
    weaponId: SR25, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(SR25, lookup), useTrueErgo: false, preventOverswing: true, equipErgoModifier: -0.3,
    traderLevels: { prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4 }, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true,
    playerLevel: 50, ownedItems: [], precisionRequest: 'precise', preciseMode: true,
  };
  const statuses: string[] = [];
  const recording: SolveFn = async (lp, options, extras) => {
    const r = await nativeSolve(lp, options, extras);
    statuses.push(`${r.modelStatus.name}@${String(options.random_seed)}`);
    return r;
  };
  const result = await preciseFloorQuery(request, recording)(CAP, fixedGuard(performance.now() + 60_000));
  assert.equal(result.kind, 'witness', `the query found no witness (native: ${statuses.join(', ')})`);
  if (result.kind === 'witness') assert.ok(result.witness.achievedMoa <= CAP);
  assert.ok(!statuses.includes('SolutionLimit@11'), 'no second opinion of the split-only node ran under the floor\'s solution limit');

  // The same query through solvePrecise directly: the split-only node is counted, and no bound is published from it (G1).
  const direct = await solvePrecise({ params: floorQueryParams(request, CAP), guard: fixedGuard(performance.now() + 60_000), nativeStop: MOA_FLOOR_NATIVE_STOP, stopAtFirstWitness: true });
  assert.equal(direct.kind, 'build');
  assert.ok(direct.summary.telemetry.splitOnlyNodes >= 1, 'the overswinging relaxed optimum of the heavy node was split on its first opinion alone');
  assert.equal(direct.summary.bounds.upper, null, 'a first-witness result publishes no bound (no settled verdict bounds every live node)');
});
