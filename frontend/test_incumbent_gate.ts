import assert from 'node:assert/strict';
import { incumbentBlockReason, solve } from './src/solver/solver.ts';
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
assert.match(buildLP(shared).lpString, /req_\d+: p_/, 'required-slot rows must count placement, not selection');
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
console.log('incumbent gate and required-slot formulation passed');
