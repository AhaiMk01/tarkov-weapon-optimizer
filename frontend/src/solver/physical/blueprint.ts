/**
 * Immutable physical blueprint of one weapon (ADR 0003, ADR 0012 Tier 1, ADR 0013 section 4A).
 *
 * `preparePhysicalWeapon(lookup, weaponId)` unrolls the weapon into its path-qualified occurrence universe from the
 * UNPRUNED production `ItemLookup`: no user filter, no availability, no market. It is request-independent. The
 * domain preparation (`domain.ts`) masks it; nothing ever compacts or mutates it.
 *
 * Model (ADR 0003):
 *  - An *occurrence* v is one item template placed under one physical slot: v = (template, parent physical slot).
 *    Occurrence 0 is the receiver itself; item occurrences are 1 .. occurrenceCount-1.
 *  - A *physical slot* s = (owner occurrence u, template slot id) holds at most one of its candidate occurrences.
 *    Every candidate occurrence has exactly one parent slot. The same template under two parents, or in two slots of
 *    one parent, is two distinct occurrences.
 *  - No ancestor-template repetition: a template never recurs on one root-to-leaf path (the receiver counts as an
 *    ancestor of everything). This is an explicit finite-domain restriction, not a claim about the game.
 *  - Required slots with no candidate are KEPT (candidateCount 0): the owner of an empty required slot can never be
 *    built; for the receiver that makes the whole domain empty. The domain preparation propagates it.
 *  - Camora / ammunition-only slots are removed from the domain, not emptied (INTERPRETATIONS.md choice 15). The
 *    production lookup holds guns and mods only, so ammunition is never an entry; an allowed id is ammunition only when
 *    the data layer says so: it is listed in the slot's `ammoItems` (source item type `ammo`), or `options.isAmmo` says so.
 *    An allowed id the lookup does not hold and nothing flags as ammunition is a recorded drop, never ammunition by
 *    default. A slot that mixes ammunition with parts throws.
 *
 * Memory layout (all integer ids, flat typed arrays, no per-occurrence objects or strings). Occurrences are numbered in
 * breadth-first creation order, so every child index is greater than its owner's, the slots of one occurrence are
 * contiguous, and the candidates of one slot are a contiguous run of occurrences:
 *
 *   occTemplate[v]      template index of occurrence v                      occParentSlot[v]  parent slot (-1 for v = 0)
 *   occSlotStart[v..v+1] the physical slots owned by v (CSR, length N+1)
 *   slotOwner[s]        owner occurrence                                    slotRawId[s]      index into rawSlotIds
 *   slotRequired[s]     0/1                                                 slotCandStart[s], slotCandCount[s]  candidate run
 *
 * Template data (a few thousand entries) lives in small per-template arrays. Instance ids are path-derived strings,
 * `parentInstanceId/slotId:templateId` with `weapon_0` for the receiver (the reference's scheme), computed on demand.
 */

import { presetSupply } from '../presetSupply';
import type { GunLookupEntry, ItemLookup, ItemLookupEntry } from '../types';
import { PhysicalModelError } from './errors';

/** Typed-array views that cannot be assigned through (the arrays themselves are never mutated after preparation). */
export type I32 = Readonly<Int32Array>;
export type F64 = Readonly<Float64Array>;
export type U8 = Readonly<Uint8Array>;

export const BLUEPRINT_VERSION = 1;

/** Instance id of the receiver; the first segment of every path-derived instance id. */
export const ROOT_INSTANCE_ID = 'weapon_0';

/** Safety limit on the occurrence universe. The pinned capture peaks well below 1M; reaching this is an input failure. */
export const DEFAULT_MAX_OCCURRENCES = 4_000_000;

export interface PreparePhysicalOptions {
  /**
   * Additional ammunition classifier for an allowed id the lookup does not hold, on top of the data-layer flags
   * (`SlotInfo.ammoItems`). For payloads that carry no item types, such as the pinned snapshot. Default: none. An unknown id
   * that neither the flags nor this classifier call ammunition is dropped from its allowlist and recorded.
   */
  isAmmo?: (itemId: string) => boolean;
  /**
   * The category chain of an item, own category first and then its ancestors (INTERPRETATIONS.md choice 5). Default:
   * the nested `data.bsgCategory` chain production carries, falling back to the own `category_id`.
   */
  categoryChainOf?: (itemId: string, entry: ItemLookupEntry) => readonly string[];
  /** Safety limit on item occurrences (default {@link DEFAULT_MAX_OCCURRENCES}). */
  maxOccurrences?: number;
}

