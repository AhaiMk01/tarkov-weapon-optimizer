// Tiny hand-built production `ItemLookup`s for the physical blueprint and domain tests.
//
// Everything here writes the entries the way `buildItemLookup` shapes them, but with only the fields a test names. Offers
// are written as the extractors would have produced them (`OfferInfo`).

import type {
  GunLookupEntry, GunStats, ItemLookup, ModLookupEntry, ModStats, OfferInfo, PresetInfo, SlotInfo,
} from '../../src/solver/types';

export const WEAPON = 'gun';

export interface SlotSpec {
  id: string;
  allowed: string[];
  required?: boolean;
}

export const slot = (id: string, allowed: string[], required = false): SlotSpec => ({ id, allowed, required });

const toSlotInfo = (s: SlotSpec): SlotInfo => ({ id: s.id, name: s.id, nameId: s.id, required: s.required === true, allowedItems: [...s.allowed] });

export const trader = (vendor: string, level: number, price: number): OfferInfo => ({
  price, source: vendor, vendor_name: vendor, vendor_normalized: vendor, trader_level: level,
});

export const flea = (price: number): OfferInfo => ({
  price, source: 'fleaMarket', vendor_name: 'Flea Market', vendor_normalized: 'flea-market', trader_level: null,
});

export const barter = (vendor: string, level: number, price: number, requiresDogtag = false): OfferInfo => ({
  price,
  source: `barter:${vendor}`,
  vendor_name: vendor,
  vendor_normalized: vendor,
  trader_level: level,
  barter_requirements: [{ name: 'ingredient', count: 1, unit_price: price }],
  requires_dogtag: requiresDogtag ? true : undefined,
});

export interface ModSpec {
  weight?: number;
  ergo?: number;
  recoil?: number;
  slots?: SlotSpec[];
  conflictsItems?: string[];
  conflictsSlots?: string[];
  /** Default: one cheap trader offer (prapor level 1) so the item is acquirable. */
  offers?: OfferInfo[];
  fleaMinLevel?: number;
  /** Own category id first, then its ancestors. Written as the nested `data.bsgCategory` chain production carries. */
  categories?: string[];
}

function categoryNode(chain: readonly string[]): unknown {
  if (chain.length === 0) return null;
  return { id: chain[0], parent: categoryNode(chain.slice(1)) };
}

export function mod(id: string, spec: ModSpec = {}): ModLookupEntry {
  const offers = spec.offers ?? [trader('prapor', 1, 100)];
  const categories = spec.categories ?? [];
  const stats: ModStats = {
    ergonomics: spec.ergo ?? 0,
    recoil_modifier: spec.recoil ?? 0,
    accuracy_modifier: 0,
    center_of_impact: 0,
    offers,
    purchasable: offers.length > 0,
    price: offers.length ? offers[0].price : 0,
    price_source: offers.length ? offers[0].source : 'not_purchasable',
    weight: spec.weight ?? 0,
    width: 0,
    height: 0,
    min_level_flea: spec.fleaMinLevel ?? 0,
    capacity: 0,
    sighting_range: 0,
    category: '',
    category_id: categories[0] ?? '',
  };
  return {
    type: 'mod',
    data: { id, name: id, bsgCategory: categoryNode(categories) },
    slots: (spec.slots ?? []).map(toSlotInfo),
    stats,
    conflicting_items: [...(spec.conflictsItems ?? [])],
    conflicting_slot_ids: [...(spec.conflictsSlots ?? [])],
  };
}

export interface PresetSpec {
  id: string;
  items: { itemId: string; count: number }[];
  offers?: OfferInfo[];
}

export interface GunSpec {
  weight?: number;
  ergo?: number;
  slots?: SlotSpec[];
  /** Default: one trader offer so the naked receiver is an accessible base. */
  offers?: OfferInfo[];
  presets?: PresetSpec[];
  conflictsItems?: string[];
}

function presetInfo(gunId: string, p: PresetSpec): PresetInfo {
  const offers = p.offers ?? [trader('prapor', 1, 1000)];
  return {
    id: p.id,
    name: p.id,
    receiver_id: gunId,
    items: p.items.map(i => ({ ...i })),
    image: null,
    price: offers.length ? offers[0].price : 0,
    price_source: offers.length ? offers[0].source : 'not_available',
    offers,
    purchasable: offers.length > 0,
  };
}

export function gun(id: string, spec: GunSpec = {}): GunLookupEntry {
  const offers = spec.offers ?? [trader('prapor', 1, 5000)];
  const stats: GunStats = {
    naked_ergonomics: spec.ergo ?? 0,
    naked_recoil_v: 0,
    naked_recoil_h: 0,
    default_ergonomics: 0,
    default_recoil_v: 0,
    default_recoil_h: 0,
    default_preset_image: null,
    accuracy_modifier: 0,
    fire_rate: 0,
    fire_modes: [],
    caliber: '',
    weight: spec.weight ?? 1,
    width: 0,
    height: 0,
    sighting_range: 0,
    category: '',
    category_id: '',
    camera_snap: 0,
    center_of_impact: 0,
    deviation_max: 0,
    deviation_curve: 0,
    recoil_angle: 0,
    recoil_dispersion: 0,
    offers,
    price: offers.length ? offers[0].price : 0,
    price_source: offers.length ? offers[0].source : 'not_available',
  };
  const presets = (spec.presets ?? []).map(p => presetInfo(id, p));
  return {
    type: 'gun',
    data: { id, name: id, conflictingItems: (spec.conflictsItems ?? []).map(c => ({ id: c })) },
    slots: (spec.slots ?? []).map(toSlotInfo),
    stats,
    presets: presets.filter(p => p.purchasable),
    all_presets: presets,
  };
}

/** A lookup from a gun entry and any number of mod entries. */
export function lookupOf(weapon: GunLookupEntry, ...mods: [id: string, entry: ModLookupEntry][]): ItemLookup {
  const lookup: ItemLookup = { [(weapon.data as { id: string }).id]: weapon };
  for (const [id, entry] of mods) lookup[id] = entry;
  return lookup;
}
