// The request domain, pinned. `requestDomainPin.golden.json` was captured from the code BEFORE the request fields were collapsed into one table
// (src/solver/domainFields.ts), over the requests of requestDomainPin.corpus.ts. Everything that reads the domain must still produce exactly
// those outputs: the reuse keys (ADR 0001, ADR 0012 invalidation ledger), the witness scope of a MOA-floor witness (ADR 0013 section 5) and the solve
// parameters the worker hands to Optimize, to every Explore step and to the MOA floor. The golden file is never regenerated to make this pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ExploreRunInput, FloorRunInput, WorkerDeps } from '../../src/solver/workerRuntime';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import { exploreEnvelope, floorEnvelope, optimizeEnvelope } from '../../src/solver/operationEnvelopes';
import { witnessScopeOf } from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { computeExactSolveCacheKey, computeIdealPointCacheKey } from '../../src/solver/reuseKey';
import type { LoadedState } from '../../src/solver/dataService';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';
import { KEY_CONTROLS, KEY_REQUESTS, RUNTIME_REQUESTS, SCOPE_CAPS, SCOPE_PARAMS } from './requestDomainPin.corpus';

interface Golden {
  keys: Record<string, string>;
  scopes: Record<string, unknown>;
  runtime: Record<string, unknown[]>;
}
const golden = JSON.parse(readFileSync(new URL('./requestDomainPin.golden.json', import.meta.url), 'utf8')) as Golden;

const T0 = 1_700_000_000_000;

/** What the corpus produced before the change, by entry name; an entry that is missing from either side fails. */
function assertSame<T>(actual: Record<string, T>, expected: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'the same entries');
  for (const name of Object.keys(expected)) assert.deepEqual(JSON.parse(JSON.stringify(actual[name])), expected[name], name);
}

test('the reuse key of every corpus request is the key it was before the request fields were collapsed', () => {
  const keys: Record<string, string> = {};
  for (const [name, request] of Object.entries(KEY_REQUESTS)) {
    for (const [controlsName, controls] of Object.entries(KEY_CONTROLS)) keys[`${name} | ${controlsName}`] = computeIdealPointCacheKey('en', 'regular', request, controls);
    keys[`${name} | exact`] = computeExactSolveCacheKey('en', 'regular', request);
  }
  assert.deepEqual(Object.keys(keys).sort(), Object.keys(golden.keys).sort());
  for (const [name, key] of Object.entries(keys)) assert.equal(key, golden.keys[name], name);
});

test('the witness scope of every corpus domain is the scope it was before the request fields were collapsed', () => {
  const scopes: Record<string, unknown> = {};
  for (const [name, params] of Object.entries(SCOPE_PARAMS)) {
    for (const cap of SCOPE_CAPS) scopes[`${name} | cap ${cap}`] = witnessScopeOf(params as MoaFloorRequest, cap);
  }
  assertSame(scopes, golden.scopes);
});

const state = (): LoadedState => ({
  guns: [],
  mods: [],
  itemLookup: lookupOf(gun(WEAPON, { slots: [slot('s', ['a', 'b'])] }), ['a', mod('a', { ergo: 5 })], ['b', mod('b', { ergo: 4 })]),
  loadedAt: 0,
  generation: 1,
});

const cannedResponse = () => {
  const base = optimizeEnvelope('cancelled', { precisionRequest: 'precise', moaDependent: false });
  delete base.reason;
  return { ...base, status: 'optimal' as const, precision_resolved: 'precise' as const, model_qualification: 'exact' as const, physical_certificate: 'certified_optimal' as const };
};

/** The JSON-visible solve parameters: no lookup, compatibility map or clock. */
const visible = (params: object): unknown => {
  const { itemLookup: _lookup, compatibilityMap: _map, guard: _guard, ...rest } = params as Record<string, unknown>;
  void _lookup; void _map; void _guard;
  return JSON.parse(JSON.stringify(rest));
};

test('the worker hands every operation the solve parameters it handed before the request fields were collapsed', async () => {
  const actual: Record<string, unknown[]> = {};
  const runtimeOf = (solves: unknown[], extra: Partial<WorkerDeps> = {}) => createWorkerRuntime({
    post: () => {}, now: () => T0, yieldMacrotask: async () => {}, loadData: async () => state(), clearLoadedData: () => {},
    solve: async params => { solves.push(visible(params)); return { response: cannedResponse(), payoff: null }; },
    ...extra,
  });
  for (const [name, request] of Object.entries(RUNTIME_REQUESTS)) {
    const req = { ...request, weapon_id: WEAPON };
    for (const precise of ['precise', 'fast', 'auto'] as const) {
      const optimizeSolves: unknown[] = [];
      const optimize = runtimeOf(optimizeSolves);
      optimize.receive({ type: 'optimize', id: 1, payload: { request: { ...req, precise_mode: precise }, lang: 'en', gameMode: 'regular', deadline: T0 + 60_000 } });
      await optimize.idle();
      actual[`${name} | optimize ${precise}`] = optimizeSolves;

      const bases: unknown[] = [];
      const exploreDriver = runtimeOf([], {
        runExplore: async (input: ExploreRunInput) => {
          bases.push(visible(input.baseParams));
          return { ...exploreEnvelope('cancelled', { precisionRequest: 'fast', moaDependent: false }), curve_status: 'partial' };
        },
      });
      exploreDriver.receive({ type: 'explore', id: 2, payload: { request: { ...req, ignore: 'price', steps: 12, precise_mode: precise }, lang: 'en', gameMode: 'regular', deadline: T0 + 60_000 } });
      await exploreDriver.idle();
      actual[`${name} | explore base ${precise}`] = bases;

      const stepSolves: unknown[] = [];
      const explore = runtimeOf(stepSolves);
      explore.receive({ type: 'explore', id: 3, payload: { request: { ...req, ignore: 'price', steps: 12, precise_mode: precise }, lang: 'en', gameMode: 'regular', deadline: T0 + 60_000 } });
      await explore.idle();
      actual[`${name} | explore steps ${precise}`] = stepSolves.slice(0, 3);
    }
    const floorBases: unknown[] = [];
    const floor = runtimeOf([], {
      runMoaFloor: async (input: FloorRunInput) => {
        floorBases.push(visible(input.baseParams));
        return { ...floorEnvelope('cancelled'), status: 'model_witnessed', floor: 1.5 };
      },
    });
    const { max_moa: _cap, ergo_weight: _e, recoil_weight: _r, price_weight: _p, use_tchebycheff: _t, precise_mode: _m, allow_repeated_parts: _a, ...floorRequest } = req;
    void _cap; void _e; void _r; void _p; void _t; void _m; void _a;
    floor.receive({ type: 'computeMOAFloor', id: 4, payload: { request: floorRequest, lang: 'en', gameMode: 'regular', deadline: T0 + 30_000 } });
    await floor.idle();
    actual[`${name} | floor base`] = floorBases;
  }
  assertSame(actual, golden.runtime);
});
