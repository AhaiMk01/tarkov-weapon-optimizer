import type { StructuralBounds } from './structuralBounds.ts';
import type { RuntimeGuard } from './runtimeGuard.ts';
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
  /**
   * Barters only: the units one barter delivers (JSON `offeredItem.count`, GraphQL `rewardItems[].count`), an integer >= 1.
   * `price` is the price of one whole lot. A lot is bought whole (INTERPRETATIONS.md choice 1): there is no per-unit price.
   * Absent on cash and flea offers (always one unit), on hand-built offers, and on a barter from a payload that predates lot sizes
   * (the pinned snapshot, where no gun, mod or preset barter delivers more than one unit); read it through `lotSizeOf`.
   */
  lot_size?: number;
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
  /** Purchase paths for the bare receiver. Trader offers only — see extractGunStats. */
  offers: OfferInfo[];
  price: number;
  price_source: string;
}

// --- Mod Stats ---

export interface ModStats {
  ergonomics: number;
  recoil_modifier: number;
  accuracy_modifier: number;
  /** Barrel-only: replaces weapon's intrinsic centerOfImpact when installed. 0 for non-barrel mods. */
  center_of_impact: number;
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
  /** Magnification range, derived from `zoomLevels`. Equal min/max means fixed
   *  power; both undefined for anything that is not a sight. */
  zoom_min?: number;
  zoom_max?: number;
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
  /**
   * The ids of `allowedItems` whose source item type is ammunition (`types` includes `ammo`): camora and chamber contents, which
   * are outside the physical build domain (INTERPRETATIONS.md choice 15). Ammunition is not an `ItemLookup` entry, so this is the
   * only place the data layer says an allowed id is ammunition. Omitted when no allowed item is ammunition, and for payloads
   * that carry no item types (hand-built lookups, the pinned snapshot).
   */
  ammoItems?: string[];
}

// --- Preset Info ---

/**
 * One component of a factory preset: `count` copies of `itemId`, supplied at no extra cost
 * (the q_{b,i} of the model). The single count-bearing representation of preset contents:
 * a preset never degrades to a flat id list or a Set of ids.
 */
export interface PresetComponent {
  itemId: string;
  /** Finite nonnegative integer, validated at the source; never defaulted. */
  count: number;
}

