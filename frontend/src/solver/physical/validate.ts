/**
 * Occurrence-level production validator (ADR 0010 section 5, ADR 0003 section 5, ADR 0013 sections 4A and 5).
 *
 * `validatePhysicalBuild(lookup, request, build)` judges one physical build, the way the independent reference validator does, and
 * reproduces its every accept and reject: a base choice plus placements `(parentInstanceId, slotId, childInstanceId, itemId)` over the
 * production `ItemLookup`. Every build the solver publishes must pass it. It reads the lookup and the request only; it shares nothing with
 * the LP, the blueprint's index arrays, the domain masks, the model builders or the decoders, so it checks what they produced instead of
 * repeating it. The small helpers it does reuse are pure data rules the ADRs fix once: offer legality (`acquisition.ts`), preset supply
 * (`presetSupply.ts`), `owned_items` validation (`ownedItems.ts`) and the receiver instance id (`blueprint.ts`).
 *
 * What is checked (violation codes are the reference's, so a differential comparison is direct):
 *  - base: a known preset of this receiver (`BASE_UNKNOWN_PRESET`, `BASE_WRONG_WEAPON`) with a legal offer (`BASE_INACCESSIBLE`), or the naked
 *    receiver with a legal offer; when neither the receiver nor any of its presets has a legal offer, the naked receiver is the player's own
 *    at price 0 (owner decision 2026-10-14) and a preset is still inaccessible. Owned stock never grants a receiver or a preset;
 *  - instances: a 1-to-1 `childInstanceId` bijection (`DUPLICATE_INSTANCE_ID`), known parents (`UNKNOWN_PARENT_INSTANCE`), rootedness at the
 *    receiver (`UNROOTED_PLACEMENT`: orphans and floating cycles), known items (`UNKNOWN_ITEM`);
 *  - slots: the parent declares the slot (`UNKNOWN_SLOT`), the slot allows the item (`ITEM_NOT_ALLOWED_IN_SLOT`), at most one child per
 *    physical slot (`SLOT_CAPACITY_EXCEEDED`), no template repeats an ancestor (`ANCESTOR_TEMPLATE_REPETITION`, the receiver included),
 *    required slots of the receiver and of every installed rooted part are occupied (`MISSING_REQUIRED_SLOT`);
 *  - conflicts: template pairs by presence (`TEMPLATE_CONFLICT`, the receiver included, either side listing), a template listing itself caps
 *    its copies at one (`SELF_CONFLICT_COPY_CAP`), an installed item's `conflicting_slot_ids` block every occupied physical slot with a listed
 *    template slot id, its own host slot included (`SLOT_CONFLICT`, INTERPRETATIONS.md choices 11 and 14);
 *  - filters: excluded item ids and categories (`EXCLUDED_ITEM`, `EXCLUDED_CATEGORY`), included items and category groups
 *    (`MISSING_INCLUDE_ITEM`, `MISSING_INCLUDE_CATEGORY_GROUP`); a category id matches the whole category chain (choice 5);
 *  - supply: per item, preset supply, then owned stock, then paid units; an item with no legal standalone offer is capped by preset plus owned
 *    supply (`QUANTITY_CAP_EXCEEDED`, a shortfall is never priced); the spend is the cheapest legal base lot plus, per item, the exact minimum
 *    whole-lot cover of its paid deficit (choice 1);
 *  - hard caps on the exact statistics: price, ergonomics (the first clamp), final recoil, magazine and sighting minimums (maximum over the
 *    receiver and the items), weight, the provisional MOA model and Prevent Overswing (TED < 0).
 *
 * Numerics. Every binary64 leaf of the lookup and of the request is decoded to the exact rational value of its double (`exact.ts`); sums,
 * products, quotients and every comparison are exact. A cap is therefore compared with the true value of the statistic, never with a rounded
 * one, and the validator can never accept a build the reference rejects. MOA uses K = 1000000 / 29089 = 100 / 2.9089 exactly. Statistics are
 * published both as the nearest double and as an exact canonical rational string (`exact`).
 *
 * Production-only codes (the reference has no such input): `CLAIMED_SPEND_MISMATCH` and `CLAIMED_ACQUISITION_MISMATCH` when the build carries
 * a claimed spend or per-occurrence provenance that differs from the exact recomputation, and `INSTANCE_ID_NOT_PATH_DERIVED` when strict
 * instance ids are requested and a child id is not the path-derived `parent/slot:item`.
 *
 * Input errors are typed failures (`PhysicalModelError`), never verdicts: an unknown weapon, a malformed `owned_items`, a non-finite cap, level
 * or modifier, a malformed preset count or barter lot size, a slot mixing ammunition with parts.
 */

import { presetSupply } from '../presetSupply';
import type { GunLookupEntry, ItemLookup, ItemLookupEntry, ModLookupEntry, PresetInfo } from '../types';
import { legalOffers, resolveMarket, type MarketInput, type MarketSettings } from './acquisition';
import { ROOT_INSTANCE_ID } from './blueprint';
import { PhysicalModelError } from './errors';
import {
  RAT_ONE, RAT_ZERO, rat, ratAdd, ratDiv, ratFromDouble, ratGe, ratGt, ratLe, ratLt, ratMax, ratMin, ratMul, ratString, ratSub, ratSum,
  ratToNumber, type Rat,
} from './exact';
import { countOwnedItems } from './ownedItems';

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

/** The violation codes of the reference validator, verbatim. */
export const REFERENCE_VIOLATION_CODES = [
  'BASE_UNKNOWN_PRESET',
  'BASE_WRONG_WEAPON',
  'BASE_INACCESSIBLE',
  'DUPLICATE_INSTANCE_ID',
  'UNKNOWN_ITEM',
  'UNKNOWN_PARENT_INSTANCE',
  'UNROOTED_PLACEMENT',
  'UNKNOWN_SLOT',
  'ITEM_NOT_ALLOWED_IN_SLOT',
  'SLOT_CAPACITY_EXCEEDED',
  'ANCESTOR_TEMPLATE_REPETITION',
  'MISSING_REQUIRED_SLOT',
  'TEMPLATE_CONFLICT',
  'SELF_CONFLICT_COPY_CAP',
  'SLOT_CONFLICT',
  'EXCLUDED_ITEM',
  'EXCLUDED_CATEGORY',
  'MISSING_INCLUDE_ITEM',
  'MISSING_INCLUDE_CATEGORY_GROUP',
  'QUANTITY_CAP_EXCEEDED',
  'MAX_PRICE_EXCEEDED',
  'MIN_ERGONOMICS_NOT_MET',
  'MAX_RECOIL_V_EXCEEDED',
  'MAX_RECOIL_SUM_EXCEEDED',
  'MIN_MAGAZINE_NOT_MET',
  'MIN_SIGHTING_NOT_MET',
  'MAX_WEIGHT_EXCEEDED',
  'MAX_MOA_EXCEEDED',
  'OVERSWING_PREVENTED',
] as const;

