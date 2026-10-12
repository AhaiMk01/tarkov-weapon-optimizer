/**
 * Subproblem-domain preparation (ADR 0012 Tier 2, ADR 0002, ADR 0003, ADR 0008, ADR 0013 section 4A).
 *
 * `prepareSubproblemDomain(blueprint, lookup, request)` takes the immutable blueprint and one normalized request and
 * returns stable boolean masks over the blueprint's own indexes (never compacted) plus the exact acquisition domain.
 * The blueprint is read, never written; two preparations of one blueprint share nothing but it.
 *
 * What is decided here, per request:
 *  - Filters: user excludes by item id and by category chain (own category or any ancestor); receiver-conflict bans
 *    (an item that lists the receiver, or that the receiver lists, can never be installed).
 *  - Availability per template: the legal standalone offers (`acquisition.ts`), the supply q_{b,i} of every accessible
 *    preset, and the owned stock N_owned(i). A template with no legal standalone offer is capped by preset plus owned
 *    supply (`supply: 'capped'`), not dropped, and is never priced by a stand-in; only a template whose supply is zero
 *    everywhere (`supply: 'none'`) can never be installed and is masked.
 *  - Accessible bases: the naked receiver when it has a legal offer, and every preset with a legal offer. Owned stock
 *    never grants a base and there is no free fallback: an empty base set is a recorded contradiction.
 *  - Fixed point over the path-qualified tree (two linear passes, children are always numbered after their owner):
 *    bottom-up, an occurrence is *viable* when it survives the filters and every required slot it owns still has a
 *    viable candidate (an empty required slot, or one whose candidates are all gone, forces its owner off); top-down,
 *    an occurrence is *reachable* when it is viable and its owner is. A root required slot with no viable candidate
 *    empties the whole domain. Only banned, unsupplied, impossible or unreachable occurrences are removed. An optional
 *    parent is never removed for being undecided, and a template reached through several parents keeps every
 *    alternative path.
 *
 * Request-dependent numerics (caps, objective, equipment) are not here: they belong to the model builder (`specializeCount` / `specializeFast`).
 */

import type { GunLookupEntry, ItemLookup, ModLookupEntry } from '../types';
import { cheapestPrice, legalOfferIndexes, legalOffers, resolveMarket, type AcquisitionOffer, type MarketInput } from './acquisition';
import { blueprintMatchesLookup, type I32, type PhysicalBlueprint, type U8 } from './blueprint';
import { PhysicalModelError } from './errors';
import { countOwnedItems } from './ownedItems';

/** Why an occurrence is not active. `ACTIVE` (0) means it is. Stored one byte per occurrence. */
export const InactiveReason = {
  ACTIVE: 0,
  /** Its template is excluded by item id or by a category in its chain. */
  USER_EXCLUDED: 1,
  /** The receiver conflicts with its template. */
  RECEIVER_CONFLICT: 2,
  /** No legal standalone offer, no accessible preset supplies it and none is owned: its cap is zero. */
  NO_SUPPLY: 3,
  /** A required slot it owns has no viable candidate (empty in the source, or every candidate is gone). */
  IMPOSSIBLE_OWNER: 4,
  /** Itself viable, but an ancestor is not. */
  UNREACHABLE: 5,
  /** Would be active, but the domain is empty (no accessible base, or a root required slot cannot be filled). */
  DOMAIN_EMPTY: 6,
} as const;

export type InactiveReasonCode = (typeof InactiveReason)[keyof typeof InactiveReason];

export interface SubproblemRequest extends MarketInput {
  excludeItems?: readonly string[] | null;
  /** A category id matches an item whose own-or-ancestor category chain contains it. */
  excludeCategories?: readonly string[] | null;
  /**
   * Stash multiset (ADR 0008): element multiplicity is quantity. Omitted, null and [] all mean no stock. The shape matches
   * `SolveParams.ownedItems`, so a `SolveParams` value is accepted as the request. An invalid stash is the typed input error
   * `INVALID_OWNED_ITEMS` (see `ownedItems.ts`), never an empty domain. Owning a part never grants a receiver.
   */
  ownedItems?: readonly string[] | null;
}

/** A root required slot that cannot be filled, or no way to buy the receiver. Never an input failure. */
export type DomainContradiction =
  | { code: 'NO_ACCESSIBLE_BASE' }
  | { code: 'ROOT_REQUIRED_SLOT_EMPTY'; slot: number; rawSlotId: string };

export type AccessibleBase =
  | {
      kind: 'naked';
      /** Legal offers of the receiver, as indexes into `GunStats.offers`. */
      offerIndexes: readonly number[];
      cheapestPrice: number;
    }
  | {
      kind: 'preset';
      presetId: string;
      /** Position in `GunLookupEntry.all_presets`. */
      lookupIndex: number;
      /** Legal offers of the preset, as indexes into `PresetInfo.offers`. */
      offerIndexes: readonly number[];
      cheapestPrice: number;
      /** q_{b,i}: positive integer supply per item id. */
      supply: ReadonlyMap<string, number>;
    };

