// Pure mapping from a reference fixture and request to the inputs production's solver takes today: an
// `ItemLookup` (the shape `buildItemLookup` produces), the BFS compatibility map and the `SolveParams`.
//
// The lookup is built directly, not through the production extractors: the extractors are compared with the
// reference reader separately (reference/source/*.differential.test.ts). Here the stats are written in the
// units production stores them in, and the offers and preset components are written the way `extractModStats` /
// `extractAllPresets` would have produced them from the equivalent raw data (positive prices only, barters priced
// by the exact total rounded half up through production's own `barterLotPrice`, offers sorted by price,
// count-bearing preset components), so production sees what it would see in the app.
//
// A fixture or request feature that today's production inputs cannot carry is never dropped silently. It is
// returned in `unsupported` (feature id plus detail) and the harness treats the case as a recorded failure
// instead of running a different problem. When a Stage 2 phase teaches production a feature, the matching
// detector below is removed together with the mapping change, and the ratchet picks up the newly passing cases.
//
// Phase 2.4b-1 gave the production INPUTS the stash (`SolveParams.ownedItems`) and the barter lot size
// (`OfferInfo.lot_size`), so their detectors are gone: both are now mapped. Today's LP does not honour either, so
// those cases run and are graded on the dimensions they still fail; the detectors only ever meant "the input cannot
// be written", and it now can.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file
// may import this one.

import type {
  CompatibilityMap, GunLookupEntry, GunStats, IdealPoint, ItemLookup, ModLookupEntry, ModStats, OfferInfo, PresetComponent,
  PresetInfo, SlotInfo, SolveParams, TraderLevels,
} from '../../src/solver/types';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { barterLotPrice } from '../../src/solver/physical/barterPrice';
import type {
  ReferenceBarterOffer, ReferenceFixture, ReferenceFleaOffer, ReferenceItem, ReferenceOffer, ReferencePreset, ReferenceRequest,
  ReferenceSlot, ReferenceWeapon,
} from '../oracle/index';

// ---------------------------------------------------------------------------------------------
// Unsupported features
// ---------------------------------------------------------------------------------------------

/** Every fixture/request feature the current production inputs cannot represent, in report order. */
export const UNSUPPORTED_FEATURES = [
  /** A player-level flea gate on a receiver or preset: only mods carry `min_level_flea`. */
  'flea_player_level_on_base',
  /** One mod with flea offers at different player levels: `min_level_flea` is one number per item. */
  'flea_offers_distinct_player_levels',
  /** A receiver magazine capacity under a magazine minimum: `GunStats` has no capacity. */
  'weapon_magazine_capacity',
  /** A trader name that `canonicalizeTraderLevels` / the vendor lookup would trim or lowercase into another key. */
  'non_canonical_trader_name',
  /** A preset id equal to its receiver id or to the naked-base marker: the response cannot tell the base apart. */
  'ambiguous_preset_id',
] as const;

export type UnsupportedFeatureId = (typeof UNSUPPORTED_FEATURES)[number];

export interface UnsupportedFeature {
  feature: UnsupportedFeatureId;
  detail: string;
}

/** The base marker production's LP uses for the naked receiver (lpBuilder baseIds, solver base decoding). */
const NAKED_BASE_MARKER = 'naked';

const positive = (offer: ReferenceOffer): boolean => offer.kind === 'barter' || offer.price > 0;

const isFlea = (offer: ReferenceOffer): offer is ReferenceFleaOffer => offer.kind === 'flea';

function presetSupply(preset: ReferencePreset): Map<string, number> {
  const supply = new Map<string, number>();
  for (const c of preset.components) supply.set(c.itemId, (supply.get(c.itemId) ?? 0) + c.count);
  return supply;
}

