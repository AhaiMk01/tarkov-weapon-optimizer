/**
 * Web Worker for running HiGHS solver without blocking the UI.
 */

import { ensureDataLoaded } from './dataService.ts';
import { buildCompatibilityMap } from './compatibilityMap.ts';
import { expandIncludeItemsWithDeps } from './requiredItemDeps.ts';
import { normalizePrecisionRequest, resolvePreciseFlag } from './precisionMode.ts';
import { solve } from './solver.ts';
import { explorePareto } from './paretoExplorer.ts';
import type { ItemLookup, CompatibilityMap, TraderLevels, ModStats } from './types.ts';
import type { OptimizeRequest, ExploreRequest, OptimizeResponse, ExploreResponse, ExplorePoint } from '../api/client.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawItem = Record<string, any>;

interface LoadedData {
  guns: RawItem[];
  mods: RawItem[];
  itemLookup: ItemLookup;
  compatMaps: Record<string, CompatibilityMap>;
}

const dataCache = new Map<string, LoadedData>();

async function getOrLoadData(lang: string, gameMode: string): Promise<LoadedData> {
  const key = `${lang}:${gameMode}`;
  const cached = dataCache.get(key);
  if (cached) return cached;

  const state = await ensureDataLoaded(lang, gameMode);
  const loaded: LoadedData = {
    guns: state.guns,
    mods: state.mods,
    itemLookup: state.itemLookup,
    compatMaps: {},
  };
  dataCache.set(key, loaded);
  return loaded;
}

function getCompatMap(data: LoadedData, weaponId: string): CompatibilityMap {
  if (!data.compatMaps[weaponId]) {
    data.compatMaps[weaponId] = buildCompatibilityMap(weaponId, data.itemLookup);
  }
  return data.compatMaps[weaponId];
}

interface WorkerMessage {
  type: 'loadData' | 'optimize' | 'explore' | 'getInfo' | 'getWeaponMods' | 'getGunsmithTasks' | 'getStatus';
  id: number;
  payload: {
    lang?: string;
    gameMode?: string;
    request?: OptimizeRequest | ExploreRequest;
    weaponId?: string;
  };
}

/** Serialize all handler work so HiGHS singleton is never used concurrently. */
let dispatchChain: Promise<void> = Promise.resolve();

