// The request domain of the UI (src/api/requestDomain.ts; ADR 0013 section 5, Phase 2.8): the MOA floor request carries every field of the Optimize
// domain except the MOA cap it searches (not just the weapon id), unset constraints stay unset (never 0), Optimize and Explore are built on the same
// domain, and the floor request reaches the solver intact (the witness scope of the real runtime shows it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MOAFloorResponse } from '../../src/api/client';
import {
  domainRequestOf, exploreRequestOf, floorRequestKey, floorRequestOf, optimizeRequestOf,
} from '../../src/api/requestDomain';
import type { RequestDomainState } from '../../src/api/requestDomain';
import type { LoadedState } from '../../src/solver/dataService';
import { epochNow } from '../../src/solver/requestGuard';
import { DEFAULT_TRADER_LEVELS } from '../../src/solver/types';
import type { ItemLookup } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gunWith, lookupOf, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

const DEFAULT: RequestDomainState = {
  weaponId: 'gun-1', useBudget: false, maxPrice: 200000, minErgo: 0, useMinMag: false, minMagCapacity: 0, useTrueErgo: false, preventOverswing: false,
  equipErgoPenalty: 0, includedModIds: [], excludedModIds: [], includedCategories: [], excludedCategories: [],
  traderLevels: { ...DEFAULT_TRADER_LEVELS }, playerLevel: 60, fleaAvailable: true, barterAvailable: false, barterExcludeDogtags: true,
};

const FULL: RequestDomainState = {
  weaponId: 'gun-1', useBudget: true, maxPrice: 250000, minErgo: 45, useMinMag: true, minMagCapacity: 30, useTrueErgo: true, preventOverswing: true,
  equipErgoPenalty: -15, includedModIds: ['m1', 'm2'], excludedModIds: ['m3'], includedCategories: ['cat-a', 'cat-b'], excludedCategories: ['cat-c'],
  traderLevels: { ...DEFAULT_TRADER_LEVELS, prapor: 2, ref: 0 }, playerLevel: 42, fleaAvailable: false, barterAvailable: true, barterExcludeDogtags: false,
};

const NOT_IN_A_FLOOR_REQUEST = ['max_moa', 'ergo_weight', 'recoil_weight', 'price_weight', 'use_tchebycheff', 'precise_mode', 'owned_items'];

test('the floor request carries every domain field with its value, and nothing about the cap, the objective or the precision', () => {
  const request = floorRequestOf(FULL);
  assert.deepEqual(request, {
    weapon_id: 'gun-1',
    use_true_ergo: true,
    max_price: 250000,
    min_ergonomics: 45,
    min_mag_capacity: 30,
    prevent_overswing: true,
    equip_ergo_modifier: -0.15,
    include_items: ['m1', 'm2'],
    exclude_items: ['m3'],
    include_categories: [['cat-a'], ['cat-b']],
    exclude_categories: ['cat-c'],
    trader_levels: { ...DEFAULT_TRADER_LEVELS, prapor: 2, ref: 0 },
    player_level: 42,
    flea_available: false,
    barter_available: true,
    barter_exclude_dogtags: false,
  });
  for (const key of NOT_IN_A_FLOOR_REQUEST) assert.equal(key in request, false, `${key} is not part of a floor request`);
});

test('unset constraints are undefined, never 0: the floor asks the same question as an Optimize with every control off', () => {
  const request = floorRequestOf(DEFAULT);
  assert.equal(request.weapon_id, 'gun-1');
  for (const key of ['use_true_ergo', 'max_price', 'min_ergonomics', 'min_mag_capacity', 'prevent_overswing', 'equip_ergo_modifier', 'include_items', 'exclude_items', 'include_categories', 'exclude_categories'] as const) {
    assert.equal(request[key], undefined, key);
  }
  assert.equal(request.flea_available, true);
  assert.equal(request.barter_available, false);
  assert.equal(request.player_level, 60);
  assert.deepEqual(request.trader_levels, DEFAULT_TRADER_LEVELS);
});

test('the equipment ergonomics modifier applies only with TrueErgo or Prevent Overswing, as a fraction', () => {
  assert.equal(floorRequestOf({ ...DEFAULT, equipErgoPenalty: -20 }).equip_ergo_modifier, undefined);
  assert.equal(floorRequestOf({ ...DEFAULT, equipErgoPenalty: -20, useTrueErgo: true }).equip_ergo_modifier, -0.2);
  assert.equal(floorRequestOf({ ...DEFAULT, equipErgoPenalty: -20, preventOverswing: true }).equip_ergo_modifier, -0.2);
  assert.equal(floorRequestOf({ ...DEFAULT, equipErgoPenalty: 0, preventOverswing: true }).equip_ergo_modifier, 0, 'a real 0% modifier is sent, not dropped');
});