/** How installed copies of a template are limited (ADR 0002 sections 7 and 8). */
export type SupplyClass =
  /** The receiver (template 0): not an item. */
  | 'receiver'
  /** A legal standalone offer exists: copies are bounded only by what the budget allows. */
  | 'standalone'
  /** No legal standalone offer: installed copies <= owned + the selected preset's q. */
  | 'capped'
  /** No standalone offer, no accessible preset supply and no stock: zero copies. */
  | 'none';

export interface TemplateAcquisition {
  /** Excluded by the request, by item id or category chain. */
  excluded: boolean;
  /** Banned by a receiver conflict. */
  receiverBanned: boolean;
  /** Legal standalone offers as ascending indexes into `ModStats.offers`. */
  standaloneOffers: readonly number[];
  /**
   * The same legal offers as lots (aligned with `standaloneOffers`): index, source, the price of one whole lot and the units one
   * purchase delivers. A paid deficit is covered with whole lots (INTERPRETATIONS.md choice 1); there is no per-unit price.
   */
  standaloneLots: readonly AcquisitionOffer[];
  /** Cheapest stored price among the legal offers, or null: never a stand-in. */
  cheapestPrice: number | null;
  /** N_owned(i). */
  owned: number;
  /** q_{b,i} for every accessible preset b that supplies the template, `base` indexing `SubproblemDomain.bases`. */
  presetSupply: readonly { base: number; quantity: number }[];
  supply: SupplyClass;
}

export interface SubproblemDomain {
  readonly blueprint: PhysicalBlueprint;
  /** True when no build exists: some contradiction is recorded. All masks are then zero. */
  readonly empty: boolean;
  readonly contradictions: readonly DomainContradiction[];

  /** Active mask over occurrence indexes (0 = receiver). An occurrence is active iff some admissible tree can contain it. */
  readonly occActive: U8;
  /** {@link InactiveReason} per occurrence. */
  readonly occInactiveReason: U8;
  /** A physical slot is active iff its owner occurrence is. Candidates are masked by `occActive`. */
  readonly slotActive: U8;
  /** Active instances per template. */
  readonly templateActiveCount: I32;
  /** Occurrence counts per {@link InactiveReason} code (index 0 counts the active item occurrences). */
  readonly reasonCounts: readonly number[];

  /** Accessible bases in order: the naked receiver (if legal) first, then presets in `all_presets` order. */
  readonly bases: readonly AccessibleBase[];
  /** Per template index (aligned with the blueprint's template arrays). */
  readonly templates: readonly TemplateAcquisition[];
  /** The retained multiset: every owned id with its multiplicity, including ids outside the physical universe. */
  readonly ownedItems: ReadonlyMap<string, number>;
}

/** One flea gate per item, carried by mods (`min_level_flea`); receivers and presets carry none. */
const fleaGateOf = (stats: object): number => {
  const gate = (stats as { min_level_flea?: unknown }).min_level_flea;
  return typeof gate === 'number' ? gate : 0;
};

