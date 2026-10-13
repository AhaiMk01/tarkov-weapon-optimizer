// Reusable source-evidence checks over the reference world and raw documents (ADR 0013 §3).
//
// Everything here reads raw upstream structures; nothing imports production code. Findings
// are returned as data so tests can both assert on them and print them. Malformed or
// unresolved source is an input/evidence failure, never an infeasibility claim.
import type { RawWorld, RefComponent, RefItem } from './rawReader';

// ----------------------------------------------------------------------------------------
// References
// ----------------------------------------------------------------------------------------

export type ReferenceKind =
  | 'containsItems.item'
  | 'conflictingItems'
  | 'slot.allowedItems'
  | 'slot.excludedItems'
  | 'slot.allowedCategories'
  | 'slot.excludedCategories'
  | 'presets'
  | 'defaultPreset'
  | 'categories'
  | 'handbookCategories'
  | 'category.parent'
  | 'category.children'
  | 'handbookCategory.parent'
  | 'handbookCategory.children'
  | 'buyFromTrader.trader'
  | 'barter.trader'
  | 'barter.requiredItems.item'
  | 'barter.offeredItem.item';

export interface UnresolvedReference {
  readonly kind: ReferenceKind;
  readonly ownerId: string;
  readonly ref: string;
}

/** Every id the documents reference that does not resolve inside the documents. */
export function findUnresolvedReferences(world: RawWorld): UnresolvedReference[] {
  const out: UnresolvedReference[] = [];
  const check = (kind: ReferenceKind, ownerId: string, ref: string, exists: boolean) => {
    if (!exists) out.push({ kind, ownerId, ref });
  };
  for (const item of world.items.values()) {
    for (const component of item.components) check('containsItems.item', item.id, component.itemId, world.items.has(component.itemId));
    for (const ref of item.conflictingItemIds) check('conflictingItems', item.id, ref, world.items.has(ref));
    for (const slot of item.slots) {
      for (const ref of slot.allowedItemIds) check('slot.allowedItems', item.id, ref, world.items.has(ref));
      for (const ref of slot.excludedItemIds) check('slot.excludedItems', item.id, ref, world.items.has(ref));
      for (const ref of slot.allowedCategoryIds) check('slot.allowedCategories', item.id, ref, world.categories.has(ref));
      for (const ref of slot.excludedCategoryIds) check('slot.excludedCategories', item.id, ref, world.categories.has(ref));
    }
    for (const ref of item.presetIds) check('presets', item.id, ref, world.items.has(ref));
    if (item.defaultPresetId !== null) check('defaultPreset', item.id, item.defaultPresetId, world.items.has(item.defaultPresetId));
    for (const ref of item.categoryIds) check('categories', item.id, ref, world.categories.has(ref));
    for (const ref of item.handbookCategoryIds) check('handbookCategories', item.id, ref, world.handbookCategories.has(ref));
    for (const offer of item.buyFromTrader) check('buyFromTrader.trader', item.id, offer.traderId, world.traders.has(offer.traderId));
  }
  for (const category of world.categories.values()) {
    if (category.parentId !== null) check('category.parent', category.id, category.parentId, world.categories.has(category.parentId));
    for (const ref of category.childIds) check('category.children', category.id, ref, world.categories.has(ref));
  }
  for (const category of world.handbookCategories.values()) {
    if (category.parentId !== null) check('handbookCategory.parent', category.id, category.parentId, world.handbookCategories.has(category.parentId));
    for (const ref of category.childIds) check('handbookCategory.children', category.id, ref, world.handbookCategories.has(ref));
  }
  for (const barter of world.barters) {
    check('barter.trader', barter.id, barter.traderId, world.traders.has(barter.traderId));
    for (const requirement of barter.requirements) {
      check('barter.requiredItems.item', barter.id, requirement.itemId, world.items.has(requirement.itemId));
    }
    check('barter.offeredItem.item', barter.id, barter.offered.itemId, world.items.has(barter.offered.itemId));
  }
  return out;
}

export function summarizeUnresolved(list: readonly UnresolvedReference[]): Partial<Record<ReferenceKind, number>> {
  const out: Partial<Record<ReferenceKind, number>> = {};
  for (const entry of list) out[entry.kind] = (out[entry.kind] ?? 0) + 1;
  return out;
}

