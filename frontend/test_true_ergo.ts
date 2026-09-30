import assert from 'node:assert/strict';
import { solve, computeIdealPoint } from './src/solver/solver.ts';
import { trueErgoDelta } from './src/solver/trueErgo.ts';
import { choiceFixture } from './test_solver_fixtures.ts';

const base = choiceFixture([
  { id: 'A', weight: 2, ergo: 20 },
  { id: 'B', weight: 3, ergo: 30 },
  { id: 'C', weight: 4, ergo: 41 },
]);
for (const useTchebycheff of [false, true]) {
  const result = await solve({ ...base, useTrueErgo: true, useTchebycheff });
  assert.equal(result.status, 'optimal', result.reason);
  assert.deepEqual(result.selected_items.map(i => i.id), ['B']);
  assert.equal(result.final_stats?.true_ergo_delta, 30);
  assert.ok(result.optimization!.absolute_gap <= result.optimization!.tolerance);
}
const raw = await solve(base);
assert.deepEqual(raw.selected_items.map(i => i.id), ['C']);
const ideal = await computeIdealPoint({ ...base, useTrueErgo: true });
assert.equal(ideal.zE, 300, 'ideal ergonomics axis uses actual TED, not raw ergo or a slope surrogate');

// Changing only gear must change the preferred true-TED build.
const gearBase = choiceFixture([{ id: 'light', weight: 3, ergo: 30 }, { id: 'heavy', weight: 6, ergo: 100 }]);
assert.equal((await solve({ ...gearBase, useTrueErgo: true })).selected_items[0].id, 'heavy');
assert.equal((await solve({ ...gearBase, useTrueErgo: true, equipErgoModifier: -0.7 })).selected_items[0].id, 'light');

// Both clamps apply before TED; raw ergo below zero must not make the LP infeasible.
for (const [ergo, modifier, expected] of [[150, -0.2, 80], [90, 0.5, 100], [-10, 0, 0]] as const) {
  const result = await solve({ ...choiceFixture([{ id: 'only', weight: 3, ergo }]), useTrueErgo: true, equipErgoModifier: modifier });
  assert.equal(result.status, 'optimal', result.reason);
  assert.equal(result.final_stats?.true_ergo_delta, expected);
}
assert.equal(trueErgoDelta(50, 0), 50);
assert.equal(trueErgoDelta(50, 3), 50);
assert.equal(trueErgoDelta(50, 6), 0);

// A node limit is not evidence of either infeasibility or optimality.
const interrupted = await solve({ ...base, useTrueErgo: true, maxSpatialNodes: 0 });
assert.equal(interrupted.status, 'incomplete');
assert.equal(interrupted.final_stats, undefined);
const partial = await solve({ ...base, useTrueErgo: true, maxSpatialNodes: 1 });
assert.equal(partial.status, 'feasible');
assert.equal(partial.optimization?.termination, 'limit');
assert.equal(partial.final_stats?.true_ergo_delta, 30);
console.log('TrueErgo objective, clamps, ideal axis, gear and limit regressions passed');
