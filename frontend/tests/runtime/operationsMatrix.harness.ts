// The rig of the Stage 3 operations transition matrix (workstream 3.5, ADR 0013 sections 4D and 6): the REAL worker runtime (`createWorkerRuntime`)
// with the real solve, the real Explore and MOA floor drivers and the pinned native build, on small fixtures. The only seams are the ones a worker
// has anyway: the data load, the epoch clock, and the native solve of the shared pinned instance, which a test may wrap to report a native time
// limit, withhold a proof (a read warning), tamper with the primal (a point the validator rejects), throw a typed failure or deliver a cancel.
// Shared by operationsMatrix.test.ts; not a test file itself.
import assert from 'node:assert/strict';
import type { ExploreResponse, MOAFloorResponse, OptimizeResponse } from '../../src/api/client';
import type { LoadedState } from '../../src/solver/dataService';
import { getNativeHighs, MODEL_STATUS_NAMES } from '../../src/solver/native';
import type { HighsOptions, NativeResult, SolveExtras } from '../../src/solver/native';
import type { ItemLookup } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerDeps, WorkerRuntime } from '../../src/solver/workerRuntime';
import type { WorkerInMessage, WorkerOperation, WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gun, gunWith, lookupOf, mod, modWith, slot, trader, WEAPON } from '../physical/lpFixtures';

export { WEAPON };

/** The epoch the fake clock starts at; every stamped deadline is relative to it. */
export const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------------------------------

/** Two grips and two stocks: an ergonomics/recoil/price trade-off with a multi-step Explore sweep (the fixture of workerOperations.test.ts). */
export const sweepLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { weight: 1, ergo: 40, recoilV: 100, recoilH: 50, slots: [slot('grip', ['g1', 'g2']), slot('stock', ['s1', 's2'])] }),
  ['g1', modWith('g1', { ergo: 5, recoil: -0.02, weight: 0.2, offers: [trader('prapor', 1, 200)] })],
  ['g2', modWith('g2', { ergo: 10, recoil: -0.05, weight: 0.4, offers: [trader('prapor', 1, 800)] })],
  ['s1', modWith('s1', { ergo: 3, recoil: -0.1, weight: 0.5, offers: [trader('prapor', 1, 300)] })],
  ['s2', modWith('s2', { ergo: 12, recoil: 0, weight: 0.3, offers: [trader('prapor', 1, 1500)] })],
);

/** Receiver COI 1/16, a required barrel slot and an optional scope: a floor of best barrel + scope (the fixture of workerOperations.test.ts). */
export const floorLookup = (): ItemLookup => lookupOf(
  gunWith(WEAPON, { coi: 0.0625, slots: [slot('barrel', ['b_wide', 'b_mid', 'b_best'], true), slot('optic', ['scope']), slot('muzzle', ['sup'])] }),
  ['b_wide', modWith('b_wide', { coi: 0.125 })],
  ['b_mid', modWith('b_mid', { coi: 0.03125 })],
  ['b_best', modWith('b_best', { coi: 0.015625, offers: [trader('prapor', 1, 500)] })],
  ['scope', modWith('scope', { accuracy: 10, offers: [trader('prapor', 1, 300)] })],
  ['sup', modWith('sup', { accuracy: -5 })],
);

/**
 * Three exclusive choices of weight 1, 2 and 3 kg on a 1 kg receiver (the fixture of solveGuard.test.ts): a TrueErgo request splits its weight interval
 * at 3 kg, so its spatial search has more than one node and a stop between nodes keeps the first node's verified build.
 */
export const tedLookup = (): ItemLookup => lookupOf(
  gun(WEAPON, { weight: 1, slots: [slot('choice', ['a', 'b', 'c'], true)] }),
  ['a', mod('a', { weight: 1, ergo: 20 })], ['b', mod('b', { weight: 2, ergo: 30 })], ['c', mod('c', { weight: 3, ergo: 41 })],
);

// ---------------------------------------------------------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------------------------------------------------------

export type OpKind = 'optimize' | 'explore' | 'floor';

export interface Operation {
  name: string;
  kind: OpKind;
  /** The worker message type. */
  type: WorkerOperation;
  /** The fixture of a normal run. */
  lookup: () => ItemLookup;
  /** The request fields of a normal run (the weapon is added). */
  request: Record<string, unknown>;
  /** The resolved model runs a second opinion on a certificate-bearing verdict (Precise). */
  precise: boolean;
  /** The request echoes this `precision_request` (floor: none, the floor response has no precision fields). */
  precisionRequest: 'fast' | 'precise' | 'auto' | null;
}

