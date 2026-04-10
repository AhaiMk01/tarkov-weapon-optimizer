/**
 * Data fetching from tarkov.dev GraphQL API + IndexedDB caching + item lookup building.
 * Ported from backend/app/services/optimizer.py and queries.py.
 */

import type {
  ItemLookup, SlotInfo, GunStats, ModStats, OfferInfo, PresetInfo, TraderLevels,
} from './types.ts';
import { DEFAULT_TRADER_LEVELS } from './types.ts';

const API_URL = 'https://api.tarkov.dev/graphql';
const CACHE_VERSION = 10;
const CACHE_TTL_MS = 3600 * 1000; // 1 hour
const DB_NAME = 'tarkov-optimizer-cache';
const DB_VERSION = 1;
const STORE_NAME = 'graphql-cache';

// --- GraphQL Queries ---

const GUNS_QUERY = `
query AllGuns($lang: LanguageCode, $gameMode: GameMode) {
  items(gameMode: $gameMode, lang: $lang, types: gun) {
    id
    basePrice
    avg24hPrice
    buyFor {
      currency
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer {
          minTraderLevel
          buyLimit
        }
        ... on FleaMarket {
          foundInRaidRequired
        }
      }
    }
    bartersFor {
      trader { name normalizedName }
      level
      requiredItems {
        item { id name avg24hPrice basePrice }
        count
      }
    }
    accuracyModifier
    conflictingSlotIds
    ergonomicsModifier
    recoilModifier
    name
    normalizedName
    shortName
    weight
    width
    height
    image8xLink
    image512pxLink
    imageLink
    iconLinkFallback
    iconLink
    bsgCategory {
      id
      name
    }
    properties {
      ... on ItemPropertiesWeapon {
        caliber
        effectiveDistance
        sightingRange
        fireRate
        fireModes
        cameraSnap
        centerOfImpact
        deviationMax
        deviationCurve
        recoilAngle
        recoilDispersion
        ergonomics
        defaultErgonomics
        recoilVertical
        recoilHorizontal
        defaultRecoilVertical
        defaultRecoilHorizontal
        presets {
          id
          name
          shortName
          baseImageLink
          gridImageLinkFallback
          gridImageLink
          imageLink
          image8xLink
          image512pxLink
          imageLinkFallback
          inspectImageLink
          containsItems {
            item {
              id
            }
          }
          buyFor {
            source
            vendor {
              name
              normalizedName
              ... on TraderOffer {
                minTraderLevel
                buyLimit
              }
              ... on FleaMarket {
                foundInRaidRequired
                enabled
              }
            }
            priceRUB
            price
          }
          bartersFor {
            trader { name normalizedName }
            level
            requiredItems {
              item { id name avg24hPrice basePrice }
              count
            }
          }
        }
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
        defaultPreset {
          baseImageLink
          gridImageLinkFallback
          gridImageLink
          iconLinkFallback
          iconLink
          image512pxLink
          image8xLink
          imageLink
          imageLinkFallback
          inspectImageLink
        }
      }
    }
  }
}
`;

const MODS_QUERY = `
query AllMods($lang: LanguageCode, $gameMode: GameMode) {
  items(gameMode: $gameMode, lang: $lang, types: mods) {
    id
    basePrice
    avg24hPrice
    buyFor {
      currency
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer {
          minTraderLevel
          buyLimit
        }
      }
    }
    bartersFor {
      trader { name normalizedName }
      level
      requiredItems {
        item { id name avg24hPrice basePrice }
        count
      }
    }
    accuracyModifier
    ergonomicsModifier
    recoilModifier
    name
    normalizedName
    shortName
    weight
    image8xLink
    image512pxLink
    imageLink
    iconLinkFallback
    iconLink
    conflictingSlotIds
    conflictingItems {
      id
    }
    properties {
      ... on ItemPropertiesWeaponMod {
        ergonomics
        recoilModifier
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
      ... on ItemPropertiesBarrel {
        ergonomics
        recoilModifier
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
      ... on ItemPropertiesMagazine {
        ergonomics
        recoilModifier
        capacity
        ammoCheckModifier
        loadModifier
        malfunctionChance
      }
      ... on ItemPropertiesScope {
        ergonomics
        recoilModifier
        sightingRange
        sightModes
        zoomLevels
        slots {
          id
          name
          nameId
          required
          filters {
            allowedItems {
              id
            }
          }
        }
      }
    }
    imageLinkFallback
    inspectImageLink
    baseImageLink
    minLevelForFlea
    bsgCategory {
      id
      name
      normalizedName
      children {
        id
      }
    }
  }
}
`;