// ----------------------------------------------------------------------------------------
// Slot ids (issue #29: the source gives no global slot-id guarantee)
// ----------------------------------------------------------------------------------------

export interface SlotIdReport {
  readonly totalSlots: number;
  readonly templatesWithSlots: number;
  readonly duplicatesWithinTemplate: { templateId: string; slotId: string; occurrences: number }[];
  readonly crossTemplateCollisions: { slotId: string; templateIds: string[] }[];
}

export function reportSlotIds(world: RawWorld): SlotIdReport {
  let totalSlots = 0;
  let templatesWithSlots = 0;
  const duplicatesWithinTemplate: SlotIdReport['duplicatesWithinTemplate'] = [];
  const owners = new Map<string, string[]>();
  for (const item of world.items.values()) {
    if (item.slots.length === 0) continue;
    templatesWithSlots++;
    const seen = new Map<string, number>();
    for (const slot of item.slots) {
      totalSlots++;
      seen.set(slot.id, (seen.get(slot.id) ?? 0) + 1);
    }
    for (const [slotId, occurrences] of seen) {
      if (occurrences > 1) duplicatesWithinTemplate.push({ templateId: item.id, slotId, occurrences });
      const list = owners.get(slotId);
      if (list) list.push(item.id);
      else owners.set(slotId, [item.id]);
    }
  }
  const crossTemplateCollisions = [...owners]
    .filter(([, templateIds]) => templateIds.length > 1)
    .map(([slotId, templateIds]) => ({ slotId, templateIds }))
    .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  return { totalSlots, templatesWithSlots, duplicatesWithinTemplate, crossTemplateCollisions };
}

// ----------------------------------------------------------------------------------------
// Counts (ADR 0013 §4A). The audits scan raw JSON so they work even where the strict reader
// would refuse the document, and they are the evidence for "is the default ever exercised".
// ----------------------------------------------------------------------------------------

export interface ContainsCountAudit {
  entries: number;
  absent: number;
  nullCount: number;
  nonNumber: number;
  nonFinite: number;
  nonInteger: number;
  negative: number;
  /** Valid counts (finite nonnegative integers) strictly greater than one. */
  greaterThanOne: number;
}

export function auditContainsCounts(itemsData: Record<string, unknown>): ContainsCountAudit {
  const audit: ContainsCountAudit = {
    entries: 0, absent: 0, nullCount: 0, nonNumber: 0, nonFinite: 0, nonInteger: 0, negative: 0, greaterThanOne: 0,
  };
  const items = (itemsData.items ?? {}) as Record<string, { containsItems?: unknown }>;
  for (const item of Object.values(items)) {
    if (!Array.isArray(item.containsItems)) continue;
    for (const entry of item.containsItems as Record<string, unknown>[]) {
      audit.entries++;
      const count = entry.count;
      if (count === undefined) audit.absent++;
      else if (count === null) audit.nullCount++;
      else if (typeof count !== 'number') audit.nonNumber++;
      else if (!Number.isFinite(count)) audit.nonFinite++;
      else if (!Number.isInteger(count)) audit.nonInteger++;
      else if (count < 0) audit.negative++;
      else if (count > 1) audit.greaterThanOne++;
    }
  }
  return audit;
}

export interface BarterCountAudit {
  barters: number;
  requirementEntries: number;
  absentOrNull: number;
  fractional: number;
  negative: number;
  /** Barters whose offered item count differs from one (the adapter ignores it). */
  offeredCountNotOne: number;
}

export function auditBarterCounts(barters: readonly unknown[]): BarterCountAudit {
  const audit: BarterCountAudit = {
    barters: 0, requirementEntries: 0, absentOrNull: 0, fractional: 0, negative: 0, offeredCountNotOne: 0,
  };
  for (const raw of barters as { requiredItems?: unknown; offeredItem?: { count?: unknown } }[]) {
    audit.barters++;
    if (raw.offeredItem?.count !== 1) audit.offeredCountNotOne++;
    if (!Array.isArray(raw.requiredItems)) continue;
    for (const requirement of raw.requiredItems as Record<string, unknown>[]) {
      audit.requirementEntries++;
      const count = requirement.count;
      if (count === undefined || count === null) audit.absentOrNull++;
      else if (typeof count === 'number' && Number.isFinite(count)) {
        if (count < 0) audit.negative++;
        else if (!Number.isInteger(count)) audit.fractional++;
      }
    }
  }
  return audit;
}

