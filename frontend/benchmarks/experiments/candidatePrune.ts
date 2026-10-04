import { buildLP } from '../../src/solver/lpBuilder.ts';
import { getAvailablePrice } from '../../src/solver/dataService.ts';
import { presetSupply } from '../../src/solver/presetSupply.ts';
import type { LPResult } from '../../src/solver/lpBuilder.ts';
import type { ItemLookup, ModLookupEntry, SolveParams, SlotInfo } from '../../src/solver/types.ts';

/**
 * Prototype for issue #24. solve() does not call this.
 *
 * Impossible-candidate removal preserves every validated build, including ties.
 * It does not claim to preserve LP solutions that validateBuild rejects.
 * Dominated-part removal is reported separately and preserves only an optimal
 * value plus one witness.
 */
export interface DominanceDrop {
  drop: string;
  keep: string;
  dropPrice: number;
  keepPrice: number;
  guarantee: 'optimal-value-and-one-witness';
}

export interface PruneAssessment {
  reachable: number;
  inModel: number;
  droppedBeforeModel: number;
  alreadyFixedZero: string[];
  impossible: string[];
  reasons: Record<string, string>;
  rootUnvalidated: boolean;
  dominance: DominanceDrop[];
  fixpointMs: number;
  dominanceMs: number;
}

export function assessCandidatePruning(params: SolveParams): PruneAssessment {
  return assessFromLp(params, buildLP(params));
}

