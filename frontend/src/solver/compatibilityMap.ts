/**
 * BFS-based compatibility map builder.
 * Ported from optimizer.py:build_compatibility_map()
 */

import type { ItemLookup, CompatibilityMap } from './types.ts';

export function buildCompatibilityMap(weaponId: string, itemLookup: ItemLookup): CompatibilityMap {
  if (!(weaponId in itemLookup)) {
    throw new Error(`Weapon ${weaponId} not found in item lookup`);
  }

  const reachable: CompatibilityMap['reachable_items'] = {};
  const slotItems: Record<string, string[]> = {};
  const itemToSlots: Record<string, string[]> = {};
  const slotOwner: Record<string, string> = {};

  const weapon = itemLookup[weaponId];
  const queue: [string, string][] = []; // [item_id, slot_id]

  for (const slot of weapon.slots) {
    const slotId = slot.id;
    slotItems[slotId] = [];
    slotOwner[slotId] = weaponId;
    for (const allowedId of slot.allowedItems) {
      if (allowedId === weaponId) continue;
      if (allowedId in itemLookup) {
        queue.push([allowedId, slotId]);
        slotItems[slotId].push(allowedId);
      }
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const [itemId] = queue.shift()!;
    if (visited.has(itemId)) continue;
    visited.add(itemId);
    if (!(itemId in itemLookup)) continue;

    const item = itemLookup[itemId];

    // Skip items that conflict with the base weapon
    if (item.type === 'mod') {
      const conflicting = item.conflicting_items;
      if (conflicting.includes(weaponId)) continue;
    }

    reachable[itemId] = { item };
    itemToSlots[itemId] = [];

    for (const slot of item.slots) {
      const slotId = slot.id;
      slotItems[slotId] = [];
      slotOwner[slotId] = itemId;
      itemToSlots[itemId].push(slotId);
      for (const allowedId of slot.allowedItems) {
        if (allowedId in itemLookup) {
          slotItems[slotId].push(allowedId);
          if (!visited.has(allowedId)) {
            queue.push([allowedId, slotId]);
          }
        }
      }
    }
  }

  return { reachable_items: reachable, slot_items: slotItems, item_to_slots: itemToSlots, slot_owner: slotOwner };
}
