// Acquisition and spend model (ADR 0002 sections 2-8, ADR 0008 section 5, ADR 0009 section 3).
//
//   d_i   = max(0, installed_i - preset_i - owned_i)           authoritative paid deficit
//   spend = cheapest legal base lot + sum_i cover_i(d_i)        (exact Q)
//
// Offers are LOTS (interpretation 1, INTERPRETATIONS.md). A trader or flea offer is a lot of one unit at its
// stored price; a barter delivers `offeredCount` units for its rounded barter total. A lot is bought whole:
// one unit out of a lot of n costs the whole lot, and units beyond the deficit are simply unused. The cost
// of a paid deficit d_i is the exact minimum, over nonnegative integer lot counts across ALL legal offers of
// the item, of sum(lots x lotPrice) subject to sum(lots x units) >= d_i (`cheapestCover`, a DP over units).
// The base is exactly one unit, so it costs the cheapest lot.
//
// Allocation per occurrence runs in code-unit instanceId order: selected-preset supply q_{b,i}
// first, owned stock second, paid remainder last. The paid occurrences of an item, still in instanceId
// order, take the units of its chosen lots in offer-list order (see `acquire`). Items with no legal
// standalone offer are capped by preset supply plus owned stock; an excess is reported as a shortfall,
// never priced. A stored price <= 0 is not an offer (interpretation 2). Owned stock never grants a receiver or a base.

import type { BaseChoice, ReferenceBuild } from './build';
import { TRADER_DISABLED } from './constants';
import { codeUnitCompare } from './order';
import { traderLevelOf, type ResolvedFixture, type ResolvedOffer, type ResolvedRequest } from './resolve';
import { add, gt, lt, mul, roundHalfUp, sum, ZERO, type Q } from './q';

/** One legal offer, viewed as a lot: `offeredCount` units for `lotPrice`, bought whole. */
export interface LegalOffer {
  /** Index of the offer in its subject's offer list. */
  index: number;
  kind: 'trader' | 'flea' | 'barter';
  trader: string | null;
  /** Required loyalty level (trader/barter) or null (flea). */
  level: number | null;
  /** RUB for one whole lot: the stored price, or the rounded barter total. */
  lotPrice: Q;
  /** Units delivered per lot (1 except for barters that say otherwise). There is no per-unit price. */
  offeredCount: number;
  requiresDogtag: boolean;
}

/**
 * Unrounded barter ingredient total: sum count x (avg24hPrice ?? basePrice ?? 0), exact in Q.
 * Counts may be fractional; resolve.ts decodes each leaf with fromBinary64, so no float multiplication occurs here.
 */
export function barterRequirementTotal(offer: Extract<ResolvedOffer, { kind: 'barter' }>): Q {
  return sum(offer.requirements.map(r => mul(r.count, r.avg24hPrice ?? r.basePrice ?? ZERO)));
}

/** Interpretation 10: a trader at level <= 0 is disabled; otherwise its unlocked level must reach the offer's level. */
function traderLegal(request: ResolvedRequest, trader: string, level: number): boolean {
  const unlocked = traderLevelOf(request, trader);
  return unlocked > TRADER_DISABLED && unlocked >= level;
}

function toLegal(offer: ResolvedOffer, lotPrice: Q): LegalOffer {
  return {
    index: offer.index,
    kind: offer.kind,
    trader: offer.kind === 'flea' ? null : offer.trader,
    level: offer.kind === 'flea' ? null : offer.level,
    lotPrice,
    offeredCount: offer.kind === 'barter' ? offer.offeredCount : 1,
    requiresDogtag: offer.kind === 'barter' && offer.requiresDogtag,
  };
}

/** The offers of one subject that the request may actually use, in offer-list order. */
export function legalOffers(offers: readonly ResolvedOffer[], request: ResolvedRequest): LegalOffer[] {
  const out: LegalOffer[] = [];
  for (const offer of offers) {
    if (offer.kind === 'trader') {
      if (gt(offer.price, ZERO) && traderLegal(request, offer.trader, offer.level)) out.push(toLegal(offer, offer.price));
    } else if (offer.kind === 'flea') {
      const levelOk = request.playerLevel === null || request.playerLevel >= offer.minPlayerLevel;
      if (gt(offer.price, ZERO) && request.fleaAvailable && levelOk) out.push(toLegal(offer, offer.price));
    } else {
      if (!request.barterAvailable) continue;
      if (request.barterExcludeDogtags && offer.requiresDogtag) continue;
      if (!traderLegal(request, offer.trader, offer.level)) continue;
      const total = barterRequirementTotal(offer);
      if (!gt(total, ZERO)) continue; // a zero or negative total is not an offer
      out.push(toLegal(offer, roundHalfUp(total)));
    }
  }
  return out;
}

/**
 * Cheapest legal lot for exactly ONE unit: every lot delivers at least one unit, so this is the lowest lot price
 * (a lot of 3 at 300 does not undercut cash at 200 just because 300 / 3 is smaller). Ties keep the earliest
 * offer in list order. Used for the base, which is bought once.
 */
