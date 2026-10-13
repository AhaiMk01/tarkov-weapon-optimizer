// A typed native failure during a MOA floor seed or trial (src/solver/moaFloor.ts, ADR 0013 section 6, Phase 2.7 integration): the floor retains the best
// verified witness and the proved lo. The same `SolverError` is rethrown (never a normal result, never an interrupt reason) with the retained floor state on
// its completion metadata, after the state was published as a snapshot. Injected queries; no native build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MOAFloorResponse, WitnessBuild } from '../../src/api/client';
import { retainedFloorOf, runMoaFloor, runMoaFloorDetailed } from '../../src/solver/moaFloor';
import type { FloorNativeStop, FloorQuery, FloorQueryResult, FloorWitness, MoaFloorRequest } from '../../src/solver/moaFloor';
import { SolverError } from '../../src/solver/native/errors';
import { ratFromDouble, ratString } from '../../src/solver/physical/exact';
import { PUBLIC_REASONS } from '../../src/solver/physical/reasons';
import { completionOf } from '../../src/solver/runtimeErrors';
import type { RuntimeGuard } from '../../src/solver/runtimeGuard';
import { gunWith, lookupOf, WEAPON } from '../physical/lpFixtures';

const request = (): MoaFloorRequest => ({
  weaponId: WEAPON,
  itemLookup: lookupOf(gunWith(WEAPON, {})),
  compatibilityMap: { reachable_items: {}, slot_items: {}, item_to_slots: {}, slot_owner: {} },
});

const guard = (): RuntimeGuard => ({ deadline: 1_000_000, now: () => 0, cancelled: () => false, yieldMacrotask: async () => undefined });

const witnessBuild = (moa: number): WitnessBuild => ({
  achieved_moa: moa,
  base: { kind: 'naked' },
  selected_items: [],
  selected_item_ids: [],
  slot_pairs: [],
  scope: {
    weapon_id: WEAPON, precision_resolved: 'precise', model_qualification: 'exact', moa_qualification: 'provisional_model', max_moa: null,
    acquisition: { trader_levels: null, flea_available: true, barter_available: false, barter_exclude_dogtags: false, player_level: null },
    feasibility: {
      max_price: null, min_ergonomics: null, max_recoil_v: null, max_recoil_sum: null, min_mag_capacity: null, min_sighting_range: null, max_weight: null,
      include_items: null, exclude_items: null, include_categories: null, exclude_categories: null, prevent_overswing: false, equip_ergo_modifier: null,
    },
    inventory: { owned_items: [] },
  },
});

const witnessAt = (moa: number, nativeStop: FloorNativeStop = 'optimal'): FloorQueryResult => {
  const w: FloorWitness = { moaExact: ratString(ratFromDouble(moa)), achievedMoa: moa, build: witnessBuild(moa), nativeStop };
  return { kind: 'witness', witness: w };
};
const EMPTY: FloorQueryResult = { kind: 'empty', qualified: true, reason: PUBLIC_REASONS.provisionalMoaModelInfeasible };

const nativeFailure = (): SolverError => new SolverError('solve', new Error('wasm trap'));

/** A query that plays a script by call order; a function entry runs (and may throw). */
function scripted(items: (FloorQueryResult | (() => FloorQueryResult))[]): { query: FloorQuery; caps: (number | null)[] } {
  const caps: (number | null)[] = [];
  return {
    caps,
    query: async cap => {
      caps.push(cap);
      const item = items[caps.length - 1];
      if (item === undefined) throw new Error('unexpected extra query');
      return typeof item === 'function' ? item() : item;
    },
  };
}

const failing = (failure: Error): (() => never) => () => { throw failure; };

test('a failure after one verified witness rethrows the same SolverError with the retained floor state, published before the throw', async () => {
  const failure = nativeFailure();
  // Seed 4.0 (hi), then a discovery trial at 2.0 yields a witness at 1.5, then the next trial fails natively.
  const { query, caps } = scripted([witnessAt(4), witnessAt(1.5), failing(failure)]);
  const events: string[] = [];
  const published: MOAFloorResponse[] = [];
  const outcome = await runMoaFloor(request(), guard(), {
    query,
    publishSnapshot: snapshot => { events.push('published'); published.push(snapshot); },
  }).then(() => 'resolved', (error: unknown) => { events.push('thrown'); return error; });

  assert.equal(outcome, failure, 'the very error, not a result and not a wrapper');
  assert.deepEqual(events, ['published', 'thrown'], 'the state is published first');
  assert.equal(caps.length, 3);
  const retained = retainedFloorOf(failure);
  assert.ok(retained !== null);
  assert.equal(retained.status, 'model_witnessed');
  assert.equal(retained.moa_qualification, 'provisional_model');
  assert.equal(retained.floor, 1.5, 'the best witness so far');
  assert.equal(retained.display_floor, 1.5);
  assert.equal(retained.proved_lower_bound, null);
  assert.equal(retained.witness?.achieved_moa, 1.5);
  assert.equal(retained.reason, undefined, 'the typed error is the cause; no interrupt reason is invented');
  assert.deepEqual(published, [retained], 'the published snapshot is the one the error carries');
  const completion = completionOf(failure);
  assert.ok(completion !== null);
  assert.equal(completion.witness, true);
  assert.equal(completion.termination, 'limit');
});