/** Codes the reference does not have: they judge the producer's own claims and instance-id scheme, not the physical build. */
export const PRODUCTION_ONLY_VIOLATION_CODES = [
  'CLAIMED_SPEND_MISMATCH',
  'CLAIMED_ACQUISITION_MISMATCH',
  'INSTANCE_ID_NOT_PATH_DERIVED',
] as const;

export type PhysicalViolationCode = (typeof REFERENCE_VIOLATION_CODES)[number] | (typeof PRODUCTION_ONLY_VIOLATION_CODES)[number];

export interface PhysicalViolation {
  code: PhysicalViolationCode;
  detail: string;
}

/** One installed occurrence: a child instance attached to a physical slot `(parentInstanceId, slotId)` of its parent. */
export interface PhysicalPlacement {
  parentInstanceId: string;
  /** Template slot id on the parent. */
  slotId: string;
  childInstanceId: string;
  /** Template id of the installed item. */
  itemId: string;
}

export type PhysicalBuildBase = { kind: 'naked' } | { kind: 'preset'; presetId: string };

/** A claimed per-occurrence provenance (a decoder may claim one; the count-model decoder claims none and the validator recomputes it). */
export interface ClaimedAcquisition {
  instanceId: string;
  itemId: string;
  source: 'preset' | 'owned' | 'offer';
  presetId?: string | null;
  offerSource?: string | null;
  offerIndex?: number | null;
  /** RUB charged to this occurrence: the whole lot price on the first unit taken from a lot, 0 elsewhere. */
  price: number;
}

/** What a producer says about its own build; every field is optional and cross-checked against the exact recomputation. */
export interface PhysicalBuildClaims {
  spend?: number;
  basePrice?: number;
  /** How the base is supplied: bought (`offer`) or the player's own receiver (`owned`, only when no base can be bought). */
  baseSource?: 'offer' | 'owned';
  modSpend?: number;
  acquisition?: readonly ClaimedAcquisition[];
}

export interface PhysicalBuild {
  base: PhysicalBuildBase;
  placements: readonly PhysicalPlacement[];
  /** Instance id of the receiver; default {@link ROOT_INSTANCE_ID}. */
  rootInstanceId?: string;
  claimed?: PhysicalBuildClaims;
}

/**
 * The request fields the validator reads, under their `SolveParams` names (a `SolveParams` value is accepted as is). The objective fields
 * (`useTrueErgo`, weights, `idealPoint`) do not constrain a build and are not read.
 */
export interface PhysicalValidationRequest extends MarketInput {
  weaponId: string;
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  maxMOA?: number | null;
  includeItems?: readonly string[] | null;
  excludeItems?: readonly string[] | null;
  includeCategories?: readonly (readonly string[])[] | null;
  excludeCategories?: readonly string[] | null;
  useTrueErgo?: boolean;
  preventOverswing?: boolean;
  /** Equipment ergonomics modifier as a fraction (-0.15 for -15%); the gear factor is max(0, 1 + modifier). */
  equipErgoModifier?: number | null;
  /** Stash multiset (ADR 0008): element multiplicity is quantity. */
  ownedItems?: readonly string[] | null;
}

export interface ValidatePhysicalOptions {
  /** Ammunition classifier for an allowed id the lookup does not hold (as `PreparePhysicalOptions.isAmmo`); camora slots are outside the domain. */
  isAmmo?: (itemId: string) => boolean;
  /** Category chain of an item, own category first (INTERPRETATIONS.md choice 5). Default: the nested `data.bsgCategory` chain, else the own `category_id`. */
  categoryChainOf?: (itemId: string, entry: ItemLookupEntry) => readonly string[];
  /** Also demand path-derived child instance ids (`parent/slot:item`, ADR 0003): `INSTANCE_ID_NOT_PATH_DERIVED`. Default false: any unique ids are accepted, as in the reference. */
  requirePathInstanceIds?: boolean;
}

export type ExactStatName =
  | 'rawErgonomics' | 'ergonomics' | 'effectiveErgonomics'
  | 'recoilModifierSum' | 'recoilVertical' | 'recoilHorizontal'
  | 'weight' | 'weightPenalty' | 'ted' | 'overswingPercent'
  | 'accuracyModifierSum' | 'effectiveCenterOfImpact' | 'moa'
  | 'magazineCapacity' | 'sightingRange'
  | 'basePrice' | 'modSpend' | 'spend';

/** How one installed occurrence is supplied. `unavailable` is an excess over supply for an item with no legal offer (a cap violation, never priced). */
export interface OccurrenceAcquisitionRecord {
  instanceId: string;
  itemId: string;
  source: 'preset' | 'owned' | 'offer' | 'unavailable';
  presetId: string | null;
  offerSource: string | null;
  offerIndex: number | null;
  /** RUB charged to this occurrence: the whole lot price on the first unit taken from a lot, 0 elsewhere. */
  price: number;
}

export interface PurchasedLotRecord {
  offerIndex: number;
  source: string;
  lotSize: number;
  price: number;
  used: number;
}

export interface ItemPurchaseRecord {
  itemId: string;
  deficit: number;
  lots: PurchasedLotRecord[];
  cost: number;
}

export interface PhysicalAcquisition {
  /** One record per installed occurrence, in code-unit order of `instanceId`. */
  occurrences: OccurrenceAcquisitionRecord[];
  /** d_i = max(0, installed_i - preset_i - owned_i), for items with d_i > 0 (an item with no legal offer included). */
  deficits: ReadonlyMap<string, number>;
  /** Whole-lot purchases of items with a paid deficit and a legal offer, in item-id code-unit order. */
  purchases: ItemPurchaseRecord[];
  /** Units over supply of items with no legal standalone offer. */
  shortfalls: { itemId: string; count: number }[];
}

