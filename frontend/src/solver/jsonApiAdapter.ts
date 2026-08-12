/**
 * Adapter for the tarkov.dev **JSON API** (https://json.tarkov.dev).
 *
 * Why this exists: `api.tarkov.dev/graphql` has been answering every request
 * with HTTP 422 `{"errors":["GraphQL server unavailable. Try again later."]}`
 * since 2026-07-21 (upstream issue the-hideout/tarkov-api#474). tarkov.dev's
 * own site does not use GraphQL — it reads the JSON API (see their
 * `src/modules/api-request.mjs`), which is healthy.
 *
 * This module reshapes JSON API documents into the exact shape the GraphQL
 * queries in `dataService.ts` returned, so every downstream extractor
 * (`extractSlots`, `extractGunStats`, `extractModStats`, `extractAllPresets`,
 * `buildItemLookup`) keeps working untouched.
 *
 * Shape differences handled here:
 *  - **Translations**: `name` / `shortName` / slot `name` / category `name` are
 *    translation *keys* (e.g. `"<id> Name"`, `"MOD_MUZZLE"`). Real strings live
 *    in a sibling `<path>_<lang>` document; resolution is
 *    primary lang -> English -> the key itself.
 *  - **`buyFor`** does not exist. Trader offers come from `buyFromTrader`, and
 *    the flea-market offer is synthesized exactly as tarkov-api's items
 *    datasource `postLoad` does: skipped for `noFlea` items or when there is no
 *    `lastLowPrice`, priced `avg24hPrice || lastLowPrice`, `source: 'fleaMarket'`.
 *  - **`bartersFor`** does not exist. Barters are a separate document, indexed
 *    here by the item they offer; GraphQL's `level` is `minTraderLevel`.
 *  - **`bsgCategory`** does not exist. `categories[0]` is the item's own
 *    category and the array is exactly its parent chain (verified across all
 *    5312 items), so the chain is rebuilt into nested `parent` objects.
 *  - **`handbookCategories`** are IDs into a sibling document and their names
 *    are translation keys; rebuilt here as `[{ name }]`, most specific first.
 *  - **Presets / `defaultPreset`** are item IDs; dereferenced here into objects.
 *  - **IDs vs objects**: `containsItems[].item` and `conflictingItems[]` are
 *    plain ID strings and are wrapped back into `{ id }` / `{ item: { id } }`.
 *  - **`imageLink`** is GraphQL's deprecated alias for `inspectImageLink`
 *    (per the schema), not `gridImageLink`.
 */

