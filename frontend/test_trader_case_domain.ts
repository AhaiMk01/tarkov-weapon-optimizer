import assert from 'node:assert/strict';
import { solve } from './src/solver/solver.ts';
import { choiceFixture } from './test_solver_fixtures.ts';
import { computeIdealPointCacheKey } from './src/solver/reuseKey.ts';
import { getAvailablePrice } from './src/solver/dataService.ts';
import type { ModStats } from './src/solver/types.ts';

console.log('Running trader case-sensitivity domain equivalence tests...');

// 1. Direct getAvailablePrice lookup equivalence
const mechanicStats: ModStats = {
  ergonomics: 10,
  recoil_modifier: -0.05,
  accuracy_modifier: 0,
  weight: 0.1,
  width: 1,
  height: 1,
  price: 5000,
  price_source: 'mechanic',
  purchasable: true,
  offers: [
    {
      price: 5000,
      source: 'mechanic',
      vendor_name: 'Mechanic',
      vendor_normalized: 'mechanic',
      trader_level: 1,
    },
  ],
};

const [priceLower, , purchasableLower] = getAvailablePrice(mechanicStats, { mechanic: 0 }, false, null, false, false);
const [priceUpper, , purchasableUpper] = getAvailablePrice(mechanicStats, { Mechanic: 0 }, false, null, false, false);
assert.equal(purchasableLower, false, 'mechanic: 0 must disable Mechanic');
assert.equal(purchasableUpper, false, 'Mechanic: 0 must also disable Mechanic (case-insensitive)');
assert.equal(priceLower, 0);
assert.equal(priceUpper, 0);

// 2. Solves with { Mechanic: 0 } and { mechanic: 0 } with flea disabled must yield IDENTICAL domains
// Fixture receiver is bought from Mechanic; choice M1 is from Mechanic.
// When Mechanic is unlocked (level 1): solve is optimal.
// When Mechanic is disabled (level 0): solve is not optimal (infeasible or incomplete with Purchase base is inaccessible).
const fixture = choiceFixture([{ id: 'M1', weight: 2, ergo: 20 }]);
fixture.itemLookup.M1.stats.offers = [{
  price: 100, source: 'mechanic', vendor_name: 'Mechanic', vendor_normalized: 'mechanic', trader_level: 1,
}];

const resUnlockedLower = await solve({
  ...fixture,
  fleaAvailable: false,
  traderLevels: { mechanic: 1 },
});
assert.equal(resUnlockedLower.status, 'optimal', 'Unlocked Mechanic must solve to optimal');

const resDisabledLower = await solve({
  ...fixture,
  fleaAvailable: false,
  traderLevels: { mechanic: 0 },
});
const resDisabledUpper = await solve({
  ...fixture,
  fleaAvailable: false,
  traderLevels: { Mechanic: 0 },
});

assert.notEqual(resDisabledLower.status, 'optimal', 'Disabled mechanic must not solve to optimal');
assert.notEqual(resDisabledUpper.status, 'optimal', 'Disabled Mechanic (capital M) must not solve to optimal');
assert.equal(resDisabledLower.status, resDisabledUpper.status, 'Lower and upper case disabled trader must produce identical solve status');
assert.equal(resDisabledLower.reason, resDisabledUpper.reason, 'Lower and upper case disabled trader must produce identical reason');

// 3. Cache key equality must match domain equivalence
const reqLower = {
  weapon_id: 'gun',
  flea_available: false,
  trader_levels: { mechanic: 0 },
};
const reqUpper = {
  weapon_id: 'gun',
  flea_available: false,
  trader_levels: { Mechanic: 0 },
};
assert.equal(
  computeIdealPointCacheKey('en', 'regular', reqLower),
  computeIdealPointCacheKey('en', 'regular', reqUpper),
  'Cache keys must match when solver domains match'
);

console.log('Trader case-sensitivity domain equivalence tests passed!');
