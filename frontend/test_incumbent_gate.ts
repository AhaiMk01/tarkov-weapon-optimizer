import assert from 'node:assert/strict';
import { certifiedDualBound, incumbentBlockReason, solve } from './src/solver/solver.ts';
import { buildLP } from './src/solver/lpBuilder.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import { validateBuild } from './benchmarks/validateBuild.ts';

const columns = { x_1: { Primal: 1 }, buy_1: { Primal: 1 }, base_1: { Primal: 1 } };
assert.equal(incumbentBlockReason(columns, ['x_1', 'buy_1', 'base_1'], 1, []), undefined);
assert.match(incumbentBlockReason(columns, ['x_1', 'buy_1', 'base_1', 'p_1_1'], 1, []) ?? '', /Missing decision column p_1_1/);
assert.match(incumbentBlockReason({ ...columns, x_1: { Primal: 0.4 } }, ['x_1', 'buy_1', 'base_1'], 1, []) ?? '', /Nonintegral decision column x_1/);
assert.match(incumbentBlockReason({ ...columns, base_2: { Primal: 1 } }, ['x_1', 'buy_1', 'base_1', 'base_2'], 2, []) ?? '', /selected 2 purchase bases/);
assert.match(incumbentBlockReason(columns, ['x_1', 'buy_1', 'base_1'], 1, ['Required slot is empty: right']) ?? '', /Required slot is empty/);

function twoRequired(ids: string[]) {
  const params = choiceFixture(ids.map((id, i) => ({ id, weight: 1.2, ergo: 10 + i })));
  params.itemLookup.gun.slots = ['left', 'right'].map(id => ({
    id, name: id, nameId: id, required: true, allowedItems: ids,
  }));
  params.compatibilityMap = buildCompatibilityMap('gun', params.itemLookup);
  return params;
}

const shared = twoRequired(['Only']);
const sharedResult = await solve(shared);
assert.equal(sharedResult.status, 'infeasible', sharedResult.reason);
assert.equal(sharedResult.optimization?.termination, undefined);

const fastShared = await solve({ ...shared, preciseMode: false });
assert.notEqual(fastShared.status, 'optimal');
assert.notEqual(fastShared.optimization?.termination, 'optimal');

const sweet = await solve({ ...shared, useTchebycheff: true });
assert.notEqual(sweet.status, 'optimal', sweet.reason);
assert.notEqual(sweet.optimization?.termination, 'optimal');

const filled = twoRequired(['A', 'B']);
const filledResult = await solve(filled);
assert.equal(filledResult.status, 'optimal', filledResult.reason);
assert.deepEqual(filledResult.selected_items.map(i => i.id).sort(), ['A', 'B']);
assert.deepEqual(validateBuild({ weapon_id: 'gun' }, filledResult, filled.itemLookup), []);

// A limit objective is a primal value. It must not become a relaxation upper bound.
assert.equal(certifiedDualBound('Time limit reached', 4500), undefined);
assert.equal(certifiedDualBound('Optimal', 4500), 4500 + 1e-7);

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

console.log('incumbent gate and required-slot formulation passed');
