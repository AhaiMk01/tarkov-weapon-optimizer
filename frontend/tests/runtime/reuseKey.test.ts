// Canonical request keys (src/solver/reuseKey.ts, ADR 0001) and the trader-name canonicalization the solver applies once at its entry: the same
// canonical domain gives the same key AND the same solve. Migrated from test_reuse_keys.ts and test_trader_case_domain.ts (Phase 2.9); the
// structural-bounds key went with the structural bounds (retired with the pre-cutover LP builder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OptimizeRequest } from '../../src/api/client';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { canonicalizeArray, canonicalizeTraderLevels, computeExactSolveCacheKey, computeIdealPointCacheKey } from '../../src/solver/reuseKey';
import { solve } from '../../src/solver/solver';
import type { SolveParams, TraderLevels } from '../../src/solver/types';
import { gun, lookupOf, mod, slot, trader, WEAPON } from '../physical/lpFixtures';

const levels = (raw: Record<string, number>): TraderLevels => raw as unknown as TraderLevels;

test('arrays are sorted and deduplicated; an empty or missing array is undefined', () => {
  assert.deepEqual(canonicalizeArray(['b', 'a', 'b', 'c']), ['a', 'b', 'c']);
  assert.equal(canonicalizeArray(undefined), undefined);
  assert.equal(canonicalizeArray([]), undefined);
});

test('trader names are trimmed and lowercased, keys sorted, and a repeated alias resolves deterministically: the last entry wins', () => {
  assert.deepEqual(
    canonicalizeTraderLevels(levels({ prapor: 4, SKIER: 3, mechanic: 2, peacekeeper: 4 })),
    canonicalizeTraderLevels(levels({ skier: 3, PRAPOR: 4, Peacekeeper: 4, mechanic: 2 })),
  );
  assert.equal(canonicalizeTraderLevels(undefined), undefined);
  assert.deepEqual(canonicalizeTraderLevels(levels({ ' Mechanic ': 0 })), { mechanic: 0 });
  assert.deepEqual(canonicalizeTraderLevels(levels({ mechanic: 0, Mechanic: 4 })), { mechanic: 4 });
  assert.deepEqual(canonicalizeTraderLevels(levels({ Mechanic: 4, mechanic: 0 })), { mechanic: 0 });
});

const BASE_REQUEST: OptimizeRequest = {
  weapon_id: 'm4a1', ergo_weight: 1, recoil_weight: 1, price_weight: 0.5, min_ergonomics: 40, max_price: 200000,
  include_items: ['partB', 'partA'], trader_levels: levels({ prapor: 4, skier: 3 }), flea_available: true, use_true_ergo: true, prevent_overswing: true,
};

test('the endpoint (payoff) key ignores the preference weights and changes with a constraint, a lock, a trader level or the objective axis', () => {
  const key = computeIdealPointCacheKey('en', 'regular', BASE_REQUEST);
  assert.equal(key, computeIdealPointCacheKey('en', 'regular', { ...BASE_REQUEST, ergo_weight: 0.2, recoil_weight: 0.8, price_weight: 0.1 }));
  for (const change of [
    { min_ergonomics: 45 }, { include_items: ['partA'] }, { trader_levels: levels({ prapor: 3, skier: 3 }) }, { use_true_ergo: false },
  ] as Partial<OptimizeRequest>[]) {
    assert.notEqual(computeIdealPointCacheKey('en', 'regular', { ...BASE_REQUEST, ...change }), key, JSON.stringify(change));
  }
});

test('the full-solve key follows the weights, and is the same for a reordered lock list and differently written trader names', () => {
  const key = computeExactSolveCacheKey('en', 'regular', BASE_REQUEST);
  assert.notEqual(computeExactSolveCacheKey('en', 'regular', { ...BASE_REQUEST, ergo_weight: 0.2 }), key);
  assert.equal(computeExactSolveCacheKey('en', 'regular', {
    ...BASE_REQUEST, include_items: ['partA', 'partB'], trader_levels: levels({ SKIER: 3, Prapor: 4 }),
  }), key);
});

// ---- the same canonical domain solves the same -------------------------------------------------------------------------------------------

/** Receiver and its only part sold by Mechanic alone: with Mechanic disabled there is no base, so the request is certified empty. */
function mechanicOnly(traderLevels: TraderLevels): SolveParams {
  const lookup = lookupOf(
    gun(WEAPON, { slots: [slot('choice', ['m1'], true)], offers: [trader('mechanic', 1, 1000)] }),
    ['m1', mod('m1', { ergo: 20, weight: 1, offers: [trader('mechanic', 1, 100)] })],
  );
  return {
    weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup),
    ergoWeight: 1, recoilWeight: 0, priceWeight: 0, fleaAvailable: false, preciseMode: true, traderLevels,
  };
}

test('Mechanic, mechanic and " Mechanic " are one trader in the solve as in the key; a repeated alias takes the last entry', async () => {
  const outcome = async (raw: Record<string, number>) => {
    const r = await solve(mechanicOnly(levels(raw)));
    return [r.status, r.physical_certificate, r.reason ?? null];
  };
  const disabled = await outcome({ mechanic: 0 });
  assert.deepEqual(disabled, ['infeasible', 'certified_infeasible', null], 'a disabled Mechanic leaves no base');
  assert.equal((await outcome({ mechanic: 1 }))[0], 'optimal');
  assert.deepEqual(await outcome({ Mechanic: 0 }), disabled);
  assert.deepEqual(await outcome({ ' Mechanic ': 0 }), disabled);
  assert.equal((await outcome({ mechanic: 0, Mechanic: 1 }))[0], 'optimal', 'last entry wins: Mechanic 1 unlocks');
  assert.deepEqual(await outcome({ Mechanic: 1, mechanic: 0 }), disabled, 'last entry wins: mechanic 0 disables');

  const keyOf = (raw: Record<string, number>) => computeIdealPointCacheKey('en', 'regular', { weapon_id: WEAPON, flea_available: false, trader_levels: levels(raw) });
  assert.equal(keyOf({ Mechanic: 0 }), keyOf({ mechanic: 0 }));
  assert.equal(keyOf({ ' Mechanic ': 0 }), keyOf({ mechanic: 0 }));
});
