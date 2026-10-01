import type { IdealPoint } from '../solver/types';
export type { IdealPoint } from '../solver/types';

/**
 * API Client - uses Web Worker + HiGHS solver instead of HTTP backend.
 * All exported function signatures remain identical for UI compatibility.
 */

// --- Type exports (unchanged) ---

export interface Gun {
  id: string;
  name: string;
  image?: string;
  category: string;
  caliber: string;
  base_moa?: number;
}

export interface InfoResponse {
  guns: Gun[];
}

/** Solver LP mode: Fast (default omit), Precise, or Auto (precise when mod tree is small). */
export type SolverPrecisionMode = 'auto' | 'fast' | 'precise';

export interface OptimizeRequest {
  weapon_id: string;
  max_price?: number;
  min_ergonomics?: number;
  max_recoil_v?: number;
  max_recoil_sum?: number;
  min_mag_capacity?: number;
  min_sighting_range?: number;
  max_weight?: number;
  prevent_overswing?: boolean;
  /** Equipment ergonomics modifier b as a decimal percentage (e.g. -0.15 for -15% armor penalty). */
  equip_ergo_modifier?: number;
  max_moa?: number;
  include_items?: string[];
  exclude_items?: string[];
  include_categories?: string[][];
  exclude_categories?: string[];
  ergo_weight?: number;
  recoil_weight?: number;
  price_weight?: number;
  /** Optimize gear-adjusted TrueErgo Delta rather than raw ergonomics. */
  use_true_ergo?: boolean;
  /** When true, uses augmented Tchebycheff scalarization to reach non-convex/unsupported Pareto builds. */
  use_tchebycheff?: boolean;
  /** Unlocked loyalty level per trader `normalizedName`; 0 disables the trader. */
  trader_levels?: {
    prapor: number;
    skier: number;
    peacekeeper: number;
    mechanic: number;
    jaeger: number;
    ref: number;
    [key: string]: number;
  };
  flea_available?: boolean;
  barter_available?: boolean;
  barter_exclude_dogtags?: boolean;
  player_level?: number;
  /** Boolean values are normalized: true → precise, false → fast. */
  precise_mode?: boolean | SolverPrecisionMode;
  /** Strategy for weight and ergonomics bounds: 'structural' (default) or 'naive' (sum of all mods). */
  bounds_mode?: 'structural' | 'naive';
  /** Shared request deadline in milliseconds. Omitted means the solver default (60s). */
  time_limit_ms?: number;
  /**
   * Keep a validated time-limit build as a lower bound only.
   * Omitted means the legacy search, which does not adopt that build.
   */
  retain_limit_incumbent?: boolean;
}
export interface ItemDetail {
  id: string;
  name: string;
  price: number;
  icon?: string;
  source?: string;
  /** When false, part is not on traders/flea in API — optimizer assumes FiR/owned (buy cost 0) */
  purchasable?: boolean;
  /** BSG reference value for display when not purchasable */
  reference_price_rub?: number;
  ergonomics: number;
  recoil_modifier: number;
  barter_requirements?: Array<{ name: string; count: number; unit_price: number; icon?: string }>;
  // Tooltip extras
  image_large?: string;
  accuracy_modifier?: number;
  weight?: number;
  category?: string;
  handbook_categories?: string[];
  capacity?: number;
  sighting_range?: number;
  /** TED the build gains from this part: TED(build) - TED(build without it). */
  ted_delta?: number;
}

export interface PresetDetail {
  id: string;
  name: string;
  price: number;
  items: string[];
  icon?: string;
  /** API source key for the offer used (e.g. trader id, fleaMarket) */
  source?: string;
  /** Human-readable seller for the preset price (e.g. "Prapor", "Flea Market") */
  purchase_label?: string;
  barter_requirements?: Array<{ name: string; count: number; unit_price: number; icon?: string }>;
  // Tooltip extras
  image_large?: string;
  caliber?: string;
  fire_rate?: number;
  fire_modes?: string[];
  default_ergo?: number;
  default_recoil_v?: number;
  default_recoil_h?: number;
  weight?: number;
  parts_count?: number;
}

