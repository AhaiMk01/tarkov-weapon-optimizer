import assert from 'node:assert/strict';
import { certifiedDualBound, incumbentBlockReason, solve, SOLVER_CAPABILITIES } from './src/solver/solver.ts';
import { buildLP } from './src/solver/lpBuilder.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import { validateBuild } from './benchmarks/validateBuild.ts';
import type { ModLookupEntry } from './src/solver/types.ts';
import { physicalViolations } from './test_solver_fixtures.ts';

const columns = { x_1: { Primal: 1 }, buy_1: { Primal: 1 }, base_1: { Primal: 1 } };
assert.equal(incumbentBlockReason(columns, ['x_1', 'buy_1', 'base_1'], 1, []), undefined);
assert.match(incumbentBlockReason(columns, ['x_1', 'buy_1', 'base_1', 'p_1_1'], 1, []) ?? '', /Missing decision column p_1_1/);
assert.match(incumbentBlockReason({ ...columns, x_1: { Primal: 0.4 } }, ['x_1', 'buy_1', 'base_1'], 1, []) ?? '', /Nonintegral decision column x_1/);
assert.match(incumbentBlockReason({ ...columns, base_2: { Primal: 1 } }, ['x_1', 'buy_1', 'base_1', 'base_2'], 2, []) ?? '', /selected 2 purchase bases/);
assert.match(incumbentBlockReason(columns, ['x_1', 'buy_1', 'base_1'], 1, ['Required slot is empty: right']) ?? '', /Required slot is empty/);

/**
 * Two required slots that both accept the same parts. `capCopies` lists every part as conflicting with itself, which caps it at one installed
 * copy (ADR 0003): without the cap the exact model fills both slots with copies of one part, as the template model could not.
 */
function twoRequired(ids: string[], capCopies = false) {
  const params = choiceFixture(ids.map((id, i) => ({ id, weight: 1.2, ergo: 10 + i })));
  if (capCopies) for (const id of ids) (params.itemLookup[id] as ModLookupEntry).conflicting_items = [id];
  params.itemLookup.gun.slots = ['left', 'right'].map(id => ({
    id, name: id, nameId: id, required: true, allowedItems: ids,
  }));
  params.compatibilityMap = buildCompatibilityMap('gun', params.itemLookup);
  return params;
}

// One part, capped at one copy, for two required slots: no build.
const shared = twoRequired(['Only'], true);
const sharedResult = await solve(shared);
assert.equal(sharedResult.status, 'infeasible', sharedResult.reason);
assert.equal(sharedResult.optimization?.termination, undefined);

// Uncapped, the exact model installs the part twice: two required slots, two copies, two instances. So does the Fast count model (Phase 2.4c);
// the legacy single-copy template model could not.
{
  const uncapped = twoRequired(['Only']);
  const two = await solve(uncapped);
  assert.equal(two.status, 'optimal', two.reason);
  assert.deepEqual(two.selected_item_ids, ['Only', 'Only']);
  assert.equal(new Set(two.selected_items.map(i => i.instanceId)).size, 2);
  assert.ok(Math.abs((two.final_stats?.total_weight ?? 0) - 1.4) < 1e-9, 'receiver 1 kg plus two copies of 0.2 kg each (a choice weight is the build weight with that part)');
  assert.deepEqual(physicalViolations(uncapped, two), []);
  const fastTwo = await solve({ ...uncapped, preciseMode: false });
  assert.equal(fastTwo.status, 'optimal', fastTwo.reason);
  assert.deepEqual(fastTwo.selected_item_ids, ['Only', 'Only']);
  assert.deepEqual(physicalViolations(uncapped, fastTwo), []);
}

const fastShared = await solve({ ...shared, preciseMode: false });
assert.notEqual(fastShared.status, 'optimal');
assert.notEqual(fastShared.optimization?.termination, 'optimal');

const sweet = await solve({ ...shared, useTchebycheff: true });
assert.notEqual(sweet.status, 'optimal', sweet.reason);
assert.notEqual(sweet.optimization?.termination, 'optimal');

const filled = twoRequired(['A', 'B'], true);
const filledResult = await solve(filled);
assert.equal(filledResult.status, 'optimal', filledResult.reason);
assert.deepEqual(filledResult.selected_items.map(i => i.id).sort(), ['A', 'B']);
assert.deepEqual(physicalViolations(filled, filledResult), []);

// A limit objective is a primal value. It must not become a relaxation upper bound.
assert.equal(certifiedDualBound('Time limit reached', 4500), undefined);
// No fixed margin: the nominal 1e-7 the pre-cutover code added made a tolerance below it uncertifiable (ADR 0013 4C: nominal margins are a defect).
assert.equal(certifiedDualBound('Optimal', 4500), 4500);