export interface PhysicalBuildStats {
  rawErgonomics: number;
  /** First clamp: the displayed ergonomics, which `minErgonomics` reads. */
  ergonomics: number;
  /** After the gear factor and the second clamp. */
  effectiveErgonomics: number;
  recoilModifierSum: number;
  /** naked vertical recoil x (1 + recoil modifier sum). */
  recoilVertical: number;
  recoilHorizontal: number;
  /** Receiver mass plus every installed mass, fractional mass kept. */
  weight: number;
  weightPenalty: number;
  /** TrueErgo delta: effective ergonomics minus the weight penalty. */
  ted: number;
  /** Overswing strength 0..100, nonzero exactly when TED < 0. */
  overswingPercent: number;
  accuracyModifierSum: number;
  effectiveCenterOfImpact: number;
  moa: number;
  magazineCapacity: number;
  sightingRange: number;
  /** The cheapest legal base lot, 0 for the owned receiver, or null when the base is inaccessible (the spend then counts 0 for it). */
  basePrice: number | null;
  /**
   * How the base is supplied: `offer` (bought at `basePrice`), `owned` (no legal offer of the receiver and none of any of its presets, so the
   * naked receiver is the player's own at price 0), or null when the base is inaccessible.
   */
  baseSource: 'offer' | 'owned' | null;
  modSpend: number;
  spend: number;
  /** The same statistics as exact canonical rational strings (`n` or `n/d`). */
  exact: Readonly<Record<ExactStatName, string>>;
  acquisition: PhysicalAcquisition;
}

export interface PhysicalValidation {
  ok: boolean;
  violations: PhysicalViolation[];
  /** Null when an installed item is unknown to the lookup: statistics need every item. */
  stats: PhysicalBuildStats | null;
}

export interface PhysicalValidator {
  validate(build: PhysicalBuild): PhysicalValidation;
}

/** Absolute RUB tolerance when a claimed spend is compared with the exact one (prices are whole roubles, so a real discrepancy is at least 1). */
export const CLAIM_TOLERANCE = 1e-6;

// ---------------------------------------------------------------------------------------------
// Constants of the model (ADR 0006, ADR 0007)
// ---------------------------------------------------------------------------------------------

/** K = 100 / 2.9089 = 1000000 / 29089 (ADR 0006 section 5). */
const MOA_K = rat(1000000n, 29089n);
const HUNDRED = rat(100n);
const CLAMP_MAX = HUNDRED;
const TED_FREE_WEIGHT = rat(3n);
const TED_PENALTY_NUMERATOR = rat(300n);
const OVERSWING_START = rat(3n);
const OVERSWING_FULL = rat(7n);
const CLAIM_TOLERANCE_RAT = ratFromDouble(CLAIM_TOLERANCE);

const clampErgonomics = (raw: Rat): Rat => ratMin(CLAMP_MAX, ratMax(RAT_ZERO, raw));
const weightPenaltyOf = (weight: Rat): Rat => (ratLe(weight, TED_FREE_WEIGHT) ? RAT_ZERO : ratSub(HUNDRED, ratDiv(TED_PENALTY_NUMERATOR, weight)));

function overswingPercentOf(effective: Rat, weight: Rat): Rat {
  const swing = ratMul(weight, ratSub(RAT_ONE, ratDiv(effective, HUNDRED)));
  const fraction = ratDiv(ratSub(swing, OVERSWING_START), ratSub(OVERSWING_FULL, OVERSWING_START));
  return ratMul(ratMin(RAT_ONE, ratMax(RAT_ZERO, fraction)), HUNDRED);
}

// ---------------------------------------------------------------------------------------------
// Lookup facts
// ---------------------------------------------------------------------------------------------

interface SlotView {
  readonly id: string;
  readonly required: boolean;
  readonly allowed: ReadonlySet<string>;
}

interface LotOffer {
  readonly index: number;
  readonly source: string;
  readonly price: Rat;
  readonly lotSize: number;
}

interface SlotOwnerFacts {
  readonly slots: readonly SlotView[];
  readonly slotById: ReadonlyMap<string, SlotView>;
}

interface ModFacts extends SlotOwnerFacts {
  readonly id: string;
  readonly conflictingItems: ReadonlySet<string>;
  readonly conflictingSlots: readonly string[];
  readonly categories: readonly string[];
  readonly weight: Rat;
  readonly ergonomics: Rat;
  readonly recoilModifier: Rat;
  readonly accuracyModifier: Rat;
  readonly centerOfImpact: Rat;
  readonly capacity: Rat;
  readonly sightingRange: Rat;
  /** Legal standalone offers in ascending offer-index order; none means the item is capped by supply. */
  readonly offers: readonly LotOffer[];
}

interface ReceiverFacts extends SlotOwnerFacts {
  readonly id: string;
  readonly conflictingItems: ReadonlySet<string>;
  readonly weight: Rat;
  readonly ergonomics: Rat;
  readonly recoilVertical: Rat;
  readonly recoilHorizontal: Rat;
  readonly centerOfImpact: Rat;
  readonly sightingRange: Rat;
  /** Production gun entries carry no magazine capacity: the receiver contributes 0 (INTERPRETATIONS.md choice 7). */
  readonly capacity: Rat;
  readonly baseOffers: readonly LotOffer[];
}

interface ResolvedRequest {
  readonly maxPrice: Rat | null;
  readonly minErgonomics: Rat | null;
  readonly maxRecoilV: Rat | null;
  readonly maxRecoilSum: Rat | null;
  readonly minMagCapacity: Rat | null;
  readonly minSightingRange: Rat | null;
  readonly maxWeight: Rat | null;
  readonly maxMoa: Rat | null;
  readonly preventOverswing: boolean;
  readonly gearFactor: Rat;
  readonly includeItems: readonly string[];
  readonly excludeItems: ReadonlySet<string>;
  readonly includeCategories: readonly (readonly string[])[];
  readonly excludeCategories: ReadonlySet<string>;
  readonly market: MarketSettings;
  readonly owned: ReadonlyMap<string, number>;
}

const hasEntry = (lookup: ItemLookup, id: string): boolean => Object.hasOwn(lookup, id);
const codeUnitCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
function categoryChainOfEntry(entry: ItemLookupEntry): string[] {
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

/** One flea gate per item (`min_level_flea`), carried by mods; receivers and presets carry none. */
const fleaGateOf = (stats: object): number => {
  const gate = (stats as { min_level_flea?: unknown }).min_level_flea;
  return typeof gate === 'number' ? gate : 0;
};

function capOf(name: string, value: number | null | undefined): Rat | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PhysicalModelError('INVALID_REQUEST', `${name} is not a finite number`, { field: name });
  return ratFromDouble(value);
}

