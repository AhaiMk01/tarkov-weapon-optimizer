/**
 * The worker runtime: request dispatch, the request epoch guard, validation, caches (Phase 2.7a, ADR 0013 sections 4D and 6).
 *
 * `solver.worker.ts` is a thin shell over {@link createWorkerRuntime}; everything testable lives here, with its collaborators injected.
 *
 * One request, one epoch (ADR 0013 section 4D):
 *  - the client stamps ONE absolute epoch deadline when the call enters (`payload.deadline`), so time spent queued counts. A request that is
 *    dispatched after its deadline stops before any preparation and returns its operation envelope with `Queue timeout before dispatch`;
 *  - `cancel` messages bypass the serial dispatch chain: `receive` sets the target request flag at once, and the running operation observes
 *    it at its next guard check, which follows a macrotask yield (a microtask await never lets the worker dispatch a message). A request
 *    cancelled before it was dispatched returns its envelope with `Cancelled by user`;
 *  - `owned_items` is validated and snapshotted FIRST (before hashing, caching, data loading or any model work); an invalid stash returns the
 *    operation null envelope with `Invalid owned_items format` even when the request also expired in the queue;
 *  - the validated multiset (duplicates kept) and the full acquisition and feasibility domain are forwarded to every solve of the request:
 *    Optimize (and the Gunsmith optimize call, which is the same message), every Explore step and every floor trial;
 *  - metadata operations (`loadData`, `getInfo`, `getWeaponMods`, `getGunsmithTasks`, `getStatus`, `clearCache`) take no stash and no deadline.
 *
 * Caches. The loaded data of a language and game mode carries its compatibility maps, structural bounds and endpoint (payoff table) cache; all
 * of it is tied to the IDENTITY of the loaded state, so a reload, a replacement or a cache clear discards it even when the names match. The
 * endpoint cache admits only qualified Precise MOA-independent certified tables (`endpointCache.ts`).
 *
 * A native failure is a typed `SolverError` envelope with the completion metadata captured before the failure (`runtimeErrors.ts`).
 *
 * `// 2.7b integration`: the Explore and MOA floor drivers below are the INTERIM bodies; Phase 2.7b's `runExplore` and `runMoaFloor` replace
 * `deps.runExplore` / `deps.runMoaFloor` through the {@link ExploreRunInput} / {@link FloorRunInput} seam.
 */

import type {
  ExploreRequest, ExploreResponse, ItemDetail, MOAFloorRequest, MOAFloorResponse, OptimizeRequest, OptimizeResponse, WitnessBuild,
} from '../api/client.ts';
import { buildCompatibilityMap } from './compatibilityMap.ts';
import { clearLoadedState, ensureDataLoaded } from './dataService.ts';
import type { LoadedState } from './dataService.ts';
import { EndpointCache } from './endpointCache.ts';
import { exploreEnvelope, floorEnvelope, optimizeEnvelope } from './operationEnvelopes.ts';
import type { PreModelStop } from './operationEnvelopes.ts';
import { explorePareto } from './paretoExplorer.ts';
import { inspectOwnedItems } from './physical/ownedItems.ts';
import { DEFAULT_MAX_SPATIAL_NODES, DEFAULT_OBJECTIVE_TOLERANCE } from './physical/solvePrecise.ts';
import { MOA_K } from './physical/specialize.ts';
import { normalizePrecisionRequest, resolvePreciseFlag } from './precisionMode.ts';
import { expandIncludeItemsWithDeps } from './requiredItemDeps.ts';
import { epochNow } from './requestGuard.ts';
import { canonicalizeTraderLevels, computeIdealPointCacheKey, computeStructuralBoundsCacheKey } from './reuseKey.ts';
import { serializeWorkerError } from './runtimeErrors.ts';
import { guardStop, remainingMs, yieldMacrotask as realYieldMacrotask } from './runtimeGuard.ts';
import type { RuntimeGuard } from './runtimeGuard.ts';
import { SOLVER_CAPABILITIES, solveRequest } from './solver.ts';
import type { SolveReport } from './solver.ts';
import { computeStructuralBounds } from './structuralBounds.ts';
import type { StructuralBounds } from './structuralBounds.ts';
import type { CompatibilityMap, ItemLookup, ModStats, PrecisionRequest, SolveParams, TraderLevels } from './types.ts';
import {
  DEFAULT_EXPLORE_TIME_LIMIT_MS, DEFAULT_FLOOR_TIME_LIMIT_MS, DEFAULT_OPTIMIZE_TIME_LIMIT_MS, resolveTimeLimit,
} from './workerProtocol.ts';
import type { WorkerInMessage, WorkerOutMessage, WorkerRequestMessage } from './workerProtocol.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawItem = Record<string, any>;