// One required choice. On [3, 10] the secant admits the 6 kg build (exact TED -5)
// at relaxation objective 4500. The 3 kg build (exact TED 30) is the only exact
// choice. Refinement must recover and certify it. The 10 kg build only widens
// the interval.
const overswing = choiceFixture([
  { id: 'Relaxed', weight: 6, ergo: 45 },
  { id: 'Valid', weight: 3, ergo: 30 },
  { id: 'Wide', weight: 10, ergo: 0 },
]);
assert.deepEqual(buildLP({ ...overswing, preventOverswing: true }).weightBounds, [3, 10]);

const recovered = await solve({ ...overswing, preventOverswing: true });
assert.equal(recovered.status, 'optimal', recovered.reason);
assert.deepEqual(recovered.selected_items.map(i => i.id), ['Valid']);
assert.equal(recovered.final_stats?.true_ergo_delta, 30);
assert.equal(recovered.optimization?.termination, 'optimal');
assert.ok(recovered.optimization!.absolute_gap <= recovered.optimization!.tolerance);
assert.ok(Math.abs(recovered.objective_value - 3000) < 1e-4);
assert.deepEqual(validateBuild({ weapon_id: 'gun', prevent_overswing: true }, recovered, overswing.itemLookup), []);

// Stop after the root proof and the refined interval that holds Valid. The
// sibling keeps the root relaxation bound, so the search stays uncertified.
const partial = await solve({ ...overswing, preventOverswing: true, maxSpatialNodes: 2 });
assert.equal(partial.status, 'feasible', partial.reason);
assert.deepEqual(partial.selected_items.map(i => i.id), ['Valid']);
assert.equal(partial.final_stats?.true_ergo_delta, 30);
assert.equal(partial.optimization?.termination, 'limit');
assert.ok(partial.optimization!.absolute_gap > partial.optimization!.tolerance);
assert.ok(partial.optimization!.upper_bound > partial.optimization!.lower_bound + 100);

// No exactly feasible build: the first relaxation is optimal and ineligible.
// Exhaust the intervals instead of stopping on that validation failure.
const none = choiceFixture([
  { id: 'Relaxed', weight: 6, ergo: 45 },
  { id: 'Light', weight: 4, ergo: 0 },
  { id: 'Wide', weight: 10, ergo: 0 },
]);
const exhausted = await solve({ ...none, preventOverswing: true });
assert.equal(exhausted.status, 'infeasible', exhausted.reason);
assert.equal(exhausted.selected_items.length, 0);
assert.notEqual(exhausted.optimization?.termination, 'optimal');

// A deadline that expires before any node does not invent a certificate.
const timed = await solve({ ...overswing, preventOverswing: true, timeLimitMs: 0 });
assert.equal(timed.status, 'incomplete');
assert.equal(timed.optimization, undefined);
assert.equal(timed.selected_items.length, 0);

// Production capabilities: experimental search policies are disabled by default
assert.equal(SOLVER_CAPABILITIES.retainLimitIncumbent, false);
assert.equal(SOLVER_CAPABILITIES.branchOrdering, false);
assert.equal(SOLVER_CAPABILITIES.initialCandidate, false);

// Branch ordering capabilities and telemetry (when present in candidate build)
if ((SOLVER_CAPABILITIES as any).branchOrdering) {
  const straddle = choiceFixture([
    { id: 'LightPart', weight: 2, ergo: 20 },
    { id: 'HeavyPart', weight: 4, ergo: 40 },
  ]);

  const lightFirst = await solve({ ...straddle, useTrueErgo: true, branchOrdering: 'lighter-first' });
  assert.equal(lightFirst.status, 'optimal');
  assert.equal(lightFirst.spatial_telemetry?.branch_ordering, 'lighter-first');
  assert.ok(lightFirst.spatial_telemetry.node_traces.length >= 2);
  assert.ok(lightFirst.spatial_telemetry.node_traces[0].interval[1] <= 3, 'lighter-first must process [lo, 3] first');

  const heavyFirst = await solve({ ...straddle, useTrueErgo: true, branchOrdering: 'heavier-first' });
  assert.equal(heavyFirst.status, 'optimal');
  assert.equal(heavyFirst.spatial_telemetry?.branch_ordering, 'heavier-first');
  assert.ok(heavyFirst.spatial_telemetry.node_traces.length >= 2);
  assert.ok(heavyFirst.spatial_telemetry.node_traces[0].interval[0] >= 3, 'heavier-first must process [3, hi] first');
}