function resolveRequest(request: PhysicalValidationRequest): ResolvedRequest {
  const equip = capOf('equipErgoModifier', request.equipErgoModifier) ?? RAT_ZERO;
  return {
    maxPrice: capOf('maxPrice', request.maxPrice),
    minErgonomics: capOf('minErgonomics', request.minErgonomics),
    maxRecoilV: capOf('maxRecoilV', request.maxRecoilV),
    maxRecoilSum: capOf('maxRecoilSum', request.maxRecoilSum),
    minMagCapacity: capOf('minMagCapacity', request.minMagCapacity),
    minSightingRange: capOf('minSightingRange', request.minSightingRange),
    maxWeight: capOf('maxWeight', request.maxWeight),
    maxMoa: capOf('maxMOA', request.maxMOA),
    preventOverswing: request.preventOverswing === true,
    gearFactor: ratMax(RAT_ZERO, ratAdd(RAT_ONE, equip)),
    includeItems: [...new Set(request.includeItems ?? [])],
    excludeItems: new Set(request.excludeItems ?? []),
    includeCategories: (request.includeCategories ?? []).map(group => [...group]),
    excludeCategories: new Set(request.excludeCategories ?? []),
    market: resolveMarket(request),
    owned: countOwnedItems(request.ownedItems),
  };
}

// ---------------------------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------------------------

interface Occurrence {
  instanceId: string;
  itemId: string;
  source: OccurrenceAcquisitionRecord['source'];
  presetId: string | null;
  offer: LotOffer | null;
  charged: Rat;
}

/** The cheapest way to buy at least `deficit` units from whole lots: exact DP over units, ties toward the earlier offer. */
function cheapestCover(offers: readonly LotOffer[], deficit: number): { cost: Rat; lots: LotOffer[] } {
  if (deficit === 0) return { cost: RAT_ZERO, lots: [] };
  const cost: Rat[] = [RAT_ZERO];
  const pick: number[] = [-1];
  for (let j = 1; j <= deficit; j++) {
    let best: Rat | null = null;
    let bestOffer = -1;
    for (let k = 0; k < offers.length; k++) {
      const candidate = ratAdd(offers[k].price, cost[Math.max(0, j - offers[k].lotSize)]);
      if (best === null || ratLt(candidate, best)) {
        best = candidate;
        bestOffer = k;
      }
    }
    cost.push(best as Rat);
    pick.push(bestOffer);
  }
  const lots: LotOffer[] = [];
  for (let j = deficit; j > 0;) {
    const offer = offers[pick[j]];
    lots.push(offer);
    j = Math.max(0, j - offer.lotSize);
  }
  lots.sort((a, b) => a.index - b.index);
  return { cost: cost[deficit], lots };
}

// ---------------------------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------------------------

const slotKey = (parentInstanceId: string, slotId: string): string => JSON.stringify([parentInstanceId, slotId]);

