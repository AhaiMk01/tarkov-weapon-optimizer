// Differential helper for the physical blueprint and the subproblem-domain masks (Stage 2, phase 2.4a).
//
// For a ledger case it builds the production blueprint and domain (src/solver/physical) from the production lookup the existing
// `toProduction.differential.ts` maps the fixture to, and computes the SAME structural facts on the oracle side with the oracle's own
// public surface (enumerateTrees, resolveRequest, the acquisition model). The test compares the two.
//
// Representation mapping (documented here instead of weakening a check):
//
//  * Occurrence identity. The oracle's trees are lists of placements with path-derived `childInstanceId`s (`parent/slot:item`, receiver
//    `weapon_0`). The blueprint's instance ids are the same scheme, so an occurrence is identified by its instance id on both sides.
//  * Admitted trees. The oracle enumerates every rooted tree structurally; filters and availability are the validator's job there. The
//    blueprint admits a tree through its masks. So the oracle's side is `enumerateTrees` filtered by the per-item bans a mask
//    can express: an item the request excludes (id or category chain), an item the receiver conflicts with, and an item with zero supply
//    (no legal standalone offer, no stock, no accessible preset supplying it). Caps, pair conflicts, includes and the objective are not
//    part of a mask and are ignored on both sides.
//  * Production lookup. Category chains are not in the mapped lookup (`category_id` is the own category only), so the nested
//    `data.bsgCategory` chain production carries is rebuilt from the fixture's `categories` (own first, then ancestors).
//  * Offers. `legalOfferIndexes` indexes the production offer list (price-sorted, zero prices already dropped), the oracle indexes the
//    original list; legal offers are therefore compared by count and cheapest price, not by index.
//  * Features the production inputs cannot carry (see `maskRelevantUnsupported`) make a case "skipped", exactly as the 2.1 harness
//    does; they are recorded, never silently dropped.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import {
  accessibleBases, baseOffer, enumerateTrees, isExcludedByRequest, presetSupplyOf, resolveFixture, resolveRequest, standaloneOffers, toNumber,
  type BaseChoice, type ReferenceFixture, type ReferenceRequest,
} from '../oracle/index';
import {
  preparePhysicalWeapon, prepareSubproblemDomain,
  type PhysicalBlueprint, type SubproblemDomain, type SubproblemRequest,
} from '../../src/solver/physical';
import type { ItemLookup, ModLookupEntry } from '../../src/solver/types';
import { detectUnsupported, mapFixture, type UnsupportedFeatureId } from './toProduction.differential';

/** The unsupported features of `toProduction.differential.ts` that change a mask or the acquisition domain. */
const MASK_RELEVANT: readonly UnsupportedFeatureId[] = [
  'flea_player_level_on_base',
  'flea_offers_distinct_player_levels',
  'non_canonical_trader_name',
];

export function maskRelevantUnsupported(fixture: ReferenceFixture, request: ReferenceRequest): string[] {
  return detectUnsupported(fixture, request).filter(f => MASK_RELEVANT.includes(f.feature)).map(f => `${f.feature}: ${f.detail}`);
}

// ---------------------------------------------------------------------------------------------
// Production side
// ---------------------------------------------------------------------------------------------

function categoryNode(chain: readonly string[]): unknown {
  return chain.length === 0 ? null : { id: chain[0], parent: categoryNode(chain.slice(1)) };
}

/** The mapped production lookup with the nested `data.bsgCategory` chain rebuilt from the fixture's category lists. */
export function productionLookup(fixture: ReferenceFixture): ItemLookup {
  const lookup = mapFixture(fixture);
  for (const item of fixture.items) {
    const entry = lookup[item.id] as ModLookupEntry;
    entry.data = { ...entry.data, bsgCategory: categoryNode(item.categories ?? []) };
  }
  return lookup;
}

/** The request fields the domain preparation reads, taken 1:1 from the reference request. */
export function subproblemRequestOf(request: ReferenceRequest): SubproblemRequest {
  return {
    excludeItems: request.exclude_items ?? null,
    excludeCategories: request.exclude_categories ?? null,
    traderLevels: request.trader_levels ?? null,
    fleaAvailable: request.flea_available,
    barterAvailable: request.barter_available,
    barterExcludeDogtags: request.barter_exclude_dogtags,
    playerLevel: request.player_level ?? null,
    ownedItems: request.owned_items ?? null,
  };
}

export interface ProductionPhysical {
  lookup: ItemLookup;
  blueprint: PhysicalBlueprint;
  domain: SubproblemDomain;
}

export function prepareProduction(fixture: ReferenceFixture, request: ReferenceRequest): ProductionPhysical {
  const lookup = productionLookup(fixture);
  const blueprint = preparePhysicalWeapon(lookup, request.weapon_id);
  const domain = prepareSubproblemDomain(blueprint, lookup, subproblemRequestOf(request));
  return { lookup, blueprint, domain };
}