test('the floor request is the domain of Optimize and Explore: the same fields with the same values', () => {
  const floor = floorRequestOf(FULL);
  assert.deepEqual(domainRequestOf(FULL), floor);
  const optimize = optimizeRequestOf(FULL, { ergoWeight: 33, recoilWeight: 34, priceWeight: 33, useTchebycheff: true, maxMoa: 1.5, precision: 'auto' });
  for (const [key, value] of Object.entries(floor)) assert.deepEqual((optimize as unknown as Record<string, unknown>)[key], value, key);
  assert.deepEqual([optimize.ergo_weight, optimize.recoil_weight, optimize.price_weight, optimize.use_tchebycheff, optimize.max_moa, optimize.precise_mode], [33, 34, 33, true, 1.5, 'auto']);
  const noCap = optimizeRequestOf(DEFAULT, { ergoWeight: 1, recoilWeight: 1, priceWeight: 1, useTchebycheff: false, maxMoa: null, precision: 'fast' });
  assert.equal(noCap.max_moa, undefined, 'no cap is undefined, never 0');
  assert.equal(noCap.use_tchebycheff, undefined);
  const explore = exploreRequestOf(FULL, { ignore: 'price', steps: 12, maxMoa: null, precision: 'precise', axisLimit: null });
  for (const [key, value] of Object.entries(floor)) assert.deepEqual((explore as unknown as Record<string, unknown>)[key], value, key);
  assert.deepEqual([explore.ignore, explore.steps, explore.precise_mode], ['price', 12, 'precise']);
});

test('allow_repeated_parts (Advanced menu, Fast only): carried by Optimize and Explore, never by the floor domain; off is undefined, never false', () => {
  const x = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0, useTchebycheff: false, maxMoa: null, precision: 'fast' as const };
  assert.equal(optimizeRequestOf(DEFAULT, x).allow_repeated_parts, undefined, 'off is the default and is not sent');
  assert.equal(optimizeRequestOf(DEFAULT, { ...x, allowRepeatedParts: false }).allow_repeated_parts, undefined);
  assert.equal(optimizeRequestOf(DEFAULT, { ...x, allowRepeatedParts: true }).allow_repeated_parts, true);
  const e = { ignore: 'price' as const, steps: 10, maxMoa: null, precision: 'fast' as const, axisLimit: null };
  assert.equal(exploreRequestOf(DEFAULT, e).allow_repeated_parts, undefined);
  assert.equal(exploreRequestOf(DEFAULT, { ...e, allowRepeatedParts: false }).allow_repeated_parts, undefined);
  assert.equal(exploreRequestOf(DEFAULT, { ...e, allowRepeatedParts: true }).allow_repeated_parts, true);
  // Neither the domain nor the floor request has the field, so toggling it never asks the floor again.
  assert.ok(!('allow_repeated_parts' in domainRequestOf(FULL)));
  assert.ok(!('allow_repeated_parts' in floorRequestOf(FULL)));
  // Nothing else of the Optimize or Explore request changes with the option.
  const without = (r: object): object => Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'allow_repeated_parts'));
  assert.deepEqual(without(optimizeRequestOf(FULL, { ...x, allowRepeatedParts: true })), without(optimizeRequestOf(FULL, x)));
  assert.deepEqual(without(exploreRequestOf(FULL, { ...e, allowRepeatedParts: true })), without(exploreRequestOf(FULL, e)));
});

test('the Explore axis limit lands on the swept axis; a control already set on that axis wins; a zero or absent limit sets nothing', () => {
  const x = { steps: 10, maxMoa: null, precision: 'auto' as const };
  const price = exploreRequestOf(DEFAULT, { ...x, ignore: 'price', axisLimit: 90000 });
  assert.deepEqual([price.max_price, price.min_ergonomics, price.max_recoil_v], [90000, undefined, undefined]);
  const ergo = exploreRequestOf(DEFAULT, { ...x, ignore: 'ergo', axisLimit: 40 });
  assert.deepEqual([ergo.max_price, ergo.min_ergonomics, ergo.max_recoil_v], [undefined, 40, undefined]);
  const recoil = exploreRequestOf(DEFAULT, { ...x, ignore: 'recoil', axisLimit: 55 });
  assert.deepEqual([recoil.max_price, recoil.min_ergonomics, recoil.max_recoil_v], [undefined, undefined, 55]);
  const budgetWins = exploreRequestOf({ ...DEFAULT, useBudget: true, maxPrice: 120000 }, { ...x, ignore: 'price', axisLimit: 90000 });
  assert.equal(budgetWins.max_price, 120000);
  const ergoControlWins = exploreRequestOf({ ...DEFAULT, minErgo: 50 }, { ...x, ignore: 'ergo', axisLimit: 40 });
  assert.equal(ergoControlWins.min_ergonomics, 50);
  for (const axisLimit of [0, null, -5]) {
    const r = exploreRequestOf(DEFAULT, { ...x, ignore: 'price', axisLimit });
    assert.deepEqual([r.max_price, r.min_ergonomics, r.max_recoil_v], [undefined, undefined, undefined]);
  }
  assert.equal(exploreRequestOf(DEFAULT, { ...x, ignore: 'price', axisLimit: null, maxMoa: 2 }).max_moa, 2);
});

