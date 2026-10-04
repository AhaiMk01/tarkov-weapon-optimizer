// Default resolution and exact decoding of fixtures and requests (ADR 0010 section 2:
// "Resolve defaults independently, then decode finite binary64 leaves by exact integer ratios").
//
// This is the only place defaults are applied and doubles are decoded. Every other module
// consumes the resolved forms below and works in exact Q.

import {
  checkFixture, checkRequest, ReferenceInputError,
  type ReferenceFixture, type ReferenceOffer, type ReferenceRequest, type ReferenceSlot,
} from './domain';
import { DEFAULT_TRADER_LEVEL } from './constants';
import { fromBinary64, max, add, ZERO, ONE, type Q } from './q';

export interface ResolvedSlot {
  readonly id: string;
  readonly required: boolean;
  readonly allowedItemIds: readonly string[];
}

export interface ResolvedBarterRequirement {
  readonly count: Q;
  readonly avg24hPrice: Q | null;
  readonly basePrice: Q | null;
}

export type ResolvedOffer =
  | { readonly index: number; readonly kind: 'trader'; readonly trader: string; readonly level: number; readonly price: Q }
  | { readonly index: number; readonly kind: 'flea'; readonly minPlayerLevel: number; readonly price: Q }
  | {
      readonly index: number;
      readonly kind: 'barter';
      readonly trader: string;
      readonly level: number;
      readonly requirements: readonly ResolvedBarterRequirement[];
      readonly offeredCount: number;
      readonly requiresDogtag: boolean;
    };

export interface ResolvedTemplate {
  readonly id: string;
  readonly categories: readonly string[];
  readonly weight: Q;
  readonly ergonomics: Q;
  readonly recoilModifier: Q;
  readonly accuracyModifier: Q;
  readonly centerOfImpact: Q;
  readonly magazineCapacity: Q;
  readonly sightingRange: Q;
  readonly slots: readonly ResolvedSlot[];
  readonly conflictingItemIds: ReadonlySet<string>;
  readonly conflictingSlotIds: readonly string[];
  readonly offers: readonly ResolvedOffer[];
}

export interface ResolvedWeapon {
  readonly id: string;
  readonly categories: readonly string[];
  readonly weight: Q;
  readonly ergonomics: Q;
  readonly recoilVertical: Q;
  readonly recoilHorizontal: Q;
  readonly centerOfImpact: Q;
  readonly sightingRange: Q;
  readonly magazineCapacity: Q;
  readonly slots: readonly ResolvedSlot[];
  readonly conflictingItemIds: ReadonlySet<string>;
  readonly offers: readonly ResolvedOffer[];
}

export interface ResolvedPreset {
  readonly id: string;
  readonly weaponId: string;
  /** q_{b,i}: component quantity supplied by this preset. Repeated entries are summed. */
  readonly supply: ReadonlyMap<string, number>;
  readonly offers: readonly ResolvedOffer[];
}

export interface ResolvedFixture {
  readonly source: ReferenceFixture;
  readonly items: ReadonlyMap<string, ResolvedTemplate>;
  readonly weapons: ReadonlyMap<string, ResolvedWeapon>;
  readonly presets: ReadonlyMap<string, ResolvedPreset>;
}

/** UTF-16 code-unit order, the order ADR 0008 uses for instanceId allocation. */
export function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function resolveSlots(slots: ReferenceSlot[] | undefined): ResolvedSlot[] {
  return (slots ?? []).map(s => ({ id: s.id, required: s.required === true, allowedItemIds: [...s.allowedItemIds] }));
}

function decodeOptional(v: number | null | undefined): Q | null {
  return v === undefined || v === null ? null : fromBinary64(v);
}

function resolveOffers(offers: ReferenceOffer[] | undefined): ResolvedOffer[] {
  return (offers ?? []).map((offer, index): ResolvedOffer => {
    if (offer.kind === 'trader') {
      return { index, kind: 'trader', trader: offer.trader, level: offer.level, price: fromBinary64(offer.price) };
    }
    if (offer.kind === 'flea') {
      return { index, kind: 'flea', minPlayerLevel: offer.minPlayerLevel ?? 0, price: fromBinary64(offer.price) };
    }
    return {
      index,
      kind: 'barter',
      trader: offer.trader,
      level: offer.level,
      requirements: offer.requirements.map(r => ({
        count: fromBinary64(r.count),
        avg24hPrice: decodeOptional(r.avg24hPrice),
        basePrice: decodeOptional(r.basePrice),
      })),
      offeredCount: offer.offeredCount ?? 1,
      requiresDogtag: offer.requiresDogtag === true,
    };
  });
}

