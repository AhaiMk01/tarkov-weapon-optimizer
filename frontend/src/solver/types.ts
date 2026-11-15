import type { DomainParams } from './domainFields.ts';
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
 * level check of the physical acquisition domain (`physical/acquisition.ts`).
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
/** `exact`: the Precise model (the certified count model, owner decision 2e); `approximate`: the Fast template-count model; `null`: no model ran. */
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

/**
 * One solve. The request domain (the weapon, the hard constraints, the filters, the model flags and the acquisition settings) is `DomainParams`,
 * listed once in `domainFields.ts`; what is below is the rest of a solve: the loaded data, the objective, the model options and the clock.
 */
export interface SolveParams extends Pick<DomainParams, 'weaponId'>, Partial<Omit<DomainParams, 'weaponId'>> {
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  ergoWeight?: number;
  recoilWeight?: number;
  priceWeight?: number;
  /** When true, uses augmented Tchebycheff scalarization to reach non-convex/unsupported Pareto builds. */
  useTchebycheff?: boolean;
  /** Precomputed ideal/nadir reference point for Tchebycheff scalarization. */
  idealPoint?: IdealPoint;
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
   * FAST ONLY (owner decision 2c). When the resolved mode is Fast and this is not exactly `true`, the Fast model installs at most ONE copy of
   * each part (the default). `true` restores the full count model, which may repeat a part. Precise ignores it and always allows repeats.
   */
  allowRepeatedParts?: boolean;
  /**
   * What the caller asked for, echoed as `precision_request` (an Auto request that the caller resolved into `preciseMode` is still 'auto').
   * Default: 'precise' when `preciseMode` is true, otherwise 'fast'. It never changes what runs: `preciseMode` does (a TrueErgo or Prevent
   * Overswing request is not upgraded to Precise: Fast runs the weight search on its own count model), and `precision_resolved` says what ran.
   */
  precisionRequest?: PrecisionRequest;
}

// ---------------------------------------------------------------------------------------------
// The request wire contract (ADR 0013 section 5). Defined here, DOM-free, so `domainFields.ts` (the request domain) and the reference harness can read
// it; `api/client.ts` re-exports it with the other transport records.
// ---------------------------------------------------------------------------------------------

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
  /**
   * Stash multiset (ADR 0008): one entry per owned copy, so `['m', 'm']` is two copies. Omitted or [] means no stock. At most
   * 10,000 nonempty strings; an invalid list is rejected as `Invalid owned_items format`, never reported as infeasible.
   * Inherited by `ExploreRequest`. The worker validates it first (before hashing, caching or any model work) and forwards the validated
   * multiset to every solve of the request: Optimize, the Gunsmith optimize call, every Explore step and every floor trial.
   */
  owned_items?: string[];
  /** Boolean values are normalized: true → precise, false → fast. */
  precise_mode?: boolean | PrecisionRequest;
  /**
   * Fast only (owner decision 2c, default false): when the request runs in Fast mode, `true` lets the model install several copies of one part. Without
   * it Fast uses at most one copy of each part. Precise ignores it and always allows repeats. Reaches every Fast solve of the request: Optimize,
   * the Tchebycheff payoff endpoints, every Explore step and the Gunsmith call. The MOA floor (always Precise) does not carry it.
   */
  allow_repeated_parts?: boolean;
  /**
   * Request budget in milliseconds. ONE epoch deadline is stamped when the call enters, so time spent queued counts. Omitted means the
   * default of the operation: 60 s for Optimize and Explore, 30 s for a MOA floor.
   */
  time_limit_ms?: number;
}

/** The complete normalized scope a MOA-floor witness was found under (ADR 0013 section 5): a cap trial is its own prepared domain. */
export interface WitnessScope {
  weapon_id: string;
  precision_resolved: 'fast' | 'precise';
  model_qualification: 'exact' | 'approximate';
  moa_qualification: 'provisional_model';
  /** The MOA cap this witness was found under; `null` for the unconstrained seed. */
  max_moa: number | null;
  acquisition: {
    trader_levels: Record<string, number> | null;
    flea_available: boolean;
    barter_available: boolean;
    barter_exclude_dogtags: boolean;
    player_level: number | null;
  };
  feasibility: {
    max_price: number | null;
    min_ergonomics: number | null;
    max_recoil_v: number | null;
    max_recoil_sum: number | null;
    min_mag_capacity: number | null;
    min_sighting_range: number | null;
    max_weight: number | null;
    include_items: string[] | null;
    exclude_items: string[] | null;
    include_categories: string[][] | null;
    exclude_categories: string[] | null;
    prevent_overswing: boolean;
    equip_ergo_modifier: number | null;
  };
  inventory: { owned_items: string[] };
}

/**
 * A MOA floor request (ADR 0013 section 5): the normalized Optimize domain except the MOA cap being searched. The objective is a constant
 * zero, the placement model is always Precise and the weights are irrelevant, so those fields are not part of it. `time_limit_ms` defaults
 * to 30 s.
 */
export type MOAFloorRequest = Omit<OptimizeRequest, 'max_moa' | 'ergo_weight' | 'recoil_weight' | 'price_weight' | 'use_tchebycheff' | 'precise_mode' | 'allow_repeated_parts'>;