test('the floor is asked again when ANY domain field changes, and not otherwise', () => {
  const key = (s: RequestDomainState, mode = 'regular', lang = 'en') => floorRequestKey(floorRequestOf(s), mode, lang);
  const base = key(DEFAULT);
  assert.equal(key({ ...DEFAULT }), base, 'an identical domain is the same question');
  const changes: Partial<RequestDomainState>[] = [
    { weaponId: 'gun-2' }, { useBudget: true }, { useBudget: true, maxPrice: 1 }, { minErgo: 10 }, { useMinMag: true, minMagCapacity: 20 }, { useTrueErgo: true },
    { preventOverswing: true }, { useTrueErgo: true, equipErgoPenalty: -10 }, { includedModIds: ['m'] }, { excludedModIds: ['m'] }, { includedCategories: ['c'] },
    { excludedCategories: ['c'] }, { traderLevels: { ...DEFAULT_TRADER_LEVELS, skier: 1 } }, { playerLevel: 30 }, { fleaAvailable: false }, { barterAvailable: true },
    { barterExcludeDogtags: false },
  ];
  for (const change of changes) assert.notEqual(key({ ...DEFAULT, ...change }), base, JSON.stringify(change));
  assert.notEqual(key(DEFAULT, 'pve'), base, 'the game mode');
  assert.notEqual(key(DEFAULT, 'regular', 'zh'), base, 'the language');
  // A change that does not reach the request (the budget amount while the budget is off) is not a new question.
  assert.equal(key({ ...DEFAULT, maxPrice: 5 }), base);
});

// ---------------------------------------------------------------------------------------------------------------------------
// The floor request reaches the solver intact
// ---------------------------------------------------------------------------------------------------------------------------

/** A required barrel slot (replacement by 4.297, 1.074 or 0.537 MOA), an optional scope: the best barrel costs 500, the scope 300. */
const floorLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { coi: 0.0625, slots: [slot('barrel', ['b_wide', 'b_mid', 'b_best'], true), slot('optic', ['scope'])] }),
  ['b_wide', modWith('b_wide', { coi: 0.125 })],
  ['b_mid', modWith('b_mid', { coi: 0.03125 })],
  ['b_best', modWith('b_best', { coi: 0.015625, offers: [trader('prapor', 1, 500)] })],
  ['scope', modWith('scope', { accuracy: 10, offers: [trader('prapor', 1, 300)] })],
);

test('through the real runtime, the floor request built from the UI state is what the floor witness is found under: budget, markets, levels, filters', async () => {
  const posted: WorkerOutMessage[] = [];
  const state: LoadedState = { guns: [], mods: [], itemLookup: floorLookup(), loadedAt: 0, generation: 1 };
  const runtime = createWorkerRuntime({ post: m => { posted.push(structuredClone(m)); }, loadData: async () => state });
  const ui: RequestDomainState = {
    ...DEFAULT, weaponId: WEAPON, useBudget: true, maxPrice: 5100, excludedModIds: ['b_best'], traderLevels: { ...DEFAULT_TRADER_LEVELS, prapor: 1 }, playerLevel: 15,
    fleaAvailable: false, barterAvailable: false,
  };
  runtime.receive({ type: 'computeMOAFloor', id: 1, payload: { request: floorRequestOf(ui), lang: 'en', gameMode: 'regular', deadline: epochNow() + 120_000 } });
  await runtime.idle();
  const message = posted.find(m => m.id === 1 && m.type !== 'snapshot');
  assert.equal(message?.type, 'result');
  const floor = message?.payload as MOAFloorResponse;
  assert.equal(floor.status, 'model_proved', JSON.stringify(floor));
  const scope = floor.witness?.scope;
  assert.equal(scope?.feasibility.max_price, 5100, 'the budget is a hard constraint of the floor');
  assert.deepEqual(scope?.feasibility.exclude_items, ['b_best']);
  assert.equal(scope?.acquisition.flea_available, false);
  assert.equal(scope?.acquisition.player_level, 15);
  assert.equal(scope?.acquisition.trader_levels?.prapor, 1);
  // The excluded best barrel and the budget change the minimum: it is not the floor of the weapon alone.
  assert.ok(!floor.witness?.selected_item_ids.includes('b_best'));
});