// --- IndexedDB Cache ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry) { resolve(null); return; }
        if (entry.version !== CACHE_VERSION) { resolve(null); return; }
        if (Date.now() - entry.timestamp > CACHE_TTL_MS) { resolve(null); return; }
        resolve(entry.data as T);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ timestamp: Date.now(), version: CACHE_VERSION, data }, key);
  } catch {
    // Silently fail on cache write errors
  }
}

// --- GraphQL Fetching ---

async function runQuery<T>(query: string, variables: Record<string, string>): Promise<T> {
  const cacheKey = `gql:${JSON.stringify({ query: query.slice(0, 50), variables })}`;
  const cached = await getCached<T>(cacheKey);
  if (cached) return cached;

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json.errors) throw new Error(JSON.stringify(json.errors));
      const data = json.data as T;
      await setCache(cacheKey, data);
      return data;
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawItem = Record<string, any>;

interface GunQueryResult { items: RawItem[] }
interface ModQueryResult { items: RawItem[] }

export async function fetchAllData(lang: string, gameMode: string): Promise<{ guns: RawItem[]; mods: RawItem[] }> {
  const [gunsData, modsData] = await Promise.all([
    runQuery<GunQueryResult>(GUNS_QUERY, { lang, gameMode }),
    runQuery<ModQueryResult>(MODS_QUERY, { lang, gameMode }),
  ]);
  return { guns: gunsData.items, mods: modsData.items };
}

// --- Data Extraction (ported from optimizer.py) ---

function hasValidPrice(item: RawItem): boolean {
  const buyFor = item.buyFor ?? [];
  for (const offer of buyFor) {
    if (typeof offer === 'object' && offer && (offer.priceRUB ?? 0) > 0) {
      return true;
    }
  }
  const bartersFor = item.bartersFor ?? [];
  if (Array.isArray(bartersFor) && bartersFor.length > 0) return true;
  // Include mods listed in API without buyFor when they have a BSG reference price (still not "purchasable")
  const ap = item.avg24hPrice;
  const bp = item.basePrice;
  if (typeof ap === 'number' && ap > 0) return true;
  if (typeof bp === 'number' && bp > 0) return true;
  return false;
}

function extractConflictingItems(item: RawItem): string[] {
  const conflicts = item.conflictingItems ?? [];
  if (!conflicts.length) return [];
  return conflicts
    .filter((c: unknown): c is { id: string } => typeof c === 'object' && c !== null && 'id' in c)
    .map((c: { id: string }) => c.id);
}

function extractSlots(itemData: RawItem): SlotInfo[] {
  const props = itemData.properties;
  if (!props?.slots) return [];
  return props.slots.map((slot: RawItem) => {
    const allowedIds: string[] = [];
    const filters = slot.filters;
    if (filters && typeof filters === 'object') {
      const allowedItems = filters.allowedItems ?? [];
      for (const item of allowedItems) {
        if (typeof item === 'object' && item) {
          allowedIds.push(item.id);
        } else if (typeof item === 'string') {
          allowedIds.push(item);
        }
      }
    }
    return {
      id: slot.id as string,
      name: slot.name as string,
      nameId: slot.nameId as string,
      required: slot.required ?? false,
      allowedItems: allowedIds,
    };
  });
}

