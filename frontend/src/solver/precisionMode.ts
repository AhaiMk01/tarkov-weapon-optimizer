/**
 * Resolves Fast vs Precise LP mode. Auto runs the exact (Precise) model when its occurrence universe is small enough to solve to a proof
 * within the default request deadline, and the Fast model otherwise.
 *
 * The size that decides solve time is the number of ITEM OCCURRENCES of the exact model (one per template per physical slot it can
 * occupy, `PhysicalBlueprintStats.itemOccurrences`), not the number of distinct reachable mods: the exact model has a binary column per
 * occurrence, and the unreduced model is slow past a certain size (reductions are Stage 4). Measured on the pinned capture with the default
 * weights (ergonomics 1, recoil 1, price 0.1) on the pinned native HiGHS build, every gun up to 13,122 occurrences solved to a proof in at most
 * 18 s (pistols, shotguns and bolt guns in well under 2 s; SR-25, Mk 16/17 and NL545 DI, the slowest, in 16 to 18 s), and the next sizes are
 * the AK family at 34,835 to 41,153 occurrences (no proof within 120 s on the AK-74N) and the M4A1 family at 151,479 (no incumbent in 120 s).
 * No gun lies between 13,122 and 34,835, so any threshold in that gap gives the same answer on the pinned data; 15,000 is the conservative edge
 * with a margin of about 3 over the slowest measured proof against the 60 s default deadline.
 *
 * The count is estimated from the compatibility map alone (no lookup is needed, so the caller's signature is unchanged) by the same
 * path-unrolling rule the blueprint uses (a template never repeats an ancestor on one path), bounded by the threshold so a huge weapon costs
 * no more than the threshold to classify. It agrees with the blueprint to within a fifth on the pinned capture (exactly on most guns), which
 * is far inside the width of the gap above.
 *
 * TrueErgo and Prevent Overswing do not enter the resolution (owner decision 2b, Phase 2.6b): the Fast model states the same TED rows on a weight
 * node and runs the same spatial search, so Auto resolves a TED request by size like any other, and a Fast request for one stays Fast (approximate).
 */

import type { CompatibilityMap, PrecisionRequest } from './types';

/** Auto mode runs Precise when the exact model has at most this many item occurrences. */
export const AUTO_PRECISE_MAX_OCCURRENCES = 15_000;

export function normalizePrecisionRequest(raw: boolean | PrecisionRequest | undefined): PrecisionRequest {
  if (raw === true || raw === 'precise') return 'precise';
  if (raw === false || raw === 'fast') return 'fast';
  if (raw === 'auto') return 'auto';
  return 'fast';
}

/**
 * Item occurrences of the weapon's path-unrolled tree, counted up to `limit + 1` (a larger tree returns `limit + 1`). The weapon is the one
 * slot owner that is not a reachable mod.
 */
export function estimateOccurrences(compatMap: CompatibilityMap, limit: number): number {
  const reachable = compatMap.reachable_items;
  const rootSlots: string[] = [];
  let weaponId: string | undefined;
  for (const [slotId, owner] of Object.entries(compatMap.slot_owner)) {
    if (!(owner in reachable)) {
      weaponId ??= owner;
      if (owner === weaponId) rootSlots.push(slotId);
    }
  }
  if (weaponId === undefined) return 0;
  const root = weaponId;
  let count = 0;
  const onPath = new Set<string>([root]);
  const visit = (slots: readonly string[]): boolean => {
    for (const slotId of slots) {
      const seen = new Set<string>();
      for (const child of compatMap.slot_items[slotId] ?? []) {
        if (seen.has(child) || onPath.has(child) || !(child in reachable)) continue;
        seen.add(child);
        if (++count > limit) return false;
        onPath.add(child);
        const finished = visit(compatMap.item_to_slots[child] ?? []);
        onPath.delete(child);
        if (!finished) return false;
      }
    }
    return true;
  };
  visit(rootSlots);
  return Math.min(count, limit + 1);
}

export function resolvePreciseFlag(request: PrecisionRequest, compatMap: CompatibilityMap): boolean {
  if (request === 'precise') return true;
  if (request === 'fast') return false;
  return estimateOccurrences(compatMap, AUTO_PRECISE_MAX_OCCURRENCES) <= AUTO_PRECISE_MAX_OCCURRENCES;
}
