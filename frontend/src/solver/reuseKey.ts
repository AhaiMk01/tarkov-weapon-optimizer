/**
 * Canonical Cache Key and Invalidation Logic
 * Implements mathematical reuse boundaries defined in ADR 0001 (Refs #25).
 */

import type { OptimizeRequest } from '../api/client.ts';
import type { TraderLevels } from './types.ts';

export interface CacheKeyOptions {
  dataVersion?: number;
}

/**
 * Sorts and deduplicates an array of identifiers to prevent permutation invalidation.
 */
export function canonicalizeArray(arr?: readonly string[] | null): string[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  const set = new Set(arr);
  return Array.from(set).sort();
}

/**
 * Canonicalizes trader levels map once at request entry:
 * - Trims whitespace and lowercases all vendor names.
 * - Resolves duplicate aliases deterministically: last-entry-wins in natural iteration order.
 * - Sorts keys alphabetically for stable serialization.
 *
 * This normalized map MUST be used consistently across:
 * - Cache key generation (computeIdealPointCacheKey)
 * - Solver pricing (dataService.ts:getAvailablePrice)
 * - Independent build validation (validateBuild.ts)
 */
export function canonicalizeTraderLevels(levels?: TraderLevels | null): Record<string, number> | undefined {
  if (!levels) return undefined;
  // Natural iteration order: last-entry-wins for conflicting aliases (e.g. {"mechanic": 0, "Mechanic": 4} -> 4)
  const merged = new Map<string, number>();
  for (const [k, v] of Object.entries(levels)) {
    const key = k.trim().toLowerCase();
    if (key.length > 0) {
      merged.set(key, Number(v));
    }
  }
  if (merged.size === 0) return undefined;
  // Sort alphabetically for deterministic serialization and lookup
  const sortedKeys = Array.from(merged.keys()).sort();
  const out: Record<string, number> = {};
  for (const k of sortedKeys) {
    out[k] = merged.get(k)!;
  }
  return out;
}

/**
 * Computes canonical key for Tier 1 Structural Bounds reuse.
 * Invariant to all preferences, prices, and constraints except weaponId and data snapshot.
 */
export function computeStructuralBoundsCacheKey(
  lang: string,
  gameMode: string,
  weaponId: string,
  maxWeight?: number | null,
): string {
  return JSON.stringify({
    lang,
    gameMode,
    weapon_id: weaponId,
    max_weight: maxWeight != null ? Number(maxWeight) : undefined,
  });
}

/**
 * Computes canonical key for Tier 2 Sweet Spot endpoints.
 * Invariant to preference weights (ergoWeight, recoilWeight, priceWeight), but
 * strictly invalidates on any feasibility, market, or physical parameter change.
 */
export function computeIdealPointCacheKey(
  lang: string,
  gameMode: string,
  req: OptimizeRequest,
): string {
  return JSON.stringify({
    lang,
    gameMode,
    weapon_id: req.weapon_id,
    // Feasibility domain
    max_price: req.max_price != null ? Number(req.max_price) : undefined,
    min_ergonomics: req.min_ergonomics != null ? Number(req.min_ergonomics) : undefined,
    max_recoil_v: req.max_recoil_v != null ? Number(req.max_recoil_v) : undefined,
    max_recoil_sum: req.max_recoil_sum != null ? Number(req.max_recoil_sum) : undefined,
    min_mag_capacity: req.min_mag_capacity != null ? Number(req.min_mag_capacity) : undefined,
    min_sighting_range: req.min_sighting_range != null ? Number(req.min_sighting_range) : undefined,
    max_weight: req.max_weight != null ? Number(req.max_weight) : undefined,
    max_moa: req.max_moa != null ? Number(req.max_moa) : undefined,
    include_items: canonicalizeArray(req.include_items),
    exclude_items: canonicalizeArray(req.exclude_items),
    include_categories: req.include_categories?.map(canonicalizeArray).filter(Boolean),
    exclude_categories: canonicalizeArray(req.exclude_categories),
    // Physical & Model domain
    prevent_overswing: Boolean(req.prevent_overswing),
    equip_ergo_modifier: req.equip_ergo_modifier != null ? Number(req.equip_ergo_modifier) : undefined,
    use_true_ergo: Boolean(req.use_true_ergo),
    precise_mode: req.precise_mode ?? undefined,
    bounds_mode: req.bounds_mode ?? 'structural',
    // Market domain (strictly canonicalized)
    trader_levels: canonicalizeTraderLevels(req.trader_levels),
    flea_available: req.flea_available ?? true,
    barter_available: req.barter_available ?? false,
    barter_exclude_dogtags: req.barter_exclude_dogtags ?? false,
    player_level: req.player_level != null ? Number(req.player_level) : undefined,
  });
}

/**
 * Computes canonical key for Tier 4 repeated full solves.
 * Differentiates all problem inputs including preference weights.
 */
export function computeExactSolveCacheKey(
  lang: string,
  gameMode: string,
  req: OptimizeRequest,
): string {
  const base = JSON.parse(computeIdealPointCacheKey(lang, gameMode, req));
  return JSON.stringify({
    ...base,
    ergo_weight: Number(req.ergo_weight ?? 1),
    recoil_weight: Number(req.recoil_weight ?? 1),
    price_weight: Number(req.price_weight ?? 0),
    use_tchebycheff: Boolean(req.use_tchebycheff),
  });
}