export function preparePhysicalValidator(lookup: ItemLookup, request: PhysicalValidationRequest, options: ValidatePhysicalOptions = {}): PhysicalValidator {
  const weaponId = request.weaponId;
  const weaponEntry = hasEntry(lookup, weaponId) ? lookup[weaponId] : undefined;
  if (!weaponEntry || weaponEntry.type !== 'gun') {
    throw new PhysicalModelError('UNKNOWN_WEAPON', `Weapon ${String(weaponId)} is not a gun entry of the item lookup`, { weaponId });
  }
  const gunEntry: GunLookupEntry = weaponEntry;
  const resolved = resolveRequest(request);
  const { market } = resolved;
  const categoryChainOf = options.categoryChainOf ?? ((_id: string, entry: ItemLookupEntry) => categoryChainOfEntry(entry));
  const isAmmo = options.isAmmo;

  const toLots = (offers: ReturnType<typeof legalOffers>): LotOffer[] =>
    offers.map(o => ({ index: o.index, source: o.source, price: ratFromDouble(o.price), lotSize: o.lotSize }));

  /** The physical slots of a template: ammunition-only slots are outside the domain, unknown allowed ids are dropped (as the blueprint does). */
  function slotViewsOf(ownerId: string, entry: ItemLookupEntry): SlotOwnerFacts {
    const slots: SlotView[] = [];
    const slotById = new Map<string, SlotView>();
    for (const info of entry.slots) {
      const parts = new Set<string>();
      let ammunition = 0;
      const flagged = info.ammoItems && info.ammoItems.length > 0 ? new Set(info.ammoItems) : null;
      for (const allowedId of info.allowedItems) {
        if (allowedId === weaponId) parts.add(allowedId);
        else if (hasEntry(lookup, allowedId)) {
          if (lookup[allowedId].type === 'mod') parts.add(allowedId);
        } else if (flagged?.has(allowedId) === true || isAmmo?.(allowedId) === true) ammunition++;
      }
      if (ammunition > 0) {
        if (parts.size > 0) {
          throw new PhysicalModelError('MIXED_AMMO_SLOT', `Slot ${info.id} of ${ownerId} mixes ammunition with parts`, { ownerTemplateId: ownerId, slotId: info.id });
        }
        continue;
      }
      const view: SlotView = { id: info.id, required: info.required === true, allowed: parts };
      slots.push(view);
      if (!slotById.has(info.id)) slotById.set(info.id, view);
    }
    return { slots, slotById };
  }

  const gunStats = gunEntry.stats;
  const receiver: ReceiverFacts = {
    id: weaponId,
    ...slotViewsOf(weaponId, gunEntry),
    conflictingItems: new Set(asIdList(gunEntry.data.conflictingItems)),
    weight: ratFromDouble(gunStats.weight || 0),
    ergonomics: ratFromDouble(gunStats.naked_ergonomics || 0),
    recoilVertical: ratFromDouble(gunStats.naked_recoil_v || 0),
    recoilHorizontal: ratFromDouble(gunStats.naked_recoil_h || 0),
    centerOfImpact: ratFromDouble(gunStats.center_of_impact || 0),
    sightingRange: ratFromDouble(gunStats.sighting_range || 0),
    capacity: RAT_ZERO,
    baseOffers: toLots(legalOffers(gunStats.offers, fleaGateOf(gunStats), market)),
  };

  const modCache = new Map<string, ModFacts | null>();
  /** The facts of an installable mod, or null when the id is not a mod entry of the lookup (the receiver and ammunition are not installable). */
  function modFacts(itemId: string): ModFacts | null {
    const cached = modCache.get(itemId);
    if (cached !== undefined) return cached;
    let facts: ModFacts | null = null;
    if (hasEntry(lookup, itemId)) {
      const entry = lookup[itemId];
      if (entry.type === 'mod') {
        const stats = (entry as ModLookupEntry).stats;
        facts = {
          id: itemId,
          ...slotViewsOf(itemId, entry),
          conflictingItems: new Set(entry.conflicting_items),
          conflictingSlots: entry.conflicting_slot_ids,
          categories: [...categoryChainOf(itemId, entry)],
          weight: ratFromDouble(stats.weight || 0),
          ergonomics: ratFromDouble(stats.ergonomics || 0),
          recoilModifier: ratFromDouble(stats.recoil_modifier || 0),
          accuracyModifier: ratFromDouble(stats.accuracy_modifier || 0),
          centerOfImpact: ratFromDouble(stats.center_of_impact || 0),
          capacity: ratFromDouble(stats.capacity || 0),
          sightingRange: ratFromDouble(stats.sighting_range || 0),
          offers: toLots(legalOffers(stats.offers, fleaGateOf(stats), market)),
        };
      }
    }
    modCache.set(itemId, facts);
    return facts;
  }

  /** Presets of the other receivers in the lookup, to tell a preset of another weapon from an unknown one (built on first use). */
  let otherPresets: Map<string, PresetInfo> | null = null;
  function locatePreset(presetId: string): { preset: PresetInfo; wrongWeapon: boolean } | null {
    const own = (gunEntry.all_presets ?? []).find(p => p.id === presetId);
    if (own) return { preset: own, wrongWeapon: own.receiver_id !== weaponId };
    if (otherPresets === null) {
      otherPresets = new Map();
      for (const entry of Object.values(lookup)) {
        if (entry.type !== 'gun' || entry === gunEntry) continue;
        for (const preset of entry.all_presets ?? []) if (!otherPresets.has(preset.id)) otherPresets.set(preset.id, preset);
      }
    }
    const other = otherPresets.get(presetId);
    return other ? { preset: other, wrongWeapon: true } : null;
  }

  const supplyCache = new Map<PresetInfo, Map<string, number>>();
  function supplyOf(preset: PresetInfo): Map<string, number> {
    const cached = supplyCache.get(preset);
    if (cached) return cached;
    for (const component of preset.items) {
      if (!Number.isSafeInteger(component.count) || component.count < 0) {
        throw new PhysicalModelError('BAD_PRESET', `Preset ${preset.id}: component ${component.itemId} has count ${String(component.count)}, not a nonnegative integer`, { presetId: preset.id });
      }
    }
    const supply = presetSupply(preset.items);
    supplyCache.set(preset, supply);
    return supply;
  }

  const cheapestOf = (offers: readonly LotOffer[]): Rat | null => {
    let best: Rat | null = null;
    for (const offer of offers) if (best === null || ratLt(offer.price, best)) best = offer.price;
    return best;
  };
  const presetBaseOffers = new Map<PresetInfo, readonly LotOffer[]>();
  const baseOffersOfPreset = (preset: PresetInfo): readonly LotOffer[] => {
    let offers = presetBaseOffers.get(preset);
    if (!offers) {
      offers = toLots(legalOffers(preset.offers, fleaGateOf(preset), market));
      presetBaseOffers.set(preset, offers);
    }
    return offers;
  };

  /**
   * The owned-receiver fallback (owner decision 2026-10-14): the receiver has no legal offer and no preset built on it has one, so nothing can
   * be bought and the player is taken to own the naked receiver. Computed once from the lookup and the market, never from the stash.
   */
  let receiverOwned: boolean | null = null;
  const nakedIsOwned = (): boolean => {
    if (receiverOwned === null) {
      receiverOwned = receiver.baseOffers.length === 0
        && !(gunEntry.all_presets ?? []).some(p => p.receiver_id === weaponId && baseOffersOfPreset(p).length > 0);
    }
    return receiverOwned;
  };

  const closeTo = (claimed: number | undefined, exact: Rat): boolean =>
    typeof claimed === 'number' && Number.isFinite(claimed)
    && ratLe(ratSub(ratFromDouble(claimed), exact), CLAIM_TOLERANCE_RAT) && ratLe(ratSub(exact, ratFromDouble(claimed)), CLAIM_TOLERANCE_RAT);

  function validate(build: PhysicalBuild): PhysicalValidation {
    const violations: PhysicalViolation[] = [];
    const push = (code: PhysicalViolationCode, detail: string): void => { violations.push({ code, detail }); };
    const rootId = build.rootInstanceId ?? ROOT_INSTANCE_ID;
    const placements = build.placements;

    // --- base -------------------------------------------------------------------------------------
    let basePrice: Rat | null = null;
    let baseSource: 'offer' | 'owned' | null = null;
    let supply: ReadonlyMap<string, number> = new Map();
    let basePresetId: string | null = null;
    if (build.base.kind === 'preset') {
      const found = locatePreset(build.base.presetId);
      if (!found) push('BASE_UNKNOWN_PRESET', build.base.presetId);
      else {
        basePresetId = found.preset.id;
        supply = supplyOf(found.preset);
        if (found.wrongWeapon) push('BASE_WRONG_WEAPON', `${found.preset.id} is built on ${found.preset.receiver_id}`);
        else {
          basePrice = cheapestOf(baseOffersOfPreset(found.preset));
          if (basePrice === null) push('BASE_INACCESSIBLE', `preset ${found.preset.id} has no legal offer`);
          else baseSource = 'offer';
        }
      }
    } else {
      basePrice = cheapestOf(receiver.baseOffers);
      if (basePrice !== null) baseSource = 'offer';
      else if (nakedIsOwned()) {
        basePrice = RAT_ZERO;
        baseSource = 'owned';
      } else push('BASE_INACCESSIBLE', `receiver ${weaponId} has no legal offer`);
    }

    // --- instances (the childInstanceId bijection) ---------------------------------------------------
    const byChild = new Map<string, PhysicalPlacement>();
    const templateOf = new Map<string, ModFacts>();
    let itemsKnown = true;
    for (const p of placements) {
      if (options.requirePathInstanceIds === true && p.childInstanceId !== `${p.parentInstanceId}/${p.slotId}:${p.itemId}`) {
        push('INSTANCE_ID_NOT_PATH_DERIVED', `${p.childInstanceId} is not ${p.parentInstanceId}/${p.slotId}:${p.itemId}`);
      }
      if (p.childInstanceId === rootId || byChild.has(p.childInstanceId)) push('DUPLICATE_INSTANCE_ID', p.childInstanceId);
      else byChild.set(p.childInstanceId, p);
      const facts = modFacts(p.itemId);
      if (!facts) {
        itemsKnown = false;
        push('UNKNOWN_ITEM', `${p.childInstanceId}: ${p.itemId}`);
      } else if (!templateOf.has(p.childInstanceId)) {
        templateOf.set(p.childInstanceId, facts);
      }
    }

    // --- rootedness ---------------------------------------------------------------------------------
    const children = new Map<string, PhysicalPlacement[]>();
    for (const p of placements) {
      const list = children.get(p.parentInstanceId);
      if (list) list.push(p);
      else children.set(p.parentInstanceId, [p]);
    }
    const rooted = new Set<string>();
    const queue: string[] = [rootId];
    for (let i = 0; i < queue.length; i++) {
      for (const child of children.get(queue[i]) ?? []) {
        if (!rooted.has(child.childInstanceId) && child.childInstanceId !== rootId) {
          rooted.add(child.childInstanceId);
          queue.push(child.childInstanceId);
        }
      }
    }
    const parentKnown = (p: PhysicalPlacement): boolean => p.parentInstanceId === rootId || byChild.has(p.parentInstanceId);
    for (const p of placements) {
      if (!parentKnown(p)) push('UNKNOWN_PARENT_INSTANCE', `${p.childInstanceId}: parent ${p.parentInstanceId}`);
      else if (!rooted.has(p.childInstanceId)) push('UNROOTED_PLACEMENT', p.childInstanceId);
    }

    // --- slot legality, capacity and ancestor repetition ----------------------------------------------
    const slotsOf = (instanceId: string): SlotOwnerFacts | null => (instanceId === rootId ? receiver : templateOf.get(instanceId) ?? null);
    const occupancy = new Map<string, number>();
    for (const p of placements) {
      const key = slotKey(p.parentInstanceId, p.slotId);
      occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    }
    for (const [key, count] of occupancy) if (count > 1) push('SLOT_CAPACITY_EXCEEDED', `${key} holds ${count} children`);
    for (const p of placements) {
      const owner = parentKnown(p) ? slotsOf(p.parentInstanceId) : null;
      if (owner) {
        const view = owner.slotById.get(p.slotId);
        if (!view) push('UNKNOWN_SLOT', `${p.childInstanceId}: ${p.parentInstanceId} has no slot ${p.slotId}`);
        else if (!view.allowed.has(p.itemId)) push('ITEM_NOT_ALLOWED_IN_SLOT', `${p.childInstanceId}: ${p.itemId} in ${p.slotId}`);
      }
      if (rooted.has(p.childInstanceId)) {
        if (p.itemId === weaponId) push('ANCESTOR_TEMPLATE_REPETITION', `${p.childInstanceId}: repeats the receiver`);
        const seen = new Set<string>([p.childInstanceId]);
        for (let cur = byChild.get(p.parentInstanceId); cur && !seen.has(cur.childInstanceId); cur = byChild.get(cur.parentInstanceId)) {
          seen.add(cur.childInstanceId);
          if (cur.itemId === p.itemId) {
            push('ANCESTOR_TEMPLATE_REPETITION', `${p.childInstanceId}: ${p.itemId} repeats ancestor ${cur.childInstanceId}`);
            break;
          }
        }
      }
    }

    // --- required occupancy -----------------------------------------------------------------------
    for (const view of receiver.slots) {
      if (view.required && !occupancy.has(slotKey(rootId, view.id))) push('MISSING_REQUIRED_SLOT', `${rootId}/${view.id}`);
    }
    for (const p of placements) {
      const facts = templateOf.get(p.childInstanceId);
      if (!facts || !rooted.has(p.childInstanceId)) continue;
      for (const view of facts.slots) {
        if (view.required && !occupancy.has(slotKey(p.childInstanceId, view.id))) push('MISSING_REQUIRED_SLOT', `${p.childInstanceId}/${view.id}`);
      }
    }

    // --- conflicts --------------------------------------------------------------------------------
    const copies = new Map<string, number>();
    for (const p of placements) copies.set(p.itemId, (copies.get(p.itemId) ?? 0) + 1);
    const present = new Set<string>([weaponId, ...copies.keys()]);
    const reportedPairs = new Set<string>();
    const checkTemplateConflicts = (ownerId: string, conflicts: ReadonlySet<string>): void => {
      for (const other of conflicts) {
        if (other === ownerId) {
          if ((copies.get(ownerId) ?? 0) > 1) push('SELF_CONFLICT_COPY_CAP', `${ownerId} x${copies.get(ownerId)}`);
        } else if (present.has(other)) {
          const pair = [ownerId, other].sort().join('|');
          if (!reportedPairs.has(pair)) {
            reportedPairs.add(pair);
            push('TEMPLATE_CONFLICT', `${ownerId}/${other}`);
          }
        }
      }
    };
    checkTemplateConflicts(weaponId, receiver.conflictingItems);
    for (const itemId of copies.keys()) {
      const facts = modFacts(itemId);
      if (facts) checkTemplateConflicts(itemId, facts.conflictingItems);
    }
    // A blocker blocks every occupied physical slot with a listed template slot id, its own host slot included (choice 11); against a required
    // slot this bans the blocker outright (choice 14).
    const byTemplateSlot = new Map<string, PhysicalPlacement[]>();
    for (const p of placements) {
      const list = byTemplateSlot.get(p.slotId);
      if (list) list.push(p);
      else byTemplateSlot.set(p.slotId, [p]);
    }
    for (const p of placements) {
      const facts = templateOf.get(p.childInstanceId);
      if (!facts) continue;
      for (const blocked of facts.conflictingSlots) {
        for (const other of byTemplateSlot.get(blocked) ?? []) {
          push('SLOT_CONFLICT', `${p.childInstanceId} blocks slot ${blocked} occupied by ${other.childInstanceId}`);
        }
      }
    }

    // --- includes and excludes ----------------------------------------------------------------------
    for (const p of placements) {
      const facts = templateOf.get(p.childInstanceId);
      if (resolved.excludeItems.has(p.itemId)) push('EXCLUDED_ITEM', `${p.childInstanceId}: ${p.itemId}`);
      if (facts) {
        for (const category of resolved.excludeCategories) {
          if (facts.categories.includes(category)) push('EXCLUDED_CATEGORY', `${p.childInstanceId}: ${p.itemId} in ${category}`);
        }
      }
    }
    for (const id of resolved.includeItems) if (!copies.has(id)) push('MISSING_INCLUDE_ITEM', id);
    resolved.includeCategories.forEach((group, index) => {
      const satisfied = [...templateOf.values()].some(facts => group.some(category => facts.categories.includes(category)));
      if (!satisfied) push('MISSING_INCLUDE_CATEGORY_GROUP', `group ${index}: [${group.join(',')}]`);
    });

    // --- acquisition: preset supply, then owned stock, then the paid remainder in whole lots ------------------
    const ordered = [...placements].sort((a, b) => codeUnitCompare(a.childInstanceId, b.childInstanceId));
    const remainingPreset = new Map<string, number>();
    const remainingOwned = new Map<string, number>();
    const deficits = new Map<string, number>();
    const unavailable = new Map<string, number>();
    const paid = new Map<string, Occurrence[]>();
    const occurrences: Occurrence[] = [];
    for (const p of ordered) {
      const id = p.itemId;
      if (!remainingPreset.has(id)) {
        remainingPreset.set(id, supply.get(id) ?? 0);
        remainingOwned.set(id, resolved.owned.get(id) ?? 0);
      }
      const occurrence: Occurrence = { instanceId: p.childInstanceId, itemId: id, source: 'unavailable', presetId: null, offer: null, charged: RAT_ZERO };
      const fromPreset = remainingPreset.get(id) as number;
      const fromOwned = remainingOwned.get(id) as number;
      if (fromPreset > 0) {
        remainingPreset.set(id, fromPreset - 1);
        occurrence.source = 'preset';
        occurrence.presetId = basePresetId;
      } else if (fromOwned > 0) {
        remainingOwned.set(id, fromOwned - 1);
        occurrence.source = 'owned';
      } else {
        deficits.set(id, (deficits.get(id) ?? 0) + 1);
        if ((modFacts(id)?.offers.length ?? 0) > 0) {
          const list = paid.get(id);
          if (list) list.push(occurrence);
          else paid.set(id, [occurrence]);
        } else {
          unavailable.set(id, (unavailable.get(id) ?? 0) + 1);
        }
      }
      occurrences.push(occurrence);
    }
    const purchases: { itemId: string; deficit: number; lots: { offer: LotOffer; used: number }[]; cost: Rat }[] = [];
    let modSpend = RAT_ZERO;
    for (const itemId of [...paid.keys()].sort(codeUnitCompare)) {
      const takers = paid.get(itemId) as Occurrence[];
      const cover = cheapestCover((modFacts(itemId) as ModFacts).offers, takers.length);
      const lots: { offer: LotOffer; used: number }[] = [];
      let next = 0;
      for (const lot of cover.lots) {
        const taken = takers.slice(next, next + lot.lotSize);
        next += taken.length;
        taken.forEach((occurrence, k) => {
          occurrence.source = 'offer';
          occurrence.offer = lot;
          occurrence.charged = k === 0 ? lot.price : RAT_ZERO;
        });
        lots.push({ offer: lot, used: taken.length });
      }
      purchases.push({ itemId, deficit: takers.length, lots, cost: cover.cost });
      modSpend = ratAdd(modSpend, cover.cost);
    }
    const shortfalls = [...unavailable.entries()].sort((a, b) => codeUnitCompare(a[0], b[0])).map(([itemId, count]) => ({ itemId, count }));
    for (const shortfall of shortfalls) {
      push('QUANTITY_CAP_EXCEEDED', `${shortfall.itemId}: ${shortfall.count} unit(s) above preset + owned supply and no legal offer`);
    }
    const spend = ratAdd(basePrice ?? RAT_ZERO, modSpend);

    // --- the producer's own claims -----------------------------------------------------------------------
    const claims = build.claimed;
    if (claims) {
      if (claims.spend !== undefined && !closeTo(claims.spend, spend)) push('CLAIMED_SPEND_MISMATCH', `claimed spend ${String(claims.spend)}, exact ${ratString(spend)}`);
      if (claims.basePrice !== undefined && !closeTo(claims.basePrice, basePrice ?? RAT_ZERO)) {
        push('CLAIMED_SPEND_MISMATCH', `claimed base price ${String(claims.basePrice)}, exact ${ratString(basePrice ?? RAT_ZERO)}`);
      }
      if (claims.baseSource !== undefined && claims.baseSource !== baseSource) {
        push('CLAIMED_ACQUISITION_MISMATCH', `claimed base source ${claims.baseSource}, exact ${String(baseSource)}`);
      }
      if (claims.modSpend !== undefined && !closeTo(claims.modSpend, modSpend)) push('CLAIMED_SPEND_MISMATCH', `claimed mod spend ${String(claims.modSpend)}, exact ${ratString(modSpend)}`);
      if (claims.acquisition !== undefined) {
        const claimed = [...claims.acquisition].sort((a, b) => codeUnitCompare(a.instanceId, b.instanceId));
        if (claimed.length !== occurrences.length) {
          push('CLAIMED_ACQUISITION_MISMATCH', `${claimed.length} provenance record(s) claimed for ${occurrences.length} installed occurrence(s)`);
        } else {
          occurrences.forEach((actual, k) => {
            const record = claimed[k];
            const mismatch = (what: string): void => push('CLAIMED_ACQUISITION_MISMATCH', `${actual.instanceId}: ${what}`);
            if (record.instanceId !== actual.instanceId || record.itemId !== actual.itemId) mismatch(`claimed ${record.instanceId} (${record.itemId})`);
            else if (record.source !== actual.source) mismatch(`claimed source ${record.source}, exact ${actual.source}`);
            else if (actual.source === 'preset' && (record.presetId ?? null) !== actual.presetId) mismatch(`claimed preset ${String(record.presetId)}, exact ${String(actual.presetId)}`);
            else if (actual.source === 'offer' && actual.offer && (record.offerIndex ?? null) !== actual.offer.index) mismatch(`claimed offer ${String(record.offerIndex)}, exact ${actual.offer.index}`);
            else if (actual.source === 'offer' && actual.offer && (record.offerSource ?? null) !== actual.offer.source) mismatch(`claimed offer source ${String(record.offerSource)}, exact ${actual.offer.source}`);
            else if (!closeTo(record.price, actual.charged)) mismatch(`claimed charge ${String(record.price)}, exact ${ratString(actual.charged)}`);
          });
        }
      }
    }

    // --- statistics and hard caps ---------------------------------------------------------------------------
    let stats: PhysicalBuildStats | null = null;
    if (itemsKnown) {
      const installed = placements.map(p => modFacts(p.itemId) as ModFacts);
      const rawErgonomics = ratAdd(receiver.ergonomics, ratSum(installed.map(i => i.ergonomics)));
      const ergonomics = clampErgonomics(rawErgonomics);
      const effective = clampErgonomics(ratMul(ergonomics, resolved.gearFactor));
      const recoilModifierSum = ratSum(installed.map(i => i.recoilModifier));
      const recoilFactor = ratAdd(RAT_ONE, recoilModifierSum);
      const recoilVertical = ratMul(receiver.recoilVertical, recoilFactor);
      const recoilHorizontal = ratMul(receiver.recoilHorizontal, recoilFactor);
      const weight = ratAdd(receiver.weight, ratSum(installed.map(i => i.weight)));
      const weightPenalty = weightPenaltyOf(weight);
      const ted = ratSub(effective, weightPenalty);
      const overswingPercent = overswingPercentOf(effective, weight);
      const accuracyModifierSum = ratSum(installed.map(i => i.accuracyModifier));
      // An installed item with a positive COI replaces the intrinsic value; with several the largest applies (choice 4).
      let coi = receiver.centerOfImpact;
      let overrides: Rat | null = null;
      for (const item of installed) if (ratGt(item.centerOfImpact, RAT_ZERO) && (overrides === null || ratGt(item.centerOfImpact, overrides))) overrides = item.centerOfImpact;
      if (overrides !== null) coi = overrides;
      const moa = ratMul(ratMul(coi, ratSub(RAT_ONE, ratDiv(accuracyModifierSum, HUNDRED))), MOA_K);
      const magazineCapacity = installed.reduce((m, i) => ratMax(m, i.capacity), receiver.capacity);
      const sightingRange = installed.reduce((m, i) => ratMax(m, i.sightingRange), receiver.sightingRange);

      if (resolved.maxPrice !== null && !ratLe(spend, resolved.maxPrice)) push('MAX_PRICE_EXCEEDED', `${ratString(spend)} > ${ratString(resolved.maxPrice)}`);
      // min_ergonomics reads the displayed first-clamp ergonomics, before the gear factor (choice 8).
      if (resolved.minErgonomics !== null && !ratGe(ergonomics, resolved.minErgonomics)) push('MIN_ERGONOMICS_NOT_MET', `${ratString(ergonomics)} < ${ratString(resolved.minErgonomics)}`);
      if (resolved.maxRecoilV !== null && !ratLe(recoilVertical, resolved.maxRecoilV)) push('MAX_RECOIL_V_EXCEEDED', `${ratString(recoilVertical)} > ${ratString(resolved.maxRecoilV)}`);
      if (resolved.maxRecoilSum !== null) {
        const total = ratAdd(recoilVertical, recoilHorizontal);
        if (!ratLe(total, resolved.maxRecoilSum)) push('MAX_RECOIL_SUM_EXCEEDED', `${ratString(total)} > ${ratString(resolved.maxRecoilSum)}`);
      }
      if (resolved.minMagCapacity !== null && !ratGe(magazineCapacity, resolved.minMagCapacity)) push('MIN_MAGAZINE_NOT_MET', `${ratString(magazineCapacity)} < ${ratString(resolved.minMagCapacity)}`);
      if (resolved.minSightingRange !== null && !ratGe(sightingRange, resolved.minSightingRange)) push('MIN_SIGHTING_NOT_MET', `${ratString(sightingRange)} < ${ratString(resolved.minSightingRange)}`);
      if (resolved.maxWeight !== null && !ratLe(weight, resolved.maxWeight)) push('MAX_WEIGHT_EXCEEDED', `${ratString(weight)} > ${ratString(resolved.maxWeight)}`);
      if (resolved.maxMoa !== null && !ratLe(moa, resolved.maxMoa)) push('MAX_MOA_EXCEEDED', `${ratString(moa)} > ${ratString(resolved.maxMoa)}`);
      if (resolved.preventOverswing && ratLt(ted, RAT_ZERO)) push('OVERSWING_PREVENTED', `TED ${ratString(ted)} < 0`);

      const exactValues: Record<ExactStatName, Rat> = {
        rawErgonomics, ergonomics, effectiveErgonomics: effective, recoilModifierSum, recoilVertical, recoilHorizontal, weight, weightPenalty, ted, overswingPercent,
        accuracyModifierSum, effectiveCenterOfImpact: coi, moa, magazineCapacity, sightingRange, basePrice: basePrice ?? RAT_ZERO, modSpend, spend,
      };
      const exact = Object.fromEntries(Object.entries(exactValues).map(([name, value]) => [name, ratString(value)])) as Record<ExactStatName, string>;
      const num = (name: ExactStatName): number => ratToNumber(exactValues[name]);
      stats = {
        rawErgonomics: num('rawErgonomics'),
        ergonomics: num('ergonomics'),
        effectiveErgonomics: num('effectiveErgonomics'),
        recoilModifierSum: num('recoilModifierSum'),
        recoilVertical: num('recoilVertical'),
        recoilHorizontal: num('recoilHorizontal'),
        weight: num('weight'),
        weightPenalty: num('weightPenalty'),
        ted: num('ted'),
        overswingPercent: num('overswingPercent'),
        accuracyModifierSum: num('accuracyModifierSum'),
        effectiveCenterOfImpact: num('effectiveCenterOfImpact'),
        moa: num('moa'),
        magazineCapacity: num('magazineCapacity'),
        sightingRange: num('sightingRange'),
        basePrice: basePrice === null ? null : ratToNumber(basePrice),
        baseSource,
        modSpend: num('modSpend'),
        spend: num('spend'),
        exact,
        acquisition: {
          occurrences: occurrences.map(o => ({
            instanceId: o.instanceId,
            itemId: o.itemId,
            source: o.source,
            presetId: o.presetId,
            offerSource: o.offer?.source ?? null,
            offerIndex: o.offer?.index ?? null,
            price: ratToNumber(o.charged),
          })),
          deficits,
          purchases: purchases.map(purchase => ({
            itemId: purchase.itemId,
            deficit: purchase.deficit,
            lots: purchase.lots.map(l => ({ offerIndex: l.offer.index, source: l.offer.source, lotSize: l.offer.lotSize, price: ratToNumber(l.offer.price), used: l.used })),
            cost: ratToNumber(purchase.cost),
          })),
          shortfalls,
        },
      };
    }
    return { ok: violations.length === 0, violations, stats };
  }

  return { validate };
}

/** Validate one build. For many builds against one request, `preparePhysicalValidator` resolves the request and the lookup facts once. */
export function validatePhysicalBuild(
  lookup: ItemLookup,
  request: PhysicalValidationRequest,
  build: PhysicalBuild,
  options: ValidatePhysicalOptions = {},
): PhysicalValidation {
  return preparePhysicalValidator(lookup, request, options).validate(build);
}
