import type {
  IdealPoint, MOAFloorRequest, ModelQualification, MoaQualification, OptimizeRequest, Placement, PhysicalCertificate, PrecisionRequest, PrecisionResolved,
  PresetComponent, SolveStatus, WitnessScope,
} from '../solver/types';
import {
  DEFAULT_EXPLORE_TIME_LIMIT_MS, DEFAULT_FLOOR_TIME_LIMIT_MS, DEFAULT_OPTIMIZE_TIME_LIMIT_MS, resolveTimeLimit,
} from '../solver/workerProtocol';
import { WorkerChannel } from './workerChannel';
import type { RequestOptions, WorkerLike } from './workerChannel';
// The shared transport contract (ADR 0013 section 5). Its leaf types are defined once in solver/types.ts (DOM-free, so the solver and the
// reference harness can read them) and re-exported here with the request/response records that use them.
export type {
  IdealPoint, MOAFloorRequest, ModelQualification, MoaQualification, OptimizeRequest, Placement, PhysicalCertificate, PrecisionRequest, PrecisionResolved,
  PresetComponent, SolveStatus, WitnessScope,
} from '../solver/types';

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


/**
 * How one installed occurrence is supplied (ADR 0013 section 4A): the preset's own stock, an owned copy, or a purchase of a whole lot of
 * one offer. The charge of a paid lot is on its first occurrence (`ItemDetail.price`), the other units of the lot ride on it at 0.
 */
export interface ItemAcquisition {
  source: 'preset' | 'owned' | 'offer';
  /** The preset the unit comes from (`preset` only). */
  presetId: string | null;
  /** The offer's source key: `fleaMarket`, a trader key or `barter:<trader>` (`offer` only). */
  offerSource: string | null;
  /** Index into the item's offers (`offer` only). */
  offerIndex: number | null;
}

export interface ItemDetail {
  id: string;
  /** Unique per installed copy (path-derived, matches `Placement.childInstanceId`); `id` is the template id and repeats for copies. */
  instanceId: string;
  /** Exact per-occurrence acquisition: preset stock, owned copy, or the offer bought. */
  acquisition?: ItemAcquisition;
  name: string;
  price: number;
  icon?: string;
  source?: string;
  /** When false, the API lists no trader or flea offer for the part: it can only be supplied by the base preset or by owned stock (see `acquisition`). */
  purchasable?: boolean;
  /** BSG reference value of a part that has no offer (informational only: it never enters a spend). */
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
  /** The receiver the base is built on. Equal to `id` for the naked receiver. */
  receiver_id: string;
  /** Supplied component stock with quantities ({ itemId, count }); empty for the naked receiver. */
  items: PresetComponent[];
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
  /** Number of distinct component items the preset supplies (not the sum of their counts). */
  parts_count?: number;
  /**
   * How the base is supplied (ADR 0013 section 4A, amendment 2026-10-14): `offer` when it is bought at `price`, `owned` when it is the
   * player's own naked receiver. A base is owned only when the gun has no legal offer and none of its presets has one; it then costs 0, has
   * no seller and is never a purchase line.
   */
  acquisition: BaseAcquisition;
}