export function assessFromLp(params: SolveParams, lp: LPResult): PruneAssessment {
  const lookup = params.itemLookup;
  const weaponId = params.weaponId;
  const modelIds = lp.indexToItem.slice(1).filter(id => id.length > 0);
  const model = new Set(modelIds);
  const locked = new Set((params.includeItems ?? []).filter((id): id is string => !!id));
  const reachable = Object.keys(params.compatibilityMap.reachable_items);

  const conflicts = (a: string, b: string): boolean => {
    if (a === b) return false;
    const left = lookup[a];
    const right = lookup[b];
    const leftHits = left?.type === 'mod' && left.conflicting_items.includes(b);
    const rightHits = right?.type === 'mod' && right.conflicting_items.includes(a);
    return leftHits || rightHits;
  };

  const choices = (itemId: string): { slotId: string; ownerId: string }[] => {
    const found: { slotId: string; ownerId: string }[] = [];
    for (const [slotId, items] of Object.entries(lp.slotItemsMap)) {
      if (!items.includes(itemId)) continue;
      const ownerId = lp.slotOwnerMap[slotId];
      if (ownerId) found.push({ slotId, ownerId });
    }
    return found;
  };

  const hasLegalParent = (itemId: string, placeable: Set<string>): boolean => {
    for (const choice of choices(itemId)) {
      const ownerLive = choice.ownerId === weaponId || placeable.has(choice.ownerId);
      if (!ownerLive) continue;
      if (conflicts(itemId, choice.ownerId)) continue;
      return true;
    }
    return false;
  };

  const fillers = (slotId: string, ownerId: string, placeable: Set<string>): string[] => {
    const listed = lp.slotItemsMap[slotId] ?? [];
    return listed.filter(id => placeable.has(id) && id !== ownerId && !conflicts(id, ownerId));
  };

  const slotsOf = (ownerId: string): SlotInfo[] => lookup[ownerId]?.slots ?? [];

  const requiredFilled = (itemId: string, placeable: Set<string>): boolean => {
    const entry = lookup[itemId];
    if (entry?.type !== 'mod') return true;
    for (const slot of entry.slots) {
      if (!slot.required) continue;
      if (fillers(slot.id, itemId, placeable).length === 0) return false;
    }
    return true;
  };

  const rootBroken = (placeable: Set<string>): boolean => {
    for (const slot of slotsOf(weaponId)) {
      if (!slot.required) continue;
      if (fillers(slot.id, weaponId, placeable).length === 0) return true;
    }
    return false;
  };

  const grow = (active: Set<string>): Set<string> => {
    const placeable = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of active) {
        if (placeable.has(id)) continue;
        if (!hasLegalParent(id, placeable)) continue;
        placeable.add(id);
        changed = true;
      }
    }
    return placeable;
  };

  const forcedSet = (placeable: Set<string>): Set<string> => {
    const forced = new Set<string>();
    const queue = [weaponId];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const owner = queue.shift()!;
      if (seen.has(owner)) continue;
      seen.add(owner);
      for (const slot of slotsOf(owner)) {
        if (!slot.required) continue;
        const options = fillers(slot.id, owner, placeable);
        if (options.length === 1 && !forced.has(options[0])) {
          forced.add(options[0]);
          queue.push(options[0]);
        }
      }
    }
    return forced;
  };

  const lpFixedZero = (itemId: string): boolean => {
    return !choices(itemId).some(choice => choice.ownerId === weaponId || model.has(choice.ownerId));
  };

  const fixpointStarted = performance.now();
  let active = new Set(modelIds);
  const reasons = new Map<string, string>();
  let rootUnvalidated = false;
  for (let step = 0; step <= modelIds.length; step++) {
    const placeable = grow(active);
    if (rootBroken(placeable)) {
      rootUnvalidated = true;
      reasons.clear();
      break;
    }
    const forced = forcedSet(placeable);
    const next = new Set<string>();
    for (const id of placeable) {
      if (!requiredFilled(id, placeable)) continue;
      const blocked = [...forced].some(other => other !== id && conflicts(id, other));
      if (blocked) continue;
      next.add(id);
    }
    if (next.size === active.size) break;
    for (const id of active) {
      if (next.has(id) || reasons.has(id)) continue;
      if (!placeable.has(id)) reasons.set(id, 'no chain of legal parents to the weapon');
      else if (!requiredFilled(id, placeable)) reasons.set(id, 'required slot has no installable filler');
      else reasons.set(id, 'conflicts with a part every validated build must include');
    }
    active = next;
  }

  const alreadyFixedZero: string[] = [];
  const impossible: string[] = [];
  const reasonOut: Record<string, string> = {};
  if (!rootUnvalidated) {
    for (const id of modelIds) {
      if (locked.has(id) || active.has(id)) continue;
      if (lpFixedZero(id)) {
        alreadyFixedZero.push(id);
        reasonOut[id] = 'no surviving slot owner; the LP already forces this variable to 0';
      } else {
        impossible.push(id);
        reasonOut[id] = reasons.get(id) ?? 'no validated build can select it';
      }
    }
  }
  alreadyFixedZero.sort();
  impossible.sort();
  const fixpointMs = performance.now() - fixpointStarted;
  const dominanceStarted = performance.now();
  const dominance = rootUnvalidated ? [] : dominatedDrops(params, lp, modelIds, locked);
  const dominanceMs = performance.now() - dominanceStarted;

  return {
    reachable: reachable.length,
    inModel: modelIds.length,
    droppedBeforeModel: reachable.filter(id => !model.has(id)).length,
    alreadyFixedZero,
    impossible,
    reasons: reasonOut,
    rootUnvalidated,
    dominance,
    fixpointMs,
    dominanceMs,
  };
}

function separatelyBuyable(params: SolveParams, itemId: string): { buyable: boolean; price: number } {
  const entry = params.itemLookup[itemId];
  if (entry?.type !== 'mod') return { buyable: false, price: 0 };
  if (entry.stats.purchasable === false) return { buyable: false, price: 0 };
  const [price, , available] = getAvailablePrice(
    entry.stats,
    params.traderLevels,
    params.fleaAvailable ?? true,
    params.playerLevel ?? null,
    params.barterAvailable ?? false,
    params.barterExcludeDogtags ?? false,
  );
  return { buyable: available && price > 0, price };
}

function presetIds(lookup: ItemLookup, weaponId: string, itemId: string): string[] {
  const weapon = lookup[weaponId];
  if (weapon?.type !== 'gun') return [];
  return weapon.presets.filter(preset => presetSupply(preset.items).has(itemId)).map(preset => preset.id).sort();
}