/** The loaded data of one language and game mode, with every cache derived from it. Replaced as a whole when the loaded state is. */
interface LoadedData {
  /** The state this was derived from: a different state object means a reload or a replacement, and discards everything below. */
  source: LoadedState;
  guns: RawItem[];
  mods: RawItem[];
  itemLookup: ItemLookup;
  compatMaps: Record<string, CompatibilityMap>;
  structuralBoundsCache: Map<string, StructuralBounds>;
  endpoints: EndpointCache;
}

// ---------------------------------------------------------------------------------------------
// The seams of Explore and the floor (Phase 2.7b replaces the interim bodies)
// ---------------------------------------------------------------------------------------------

/** Everything an Explore driver needs of a validated, in-time request. */
export interface ExploreRunInput {
  /** The request with `owned_items` replaced by the validated snapshot. */
  request: ExploreRequest;
  ownedItems: readonly string[];
  guard: RuntimeGuard;
  precisionRequest: PrecisionRequest;
  /** The resolved model of the sweep: Precise (true) or Fast (false). */
  usePrecise: boolean;
  /**
   * The common domain of every step: lookup, compatibility map, structural bounds, acquisition, the stash, the hard constraints and the resolved
   * model. No weights and no objective-specific fields; a step adds its own.
   */
  baseParams: SolveParams;
  /** One step: the full response of an Optimize solve, with the validated stash and the request guard forwarded (whatever `params` carries). */
  optimize(params: SolveParams, guard: RuntimeGuard): Promise<OptimizeResponse>;
  /** Publish a verified partial result; the client keeps the last one on a hard termination. */
  publishSnapshot(snapshot: unknown): void;
}

/** Everything a MOA floor driver needs of a validated, in-time request. */
export interface FloorRunInput {
  request: MOAFloorRequest;
  ownedItems: readonly string[];
  guard: RuntimeGuard;
  /** The common domain of every trial except the MOA cap and the objective: the same shape as {@link ExploreRunInput.baseParams}. */
  baseParams: SolveParams;
  optimize(params: SolveParams, guard: RuntimeGuard): Promise<OptimizeResponse>;
  publishSnapshot(snapshot: unknown): void;
}

export interface WorkerDeps {
  /** Send a message to the client. */
  post(message: WorkerOutMessage): void;
  /** Epoch milliseconds: the clock of every request epoch. */
  now?: () => number;
  /** A macrotask yield. */
  yieldMacrotask?: () => Promise<void>;
  loadData?: (lang: string, gameMode: string) => Promise<LoadedState>;
  /** Forget the loaded states so the next load rebuilds them (the `clearCache` operation). */
  clearLoadedData?: () => void;
  /** One Optimize solve; returns the response and the payoff table when this call computed it. */
  solve?: (params: SolveParams) => Promise<SolveReport>;
  /** The Gunsmith task list (`tasks.json`). */
  fetchTasks?: () => Promise<unknown[]>;
  runExplore?: (input: ExploreRunInput) => Promise<ExploreResponse>;
  runMoaFloor?: (input: FloorRunInput) => Promise<MOAFloorResponse>;
}

export interface WorkerRuntime {
  /** Hand one client message to the worker. Cancels act at once; everything else joins the serial dispatch chain. */
  receive(message: WorkerInMessage): void;
  /** Resolves when every message received so far has been handled. */
  idle(): Promise<void>;
}

const defaultFetchTasks = async (): Promise<unknown[]> => {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
  const response = await fetch(base + 'tasks.json');
  return (await response.json()) as unknown[];
};