/** Every fixture or request feature production's current inputs cannot carry, in stable (feature, subject) order. */
export function detectUnsupported(fixture: ReferenceFixture, request: ReferenceRequest): UnsupportedFeature[] {
  const found: UnsupportedFeature[] = [];
  const add = (feature: UnsupportedFeatureId, detail: string) => found.push({ feature, detail });

  const subjects: { id: string; kind: 'mod' | 'receiver' | 'preset'; offers: ReferenceOffer[] }[] = [
    ...fixture.items.map(i => ({ id: i.id, kind: 'mod' as const, offers: i.offers ?? [] })),
    ...fixture.weapons.map(w => ({ id: w.id, kind: 'receiver' as const, offers: w.offers ?? [] })),
    ...(fixture.presets ?? []).map(p => ({ id: p.id, kind: 'preset' as const, offers: p.offers ?? [] })),
  ];

  for (const s of subjects) {
    const fleas = s.offers.filter(isFlea).filter(positive);
    if (s.kind === 'mod') {
      const levels = new Set(fleas.map(o => o.minPlayerLevel ?? 0));
      if (levels.size > 1) add('flea_offers_distinct_player_levels', `mod ${s.id}: flea offers at player levels ${[...levels].sort((a, b) => a - b).join(', ')} (min_level_flea is one number)`);
    } else if (fleas.some(o => (o.minPlayerLevel ?? 0) > 0)) {
      add('flea_player_level_on_base', `${s.kind} ${s.id}: flea offer gated at player level ${Math.max(...fleas.map(o => o.minPlayerLevel ?? 0))} (only mods carry min_level_flea)`);
    }
  }

  const weapon = fixture.weapons.find(w => w.id === request.weapon_id);
  if (weapon && (weapon.magazineCapacity ?? 0) !== 0 && request.min_mag_capacity != null) {
    add('weapon_magazine_capacity', `receiver ${weapon.id} has magazineCapacity ${weapon.magazineCapacity} under min_mag_capacity ${request.min_mag_capacity}`);
  }

  const canonical = (name: string) => name === name.trim().toLowerCase() && name !== '';
  for (const s of subjects) {
    for (const offer of s.offers) {
      if (offer.kind !== 'flea' && !canonical(offer.trader)) add('non_canonical_trader_name', `${s.kind} ${s.id}: trader ${JSON.stringify(offer.trader)}`);
    }
  }
  for (const name of Object.keys(request.trader_levels ?? {})) {
    if (!canonical(name)) add('non_canonical_trader_name', `request trader_levels key ${JSON.stringify(name)}`);
  }

  for (const preset of fixture.presets ?? []) {
    if (preset.id === preset.weaponId || preset.id === NAKED_BASE_MARKER) {
      add('ambiguous_preset_id', `preset ${preset.id} on ${preset.weaponId} reads as the naked base in production's response`);
    }
  }

  const order = (f: UnsupportedFeatureId) => UNSUPPORTED_FEATURES.indexOf(f);
  return found.sort((a, b) => order(a.feature) - order(b.feature));
}

// ---------------------------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------------------------

function barterOffer(offer: ReferenceBarterOffer): OfferInfo | null {
  // extractBarterOffers: the exact total of count x (avg24hPrice ?? basePrice ?? 0), a total <= 0 is no offer, and the
  // price is that total rounded half up (the production `barterLotPrice`, the same function the extractor calls).
  const requirements = offer.requirements.map((r, index) => {
    const unit = r.avg24hPrice ?? r.basePrice ?? 0;
    return { name: r.itemId ?? `ingredient ${index}`, count: r.count, unit_price: unit };
  });
  const price = barterLotPrice(requirements.map(r => ({ count: r.count, unitPrice: r.unit_price })));
  if (price === null) return null;
  return {
    price,
    source: `barter:${offer.trader}`,
    vendor_name: offer.trader,
    vendor_normalized: offer.trader,
    trader_level: offer.level,
    barter_requirements: requirements,
    requires_dogtag: offer.requiresDogtag === true ? true : undefined,
    // Units one barter delivers, as the source says (an absent offeredCount is one unit, as in the oracle).
    lot_size: offer.offeredCount ?? 1,
  };
}

/** Offers in the order the extractors build them (cash/flea in list order, then barters), then sorted by price. */
function mapOffers(offers: ReferenceOffer[] | undefined): OfferInfo[] {
  const cash: OfferInfo[] = [];
  const barters: OfferInfo[] = [];
  for (const offer of offers ?? []) {
    if (offer.kind === 'trader') {
      if (offer.price <= 0) continue;
      cash.push({ price: offer.price, source: offer.trader, vendor_name: offer.trader, vendor_normalized: offer.trader, trader_level: offer.level });
    } else if (offer.kind === 'flea') {
      if (offer.price <= 0) continue;
      cash.push({ price: offer.price, source: 'fleaMarket', vendor_name: 'Flea Market', vendor_normalized: 'flea-market', trader_level: null });
    } else {
      const mapped = barterOffer(offer);
      if (mapped) barters.push(mapped);
    }
  }
  return [...cash, ...barters].sort((a, b) => a.price - b.price);
}

