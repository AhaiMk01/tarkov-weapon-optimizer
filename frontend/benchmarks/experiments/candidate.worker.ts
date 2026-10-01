import { ensureDataLoaded } from '../../src/solver/dataService';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { computeStructuralBounds } from '../../src/solver/structuralBounds';
import { canonicalizeTraderLevels } from '../../src/solver/reuseKey';
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

export const PROVENANCE_RECORD = {
  matching_control_revision: '518017b',
  wasm_sha256: '57e4abcb4b9e96370ae9e5b9fa1e4a88af23a13e34bd361228f6af0bd76bb20d',
  supported_candidates: ['adaptive-envelope', 'node-option-tuning', 'control'] as const,
  exact_proof_settings: TUNED_NODE_OPTIONS,
};

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;

  if (type === 'getProvenance' || type === 'getStatus') {
    self.postMessage({ id, payload: PROVENANCE_RECORD });
    return;
  }

  if (type === 'optimize') {
    // 1. Preparation-inclusive deadline: clock starts immediately upon message receipt
    const reqStart = performance.now();
    const req = payload.request as OptimizeRequest & { spatial_candidate?: 'adaptive-envelope' | 'node-option-tuning' | 'control' };
    const totalLimitMs = Math.max(0, req.time_limit_ms ?? 60_000);
    const deadline = reqStart + totalLimitMs;

    // 2. Canonicalize request parameters
    const canonicalTraders = req.trader_levels ? (canonicalizeTraderLevels(req.trader_levels) as any) : undefined;
    const cand = req.spatial_candidate ?? 'control';

    // 3. Explicit candidate gate: reject unknown candidate requests
    if (!PROVENANCE_RECORD.supported_candidates.includes(cand)) {
      self.postMessage({
        id,
        payload: {
          status: 'incomplete',
          reason: `Unsupported spatial candidate: ${cand}`,
          selected_items: [],
          objective_value: 0,
          solve_time_ms: performance.now() - reqStart,
        },
      });
      return;
    }

    // 4. Data and structural bound preparation charged against request deadline
    const data = await getData(payload.lang, payload.gameMode);
    let compatMap = data.compatMaps[req.weapon_id];
    if (!compatMap) {
      compatMap = buildCompatibilityMap(req.weapon_id, data.itemLookup);
      data.compatMaps[req.weapon_id] = compatMap;
    }

    const bounds = computeStructuralBounds(req.weapon_id, data.itemLookup, compatMap, { maxWeight: req.max_weight ?? null });

    const prepElapsed = performance.now() - reqStart;
    const remainingForSolve = Math.max(0, deadline - performance.now());

    if (remainingForSolve <= 0) {
      self.postMessage({
        id,
        payload: {
          status: 'incomplete',
          reason: 'Request time limit reached during upfront preparation',
          selected_items: [],
          objective_value: 0,
          solve_time_ms: prepElapsed,
          mechanism_telemetry: {
            candidate: cand,
            nodes: 0,
            prep_elapsed_ms: prepElapsed,
            termination: 'limit',
          },
        },
      });
      return;
    }

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
      timeLimitMs: remainingForSolve, // Strictly preparation-inclusive
      traderLevels: canonicalTraders,
      fleaAvailable: req.flea_available ?? true,
      barterAvailable: req.barter_available ?? false,
      barterExcludeDogtags: req.barter_exclude_dogtags ?? false,
      playerLevel: req.player_level,
      preciseMode: req.precise_mode === 'fast' ? false : true,
      boundsMode: req.bounds_mode ?? 'structural',
    };

    let res: OptimizeResponse & { mechanism_telemetry?: any };

    if (cand === 'adaptive-envelope') {
      res = await solveAdaptiveEnvelope(params);
    } else if (cand === 'node-option-tuning') {
      res = await solveNodeOptionTuning(params);
    } else {
      res = await solve(params);
    }

    const totalElapsedMs = performance.now() - reqStart;
    
    // 5. Lossless telemetry payload
    const lowerBound = res.optimization?.lower_bound ?? res.objective_value;
    const upperBound = res.optimization?.upper_bound ?? null;
    const hasUpper = upperBound != null && Number.isFinite(upperBound);
    const absGap = hasUpper ? Math.max(0, upperBound - lowerBound) : null;
    const normGap = (hasUpper && absGap != null) ? absGap / Math.max(1, Math.abs(lowerBound)) : null;

    self.postMessage({
      id,
      payload: {
        ...res,
        solve_time_ms: totalElapsedMs,
        spatial_candidate: cand,
        provenance: PROVENANCE_RECORD,
        prep_elapsed_ms: prepElapsed,
        mechanism_telemetry: {
          candidate: cand,
          nodes: res.optimization?.nodes ?? 1,
          termination: res.optimization?.termination ?? (res.status === 'optimal' ? 'optimal' : 'limit'),
          lower_bound: lowerBound,
          upper_bound: upperBound,
          absolute_gap: absGap,
          normalized_gap: normGap,
          ...(res.mechanism_telemetry || {}),
        },
      },
    });
  }
};