/** Sum repeated component entries into per-item quantities (insertion ordered). */
export function expandComponents(components: readonly RefComponent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const component of components) out.set(component.itemId, (out.get(component.itemId) ?? 0) + component.count);
  return out;
}

export interface PresetMultiplicity { presetId: string; itemId: string; count: number }

export interface PresetCountSummary {
  presets: number;
  entries: number;
  entriesGt1: number;
  presetsWithGt1: number;
  presetsWithRepeatedItemIds: number;
  multiplicities: PresetMultiplicity[];
}

/** Preset ids reachable from guns' `properties.presets`, with their quantity profile. */
export function gunPresetMultiplicities(world: RawWorld): { presetIds: string[]; summary: PresetCountSummary } {
  const presetIds: string[] = [];
  const seen = new Set<string>();
  for (const item of world.items.values()) {
    if (!item.types.includes('gun')) continue;
    for (const id of item.presetIds) {
      if (!seen.has(id) && world.items.has(id)) {
        seen.add(id);
        presetIds.push(id);
      }
    }
  }
  const summary: PresetCountSummary = {
    presets: presetIds.length, entries: 0, entriesGt1: 0, presetsWithGt1: 0, presetsWithRepeatedItemIds: 0, multiplicities: [],
  };
  for (const id of presetIds) {
    const preset = world.items.get(id) as RefItem;
    summary.entries += preset.components.length;
    let hasGt1 = false;
    const ids = new Set<string>();
    let repeated = false;
    for (const component of preset.components) {
      if (ids.has(component.itemId)) repeated = true;
      ids.add(component.itemId);
      if (component.count > 1) {
        summary.entriesGt1++;
        hasGt1 = true;
        summary.multiplicities.push({ presetId: id, itemId: component.itemId, count: component.count });
      }
    }
    if (hasGt1) summary.presetsWithGt1++;
    if (repeated) summary.presetsWithRepeatedItemIds++;
  }
  return { presetIds, summary };
}

// ----------------------------------------------------------------------------------------
// Weights
// ----------------------------------------------------------------------------------------

export interface WeightAudit {
  total: number;
  withWeight: number;
  absent: number;
  fractional: number;
  /** Raw tokens that do not round-trip through binary64 (`String(Number(token)) !== token`). */
  nonCanonical: { id: string; text: string; value: number }[];
}

export function auditWeights(world: RawWorld): WeightAudit {
  const audit: WeightAudit = { total: 0, withWeight: 0, absent: 0, fractional: 0, nonCanonical: [] };
  for (const item of world.items.values()) {
    audit.total++;
    if (item.weight === null) {
      audit.absent++;
      continue;
    }
    audit.withWeight++;
    if (!Number.isInteger(item.weight.value)) audit.fractional++;
    if (String(item.weight.value) !== item.weight.text) {
      audit.nonCanonical.push({ id: item.id, text: item.weight.text, value: item.weight.value });
    }
  }
  return audit;
}

export function findItemsByWeightText(world: RawWorld, text: string): RefItem[] {
  return [...world.items.values()].filter(item => item.weight?.text === text);
}

// ----------------------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------------------

export interface CategoryChainMismatch { itemId: string; actual: readonly string[]; expected: readonly string[] }

/** Walk `parent` pointers from an item's own category; this is what its `categories` must equal. */
export function categoryChain(world: RawWorld, startId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = startId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const category = world.categories.get(current);
    if (!category) break;
    chain.push(current);
    current = category.parentId;
  }
  return chain;
}