export const OPTIMIZE_FAST: Operation = { name: 'Optimize Fast', kind: 'optimize', type: 'optimize', lookup: sweepLookup, request: { precise_mode: 'fast', ergo_weight: 1, recoil_weight: 1 }, precise: false, precisionRequest: 'fast' };
export const OPTIMIZE_PRECISE: Operation = { name: 'Optimize Precise', kind: 'optimize', type: 'optimize', lookup: sweepLookup, request: { precise_mode: 'precise', ergo_weight: 1, recoil_weight: 1 }, precise: true, precisionRequest: 'precise' };
/** Auto resolves Precise for every plain request (precisionMode.ts). */
export const OPTIMIZE_AUTO: Operation = { name: 'Optimize Auto', kind: 'optimize', type: 'optimize', lookup: sweepLookup, request: { precise_mode: 'auto', ergo_weight: 1, recoil_weight: 1 }, precise: true, precisionRequest: 'auto' };
/** The request App.handleGunsmithOptimize sends: Precise (the legacy boolean), weights 1 / 1 / 0.5, the task constraints and required items. */
export const GUNSMITH: Operation = {
  name: 'Gunsmith', kind: 'optimize', type: 'optimize', lookup: sweepLookup,
  request: { precise_mode: true, ergo_weight: 1, recoil_weight: 1, price_weight: 0.5, min_ergonomics: 45, max_weight: 3, include_items: ['g1'] },
  precise: true, precisionRequest: 'precise',
};
export const EXPLORE: Operation = { name: 'Explore', kind: 'explore', type: 'explore', lookup: sweepLookup, request: { ignore: 'price', precise_mode: 'precise' }, precise: true, precisionRequest: 'precise' };
export const FLOOR: Operation = { name: 'MOA floor', kind: 'floor', type: 'computeMOAFloor', lookup: floorLookup, request: {}, precise: true, precisionRequest: null };

export const OPTIMIZE_OPERATIONS: readonly Operation[] = [OPTIMIZE_FAST, OPTIMIZE_PRECISE, OPTIMIZE_AUTO, GUNSMITH];
export const SEARCH_OPERATIONS: readonly Operation[] = [...OPTIMIZE_OPERATIONS, EXPLORE, FLOOR];

export const METADATA_OPERATIONS: readonly WorkerOperation[] = ['loadData', 'getInfo', 'getWeaponMods', 'getGunsmithTasks', 'getStatus', 'clearCache'];

// ---------------------------------------------------------------------------------------------------------------------------
// The runtime rig
// ---------------------------------------------------------------------------------------------------------------------------

export interface Rig {
  runtime: WorkerRuntime;
  posted: WorkerOutMessage[];
  clock: { t: number };
  /** How many times the runtime loaded data. */
  loads: () => number;
  /** Runs `fn` inside the next data load (a stage boundary after dispatch, before any model work). */
  duringLoad(fn: () => void): void;
  send(message: WorkerInMessage): void;
  /** The one terminal message of a request (never a snapshot). */
  terminal(id: number): WorkerOutMessage;
  /** The terminal payload of a request, which must not be an error. */
  result<T>(id: number): T;
  snapshots(id: number): unknown[];
}

export function rig(lookup: ItemLookup, overrides: Partial<WorkerDeps> = {}): Rig {
  const posted: WorkerOutMessage[] = [];
  const clock = { t: T0 };
  const state: LoadedState = { guns: [], mods: [], itemLookup: lookup, loadedAt: 0, generation: 1 };
  let loads = 0;
  let hook: (() => void) | null = null;
  const runtime = createWorkerRuntime({
    post: m => { posted.push(m); },
    now: () => clock.t,
    loadData: async () => {
      loads++;
      const fn = hook;
      hook = null;
      fn?.();
      return state;
    },
    fetchTasks: async () => [{ task_name: 'Task', weapon_id: WEAPON, required_item_ids: [], constraints: {} }],
    ...overrides,
  });
  const terminal = (id: number): WorkerOutMessage => {
    const m = posted.filter(p => p.id === id && p.type !== 'snapshot');
    assert.equal(m.length, 1, `exactly one terminal message for ${id}, got ${m.map(x => x.type).join(',') || 'none'}`);
    return m[0];
  };
  return {
    runtime, posted, clock,
    loads: () => loads,
    duringLoad: fn => { hook = fn; },
    send: message => runtime.receive(message),
    terminal,
    result: <T>(id: number): T => {
      const m = terminal(id);
      assert.notEqual(m.type, 'error', `request ${id} failed: ${JSON.stringify(m.payload)}`);
      return m.payload as T;
    },
    snapshots: id => posted.filter(p => p.id === id && p.type === 'snapshot').map(p => p.payload),
  };
}

/** The message of an operation. `deadline`: a stamped epoch deadline, default T0 + 60 s (30 s for the floor). */
export function messageOf(op: Operation, id: number, extra: Record<string, unknown> = {}, deadline?: number): WorkerInMessage {
  const stamped = deadline ?? T0 + (op.kind === 'floor' ? 30_000 : 60_000);
  return { type: op.type, id, payload: { request: { weapon_id: WEAPON, ...op.request, ...extra } as never, lang: 'en', gameMode: 'regular', deadline: stamped } };
}

export const cancelOf = (targetId: number): WorkerInMessage => ({ type: 'cancel', id: 10_000 + targetId, payload: { targetId } });

export const metadataMessage = (type: WorkerOperation, id: number, extra: Record<string, unknown> = {}): WorkerInMessage =>
  ({ type, id, payload: { lang: 'en', gameMode: 'regular', weaponId: WEAPON, ...extra } } as WorkerInMessage);

