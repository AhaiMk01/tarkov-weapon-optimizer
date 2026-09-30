import type { CompatibilityMap, ItemLookup, ModLookupEntry, SlotInfo } from './types.ts';

export interface StructuralBoundsOptions {
  maxWeight?: number | null;
}

export interface StructuralBounds {
  weightBounds: [number, number];
  ergoBounds: [number, number];
}

/**
 * Computes safe, tight structural bounds on total weight and ergonomics
 * for a weapon build by dynamic programming on the compatibility DAG.
 * Guarantees:
 * - Every feasible build's weight W satisfies minW <= W <= maxW.
 * - Every feasible build's ergonomics E satisfies minE <= E <= maxE.
 * - Safely bounds subtrees without assuming negative ergonomics clamp to 0.
 */
export function computeStructuralBounds(
  weaponId: string,
  lookup: ItemLookup,
  cmap: CompatibilityMap,
  options: StructuralBoundsOptions = {},
): StructuralBounds {
  const weapon = lookup[weaponId];
  if (!weapon || weapon.type !== 'gun') {
    return { weightBounds: [0, 100], ergoBounds: [0, 100] };
  }

  // Helper to get slot definitions on an item
  function getSlots(item: ItemLookup[string]): SlotInfo[] {
    if (item.type === 'gun') return item.slots || [];
    return (item as ModLookupEntry).slots || [];
  }

  const maxWeightMemo = new Map<string, number>();
  const minWeightMemo = new Map<string, number>();
  const maxErgoMemo = new Map<string, number>();
  const minErgoMemo = new Map<string, number>();

  function getMaxWeight(itemId: string, visited: Set<string>): number {
    if (maxWeightMemo.has(itemId)) return maxWeightMemo.get(itemId)!;
    if (visited.has(itemId)) return 0;
    visited.add(itemId);

    const item = lookup[itemId];
    if (!item) return 0;
    const w = ('weight' in item.stats ? item.stats.weight : 0) || 0;

    let childW = 0;
    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let maxChild = 0;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const cw = getMaxWeight(cid, new Set(visited));
          if (cw > maxChild) maxChild = cw;
        }
      }
      childW += maxChild;
    }
    const total = w + childW;
    maxWeightMemo.set(itemId, total);
    return total;
  }

  function getMinWeight(itemId: string, visited: Set<string>): number {
    if (minWeightMemo.has(itemId)) return minWeightMemo.get(itemId)!;
    if (visited.has(itemId)) return 0;
    visited.add(itemId);

    const item = lookup[itemId];
    if (!item) return 0;
    const w = ('weight' in item.stats ? item.stats.weight : 0) || 0;

    let childW = 0;
    for (const slot of getSlots(item)) {
      if (!slot.required) continue;
      const allowed = cmap.slot_items[slot.id] || [];
      let minChild = Infinity;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const cw = getMinWeight(cid, new Set(visited));
          if (cw < minChild) minChild = cw;
        }
      }
      if (minChild !== Infinity) childW += minChild;
    }
    const total = w + childW;
    minWeightMemo.set(itemId, total);
    return total;
  }

  function getMaxErgo(itemId: string, visited: Set<string>): number {
    if (maxErgoMemo.has(itemId)) return maxErgoMemo.get(itemId)!;
    if (visited.has(itemId)) return 0;
    visited.add(itemId);

    const item = lookup[itemId];
    if (!item) return 0;
    const e = ('ergonomics' in item.stats ? item.stats.ergonomics : 0) || 0;

    let childE = 0;
    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let maxChild = 0;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const ce = getMaxErgo(cid, new Set(visited));
          if (ce > maxChild) maxChild = ce;
        }
      }
      // An optional slot can be left empty (adds 0), so maxChild is at least 0
      if (maxChild > 0) childE += maxChild;
    }
    const total = e + childE;
    maxErgoMemo.set(itemId, total);
    return total;
  }

  function getMinErgo(itemId: string, visited: Set<string>): number {
    if (minErgoMemo.has(itemId)) return minErgoMemo.get(itemId)!;
    if (visited.has(itemId)) return 0;
    visited.add(itemId);

    const item = lookup[itemId];
    if (!item) return 0;
    const e = ('ergonomics' in item.stats ? item.stats.ergonomics : 0) || 0;

    let childE = 0;
    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let minChild = 0;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const ce = getMinErgo(cid, new Set(visited));
          if (ce < minChild) minChild = ce;
        }
      }
      // If the slot is required, you must choose a mod even if its ergo is negative or positive
      if (slot.required) {
        let reqMin = Infinity;
        for (const cid of allowed) {
          if (cmap.reachable_items[cid]) {
            const ce = getMinErgo(cid, new Set(visited));
            if (ce < reqMin) reqMin = ce;
          }
        }
        if (reqMin !== Infinity) childE += reqMin;
      } else {
        // Optional slot: could install an attachment with negative ergo
        if (minChild < 0) childE += minChild;
      }
    }
    const total = e + childE;
    minErgoMemo.set(itemId, total);
    return total;
  }

  const rawMinW = Math.max(0, getMinWeight(weaponId, new Set()));
  let rawMaxW = Math.max(rawMinW, getMaxWeight(weaponId, new Set()));

  // Account for preset base weights if any presets exist
  const baseW = weapon.stats.weight || 0;
  for (const preset of weapon.presets || []) {
    const presetItemsWeight = (preset.items || []).reduce((sum, id) => {
      const m = lookup[id];
      const mw = m && 'weight' in m.stats ? (m.stats.weight || 0) : 0;
      return sum + mw;
    }, 0);
    const presetW = baseW + presetItemsWeight;
    if (presetW > rawMaxW) {
      rawMaxW = presetW;
    }
  }

  if (options.maxWeight != null && options.maxWeight > 0) {
    rawMaxW = Math.max(rawMinW, Math.min(rawMaxW, options.maxWeight));
  }

  const rawMinE = getMinErgo(weaponId, new Set());
  const rawMaxE = Math.max(rawMinE, getMaxErgo(weaponId, new Set()));

  return {
    weightBounds: [rawMinW, rawMaxW],
    ergoBounds: [rawMinE, rawMaxE],
  };
}