function extractAllPresets(gun: RawItem, includeUnpurchasable = false): PresetInfo[] {
  const props = gun.properties ?? {};
  const presetsData = props.presets ?? [];
  if (!presetsData.length) return [];

  const presets: PresetInfo[] = [];
  for (const preset of presetsData) {
    if (typeof preset !== 'object' || !preset) continue;

    const presetItems: string[] = [];
    const containsItems = preset.containsItems ?? [];
    for (const contained of containsItems) {
      if (typeof contained === 'object' && contained?.item?.id) {
        presetItems.push(contained.item.id);
      }
    }

    const presetImage =
      preset.image512pxLink ?? preset.imageLink ??
      preset.image8xLink ?? preset.gridImageLink ??
      preset.baseImageLink ?? null;

    const buyFor = preset.buyFor ?? [];
    const offers: OfferInfo[] = [];
    for (const offer of buyFor) {
      if (typeof offer !== 'object' || !offer) continue;
      const price = offer.priceRUB ?? 0;
      if (price <= 0) continue;
      const source = offer.source ?? '';
      const vendor = offer.vendor ?? {};
      let traderLevel: number | null = null;
      if (source !== 'fleaMarket') {
        traderLevel = vendor.minTraderLevel ?? 1;
      }
      offers.push({
        price,
        source,
        vendor_name: vendor.name ?? '',
        vendor_normalized: vendor.normalizedName ?? '',
        trader_level: traderLevel,
      });
    }
    const bartersFor = preset.bartersFor ?? [];
    if (Array.isArray(bartersFor)) {
      offers.push(...extractBarterOffers(bartersFor));
    }
    offers.sort((a, b) => a.price - b.price);
    let lowestPrice = 0;
    let priceSource = 'not_available';
    if (offers.length) {
      lowestPrice = offers[0].price;
      priceSource = offers[0].source;
    }

    const purchasable = lowestPrice > 0;
    if (purchasable || includeUnpurchasable) {
      presets.push({
        id: preset.id ?? '',
        name: preset.name ?? preset.shortName ?? 'Unknown',
        items: presetItems,
        image: presetImage,
        price: lowestPrice,
        price_source: priceSource,
        offers,
        purchasable,
      });
    }
  }
  return presets;
}

function extractGunStats(gun: RawItem): GunStats {
  const props = gun.properties ?? {};
  const buyFor = gun.buyFor ?? [];
  let lowestPrice = 0;
  let priceSource = 'basePrice';

  if (buyFor.length) {
    const traderOffers = buyFor.filter(
      (offer: RawItem) => typeof offer === 'object' && offer?.source !== 'fleaMarket'
    );
    if (traderOffers.length) {
      const minOffer = traderOffers.reduce((min: RawItem, o: RawItem) =>
        (o.priceRUB ?? Infinity) < (min.priceRUB ?? Infinity) ? o : min
        , traderOffers[0]);
      lowestPrice = minOffer.priceRUB ?? 0;
      priceSource = minOffer.source ?? 'market';
    }
  }

  if (lowestPrice === 0) {
    // No direct trader offers for naked gun — mark as not purchasable.
    // Matches Python extract_gun_stats: naked gun is only purchasable via
    // direct trader offers; flea-only guns must use preset bases instead.
    lowestPrice = 999999999;
    priceSource = 'not_available';
  }

  const defaultPreset = props.defaultPreset ?? {};
  const defaultPresetImage =
    defaultPreset.image512pxLink ?? defaultPreset.imageLink ??
    defaultPreset.image8xLink ?? defaultPreset.gridImageLink ??
    defaultPreset.gridImageLinkFallback ?? defaultPreset.iconLink ??
    defaultPreset.iconLinkFallback ?? null;

  return {
    naked_ergonomics: props.ergonomics ?? 0,
    naked_recoil_v: props.recoilVertical ?? 0,
    naked_recoil_h: props.recoilHorizontal ?? 0,
    default_ergonomics: props.defaultErgonomics ?? 0,
    default_recoil_v: props.defaultRecoilVertical ?? 0,
    default_recoil_h: props.defaultRecoilHorizontal ?? 0,
    default_preset_image: defaultPresetImage,
    accuracy_modifier: gun.accuracyModifier ?? 0,
    fire_rate: props.fireRate ?? 0,
    fire_modes: props.fireModes ?? [],
    caliber: props.caliber ?? '',
    weight: gun.weight ?? 0,
    width: gun.width ?? 0,
    height: gun.height ?? 0,
    sighting_range: props.sightingRange ?? 0,
    category: gun.bsgCategory?.name ?? '',
    category_id: gun.bsgCategory?.id ?? '',
    camera_snap: props.cameraSnap ?? 0,
    center_of_impact: props.centerOfImpact ?? 0,
    deviation_max: props.deviationMax ?? 0,
    deviation_curve: props.deviationCurve ?? 0,
    recoil_angle: props.recoilAngle ?? 0,
    recoil_dispersion: props.recoilDispersion ?? 0,
    price: lowestPrice,
    price_source: priceSource,
  };
}

