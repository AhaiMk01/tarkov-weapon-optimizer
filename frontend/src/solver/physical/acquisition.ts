/**
 * Legal standalone offers (ADR 0002 section 3, ADR 0008 section 4, INTERPRETATIONS.md choices 2 and 10).
 *
 * An offer is legal for a request when:
 *  - trader cash offer: its stored price is positive, its trader is not disabled (unlocked level > TRADER_DISABLED, a
 *    trader missing from the request defaults to level 4) and the unlocked level reaches the offer's level;
 *  - flea offer: the flea market is available, its stored price is positive and the player level, when given, reaches
 *    the gate of that offer;
 *  - barter: barters are enabled, the barter is not a dogtag barter while those are excluded, and its trader level
 *    gates it like a cash offer. A barter exists only with a positive ingredient total (the extractor drops the
 *    rest), so a total that rounds to a stored price of 0 is still a legal offer.
 *
 * `OfferInfo` carries one flea gate per item (`min_level_flea`), not per offer; the caller passes it for the item's
 * flea offers. Nothing here prices a deficit: it only says which offers exist.
 *
 * Offers are lots (INTERPRETATIONS.md choice 1): a cash or flea offer delivers one unit at its stored price, a barter delivers
 * `lot_size` units for the price of one whole lot (the stored, rounded barter total). `legalOffers` returns each legal offer with
 * its lot size so the physical LP can cover a deficit with whole lots; there is no per-unit price anywhere.
 */

import type { OfferInfo } from '../types';
import { TRADER_DISABLED } from '../types';
import { PhysicalModelError } from './errors';

/** Level assumed for a trader missing from the request (production default; INTERPRETATIONS.md choice 10). */
export const DEFAULT_TRADER_LEVEL = 4;

export interface MarketSettings {
  /** Canonical (trimmed, lower-case) trader key to unlocked level. */
  readonly traderLevels: ReadonlyMap<string, number>;
  readonly fleaAvailable: boolean;
  readonly barterAvailable: boolean;
  readonly barterExcludeDogtags: boolean;
  /** null: no player-level gating of the flea market. */
  readonly playerLevel: number | null;
}

export interface MarketInput {
  traderLevels?: Readonly<Record<string, number>> | null;
  fleaAvailable?: boolean;
  barterAvailable?: boolean;
  barterExcludeDogtags?: boolean;
  playerLevel?: number | null;
}

/** Canonical trader key, the same canonicalization the production request path applies (`canonicalizeTraderLevels`). */
const traderKey = (name: string): string => name.trim().toLowerCase();

export function resolveMarket(input: MarketInput): MarketSettings {
  const traderLevels = new Map<string, number>();
  for (const [name, level] of Object.entries(input.traderLevels ?? {})) {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
      throw new PhysicalModelError('INVALID_REQUEST', `Trader level for ${name} is not a finite number`, { trader: name });
    }
    const key = traderKey(name);
    if (key.length > 0) traderLevels.set(key, level); // last entry wins for aliases, as in production
  }
  const playerLevel = input.playerLevel ?? null;
  if (playerLevel !== null && (typeof playerLevel !== 'number' || !Number.isFinite(playerLevel))) {
    throw new PhysicalModelError('INVALID_REQUEST', 'Player level is not a finite number', { playerLevel });
  }
  return {
    traderLevels,
    fleaAvailable: input.fleaAvailable !== false,
    barterAvailable: input.barterAvailable === true,
    barterExcludeDogtags: input.barterExcludeDogtags === true,
    playerLevel,
  };
}

function traderLegal(market: MarketSettings, vendor: string, requiredLevel: number | null): boolean {
  const unlocked = market.traderLevels.get(traderKey(vendor)) ?? DEFAULT_TRADER_LEVEL;
  if (unlocked <= TRADER_DISABLED) return false;
  return requiredLevel === null || requiredLevel <= unlocked;
}

/**
 * Units one purchase of the offer delivers: 1 for a cash or flea offer, `lot_size` for a barter. A barter with no `lot_size`
 * (hand-built, or from a payload that predates lot sizes such as the pinned snapshot, where no gun, mod or preset barter delivers
 * more than one unit) is one unit. A present lot size that is not an integer of at least 1 is a typed input error (`BAD_OFFER`),
 * never silently one.
 */
export function lotSizeOf(offer: OfferInfo): number {
  if (!offer.source.startsWith('barter:')) return 1;
  const lot = offer.lot_size;
  if (lot === undefined) return 1;
  if (!Number.isSafeInteger(lot) || lot < 1) {
    throw new PhysicalModelError('BAD_OFFER', `Barter offer from ${offer.vendor_normalized} has lot size ${String(lot)}, not an integer of at least 1`, { source: offer.source, lotSize: lot });
  }
  return lot;
}

function isLegal(offer: OfferInfo, fleaMinPlayerLevel: number, market: MarketSettings): boolean {
  if (!(Number.isFinite(offer.price))) return false;
  if (offer.source === 'fleaMarket') {
    const levelOk = market.playerLevel === null || fleaMinPlayerLevel <= market.playerLevel;
    return market.fleaAvailable && levelOk && offer.price > 0;
  }
  if (offer.source.startsWith('barter:')) {
    if (!market.barterAvailable) return false;
    if (market.barterExcludeDogtags && offer.requires_dogtag) return false;
    return offer.price >= 0 && traderLegal(market, offer.vendor_normalized ?? '', offer.trader_level);
  }
  return offer.price > 0 && traderLegal(market, offer.vendor_normalized ?? '', offer.trader_level);
}

/** Indexes (into `offers`, ascending) of the offers that are legal under the market settings. */
export function legalOfferIndexes(offers: readonly OfferInfo[], fleaMinPlayerLevel: number, market: MarketSettings): number[] {
  const legal: number[] = [];
  offers.forEach((offer, index) => {
    if (isLegal(offer, fleaMinPlayerLevel, market)) legal.push(index);
  });
  return legal;
}

/** One legal offer as a lot: `lotSize` units for `price`, bought whole. */
export interface AcquisitionOffer {
  /** Index into the owner's `offers` array. */
  index: number;
  /** The offer's source key (`fleaMarket`, a trader key, or `barter:<trader>`). */
  source: string;
  /** Stored RUB price of one whole lot. */
  price: number;
  /** Units delivered by one purchase (see {@link lotSizeOf}). */
  lotSize: number;
}

/** The legal offers as lots, in ascending offer-index order (the same offers as {@link legalOfferIndexes}). */
export function legalOffers(offers: readonly OfferInfo[], fleaMinPlayerLevel: number, market: MarketSettings): AcquisitionOffer[] {
  const legal: AcquisitionOffer[] = [];
  offers.forEach((offer, index) => {
    if (isLegal(offer, fleaMinPlayerLevel, market)) legal.push({ index, source: offer.source, price: offer.price, lotSize: lotSizeOf(offer) });
  });
  return legal;
}

/** Cheapest stored price among the offers at the given indexes, or null when there is none. */
export function cheapestPrice(offers: readonly OfferInfo[], indexes: readonly number[]): number | null {
  let best: number | null = null;
  for (const i of indexes) if (best === null || offers[i].price < best) best = offers[i].price;
  return best;
}