export interface PresetInfo {
  id: string;
  name: string;
  /**
   * The receiver (gun) the preset is built on. This is base identity, kept apart from component
   * supply: the receiver entry of the raw `containsItems` is not an installable stock item and is
   * not repeated in `items`.
   */
  receiver_id: string;
  /**
   * Supplied component stock, one entry per distinct item in source order. Repeated source entries
   * for one item are summed by the extractor; a consumer that builds its own list must sum too.
   */
  items: PresetComponent[];
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

/**
 * Unlocked loyalty level per trader, keyed by `normalizedName`.
 * `TRADER_DISABLED` (0) means "do not buy from this trader at all" — every
 * trader offer requires at least LL1, so a 0 here excludes all of them via the
 * existing level check in `getAvailablePrice`.
 */
export interface TraderLevels {
  prapor: number;
  skier: number;
  peacekeeper: number;
  mechanic: number;
  jaeger: number;
  /** Ref sells weapon mods via GP-coin barters at LL1-4. */
  ref: number;
  [key: string]: number;
}

/** Sentinel loyalty level meaning "trader disabled". */
export const TRADER_DISABLED = 0;

export const DEFAULT_TRADER_LEVELS: TraderLevels = {
  prapor: 4, skier: 4, peacekeeper: 4, mechanic: 4, jaeger: 4, ref: 4,
};

export interface IdealPoint {
  zE: number;
  nadE: number;
  zR: number;
  nadR: number;
  zP: number;
  nadP: number;
}

// --- Transport contract (ADR 0013 section 5): the leaf types, defined once and re-exported by api/client.ts ---

/** What the caller asked for: Fast, Precise, or Auto (Precise when the exact model is small enough to solve to a proof). */
export type PrecisionRequest = 'fast' | 'precise' | 'auto';
/** What actually ran; `null` before any model work (an invalid request). */
export type PrecisionResolved = 'fast' | 'precise' | null;
/** `exact`: the occurrence-level model; `approximate`: the Fast template-count model; `null`: no model ran. */
export type ModelQualification = 'exact' | 'approximate' | null;
/** `provisional_model` when the result depends on the provisional MOA model (a MOA cap), otherwise `null` (never 'n/a'). */
export type MoaQualification = 'provisional_model' | null;
export type SolveStatus = 'optimal' | 'feasible' | 'incomplete' | 'infeasible' | 'error';
/**
 * The authority of a result about the PHYSICAL problem: `certified_*` only from a qualified Precise proof that does not depend on the
 * provisional MOA model; `approximate_optimal` for a Fast or MOA-dependent model optimum; `feasible` for a verified build with no proof;
 * `none` when there is no build and no certified emptiness.
 */
export type PhysicalCertificate = 'certified_optimal' | 'approximate_optimal' | 'feasible' | 'certified_infeasible' | 'none';

/**
 * One installed occurrence attached to a physical slot `(parentInstanceId, slotId)` of its parent (ADR 0013 section 5): the unit of
 * `OptimizeResponse.slot_pairs`. Instance ids are path-derived (`weapon_0/slot:item/slot:item...`), unique per installed copy.
 */
export interface Placement {
  parentInstanceId: string;
  /** Template slot id on the parent. */
  slotId: string;
  childInstanceId: string;
  /** Template id of the installed item. */
  itemId: string;
}

/**
 * Classifiers the physical model needs from data the lookup alone cannot supply. Production data carries both (`SlotInfo.ammoItems`, the
 * nested `data.bsgCategory` chain), so they are optional extras for payloads that do not: a hand-built lookup, the pinned snapshot, the
 * differential harness. They apply to the blueprint AND to the independent validator, which must see the same domain.
 */
export interface PhysicalClassifiers {
  /** True for an allowed id the lookup does not hold that is ammunition (camora and chamber contents are outside the physical domain). */
  isAmmo?: (itemId: string) => boolean;
  /** Category chain of an item, own category first (INTERPRETATIONS.md choice 5). */
  categoryChainOf?: (itemId: string, entry: ItemLookupEntry) => readonly string[];
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
  /** Optimize the exact gear-adjusted TrueErgo Delta instead of raw ergonomics. */
  useTrueErgo?: boolean;
  /** When true, uses augmented Tchebycheff scalarization to reach non-convex/unsupported Pareto builds. */
  useTchebycheff?: boolean;
  /** Precomputed ideal/nadir reference point for Tchebycheff scalarization. */
  idealPoint?: IdealPoint;
  /** Require W * (1 - effectiveErgo / 100) <= 3. */
  preventOverswing?: boolean;
  /** Equipment ergonomics modifier b as a decimal percentage (e.g. -0.15 for -15% armor penalty). */
  equipErgoModifier?: number | null;
  /**
   * Absolute scalarized-objective certification tolerance (default 1e-5), honoured as requested: it is neither floored nor padded by a
   * fixed margin. The native MIP gap is at most a quarter of it.
   */
  objectiveTolerance?: number;
  /** Spatial branch-and-bound limits; reaching either never proves infeasibility. */
  maxSpatialNodes?: number;
  /**
   * The runtime guard of the request epoch (ADR 0013 section 4D): one queue-inclusive deadline, the out-of-band cancel flag and the macrotask
   * yield. When present it is the only clock: the pipelines check it before every stage and after every yield. Without it the solve builds a
   * guard from `timeLimitMs` (no cancel source), which keeps direct callers working.
   */
  guard?: RuntimeGuard;
  /**
   * A time allowance from the moment the solve starts (default 60 s). With a `guard` it can only narrow the guard's deadline (a share of the
   * request's time given to a sub-solve), never extend it.
   */
  timeLimitMs?: number;
  traderLevels?: TraderLevels | null;
  fleaAvailable?: boolean;
  barterAvailable?: boolean;
  barterExcludeDogtags?: boolean;
  playerLevel?: number | null;
  /**
   * Stash multiset (ADR 0008): one entry per owned copy, duplicates kept, unknown ids retained. Omitted or [] means no stock.
   * At most 10,000 nonempty strings with no sparse holes; anything else is the typed input error `INVALID_OWNED_ITEMS`
   * (`physical/ownedItems.ts`, public reason `Invalid owned_items format`), never infeasibility. Owning a part supplies copies
   * of it at no cost but never grants a receiver. Precise and Fast both honour it. The runtime snapshots it once at the worker boundary
   * (a frozen copy) and forwards that snapshot unchanged to every solve of the request.
   */
  ownedItems?: readonly string[];
  /** Classifiers for payloads without ammunition flags or category chains; see {@link PhysicalClassifiers}. */
  physicalOptions?: PhysicalClassifiers;
  preciseMode?: boolean;
  /**
   * What the caller asked for, echoed as `precision_request` (an Auto request that the caller resolved into `preciseMode` is still 'auto').
   * Default: 'precise' when `preciseMode` is true, otherwise 'fast'. It never changes what runs: `preciseMode` does (a TrueErgo or Prevent
   * Overswing request is not upgraded to Precise: Fast runs the weight search on its own count model), and `precision_resolved` says what ran.
   */
  precisionRequest?: PrecisionRequest;
  /** Strategy for weight and ergonomics bounds: 'structural' (default) or 'naive' (sum of all mods). */
  boundsMode?: 'structural' | 'naive';
  /** Precomputed structural bounds on weight and ergonomics. */
  structuralBounds?: StructuralBounds;
}