/** Convert bartersFor entries into OfferInfo with "barter:" source prefix. */
function extractBarterOffers(bartersFor: unknown[]): OfferInfo[] {
  const offers: OfferInfo[] = [];
  for (const barter of bartersFor) {
    if (typeof barter !== 'object' || !barter) continue;
    const b = barter as Record<string, unknown>;
    const trader = b.trader as Record<string, string> | undefined;
    if (!trader) continue;
    const level = typeof b.level === 'number' ? b.level : 1;
    const requiredItems = (b.requiredItems ?? []) as Array<{
      item?: { name?: string; avg24hPrice?: number | null; basePrice?: number | null };
      count?: number;
    }>;
    let totalCost = 0;
    const reqs: import('./types').BarterRequirement[] = [];
    for (const ri of requiredItems) {
      const count = ri.count ?? 1;
      const price = ri.item?.avg24hPrice ?? ri.item?.basePrice ?? 0;
      totalCost += count * price;
      reqs.push({ name: ri.item?.name ?? 'Unknown', count, unit_price: price });
    }
    if (totalCost <= 0) continue;
    offers.push({
      price: Math.round(totalCost),
      source: `barter:${trader.normalizedName ?? trader.name ?? 'unknown'}`,
      vendor_name: trader.name ?? '',
      vendor_normalized: trader.normalizedName ?? '',
      trader_level: level,
      barter_requirements: reqs,
    });
  }
  return offers;
}

function extractModStats(mod: RawItem): ModStats {
  const props = mod.properties ?? {};
  const ergo = mod.ergonomicsModifier ?? 0;
  const topRecoil = mod.recoilModifier ?? 0;
  const propsRecoil = props.recoilModifier ?? 0;

  let recoilMod: number;
  if (propsRecoil !== 0) {
    recoilMod = propsRecoil;
  } else if (topRecoil !== 0) {
    recoilMod = topRecoil / 100.0;
  } else {
    recoilMod = 0;
  }

  const buyFor = mod.buyFor ?? [];
  const offers: OfferInfo[] = [];
  let lowestPrice = 0;
  let priceSource = 'market';

  for (const offer of buyFor) {
    if (typeof offer !== 'object' || !offer) continue;
    const price = offer.priceRUB ?? 0;
    if (price <= 0) continue;
    const source = offer.source ?? '';
    const vendor = offer.vendor ?? {};
    let traderLevel: number | null = null;
    if (source === 'fleaMarket') {
      traderLevel = null;
    } else {
      traderLevel = vendor.minTraderLevel ?? 1;
    }
    offers.push({
      price,
      source,
      vendor_name: vendor.name ?? '',
      vendor_normalized: vendor.normalizedName ?? '',
      trader_level: traderLevel,
    });
  }
  const bartersFor = mod.bartersFor ?? [];
  if (Array.isArray(bartersFor)) {
    offers.push(...extractBarterOffers(bartersFor));
  }
  offers.sort((a, b) => a.price - b.price);
  const purchasable = offers.length > 0;
  if (purchasable) {
    lowestPrice = offers[0].price;
    priceSource = offers[0].source;
  } else {
    lowestPrice = 0;
    priceSource = 'not_purchasable';
  }

  const refAp = typeof mod.avg24hPrice === 'number' && mod.avg24hPrice > 0 ? mod.avg24hPrice : 0;
  const refBp = typeof mod.basePrice === 'number' && mod.basePrice > 0 ? mod.basePrice : 0;
  const referencePriceRub = refAp || refBp || undefined;

  return {
    ergonomics: ergo,
    recoil_modifier: recoilMod,
    accuracy_modifier: mod.accuracyModifier ?? 0,
    offers,
    purchasable,
    reference_price_rub: !purchasable ? referencePriceRub : undefined,
    price: lowestPrice,
    price_source: priceSource,
    weight: mod.weight ?? 0,
    width: mod.width ?? 0,
    height: mod.height ?? 0,
    min_level_flea: mod.minLevelForFlea ?? 0,
    capacity: props.capacity ?? 0,
    sighting_range: props.sightingRange ?? 0,
    category: mod.bsgCategory?.name ?? '',
    category_id: mod.bsgCategory?.id ?? '',
    category_normalized: mod.bsgCategory?.normalizedName ?? '',
    category_child_ids: (mod.bsgCategory?.children ?? [])
      .map((c: { id?: string }) => c.id)
      .filter((id: string | undefined): id is string => Boolean(id)),
  };
}