// ---------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------

/** Canonical key of a tree: its instance ids in code-unit order. */
export const treeKey = (instanceIds: readonly string[]): string => JSON.stringify([...instanceIds].sort());

export interface TreeSet {
  /** Tree keys. */
  trees: Set<string>;
  /** Instance ids appearing in at least one tree. */
  occurrences: Set<string>;
  complete: boolean;
}

/**
 * Every rooted tree the blueprint admits when `allowed(c)` says a candidate may be used: each slot holds one allowed candidate or, when
 * optional, nothing; required slots are filled. A required slot with no allowed candidate gives no tree for its owner.
 */
export function blueprintTrees(blueprint: PhysicalBlueprint, allowed: (occurrence: number) => boolean, maxTrees = 200_000): TreeSet {
  const budget = maxTrees;
  let complete = true;
  // All complete subtrees rooted at occurrence v (v itself excluded from the list; the caller adds it).
  const below = (v: number): number[][] => {
    let combos: number[][] = [[]];
    for (let s = blueprint.occSlotStart[v]; s < blueprint.occSlotStart[v + 1]; s++) {
      const options: number[][] = blueprint.slotRequired(s) ? [] : [[]];
      for (let c = blueprint.candidateStart(s), end = c + blueprint.candidateCount(s); c < end; c++) {
        if (!allowed(c)) continue;
        for (const sub of below(c)) options.push([c, ...sub]);
        if (options.length > budget) { complete = false; return []; }
      }
      const next: number[][] = [];
      for (const left of combos) for (const option of options) next.push([...left, ...option]);
      if (next.length > budget) { complete = false; return []; }
      combos = next;
    }
    return combos;
  };
  const all = below(0);
  const trees = new Set<string>();
  const occurrences = new Set<string>();
  for (const tree of all) {
    const ids = tree.map(v => blueprint.instanceId(v));
    trees.add(treeKey(ids));
    for (const id of ids) occurrences.add(id);
  }
  return { trees, occurrences, complete };
}

/** The trees the masks of a prepared domain admit. An empty domain admits none. */
export function domainTrees(blueprint: PhysicalBlueprint, domain: SubproblemDomain, maxTrees?: number): TreeSet {
  if (domain.empty) return { trees: new Set(), occurrences: new Set(), complete: true };
  return blueprintTrees(blueprint, c => domain.occActive[c] === 1, maxTrees);
}

/** The oracle's trees, keeping only those whose every item passes `itemAllowed`. */
function oracleTreesWhere(fixture: ReferenceFixture, weaponId: string, itemAllowed: (itemId: string) => boolean): TreeSet {
  const enumeration = enumerateTrees(fixture, weaponId);
  const trees = new Set<string>();
  const occurrences = new Set<string>();
  for (const tree of enumeration.trees) {
    if (!tree.every(p => itemAllowed(p.itemId))) continue;
    const ids = tree.map(p => p.childInstanceId);
    trees.add(treeKey(ids));
    for (const id of ids) occurrences.add(id);
  }
  return { trees, occurrences, complete: enumeration.complete };
}

export interface OracleSide {
  /** Trees using only items no per-item ban rules out (none when no base is accessible): the comparison target of the domain masks. */
  masked: TreeSet;
  /** Trees using no receiver-banned item: the comparison target of the blueprint's structural viability. */
  structural: TreeSet;
  /** Accessible bases, `naked` or `preset:<id>`, sorted. */
  bases: string[];
  baseCheapest: Map<string, number>;
  /** Per template id: acquisition facts of the oracle. */
  templates: Map<string, { standalone: number; cheapest: number | null; owned: number; presets: string[] }>;
}