export function createWorkerRuntime(deps: WorkerDeps): WorkerRuntime {
  const now = deps.now ?? epochNow;
  const yieldMacrotask = deps.yieldMacrotask ?? realYieldMacrotask;
  const loadData = deps.loadData ?? ensureDataLoaded;
  const clearLoadedData = deps.clearLoadedData ?? clearLoadedState;
  const solveOnce = deps.solve ?? solveRequest;
  const fetchTasks = deps.fetchTasks ?? defaultFetchTasks;
  // 2.7b integration: the two defaults below are the interim bodies; wire runExplore (exploreSweep.ts) and runMoaFloor (moaFloor.ts) here.
  const runExplore = deps.runExplore ?? interimRunExplore; // 2.7b integration
  const runMoaFloor = deps.runMoaFloor ?? interimRunMoaFloor; // 2.7b integration

  const dataCache = new Map<string, LoadedData>();

  /** A request the runtime knows of: queued or running. */
  interface Entry { cancelled: boolean; arrivedAt: number }
  const entries = new Map<number, Entry>();

  /** Serialize all handler work so the native solver is never used concurrently. Cancel messages do NOT go through it. */
  let dispatchChain: Promise<void> = Promise.resolve();

  async function getOrLoadData(lang: string, gameMode: string): Promise<LoadedData> {
    const state = await loadData(lang, gameMode);
    const key = `${lang}:${gameMode}`;
    const cached = dataCache.get(key);
    if (cached !== undefined && cached.source === state) return cached;
    // First load, a reload after expiry, a replacement or a cache clear: a new identity, so nothing derived from the old data survives.
    const loaded: LoadedData = {
      source: state,
      guns: state.guns,
      mods: state.mods,
      itemLookup: state.itemLookup,
      compatMaps: {},
      structuralBoundsCache: new Map(),
      endpoints: new EndpointCache(),
    };
    dataCache.set(key, loaded);
    return loaded;
  }

  function getCompatMap(data: LoadedData, weaponId: string): CompatibilityMap {
    if (!data.compatMaps[weaponId]) data.compatMaps[weaponId] = buildCompatibilityMap(weaponId, data.itemLookup);
    return data.compatMaps[weaponId];
  }

  function getStructuralBounds(data: LoadedData, lang: string, gameMode: string, weaponId: string): StructuralBounds {
    // Cache key is weapon-invariant: caches unclipped physical bounds in the data session
    const key = computeStructuralBoundsCacheKey(lang, gameMode, weaponId, null);
    let cached = data.structuralBoundsCache.get(key);
    if (!cached) {
      cached = computeStructuralBounds(weaponId, data.itemLookup, getCompatMap(data, weaponId), { maxWeight: null });
      data.structuralBoundsCache.set(key, cached);
    }
    return cached;
  }

  /** The guard of one request: the client-stamped epoch deadline (or one derived from the arrival time), this request cancel flag, this clock. */
  function guardOf(message: WorkerRequestMessage, entry: Entry, defaultLimitMs: number, requestedLimit: unknown): RuntimeGuard {
    const stamped = message.payload.deadline;
    const deadline = typeof stamped === 'number' && Number.isFinite(stamped) ? stamped : entry.arrivedAt + resolveTimeLimit(requestedLimit, defaultLimitMs);
    return { deadline, now, cancelled: () => entry.cancelled, yieldMacrotask };
  }

  /** The stop of a request at the moment it is dispatched: cancelled while queued, or expired while queued. `null` to go on. */
  function dispatchStop(guard: RuntimeGuard): Exclude<PreModelStop, 'invalid_owned_items'> | null {
    const stop = guardStop(guard);
    return stop === 'cancelled' ? 'cancelled' : stop === 'deadline' ? 'queue_timeout' : null;
  }

  function post(type: WorkerOutMessage['type'], id: number, payload: unknown): void {
    deps.post({ type, id, payload });
  }

  /** The common domain of a request, without weights or objective. The stash is the validated snapshot. */
  function domainParams(
    req: OptimizeRequest | MOAFloorRequest, data: LoadedData, lang: string, gameMode: string, owned: readonly string[], guard: RuntimeGuard,
    precisionRequest: PrecisionRequest, usePrecise: boolean,
  ): SolveParams {
    const compatMap = getCompatMap(data, req.weapon_id);
    return {
      weaponId: req.weapon_id,
      itemLookup: data.itemLookup,
      compatibilityMap: compatMap,
      structuralBounds: req.bounds_mode !== 'naive' ? getStructuralBounds(data, lang, gameMode, req.weapon_id) : undefined,
      maxPrice: req.max_price,
      minErgonomics: req.min_ergonomics,
      maxRecoilV: req.max_recoil_v,
      maxRecoilSum: req.max_recoil_sum,
      minMagCapacity: req.min_mag_capacity,
      minSightingRange: req.min_sighting_range,
      maxWeight: req.max_weight,
      includeItems: req.include_items,
      excludeItems: req.exclude_items,
      includeCategories: req.include_categories,
      excludeCategories: req.exclude_categories,
      useTrueErgo: req.use_true_ergo ?? false,
      preventOverswing: req.prevent_overswing ?? false,
      equipErgoModifier: req.equip_ergo_modifier,
      traderLevels: canonicalizeTraderLevels(req.trader_levels as TraderLevels | undefined) as TraderLevels | undefined,
      fleaAvailable: req.flea_available ?? true,
      barterAvailable: req.barter_available ?? false,
      barterExcludeDogtags: req.barter_exclude_dogtags ?? false,
      playerLevel: req.player_level,
      ownedItems: owned,
      boundsMode: req.bounds_mode,
      precisionRequest,
      preciseMode: usePrecise,
      guard,
    };
  }

  /** One step of an Explore sweep or one floor trial: the validated stash and the request guard are forced onto whatever the driver passes. */
  const stepOptimizer = (owned: readonly string[]) => async (params: SolveParams, guard: RuntimeGuard): Promise<OptimizeResponse> =>
    (await solveOnce({ ...params, ownedItems: owned, guard })).response;

  // -------------------------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------------------------

  async function runOptimize(message: WorkerRequestMessage, entry: Entry): Promise<void> {
    const { id, payload } = message;
    const lang = payload.lang ?? 'en';
    const gameMode = payload.gameMode ?? 'regular';
    const req = payload.request as OptimizeRequest;
    const startedAt = now();
    const guard = guardOf(message, entry, DEFAULT_OPTIMIZE_TIME_LIMIT_MS, req.time_limit_ms);
    const precisionRequest = normalizePrecisionRequest(req.precise_mode);
    const moaDependent = req.max_moa != null;
    const envelope = (stop: PreModelStop): void => post('result', id, optimizeEnvelope(stop, { precisionRequest, moaDependent, elapsedMs: now() - entry.arrivedAt }));

    // 1. The stash, before hashing, caching, loading or any model work.
    const owned = inspectOwnedItems(req.owned_items);
    if (!owned.ok) return envelope('invalid_owned_items');
    // 2. Queue expiry or a cancel while queued: stop before any preparation.
    const stop = dispatchStop(guard);
    if (stop !== null) return envelope(stop);

    const data = await getOrLoadData(lang, gameMode);
    const compatMap = getCompatMap(data, req.weapon_id);
    const usePrecise = resolvePreciseFlag(precisionRequest, compatMap);
    const params: SolveParams = {
      ...domainParams(req, data, lang, gameMode, owned.items, guard, precisionRequest, usePrecise),
      maxMOA: req.max_moa,
      ergoWeight: req.ergo_weight ?? 1,
      recoilWeight: req.recoil_weight ?? 1,
      priceWeight: req.price_weight ?? 0,
      useTchebycheff: req.use_tchebycheff ?? false,
    };

    // A cached payoff table skips the three endpoint solves. Only a table that was computed as a qualified Precise MOA-independent result
    // is ever stored (`endpointCache.ts`); a Fast or MOA-dependent request still computes its own table and never stores it.
    let endpointCache: 'hit' | 'miss' | undefined;
    let cacheKey: string | undefined;
    const cacheable = params.useTchebycheff === true && usePrecise && !moaDependent;
    if (params.useTchebycheff === true) {
      endpointCache = 'miss';
      if (cacheable) {
        cacheKey = computeIdealPointCacheKey(lang, gameMode, { ...req, owned_items: [...owned.items] }, {
          precisionResolved: 'precise',
          timeLimitMs: resolveTimeLimit(req.time_limit_ms, DEFAULT_OPTIMIZE_TIME_LIMIT_MS),
          maxSpatialNodes: DEFAULT_MAX_SPATIAL_NODES,
          tolerance: DEFAULT_OBJECTIVE_TOLERANCE,
        });
        const cached = data.endpoints.lookup(cacheKey, DEFAULT_OBJECTIVE_TOLERANCE);
        if (cached !== undefined) {
          params.idealPoint = cached;
          endpointCache = 'hit';
        }
      }
    }

    const report = await solveOnce(params);
    if (cacheKey !== undefined && endpointCache === 'miss' && report.payoff !== null) data.endpoints.admit(cacheKey, report.payoff, DEFAULT_OBJECTIVE_TOLERANCE);
    const result: OptimizeResponse = { ...report.response, solve_time_ms: now() - startedAt };
    if (endpointCache !== undefined) result.endpoint_cache = endpointCache;
    post('result', id, result);
  }

  async function runExploreOperation(message: WorkerRequestMessage, entry: Entry): Promise<void> {
    const { id, payload } = message;
    const lang = payload.lang ?? 'en';
    const gameMode = payload.gameMode ?? 'regular';
    const req = payload.request as ExploreRequest;
    const guard = guardOf(message, entry, DEFAULT_EXPLORE_TIME_LIMIT_MS, req.time_limit_ms);
    const precisionRequest = normalizePrecisionRequest(req.precise_mode);
    const moaDependent = req.max_moa != null;
    const envelope = (stop: PreModelStop): void => post('result', id, exploreEnvelope(stop, { precisionRequest, moaDependent, elapsedMs: now() - entry.arrivedAt }));

    const owned = inspectOwnedItems(req.owned_items);
    if (!owned.ok) return envelope('invalid_owned_items');
    const stop = dispatchStop(guard);
    if (stop !== null) return envelope(stop);

    const data = await getOrLoadData(lang, gameMode);
    const usePrecise = resolvePreciseFlag(precisionRequest, getCompatMap(data, req.weapon_id));
    const result = await runExplore({
      request: { ...req, owned_items: [...owned.items] },
      ownedItems: owned.items,
      guard,
      precisionRequest,
      usePrecise,
      baseParams: domainParams(req, data, lang, gameMode, owned.items, guard, precisionRequest, usePrecise),
      optimize: stepOptimizer(owned.items),
      publishSnapshot: snapshot => post('snapshot', id, snapshot),
    });
    post('result', id, result);
  }

  async function runFloorOperation(message: WorkerRequestMessage, entry: Entry): Promise<void> {
    const { id, payload } = message;
    const lang = payload.lang ?? 'en';
    const gameMode = payload.gameMode ?? 'regular';
    const req = payload.request as MOAFloorRequest;
    const guard = guardOf(message, entry, DEFAULT_FLOOR_TIME_LIMIT_MS, req.time_limit_ms);
    const envelope = (stop: PreModelStop): void => post('result', id, floorEnvelope(stop, { elapsedMs: now() - entry.arrivedAt }));

    const owned = inspectOwnedItems(req.owned_items);
    if (!owned.ok) return envelope('invalid_owned_items');
    const stop = dispatchStop(guard);
    if (stop !== null) return envelope(stop);

    const data = await getOrLoadData(lang, gameMode);
    // A floor query resolves Precise (ADR 0013 section 6): the placement model is recorded as requested and resolved Precise.
    const result = await runMoaFloor({
      request: { ...req, owned_items: [...owned.items] },
      ownedItems: owned.items,
      guard,
      baseParams: domainParams(req, data, lang, gameMode, owned.items, guard, 'precise', true),
      optimize: stepOptimizer(owned.items),
      publishSnapshot: snapshot => post('snapshot', id, snapshot),
    });
    post('result', id, result);
  }

  async function runMetadata(message: WorkerRequestMessage): Promise<void> {
    const { type, id, payload } = message;
    const lang = payload.lang ?? 'en';
    const gameMode = payload.gameMode ?? 'regular';
    switch (type) {
      case 'clearCache': {
        // Discard every derived cache, the endpoint tables included, and make the next load rebuild the lookup (so the physical blueprints
        // memoized on the old lookup object are unreachable too).
        for (const data of dataCache.values()) {
          data.endpoints.clear();
          data.structuralBoundsCache.clear();
        }
        dataCache.clear();
        clearLoadedData();
        post('result', id, { cleared: true });
        return;
      }
      case 'loadData': {
        await getOrLoadData(lang, gameMode);
        post('dataLoaded', id, null);
        return;
      }
      case 'getInfo': {
        const data = await getOrLoadData(lang, gameMode);
        const gunList = data.guns.map((gun: RawItem) => {
          const props = gun.properties ?? {};
          const defaultPreset = props.defaultPreset ?? {};
          const image =
            defaultPreset.image512pxLink ?? defaultPreset.imageLink ??
            gun.image512pxLink ?? gun.imageLink ?? gun.iconLink ?? null;
          return {
            id: gun.id,
            name: gun.name,
            image,
            category: gun.bsgCategory?.name ?? 'Unknown',
            caliber: (props.caliber ?? '').replace('Caliber', '').trim(),
            base_moa: (props.centerOfImpact ?? 0) * MOA_K,
          };
        }).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
        post('result', id, { guns: gunList });
        return;
      }
      case 'getWeaponMods': {
        const weaponId = payload.weaponId as string;
        const data = await getOrLoadData(lang, gameMode);
        const compatMap = getCompatMap(data, weaponId);
        const modList = Object.keys(compatMap.reachable_items)
          .map(mid => {
            const item = data.itemLookup[mid];
            if (!item) return null;
            const itemData = item.data as Record<string, unknown>;
            const st = item.stats as ModStats;
            return {
              id: mid,
              name: itemData.name as string,
              category: 'category' in item.stats ? item.stats.category : 'Unknown',
              category_id: 'category_id' in item.stats ? String(item.stats.category_id) : '',
              category_normalized: st.category_normalized ?? '',
              handbook_categories: Array.isArray(st.handbook_categories) ? st.handbook_categories : [],
              category_child_ids: Array.isArray(st.category_child_ids) ? st.category_child_ids : [],
              icon: (itemData.iconLink ?? itemData.imageLink) as string | undefined,
              capacity: st.capacity ?? 0,
              zoom_min: st.zoom_min,
              zoom_max: st.zoom_max,
              accuracy_modifier: st.accuracy_modifier ?? 0,
              base_moa: (st.center_of_impact ?? 0) * MOA_K,
            };
          })
          .filter(Boolean)
          .sort((a, b) => (a!.name as string).localeCompare(b!.name as string));
        if (!payload.withCompat) {
          post('result', id, { mods: modList });
          return;
        }
        // Enough of the compatibility graph for the UI to grey out parts that cannot coexist with what the user has already required. Scoped
        // to the reachable set, and only the entries that actually constrain anything.
        const reachable = new Set(Object.keys(compatMap.reachable_items));
        const conflicts: Record<string, string[]> = {};
        for (const mid of reachable) {
          const entryOf = data.itemLookup[mid];
          if (!entryOf || entryOf.type !== 'mod') continue;
          for (const cid of entryOf.conflicting_items) {
            // Some items list themselves; that would block every build.
            if (cid === mid || !reachable.has(cid)) continue;
            // Stored both ways so a lookup never has to scan the other side.
            (conflicts[mid] ??= []).push(cid);
            (conflicts[cid] ??= []).push(mid);
          }
        }
        for (const key of Object.keys(conflicts)) conflicts[key] = [...new Set(conflicts[key])];
        // Slots an item can be INSTALLED IN -- the inverse of slot_items. Not item_to_slots, which lists the slots an item itself provides for
        // further attachments; that is the opposite direction and is empty for every leaf part.
        const slotsByItem: Record<string, string[]> = {};
        for (const [slotId, allowed] of Object.entries(compatMap.slot_items)) {
          for (const iid of allowed) {
            if (!reachable.has(iid)) continue;
            (slotsByItem[iid] ??= []).push(slotId);
          }
        }
        post('result', id, { mods: modList, conflicts, slots_by_item: slotsByItem });
        return;
      }
      case 'getGunsmithTasks': {
        const data = await getOrLoadData(lang, gameMode);
        const rawTasks = await fetchTasks();
        const categoryIdToName: Record<string, string> = {};
        for (const [, item] of Object.entries(data.itemLookup)) {
          const catId = 'category_id' in item.stats ? item.stats.category_id : '';
          const st = item.stats as ModStats;
          const catName = st.handbook_categories?.[0] ?? ('category' in item.stats ? item.stats.category : '');
          if (catId && catName) categoryIdToName[catId] = catName;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tasks = rawTasks.map((raw: any) => {
          const weaponId = raw.weapon_id ?? '';
          const weaponData = data.itemLookup[weaponId];
          const weaponInfo = weaponData?.data as Record<string, unknown> ?? {};
          const props = (weaponInfo.properties as Record<string, unknown>) ?? {};
          const defaultPreset = (props.defaultPreset as Record<string, unknown>) ?? {};
          const weaponImage =
            (defaultPreset.image512pxLink ?? defaultPreset.imageLink ??
              weaponInfo.image512pxLink ?? weaponInfo.imageLink ?? weaponInfo.iconLink) as string | null;

          const requiredItemIds: string[] = raw.required_item_ids ?? [];
          const cmap = getCompatMap(data, weaponId);
          const expandedIds = expandIncludeItemsWithDeps(weaponId, cmap, requiredItemIds) ?? requiredItemIds;
          const implicitItemIds = expandedIds.filter((iid: string) => !requiredItemIds.includes(iid));
          const nameOf = (iid: string): string => {
            const entryOf = data.itemLookup[iid];
            return (entryOf?.data as Record<string, unknown>)?.name as string ?? iid;
          };
          const requiredCategoryGroupIds: string[][] = raw.required_category_group_ids ?? [];
          return {
            task_name: raw.task_name ?? 'Unknown Task',
            weapon_id: weaponId,
            weapon_name: (weaponInfo.name as string) ?? 'Unknown Weapon',
            weapon_image: weaponImage,
            constraints: raw.constraints ?? {},
            required_item_ids: requiredItemIds,
            required_item_names: requiredItemIds.map(nameOf),
            implicit_required_item_ids: implicitItemIds,
            implicit_required_item_names: implicitItemIds.map(nameOf),
            required_category_group_ids: requiredCategoryGroupIds,
            required_category_names: requiredCategoryGroupIds.map((group: string[]) => group.map((catId: string) => categoryIdToName[catId] ?? catId)),
          };
        });
        post('result', id, { tasks });
        return;
      }
      case 'getStatus': {
        // Ensure data is loaded, return the current timestamp, the build revision and the solver capabilities
        await getOrLoadData(lang, gameMode);
        post('result', id, { timestamp: Date.now(), revision: 'unpinned-candidate', capabilities: SOLVER_CAPABILITIES });
        return;
      }
      default:
        post('error', id, `Unknown message type: ${type}`);
    }
  }

  async function dispatch(message: WorkerRequestMessage, entry: Entry): Promise<void> {
    try {
      switch (message.type) {
        case 'optimize': return await runOptimize(message, entry);
        case 'explore': return await runExploreOperation(message, entry);
        case 'computeMOAFloor': return await runFloorOperation(message, entry);
        default: return await runMetadata(message);
      }
    } catch (error) {
      // A native failure keeps its type, phase and the completion metadata captured before it; anything else is a generic failure.
      post('error', message.id, serializeWorkerError(error));
    }
  }

  return {
    receive(message: WorkerInMessage): void {
      if (message.type === 'cancel') {
        // OUT OF BAND: no waiting behind the running request. The flag is read by the running operation guard after its next macrotask yield.
        const target = entries.get(message.payload.targetId);
        if (target !== undefined) target.cancelled = true;
        return;
      }
      const entry: Entry = { cancelled: false, arrivedAt: now() };
      entries.set(message.id, entry);
      dispatchChain = dispatchChain
        .then(() => dispatch(message, entry))
        .catch(() => {
          // Errors are reported via post inside dispatch; swallow a chain rejection so later requests still run.
        })
        .then(() => { entries.delete(message.id); });
    },
    idle(): Promise<void> {
      return dispatchChain;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// INTERIM drivers (2.7b integration)
// ---------------------------------------------------------------------------------------------

/**
 * 2.7b integration: INTERIM Explore driver, replaced by `buildSweepSchedule` + `runExplore` (the total V/I/U/E classification of ADR 0013
 * section 6). The pre-cutover sweep is adaptive and records no per-target outcome, so nothing here can honestly claim `complete` or
 * `infeasible`: a sweep with a verified point is `partial`, one without is `invalid`.
 */
async function interimRunExplore(input: ExploreRunInput): Promise<ExploreResponse> {
  const { request, baseParams, guard } = input;
  const startedAt = guard.now();
  const points = await explorePareto({
    ...baseParams,
    ignore: request.ignore,
    steps: request.steps ?? 10,
    ownedItems: [...input.ownedItems],
    timeLimitMs: remainingMs(guard),
  });
  return {
    curve_status: points.length > 0 ? 'partial' : 'invalid',
    points,
    sweep_schedule: [],
    step_outcomes: [],
    total_solve_time_ms: Math.round(guard.now() - startedAt),
    precision_request: input.precisionRequest,
    // Every target of the sweep runs the one resolved mode of the request.
    precision_resolved: input.usePrecise ? 'precise' : 'fast',
    model_qualification: input.usePrecise ? 'exact' : 'approximate',
    moa_qualification: request.max_moa != null ? 'provisional_model' : null,
  };
}

/**
 * 2.7b integration: INTERIM MOA floor driver, replaced by `runMoaFloor` (lower-bracket discovery, then qualified Precise bisection, at most 14
 * trials). This body is the pre-cutover seed plus bisection over the validated domain; it proves nothing, so it is only ever `model_witnessed`
 * (an upper-bound witness) or `unresolved`, never `model_proved`, and it has no display floor.
 */
async function interimRunMoaFloor(input: FloorRunInput): Promise<MOAFloorResponse> {
  const { request, baseParams, guard, optimize } = input;
  const startedAt = guard.now();
  const unresolved = (reason?: string): MOAFloorResponse => ({
    status: 'unresolved', moa_qualification: 'provisional_model', floor: null, display_floor: null, proved_lower_bound: null,
    solve_time_ms: guard.now() - startedAt, ...(reason === undefined ? {} : { reason }),
  });
  const weapon = baseParams.itemLookup[request.weapon_id];
  const gunStats = weapon?.type === 'gun' ? weapon.stats : null;
  if (!gunStats || (gunStats.center_of_impact ?? 0) <= 0) return unresolved();

  // Constant-zero objective: the floor seeks the best MOA, not the cheapest build.
  const trial = (maxMOA: number | undefined): Promise<OptimizeResponse> => optimize({ ...baseParams, ergoWeight: 0, recoilWeight: 0, priceWeight: 0, maxMOA }, guard);
  const seed = await trial(undefined);
  if (seed.status === 'infeasible' && seed.precision_resolved === 'precise') return { ...unresolved(), status: 'model_infeasible' };
  if (!seed.final_stats || (seed.status !== 'optimal' && seed.status !== 'feasible')) return unresolved(seed.reason);

  let best: OptimizeResponse = seed;
  let bestCap: number | null = null;
  let hi = seed.final_stats.moa;
  let lo = 0;
  for (let iter = 0; iter < 14 && hi - lo > 0.02; iter++) {
    await guard.yieldMacrotask();
    if (guardStop(guard) !== null) break;
    const mid = (lo + hi) / 2;
    const res = await trial(mid);
    if (res.final_stats && (res.status === 'optimal' || res.status === 'feasible')) {
      if (res.final_stats.moa < hi) { hi = res.final_stats.moa; best = res; bestCap = mid; }
    } else {
      lo = mid;
    }
  }
  const stats = best.final_stats as NonNullable<OptimizeResponse['final_stats']>;
  const items: ItemDetail[] = best.selected_items;
  const witness: WitnessBuild = {
    achieved_moa: stats.moa,
    base: best.selected_preset && best.selected_preset.id !== request.weapon_id ? { kind: 'preset', presetId: best.selected_preset.id } : { kind: 'naked' },
    selected_items: items,
    selected_item_ids: best.selected_item_ids,
    ...(best.selected_preset === undefined ? {} : { selected_preset: best.selected_preset }),
    slot_pairs: best.slot_pairs,
    scope: {
      weapon_id: request.weapon_id,
      precision_resolved: 'precise',
      model_qualification: 'exact',
      moa_qualification: 'provisional_model',
      max_moa: bestCap,
      acquisition: {
        trader_levels: (baseParams.traderLevels ?? null) as Record<string, number> | null,
        flea_available: baseParams.fleaAvailable ?? true,
        barter_available: baseParams.barterAvailable ?? false,
        barter_exclude_dogtags: baseParams.barterExcludeDogtags ?? false,
        player_level: baseParams.playerLevel ?? null,
      },
      feasibility: {
        max_price: baseParams.maxPrice ?? null,
        min_ergonomics: baseParams.minErgonomics ?? null,
        max_recoil_v: baseParams.maxRecoilV ?? null,
        max_recoil_sum: baseParams.maxRecoilSum ?? null,
        min_mag_capacity: baseParams.minMagCapacity ?? null,
        min_sighting_range: baseParams.minSightingRange ?? null,
        max_weight: baseParams.maxWeight ?? null,
        include_items: baseParams.includeItems ?? null,
        exclude_items: baseParams.excludeItems ?? null,
        include_categories: baseParams.includeCategories ?? null,
        exclude_categories: baseParams.excludeCategories ?? null,
        prevent_overswing: baseParams.preventOverswing ?? false,
        equip_ergo_modifier: baseParams.equipErgoModifier ?? null,
      },
      inventory: { owned_items: [...input.ownedItems] },
    },
  };
  return {
    status: 'model_witnessed', moa_qualification: 'provisional_model', floor: hi, display_floor: null, proved_lower_bound: null, witness,
    solve_time_ms: guard.now() - startedAt,
  };
}
