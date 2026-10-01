/**
 * Suggest mods that must host a required part when the slot graph allows only one mod parent
 * (no direct weapon slot). Used for Gunsmith task display only — the LP solver does not force
 * these ids (connectivity already picks a valid chain; forcing could over-constrain the model).
 */

import type { CompatibilityMap } from './types.ts';

export function expandIncludeItemsWithDeps(
  weaponId: string,
  cmap: CompatibilityMap,
  includeItems: string[] | null | undefined,
): string[] | null {
  if (includeItems == null) return null;
  if (includeItems.length === 0) return includeItems;

  const slotItems = cmap.slot_items;
  const slotOwner = cmap.slot_owner;

  function attachesDirectlyToWeapon(itemId: string): boolean {
    for (const [slotId, allowed] of Object.entries(slotItems)) {
      if (!allowed.includes(itemId)) continue;
      if (slotOwner[slotId] === weaponId) return true;
    }
    return false;
  }

  function modParents(itemId: string): string[] {
    const s = new Set<string>();
    for (const [slotId, allowed] of Object.entries(slotItems)) {
      if (!allowed.includes(itemId)) continue;
      const o = slotOwner[slotId];
      if (o && o !== weaponId) s.add(o);
    }
    return [...s];
  }

  const out = new Set<string>(includeItems);
  const queue = [...includeItems];

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (attachesDirectlyToWeapon(id)) continue;

    const parents = modParents(id);
    if (parents.length !== 1) continue;

    const p = parents[0];
    if (!out.has(p)) {
      out.add(p);
      queue.push(p);
    }
  }

  return [...out].sort();
}
