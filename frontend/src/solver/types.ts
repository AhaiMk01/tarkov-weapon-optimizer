/**
 * Core types for the weapon optimizer solver.
 * Ported from Python backend (optimizer.py, schemas.py).
 */

// --- Offer / Price ---

export interface BarterRequirement {
  name: string;
  count: number;
  unit_price: number;
  icon?: string;
}

export interface OfferInfo {
  price: number;
  source: string;
  vendor_name: string;
  vendor_normalized: string;
  trader_level: number | null;
  barter_requirements?: BarterRequirement[];
  requires_dogtag?: boolean;
}

// --- Gun Stats ---

export interface GunStats {
  naked_ergonomics: number;
  naked_recoil_v: number;
  naked_recoil_h: number;
  default_ergonomics: number;
  default_recoil_v: number;
  default_recoil_h: number;
  default_preset_image: string | null;
  accuracy_modifier: number;
  fire_rate: number;
  fire_modes: string[];
  caliber: string;
  weight: number;
  width: number;
  height: number;
  sighting_range: number;
  category: string;
  category_id: string;
  handbook_categories?: string[];
  camera_snap: number;
  center_of_impact: number;
  deviation_max: number;
  deviation_curve: number;
  recoil_angle: number;
  recoil_dispersion: number;
  price: number;
  price_source: string;
}

// --- Mod Stats ---

export interface ModStats {
  ergonomics: number;
  recoil_modifier: number;
  accuracy_modifier: number;
  offers: OfferInfo[];
  /** False when API has no buyFor prices (barter-only / unlisted); build may still use x_i=1 (FiR) with buy_i=0 */
  purchasable: boolean;
  /** BSG base / avg24h when not purchasable — display reference only, not used in spend constraints */
  reference_price_rub?: number;
  price: number;
  price_source: string;
  weight: number;
  width: number;
  height: number;
  min_level_flea: number;
  capacity: number;
  sighting_range: number;
  category: string;
  category_id: string;
  /** Plural names from handbookCategories (e.g. ['Suppressors', 'Muzzle devices', ...]) */
  handbook_categories?: string[];
  /** BSG `bsgCategory.normalizedName` (e.g. `auxiliary-mod`). */
  category_normalized?: string;
  /** Child category ids under `bsgCategory` in the handbook tree (when non-empty, this node is not a taxonomy leaf). */
  category_child_ids?: string[];
}

// --- Slot Info ---

export interface SlotInfo {
  id: string;
  name: string;
  nameId: string;
  required: boolean;
  allowedItems: string[];
}

// --- Preset Info ---

export interface PresetInfo {
  id: string;
  name: string;
  items: string[];
  image: string | null;
  price: number;
  price_source: string;
  offers: OfferInfo[];
  purchasable: boolean;
}

// --- Item Lookup Entry ---

export interface GunLookupEntry {
  type: 'gun';
  data: Record<string, unknown>;
  slots: SlotInfo[];
  stats: GunStats;
  presets: PresetInfo[];
  all_presets: PresetInfo[];
}

export interface ModLookupEntry {
  type: 'mod';
  data: Record<string, unknown>;
  slots: SlotInfo[];
  stats: ModStats;
  conflicting_items: string[];
  conflicting_slot_ids: string[];
}

export type ItemLookupEntry = GunLookupEntry | ModLookupEntry;

export type ItemLookup = Record<string, ItemLookupEntry>;

// --- Compatibility Map ---

export interface CompatibilityMap {
  reachable_items: Record<string, { item: ItemLookupEntry }>;
  slot_items: Record<string, string[]>;
  item_to_slots: Record<string, string[]>;
  slot_owner: Record<string, string>;
}

// --- Solver Request / Response (matching frontend API client types) ---

export interface TraderLevels {
  prapor: number;
  skier: number;
  peacekeeper: number;
  mechanic: number;
  jaeger: number;
  [key: string]: number;
}

export const DEFAULT_TRADER_LEVELS: TraderLevels = {
  prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4,
};

// --- Worker Messages ---

export interface WorkerRequest {
  type: 'loadData' | 'optimize' | 'explore';
  id: number;
  payload: unknown;
}

export interface WorkerResponse {
  type: 'dataLoaded' | 'result' | 'error' | 'progress';
  id: number;
  payload: unknown;
}

export interface SolveParams {
  weaponId: string;
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  maxMOA?: number | null;
  includeItems?: string[] | null;
  excludeItems?: string[] | null;
  includeCategories?: string[][] | null;
  excludeCategories?: string[] | null;
  ergoWeight?: number;
  recoilWeight?: number;
  priceWeight?: number;
  traderLevels?: TraderLevels | null;
  fleaAvailable?: boolean;
  barterAvailable?: boolean;
  barterExcludeDogtags?: boolean;
  playerLevel?: number | null;
  preciseMode?: boolean;
}
