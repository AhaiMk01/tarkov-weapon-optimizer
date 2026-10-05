/**
 * The request domain of the UI (ADR 0013 section 5, Phase 2.8): the one place that turns the current control state into the normalized hard
 * constraints and acquisition settings of a request.
 *
 * Optimize, Explore, the Gunsmith call and the MOA floor are all asked about the SAME domain. The floor in particular is not "just the weapon id":
 * it carries every field of the Optimize domain (market, trader and flea settings, levels, every hard constraint, TrueErgo / Prevent Overswing,
 * the budget, the filters) except the MOA cap it searches, plus no objective (its objective is a constant zero) and no precision (it is always
 * Precise). `owned_items` is deliberately absent: there is no stash input in this phase, and an omitted list means zero stock (ADR 0008).
 *
 * Pure: type-only imports, no DOM, no worker.
 */

import type { ExploreRequest, MOAFloorRequest, OptimizeRequest } from './client';
import type { PrecisionRequest, TraderLevels } from '../solver/types';

/** The control state that defines the domain of a request. */
export interface RequestDomainState {
  weaponId: string;
  useBudget: boolean;
  maxPrice: number;
  /** Minimum ergonomics; 0 means off. */
  minErgo: number;
  useMinMag: boolean;
  minMagCapacity: number;
  useTrueErgo: boolean;
  preventOverswing: boolean;
  /** Equipment ergonomics modifier as a percentage (-15 for -15%). It only applies with TrueErgo or Prevent Overswing. */
  equipErgoPenalty: number;
  includedModIds: readonly string[];
  excludedModIds: readonly string[];
  includedCategories: readonly string[];
  excludedCategories: readonly string[];
  traderLevels: TraderLevels;
  playerLevel: number;
  fleaAvailable: boolean;
  barterAvailable: boolean;
  barterExcludeDogtags: boolean;
}

/**
 * The normalized domain: constraints, filters, acquisition settings. Unset constraints are `undefined` (never 0). This is exactly a
 * `MOAFloorRequest`: the Optimize domain minus the MOA cap, the weights, the Tchebycheff flag and the precision.
 */
export function domainRequestOf(s: RequestDomainState): MOAFloorRequest {
  return {
    weapon_id: s.weaponId,
    use_true_ergo: s.useTrueErgo || undefined,
    max_price: s.useBudget ? s.maxPrice : undefined,
    min_ergonomics: s.minErgo > 0 ? s.minErgo : undefined,
    min_mag_capacity: s.useMinMag ? s.minMagCapacity : undefined,
    prevent_overswing: s.preventOverswing || undefined,
    equip_ergo_modifier: s.useTrueErgo || s.preventOverswing ? s.equipErgoPenalty / 100 : undefined,
    include_items: s.includedModIds.length > 0 ? [...s.includedModIds] : undefined,
    exclude_items: s.excludedModIds.length > 0 ? [...s.excludedModIds] : undefined,
    include_categories: s.includedCategories.length > 0 ? s.includedCategories.map(c => [c]) : undefined,
    exclude_categories: s.excludedCategories.length > 0 ? [...s.excludedCategories] : undefined,
    trader_levels: s.traderLevels,
    player_level: s.playerLevel,
    flea_available: s.fleaAvailable,
    barter_available: s.barterAvailable,
    barter_exclude_dogtags: s.barterExcludeDogtags,
  };
}

/** The MOA floor request: the whole domain, nothing about the cap it searches. */
export const floorRequestOf = (s: RequestDomainState): MOAFloorRequest => domainRequestOf(s);

/** Identity of a floor request: equal keys mean the same question (the key drives when the floor is asked again). */
export const floorRequestKey = (request: MOAFloorRequest, gameMode: string, lang: string): string => JSON.stringify([request, gameMode, lang]);

export interface OptimizeExtras {
  ergoWeight: number;
  recoilWeight: number;
  priceWeight: number;
  useTchebycheff: boolean;
  /** The MOA cap; `null` for none. */
  maxMoa: number | null;
  precision: PrecisionRequest;
}

/** The Optimize request: the domain plus the objective, the cap and the precision. */
export function optimizeRequestOf(s: RequestDomainState, x: OptimizeExtras): OptimizeRequest {
  return {
    ...domainRequestOf(s),
    ergo_weight: x.ergoWeight,
    recoil_weight: x.recoilWeight,
    price_weight: x.priceWeight,
    use_tchebycheff: x.useTchebycheff || undefined,
    max_moa: x.maxMoa ?? undefined,
    precise_mode: x.precision,
  };
}

export interface ExploreExtras {
  ignore: ExploreRequest['ignore'];
  steps: number;
  maxMoa: number | null;
  precision: PrecisionRequest;
  /** A budget on the swept axis (set only when the axis is the one being limited): applied as `max_price`, `min_ergonomics` or `max_recoil_v`. */
  axisLimit: number | null;
}

/** The Explore request for one weapon: the domain, the swept axis and, when the user set one, the limit on that axis. */
export function exploreRequestOf(s: RequestDomainState, x: ExploreExtras): ExploreRequest {
  const base = domainRequestOf(s);
  const limit = x.axisLimit !== null && x.axisLimit > 0 ? x.axisLimit : undefined;
  return {
    ...base,
    ignore: x.ignore,
    steps: x.steps,
    // A control already set on the axis wins over the explore-only limit, as before.
    max_price: base.max_price ?? (x.ignore === 'price' ? limit : undefined),
    min_ergonomics: base.min_ergonomics ?? (x.ignore === 'ergo' ? limit : undefined),
    max_recoil_v: x.ignore === 'recoil' ? limit : undefined,
    max_moa: x.maxMoa ?? undefined,
    precise_mode: x.precision,
  };
}
