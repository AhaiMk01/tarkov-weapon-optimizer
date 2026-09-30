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
 * - Handles optional negative-weight attachments without underestimating.
 * - Prevents cycle-truncated path memoization from poisoning lookups on other branches.
 * - Correctly incorporates gun naked_ergonomics at root.
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

  function getSlots(item: ItemLookup[string]): SlotInfo[] {
    if (item.type === 'gun') return item.slots || [];
    return (item as ModLookupEntry).slots || [];
  }

  function getItemWeight(item: ItemLookup[string]): number {
    return (item.type === 'gun' ? item.stats.weight : ('weight' in item.stats ? item.stats.weight : 0)) || 0;
  }

  function getItemErgo(item: ItemLookup[string]): number {
    return (item.type === 'gun' ? item.stats.naked_ergonomics : ('ergonomics' in item.stats ? item.stats.ergonomics : 0)) || 0;
  }

  // Global memo tables only store results whose subtrees are provably acyclic
  const maxWeightMemo = new Map<string, number>();
  const minWeightMemo = new Map<string, number>();
  const maxErgoMemo = new Map<string, number>();
  const minErgoMemo = new Map<string, number>();

  interface SubtreeResult {
    val: number;
    hasCycle: boolean;
  }

  function getMaxWeight(itemId: string, visited: Set<string>): SubtreeResult {
    if (visited.has(itemId)) {
      return { val: 0, hasCycle: true };
    }
    if (maxWeightMemo.has(itemId)) {
      return { val: maxWeightMemo.get(itemId)!, hasCycle: false };
    }

    const item = lookup[itemId];
    if (!item) return { val: 0, hasCycle: false };

    visited.add(itemId);
    let subtreeHasCycle = false;
    let childW = 0;

    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let maxChild = 0;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const res = getMaxWeight(cid, visited);
          if (res.hasCycle) subtreeHasCycle = true;
          if (res.val > maxChild) maxChild = res.val;
        }
      }
      childW += maxChild;
    }

    visited.delete(itemId);
    const total = getItemWeight(item) + childW;

    if (!subtreeHasCycle) {
      maxWeightMemo.set(itemId, total);
    }
    return { val: total, hasCycle: subtreeHasCycle };
  }

  function getMinWeight(itemId: string, visited: Set<string>): SubtreeResult {
    if (visited.has(itemId)) {
      return { val: 0, hasCycle: true };
    }
    if (minWeightMemo.has(itemId)) {
      return { val: minWeightMemo.get(itemId)!, hasCycle: false };
    }

    const item = lookup[itemId];
    if (!item) return { val: 0, hasCycle: false };

    visited.add(itemId);
    let subtreeHasCycle = false;
    let childW = 0;

    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let minChild = Infinity;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const res = getMinWeight(cid, visited);
          if (res.hasCycle) subtreeHasCycle = true;
          if (res.val < minChild) minChild = res.val;
        }
      }

      if (slot.required) {
        if (minChild !== Infinity) childW += minChild;
      } else {
        // Optional slot: can leave empty (0) or install an attachment with negative weight
        if (minChild !== Infinity && minChild < 0) {
          childW += minChild;
        }
      }
    }

    visited.delete(itemId);
    const total = getItemWeight(item) + childW;

    if (!subtreeHasCycle) {
      minWeightMemo.set(itemId, total);
    }
    return { val: total, hasCycle: subtreeHasCycle };
  }

  function getMaxErgo(itemId: string, visited: Set<string>): SubtreeResult {
    if (visited.has(itemId)) {
      return { val: 0, hasCycle: true };
    }
    if (maxErgoMemo.has(itemId)) {
      return { val: maxErgoMemo.get(itemId)!, hasCycle: false };
    }

    const item = lookup[itemId];
    if (!item) return { val: 0, hasCycle: false };

    visited.add(itemId);
    let subtreeHasCycle = false;
    let childE = 0;

    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let maxChild = 0;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const res = getMaxErgo(cid, visited);
          if (res.hasCycle) subtreeHasCycle = true;
          if (res.val > maxChild) maxChild = res.val;
        }
      }
      if (maxChild > 0) childE += maxChild;
    }

    visited.delete(itemId);
    const total = getItemErgo(item) + childE;

    if (!subtreeHasCycle) {
      maxErgoMemo.set(itemId, total);
    }
    return { val: total, hasCycle: subtreeHasCycle };
  }

  function getMinErgo(itemId: string, visited: Set<string>): SubtreeResult {
    if (visited.has(itemId)) {
      return { val: 0, hasCycle: true };
    }
    if (minErgoMemo.has(itemId)) {
      return { val: minErgoMemo.get(itemId)!, hasCycle: false };
    }

    const item = lookup[itemId];
    if (!item) return { val: 0, hasCycle: false };

    visited.add(itemId);
    let subtreeHasCycle = false;
    let childE = 0;

    for (const slot of getSlots(item)) {
      const allowed = cmap.slot_items[slot.id] || [];
      let minChild = Infinity;
      for (const cid of allowed) {
        if (cmap.reachable_items[cid]) {
          const res = getMinErgo(cid, visited);
          if (res.hasCycle) subtreeHasCycle = true;
          if (res.val < minChild) minChild = res.val;
        }
      }

      if (slot.required) {
        if (minChild !== Infinity) childE += minChild;
      } else {
        if (minChild !== Infinity && minChild < 0) {
          childE += minChild;
        }
      }
    }

    visited.delete(itemId);
    const total = getItemErgo(item) + childE;

    if (!subtreeHasCycle) {
      minErgoMemo.set(itemId, total);
    }
    return { val: total, hasCycle: subtreeHasCycle };
  }

  const rawMinW = getMinWeight(weaponId, new Set()).val;
  let rawMaxW = Math.max(rawMinW, getMaxWeight(weaponId, new Set()).val);

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

  const rawMinE = getMinErgo(weaponId, new Set()).val;
  const rawMaxE = Math.max(rawMinE, getMaxErgo(weaponId, new Set()).val);

  return {
    weightBounds: [rawMinW, rawMaxW],
    ergoBounds: [rawMinE, rawMaxE],
  };
}
