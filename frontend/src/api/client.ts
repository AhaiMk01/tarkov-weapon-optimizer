import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
  fallback_base?: any;
  objective_value: number;
  reason?: string;
  final_stats?: FinalStats;
}

export type GameMode = 'regular' | 'pve';

export const getInfo = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<InfoResponse> => {
  const response = await apiClient.get<InfoResponse>('/api/info', { params: { game_mode: gameMode, lang } });
  return response.data;
};

export interface ModInfo {
  id: string;
  name: string;
  category: string;
  icon?: string;
}

export const getWeaponMods = async (weaponId: string, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<{ mods: ModInfo[] }> => {
  const response = await apiClient.get<{ mods: ModInfo[] }>(`/api/info/${weaponId}/mods`, { params: { game_mode: gameMode, lang } });
  return response.data;
};

export const optimize = async (request: OptimizeRequest, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<OptimizeResponse> => {
  const response = await apiClient.post<OptimizeResponse>('/api/optimize', request, { params: { game_mode: gameMode, lang } });
  return response.data;
};

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
}

export interface ExploreResponse {
  points: ExplorePoint[];
}

export const explore = async (request: ExploreRequest, gameMode: GameMode = 'regular', lang: string = 'en'): Promise<ExploreResponse> => {
  const response = await apiClient.post<ExploreResponse>('/api/explore', request, { params: { game_mode: gameMode, lang } });
  return response.data;
};

// Gunsmith Tasks
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

export const getGunsmithTasks = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<GunsmithTasksResponse> => {
  const response = await apiClient.get<GunsmithTasksResponse>('/api/gunsmith/tasks', { params: { game_mode: gameMode, lang } });
  return response.data;
};