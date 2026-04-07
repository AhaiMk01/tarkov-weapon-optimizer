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
  include_items?: string[];
  exclude_items?: string[];
  include_categories?: string[][];
  exclude_categories?: string[];
  ergo_weight?: number;
  recoil_weight?: number;
  price_weight?: number;
  trader_levels?: {
    prapor: number;
    skier: number;
    peacekeeper: number;
    mechanic: number;
    jaeger: number;
  };
  flea_available?: boolean;
  player_level?: number;
  /** Boolean values are normalized: true → precise, false → fast. */
  precise_mode?: boolean | SolverPrecisionMode;
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
}

export interface FinalStats {
  ergonomics: number;
  recoil_vertical: number;
  recoil_horizontal: number;
  total_price: number;
  total_weight: number;
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
}

export type GameMode = 'regular' | 'pve';

export interface ModInfo {
  id: string;
  name: string;
  category: string;
  /** BSG category id — must match solver `category_id` (not display name). */
  category_id: string;
  category_normalized: string;
  category_child_ids: string[];
  icon?: string;
  capacity?: number;
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

export const getWeaponMods = async (weaponId: string, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<{ mods: ModInfo[] }> => {
  return sendWorkerMessage<{ mods: ModInfo[] }>('getWeaponMods', { weaponId, lang, gameMode });
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