/** A template slot removed because every allowed id is ammunition. */
export interface RemovedAmmoSlot {
  ownerTemplateId: string;
  slotId: string;
  ammoItemIds: readonly string[];
}

/** An allowed id removed from an allowlist because it is no installable part of this lookup. */
export interface DroppedAllowedItem {
  ownerTemplateId: string;
  slotId: string;
  itemId: string;
  reason: 'not_in_lookup' | 'not_a_mod';
}

/** One factory preset of the weapon, unfiltered: supply q_{b,i} as integer counts keyed by template id. */
export interface PresetCatalogEntry {
  id: string;
  name: string;
  /** Position in `GunLookupEntry.all_presets`, for the domain preparation to read the offers. */
  lookupIndex: number;
  /** Positive integer supply per item id (every contained id, including ones outside the physical domain). */
  supply: ReadonlyMap<string, number>;
}

export interface BoundsInterval {
  readonly min: number;
  readonly max: number;
}

/**
 * Raw physical ranges of the whole weapon (receiver included): the exact min and max over every structurally buildable
 * tree, ignoring conflicts and every request filter. Plain binary64 sums, not outward-rounded: the numerics phase owns
 * rounding allowances.
 */
export interface PhysicalRawBounds {
  readonly weight: BoundsInterval;
  readonly ergonomics: BoundsInterval;
  /** Sum of recoil modifiers (dimensionless fraction). */
  readonly recoil: BoundsInterval;
}

export interface PhysicalBlueprintStats {
  /** Item occurrences, receiver excluded. */
  itemOccurrences: number;
  slots: number;
  templates: number;
  /** Allowlist entries skipped because the template was an ancestor (no-ancestor-repetition rule). */
  prunedAncestorEdges: number;
  /** Item occurrences that can never be built, whatever the request: a receiver-banned template, or an empty required slot below. */
  structurallyImpossibleOccurrences: number;
}

export interface PhysicalBlueprint {
  readonly version: typeof BLUEPRINT_VERSION;
  readonly weaponId: string;
  readonly stats: PhysicalBlueprintStats;

  // --- templates: index 0 is the receiver ---
  readonly templateCount: number;
  readonly templateIds: readonly string[];
  readonly templateWeight: F64;
  /** Mods: ergonomics modifier. Receiver: naked ergonomics. */
  readonly templateErgonomics: F64;
  readonly templateRecoilModifier: F64;
  readonly templateAccuracyModifier: F64;
  readonly templateCenterOfImpact: F64;
  readonly templateCapacity: F64;
  readonly templateSightingRange: F64;
  /** Own category first, then ancestors. */
  readonly templateCategoryChain: readonly (readonly string[])[];
  /** Template index of an id, or -1 when the id has no template in this weapon's universe. */
  templateIndexOf(templateId: string): number;

  // --- occurrences (receiver = 0) ---
  /** Number of occurrences including the receiver; item occurrences are 1 .. occurrenceCount-1. */
  readonly occurrenceCount: number;
  readonly occTemplate: I32;
  /** Parent physical slot of each occurrence, -1 for the receiver. */
  readonly occParentSlot: I32;
  /** CSR over occurrences: occurrence v owns physical slots occSlotStart[v] .. occSlotStart[v+1]-1. */
  readonly occSlotStart: I32;
  templateId(occurrence: number): string;
  parentSlot(occurrence: number): number;
  /** Instances(A): the occurrences of template A, ascending. */
  instancesOf(templateIndex: number): I32;
  /** Path-derived instance id (`weapon_0/slot:item/slot:item...`). */
  instanceId(occurrence: number): string;
  /** Inverse of {@link instanceId}; -1 when the id names no occurrence. */
  occurrenceByInstanceId(instanceId: string): number;