const JSON_API_URL = 'https://json.tarkov.dev';
const LANG_FALLBACK = 'en';
const SUPPORTED_GAME_MODES = new Set(['regular', 'pve', 'pvp-season']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawItem = Record<string, any>;
type TranslationMap = Record<string, string>;

interface JsonEnvelope<T> {
  data: T;
  translations?: string[];
}

interface JsonItemsData {
  items: Record<string, RawItem>;
  itemCategories?: Record<string, RawItem>;
  handbookCategories?: Record<string, RawItem>;
  fleaMarket?: RawItem;
}

interface JsonBarter {
  trader?: string;
  minTraderLevel?: number;
  requiredItems?: Array<{ item?: string; count?: number }>;
  offeredItem?: { item?: string; count?: number };
}

/** Fetch one JSON API document, retrying transient failures like `runQuery` does. */
async function fetchDoc<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${JSON_API_URL}/${path}`, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);
      const json = (await resp.json()) as JsonEnvelope<T>;
      if (!json || json.data === undefined) throw new Error(`Malformed response for ${path}`);
      return json.data;
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

/**
 * Fetch guns and mods from the JSON API, shaped like the GraphQL responses.
 * `lang` must already be normalized to a bare 2-letter code.
 */
export async function fetchAllDataFromJsonApi(
  lang: string,
  gameMode: string,
): Promise<{ guns: RawItem[]; mods: RawItem[] }> {
  const mode = SUPPORTED_GAME_MODES.has(gameMode) ? gameMode : 'regular';
  const needsPrimaryLang = lang !== LANG_FALLBACK;

  // English is always fetched: it is the fallback for keys a locale is missing.
  const [
    itemsData,
    itemsLangPrimary,
    itemsLangFallback,
    barters,
    tradersData,
    tradersLangPrimary,
    tradersLangFallback,
  ] = await Promise.all([
    fetchDoc<JsonItemsData>(`${mode}/items`),
    needsPrimaryLang
      ? fetchDoc<TranslationMap>(`${mode}/items_${lang}`).catch(() => ({}) as TranslationMap)
      : Promise.resolve({} as TranslationMap),
    fetchDoc<TranslationMap>(`${mode}/items_${LANG_FALLBACK}`),
    fetchDoc<JsonBarter[]>(`${mode}/barters`),
    fetchDoc<Record<string, RawItem>>(`${mode}/traders`),
    needsPrimaryLang
      ? fetchDoc<TranslationMap>(`${mode}/traders_${lang}`).catch(() => ({}) as TranslationMap)
      : Promise.resolve({} as TranslationMap),
    fetchDoc<TranslationMap>(`${mode}/traders_${LANG_FALLBACK}`),
  ]);

  const items = itemsData.items ?? {};
  const categoriesRaw = itemsData.itemCategories ?? {};
  const handbookRaw = itemsData.handbookCategories ?? {};

  /** Resolve a translation key: requested language, then English, then the key. */
  const tr = (key: unknown): string => {
    if (typeof key !== 'string') return '';
    return itemsLangPrimary[key] ?? itemsLangFallback[key] ?? key;
  };
  const trTrader = (key: unknown): string => {
    if (typeof key !== 'string') return '';
    return tradersLangPrimary[key] ?? tradersLangFallback[key] ?? key;
  };

  // --- Traders: id -> GraphQL-ish { name, normalizedName } ---
  const traders: Record<string, { name: string; normalizedName: string }> = {};
  for (const [id, trader] of Object.entries(tradersData ?? {})) {
    traders[id] = {
      name: trTrader(trader.name),
      normalizedName: trader.normalizedName ?? '',
    };
  }
  const traderOf = (id: unknown) =>
    (typeof id === 'string' ? traders[id] : undefined) ?? { name: '', normalizedName: '' };

  // --- Flea market vendor, mirroring GraphQL's FleaMarket vendor object ---
  const fleaRaw = itemsData.fleaMarket ?? {};
  const fleaVendor = {
    name: tr(fleaRaw.name),
    normalizedName: fleaRaw.normalizedName ?? 'flea-market',
    foundInRaidRequired: fleaRaw.foundInRaidRequired ?? false,
    enabled: fleaRaw.enabled ?? true,
  };

  // --- Categories: rebuild the nested parent chain, memoized ---
  const categoryCache = new Map<string, RawItem | null>();
  const buildCategory = (id: unknown): RawItem | null => {
    if (typeof id !== 'string') return null;
    const cached = categoryCache.get(id);
    if (cached !== undefined) return cached;
    const raw = categoriesRaw[id];
    if (!raw) {
      categoryCache.set(id, null);
      return null;
    }
    const node: RawItem = {
      id: raw.id ?? id,
      name: tr(raw.name),
      normalizedName: raw.normalizedName ?? '',
      children: (raw.children ?? []).map((childId: string) => ({ id: childId })),
      parent: null,
    };
    // Cache before recursing so a malformed cyclic chain cannot hang the walk.
    categoryCache.set(id, node);
    node.parent = raw.parent ? buildCategory(raw.parent) : null;
    return node;
  };

  /**
   * `handbookCategories` on an item is a list of IDs, most specific first, and
   * each entry's `name` is a translation key. The extractors only read `.name`.
   */
  const buildHandbookCategories = (ids: unknown): Array<{ name: string }> => {
    if (!Array.isArray(ids)) return [];
    const out: Array<{ name: string }> = [];
    for (const id of ids) {
      const raw = typeof id === 'string' ? handbookRaw[id] : undefined;
      if (raw) out.push({ name: tr(raw.name) });
    }
    return out;
  };

  // --- Barters indexed by the item they offer ---
  const bartersByItem = new Map<string, JsonBarter[]>();
  for (const barter of barters ?? []) {
    const offeredId = barter.offeredItem?.item;
    if (!offeredId) continue;
    const list = bartersByItem.get(offeredId);
    if (list) list.push(barter);
    else bartersByItem.set(offeredId, [barter]);
  }

  const buildBartersFor = (itemId: unknown): RawItem[] => {
    if (typeof itemId !== 'string') return [];
    const list = bartersByItem.get(itemId);
    if (!list) return [];
    return list.map(barter => ({
      trader: traderOf(barter.trader),
      level: barter.minTraderLevel ?? 1,
      requiredItems: (barter.requiredItems ?? []).map(req => {
        const source = (typeof req.item === 'string' ? items[req.item] : undefined) ?? {};
        return {
          item: {
            id: req.item ?? '',
            name: tr(source.name),
            avg24hPrice: source.avg24hPrice ?? null,
            basePrice: source.basePrice ?? null,
            iconLink: source.iconLink ?? '',
          },
          count: req.count ?? 1,
        };
      }),
    }));
  };

  /**
   * Rebuild GraphQL's `buyFor`: trader offers plus the synthesized flea offer.
   * Mirrors tarkov-api `datasources/items.mjs` postLoad so prices and the
   * `fleaMarket` source value match what the GraphQL API served.
   */
  const buildBuyFor = (raw: RawItem): RawItem[] => {
    const offers: RawItem[] = [];
    for (const offer of raw.buyFromTrader ?? []) {
      const trader = traderOf(offer.trader);
      offers.push({
        currency: offer.currency ?? 'RUB',
        price: offer.price ?? 0,
        priceRUB: offer.priceRUB ?? 0,
        source: trader.normalizedName,
        vendor: {
          name: trader.name,
          normalizedName: trader.normalizedName,
          minTraderLevel: offer.minTraderLevel ?? 1,
          buyLimit: offer.buyLimit ?? 0,
        },
      });
    }
    if (!(raw.types ?? []).includes('noFlea') && raw.lastLowPrice) {
      const price = raw.avg24hPrice || raw.lastLowPrice || 0;
      offers.push({
        currency: 'RUB',
        price,
        priceRUB: price,
        source: 'fleaMarket',
        vendor: fleaVendor,
      });
    }
    return offers;
  };

  /** Image links, including the deprecated aliases the queries still request. */
  const imageLinks = (raw: RawItem) => ({
    iconLink: raw.iconLink ?? null,
    iconLinkFallback: raw.iconLink ?? null,
    gridImageLink: raw.gridImageLink ?? null,
    gridImageLinkFallback: raw.gridImageLink ?? null,
    baseImageLink: raw.baseImageLink ?? null,
    inspectImageLink: raw.inspectImageLink ?? null,
    imageLink: raw.inspectImageLink ?? null,
    imageLinkFallback: raw.inspectImageLink ?? null,
    image512pxLink: raw.image512pxLink ?? null,
    image8xLink: raw.image8xLink ?? null,
  });

  // --- Presets: dereference IDs into objects, memoized ---
  const presetCache = new Map<string, RawItem | null>();
  const buildPreset = (id: unknown): RawItem | null => {
    if (typeof id !== 'string') return null;
    const cached = presetCache.get(id);
    if (cached !== undefined) return cached;
    const raw = items[id];
    if (!raw) {
      presetCache.set(id, null);
      return null;
    }
    const preset: RawItem = {
      id: raw.id ?? id,
      name: tr(raw.name),
      shortName: tr(raw.shortName),
      ...imageLinks(raw),
      containsItems: (raw.containsItems ?? []).map((contained: RawItem) => ({
        item: { id: contained.item ?? '' },
        count: contained.count ?? 1,
      })),
      buyFor: buildBuyFor(raw),
      bartersFor: buildBartersFor(raw.id ?? id),
    };
    presetCache.set(id, preset);
    return preset;
  };

  /** Translate slot names and dereference preset IDs inside `properties`. */
  const convertProperties = (props: RawItem | undefined | null): RawItem | null => {
    if (!props) return null;
    const out: RawItem = { ...props };
    if (Array.isArray(props.slots)) {
      out.slots = props.slots.map((slot: RawItem) => ({
        id: slot.id,
        name: tr(slot.name),
        nameId: slot.nameId ?? '',
        required: slot.required ?? false,
        filters: { allowedItems: slot.filters?.allowedItems ?? [] },
      }));
    }
    if (Array.isArray(props.presets)) {
      out.presets = props.presets
        .map((presetId: unknown) => buildPreset(presetId))
        .filter((preset: RawItem | null): preset is RawItem => preset !== null);
    }
    if (props.defaultPreset !== undefined) {
      out.defaultPreset = buildPreset(props.defaultPreset);
    }
    return out;
  };

  const convertItem = (raw: RawItem): RawItem => ({
    id: raw.id,
    name: tr(raw.name),
    shortName: tr(raw.shortName),
    normalizedName: raw.normalizedName ?? '',
    basePrice: raw.basePrice ?? 0,
    avg24hPrice: raw.avg24hPrice ?? null,
    weight: raw.weight ?? 0,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    minLevelForFlea: raw.minLevelForFlea ?? 0,
    accuracyModifier: raw.accuracyModifier ?? 0,
    ergonomicsModifier: raw.ergonomicsModifier ?? 0,
    recoilModifier: raw.recoilModifier ?? 0,
    conflictingSlotIds: raw.conflictingSlotIds ?? [],
    conflictingItems: (raw.conflictingItems ?? []).map((conflictId: string) => ({ id: conflictId })),
    ...imageLinks(raw),
    bsgCategory: buildCategory((raw.categories ?? [])[0]),
    handbookCategories: buildHandbookCategories(raw.handbookCategories),
    buyFor: buildBuyFor(raw),
    bartersFor: buildBartersFor(raw.id),
    properties: convertProperties(raw.properties),
  });

  // GraphQL fetched `types: gun` and `types: mods` as two independent queries,
  // so an item carrying both types would appear in both lists.
  const guns: RawItem[] = [];
  const mods: RawItem[] = [];
  for (const raw of Object.values(items)) {
    const types = raw.types ?? [];
    if (types.includes('gun')) guns.push(convertItem(raw));
    if (types.includes('mods')) mods.push(convertItem(raw));
  }

  if (!guns.length || !mods.length) {
    throw new Error(
      `JSON API returned no ${!guns.length ? 'guns' : 'mods'} for ${mode} (items: ${Object.keys(items).length})`,
    );
  }

  return { guns, mods };
}
