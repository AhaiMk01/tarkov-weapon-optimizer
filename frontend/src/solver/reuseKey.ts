/**
 * Canonical Cache Key and Invalidation Logic
 * Implements mathematical reuse boundaries defined in ADR 0001 (Refs #25).
 */

import type { OptimizeRequest } from '../api/client.ts';
import { keyEntries } from './domainFields.ts';

export interface CacheKeyOptions {
  dataVersion?: number;
}

/**
 * The resolved controls an endpoint table was computed under (ADR 0013 section 4D, canonical #38): the model that ran, the DURATION of the
 * request budget (a relative length, never the absolute epoch deadline of one request), the spatial node cap and the objective tolerance.
 * Transient request ids and absolute deadlines are not key fields.
 */
export interface EndpointControls {
  precisionResolved: 'fast' | 'precise';
  timeLimitMs: number;
  maxSpatialNodes: number;
  tolerance: number;
}

/**
 * Canonical form of the stash multiset (ADR 0008): sorted in code-unit order with every duplicate KEPT (a multiplicity is a quantity, so
 * ['a', 'a'] and ['a'] are different stock). Omitted and [] are the same zero stock. The input is not mutated.
 */
export function canonicalizeOwnedItems(items?: readonly string[] | null): string[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.toSorted();
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
  controls?: EndpointControls,
): string {
  return JSON.stringify({
    lang,
    gameMode,
    // The weapon, the hard constraints, the filters and the model flags, in the order of the domain table.
    ...keyEntries(req, 'constraints'),
    precise_mode: req.precise_mode ?? undefined,
    // Market domain (strictly canonicalized)
    ...keyEntries(req, 'acquisition'),
    // Inventory domain: the full stash multiset, duplicates kept (a changed stash is a changed acquisition domain).
    owned_items: canonicalizeOwnedItems(req.owned_items),
    // Resolved controls (absent for a caller that does not resolve them).
    controls: controls === undefined ? undefined : {
      precision_resolved: controls.precisionResolved,
      time_limit_ms: controls.timeLimitMs,
      max_spatial_nodes: controls.maxSpatialNodes,
      tolerance: controls.tolerance,
    },
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
    // A full solve can be a Fast one, and Fast answers differ with the one-copy cap (owner decision 2c). The endpoint key above deliberately omits it:
    // only certified Precise payoff tables are ever stored under it, and Precise ignores the option.
    allow_repeated_parts: req.allow_repeated_parts === true,
    ergo_weight: Number(req.ergo_weight ?? 1),
    recoil_weight: Number(req.recoil_weight ?? 1),
    price_weight: Number(req.price_weight ?? 0),
    use_tchebycheff: Boolean(req.use_tchebycheff),
  });
}