// ---------------------------------------------------------------------------------------------------------------------------
// The native seam
// ---------------------------------------------------------------------------------------------------------------------------

export interface NativeCall {
  /** 0-based index of the call inside the wrapped section. */
  index: number;
  /** The `random_seed` option (Precise first / second / third opinion: 0, 11, 29), NaN when the call sets none (Fast). */
  seed: number;
  options: HighsOptions;
}

export type NativeHook = (call: NativeCall, real: () => Promise<NativeResult>) => Promise<NativeResult>;

/**
 * Runs `body` with every native solve of the shared pinned instance going through `hook` (the instance everything in the app uses, so the real runtime,
 * the real solve and the real drivers reach it unchanged). Restored afterwards. Test-only: production has no such seam.
 */
export async function withNative<T>(hook: NativeHook, body: () => Promise<T>): Promise<T> {
  const instance = getNativeHighs() as unknown as { solveStructured: (lp: string, options?: HighsOptions, extras?: SolveExtras) => Promise<NativeResult> };
  const original = instance.solveStructured;
  let index = 0;
  instance.solveStructured = (lp, options = {}, extras) => {
    const call: NativeCall = { index: index++, seed: Number(options.random_seed ?? Number.NaN), options };
    return hook(call, () => original.call(instance, lp, options, extras));
  };
  try {
    return await body();
  } finally {
    delete (instance as { solveStructured?: unknown }).solveStructured;
    assert.equal(instance.solveStructured, original, 'the prototype method is restored');
  }
}

const statusOf = (name: (typeof MODEL_STATUS_NAMES)[number]) => ({ code: MODEL_STATUS_NAMES.indexOf(name), name });

/** The real result reported as a native time limit (with its primal solution, if any): what a native call that reached its time allowance returns. */
export const asTimeLimit = (result: NativeResult, keepPrimal = true): NativeResult =>
  ({ ...result, modelStatus: statusOf('TimeLimit'), ...(keepPrimal ? {} : { colValues: null, objectiveValue: null }) }) as unknown as NativeResult;

/** The real result with a read warning: the parsed model may differ from the text, so the proof layer withholds every bound and verdict of it. */
export const withheld = (result: NativeResult): NativeResult => ({ ...result, readStatus: 'warning' }) as NativeResult;

/** The real result with every slot-edge column raised to at least 1: an integer point the decoder cannot place, so the validator rejects it (tests/physical/tamper.ts). */
export function overfilled(result: NativeResult): NativeResult {
  if (result.colValues === null || result.colNames === null) return result;
  const colValues = Float64Array.from(result.colValues);
  result.colNames.forEach((name, j) => {
    if (name.startsWith('e_')) colValues[j] = Math.max(1, Math.round(colValues[j]));
  });
  return { ...result, colValues };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Envelope assertions
// ---------------------------------------------------------------------------------------------------------------------------

export type AnyResponse = OptimizeResponse | ExploreResponse | MOAFloorResponse;

/** The pre-model envelope of an operation: nothing resolved, nothing searched, the reason (ADR 0013 section 5 and operationEnvelopes.ts). */
export function assertPreModelEnvelope(op: Operation, response: AnyResponse, reason: string, moaDependent = false): void {
  if (op.kind === 'optimize') {
    const r = response as OptimizeResponse;
    assert.equal(r.status, 'incomplete', op.name);
    assert.equal(r.physical_certificate, 'none', op.name);
    assert.equal(r.precision_request, op.precisionRequest, op.name);
    assert.equal(r.precision_resolved, null, op.name);
    assert.equal(r.model_qualification, null, op.name);
    assert.equal(r.moa_qualification, moaDependent ? 'provisional_model' : null, op.name);
    assert.deepEqual([r.selected_items, r.selected_item_ids, r.slot_pairs], [[], [], []], op.name);
    assert.equal(r.objective_value, null, op.name);
    assert.deepEqual({ ...r.optimization, tolerance: 0 }, { lower_bound: null, upper_bound: null, absolute_gap: null, tolerance: 0, nodes: 0, termination: 'limit' }, op.name);
    assert.equal(r.reason, reason, op.name);
  } else if (op.kind === 'explore') {
    const r = response as ExploreResponse;
    assert.equal(r.curve_status, 'invalid', op.name);
    assert.deepEqual([r.points, r.sweep_schedule, r.step_outcomes], [[], [], []], `${op.name}: no invented schedule or per-target record`);
    assert.equal(r.precision_request, op.precisionRequest, op.name);
    assert.equal(r.precision_resolved, null, op.name);
    assert.equal(r.model_qualification, null, op.name);
    assert.equal(r.moa_qualification, moaDependent ? 'provisional_model' : null, op.name);
    assert.equal(r.reason, reason, op.name);
  } else {
    const r = response as MOAFloorResponse;
    assert.equal(r.status, 'unresolved', op.name);
    assert.equal(r.moa_qualification, 'provisional_model', op.name);
    assert.deepEqual([r.floor, r.display_floor, r.proved_lower_bound], [null, null, null], op.name);
    assert.equal(r.witness, undefined, op.name);
    assert.equal(r.reason, reason, op.name);
  }
}