const fixtureCache = new WeakMap<ReferenceFixture, ResolvedFixture>();

/** Decode a fixture once. Fixtures are treated as immutable after their first use. */
export function resolveFixture(fixture: ReferenceFixture): ResolvedFixture {
  const cached = fixtureCache.get(fixture);
  if (cached) return cached;
  const issues = checkFixture(fixture);
  if (issues.length) throw new ReferenceInputError(issues);
  const items = new Map<string, ResolvedTemplate>();
  for (const it of fixture.items) {
    items.set(it.id, {
      id: it.id,
      categories: [...(it.categories ?? [])],
      weight: fromBinary64(it.weightKg ?? 0),
      ergonomics: fromBinary64(it.ergonomics ?? 0),
      recoilModifier: fromBinary64(it.recoilModifier ?? 0),
      accuracyModifier: fromBinary64(it.accuracyModifier ?? 0),
      centerOfImpact: fromBinary64(it.centerOfImpact ?? 0),
      magazineCapacity: fromBinary64(it.magazineCapacity ?? 0),
      sightingRange: fromBinary64(it.sightingRange ?? 0),
      slots: resolveSlots(it.slots),
      conflictingItemIds: new Set(it.conflictingItemIds ?? []),
      conflictingSlotIds: [...(it.conflictingSlotIds ?? [])],
      offers: resolveOffers(it.offers),
    });
  }
  const weapons = new Map<string, ResolvedWeapon>();
  for (const w of fixture.weapons) {
    weapons.set(w.id, {
      id: w.id,
      categories: [...(w.categories ?? [])],
      weight: fromBinary64(w.weightKg ?? 0),
      ergonomics: fromBinary64(w.ergonomics ?? 0),
      recoilVertical: fromBinary64(w.recoilVertical ?? 0),
      recoilHorizontal: fromBinary64(w.recoilHorizontal ?? 0),
      centerOfImpact: fromBinary64(w.centerOfImpact ?? 0),
      sightingRange: fromBinary64(w.sightingRange ?? 0),
      magazineCapacity: fromBinary64(w.magazineCapacity ?? 0),
      slots: resolveSlots(w.slots),
      conflictingItemIds: new Set(w.conflictingItemIds ?? []),
      offers: resolveOffers(w.offers),
    });
  }
  const presets = new Map<string, ResolvedPreset>();
  for (const p of fixture.presets ?? []) {
    const supply = new Map<string, number>();
    for (const c of p.components) supply.set(c.itemId, (supply.get(c.itemId) ?? 0) + c.count);
    presets.set(p.id, { id: p.id, weaponId: p.weaponId, supply, offers: resolveOffers(p.offers) });
  }
  const resolved: ResolvedFixture = { source: fixture, items, weapons, presets };
  fixtureCache.set(fixture, resolved);
  return resolved;
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

export interface ResolvedWeights {
  readonly e: Q;
  readonly r: Q;
  readonly p: Q;
}

export interface ResolvedIdealPoint {
  readonly zE: Q;
  readonly nadE: Q;
  readonly zR: Q;
  readonly nadR: Q;
  readonly zP: Q;
  readonly nadP: Q;
}

export type ResolvedObjective =
  | { readonly kind: 'weighted'; readonly weights: ResolvedWeights }
  | { readonly kind: 'tchebycheff'; readonly weights: ResolvedWeights; readonly ideal: ResolvedIdealPoint };

export interface ResolvedRequest {
  readonly weaponId: string;
  readonly maxPrice: Q | null;
  readonly minErgonomics: Q | null;
  readonly maxRecoilV: Q | null;
  readonly maxRecoilSum: Q | null;
  readonly minMagCapacity: Q | null;
  readonly minSightingRange: Q | null;
  readonly maxWeight: Q | null;
  readonly maxMoa: Q | null;
  readonly preventOverswing: boolean;
  /** max(0, 1 + equip_ergo_modifier). */
  readonly gearFactor: Q;
  readonly includeItems: readonly string[];
  readonly excludeItems: ReadonlySet<string>;
  readonly includeCategories: readonly (readonly string[])[];
  readonly excludeCategories: ReadonlySet<string>;
  readonly useTrueErgo: boolean;
  readonly objective: ResolvedObjective;
  readonly traderLevels: ReadonlyMap<string, number>;
  readonly fleaAvailable: boolean;
  readonly barterAvailable: boolean;
  readonly barterExcludeDogtags: boolean;
  readonly playerLevel: number | null;
  /** N_owned(i): multiplicity of each id in owned_items. */
  readonly owned: ReadonlyMap<string, number>;
}

function capQ(v: number | null | undefined): Q | null {
  return v === undefined || v === null ? null : fromBinary64(v);
}

function weight(v: number | null | undefined, fallback: Q): Q {
  const x = v === undefined || v === null ? fallback : fromBinary64(v);
  return x.n < 0n ? ZERO : x;
}

/** Resolve a request against a fixture. Throws ReferenceInputError on malformed input. */
export function resolveRequest(fixture: ReferenceFixture, request: ReferenceRequest): ResolvedRequest {
  const issues = checkRequest(fixture, request);
  if (issues.length) throw new ReferenceInputError(issues);
  const weights: ResolvedWeights = {
    e: weight(request.ergo_weight, ONE),
    r: weight(request.recoil_weight, ONE),
    p: weight(request.price_weight, ZERO),
  };
  let objective: ResolvedObjective = { kind: 'weighted', weights };
  if (request.use_tchebycheff) {
    const ip = request.ideal_point!;
    objective = {
      kind: 'tchebycheff',
      weights,
      ideal: {
        zE: fromBinary64(ip.zE), nadE: fromBinary64(ip.nadE),
        zR: fromBinary64(ip.zR), nadR: fromBinary64(ip.nadR),
        zP: fromBinary64(ip.zP), nadP: fromBinary64(ip.nadP),
      },
    };
  }
  const owned = new Map<string, number>();
  for (const id of request.owned_items ?? []) owned.set(id, (owned.get(id) ?? 0) + 1);
  return {
    weaponId: request.weapon_id,
    maxPrice: capQ(request.max_price),
    minErgonomics: capQ(request.min_ergonomics),
    maxRecoilV: capQ(request.max_recoil_v),
    maxRecoilSum: capQ(request.max_recoil_sum),
    minMagCapacity: capQ(request.min_mag_capacity),
    minSightingRange: capQ(request.min_sighting_range),
    maxWeight: capQ(request.max_weight),
    maxMoa: capQ(request.max_moa),
    preventOverswing: request.prevent_overswing === true,
    gearFactor: max(ZERO, add(ONE, fromBinary64(request.equip_ergo_modifier ?? 0))),
    includeItems: [...(request.include_items ?? [])],
    excludeItems: new Set(request.exclude_items ?? []),
    includeCategories: (request.include_categories ?? []).map(g => [...g]),
    excludeCategories: new Set(request.exclude_categories ?? []),
    useTrueErgo: request.use_true_ergo === true,
    objective,
    traderLevels: new Map(Object.entries(request.trader_levels ?? {})),
    fleaAvailable: request.flea_available !== false,
    barterAvailable: request.barter_available === true,
    barterExcludeDogtags: request.barter_exclude_dogtags === true,
    playerLevel: request.player_level ?? null,
    owned,
  };
}

/** A category id matches an item whose own-or-ancestor category chain contains it. */
export function matchesCategory(item: ResolvedTemplate, categoryId: string): boolean {
  return item.categories.includes(categoryId);
}

/** True when the request bans this item by id or by category. */
export function isExcludedByRequest(request: ResolvedRequest, item: ResolvedTemplate): boolean {
  if (request.excludeItems.has(item.id)) return true;
  for (const category of request.excludeCategories) if (matchesCategory(item, category)) return true;
  return false;
}

/** Unlocked level for a trader; absent traders get DEFAULT_TRADER_LEVEL. */
export function traderLevelOf(request: ResolvedRequest, trader: string): number {
  return request.traderLevels.get(trader) ?? DEFAULT_TRADER_LEVEL;
}