export function cheapestLegalOffer(offers: readonly ResolvedOffer[], request: ResolvedRequest): LegalOffer | null {
  let best: LegalOffer | null = null;
  for (const offer of legalOffers(offers, request)) {
    if (best === null || lt(offer.lotPrice, best.lotPrice)) best = offer;
  }
  return best;
}

/** Legal standalone offers of an installable item, in offer-list order; empty means the item is cap-limited. */
export function standaloneOffers(fixture: ResolvedFixture, request: ResolvedRequest, itemId: string): LegalOffer[] {
  const item = fixture.items.get(itemId);
  return item ? legalOffers(item.offers, request) : [];
}

/** The cheapest way to buy at least `deficit` units: the lots to buy and their exact total price. */
export interface LotCover {
  cost: Q;
  /**
   * The lots to buy, one entry per lot (a repeated offer appears repeatedly), ordered by offer index and hence
   * adjacent for repeats. Every lot supplies at least one needed unit, except a free lot that an equally cheap
   * cover could also omit.
   */
  lots: LegalOffer[];
}

/**
 * Exact minimum cost of covering `deficit` units from whole lots of the given legal offers: the minimum of
 * sum(lots x lotPrice) over nonnegative integer lot counts with sum(lots x offeredCount) >= deficit; surplus
 * units are unused. Solved exactly by a DP over units: cost[j] = min over offers o of
 * lotPrice_o + cost[max(0, j - offeredCount_o)], with cost[0] = 0. Returns null when no offer exists (a
 * positive deficit is uncoverable) and an empty cover for a deficit of 0.
 *
 * Determinism: `offers` must be in offer-list order. At every DP state the earliest offer in that order that
 * attains the minimum is kept (a strict `<`), so an exact cost tie between lot mixes is resolved toward earlier
 * listed offers; the chosen lots are then returned sorted by offer index.
 */
export function cheapestCover(offers: readonly LegalOffer[], deficit: number): LotCover | null {
  if (!Number.isSafeInteger(deficit) || deficit < 0) throw new RangeError(`deficit must be a nonnegative integer, got ${deficit}`);
  if (deficit === 0) return { cost: ZERO, lots: [] };
  if (offers.length === 0) return null;
  const cost: Q[] = [ZERO];
  const pick: number[] = [-1];
  for (let j = 1; j <= deficit; j++) {
    let best: Q | null = null;
    let bestOffer = -1;
    for (let k = 0; k < offers.length; k++) {
      const candidate = add(offers[k].lotPrice, cost[Math.max(0, j - offers[k].offeredCount)]);
      if (best === null || lt(candidate, best)) {
        best = candidate;
        bestOffer = k;
      }
    }
    cost.push(best as Q);
    pick.push(bestOffer);
  }
  const lots: LegalOffer[] = [];
  for (let j = deficit; j > 0;) {
    const offer = offers[pick[j]];
    lots.push(offer);
    j = Math.max(0, j - offer.offeredCount);
  }
  lots.sort((a, b) => a.index - b.index);
  return { cost: cost[deficit], lots };
}

/** Cheapest legal lot for the base subject (naked receiver or preset), or null when inaccessible. */
export function baseOffer(fixture: ResolvedFixture, request: ResolvedRequest, base: BaseChoice): LegalOffer | null {
  if (base.kind === 'naked') {
    const weapon = fixture.weapons.get(request.weaponId);
    return weapon ? cheapestLegalOffer(weapon.offers, request) : null;
  }
  const preset = fixture.presets.get(base.presetId);
  if (!preset || preset.weaponId !== request.weaponId) return null;
  return cheapestLegalOffer(preset.offers, request);
}

/** Every accessible base: the naked receiver first (if legally offered), then presets by id. */
export function accessibleBases(fixture: ResolvedFixture, request: ResolvedRequest): BaseChoice[] {
  const bases: BaseChoice[] = [];
  if (baseOffer(fixture, request, { kind: 'naked' })) bases.push({ kind: 'naked' });
  const presetIds = [...fixture.presets.values()]
    .filter(p => p.weaponId === request.weaponId)
    .map(p => p.id)
    .sort(codeUnitCompare);
  for (const presetId of presetIds) {
    if (baseOffer(fixture, request, { kind: 'preset', presetId })) bases.push({ kind: 'preset', presetId });
  }
  return bases;
}

/** q_{b,i}: units of an item supplied by the selected base (0 for the naked receiver). */
export function presetSupplyOf(fixture: ResolvedFixture, base: BaseChoice, itemId: string): number {
  if (base.kind === 'naked') return 0;
  return fixture.presets.get(base.presetId)?.supply.get(itemId) ?? 0;
}

export type OccurrenceSource =
  | { kind: 'preset'; presetId: string }
  | { kind: 'owned' }
  | { kind: 'offer'; offer: LegalOffer }
  /** Excess over supply for an item with no legal standalone offer. A cap violation, not a price. */
  | { kind: 'unavailable' };

export interface OccurrenceAcquisition {
  instanceId: string;
  itemId: string;
  source: OccurrenceSource;
  /**
   * RUB charged to this occurrence. Lots are bought whole, so the full lot price is charged to the FIRST occurrence
   * taken from a lot and 0 to the other units riding on the same lot; preset, owned and unavailable units are 0. The
   * charges of all occurrences therefore add up exactly to `modSpend`.
   */
  charged: Q;
}