function conflictClosure(lookup: ItemLookup, itemId: string): string[] {
  const entry = lookup[itemId];
  const ids = new Set<string>();
  if (entry?.type === 'mod') {
    for (const other of entry.conflicting_items) if (other !== itemId) ids.add(other);
  }
  for (const [otherId, other] of Object.entries(lookup)) {
    if (other?.type === 'mod' && other.conflicting_items.includes(itemId) && otherId !== itemId) ids.add(otherId);
  }
  return [...ids].sort();
}

/** Same displayed stats or a lower standalone price is not enough. Every field here must match. */
function equivalenceKey(params: SolveParams, lp: LPResult, itemId: string): string {
  const entry = params.itemLookup[itemId];
  if (entry?.type !== 'mod') return `non-mod:${itemId}`;
  const mod: ModLookupEntry = entry;
  const incoming = Object.entries(lp.slotItemsMap)
    .filter(([, items]) => items.includes(itemId))
    .map(([slotId]) => slotId)
    .sort();
  const outgoing = mod.slots
    .map(slot => ({ required: slot.required, nameId: slot.nameId, allows: [...slot.allowedItems].sort() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const stats = mod.stats;
  return JSON.stringify({
    incoming,
    outgoing,
    conflicts: conflictClosure(params.itemLookup, itemId),
    conflictingSlots: [...mod.conflicting_slot_ids].sort(),
    ergonomics: stats.ergonomics,
    recoil: stats.recoil_modifier,
    accuracy: stats.accuracy_modifier,
    centerOfImpact: stats.center_of_impact,
    weight: stats.weight,
    capacity: stats.capacity,
    sightingRange: stats.sighting_range,
    zoomMin: stats.zoom_min ?? null,
    zoomMax: stats.zoom_max ?? null,
    categoryId: stats.category_id,
    handbook: [...(stats.handbook_categories ?? [])].sort(),
    categoryNormalized: stats.category_normalized ?? null,
    categoryChildren: [...(stats.category_child_ids ?? [])].sort(),
    foundInRaid: stats.purchasable === false,
    presets: presetIds(params.itemLookup, params.weaponId, itemId),
  });
}

function cannotCoexist(lp: LPResult, lookup: ItemLookup, a: string, b: string): boolean {
  if (a === b) return false;
  const left = lookup[a];
  const right = lookup[b];
  const conflicts = (left?.type === 'mod' && left.conflicting_items.includes(b))
    || (right?.type === 'mod' && right.conflicting_items.includes(a));
  if (conflicts) return true;
  const slotsOf = (itemId: string) => Object.entries(lp.slotItemsMap)
    .filter(([, items]) => items.includes(itemId))
    .map(([slotId]) => slotId);
  const slotsA = slotsOf(a);
  const slotsB = slotsOf(b);
  for (const leftSlot of slotsA) {
    for (const rightSlot of slotsB) {
      if (leftSlot !== rightSlot) return false;
    }
  }
  return true;
}

function dominatedDrops(params: SolveParams, lp: LPResult, modelIds: string[], locked: Set<string>): DominanceDrop[] {
  const groups = new Map<string, string[]>();
  for (const id of modelIds) {
    const key = equivalenceKey(params, lp, id);
    const list = groups.get(key) ?? [];
    list.push(id);
    groups.set(key, list);
  }
  const drops: DominanceDrop[] = [];
  for (const group of groups.values()) {
    const buyable = group
      .filter(id => !locked.has(id))
      .map(id => ({ id, ...separatelyBuyable(params, id) }))
      .filter(item => item.buyable);
    if (buyable.length < 2) continue;
    const keepPrice = Math.min(...buyable.map(item => item.price));
    const keepers = buyable.filter(item => item.price === keepPrice);
    for (const candidate of buyable) {
      if (candidate.price <= keepPrice) continue;
      const blocked = keepers.every(keeper => cannotCoexist(lp, params.itemLookup, candidate.id, keeper.id));
      if (!blocked) continue;
      drops.push({
        drop: candidate.id,
        keep: keepers[0].id,
        dropPrice: candidate.price,
        keepPrice,
        guarantee: 'optimal-value-and-one-witness',
      });
    }
  }
  drops.sort((a, b) => a.drop.localeCompare(b.drop));
  return drops;
}
