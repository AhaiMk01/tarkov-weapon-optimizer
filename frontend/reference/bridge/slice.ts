// Real-data micro-domains (Stage 1, ADR 0013 section 3: "finite-fixture" oracle runs).
//
// sliceFixture turns a mapped fixture into a small derived domain the oracle can enumerate exhaustively.
// A dropped item is ABSENT from the domain: it leaves fixture.items and every slot allowlist, preset supply
// and conflict list. Required slots stay required, so required-slot emptiness keeps its meaning (a required
// slot that loses every candidate makes its owner uninstallable, or the receiver unbuildable). Everything
// removed is recorded. A slice is a derived domain, never a claim about the full weapon.

import type { ReferenceFixture, ReferenceItem, ReferencePreset, ReferenceSlot, ReferenceWeapon } from '../oracle/index';

export class SliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SliceError';
  }
}

export interface SliceSpec {
  /** Template ids of `fixture.items` to keep. Weapons are always kept and cannot be named here. */
  keepItemIds: readonly string[];
  /** Preset ids to keep. Default: every preset. An empty array drops all presets. */
  keepPresetIds?: readonly string[];
}

export interface SliceProvenance {
  claim: 'derived micro-domain, not the full weapon';
  kept: { itemIds: string[]; presetIds: string[] };
  removed: {
    itemIds: string[];
    presetIds: string[];
    /** Allowlist entries removed because the item is absent, weapons first, then items in fixture order. */
    allowlistEntries: { ownerId: string; slotId: string; itemId: string }[];
    /** Preset component entries removed because the item is absent (the receiver component is never removed). */
    presetComponents: { presetId: string; itemId: string; count: number }[];
    /** Conflict-list entries naming an absent item (vacuous, so pruned); a kept item's self-entry is never pruned. */
    conflictEntries: { ownerId: string; itemId: string }[];
  };
  /** Required slots left with no candidate after slicing (owner uninstallable, or the receiver unbuildable). */
  emptiedRequiredSlots: { ownerId: string; slotId: string }[];
  /** Kept items that no kept allowlist reaches from the receiver any more. */
  unreachableKeptItemIds: string[];
}

export interface SliceResult {
  fixture: ReferenceFixture;
  provenance: SliceProvenance;
}

function mapSlots(
  ownerId: string, slots: ReferenceSlot[] | undefined, kept: ReadonlySet<string>,
  removed: SliceProvenance['removed'], emptied: SliceProvenance['emptiedRequiredSlots'],
): ReferenceSlot[] | undefined {
  if (slots === undefined) return undefined;
  return slots.map(slot => {
    const allowedItemIds: string[] = [];
    for (const itemId of slot.allowedItemIds) {
      if (kept.has(itemId)) allowedItemIds.push(itemId);
      else removed.allowlistEntries.push({ ownerId, slotId: slot.id, itemId });
    }
    if (slot.required === true && allowedItemIds.length === 0) emptied.push({ ownerId, slotId: slot.id });
    const out: ReferenceSlot = { ...slot, allowedItemIds };
    return out;
  });
}

function mapConflicts(
  ownerId: string, conflicts: string[] | undefined, keepIds: ReadonlySet<string>, weaponIds: ReadonlySet<string>,
  removed: SliceProvenance['removed'],
): string[] | undefined {
  if (conflicts === undefined) return undefined;
  const out: string[] = [];
  for (const itemId of conflicts) {
    if (keepIds.has(itemId) || weaponIds.has(itemId)) out.push(itemId);
    else removed.conflictEntries.push({ ownerId, itemId });
  }
  return out;
}

