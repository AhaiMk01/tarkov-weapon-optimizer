// The owned receiver (owner decision 2026-10-14, docs/adr/amendments/2026-10-14-owned-base-fallback.md) through the worker runtime, on a PKP-shaped
// fixture: the receiver has no offer, its three presets have none either (as the PKP in the pinned capture: no trader, no barter, no flea), so nothing can
// be bought as a base. Every operation then builds on the player's own receiver at price 0, marked `acquisition: { source: 'owned' }`, and the spend is
// the parts only: Optimize (Precise and Fast), the Gunsmith request shape, Explore and the MOA floor. A preset that can be bought turns it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExploreResponse, MOAFloorResponse, OptimizeResponse, PresetDetail } from '../../src/api/client';
import type { LoadedState } from '../../src/solver/dataService';
import { epochNow } from '../../src/solver/requestGuard';
import type { ItemLookup } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerInMessage, WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gunWith, lookupOf, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

/**
 * PKP-shaped: no receiver offer, three presets with no offer. A required barrel (two choices), an optional grip, an optional scope. Parts are sold by
 * Prapor. `buyablePreset` adds a fourth preset that Skier sells, which makes the naked receiver inaccessible instead of owned.
 */
const pkpLookup = (buyablePreset = false): ItemLookup => lookupOf(
  gunWith(WEAPON, {
    offers: [], weight: 7.5, ergo: 30, recoilV: 120, recoilH: 300, coi: 0.0625,
    slots: [slot('barrel', ['b_long', 'b_short'], true), slot('grip', ['g1', 'g2']), slot('optic', ['scope'])],
    presets: [
      { id: 'pkp_default', items: [{ itemId: 'b_long', count: 1 }], offers: [] },
      { id: 'pkp_short', items: [{ itemId: 'b_short', count: 1 }], offers: [] },
      { id: 'pkp_scoped', items: [{ itemId: 'b_long', count: 1 }, { itemId: 'scope', count: 1 }], offers: [] },
      ...(buyablePreset ? [{ id: 'pkp_sold', items: [{ itemId: 'b_long', count: 1 }], offers: [trader('skier', 1, 90000)] }] : []),
    ],
  }),
  ['b_long', modWith('b_long', { ergo: -2, recoil: -0.05, weight: 1.2, coi: 0.03125, offers: [trader('prapor', 1, 4000)] })],
  ['b_short', modWith('b_short', { ergo: 4, recoil: 0.03, weight: 0.8, coi: 0.125, offers: [trader('prapor', 1, 3000)] })],
  ['g1', modWith('g1', { ergo: 6, recoil: -0.02, weight: 0.1, offers: [trader('prapor', 1, 1500)] })],
  ['g2', modWith('g2', { ergo: 9, recoil: -0.01, weight: 0.15, offers: [trader('prapor', 1, 6000)] })],
  ['scope', modWith('scope', { ergo: -1, accuracy: 10, weight: 0.4, offers: [trader('prapor', 1, 9000)] })],
);

let generation = 500;
const stateOf = (itemLookup: ItemLookup): LoadedState => ({ guns: [], mods: [], itemLookup, loadedAt: 0, generation: ++generation });

/** Runs one message through a fresh runtime and returns its terminal payload. */
async function run<T>(lookup: ItemLookup, message: WorkerInMessage): Promise<T> {
  const posted: WorkerOutMessage[] = [];
  const state = stateOf(lookup);
  const runtime = createWorkerRuntime({ post: m => { posted.push(m); }, loadData: async () => state });
  runtime.receive(message);
  await runtime.idle();
  const terminal = posted.filter(p => p.id === message.id && p.type !== 'snapshot');
  assert.equal(terminal.length, 1, terminal.map(m => m.type).join(','));
  assert.notEqual(terminal[0].type, 'error', JSON.stringify(terminal[0].payload));
  return terminal[0].payload as T;
}

const optimizeMsg = (request: Record<string, unknown>): WorkerInMessage => ({
  type: 'optimize', id: 1, payload: { request: { weapon_id: WEAPON, ergo_weight: 1, recoil_weight: 1, price_weight: 0, ...request } as never, lang: 'en', gameMode: 'regular' },
});
const exploreMsg = (request: Record<string, unknown>): WorkerInMessage => ({
  type: 'explore', id: 2, payload: { request: { weapon_id: WEAPON, ignore: 'price', steps: 4, precise_mode: 'precise', ...request } as never, lang: 'en', gameMode: 'regular', deadline: epochNow() + 120_000 },
});
const floorMsg = (request: Record<string, unknown>): WorkerInMessage => ({
  type: 'computeMOAFloor', id: 3, payload: { request: { weapon_id: WEAPON, ...request } as never, lang: 'en', gameMode: 'regular', deadline: epochNow() + 120_000 },
});

