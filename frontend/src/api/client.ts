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
  precise_mode?: boolean;
}

export interface ItemDetail {
  id: string;
  name: string;
  price: number;
  icon?: string;
  source?: string;
  ergonomics: number;
  recoil_modifier: number;
}

export interface PresetDetail {
  id: string;
  name: string;
  price: number;
  items: string[];
  icon?: string;
  source?: string;
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
}

export type GameMode = 'regular' | 'pve';

export interface ModInfo {
  id: string;
  name: string;
  category: string;
  icon?: string;
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
  status: string;
  solve_time_ms?: number;
}

export interface ExploreResponse {
  points: ExplorePoint[];
  total_solve_time_ms?: number;
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

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('../solver/solver.worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (event) => {
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
    worker.onerror = (event) => {
      console.error('Worker error:', event);
    };
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
