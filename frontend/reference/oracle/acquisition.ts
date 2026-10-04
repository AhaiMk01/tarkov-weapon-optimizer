// Acquisition and spend model (ADR 0002 sections 2-8, ADR 0008 section 5, ADR 0009 section 3).
//
//   d_i   = max(0, installed_i - preset_i - owned_i)           authoritative paid deficit
//   spend = cheapest legal base offer + sum_i d_i * unitPrice_i  (exact Q)
//
// Allocation per occurrence runs in code-unit instanceId order: selected-preset supply q_{b,i}
// first, owned stock second, paid remainder last. Items with no legal standalone offer are
// capped by preset supply plus owned stock; an excess is reported as a shortfall, never priced.
// A stored price <= 0 is not an offer. Owned stock never grants a receiver or a base.

import type { BaseChoice, ReferenceBuild } from './build';
import { TRADER_DISABLED } from './constants';
import {
  codeUnitCompare, traderLevelOf,
  type ResolvedFixture, type ResolvedOffer, type ResolvedRequest,
} from './resolve';
import { add, div, gt, lt, mul, q, roundHalfUp, sum, ZERO, type Q } from './q';

export interface LegalOffer {
  /** Index of the offer in its subject's offer list. */
  index: number;
  kind: 'trader' | 'flea' | 'barter';
  trader: string | null;
  /** Required loyalty level (trader/barter) or null (flea). */
  level: number | null;
  /** RUB for one lot: the stored price, or the rounded barter total. */
  lotPrice: Q;
  /** Units delivered per lot (1 except for barters that say otherwise). */
  offeredCount: number;
  /** lotPrice / offeredCount, exact. */
  unitPrice: Q;
  requiresDogtag: boolean;
}

/** Unrounded barter ingredient total: sum count x (avg24hPrice ?? basePrice ?? 0). */
export function barterRequirementTotal(offer: Extract<ResolvedOffer, { kind: 'barter' }>): Q {
  return sum(offer.requirements.map(r => mul(r.count, r.avg24hPrice ?? r.basePrice ?? ZERO)));
}

function traderLegal(request: ResolvedRequest, trader: string, level: number): boolean {
  const unlocked = traderLevelOf(request, trader);
  return unlocked > TRADER_DISABLED && unlocked >= level;
}

function toLegal(offer: ResolvedOffer, lotPrice: Q): LegalOffer {
  const offeredCount = offer.kind === 'barter' ? offer.offeredCount : 1;
  return {
    index: offer.index,
    kind: offer.kind,
    trader: offer.kind === 'flea' ? null : offer.trader,
    level: offer.kind === 'flea' ? null : offer.level,
    lotPrice,
    offeredCount,
    unitPrice: div(lotPrice, q(offeredCount)),
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

/** Cheapest legal per-unit offer; ties keep the earliest offer in list order. */
export function cheapestLegalOffer(offers: readonly ResolvedOffer[], request: ResolvedRequest): LegalOffer | null {
  let best: LegalOffer | null = null;
  for (const offer of legalOffers(offers, request)) {
    if (best === null || lt(offer.unitPrice, best.unitPrice)) best = offer;
  }
  return best;
}

/** Cheapest legal standalone offer for an installable item, or null (then the item is cap-limited). */
export function standaloneOffer(fixture: ResolvedFixture, request: ResolvedRequest, itemId: string): LegalOffer | null {
  const item = fixture.items.get(itemId);
  return item ? cheapestLegalOffer(item.offers, request) : null;
}

/** Cheapest legal offer for the base subject (naked receiver or preset), or null when inaccessible. */
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
  /** RUB attributed to this occurrence (0 for preset, owned, unavailable). */
  unitPrice: Q;
}

export interface AcquisitionResult {
  base: { choice: BaseChoice; offer: LegalOffer | null; price: Q | null };
  /** One record per installed occurrence, in instanceId code-unit order. */
  occurrences: OccurrenceAcquisition[];
  /** Authoritative d_i for items with d_i > 0, whether or not an offer exists. */
  deficits: Map<string, number>;
  /** Units that exceed supply for items with no legal standalone offer. */
  shortfalls: { itemId: string; count: number }[];
  /** Sum of paid units x unit price. */
  modSpend: Q;
  /** Base price (0 when the base is inaccessible) plus modSpend. */
  spend: Q;
}

export function acquire(fixture: ResolvedFixture, request: ResolvedRequest, build: ReferenceBuild): AcquisitionResult {
  const offer = baseOffer(fixture, request, build.base);
  const basePrice = offer ? offer.unitPrice : null;
  const ordered = [...build.placements].sort((a, b) => codeUnitCompare(a.childInstanceId, b.childInstanceId));
  const remainingPreset = new Map<string, number>();
  const remainingOwned = new Map<string, number>();
  const standalone = new Map<string, LegalOffer | null>();
  const deficits = new Map<string, number>();
  const unavailable = new Map<string, number>();
  const occurrences: OccurrenceAcquisition[] = [];
  let modSpend = ZERO;
  for (const placement of ordered) {
    const id = placement.itemId;
    if (!remainingPreset.has(id)) {
      remainingPreset.set(id, presetSupplyOf(fixture, build.base, id));
      remainingOwned.set(id, request.owned.get(id) ?? 0);
      standalone.set(id, standaloneOffer(fixture, request, id));
    }
    const fromPreset = remainingPreset.get(id)!;
    const fromOwned = remainingOwned.get(id)!;
    let source: OccurrenceSource;
    let unitPrice = ZERO;
    if (fromPreset > 0) {
      remainingPreset.set(id, fromPreset - 1);
      source = { kind: 'preset', presetId: build.base.kind === 'preset' ? build.base.presetId : '' };
    } else if (fromOwned > 0) {
      remainingOwned.set(id, fromOwned - 1);
      source = { kind: 'owned' };
    } else {
      deficits.set(id, (deficits.get(id) ?? 0) + 1);
      const legal = standalone.get(id) ?? null;
      if (legal) {
        source = { kind: 'offer', offer: legal };
        unitPrice = legal.unitPrice;
        modSpend = add(modSpend, unitPrice);
      } else {
        source = { kind: 'unavailable' };
        unavailable.set(id, (unavailable.get(id) ?? 0) + 1);
      }
    }
    occurrences.push({ instanceId: placement.childInstanceId, itemId: id, source, unitPrice });
  }
  const shortfalls = [...unavailable.entries()]
    .sort((a, b) => codeUnitCompare(a[0], b[0]))
    .map(([itemId, count]) => ({ itemId, count }));
  return {
    base: { choice: build.base, offer, price: basePrice },
    occurrences,
    deficits,
    shortfalls,
    modSpend,
    spend: add(basePrice ?? ZERO, modSpend),
  };
}