export function oracleSide(fixture: ReferenceFixture, request: ReferenceRequest): OracleSide {
  const rf = resolveFixture(fixture);
  const rr = resolveRequest(fixture, request);
  const weapon = rf.weapons.get(request.weapon_id)!;
  const bases: BaseChoice[] = accessibleBases(rf, rr);
  const keyOf = (b: BaseChoice) => (b.kind === 'naked' ? 'naked' : `preset:${b.presetId}`);
  const baseCheapest = new Map<string, number>();
  for (const base of bases) baseCheapest.set(keyOf(base), toNumber(baseOffer(rf, rr, base)!.lotPrice));

  const templates = new Map<string, { standalone: number; cheapest: number | null; owned: number; presets: string[] }>();
  for (const item of rf.items.values()) {
    const offers = standaloneOffers(rf, rr, item.id);
    const presets: string[] = [];
    for (const base of bases) {
      const q = presetSupplyOf(rf, base, item.id);
      if (q > 0 && base.kind === 'preset') presets.push(`${base.presetId}x${q}`);
    }
    templates.set(item.id, {
      standalone: offers.length,
      cheapest: offers.length ? Math.min(...offers.map(o => toNumber(o.lotPrice))) : null,
      owned: rr.owned.get(item.id) ?? 0,
      presets: presets.sort(),
    });
  }
  const receiverBanned = (itemId: string): boolean => {
    const item = rf.items.get(itemId);
    return weapon.conflictingItemIds.has(itemId) || (item !== undefined && item.conflictingItemIds.has(weapon.id));
  };
  const supplied = (itemId: string): boolean => {
    const t = templates.get(itemId)!;
    return t.standalone > 0 || t.owned > 0 || t.presets.length > 0;
  };
  const excluded = (itemId: string): boolean => isExcludedByRequest(rr, rf.items.get(itemId)!);
  // With no accessible base no build exists at all, whatever the trees are (the domain is empty).
  const noTrees: TreeSet = { trees: new Set(), occurrences: new Set(), complete: true };
  return {
    masked: bases.length === 0 ? noTrees : oracleTreesWhere(fixture, request.weapon_id, id => !excluded(id) && !receiverBanned(id) && supplied(id)),
    structural: oracleTreesWhere(fixture, request.weapon_id, id => !receiverBanned(id)),
    bases: bases.map(keyOf).sort(),
    baseCheapest,
    templates,
  };
}

// ---------------------------------------------------------------------------------------------
// Independent walk over a (bridge) fixture: occurrence count and raw ranges
// ---------------------------------------------------------------------------------------------

export interface WalkResult {
  /** Item occurrences (receiver excluded): every allowlist entry on every path that repeats no ancestor template. */
  occurrences: number;
  /** False when the receiver cannot be built (a required slot has no buildable candidate). */
  buildable: boolean;
  weight: { min: number; max: number };
  ergonomics: { min: number; max: number };
  recoil: { min: number; max: number };
}

/**
 * Counts the path-qualified occurrences of a fixture and computes the raw min/max of weight, ergonomics and recoil over its buildable
 * trees, by a plain recursive walk over the fixture's own slot lists. It shares no code with the blueprint: no typed arrays, no breadth-first
 * numbering, no memoization. Items the receiver conflicts with are never buildable.
 */
export function independentWalk(fixture: ReferenceFixture, weaponId: string): WalkResult {
  const items = new Map(fixture.items.map(i => [i.id, i]));
  const weapon = fixture.weapons.find(w => w.id === weaponId)!;
  const banned = (id: string): boolean => (weapon.conflictingItemIds ?? []).includes(id) || (items.get(id)?.conflictingItemIds ?? []).includes(weaponId);
  let occurrences = 0;
  interface Range { ok: boolean; w: [number, number]; e: [number, number]; r: [number, number] }
  const walk = (slots: NonNullable<ReferenceFixture['weapons'][number]['slots']>, ancestors: readonly string[]): Range => {
    const out: Range = { ok: true, w: [0, 0], e: [0, 0], r: [0, 0] };
    for (const slot of slots) {
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      let any = false;
      for (const id of new Set(slot.allowedItemIds)) {
        if (ancestors.includes(id)) continue;
        occurrences++;
        const item = items.get(id)!;
        const below = walk(item.slots ?? [], [...ancestors, id]);
        if (banned(id) || !below.ok) continue;
        any = true;
        const own = [item.weightKg ?? 0, item.ergonomics ?? 0, item.recoilModifier ?? 0];
        const bounds = [below.w, below.e, below.r];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], own[k] + bounds[k][0]);
          hi[k] = Math.max(hi[k], own[k] + bounds[k][1]);
        }
      }
      if (slot.required && !any) {
        out.ok = false;
      } else if (any) {
        const targets = [out.w, out.e, out.r];
        for (let k = 0; k < 3; k++) {
          // A required slot takes its best or worst candidate; an optional one may also stay empty.
          targets[k][0] += slot.required ? lo[k] : Math.min(0, lo[k]);
          targets[k][1] += slot.required ? hi[k] : Math.max(0, hi[k]);
        }
      }
    }
    return out;
  };
  const root = walk(weapon.slots ?? [], [weaponId]);
  const own = [weapon.weightKg ?? 0, weapon.ergonomics ?? 0, 0];
  return {
    occurrences,
    buildable: root.ok,
    weight: { min: own[0] + root.w[0], max: own[0] + root.w[1] },
    ergonomics: { min: own[1] + root.e[0], max: own[1] + root.e[1] },
    recoil: { min: own[2] + root.r[0], max: own[2] + root.r[1] },
  };
}