export function buildItemLookup(guns: RawItem[], mods: RawItem[]): ItemLookup {
  const lookup: ItemLookup = {};
  for (const gun of guns) {
    lookup[gun.id] = {
      type: 'gun',
      data: gun,
      slots: extractSlots(gun),
      stats: extractGunStats(gun),
      presets: extractAllPresets(gun),
      all_presets: extractAllPresets(gun, true),
    };
  }
  for (const mod of mods) {
    if (!hasValidPrice(mod)) continue;
    lookup[mod.id] = {
      type: 'mod',
      data: mod,
      slots: extractSlots(mod),
      stats: extractModStats(mod),
      conflicting_items: extractConflictingItems(mod),
      conflicting_slot_ids: mod.conflictingSlotIds ?? [],
    };
  }
  return lookup;
}

// --- Price Availability ---

export function getAvailablePrice(
  stats: {
    purchasable?: boolean;
    offers?: OfferInfo[];
    price?: number;
    price_source?: string;
    min_level_flea?: number;
  },
  traderLevels: TraderLevels = DEFAULT_TRADER_LEVELS,
  fleaAvailable = true,
  playerLevel: number | null = null,
  barterAvailable = false,
): [number, string | null, boolean, string | null] {
  if (stats.purchasable === false) {
    return [0, 'not_purchasable', false, null];
  }

  const minLevelFlea = stats.min_level_flea ?? 0;
  const offers = stats.offers;

  if (!offers || !offers.length) {
    const defaultPrice = stats.price ?? 0;
    if (defaultPrice > 0 && fleaAvailable) {
      if (playerLevel !== null && minLevelFlea > playerLevel) {
        return [0, null, false, null];
      }
      return [defaultPrice, stats.price_source ?? 'market', true, null];
    }
    return [0, null, false, null];
  }

  let bestPrice: number | null = null;
  let bestSource: string | null = null;
  let bestLabel: string | null = null;

  for (const offer of offers) {
    const price = offer.price;
    const source = offer.source;
    // Skip barter offers when barter toggle is off
    if (!barterAvailable && source.startsWith('barter:')) continue;
    const requiredLevel = offer.trader_level;
    const vendor = (offer.vendor_normalized ?? '').toLowerCase();

    if (source === 'fleaMarket') {
      if (!fleaAvailable) continue;
      if (playerLevel !== null && minLevelFlea > playerLevel) continue;
    } else {
      const traderLevel = traderLevels[vendor] ?? 4;
      if (requiredLevel !== null && requiredLevel > traderLevel) continue;
    }

    if (bestPrice === null || price < bestPrice) {
      bestPrice = price;
      bestSource = source;
      bestLabel =
        source === 'fleaMarket'
          ? 'Flea Market'
          : (offer.vendor_name || offer.vendor_normalized || source);
    }
  }

  if (bestPrice !== null) {
    return [bestPrice, bestSource, true, bestLabel];
  }
  return [0, null, false, null];
}

// --- State Cache ---

interface LoadedState {
  guns: RawItem[];
  mods: RawItem[];
  itemLookup: ItemLookup;
  loadedAt: number;
}

const VALID_LANGS = new Set(['en', 'ru', 'zh', 'es', 'de', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'tr', 'cs', 'hu', 'ro', 'sk']);

/** Normalize "en-US" → "en", "zh-CN" → "zh", etc. */
function normalizeLang(lang: string): string {
  if (VALID_LANGS.has(lang)) return lang;
  const base = lang.split('-')[0].toLowerCase();
  if (VALID_LANGS.has(base)) return base;
  return 'en';
}

const stateCache = new Map<string, LoadedState>();

export async function ensureDataLoaded(lang: string, gameMode: string): Promise<LoadedState> {
  lang = normalizeLang(lang);
  const key = `${lang}:${gameMode}`;
  const existing = stateCache.get(key);
  if (existing && Date.now() - existing.loadedAt < CACHE_TTL_MS) {
    return existing;
  }

  const { guns, mods } = await fetchAllData(lang, gameMode);
  const itemLookup = buildItemLookup(guns, mods);
  const state: LoadedState = { guns, mods, itemLookup, loadedAt: Date.now() };
  stateCache.set(key, state);
  return state;
}

export function getLoadedState(lang: string, gameMode: string): LoadedState | undefined {
  return stateCache.get(`${lang}:${gameMode}`);
}
