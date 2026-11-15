// What the request-domain consumers produce for the pin corpus (requestDomainPin.corpus.ts): the reuse keys, the MOA-floor witness scopes and the
// solve parameters the worker builds for Optimize, for every target of an Explore sweep, and for the floor. The pin test compares this with the golden
// file; the golden was captured from the code before the request fields were collapsed (commit 108300e), by running this very module there.
import type { LoadedState } from '../../src/solver/dataService';
import { witnessScopeOf } from '../../src/solver/moaFloor';
import type { MoaFloorRequest } from '../../src/solver/moaFloor';
import { exploreEnvelope, floorEnvelope, optimizeEnvelope } from '../../src/solver/operationEnvelopes';
import { computeExactSolveCacheKey, computeIdealPointCacheKey } from '../../src/solver/reuseKey';
import type { SolveParams } from '../../src/solver/types';
import { createWorkerRuntime } from '../../src/solver/workerRuntime';
import type { ExploreRunInput, FloorRunInput, WorkerDeps } from '../../src/solver/workerRuntime';
import type { WorkerOutMessage } from '../../src/solver/workerProtocol';
import { gun, lookupOf, mod, slot, WEAPON } from '../physical/lpFixtures';
import { KEY_CONTROLS, KEY_REQUESTS, RUNTIME_REQUESTS, SCOPE_CAPS, SCOPE_PARAMS } from './requestDomainPin.corpus';

export interface PinGolden {
  keys: Record<string, string>;
  scopes: Record<string, unknown>;
  runtime: Record<string, unknown[]>;
}

const T0 = 1_700_000_000_000;

/** Every Explore axis: the two endpoint targets and the interior targets that follow them. */
const AXES = ['price', 'recoil', 'ergo'] as const;

const state = (): LoadedState => ({
  guns: [],
  mods: [],
  itemLookup: lookupOf(gun(WEAPON, { slots: [slot('s', ['a', 'b'])] }), ['a', mod('a', { ergo: 5 })], ['b', mod('b', { ergo: 4 })]),
  loadedAt: 0,
  generation: 1,
});

/**
 * A verified optimum whose statistics follow the parameters it was asked for, so an Explore sweep has a range to step through: the weights pick the
 * end of each axis (ergonomics 30 to 70, vertical recoil 50 to 90), and a step's constraint is met exactly. Without finite statistics every target
 * would classify as unresolved and the sweep would stop after its two endpoints.
 */
const cannedResponse = (params: SolveParams) => {
  const base = optimizeEnvelope('cancelled', { precisionRequest: 'precise', moaDependent: false });
  delete base.reason;
  return {
    ...base,
    status: 'optimal' as const,
    precision_resolved: 'precise' as const,
    model_qualification: 'exact' as const,
    physical_certificate: 'certified_optimal' as const,
    objective_value: 1,
    final_stats: {
      ergonomics: Math.max(params.minErgonomics ?? 0, params.ergoWeight === 1 ? 70 : 30),
      recoil_vertical: Math.min(params.maxRecoilV ?? Infinity, params.recoilWeight === 1 ? 50 : 90),
      recoil_horizontal: 40,
      total_price: 1000,
      total_weight: 3,
      moa: 1,
    },
  };
};

/** The JSON-visible solve parameters: no lookup, compatibility map or clock. */
const visible = (params: object): unknown => {
  const { itemLookup: _lookup, compatibilityMap: _map, guard: _guard, ...rest } = params as Record<string, unknown>;
  void _lookup; void _map; void _guard;
  return JSON.parse(JSON.stringify(rest));
};