export function prepareSubproblemDomain(
  blueprint: PhysicalBlueprint,
  lookup: ItemLookup,
  request: SubproblemRequest = {},
): SubproblemDomain {
  if (!blueprintMatchesLookup(blueprint, lookup)) {
    throw new PhysicalModelError(
      'FOREIGN_BLUEPRINT',
      `The blueprint of ${blueprint.weaponId} was not prepared from this item lookup`,
      { weaponId: blueprint.weaponId },
    );
  }
  const owned = countOwnedItems(request.ownedItems);
  const market = resolveMarket(request);
  const excludeItems = new Set(request.excludeItems ?? []);
  const excludeCategories = new Set(request.excludeCategories ?? []);
  const weapon = lookup[blueprint.weaponId] as GunLookupEntry;

  // --- accessible bases: legal offers only, no owned receiver, no free fallback ---
  const bases: AccessibleBase[] = [];
  {
    const offers = weapon.stats.offers;
    const legal = legalOfferIndexes(offers, fleaGateOf(weapon.stats), market);
    if (legal.length > 0) bases.push({ kind: 'naked', offerIndexes: legal, cheapestPrice: cheapestPrice(offers, legal)! });
  }
  for (const preset of blueprint.presets) {
    const info = weapon.all_presets[preset.lookupIndex];
    const legal = legalOfferIndexes(info.offers, fleaGateOf(info), market);
    if (legal.length === 0) continue;
    bases.push({
      kind: 'preset',
      presetId: preset.id,
      lookupIndex: preset.lookupIndex,
      offerIndexes: legal,
      cheapestPrice: cheapestPrice(info.offers, legal)!,
      supply: preset.supply,
    });
  }

  // --- per-template acquisition and template-level masks ---
  const T = blueprint.templateCount;
  const templates: TemplateAcquisition[] = new Array<TemplateAcquisition>(T);
  const templateReason = new Uint8Array(T);
  templates[0] = {
    excluded: false, receiverBanned: false, standaloneOffers: [], standaloneLots: [], cheapestPrice: null, owned: 0, presetSupply: [], supply: 'receiver',
  };
  for (let t = 1; t < T; t++) {
    const id = blueprint.templateIds[t];
    const entry = lookup[id] as ModLookupEntry;
    const chain = blueprint.templateCategoryChain[t];
    const excluded = excludeItems.has(id) || chain.some(category => excludeCategories.has(category));
    const receiverBanned = blueprint.templateReceiverBanned[t] === 1;
    const standaloneLots = legalOffers(entry.stats.offers, fleaGateOf(entry.stats), market);
    const standaloneOffers = standaloneLots.map(offer => offer.index);
    const presetSupply: { base: number; quantity: number }[] = [];
    bases.forEach((base, b) => {
      if (base.kind !== 'preset') return;
      const quantity = base.supply.get(id) ?? 0;
      if (quantity > 0) presetSupply.push({ base: b, quantity });
    });
    const ownedCount = owned.get(id) ?? 0;
    const supply: SupplyClass = standaloneOffers.length > 0 ? 'standalone' : presetSupply.length > 0 || ownedCount > 0 ? 'capped' : 'none';
    templates[t] = {
      excluded,
      receiverBanned,
      standaloneOffers,
      standaloneLots,
      cheapestPrice: cheapestPrice(entry.stats.offers, standaloneOffers),
      owned: ownedCount,
      presetSupply,
      supply,
    };
    templateReason[t] = excluded
      ? InactiveReason.USER_EXCLUDED
      : receiverBanned
        ? InactiveReason.RECEIVER_CONFLICT
        : supply === 'none'
          ? InactiveReason.NO_SUPPLY
          : InactiveReason.ACTIVE;
  }

  // --- fixed point, bottom-up: viability (children are numbered after their owner, so one reverse pass suffices) ---
  const N = blueprint.occurrenceCount;
  const { occTemplate, occSlotStart, slotCandStart, slotCandCount, slotRequiredArray } = blueprint;
  const reason = new Uint8Array(N);
  const viable = new Uint8Array(N);
  for (let v = N - 1; v >= 0; v--) {
    const templateLevel = v === 0 ? InactiveReason.ACTIVE : templateReason[occTemplate[v]];
    if (templateLevel !== InactiveReason.ACTIVE) {
      reason[v] = templateLevel;
      continue;
    }
    let ok = true;
    for (let s = occSlotStart[v]; s < occSlotStart[v + 1] && ok; s++) {
      if (!slotRequiredArray[s]) continue;
      let any = false;
      for (let c = slotCandStart[s], end = c + slotCandCount[s]; c < end; c++) {
        if (viable[c]) { any = true; break; }
      }
      if (!any) ok = false;
    }
    if (ok) viable[v] = 1;
    else reason[v] = InactiveReason.IMPOSSIBLE_OWNER;
  }

  // --- contradictions: no base, or a root required slot nobody can fill ---
  const contradictions: DomainContradiction[] = [];
  if (bases.length === 0) contradictions.push({ code: 'NO_ACCESSIBLE_BASE' });
  for (let s = occSlotStart[0]; s < occSlotStart[1]; s++) {
    if (!blueprint.slotRequired(s)) continue;
    let any = false;
    for (let c = slotCandStart[s], end = c + slotCandCount[s]; c < end; c++) {
      if (viable[c]) { any = true; break; }
    }
    if (!any) contradictions.push({ code: 'ROOT_REQUIRED_SLOT_EMPTY', slot: s, rawSlotId: blueprint.rawSlotId(s) });
  }
  const empty = contradictions.length > 0;

  // --- fixed point, top-down: reachability from the receiver along viable owners ---
  const occActive = new Uint8Array(N);
  const reachable = new Uint8Array(N);
  reachable[0] = 1;
  const reasonCounts = new Array<number>(Object.keys(InactiveReason).length).fill(0);
  for (let v = 1; v < N; v++) {
    if (reason[v] === InactiveReason.ACTIVE) {
      const owner = blueprint.slotOwner(blueprint.parentSlot(v));
      if (reachable[owner]) {
        reachable[v] = 1;
        if (empty) reason[v] = InactiveReason.DOMAIN_EMPTY;
        else occActive[v] = 1;
      } else {
        reason[v] = InactiveReason.UNREACHABLE;
      }
    }
    reasonCounts[reason[v]]++;
  }
  if (!empty) occActive[0] = 1;
  else if (reason[0] === InactiveReason.ACTIVE) reason[0] = InactiveReason.DOMAIN_EMPTY;

  const slotActive = new Uint8Array(blueprint.slotCount);
  for (let s = 0; s < blueprint.slotCount; s++) slotActive[s] = occActive[blueprint.slotOwner(s)];
  const templateActiveCount = new Int32Array(T);
  for (let v = 1; v < N; v++) if (occActive[v]) templateActiveCount[occTemplate[v]]++;

  const domain: SubproblemDomain = {
    blueprint,
    empty,
    contradictions,
    occActive,
    occInactiveReason: reason,
    slotActive,
    templateActiveCount,
    reasonCounts,
    bases,
    templates,
    ownedItems: owned,
  };
  return Object.freeze(domain);
}
