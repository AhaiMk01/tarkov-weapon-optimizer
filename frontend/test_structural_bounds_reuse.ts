import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { computeStructuralBounds } from './src/solver/structuralBounds.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import { explorePareto } from './src/solver/paretoExplorer.ts';

console.log('Running Tier 1 Structural Bounds reuse & lifetime provenance test...');

// Fixture: Receiver 1 kg + choice Part6kg (weight 6 kg total)
const fixture6kg = choiceFixture([
  { id: 'Part6kg', weight: 6.0, ergo: 30 },
]);

// 1. Prepare bounds with a restrictive maxWeight cap of 4 kg -> minWeight is 6kg, rawMaxW is max(rawMinW, min(rawMaxW, 4)) = 6kg
// To test clipping, we need a fixture where a lighter build exists (e.g. 3 kg) and a heavier build exists (e.g. 6 kg)
const multiWeightFixture = choiceFixture([
  { id: 'PartLight', weight: 3.0, ergo: 20 },
  { id: 'PartHeavy', weight: 6.0, ergo: 30 },
]);

// 1. Prepare bounds with maxWeight: 4 kg -> weightBounds are [3, 4]
const cappedBounds = computeStructuralBounds(
  multiWeightFixture.weaponId,
  multiWeightFixture.itemLookup,
  multiWeightFixture.compatibilityMap,
  { maxWeight: 4.0 },
);
assert.deepEqual(cappedBounds.weightBounds, [3, 4]);
assert.ok(cappedBounds.physicalWeightBounds != null);
assert.deepEqual(cappedBounds.physicalWeightBounds, [3, 6]); // unclipped physical range is [3, 6]

// 2. Exercised counterexample:
// When maxWeight: 4 is removed (maxWeight: null), reusing cappedBounds MUST NOT report infeasible for a 6 kg build.
// lpBuilder must apply request limits dynamically to unclipped physical bounds.
const resUncapped = await solve({
  ...multiWeightFixture,
  maxWeight: null, // cap removed!
  structuralBounds: cappedBounds, // previously prepared under maxWeight: 4
});
assert.equal(resUncapped.status, 'optimal', 'Removing maxWeight cap must certify 6 kg build even with cached capped bounds');
assert.equal(resUncapped.final_stats?.total_weight, 6);
assert.deepEqual(resUncapped.selected_items.map(i => i.id), ['PartHeavy']);

// 3. And when a 4 kg cap IS requested, it enforces maxWeight: 4 correctly (picks PartLight at 3 kg):
const resCapped = await solve({
  ...multiWeightFixture,
  maxWeight: 4.0,
  structuralBounds: cappedBounds,
});
assert.equal(resCapped.status, 'optimal');
assert.equal(resCapped.final_stats?.total_weight, 3);
assert.deepEqual(resCapped.selected_items.map(i => i.id), ['PartLight']);

// 4. Preparation context verification:
// Bounds prepared for a different weapon must NOT be mistakenly reused
const differentWeaponBounds = {
  ...cappedBounds,
  context: {
    weaponId: 'different_weapon_id',
    maxWeight: 4.0,
  },
};
const resDiffWeapon = await solve({
  ...multiWeightFixture,
  maxWeight: null,
  structuralBounds: differentWeaponBounds, // mismatched context
});
// lpBuilder detects mismatched context and recomputes fresh bounds for multiWeightFixture -> optimal!
assert.equal(resDiffWeapon.status, 'optimal');
assert.equal(resDiffWeapon.final_stats?.total_weight, 6);

// 5. ExplorePareto forwards boundsMode and reuses precomputed bounds across points
const frontier = await explorePareto({
  weaponId: multiWeightFixture.weaponId,
  itemLookup: multiWeightFixture.itemLookup,
  compatibilityMap: multiWeightFixture.compatibilityMap,
  ignore: 'price',
  steps: 5,
  boundsMode: 'structural',
  structuralBounds: cappedBounds,
});
assert.ok(frontier.length > 0);

// 6. User-exercised boundary probe:
// Physical bounds [2, 8], prepared under a 3 kg cap.
// New uncapped request requiring the 8 kg build.
const fixture8kg = choiceFixture([
  { id: 'LightPart', weight: 2.0, ergo: 10 },
  { id: 'HeavyPart8kg', weight: 8.0, ergo: 50 }, // optimum
]);

// Prepare bounds under 3 kg cap -> weightBounds are [2, 3]
const capped3kg = computeStructuralBounds(
  fixture8kg.weaponId,
  fixture8kg.itemLookup,
  fixture8kg.compatibilityMap,
  { maxWeight: 3.0 },
);
assert.deepEqual(capped3kg.weightBounds, [2, 3]);
assert.deepEqual(capped3kg.physicalWeightBounds, [2, 8]);

// With complete preparation object: cap removed certifies 8 kg build
const resComplete = await solve({
  ...fixture8kg,
  maxWeight: null,
  structuralBounds: capped3kg,
});
assert.equal(resComplete.status, 'optimal', 'Complete preparation object must certify 8 kg build when cap is removed');
assert.equal(resComplete.final_stats?.total_weight, 8);
assert.deepEqual(resComplete.selected_items.map(i => i.id), ['HeavyPart8kg']);

// With legacy-shaped unproven object (missing physicalWeightBounds and context):
// lpBuilder must NOT trust the clipped fallback [2, 3]; it must recompute fresh bounds and certify!
const legacyShapedBounds = {
  weightBounds: capped3kg.weightBounds, // [2, 3]
  ergoBounds: capped3kg.ergoBounds,
} as any;
const resLegacyShaped = await solve({
  ...fixture8kg,
  maxWeight: null,
  structuralBounds: legacyShapedBounds,
});
assert.equal(resLegacyShaped.status, 'optimal', 'Unproven legacy-shaped bounds must be discarded and recomputed, never trusted as clipped fallback');
assert.equal(resLegacyShaped.final_stats?.total_weight, 8);

console.log('Tier 1 Structural Bounds reuse & lifetime provenance test passed!');
