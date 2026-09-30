import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { choiceFixture } from './test_solver_fixtures.ts';

// Tangents to the old threshold used to remove B after selecting A, possibly
// reporting infeasible when only A/B were available. B is globally valid.
for (const includeC of [false, true]) {
  const choices = [
    { id: 'A', weight: 8, ergo: 10, recoil: 50 },
    { id: 'B', weight: 5, ergo: 50, recoil: 60 },
    ...(includeC ? [{ id: 'C', weight: 4, ergo: 40, recoil: 90 }] : []),
  ];
  for (const useTchebycheff of [false, true]) {
    const result = await solve({ ...choiceFixture(choices), ergoWeight: 0, recoilWeight: 100, preventOverswing: true, useTchebycheff });
    assert.equal(result.status, 'optimal', result.reason);
    assert.deepEqual(result.selected_items.map(i => i.id), ['B']);
    assert.equal(result.final_stats?.true_ergo_delta, 10);
    assert.ok(result.optimization!.absolute_gap <= result.optimization!.tolerance);
  }
}

// Gear matters even with the TrueErgo objective disabled.
const gear = choiceFixture([
  { id: 'heavy', weight: 6, ergo: 60, recoil: 40 },
  { id: 'light', weight: 3, ergo: 10, recoil: 70 },
]);
const penalized = await solve({ ...gear, ergoWeight: 0, recoilWeight: 100, preventOverswing: true, equipErgoModifier: -0.2 });
assert.equal(penalized.status, 'optimal', penalized.reason);
assert.equal(penalized.selected_items[0].id, 'light');

// There is no 7 kg physical cap: perfect effective ergo permits any finite weight.
const heavy = await solve({ ...choiceFixture([{ id: 'heavy', weight: 12, ergo: 100 }]), preventOverswing: true });
assert.equal(heavy.status, 'optimal', heavy.reason);
assert.equal(heavy.final_stats?.total_weight, 12);

const boundary = await solve({ ...choiceFixture([{ id: 'boundary', weight: 6, ergo: 50 }]), preventOverswing: true });
assert.equal(boundary.status, 'optimal', boundary.reason);
assert.equal(boundary.final_stats?.true_ergo_delta, 0);
const impossible = await solve({ ...choiceFixture([{ id: 'bad', weight: 6, ergo: 10 }]), preventOverswing: true });
assert.equal(impossible.status, 'infeasible');
const interrupted = await solve({ ...gear, preventOverswing: true, maxSpatialNodes: 0 });
assert.equal(interrupted.status, 'incomplete');
console.log('Overswing outer-bound, no-false-infeasibility, gear, boundary and heavy-weapon regressions passed');
