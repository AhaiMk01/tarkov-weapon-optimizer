import assert from 'node:assert/strict';
import {
  canonicalizeTraderLevels,
  canonicalizeArray,
  computeIdealPointCacheKey,
  computeExactSolveCacheKey,
  computeStructuralBoundsCacheKey,
  type CacheKeyOptions,
} from './src/solver/reuseKey.ts';
import type { OptimizeRequest } from './src/api/client.ts';

console.log('Running reuseKey TDD test suite...');

// 1. Array canonicalization (sorting + deduplicating)
assert.deepEqual(canonicalizeArray(['b', 'a', 'b', 'c']), ['a', 'b', 'c']);
assert.equal(canonicalizeArray(undefined), undefined);
assert.equal(canonicalizeArray([]), undefined);

// 2. Trader levels canonicalization (normalization + lowercasing + whitespace trimming + deterministic alias precedence)
const tl1 = { prapor: 4, SKIER: 3, mechanic: 2, peacekeeper: 4 };
const tl2 = { skier: 3, PRAPOR: 4, Peacekeeper: 4, mechanic: 2 };
assert.deepEqual(canonicalizeTraderLevels(tl1), canonicalizeTraderLevels(tl2));
assert.deepEqual(canonicalizeTraderLevels(undefined), undefined);

// Whitespace trimming in trader levels
const tlSpace = { " Mechanic ": 0 };
const tlClean = { mechanic: 0 };
assert.deepEqual(canonicalizeTraderLevels(tlSpace as any), canonicalizeTraderLevels(tlClean));

// Deterministic duplicate-alias precedence (last entry in iteration wins)
const tlConflict = { mechanic: 0, Mechanic: 4 };
assert.deepEqual(canonicalizeTraderLevels(tlConflict as any), { mechanic: 4 });

const tlConflictRev = { Mechanic: 4, mechanic: 0 };
assert.deepEqual(canonicalizeTraderLevels(tlConflictRev as any), { mechanic: 0 });

// 3. Sweet Spot endpoint cache key:
// MUST be invariant to preference weights (ergo_weight, recoil_weight, price_weight)
const baseReq: OptimizeRequest = {
  weapon_id: 'm4a1',
  ergo_weight: 1,
  recoil_weight: 1,
  price_weight: 0.5,
  min_ergonomics: 40,
  max_price: 200000,
  include_items: ['partB', 'partA'],
  trader_levels: { prapor: 4, skier: 3 },
  flea_available: true,
  use_true_ergo: true,
  prevent_overswing: true,
};

const keyWeight1 = computeIdealPointCacheKey('en', 'regular', baseReq);
const keyWeight2 = computeIdealPointCacheKey('en', 'regular', {
  ...baseReq,
  ergo_weight: 0.2,
  recoil_weight: 0.8,
  price_weight: 0.1,
});

assert.equal(keyWeight1, keyWeight2, 'Ideal point cache key must be invariant under weight adjustments');

// MUST invalidate when feasibility, market, or physical parameters change
const keyConstraintChange = computeIdealPointCacheKey('en', 'regular', {
  ...baseReq,
  min_ergonomics: 45, // changed constraint
});
assert.notEqual(keyWeight1, keyConstraintChange, 'Must invalidate when min_ergonomics changes');

const keyLockChange = computeIdealPointCacheKey('en', 'regular', {
  ...baseReq,
  include_items: ['partA'], // changed locks
});
assert.notEqual(keyWeight1, keyLockChange, 'Must invalidate when include_items changes');

const keyTraderChange = computeIdealPointCacheKey('en', 'regular', {
  ...baseReq,
  trader_levels: { prapor: 3, skier: 3 }, // changed trader
});
assert.notEqual(keyWeight1, keyTraderChange, 'Must invalidate when trader_levels changes');

const keyTrueErgoChange = computeIdealPointCacheKey('en', 'regular', {
  ...baseReq,
  use_true_ergo: false, // changed objective axis
});
assert.notEqual(keyWeight1, keyTrueErgoChange, 'Must invalidate when use_true_ergo changes');

// 4. Exact solve cache key:
// MUST differentiate when preference weights change (unlike endpoints)
const solveKey1 = computeExactSolveCacheKey('en', 'regular', baseReq);
const solveKey2 = computeExactSolveCacheKey('en', 'regular', {
  ...baseReq,
  ergo_weight: 0.2, // changed weight
});
assert.notEqual(solveKey1, solveKey2, 'Exact solve key must differentiate when weights change');

// But must be identical when array order or case in trader levels differs
const solveKeyCanonical = computeExactSolveCacheKey('en', 'regular', {
  ...baseReq,
  include_items: ['partA', 'partB'], // different order
  trader_levels: { SKIER: 3, Prapor: 4 }, // different case/order
});
assert.equal(solveKey1, solveKeyCanonical, 'Exact solve key must be canonically identical across orderings');

// 5. Structural bounds cache key:
// Only depends on weapon_id and max_weight
const sbKey1 = computeStructuralBoundsCacheKey('en', 'regular', 'm4a1', 5.0);
const sbKey2 = computeStructuralBoundsCacheKey('en', 'regular', 'm4a1', 5.0);
assert.equal(sbKey1, sbKey2);
const sbKeyDiffWeight = computeStructuralBoundsCacheKey('en', 'regular', 'm4a1', 6.0);
assert.notEqual(sbKey1, sbKeyDiffWeight);
const sbKeyNoWeight = computeStructuralBoundsCacheKey('en', 'regular', 'm4a1', null);
assert.notEqual(sbKey1, sbKeyNoWeight);

console.log('reuseKey TDD test suite passed!');
