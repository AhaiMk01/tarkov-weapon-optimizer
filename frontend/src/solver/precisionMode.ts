/**
 * Resolves Fast vs Precise LP mode (owner decision, 2026-10-12, from the Phase 2.10 measurement in benchmarks/phase210m2/).
 *
 * Precise solves the certified count model (owner decisions 2d as amended and 2e), whose size is the number of candidate slot edges, not the
 * occurrence count. Measured on the pinned capture (60 s limit, relaxed-first edges, second opinion): every gun certifies plain in at most 5.7 s,
 * so Auto resolves a plain request to Precise for every supported gun. A TrueErgo or Prevent Overswing request runs the spatial weight search
 * (several node solves): every gun up to 2,513 candidate edges certified in at most 26 s, while the guns from 3,476 edges up (AKMS, the AK and
 * M4/AR-15 families, NL545 DI) took 12 to 53 s, too close to the 60 s default on a slower client. No gun lies between 2,513 and 3,476, so Auto
 * runs Precise for a TED request up to `AUTO_PRECISE_MAX_TED_EDGES` candidate edges and Fast (approximate, decision 2b) above.
 *
 * The edge count is read from the compatibility map alone (no lookup is needed): for every slot owned by the weapon or a reachable mod, the
 * number of distinct reachable candidates. It tracks the count model's integer columns closely (within about 10% on the pinned capture).
 */

import type { CompatibilityMap, PrecisionRequest } from './types';

/** Auto runs Precise for a TrueErgo or Prevent Overswing request when the weapon has at most this many candidate slot edges. */
export const AUTO_PRECISE_MAX_TED_EDGES = 3_000;

export function normalizePrecisionRequest(raw: boolean | PrecisionRequest | undefined): PrecisionRequest {
  if (raw === true || raw === 'precise') return 'precise';
  if (raw === false || raw === 'fast') return 'fast';
  if (raw === 'auto') return 'auto';
  return 'fast';
}

/** Candidate slot edges of the weapon: for every slot owned by the weapon or a reachable mod, its distinct reachable candidates. */
export function countCandidateEdges(compatMap: CompatibilityMap): number {
  const reachable = compatMap.reachable_items;
  let edges = 0;
  for (const slotId of Object.keys(compatMap.slot_owner)) {
    edges += new Set((compatMap.slot_items[slotId] ?? []).filter(child => child in reachable)).size;
  }
  return edges;
}

export function resolvePreciseFlag(request: PrecisionRequest, compatMap: CompatibilityMap, tedRequest: boolean): boolean {
  if (request === 'precise') return true;
  if (request === 'fast') return false;
  return !tedRequest || countCandidateEdges(compatMap) <= AUTO_PRECISE_MAX_TED_EDGES;
}