/** The single flea player-level gate of a subject (`min_level_flea`); unsupported combinations are reported separately. */
function fleaGate(offers: ReferenceOffer[] | undefined): number {
  const levels = (offers ?? []).filter(isFlea).filter(positive).map(o => o.minPlayerLevel ?? 0);
  return levels.length ? Math.max(...levels) : 0;
}

// ---------------------------------------------------------------------------------------------
// Lookup entries
// ---------------------------------------------------------------------------------------------

/** The nested `data.bsgCategory` chain production carries (own category first, then its ancestors), or null for an item with none. */
function categoryNode(chain: readonly string[]): { id: string; parent: unknown } | null {
  return chain.length === 0 ? null : { id: chain[0], parent: categoryNode(chain.slice(1)) };
}

function mapSlots(slots: ReferenceSlot[] | undefined): SlotInfo[] {
  return (slots ?? []).map(s => ({ id: s.id, name: s.id, nameId: s.id, required: s.required === true, allowedItems: [...s.allowedItemIds] }));
}

function modEntry(item: ReferenceItem, receiverConflicts: readonly string[]): ModLookupEntry {
  const offers = mapOffers(item.offers);
  const purchasable = offers.length > 0;
  const stats: ModStats = {
    ergonomics: item.ergonomics ?? 0,
    recoil_modifier: item.recoilModifier ?? 0,
    accuracy_modifier: item.accuracyModifier ?? 0,
    center_of_impact: item.centerOfImpact ?? 0,
    offers,
    purchasable,
    price: purchasable ? offers[0].price : 0,
    price_source: purchasable ? offers[0].source : 'not_purchasable',
    weight: item.weightKg ?? 0,
    width: 0,
    height: 0,
    min_level_flea: fleaGate(item.offers),
    capacity: item.magazineCapacity ?? 0,
    sighting_range: item.sightingRange ?? 0,
    category: '',
    category_id: (item.categories ?? [])[0] ?? '',
  };
  return {
    type: 'mod',
    data: { id: item.id, name: item.id, bsgCategory: categoryNode(item.categories ?? []) },
    slots: mapSlots(item.slots),
    stats,
    // A receiver that lists this mod bans it: production has no receiver conflict list, but a mod that lists the receiver
    // is skipped by the compatibility map, which is the same exclusion the oracle's symmetrized pair gives.
    conflicting_items: [...(item.conflictingItemIds ?? []), ...receiverConflicts],
    conflicting_slot_ids: [...(item.conflictingSlotIds ?? [])],
  };
}

function presetInfo(preset: ReferencePreset): PresetInfo {
  const offers = mapOffers(preset.offers);
  // Count-bearing components the way extractAllPresets writes them: repeated entries summed, a zero count kept as a
  // component that supplies nothing, and the receiver's own entry carried as `receiver_id` (base identity), not as stock.
  const items: PresetComponent[] = [];
  for (const [itemId, count] of presetSupply(preset)) if (itemId !== preset.weaponId) items.push({ itemId, count });
  return {
    id: preset.id,
    name: preset.id,
    receiver_id: preset.weaponId,
    items,
    image: null,
    price: offers.length ? offers[0].price : 0,
    price_source: offers.length ? offers[0].source : 'not_available',
    offers,
    purchasable: offers.length > 0 && offers[0].price > 0,
  };
}

function gunEntry(weapon: ReferenceWeapon, presets: ReferencePreset[]): GunLookupEntry {
  const offers = mapOffers(weapon.offers);
  const stats: GunStats = {
    naked_ergonomics: weapon.ergonomics ?? 0,
    naked_recoil_v: weapon.recoilVertical ?? 0,
    naked_recoil_h: weapon.recoilHorizontal ?? 0,
    default_ergonomics: 0,
    default_recoil_v: 0,
    default_recoil_h: 0,
    default_preset_image: null,
    accuracy_modifier: 0,
    fire_rate: 0,
    fire_modes: [],
    caliber: '',
    weight: weapon.weightKg ?? 0,
    width: 0,
    height: 0,
    sighting_range: weapon.sightingRange ?? 0,
    category: '',
    category_id: (weapon.categories ?? [])[0] ?? '',
    camera_snap: 0,
    center_of_impact: weapon.centerOfImpact ?? 0,
    deviation_max: 0,
    deviation_curve: 0,
    recoil_angle: 0,
    recoil_dispersion: 0,
    offers,
    price: offers.length ? offers[0].price : 0,
    price_source: offers.length ? offers[0].source : 'not_available',
  };
  const all = presets.map(presetInfo);
  return {
    type: 'gun',
    data: { id: weapon.id, name: weapon.id },
    slots: mapSlots(weapon.slots),
    stats,
    presets: all.filter(p => p.purchasable),
    all_presets: all,
  };
}