export function findCategoryChainMismatches(world: RawWorld): CategoryChainMismatch[] {
  const out: CategoryChainMismatch[] = [];
  for (const item of world.items.values()) {
    if (item.categoryIds.length === 0) continue;
    const expected = categoryChain(world, item.categoryIds[0]);
    if (expected.length !== item.categoryIds.length || expected.some((id, i) => id !== item.categoryIds[i])) {
      out.push({ itemId: item.id, actual: item.categoryIds, expected });
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------------
// Normalized snapshot (fields the snapshot itself retains; no raw provenance is claimed)
// ----------------------------------------------------------------------------------------

export interface SnapshotPresetReport {
  gunCount: number;
  modIds: ReadonlySet<string>;
  /** Unique preset id -> its components exactly as the snapshot stores them. */
  presets: ReadonlyMap<string, readonly RefComponent[]>;
  entries: number;
  entriesGt1: number;
  entriesGt1Mods: number;
  /** Components lacking an explicit finite nonnegative integer count. */
  invalidCounts: number;
  /** Preset ids that appear twice with different component lists. */
  conflictingDuplicates: number;
  presetsWithRepeatedItemIds: number;
}

interface SnapshotLike {
  guns?: unknown;
  mods?: unknown;
}

export function readSnapshotPresets(snapshot: unknown): SnapshotPresetReport {
  const root = snapshot as SnapshotLike;
  const guns = Array.isArray(root.guns) ? (root.guns as Record<string, unknown>[]) : [];
  const mods = Array.isArray(root.mods) ? (root.mods as Record<string, unknown>[]) : [];
  const modIds = new Set(mods.map(m => String(m.id)));
  const presets = new Map<string, RefComponent[]>();
  const report: SnapshotPresetReport = {
    gunCount: guns.length, modIds, presets, entries: 0, entriesGt1: 0, entriesGt1Mods: 0,
    invalidCounts: 0, conflictingDuplicates: 0, presetsWithRepeatedItemIds: 0,
  };
  for (const gun of guns) {
    const props = gun.properties as { presets?: unknown } | null | undefined;
    if (!props || !Array.isArray(props.presets)) continue;
    for (const preset of props.presets as { id?: unknown; containsItems?: unknown }[]) {
      const id = String(preset.id);
      const components: RefComponent[] = [];
      let valid = true;
      for (const entry of (Array.isArray(preset.containsItems) ? preset.containsItems : []) as { item?: { id?: unknown }; count?: unknown }[]) {
        const count = entry.count;
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
          valid = false;
          report.invalidCounts++;
          continue;
        }
        components.push({ itemId: String(entry.item?.id), count });
      }
      const previous = presets.get(id);
      if (previous) {
        const same = previous.length === components.length && previous.every((c, i) => c.itemId === components[i].itemId && c.count === components[i].count);
        if (!same && valid) report.conflictingDuplicates++;
        continue;
      }
      presets.set(id, components);
    }
  }
  for (const components of presets.values()) {
    const ids = new Set<string>();
    let repeated = false;
    for (const component of components) {
      report.entries++;
      if (ids.has(component.itemId)) repeated = true;
      ids.add(component.itemId);
      if (component.count > 1) {
        report.entriesGt1++;
        if (modIds.has(component.itemId)) report.entriesGt1Mods++;
      }
    }
    if (repeated) report.presetsWithRepeatedItemIds++;
  }
  return report;
}

export interface SnapshotRawComparison {
  common: number;
  onlyInSnapshot: string[];
  onlyInRaw: string[];
  quantityDifferences: { presetId: string; itemId: string; snapshot: number; raw: number }[];
}

/** Compare gun-preset quantities in the snapshot with those in a raw capture (informational). */
export function compareSnapshotPresetsToRaw(snapshot: SnapshotPresetReport, world: RawWorld): SnapshotRawComparison {
  const { presetIds } = gunPresetMultiplicities(world);
  const rawIds = new Set(presetIds);
  const out: SnapshotRawComparison = { common: 0, onlyInSnapshot: [], onlyInRaw: [], quantityDifferences: [] };
  for (const id of snapshot.presets.keys()) if (!rawIds.has(id)) out.onlyInSnapshot.push(id);
  for (const id of presetIds) {
    const snapshotComponents = snapshot.presets.get(id);
    if (!snapshotComponents) {
      out.onlyInRaw.push(id);
      continue;
    }
    out.common++;
    const a = expandComponents(snapshotComponents);
    const b = expandComponents((world.items.get(id) as RefItem).components);
    for (const itemId of new Set([...a.keys(), ...b.keys()])) {
      const snapshotCount = a.get(itemId) ?? 0;
      const rawCount = b.get(itemId) ?? 0;
      if (snapshotCount !== rawCount) out.quantityDifferences.push({ presetId: id, itemId, snapshot: snapshotCount, raw: rawCount });
    }
  }
  return out;
}