  // --- physical slots ---
  readonly slotCount: number;
  readonly slotOwnerArray: I32;
  readonly slotRawIdArray: I32;
  readonly slotRequiredArray: U8;
  readonly slotCandStart: I32;
  readonly slotCandCount: I32;
  /** Distinct template slot ids of the physical slots. */
  readonly rawSlotIds: readonly string[];
  slotOwner(slot: number): number;
  rawSlotId(slot: number): string;
  slotRequired(slot: number): boolean;
  /** Candidates of a slot are the occurrences candidateStart(s) .. candidateStart(s)+candidateCount(s)-1. */
  candidateStart(slot: number): number;
  candidateCount(slot: number): number;
  /** Index of a template slot id among `rawSlotIds`, or -1 when no physical slot carries it. */
  rawSlotIndexOf(slotId: string): number;
  /** PhysicalSlots(t): every physical slot whose template slot id is rawSlotIds[rawIdIndex], ascending. */
  physicalSlotsOfRawId(rawIdIndex: number): I32;

  // --- conflicts (presence-based; the physical slot rows come from the domain) ---
  /** Symmetrized template conflict pairs (a, b) with a < b, flat [a0, b0, a1, b1, ...]; both have occurrences. */
  readonly templateConflictPairs: I32;
  /** 1 when the template lists itself as conflicting: at most one installed copy. */
  readonly templateSelfConflict: U8;
  /** 1 when the receiver lists the template or the template lists the receiver: it can never be installed. */
  readonly templateReceiverBanned: U8;
  /** Raw slot id indexes (into `rawSlotIds`) the template blocks when installed; ids matching no physical slot are dropped. */
  slotConflictsOf(templateIndex: number): I32;

  // --- direct raw structural bounds per occurrence subtree (NaN where the subtree is structurally impossible) ---
  /**
   * 1 when the subtree under the occurrence can be built under some request: its template is not banned by the receiver and every
   * required slot it owns has a buildable candidate.
   */
  readonly structurallyViable: U8;
  readonly weightMin: F64;
  readonly weightMax: F64;
  readonly ergonomicsMin: F64;
  readonly ergonomicsMax: F64;
  readonly recoilMin: F64;
  readonly recoilMax: F64;
  /** Raw ranges of the whole weapon, or null when the receiver itself cannot be built (a root required slot is empty). */
  readonly rawBounds: PhysicalRawBounds | null;

  // --- records ---
  readonly removedAmmoSlots: readonly RemovedAmmoSlot[];
  readonly removedAmmoItemIds: readonly string[];
  readonly droppedAllowedItems: readonly DroppedAllowedItem[];
  /** The weapon's factory presets, unfiltered, with validated integer supply. */
  readonly presets: readonly PresetCatalogEntry[];
}

// ---------------------------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------------------------

/** Which lookup each blueprint was prepared from; the domain refuses a blueprint used with another lookup. */
const preparedFrom = new WeakMap<object, ItemLookup>();

export function blueprintMatchesLookup(blueprint: PhysicalBlueprint, lookup: ItemLookup): boolean {
  return preparedFrom.get(blueprint) === lookup;
}

/** Growable Int32 buffer: pushes during the breadth-first unrolling, trimmed once at the end. */
class IntBuffer {
  data: Int32Array;
  length = 0;

  constructor(capacity: number) {
    this.data = new Int32Array(Math.max(16, capacity));
  }

  push(value: number): void {
    if (this.length === this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = value;
  }

  trimmed(): Int32Array {
    return this.data.slice(0, this.length);
  }
}

interface SlotDef {
  rawIdx: number;
  required: boolean;
  /** Candidate template indexes in allowlist order, deduplicated. */
  candidates: Int32Array;
}

const hasEntry = (lookup: ItemLookup, id: string): boolean => Object.hasOwn(lookup, id);

const asIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') ids.push(item);
    else if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') ids.push((item as { id: string }).id);
  }
  return ids;
};

/** Nested `data.bsgCategory` chain (own id, then each parent's id), or the own `category_id`. */
function defaultCategoryChain(entry: ItemLookupEntry): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let node = entry.data.bsgCategory as { id?: unknown; parent?: unknown } | null | undefined;
  while (node && typeof node === 'object' && typeof node.id === 'string' && node.id !== '' && !seen.has(node.id)) {
    seen.add(node.id);
    chain.push(node.id);
    node = node.parent as { id?: unknown; parent?: unknown } | null | undefined;
  }
  if (chain.length === 0) {
    const own = entry.stats.category_id;
    if (own) chain.push(own);
  }
  return chain;
}

