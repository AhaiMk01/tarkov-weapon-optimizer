/**
 * Preset component supply: the one place that turns a count-bearing component list into per-item
 * quantities, so no consumer re-implements summing or silently reads a list as a set.
 */
import type { PresetComponent } from './types.ts';

/**
 * Supplied quantity per item id: repeated entries for one id sum their counts, and an item whose
 * total is not positive supplies nothing and is absent from the map. Iteration order is the order
 * in which each id first appears.
 */
export function presetSupply(items: readonly PresetComponent[] | undefined): Map<string, number> {
  const supply = new Map<string, number>();
  for (const { itemId, count } of items ?? []) {
    supply.set(itemId, (supply.get(itemId) ?? 0) + count);
  }
  for (const [itemId, count] of supply) {
    if (!(count > 0)) supply.delete(itemId);
  }
  return supply;
}

/** Sum a count-bearing list into one entry per distinct item, keeping first-appearance order. */
export function mergeComponents(items: readonly PresetComponent[]): PresetComponent[] {
  const merged = new Map<string, number>();
  for (const { itemId, count } of items) merged.set(itemId, (merged.get(itemId) ?? 0) + count);
  return [...merged].map(([itemId, count]) => ({ itemId, count }));
}