export interface BaseAcquisition {
  source: 'offer' | 'owned';
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

/**
 * What the search proved about the objective (ADR 0013 section 5). Every bound is in the objective frame of the oracle. A bound the search
 * does not have is `null` (unknown or unbounded): it is never coerced to 0 and never transported as Infinity, and the UI guards each one
 * before `toFixed` / `toPrecision`.
 */
export interface OptimizationMetadata {
  /** The downward enclosure of the verified incumbent's exact score; `null` without an incumbent. */
  lower_bound: number | null;
  /** A proved upper bound of the optimum; `null` when none was proved. */
  upper_bound: number | null;
  /** The justified gap (upper bound minus the exact incumbent score); `null` unless both ends are known. */
  absolute_gap: number | null;
  tolerance: number;
  /** Outer spatial calls: never a fabricated native MIP node count. */
  nodes: number;
  /**
   * Search completion ONLY: `optimal` when the executed model search finished (a proof of emptiness or of an optimum, or a finished search
   * whose proof or build was then withheld), `limit` when it was unfinished or never started. No certificate follows from either value;
   * the status, certificate, qualifications and reason carry the proof.
   */
  termination: 'optimal' | 'limit';
}

export interface OptimizeResponse {
  status: SolveStatus;
  precision_request: PrecisionRequest;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  physical_certificate: PhysicalCertificate;
  /** One record per installed occurrence, each with a unique `instanceId`. */
  selected_items: ItemDetail[];
  /** Installed multiset by template id, duplicates kept (one entry per installed copy). */
  selected_item_ids: string[];
  selected_preset?: PresetDetail;
  /**
   * Physical placements, one per installed occurrence. This is the internal instance-aware manifest, NOT the EFTForge v1 `[slotId, itemId][]`
   * format: an external export needs a checked projection (Phase 2.8).
   */
  slot_pairs: Placement[];
  /** The exact score of the published build in the objective frame; `null` when there is no build. */
  objective_value: number | null;
  optimization: OptimizationMetadata;
  final_stats?: FinalStats;
  /** One of the closed set of public reasons (`physical/reasons.ts`, ADR 0013 section 6); absent when none is required. */
  reason?: string;
  solve_time_ms: number;
  /** Tchebycheff mode: the payoff table (ideal/nadir reference point) the scalarization used, supplied or computed (INTERPRETATIONS 9 and 17). */
  ideal_point?: IdealPoint;
  /** Observed ideal-point cache lookup for this request. Absent when Sweet Spot is off. */
  endpoint_cache?: 'hit' | 'miss';
  /** Present (true) only when the Fast model ran with at most one copy of each part (`allow_repeated_parts` not set). Never present for Precise. */
  single_copy?: true;
}

/** tarkov.dev game modes: PvP = `regular`, PvP season server = `pvp-season`, PvE = `pve`. */
export type GameMode = 'regular' | 'pvp-season' | 'pve';

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

/**
 * One verified optimal or feasible witness of an Explore sweep (ADR 0013 section 5): the proof and witness fields of the Optimize result that
 * generated it, plus the plotted coordinates.
 */
export interface ExplorePoint extends Pick<OptimizeResponse,
  'status' | 'physical_certificate' | 'precision_request' | 'precision_resolved' | 'model_qualification' | 'moa_qualification'
  | 'selected_items' | 'selected_item_ids' | 'selected_preset' | 'slot_pairs' | 'objective_value' | 'optimization' | 'reason' | 'solve_time_ms'
> {
  ergo: number;
  recoil_pct: number;
  recoil_v: number;
  recoil_h: number;
  price: number;
  /** Set by the UI when overlaying multiple weapons on one explore chart. */
  weapon_id?: string;
  weapon_name?: string;
}

/** The classification of one scheduled sweep target: V valid witness, I certified infeasible, U unresolved or unlaunched, E runtime error. */
export interface ExploreStepOutcome {
  target_index: number;
  outcome: 'V' | 'I' | 'U' | 'E';
  /** Index into `ExploreResponse.points` of the witness (V only). */
  point_index: number | null;
  status: SolveStatus;
  physical_certificate: PhysicalCertificate;
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  moa_qualification: MoaQualification;
  optimization: OptimizationMetadata;
  reason?: string;
}

export interface ExploreResponse {
  curve_status: 'complete' | 'partial' | 'infeasible' | 'invalid';
  /** Verified optimal or feasible witnesses only. */
  points: ExplorePoint[];
  sweep_schedule: { target_index: number; target_value: number }[];
  /** One per scheduled target, `U` when it was never launched. */
  step_outcomes: ExploreStepOutcome[];
  total_solve_time_ms: number;
  precision_request: PrecisionRequest;
  /** The uniform resolved mode of the sweep when known, otherwise `null`; the per-target fields stay authoritative. */
  precision_resolved: PrecisionResolved;
  model_qualification: ModelQualification;
  /** `provisional_model` when the sweep depends on the MOA model, otherwise `null`. */
  moa_qualification: MoaQualification;
  reason?: string;
  /** Present (true) only when the sweep ran in Fast with at most one copy of each part (`allow_repeated_parts` not set). */
  single_copy?: true;
}

/**
 * The verified partial result of a RUNNING Explore sweep (Phase 2.8), published after each launched target through `RequestOptions.onSnapshot`.
 * The last one is what a `CancellationError` carries for an Explore that was hard-terminated, so the points published so far are kept
 * (ADR 0013 section 4D).
 */
export interface ExploreSnapshot {
  /** Targets launched and classified so far. */
  launched: number;
  /** Targets scheduled so far: an adaptive sweep appends the next target as the previous one returns. */
  scheduled: number;
  /** The response as it would stand if the sweep stopped now: every unlaunched target is `U` without a reason, the points are verified witnesses only. */
  response: ExploreResponse;
}

/** A verified full build that met a MOA cap: the upper-bound witness of a floor query (never a proved minimum). */
export interface WitnessBuild {
  achieved_moa: number;
  base: { kind: 'naked' } | { kind: 'preset'; presetId: string };
  selected_items: ItemDetail[];
  selected_item_ids: string[];
  selected_preset?: PresetDetail;
  slot_pairs: Placement[];
  scope: WitnessScope;
}

/** The MOA floor of a weapon under the provisional model (ADR 0013 section 6): a bracket on the minimum, not a game-physical minimum. */
export interface MOAFloorResponse {
  status: 'model_proved' | 'model_witnessed' | 'unresolved' | 'model_infeasible';
  moa_qualification: 'provisional_model';
  /** The achieved raw upper bound, not a game-physical minimum; `null` without a witness. */
  floor: number | null;
  display_floor: number | null;
  proved_lower_bound: number | null;
  witness?: WitnessBuild;
  solve_time_ms: number;
  reason?: string;
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

// The channel owns the queue, the epoch deadlines, soft cancel and hard termination (`workerChannel.ts`); this module only wires the real Worker.
const channel = new WorkerChannel({
  createWorker: () => new Worker(
    new URL('../solver/solver.worker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as WorkerLike,
});

export { CancellationError, SolverError } from '../solver/runtimeErrors';
export type { RequestOptions } from './workerChannel';

/**
 * HARD termination: reject every active and queued request exactly once with a `CancellationError` (keeping the last published snapshot of
 * each), terminate the worker and start a fresh one on the next call. The soft path is the `signal` option of each operation, which asks the
 * running operation to return its retained state with `Cancelled by user` and escalates to this only if the worker does not answer.
 */
export const terminateWorker = (reason?: string): void => channel.terminate(reason);

// --- Exported API functions (same signatures, local solver) ---

export const getInfo = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<InfoResponse> => {
  return channel.send<InfoResponse>('getInfo', { lang, gameMode });
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
  return channel.send<{ mods: ModInfo[] } & Partial<ModCompatibility>>('getWeaponMods', { weaponId, lang, gameMode, withCompat: opts.withCompat === true });
};

export const optimize = async (
  request: OptimizeRequest, gameMode: GameMode = 'regular', lang: string = 'en', options: RequestOptions = {},
): Promise<OptimizeResponse> => {
  return channel.send<OptimizeResponse>('optimize', { request, lang, gameMode }, {
    ...options, timeLimitMs: resolveTimeLimit(request.time_limit_ms, DEFAULT_OPTIMIZE_TIME_LIMIT_MS),
  });
};

export const explore = async (
  request: ExploreRequest, gameMode: GameMode = 'regular', lang: string = 'en', options: RequestOptions = {},
): Promise<ExploreResponse> => {
  return channel.send<ExploreResponse>('explore', { request, lang, gameMode }, {
    ...options, timeLimitMs: resolveTimeLimit(request.time_limit_ms, DEFAULT_EXPLORE_TIME_LIMIT_MS),
  });
};

export const getGunsmithTasks = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<GunsmithTasksResponse> => {
  return channel.send<GunsmithTasksResponse>('getGunsmithTasks', { lang, gameMode });
};

export const getStatus = async (gameMode: GameMode = 'regular', lang: string = 'en'): Promise<{ timestamp: number }> => {
  return channel.send<{ timestamp: number }>('getStatus', { lang, gameMode });
};

export const computeMOAFloor = async (
  request: MOAFloorRequest, gameMode: GameMode = 'regular', lang: string = 'en', options: RequestOptions = {},
): Promise<MOAFloorResponse> => {
  return channel.send<MOAFloorResponse>('computeMOAFloor', { request, lang, gameMode }, {
    ...options, timeLimitMs: resolveTimeLimit(request.time_limit_ms, DEFAULT_FLOOR_TIME_LIMIT_MS),
  });
};

/**
 * Wipe IndexedDB cache and terminate the worker (clearing its in-memory dataCache). Pending requests are rejected with a `CancellationError`.
 * Caller should reload the page afterwards so stores re-fetch fresh data from tarkov.dev.
 * DB name kept in sync with `DB_NAME` in solver/dataService.ts.
 */
export const clearDataCache = async (): Promise<void> => {
  channel.terminate('Cache cleared by user');
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('tarkov-optimizer-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
};