export interface FinalStats {
  ergonomics: number;
  recoil_vertical: number;
  recoil_horizontal: number;
  total_price: number;
  total_weight: number;
  /** Effective ergonomics minus max(0, 100 - 300 / weightKg). */
  true_ergo_delta?: number;
  /** Aim-in kick strength, 0 (none) to 100 (full). Nonzero exactly when TED < 0. */
  overswing_pct?: number;
  moa: number;
}

export interface RetentionTelemetry {
  /** How many MIP solves in the spatial tree stopped at a limit rather than optimality. */
  timeout_count: number;
  /** How many limit solutions had all expected columns integral and passed validateBuild. */
  eligible_count: number;
  /** How many limit solutions were adopted as the incumbent. */
  adopted_count: number;
  /** True if any adopted limit solution increased incumbent.objective_value. */
  improved_lower_bound: boolean;
}

export interface OptimizeResponse {
  status: string;
  selected_items: ItemDetail[];
  selected_preset?: PresetDetail;
  fallback_base?: Record<string, unknown>;
  objective_value: number;
  reason?: string;
  final_stats?: FinalStats;
  solve_time_ms?: number;
  precision_request?: SolverPrecisionMode;
  precision_resolved?: 'fast' | 'precise';
  /** Slot-item pairs [slotId, itemId][] for EFTForge build export */
  slot_pairs?: [string, string][];
  /** Certified bounds on the maximizing scalarized objective. */
  optimization?: {
    lower_bound: number;
    upper_bound: number;
    absolute_gap: number;
    tolerance: number;
    nodes: number;
    termination: 'optimal' | 'limit';
  };
  /** Tchebycheff mode: ideal/nadir reference point used during scalarization. */
  ideal_point?: IdealPoint;
  /** Telemetry on whether incumbent retention operated during spatial search. */
  retention_telemetry?: RetentionTelemetry;
}

export type GameMode = 'regular' | 'pve';

export interface ModInfo {
  id: string;
  name: string;
  category: string;
  /** BSG category id — must match solver `category_id` (not display name). */
  category_id: string;
  category_normalized: string;
  handbook_categories: string[];
  category_child_ids: string[];
  icon?: string;
  capacity?: number;
  /** Magnification range for sights; equal values mean fixed power. */
  zoom_min?: number;
  zoom_max?: number;
  accuracy_modifier?: number;
  /** Barrel-only: centerOfImpact × MOA_K (MOA units). Replaces weapon base_moa when installed. */
  base_moa?: number;
}

export interface ModCategoryOption {
  id: string;
  name: string;
}

export interface ExploreRequest extends OptimizeRequest {
  ignore: 'price' | 'recoil' | 'ergo';
  steps?: number;
}

export interface ExplorePoint {
  ergo: number;
  recoil_pct: number;
  recoil_v: number;
  recoil_h: number;
  price: number;
  selected_items: ItemDetail[];
  selected_preset?: PresetDetail;
  slot_pairs?: [string, string][];
  status: string;
  solve_time_ms?: number;
  /** Set by the UI when overlaying multiple weapons on one explore chart. */
  weapon_id?: string;
  weapon_name?: string;
}

export interface ExploreResponse {
  points: ExplorePoint[];
  total_solve_time_ms?: number;
  precision_request?: SolverPrecisionMode;
  precision_resolved?: 'fast' | 'precise';
}

export interface GunsmithConstraints {
  min_ergonomics?: number;
  max_recoil_sum?: number;
  min_mag_capacity?: number;
  min_sighting_range?: number;
  max_weight?: number;
}

export interface GunsmithTask {
  task_name: string;
  weapon_id: string;
  weapon_name: string;
  weapon_image?: string;
  constraints: GunsmithConstraints;
  required_item_ids: string[];
  required_item_names: string[];
  /** Auto-added hosts when a required mod has no weapon slot and only one parent mod chain */
  implicit_required_item_ids?: string[];
  implicit_required_item_names?: string[];
  required_category_group_ids: string[][];
  required_category_names: string[][];
}