/** The base of a build is the owned naked receiver: price 0, no seller, and the parts alone make the spend. */
function assertOwnedBase(label: string, base: PresetDetail | undefined, items: OptimizeResponse['selected_items'], total: number | undefined): void {
  assert.ok(base, `${label}: a base`);
  assert.equal(base.id, WEAPON, `${label}: the naked receiver, never a preset`);
  assert.deepEqual(base.acquisition, { source: 'owned' }, label);
  assert.equal(base.price, 0, label);
  assert.equal(base.source, undefined, `${label}: no seller`);
  assert.deepEqual(base.items, [], `${label}: no preset stock`);
  if (total !== undefined) assert.equal(total, items.reduce((sum, item) => sum + item.price, 0), `${label}: the spend is the parts only`);
  assert.ok(items.every(item => item.acquisition?.source !== 'preset'), `${label}: nothing comes from a preset`);
}

test('Optimize Precise and Fast on a gun nobody sells: certified (Precise) builds on the owned receiver at price 0', async () => {
  for (const precise_mode of ['precise', 'fast'] as const) {
    const r = await run<OptimizeResponse>(pkpLookup(), optimizeMsg({ precise_mode, flea_available: true, barter_available: true }));
    assert.equal(r.status, 'optimal', `${precise_mode}: ${r.reason ?? ''}`);
    if (precise_mode === 'precise') assert.equal(r.physical_certificate, 'certified_optimal');
    assertOwnedBase(precise_mode, r.selected_preset, r.selected_items, r.final_stats?.total_price);
  }
});

test('the Gunsmith request shape (Precise, weights 1 / 1 / 0.5, task caps) on a gun nobody sells is a certified build on the owned receiver', async () => {
  const r = await run<OptimizeResponse>(pkpLookup(), optimizeMsg({
    precise_mode: true, ergo_weight: 1, recoil_weight: 1, price_weight: 0.5, min_ergonomics: 35, max_recoil_sum: 400, flea_available: true, barter_available: false,
  }));
  assert.equal(r.status, 'optimal', r.reason);
  assert.equal(r.physical_certificate, 'certified_optimal');
  assertOwnedBase('gunsmith', r.selected_preset, r.selected_items, r.final_stats?.total_price);
  assert.ok(r.final_stats!.ergonomics >= 35);
  assert.ok(r.final_stats!.recoil_vertical + r.final_stats!.recoil_horizontal <= 400 + 1e-9);
});

test('Explore and the MOA floor on a gun nobody sells use the owned receiver too', async () => {
  const sweep = await run<ExploreResponse>(pkpLookup(), exploreMsg({}));
  assert.ok(sweep.points.length > 0, JSON.stringify(sweep.step_outcomes));
  for (const point of sweep.points) assertOwnedBase('explore point', point.selected_preset, point.selected_items, undefined);
  const floor = await run<MOAFloorResponse>(pkpLookup(), floorMsg({}));
  assert.equal(floor.status, 'model_proved', JSON.stringify(floor));
  assert.deepEqual(floor.witness!.base, { kind: 'naked' });
  assertOwnedBase('floor witness', floor.witness!.selected_preset, floor.witness!.selected_items, undefined);
});

test('a preset that can be bought turns the owned receiver off: the build is made on that preset at its price', async () => {
  const r = await run<OptimizeResponse>(pkpLookup(true), optimizeMsg({ precise_mode: 'precise', flea_available: true }));
  assert.equal(r.status, 'optimal', r.reason);
  assert.equal(r.selected_preset?.id, 'pkp_sold');
  assert.deepEqual(r.selected_preset?.acquisition, { source: 'offer' });
  assert.equal(r.selected_preset?.price, 90000);
  // With Skier disabled nothing can be bought again, so the receiver is owned.
  const locked = await run<OptimizeResponse>(pkpLookup(true), optimizeMsg({ precise_mode: 'precise', trader_levels: { skier: 0 } }));
  assertOwnedBase('skier disabled', locked.selected_preset, locked.selected_items, locked.final_stats?.total_price);
});