async function dispatchMessage(eventData: WorkerMessage): Promise<void> {
  const { type, id, payload } = eventData;
  const lang = payload.lang ?? 'en';
  const gameMode = payload.gameMode ?? 'regular';

  try {
    switch (type) {
        case 'loadData': {
          await getOrLoadData(lang, gameMode);
          self.postMessage({ type: 'dataLoaded', id, payload: null });
          break;
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
            };
          }).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
          self.postMessage({ type: 'result', id, payload: { guns: gunList } });
          break;
        }

        case 'getWeaponMods': {
          const weaponId = payload.weaponId!;
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
                category_child_ids: Array.isArray(st.category_child_ids) ? st.category_child_ids : [],
                icon: (itemData.iconLink ?? itemData.imageLink) as string | undefined,
                capacity: st.capacity ?? 0,
              };
            })
            .filter(Boolean)
            .sort((a, b) => (a!.name as string).localeCompare(b!.name as string));
          self.postMessage({ type: 'result', id, payload: { mods: modList } });
          break;
        }

        case 'optimize': {
          const req = payload.request as OptimizeRequest;
          const data = await getOrLoadData(lang, gameMode);
          const compatMap = getCompatMap(data, req.weapon_id);
          const precReq = normalizePrecisionRequest(req.precise_mode);
          const usePrecise = resolvePreciseFlag(precReq, compatMap);

          const result: OptimizeResponse = await solve({
            weaponId: req.weapon_id,
            itemLookup: data.itemLookup,
            compatibilityMap: compatMap,
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
            ergoWeight: req.ergo_weight ?? 1,
            recoilWeight: req.recoil_weight ?? 1,
            priceWeight: req.price_weight ?? 0,
            traderLevels: req.trader_levels as TraderLevels | undefined,
            fleaAvailable: req.flea_available ?? true,
            barterAvailable: req.barter_available ?? false,
            playerLevel: req.player_level,
            preciseMode: usePrecise,
          });

          result.precision_request = precReq;
          result.precision_resolved = usePrecise ? 'precise' : 'fast';
          self.postMessage({ type: 'result', id, payload: result });
          break;
        }

        case 'explore': {
          const req = payload.request as ExploreRequest;
          const data = await getOrLoadData(lang, gameMode);
          const compatMap = getCompatMap(data, req.weapon_id);
          const precReq = normalizePrecisionRequest(req.precise_mode);
          const usePrecise = resolvePreciseFlag(precReq, compatMap);

          const startTime = performance.now();
          const points: ExplorePoint[] = await explorePareto({
            weaponId: req.weapon_id,
            itemLookup: data.itemLookup,
            compatibilityMap: compatMap,
            ignore: req.ignore,
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
            steps: req.steps ?? 10,
            traderLevels: req.trader_levels as TraderLevels | undefined,
            fleaAvailable: req.flea_available ?? true,
            barterAvailable: req.barter_available ?? false,
            playerLevel: req.player_level,
            preciseMode: usePrecise,
          });

          const result: ExploreResponse = {
            points,
            total_solve_time_ms: Math.round(performance.now() - startTime),
            precision_request: precReq,
            precision_resolved: usePrecise ? 'precise' : 'fast',
          };

          self.postMessage({ type: 'result', id, payload: result });
          break;
        }

        case 'getGunsmithTasks': {
          const data = await getOrLoadData(lang, gameMode);
          // Import tasks.json
          const base = (typeof import.meta.env?.BASE_URL === 'string') ? import.meta.env.BASE_URL : '/';
          const tasksResp = await fetch(base + 'tasks.json');
          const rawTasks = await tasksResp.json();

          const categoryIdToName: Record<string, string> = {};
          for (const [, item] of Object.entries(data.itemLookup)) {
            const catId = 'category_id' in item.stats ? item.stats.category_id : '';
            const catName = 'category' in item.stats ? item.stats.category : '';
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

            const requiredItemNames = requiredItemIds.map((iid: string) => {
              const entry = data.itemLookup[iid];
              return (entry?.data as Record<string, unknown>)?.name as string ?? iid;
            });
            const implicitItemNames = implicitItemIds.map((iid: string) => {
              const entry = data.itemLookup[iid];
              return (entry?.data as Record<string, unknown>)?.name as string ?? iid;
            });

            const requiredCategoryGroupIds: string[][] = raw.required_category_group_ids ?? [];
            const requiredCategoryNames = requiredCategoryGroupIds.map((group: string[]) =>
              group.map((catId: string) => categoryIdToName[catId] ?? catId)
            );

            return {
              task_name: raw.task_name ?? 'Unknown Task',
              weapon_id: weaponId,
              weapon_name: (weaponInfo.name as string) ?? 'Unknown Weapon',
              weapon_image: weaponImage,
              constraints: raw.constraints ?? {},
              required_item_ids: requiredItemIds,
              required_item_names: requiredItemNames,
              implicit_required_item_ids: implicitItemIds,
              implicit_required_item_names: implicitItemNames,
              required_category_group_ids: requiredCategoryGroupIds,
              required_category_names: requiredCategoryNames,
            };
          });

          self.postMessage({ type: 'result', id, payload: { tasks } });
          break;
        }

        case 'getStatus': {
          // Ensure data is loaded, return current timestamp
          await getOrLoadData(lang, gameMode);
          self.postMessage({ type: 'result', id, payload: { timestamp: Date.now() } });
          break;
        }

        default:
          self.postMessage({ type: 'error', id, payload: `Unknown message type: ${type}` });
      }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', id, payload: msg });
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  dispatchChain = dispatchChain
    .then(() => dispatchMessage(event.data))
    .catch(() => {
      // Errors are reported via postMessage inside dispatchMessage; swallow
      // chain rejection so later requests still run.
    });
};