function buildPresetCatalog(weaponId: string, weapon: GunLookupEntry): PresetCatalogEntry[] {
  const catalog: PresetCatalogEntry[] = [];
  const seen = new Set<string>();
  (weapon.all_presets ?? []).forEach((preset, lookupIndex) => {
    const bad = (detail: string): never => {
      throw new PhysicalModelError('BAD_PRESET', `Preset ${preset.id} of ${weaponId}: ${detail}`, { presetId: preset.id, weaponId });
    };
    if (preset.receiver_id !== weaponId) bad(`built on ${preset.receiver_id}, not on its own receiver`);
    if (seen.has(preset.id)) bad('duplicate preset id');
    seen.add(preset.id);
    for (const component of preset.items) {
      if (!Number.isSafeInteger(component.count) || component.count < 0) bad(`component ${component.itemId} has count ${component.count}, not a nonnegative integer`);
    }
    catalog.push({ id: preset.id, name: preset.name, lookupIndex, supply: presetSupply(preset.items) });
  });
  return catalog;
}

export function preparePhysicalWeapon(
  lookup: ItemLookup,
  weaponId: string,
  options: PreparePhysicalOptions = {},
): PhysicalBlueprint {
  const weapon = hasEntry(lookup, weaponId) ? lookup[weaponId] : undefined;
  if (!weapon || weapon.type !== 'gun') {
    throw new PhysicalModelError('UNKNOWN_WEAPON', `Weapon ${weaponId} is not a gun entry of the item lookup`, { weaponId });
  }
  const extraIsAmmo = options.isAmmo;
  const categoryChainOf = options.categoryChainOf ?? ((_id: string, entry: ItemLookupEntry) => defaultCategoryChain(entry));
  const maxOccurrences = options.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;

  // --- template registry: index 0 is the receiver, others are assigned on first appearance in an allowlist ---
  const templateIds: string[] = [weaponId];
  const templateEntries: ItemLookupEntry[] = [weapon];
  const templateIndex = new Map<string, number>([[weaponId, 0]]);
  const indexOfTemplate = (id: string): number => {
    let t = templateIndex.get(id);
    if (t === undefined) {
      t = templateIds.length;
      templateIds.push(id);
      templateEntries.push(lookup[id]);
      templateIndex.set(id, t);
    }
    return t;
  };

  // --- template slot ids: one raw id belongs to exactly one template (issue #29) ---
  const rawSlotIds: string[] = [];
  const rawSlotIndex = new Map<string, number>();
  const rawIdOwnerTemplate: number[] = [];

  const removedAmmoSlots: RemovedAmmoSlot[] = [];
  const removedAmmoItemIds = new Set<string>();
  const droppedAllowedItems: DroppedAllowedItem[] = [];

  const slotDefsByTemplate: (SlotDef[] | undefined)[] = [];

  function resolveSlotDefs(t: number): SlotDef[] {
    const cached = slotDefsByTemplate[t];
    if (cached) return cached;
    const ownerId = templateIds[t];
    const defs: SlotDef[] = [];
    const seenInTemplate = new Set<string>();
    for (const slotInfo of templateEntries[t].slots) {
      const parts: string[] = [];
      const ammo: string[] = [];
      const seenAllowed = new Set<string>();
      const flaggedAmmo = slotInfo.ammoItems && slotInfo.ammoItems.length > 0 ? new Set(slotInfo.ammoItems) : null;
      for (const allowedId of slotInfo.allowedItems) {
        if (seenAllowed.has(allowedId)) continue;
        seenAllowed.add(allowedId);
        if (allowedId === weaponId) {
          parts.push(allowedId); // the receiver template: always an ancestor, pruned at expansion
        } else if (hasEntry(lookup, allowedId)) {
          if (lookup[allowedId].type === 'mod') parts.push(allowedId);
          else droppedAllowedItems.push({ ownerTemplateId: ownerId, slotId: slotInfo.id, itemId: allowedId, reason: 'not_a_mod' });
        } else if (flaggedAmmo?.has(allowedId) === true || extraIsAmmo?.(allowedId) === true) {
          ammo.push(allowedId);
        } else {
          droppedAllowedItems.push({ ownerTemplateId: ownerId, slotId: slotInfo.id, itemId: allowedId, reason: 'not_in_lookup' });
        }
      }
      if (ammo.length > 0) {
        if (parts.length > 0) {
          throw new PhysicalModelError(
            'MIXED_AMMO_SLOT',
            `Slot ${slotInfo.id} of ${ownerId} mixes ammunition (${ammo.join(', ')}) with parts (${parts.join(', ')})`,
            { ownerTemplateId: ownerId, slotId: slotInfo.id },
          );
        }
        removedAmmoSlots.push({ ownerTemplateId: ownerId, slotId: slotInfo.id, ammoItemIds: ammo });
        for (const id of ammo) removedAmmoItemIds.add(id);
        continue;
      }
      if (seenInTemplate.has(slotInfo.id)) {
        throw new PhysicalModelError('SLOT_ID_COLLISION', `Template ${ownerId} defines slot id ${slotInfo.id} twice`, { slotId: slotInfo.id, templates: [ownerId, ownerId] });
      }
      seenInTemplate.add(slotInfo.id);
      let rawIdx = rawSlotIndex.get(slotInfo.id);
      if (rawIdx === undefined) {
        rawIdx = rawSlotIds.length;
        rawSlotIds.push(slotInfo.id);
        rawSlotIndex.set(slotInfo.id, rawIdx);
        rawIdOwnerTemplate.push(t);
      } else if (rawIdOwnerTemplate[rawIdx] !== t) {
        throw new PhysicalModelError(
          'SLOT_ID_COLLISION',
          `Slot id ${slotInfo.id} is defined by two distinct templates (${templateIds[rawIdOwnerTemplate[rawIdx]]} and ${ownerId})`,
          { slotId: slotInfo.id, templates: [templateIds[rawIdOwnerTemplate[rawIdx]], ownerId] },
        );
      }
      const candidates = new Int32Array(parts.length);
      parts.forEach((id, k) => { candidates[k] = indexOfTemplate(id); });
      defs.push({ rawIdx, required: slotInfo.required === true, candidates });
    }
    slotDefsByTemplate[t] = defs;
    return defs;
  }

  // --- breadth-first unrolling into path-qualified occurrences ---
  const occTemplateBuf = new IntBuffer(1024);
  const occParentSlotBuf = new IntBuffer(1024);
  const occSlotStartBuf = new IntBuffer(1024);
  const slotOwnerBuf = new IntBuffer(1024);
  const slotRawBuf = new IntBuffer(1024);
  const slotRequiredBuf = new IntBuffer(1024);
  const slotCandStartBuf = new IntBuffer(1024);
  const slotCandCountBuf = new IntBuffer(1024);

  occTemplateBuf.push(0);
  occParentSlotBuf.push(-1);
  let prunedAncestorEdges = 0;
  const ancestors: number[] = [];

  for (let v = 0; v < occTemplateBuf.length; v++) {
    occSlotStartBuf.push(slotOwnerBuf.length);
    const defs = resolveSlotDefs(occTemplateBuf.data[v]);
    if (defs.length === 0) continue;
    ancestors.length = 0;
    for (let u = v; ;) {
      ancestors.push(occTemplateBuf.data[u]);
      if (u === 0) break;
      u = slotOwnerBuf.data[occParentSlotBuf.data[u]];
    }
    for (const def of defs) {
      const s = slotOwnerBuf.length;
      slotOwnerBuf.push(v);
      slotRawBuf.push(def.rawIdx);
      slotRequiredBuf.push(def.required ? 1 : 0);
      const first = occTemplateBuf.length;
      slotCandStartBuf.push(first);
      for (let k = 0; k < def.candidates.length; k++) {
        const c = def.candidates[k];
        if (ancestors.includes(c)) {
          prunedAncestorEdges++;
          continue;
        }
        occTemplateBuf.push(c);
        occParentSlotBuf.push(s);
      }
      slotCandCountBuf.push(occTemplateBuf.length - first);
      if (occTemplateBuf.length - 1 > maxOccurrences) {
        throw new PhysicalModelError(
          'OCCURRENCE_LIMIT',
          `Weapon ${weaponId} unrolls to more than ${maxOccurrences} item occurrences`,
          { weaponId, maxOccurrences },
        );
      }
    }
  }
  occSlotStartBuf.push(slotOwnerBuf.length);

  const N = occTemplateBuf.length;
  const S = slotOwnerBuf.length;
  const T = templateIds.length;
  const occTemplate = occTemplateBuf.trimmed();
  const occParentSlot = occParentSlotBuf.trimmed();
  const occSlotStart = occSlotStartBuf.trimmed();
  const slotOwnerArr = slotOwnerBuf.trimmed();
  const slotRawIdArr = slotRawBuf.trimmed();
  const slotRequiredArr = Uint8Array.from(slotRequiredBuf.trimmed());
  const slotCandStart = slotCandStartBuf.trimmed();
  const slotCandCount = slotCandCountBuf.trimmed();

  // --- per-template attributes ---
  const templateWeight = new Float64Array(T);
  const templateErgonomics = new Float64Array(T);
  const templateRecoilModifier = new Float64Array(T);
  const templateAccuracyModifier = new Float64Array(T);
  const templateCenterOfImpact = new Float64Array(T);
  const templateCapacity = new Float64Array(T);
  const templateSightingRange = new Float64Array(T);
  const templateCategoryChain: (readonly string[])[] = [];
  for (let t = 0; t < T; t++) {
    const entry = templateEntries[t];
    if (entry.type === 'gun') {
      templateWeight[t] = entry.stats.weight || 0;
      templateErgonomics[t] = entry.stats.naked_ergonomics || 0;
      templateAccuracyModifier[t] = entry.stats.accuracy_modifier || 0;
      templateCenterOfImpact[t] = entry.stats.center_of_impact || 0;
      templateSightingRange[t] = entry.stats.sighting_range || 0;
    } else {
      templateWeight[t] = entry.stats.weight || 0;
      templateErgonomics[t] = entry.stats.ergonomics || 0;
      templateRecoilModifier[t] = entry.stats.recoil_modifier || 0;
      templateAccuracyModifier[t] = entry.stats.accuracy_modifier || 0;
      templateCenterOfImpact[t] = entry.stats.center_of_impact || 0;
      templateCapacity[t] = entry.stats.capacity || 0;
      templateSightingRange[t] = entry.stats.sighting_range || 0;
    }
    templateCategoryChain.push(Object.freeze([...categoryChainOf(templateIds[t], entry)]));
  }

  // --- Instances(A): occurrences per template (counting sort over item occurrences) ---
  const templateOccStart = new Int32Array(T + 1);
  for (let v = 1; v < N; v++) templateOccStart[occTemplate[v] + 1]++;
  for (let t = 0; t < T; t++) templateOccStart[t + 1] += templateOccStart[t];
  const templateOccList = new Int32Array(Math.max(0, N - 1));
  {
    const cursor = templateOccStart.slice(0, T);
    for (let v = 1; v < N; v++) templateOccList[cursor[occTemplate[v]]++] = v;
  }

  // --- PhysicalSlots(t): physical slots per raw template slot id ---
  const R = rawSlotIds.length;
  const rawPhysStart = new Int32Array(R + 1);
  for (let s = 0; s < S; s++) rawPhysStart[slotRawIdArr[s] + 1]++;
  for (let r = 0; r < R; r++) rawPhysStart[r + 1] += rawPhysStart[r];
  const rawPhysList = new Int32Array(S);
  {
    const cursor = rawPhysStart.slice(0, R);
    for (let s = 0; s < S; s++) rawPhysList[cursor[slotRawIdArr[s]]++] = s;
  }

  // --- conflicts ---
  const templateSelfConflict = new Uint8Array(T);
  const templateReceiverBanned = new Uint8Array(T);
  const pairKeys = new Set<number>();
  const pairList: number[] = [];
  const emptyI32 = new Int32Array(0);
  const slotConflicts: Int32Array[] = new Array<Int32Array>(T).fill(emptyI32);
  for (const bannedId of asIdList(weapon.data.conflictingItems)) {
    const t = templateIndex.get(bannedId);
    if (t !== undefined && t > 0) templateReceiverBanned[t] = 1;
  }
  for (let t = 1; t < T; t++) {
    const entry = templateEntries[t];
    if (entry.type !== 'mod') continue;
    for (const otherId of entry.conflicting_items) {
      if (otherId === templateIds[t]) {
        templateSelfConflict[t] = 1;
      } else if (otherId === weaponId) {
        templateReceiverBanned[t] = 1;
      } else {
        const u = templateIndex.get(otherId);
        if (u === undefined) continue;
        const a = Math.min(t, u);
        const b = Math.max(t, u);
        const key = a * T + b;
        if (!pairKeys.has(key)) {
          pairKeys.add(key);
          pairList.push(a, b);
        }
      }
    }
    const blocked: number[] = [];
    for (const slotId of entry.conflicting_slot_ids) {
      const r = rawSlotIndex.get(slotId);
      if (r !== undefined && !blocked.includes(r)) blocked.push(r);
    }
    if (blocked.length > 0) slotConflicts[t] = Int32Array.from(blocked);
  }
  // Stable pair order: by (a, b).
  const pairOrder = Array.from({ length: pairList.length / 2 }, (_, i) => i).sort((x, y) => pairList[2 * x] - pairList[2 * y] || pairList[2 * x + 1] - pairList[2 * y + 1]);
  const templateConflictPairs = new Int32Array(pairList.length);
  pairOrder.forEach((from, to) => {
    templateConflictPairs[2 * to] = pairList[2 * from];
    templateConflictPairs[2 * to + 1] = pairList[2 * from + 1];
  });

  // --- direct raw structural bounds: exact min/max over structurally buildable subtrees, one reverse pass ---
  const structurallyViable = new Uint8Array(N);
  const weightMin = new Float64Array(N);
  const weightMax = new Float64Array(N);
  const ergonomicsMin = new Float64Array(N);
  const ergonomicsMax = new Float64Array(N);
  const recoilMin = new Float64Array(N);
  const recoilMax = new Float64Array(N);
  let impossible = 0;
  for (let v = N - 1; v >= 0; v--) {
    const t = occTemplate[v];
    let wLo = templateWeight[t];
    let wHi = wLo;
    let eLo = templateErgonomics[t];
    let eHi = eLo;
    let rLo = templateRecoilModifier[t];
    let rHi = rLo;
    // A template the receiver conflicts with can never be installed, whatever the request: it is not buildable.
    let viable = v === 0 || templateReceiverBanned[t] === 0;
    for (let s = occSlotStart[v]; s < occSlotStart[v + 1] && viable; s++) {
      let cWLo = Infinity, cWHi = -Infinity, cELo = Infinity, cEHi = -Infinity, cRLo = Infinity, cRHi = -Infinity;
      let any = false;
      for (let c = slotCandStart[s], end = c + slotCandCount[s]; c < end; c++) {
        if (!structurallyViable[c]) continue;
        any = true;
        if (weightMin[c] < cWLo) cWLo = weightMin[c];
        if (weightMax[c] > cWHi) cWHi = weightMax[c];
        if (ergonomicsMin[c] < cELo) cELo = ergonomicsMin[c];
        if (ergonomicsMax[c] > cEHi) cEHi = ergonomicsMax[c];
        if (recoilMin[c] < cRLo) cRLo = recoilMin[c];
        if (recoilMax[c] > cRHi) cRHi = recoilMax[c];
      }
      if (slotRequiredArr[s]) {
        if (!any) { viable = false; break; }
        wLo += cWLo; wHi += cWHi; eLo += cELo; eHi += cEHi; rLo += cRLo; rHi += cRHi;
      } else if (any) {
        // An optional slot may stay empty (contributes 0) or take its best/worst candidate.
        wLo += Math.min(0, cWLo); wHi += Math.max(0, cWHi);
        eLo += Math.min(0, cELo); eHi += Math.max(0, cEHi);
        rLo += Math.min(0, cRLo); rHi += Math.max(0, cRHi);
      }
    }
    if (viable) {
      structurallyViable[v] = 1;
      weightMin[v] = wLo; weightMax[v] = wHi;
      ergonomicsMin[v] = eLo; ergonomicsMax[v] = eHi;
      recoilMin[v] = rLo; recoilMax[v] = rHi;
    } else {
      weightMin[v] = weightMax[v] = ergonomicsMin[v] = ergonomicsMax[v] = recoilMin[v] = recoilMax[v] = NaN;
      if (v > 0) impossible++;
    }
  }
  const rawBounds: PhysicalRawBounds | null = structurallyViable[0]
    ? {
        weight: { min: weightMin[0], max: weightMax[0] },
        ergonomics: { min: ergonomicsMin[0], max: ergonomicsMax[0] },
        recoil: { min: recoilMin[0], max: recoilMax[0] },
      }
    : null;

  const presets = buildPresetCatalog(weaponId, weapon);

  // --- accessors ---
  const instanceId = (occurrence: number): string => {
    const segments: string[] = [];
    for (let v = occurrence; v > 0; ) {
      const s = occParentSlot[v];
      segments.push(`/${rawSlotIds[slotRawIdArr[s]]}:${templateIds[occTemplate[v]]}`);
      v = slotOwnerArr[s];
    }
    return ROOT_INSTANCE_ID + segments.reverse().join('');
  };

  const occurrenceByInstanceId = (id: string): number => {
    if (!id.startsWith(ROOT_INSTANCE_ID)) return -1;
    let rest = id.slice(ROOT_INSTANCE_ID.length);
    let v = 0;
    while (rest.length > 0) {
      if (rest[0] !== '/') return -1;
      rest = rest.slice(1);
      let found = -1;
      let remainder = '';
      for (let s = occSlotStart[v]; s < occSlotStart[v + 1] && found < 0; s++) {
        const prefix = `${rawSlotIds[slotRawIdArr[s]]}:`;
        if (!rest.startsWith(prefix)) continue;
        const after = rest.slice(prefix.length);
        for (let c = slotCandStart[s], end = c + slotCandCount[s]; c < end; c++) {
          const tid = templateIds[occTemplate[c]];
          if (after === tid || after.startsWith(`${tid}/`)) {
            found = c;
            remainder = after.slice(tid.length);
            break;
          }
        }
      }
      if (found < 0) return -1;
      v = found;
      rest = remainder;
    }
    return v;
  };

  const blueprint: PhysicalBlueprint = {
    version: BLUEPRINT_VERSION,
    weaponId,
    stats: {
      itemOccurrences: N - 1,
      slots: S,
      templates: T,
      prunedAncestorEdges,
      structurallyImpossibleOccurrences: impossible,
    },
    templateCount: T,
    templateIds,
    templateWeight,
    templateErgonomics,
    templateRecoilModifier,
    templateAccuracyModifier,
    templateCenterOfImpact,
    templateCapacity,
    templateSightingRange,
    templateCategoryChain,
    templateIndexOf: id => templateIndex.get(id) ?? -1,
    occurrenceCount: N,
    occTemplate,
    occParentSlot,
    occSlotStart,
    templateId: occurrence => templateIds[occTemplate[occurrence]],
    parentSlot: occurrence => occParentSlot[occurrence],
    instancesOf: t => templateOccList.subarray(templateOccStart[t], templateOccStart[t + 1]),
    instanceId,
    occurrenceByInstanceId,
    slotCount: S,
    slotOwnerArray: slotOwnerArr,
    slotRawIdArray: slotRawIdArr,
    slotRequiredArray: slotRequiredArr,
    slotCandStart,
    slotCandCount,
    rawSlotIds,
    slotOwner: slot => slotOwnerArr[slot],
    rawSlotId: slot => rawSlotIds[slotRawIdArr[slot]],
    slotRequired: slot => slotRequiredArr[slot] === 1,
    candidateStart: slot => slotCandStart[slot],
    candidateCount: slot => slotCandCount[slot],
    rawSlotIndexOf: id => rawSlotIndex.get(id) ?? -1,
    physicalSlotsOfRawId: r => rawPhysList.subarray(rawPhysStart[r], rawPhysStart[r + 1]),
    templateConflictPairs,
    templateSelfConflict,
    templateReceiverBanned,
    slotConflictsOf: t => slotConflicts[t],
    structurallyViable,
    weightMin,
    weightMax,
    ergonomicsMin,
    ergonomicsMax,
    recoilMin,
    recoilMax,
    rawBounds,
    removedAmmoSlots,
    removedAmmoItemIds: [...removedAmmoItemIds],
    droppedAllowedItems,
    presets,
  };
  preparedFrom.set(blueprint, lookup);
  return Object.freeze(blueprint);
}
