import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { computeStructuralBounds } from './src/solver/structuralBounds.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import { explorePareto } from './src/solver/paretoExplorer.ts';

console.log('Running Tier 1 Structural Bounds reuse test...');

const p = choiceFixture([
  { id: 'M1', weight: 1.5, ergo: 15 },
  { id: 'M2', weight: 2.5, ergo: 25 },
]);

// 1. Compute structural bounds once
const precomputedBounds = computeStructuralBounds(p.weaponId, p.itemLookup, p.compatibilityMap, { maxWeight: p.maxWeight });
assert.ok(precomputedBounds != null);

// 2. Pass precomputed bounds into solve
const resWithPrecomputed = await solve({
  ...p,
  structuralBounds: precomputedBounds,
});
assert.equal(resWithPrecomputed.status, 'optimal');

// 3. Verify identical outcome without precomputed
const resNormal = await solve(p);
assert.equal(resNormal.status, 'optimal');
assert.equal(resWithPrecomputed.objective_value, resNormal.objective_value);
assert.deepEqual(resWithPrecomputed.selected_items, resNormal.selected_items);

// 4. ExplorePareto with precomputed bounds
const frontier = await explorePareto({
  weaponId: p.weaponId,
  itemLookup: p.itemLookup,
  compatibilityMap: p.compatibilityMap,
  ignore: 'price',
  steps: 5,
  structuralBounds: precomputedBounds,
});
assert.ok(frontier.length > 0);

console.log('Tier 1 Structural Bounds reuse test passed!');