export interface GunsmithTasksResponse {
  tasks: GunsmithTask[];
}

// --- Worker Communication ---

let worker: Worker | null = null;
let messageId = 0;
const pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

function rejectAllPending(reason: Error): void {
  for (const [, pending] of pendingRequests) {
    pending.reject(reason);
  }
  pendingRequests.clear();
}

/** Terminate the worker and fail all in-flight requests (fatal worker failure). */
function resetWorker(reason: Error): void {
  rejectAllPending(reason);
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function getWorker(): Worker {
  if (!worker) {
    const w = new Worker(
      new URL('../solver/solver.worker.ts', import.meta.url),
      { type: 'module' }
    );
    w.onmessage = (event: MessageEvent<{ type: string; id: number; payload: unknown }>) => {
      const { type, id, payload } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);

      if (type === 'error') {
        pending.reject(new Error(payload as string));
      } else {
        pending.resolve(payload);
      }
    };
    w.onerror = (event) => {
      console.error('Worker error:', event);
      const msg = event.message || 'Web Worker failed';
      resetWorker(new Error(msg));
    };
    w.onmessageerror = (event) => {
      console.error('Worker message error:', event);
      resetWorker(new Error('Web Worker message error'));
    };
    worker = w;
  }
  return worker;
}

function sendWorkerMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = messageId++;
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    getWorker().postMessage({ type, id, payload });
  });
}

// --- Exported API functions (same signatures, local solver) ---

export const getInfo = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<InfoResponse> => {
  return sendWorkerMessage<InfoResponse>('getInfo', { lang, gameMode });
};

/**
 * Slice of the compatibility graph the mod picker needs to grey out parts that
 * cannot coexist with the current picks. `conflicts` is symmetric; `slots_by_item`
 * lists every slot an item could occupy. Only built when asked for -- see
 * `withCompat` on getWeaponMods.
 */
export interface ModCompatibility {
  conflicts: Record<string, string[]>;
  slots_by_item: Record<string, string[]>;
}

/**
 * `withCompat` adds the conflict/slot graph. Off by default: Explore's comparison
 * fetches one list per weapon and would throw every one of those graphs away.
 */
export const getWeaponMods = async (
  weaponId: string,
  gameMode: GameMode = 'regular',
  lang: string = 'en',
  opts: { withCompat?: boolean } = {},
): Promise<{ mods: ModInfo[] } & Partial<ModCompatibility>> => {
  return sendWorkerMessage<{ mods: ModInfo[] } & Partial<ModCompatibility>>('getWeaponMods', { weaponId, lang, gameMode, withCompat: opts.withCompat === true });
};

export const optimize = async (request: OptimizeRequest, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<OptimizeResponse> => {
  return sendWorkerMessage<OptimizeResponse>('optimize', { request, lang, gameMode });
};

export const explore = async (request: ExploreRequest, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<ExploreResponse> => {
  return sendWorkerMessage<ExploreResponse>('explore', { request, lang, gameMode });
};

export const getGunsmithTasks = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<GunsmithTasksResponse> => {
  return sendWorkerMessage<GunsmithTasksResponse>('getGunsmithTasks', { lang, gameMode });
};

export const getStatus = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<{ timestamp: number }> => {
  return sendWorkerMessage<{ timestamp: number }>('getStatus', { lang, gameMode });
};

export const computeMOAFloor = async (weaponId: string, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<{ floor: number }> => {
  return sendWorkerMessage<{ floor: number }>('computeMOAFloor', { weaponId, lang, gameMode });
};

/**
 * Wipe IndexedDB cache and terminate the worker (clearing its in-memory dataCache).
 * Caller should reload the page afterwards so stores re-fetch fresh data from tarkov.dev.
 * DB name kept in sync with `DB_NAME` in solver/dataService.ts.
 */
export const clearDataCache = async (): Promise<void> => {
  resetWorker(new Error('Cache cleared by user'));
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('tarkov-optimizer-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
};