export function sliceFixture(fixture: ReferenceFixture, spec: SliceSpec): SliceResult {
  const itemIdsInFixture = new Set(fixture.items.map(i => i.id));
  const weaponIds = new Set(fixture.weapons.map(w => w.id));
  const keepIds = new Set<string>();
  for (const id of spec.keepItemIds) {
    if (weaponIds.has(id)) throw new SliceError(`keepItemIds names ${id}, a weapon: weapons are always kept and are not items`);
    if (!itemIdsInFixture.has(id)) throw new SliceError(`keepItemIds names ${id}, which is not an item of the fixture`);
    keepIds.add(id);
  }
  const presetIdsInFixture = new Set((fixture.presets ?? []).map(p => p.id));
  for (const id of spec.keepPresetIds ?? []) {
    if (!presetIdsInFixture.has(id)) throw new SliceError(`keepPresetIds names ${id}, which is not a preset of the fixture`);
  }
  const keepPresets = spec.keepPresetIds === undefined ? presetIdsInFixture : new Set(spec.keepPresetIds);

  const removed: SliceProvenance['removed'] = { itemIds: [], presetIds: [], allowlistEntries: [], presetComponents: [], conflictEntries: [] };
  const emptied: SliceProvenance['emptiedRequiredSlots'] = [];

  // Weapons first, then items in fixture order: this is the order of the provenance lists.
  const weapons = fixture.weapons.map((weapon): ReferenceWeapon => {
    const { slots: rawSlots, conflictingItemIds: rawConflicts, ...rest } = weapon;
    const slots = mapSlots(weapon.id, rawSlots, keepIds, removed, emptied);
    const conflicts = mapConflicts(weapon.id, rawConflicts, keepIds, weaponIds, removed);
    return { ...structuredClone(rest), ...(slots === undefined ? {} : { slots }), ...(conflicts === undefined ? {} : { conflictingItemIds: conflicts }) };
  });

  const items: ReferenceItem[] = [];
  for (const item of fixture.items) {
    if (!keepIds.has(item.id)) {
      removed.itemIds.push(item.id);
      continue;
    }
    const { slots: rawSlots, conflictingItemIds: rawConflicts, ...rest } = item;
    const slots = mapSlots(item.id, rawSlots, keepIds, removed, emptied);
    const conflicts = mapConflicts(item.id, rawConflicts, keepIds, weaponIds, removed);
    items.push({ ...structuredClone(rest), ...(slots === undefined ? {} : { slots }), ...(conflicts === undefined ? {} : { conflictingItemIds: conflicts }) });
  }

  const presets: ReferencePreset[] = [];
  for (const preset of fixture.presets ?? []) {
    if (!keepPresets.has(preset.id)) {
      removed.presetIds.push(preset.id);
      continue;
    }
    const { components: rawComponents, ...rest } = preset;
    const components: ReferencePreset['components'] = [];
    for (const component of rawComponents) {
      if (keepIds.has(component.itemId) || weaponIds.has(component.itemId)) components.push({ ...component });
      else removed.presetComponents.push({ presetId: preset.id, itemId: component.itemId, count: component.count });
    }
    presets.push({ ...structuredClone(rest), components });
  }

  // Reachability from the receivers over the kept allowlists.
  const byId = new Map(items.map(i => [i.id, i]));
  const reached = new Set<string>();
  const queue: string[] = [];
  const visitSlots = (slots: ReferenceSlot[] | undefined) => {
    for (const slot of slots ?? []) {
      for (const id of slot.allowedItemIds) {
        if (!reached.has(id) && byId.has(id)) {
          reached.add(id);
          queue.push(id);
        }
      }
    }
  };
  for (const weapon of weapons) visitSlots(weapon.slots);
  for (let i = 0; i < queue.length; i++) visitSlots(byId.get(queue[i])?.slots);

  const sliced: ReferenceFixture = {
    schemaVersion: fixture.schemaVersion,
    description: `Derived micro-domain (slice) of: ${fixture.description ?? 'an unnamed fixture'}`,
    items,
    weapons,
    ...(fixture.presets === undefined ? {} : { presets }),
  };
  return {
    fixture: sliced,
    provenance: {
      claim: 'derived micro-domain, not the full weapon',
      kept: { itemIds: items.map(i => i.id), presetIds: presets.map(p => p.id) },
      removed,
      emptiedRequiredSlots: emptied,
      unreachableKeptItemIds: items.filter(i => !reached.has(i.id)).map(i => i.id),
    },
  };
}
