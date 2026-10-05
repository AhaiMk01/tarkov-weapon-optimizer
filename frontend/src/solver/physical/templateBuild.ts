/**
 * A template-level selection as a physical build (Phase 2.4b-3b, the Fast path).
 *
 * The Fast model decides one binary per item TEMPLATE and a base, with no placement variables, so its answer is a set of template ids. The
 * physical validator judges placements, so the set is turned into a tree from the root: every selected template is installed once (the Fast
 * model is single-copy, so the mapping is unambiguous in the item multiset) under the first rooted slot that lists it and is still free.
 * A template that no rooted owner can hold stays `unplaced`: the caller must not publish such a build.
 *
 * Instance ids are the path-derived `parent/slot:item` ids of the blueprint, so the same strict validation applies as to a Precise build.
 *
 * Placement order. Required slots are filled before optional ones at every stage, and a part that some selected owner needs for a required
 * slot is held back from optional slots until nothing else can be placed, so the Fast model's count of one part for a required slot is not
 * spent on an optional slot of an earlier owner. This is a deterministic heuristic, not a search: a selection for which no rooted
 * placement exists, or for which the heuristic finds none, is rejected by the validator and is never published.
 */

import type { ItemLookup, SlotInfo } from '../types';
import { ROOT_INSTANCE_ID } from './blueprint';
import type { PhysicalBuild, PhysicalBuildBase, PhysicalPlacement } from './validate';

export interface TemplateBuild {
  build: PhysicalBuild;
  /** Selected templates no rooted slot could hold. */
  unplaced: string[];
}

export function buildFromTemplates(
  lookup: ItemLookup,
  weaponId: string,
  selected: Iterable<string>,
  base: PhysicalBuildBase,
): TemplateBuild {
  const wanted = new Set(selected);
  const placements: PhysicalPlacement[] = [];
  const placed = new Set<string>([weaponId]);
  // Rooted owners in placement order: [instance id, template id].
  const owners: [string, string][] = [[ROOT_INSTANCE_ID, weaponId]];
  const filled = new Set<string>();

  const slotsOf = (templateId: string): readonly SlotInfo[] => (Object.hasOwn(lookup, templateId) ? lookup[templateId].slots : []);

  /** Parts a selected owner (placed or not) still needs for a required slot: they are held back from optional slots. */
  const reservedForRequired = (): Set<string> => {
    const reserved = new Set<string>();
    const consider = (templateId: string, instanceId: string | null): void => {
      for (const slot of slotsOf(templateId)) {
        if (!slot.required || (instanceId !== null && filled.has(`${instanceId}\u0000${slot.id}`))) continue;
        for (const id of slot.allowedItems) if (wanted.has(id) && !placed.has(id)) reserved.add(id);
      }
    };
    for (const [instanceId, templateId] of owners) consider(templateId, instanceId);
    for (const id of wanted) if (!placed.has(id)) consider(id, null);
    return reserved;
  };

  /** Place ONE selected template in the first free slot of a rooted owner (required slots only, or any); true when one was placed. */
  const placeNext = (requiredOnly: boolean, respectReservations = false): boolean => {
    const reserved = respectReservations ? reservedForRequired() : new Set<string>();
    for (let o = 0; o < owners.length; o++) {
      const [instanceId, templateId] = owners[o];
      for (const slot of slotsOf(templateId)) {
        if (requiredOnly && !slot.required) continue;
        const key = `${instanceId}\u0000${slot.id}`;
        if (filled.has(key)) continue;
        const itemId = slot.allowedItems.find(id => wanted.has(id) && !placed.has(id) && !reserved.has(id));
        if (itemId === undefined) continue;
        const childInstanceId = `${instanceId}/${slot.id}:${itemId}`;
        placements.push({ parentInstanceId: instanceId, slotId: slot.id, childInstanceId, itemId });
        filled.add(key);
        placed.add(itemId);
        owners.push([childInstanceId, itemId]);
        return true;
      }
    }
    return false;
  };

  // A required slot of any rooted owner is always served before an optional one.
  while (placeNext(true) || placeNext(false, true) || placeNext(false)) { /* each call places one template */ }

  const unplaced = [...wanted].filter(id => !placed.has(id)).sort();
  return { build: { base, placements }, unplaced };
}