/** The production `ItemLookup` of a fixture: every item a mod entry, every receiver a gun entry. */
export function mapFixture(fixture: ReferenceFixture): ItemLookup {
  const lookup: ItemLookup = {};
  const bannedByReceiver = new Map<string, string[]>();
  for (const weapon of fixture.weapons) {
    for (const itemId of weapon.conflictingItemIds ?? []) {
      const list = bannedByReceiver.get(itemId);
      if (list) list.push(weapon.id);
      else bannedByReceiver.set(itemId, [weapon.id]);
    }
  }
  for (const weapon of fixture.weapons) {
    lookup[weapon.id] = gunEntry(weapon, (fixture.presets ?? []).filter(p => p.weaponId === weapon.id));
  }
  for (const item of fixture.items) lookup[item.id] = modEntry(item, bannedByReceiver.get(item.id) ?? []);
  return lookup;
}

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

export type RequestParams = Omit<SolveParams, 'weaponId' | 'itemLookup' | 'compatibilityMap'>;

/**
 * Every request field to its SolveParams counterpart. Absent fields stay absent (or null for the nullable caps), so
 * production applies its own defaults; a cap of 0 is a real cap. `owned_items` becomes `ownedItems` as a copy (null reads as omitted).
 */
export function mapRequest(request: ReferenceRequest): RequestParams {
  const ideal: IdealPoint | undefined = request.ideal_point ? { ...request.ideal_point } : undefined;
  return {
    maxPrice: request.max_price ?? null,
    minErgonomics: request.min_ergonomics ?? null,
    maxRecoilV: request.max_recoil_v ?? null,
    maxRecoilSum: request.max_recoil_sum ?? null,
    minMagCapacity: request.min_mag_capacity ?? null,
    minSightingRange: request.min_sighting_range ?? null,
    maxWeight: request.max_weight ?? null,
    maxMOA: request.max_moa ?? null,
    includeItems: request.include_items ?? null,
    excludeItems: request.exclude_items ?? null,
    includeCategories: request.include_categories ?? null,
    excludeCategories: request.exclude_categories ?? null,
    ergoWeight: request.ergo_weight ?? undefined,
    recoilWeight: request.recoil_weight ?? undefined,
    priceWeight: request.price_weight ?? undefined,
    useTrueErgo: request.use_true_ergo,
    useTchebycheff: request.use_tchebycheff,
    idealPoint: ideal,
    preventOverswing: request.prevent_overswing,
    equipErgoModifier: request.equip_ergo_modifier ?? null,
    traderLevels: request.trader_levels ? (request.trader_levels as TraderLevels) : null,
    fleaAvailable: request.flea_available,
    barterAvailable: request.barter_available,
    barterExcludeDogtags: request.barter_exclude_dogtags,
    playerLevel: request.player_level ?? null,
    ownedItems: request.owned_items ? [...request.owned_items] : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Whole case
// ---------------------------------------------------------------------------------------------

export interface MapOptions {
  /** Production's `preciseMode`: true is the Precise (exact placement) model, false the Fast one. */
  preciseMode: boolean;
  /** Request-wide deadline handed to production. */
  timeLimitMs?: number;
  /** Absolute certification tolerance requested of the nonlinear search. */
  objectiveTolerance?: number;
}

export interface ProductionInputs {
  weaponId: string;
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  params: SolveParams;
  /** Features production cannot represent; the harness does not run a case that lists any. */
  unsupported: UnsupportedFeature[];
}

export function toProduction(fixture: ReferenceFixture, request: ReferenceRequest, options: MapOptions): ProductionInputs {
  const itemLookup = mapFixture(fixture);
  const compatibilityMap = buildCompatibilityMap(request.weapon_id, itemLookup);
  const params: SolveParams = {
    ...mapRequest(request),
    weaponId: request.weapon_id,
    itemLookup,
    compatibilityMap,
    preciseMode: options.preciseMode,
    ...(options.timeLimitMs === undefined ? {} : { timeLimitMs: options.timeLimitMs }),
    ...(options.objectiveTolerance === undefined ? {} : { objectiveTolerance: options.objectiveTolerance }),
  };
  return { weaponId: request.weapon_id, itemLookup, compatibilityMap, params, unsupported: detectUnsupported(fixture, request) };
}