export async function collectPin(): Promise<PinGolden> {
  const keys: Record<string, string> = {};
  for (const [name, request] of Object.entries(KEY_REQUESTS)) {
    for (const [controlsName, controls] of Object.entries(KEY_CONTROLS)) keys[`${name} | ${controlsName}`] = computeIdealPointCacheKey('en', 'regular', request, controls);
    keys[`${name} | exact`] = computeExactSolveCacheKey('en', 'regular', request);
  }

  const scopes: Record<string, unknown> = {};
  for (const [name, params] of Object.entries(SCOPE_PARAMS)) {
    for (const cap of SCOPE_CAPS) scopes[`${name} | cap ${cap}`] = witnessScopeOf(params as MoaFloorRequest, cap);
  }

  const runtime: Record<string, unknown[]> = {};
  const runtimeOf = (solves: unknown[], posted: WorkerOutMessage[], extra: Partial<WorkerDeps> = {}) => createWorkerRuntime({
    post: message => { posted.push(message); }, now: () => T0, yieldMacrotask: async () => {}, loadData: async () => state(), clearLoadedData: () => {},
    solve: async params => { solves.push(visible(params)); return { response: cannedResponse(params), payoff: null }; },
    ...extra,
  });
  for (const [name, request] of Object.entries(RUNTIME_REQUESTS)) {
    const req = { ...request, weapon_id: WEAPON };
    for (const precise of ['precise', 'fast', 'auto'] as const) {
      const optimizeSolves: unknown[] = [];
      const optimize = runtimeOf(optimizeSolves, []);
      optimize.receive({ type: 'optimize', id: 1, payload: { request: { ...req, precise_mode: precise }, lang: 'en', gameMode: 'regular', deadline: T0 + 60_000 } });
      await optimize.idle();
      runtime[`${name} | optimize ${precise}`] = optimizeSolves;

      for (const ignore of AXES) {
        const bases: unknown[] = [];
        const exploreDriver = runtimeOf([], [], {
          runExplore: async (input: ExploreRunInput) => {
            bases.push(visible(input.baseParams));
            return { ...exploreEnvelope('cancelled', { precisionRequest: 'fast', moaDependent: false }), curve_status: 'partial' };
          },
        });
        exploreDriver.receive({ type: 'explore', id: 2, payload: { request: { ...req, ignore, steps: 12, precise_mode: precise }, lang: 'en', gameMode: 'regular', deadline: T0 + 60_000 } });
        await exploreDriver.idle();
        runtime[`${name} | explore base ${ignore} ${precise}`] = bases;

        // The real sweep driver: the solve parameters of every target it launches, and the schedule it ends with.
        const stepSolves: unknown[] = [];
        const posted: WorkerOutMessage[] = [];
        const explore = runtimeOf(stepSolves, posted);
        explore.receive({ type: 'explore', id: 3, payload: { request: { ...req, ignore, steps: 12, precise_mode: precise }, lang: 'en', gameMode: 'regular', deadline: T0 + 60_000 } });
        await explore.idle();
        runtime[`${name} | explore steps ${ignore} ${precise}`] = stepSolves;
        const result = posted.find(m => m.id === 3 && m.type === 'result')?.payload as { curve_status: string; sweep_schedule: unknown[]; step_outcomes: { outcome: string }[]; points: unknown[] };
        runtime[`${name} | explore schedule ${ignore} ${precise}`] = [{
          curve_status: result.curve_status, sweep_schedule: result.sweep_schedule, outcomes: result.step_outcomes.map(o => o.outcome).join(''), points: result.points.length,
        }];
      }
    }
    const floorBases: unknown[] = [];
    const floor = runtimeOf([], [], {
      runMoaFloor: async (input: FloorRunInput) => {
        floorBases.push(visible(input.baseParams));
        return { ...floorEnvelope('cancelled'), status: 'model_witnessed', floor: 1.5 };
      },
    });
    const { max_moa: _cap, ergo_weight: _e, recoil_weight: _r, price_weight: _p, use_tchebycheff: _t, precise_mode: _m, allow_repeated_parts: _a, ...floorRequest } = req;
    void _cap; void _e; void _r; void _p; void _t; void _m; void _a;
    floor.receive({ type: 'computeMOAFloor', id: 4, payload: { request: floorRequest, lang: 'en', gameMode: 'regular', deadline: T0 + 30_000 } });
    await floor.idle();
    runtime[`${name} | floor base`] = floorBases;
  }
  return { keys, scopes, runtime };
}