test('the proved lo is retained too: a qualified emptiness before the failure travels in the snapshot', async () => {
  const failure = nativeFailure();
  // Seed 4.0; discovery at 3.0 (d = 2 -> 2.0)... d = max(1, 4/2) = 2, so the first probe is 2.0: qualified empty sets lo = 2.0; bisection probes 3.0: fails.
  const { query, caps } = scripted([witnessAt(4), EMPTY, failing(failure)]);
  const run = runMoaFloorDetailed(request(), guard(), { query });
  await assert.rejects(run, (error: unknown) => error === failure);
  assert.deepEqual(caps, [null, 2, 3]);
  const retained = retainedFloorOf(failure);
  assert.ok(retained !== null);
  assert.equal(retained.status, 'model_witnessed');
  assert.equal(retained.floor, 4);
  assert.equal(retained.proved_lower_bound, 2, 'lo is what a qualified Precise emptiness established');
  assert.ok(retained.witness !== undefined);
});

test('a failure of the seed retains nothing: unresolved, no witness, no bounds', async () => {
  const failure = nativeFailure();
  const published: MOAFloorResponse[] = [];
  await assert.rejects(
    runMoaFloor(request(), guard(), { query: scripted([failing(failure)]).query, publishSnapshot: s => published.push(s) }),
    (error: unknown) => error === failure,
  );
  const retained = retainedFloorOf(failure);
  assert.ok(retained !== null);
  assert.equal(retained.status, 'unresolved');
  assert.equal(retained.floor, null);
  assert.equal(retained.display_floor, null);
  assert.equal(retained.proved_lower_bound, null);
  assert.equal(retained.witness, undefined);
  assert.equal(retained.moa_qualification, 'provisional_model');
  assert.deepEqual(published, [retained]);
  assert.equal(completionOf(failure)?.witness, false);
});

test('the retained state extends what the failing search captured: its node count and bounds stay, the floor is added', async () => {
  const failure = nativeFailure();
  const searchCompletion = { nodes: 2, termination: 'limit' as const, witness: true, lower_bound: -3, upper_bound: null, absolute_gap: null };
  const { attachCompletion } = await import('../../src/solver/runtimeErrors');
  attachCompletion(failure, searchCompletion);
  await assert.rejects(
    runMoaFloor(request(), guard(), { query: scripted([witnessAt(2), failing(failure)]).query }),
    (error: unknown) => error === failure,
  );
  const completion = completionOf(failure);
  assert.ok(completion !== null);
  assert.equal(completion.nodes, 2);
  assert.equal(completion.lower_bound, -3);
  assert.equal(completion.witness, true);
  assert.equal(retainedFloorOf(failure)?.floor, 2);
});

test('an error that is not a typed native failure is not wrapped, retained or published', async () => {
  const bug = new RangeError('programming error');
  const published: MOAFloorResponse[] = [];
  await assert.rejects(
    runMoaFloor(request(), guard(), { query: scripted([witnessAt(2), failing(bug)]).query, publishSnapshot: s => published.push(s) }),
    (error: unknown) => error === bug,
  );
  assert.equal(retainedFloorOf(bug), null);
  assert.deepEqual(published, []);
});

test('a publisher that throws cannot replace the typed failure', async () => {
  const failure = nativeFailure();
  await assert.rejects(
    runMoaFloor(request(), guard(), { query: scripted([witnessAt(2), failing(failure)]).query, publishSnapshot: () => { throw new Error('port closed'); } }),
    (error: unknown) => error === failure,
  );
  assert.equal(retainedFloorOf(failure)?.floor, 2);
});

test('a stop that is not a native failure still resolves as before: a limit keeps the witness as model_witnessed with its reason', async () => {
  const { query } = scripted([witnessAt(4), { kind: 'stopped', reason: PUBLIC_REASONS.timeLimitReached }]);
  const r = await runMoaFloor(request(), guard(), { query });
  assert.equal(r.status, 'model_witnessed');
  assert.equal(r.reason, PUBLIC_REASONS.timeLimitReached);
});