// Initial candidate capabilities and telemetry (when present in candidate build)
if ((SOLVER_CAPABILITIES as any).initialCandidate) {
  const straddle = choiceFixture([
    { id: 'LightPart', weight: 2, ergo: 20 },
    { id: 'HeavyPart', weight: 4, ergo: 40 },
  ]);

  const initOverswing = await solve({ ...overswing, preventOverswing: true, initialCandidate: true });
  assert.equal(initOverswing.status, 'optimal');
  assert.ok(initOverswing.initial_candidate_telemetry != null);
  assert.equal(initOverswing.initial_candidate_telemetry.generated, true);
  assert.equal(initOverswing.initial_candidate_telemetry.valid, false, 'Invalid linear seed (TED -5) must not be adopted');
  assert.deepEqual(initOverswing.selected_items.map(i => i.id), ['Valid']);

  const initStraddle = await solve({ ...straddle, useTrueErgo: true, initialCandidate: true });
  assert.equal(initStraddle.status, 'optimal');
  assert.ok(initStraddle.initial_candidate_telemetry != null);
  assert.equal(initStraddle.initial_candidate_telemetry.generated, true);
  assert.equal(initStraddle.initial_candidate_telemetry.valid, true, 'Valid linear seed must be accepted');
  assert.ok(initStraddle.initial_candidate_telemetry.score != null);
}

// Strengthened accounting regression: six-choice smoke fixture that reaches actual pre-solve pruning.
// Asserts:
// 1. At least one pre-solve prune occurred.
// 2. Pre-solve pruning did not increment the MIP-solve counter (optimization.nodes).
// 3. The resulting build and certificate remain valid.
const sixChoiceSmoke = choiceFixture([
  { id: 'DeceptiveRoot', weight: 6.0, ergo: 60 },
  { id: 'MidDeceptive', weight: 4.5, ergo: 40 },
  { id: 'Hero', weight: 10.0, ergo: 90 },
  { id: 'Light', weight: 2.0, ergo: 10 },
  { id: 'Light2', weight: 2.8, ergo: 15 },
  { id: 'Anchor', weight: 12.0, ergo: 0 },
]);

const pruneSmokeRun = await solve({ ...sixChoiceSmoke, useTrueErgo: true });
assert.equal(pruneSmokeRun.status, 'optimal');
assert.equal(pruneSmokeRun.optimization?.termination, 'optimal');
assert.ok(pruneSmokeRun.optimization!.absolute_gap <= pruneSmokeRun.optimization!.tolerance);
assert.deepEqual(validateBuild({ weapon_id: 'gun', use_true_ergo: true }, pruneSmokeRun, sixChoiceSmoke.itemLookup), []);

if (pruneSmokeRun.spatial_telemetry) {
  const traces = pruneSmokeRun.spatial_telemetry.node_traces;
  const preSolvePrunes = traces.filter(t => t.status === 'pruned-before-solve');
  const actualSolvedMips = traces.filter(t => t.status !== 'pruned-before-solve');

  assert.ok(preSolvePrunes.length >= 1, `Must reach pre-solve pruning; got ${preSolvePrunes.length}`);
  assert.equal(pruneSmokeRun.optimization!.nodes, actualSolvedMips.length, 'optimization.nodes must count only solved MIPs, not pre-solve prunes');
  assert.equal(traces.length, actualSolvedMips.length + preSolvePrunes.length);
}

// Dedicated seed telemetry coverage (when initialCandidate is supported):
// Asserts seed generation, validity, score, and that pre-solve pruned_nodes_count is 0.
// (Root nodes begin with bound: Infinity and cannot be pruned pre-solve;
// any solved node with bound <= seed score is pruned post-solve and never enqueued).
if ((SOLVER_CAPABILITIES as any).initialCandidate) {
  const seedPruneFixture = choiceFixture([
    { id: 'SeedWinner', weight: 2, ergo: 50 },
    { id: 'SuboptimalHeavy', weight: 5, ergo: 15 },
  ]);

  const seedRun = await solve({
    ...seedPruneFixture,
    useTrueErgo: true,
    initialCandidate: true,
  });
  assert.equal(seedRun.status, 'optimal');
  assert.ok(seedRun.initial_candidate_telemetry != null);
  assert.equal(seedRun.initial_candidate_telemetry.generated, true);
  assert.equal(seedRun.initial_candidate_telemetry.valid, true);
  assert.ok(seedRun.initial_candidate_telemetry.score != null);
  assert.equal(seedRun.initial_candidate_telemetry.pruned_nodes_count, 0, 'Seed cannot prune root nodes pre-solve; post-solve pruning handles bounds <= seed score');
}

console.log('incumbent gate and required-slot formulation passed');