/** One lot of a purchase: the offer and how many of its units installed occurrences take (the rest is surplus). */
export interface PurchasedLot {
  offer: LegalOffer;
  used: number;
}

/** What the player buys for one item: the cheapest whole-lot cover of its paid deficit. */
export interface ItemPurchase {
  itemId: string;
  /** Paid units d_i (> 0). */
  deficit: number;
  /** Lots in offer-index order; the paid occurrences, in instanceId order, fill lot 1, then lot 2, and so on. */
  lots: PurchasedLot[];
  /** Sum of the lot prices: the exact cover cost. */
  cost: Q;
}

export interface AcquisitionResult {
  /** The base is one unit: its price is the cheapest legal lot price. */
  base: { choice: BaseChoice; offer: LegalOffer | null; price: Q | null };
  /** One record per installed occurrence, in instanceId code-unit order. */
  occurrences: OccurrenceAcquisition[];
  /** Authoritative d_i for items with d_i > 0, whether or not an offer exists. */
  deficits: Map<string, number>;
  /** Whole-lot purchases of the items that have a paid deficit and a legal offer, in item code-unit order. */
  purchases: ItemPurchase[];
  /** Units that exceed supply for items with no legal standalone offer. */
  shortfalls: { itemId: string; count: number }[];
  /** Sum of the purchase costs. */
  modSpend: Q;
  /** Base price (0 when the base is inaccessible) plus modSpend. */
  spend: Q;
}

export function acquire(fixture: ResolvedFixture, request: ResolvedRequest, build: ReferenceBuild): AcquisitionResult {
  const offer = baseOffer(fixture, request, build.base);
  const basePrice = offer ? offer.lotPrice : null;
  const ordered = [...build.placements].sort((a, b) => codeUnitCompare(a.childInstanceId, b.childInstanceId));
  const remainingPreset = new Map<string, number>();
  const remainingOwned = new Map<string, number>();
  const standalone = new Map<string, LegalOffer[]>();
  const deficits = new Map<string, number>();
  const unavailable = new Map<string, number>();
  /** Per item: the paid occurrences (those past preset and owned supply), in instanceId order. */
  const paid = new Map<string, OccurrenceAcquisition[]>();
  const occurrences: OccurrenceAcquisition[] = [];
  for (const placement of ordered) {
    const id = placement.itemId;
    if (!remainingPreset.has(id)) {
      remainingPreset.set(id, presetSupplyOf(fixture, build.base, id));
      remainingOwned.set(id, request.owned.get(id) ?? 0);
      standalone.set(id, standaloneOffers(fixture, request, id));
    }
    const fromPreset = remainingPreset.get(id)!;
    const fromOwned = remainingOwned.get(id)!;
    const occurrence: OccurrenceAcquisition = { instanceId: placement.childInstanceId, itemId: id, source: { kind: 'unavailable' }, charged: ZERO };
    if (fromPreset > 0) {
      remainingPreset.set(id, fromPreset - 1);
      occurrence.source = { kind: 'preset', presetId: build.base.kind === 'preset' ? build.base.presetId : '' };
    } else if (fromOwned > 0) {
      remainingOwned.set(id, fromOwned - 1);
      occurrence.source = { kind: 'owned' };
    } else {
      deficits.set(id, (deficits.get(id) ?? 0) + 1);
      if (standalone.get(id)!.length > 0) {
        const list = paid.get(id);
        if (list) list.push(occurrence);
        else paid.set(id, [occurrence]);
      } else {
        unavailable.set(id, (unavailable.get(id) ?? 0) + 1);
      }
    }
    occurrences.push(occurrence);
  }

  // Price each item's deficit as an exact whole-lot cover, then hand the lot units to its paid occurrences.
  const purchases: ItemPurchase[] = [];
  let modSpend = ZERO;
  for (const itemId of [...paid.keys()].sort(codeUnitCompare)) {
    const takers = paid.get(itemId)!;
    const cover = cheapestCover(standalone.get(itemId)!, takers.length)!;
    const lots: PurchasedLot[] = [];
    let next = 0;
    for (const lot of cover.lots) {
      const taken = takers.slice(next, next + lot.offeredCount);
      next += taken.length;
      taken.forEach((occurrence, k) => {
        occurrence.source = { kind: 'offer', offer: lot };
        occurrence.charged = k === 0 ? lot.lotPrice : ZERO;
      });
      lots.push({ offer: lot, used: taken.length });
    }
    purchases.push({ itemId, deficit: takers.length, lots, cost: cover.cost });
    modSpend = add(modSpend, cover.cost);
  }

  const shortfalls = [...unavailable.entries()]
    .sort((a, b) => codeUnitCompare(a[0], b[0]))
    .map(([itemId, count]) => ({ itemId, count }));
  return {
    base: { choice: build.base, offer, price: basePrice },
    occurrences,
    deficits,
    purchases,
    shortfalls,
    modSpend,
    spend: add(basePrice ?? ZERO, modSpend),
  };
}
