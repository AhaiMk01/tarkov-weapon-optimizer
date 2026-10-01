import { ensureDataLoaded } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { computeStructuralBounds } from '../../src/solver/structuralBounds';
import { solve } from '../../src/solver/solver';
import { solveAdaptiveEnvelope } from './adaptiveEnvelope';
import { solveNodeOptionTuning, TUNED_NODE_OPTIONS } from './nodeOptionTuning';
import type { OptimizeRequest, OptimizeResponse } from '../../src/api/client';
import type { ItemLookup, CompatibilityMap } from '../../src/solver/types';

interface LoadedData {
  itemLookup: ItemLookup;
  compatMaps: Record<string, CompatibilityMap>;
}

let loadedData: LoadedData | null = null;

async function getData(lang = 'en', gameMode = 'regular') {
  if (!loadedData) {
    const state = await ensureDataLoaded(lang, gameMode);
    loadedData = {
      itemLookup: state.itemLookup,
      compatMaps: {},
    };
  }
  return loadedData;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;

  if (type === 'ping') {
    self.postMessage({ id, payload: { status: 'ready' } });
    return;
  }

  if (type === 'optimize') {
    const req = payload.request as OptimizeRequest & { spatial_candidate?: 'adaptive-envelope' | 'node-option-tuning' | 'control' };
    const data = await getData(payload.lang, payload.gameMode);
    
    let compatMap = data.compatMaps[req.weapon_id];
    if (!compatMap) {
      compatMap = buildCompatibilityMap(req.weapon_id, data.itemLookup);
      data.compatMaps[req.weapon_id] = compatMap;
    }

    const bounds = computeStructuralBounds(req.weapon_id, data.itemLookup, compatMap, { maxWeight: req.max_weight ?? null });

    const params = {
      weaponId: req.weapon_id,
      itemLookup: data.itemLookup,
      compatibilityMap: compatMap,
      structuralBounds: bounds,
      maxPrice: req.max_price,
      minErgonomics: req.min_ergonomics,
      maxRecoilV: req.max_recoil_v,
      maxRecoilSum: req.max_recoil_sum,
      minMagCapacity: req.min_mag_capacity,
      minSightingRange: req.min_sighting_range,
      maxWeight: req.max_weight,
      maxMOA: req.max_moa,
      includeItems: req.include_items,
      excludeItems: req.exclude_items,
      includeCategories: req.include_categories,
      excludeCategories: req.exclude_categories,
      ergoWeight: req.ergo_weight,
      recoilWeight: req.recoil_weight,
      priceWeight: req.price_weight,
      useTrueErgo: req.use_true_ergo ?? false,
      preventOverswing: req.prevent_overswing ?? false,
      equipErgoModifier: req.equip_ergo_modifier,
      objectiveTolerance: req.objective_tolerance ?? 1e-5,
      maxSpatialNodes: req.max_spatial_nodes ?? 512,
      timeLimitMs: req.time_limit_ms ?? 60_000,
      traderLevels: req.trader_levels,
      fleaAvailable: req.flea_available ?? true,
      barterAvailable: req.barter_available ?? false,
      barterExcludeDogtags: req.barter_exclude_dogtags ?? false,
      playerLevel: req.player_level,
      preciseMode: req.precise_mode === 'fast' ? false : true,
      boundsMode: req.bounds_mode ?? 'structural',
    };

    const startTime = performance.now();
    let res: OptimizeResponse;
    const cand = req.spatial_candidate ?? 'control';

    if (cand === 'adaptive-envelope') {
      res = await solveAdaptiveEnvelope(params);
    } else if (cand === 'node-option-tuning') {
      res = await solveNodeOptionTuning(params);
    } else {
      res = await solve(params);
    }

    const elapsedMs = performance.now() - startTime;
    self.postMessage({
      id,
      payload: {
        ...res,
        worker_elapsed_ms: elapsedMs,
        spatial_candidate: cand,
        mechanism_telemetry: {
          candidate: cand,
          nodes: res.optimization?.nodes ?? 1,
          termination: res.optimization?.termination ?? (res.status === 'optimal' ? 'optimal' : 'limit'),
          lower_bound: res.optimization?.lower_bound ?? res.objective_value,
          upper_bound: res.optimization?.upper_bound,
          gap: res.optimization?.absolute_gap,
          tuned_options: cand === 'node-option-tuning' ? TUNED_NODE_OPTIONS : undefined,
        },
      },
    });
  }
};
