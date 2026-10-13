// Independent reader for raw tarkov.dev JSON API documents (ADR 0010 §1/§5, ADR 0013 §3).
//
// This file imports NOTHING from production code and shares no normalization with the
// production adapter or extractors. It parses the documents the adapter consumes
// (`items`, `items_<lang>`, `barters`, `traders`, `traders_<lang>`) into minimal reference
// structures that a later stage can map into the oracle's reference domain schema.
//
// Source rules enforced here (ADR 0013 §4A, ADR 0010 §5):
//  * `containsItems[].count` must be a finite nonnegative integer. Absent, null, fractional,
//    negative, non-numeric or overflowing counts are SourceErrors: there is NO `?? 1` default.
//  * Barter ingredient counts must be finite nonnegative numbers. The pinned capture has
//    genuinely fractional counts (e.g. 155.1), so integrality is not a barter rule.
//  * Weights keep the raw JSON number AND its exact source token, so a later stage can decode
//    the binary64 value exactly and detect any decimal that binary64 cannot carry.
//  * Repeated `containsItems` entries stay separate; summing is the caller's explicit choice.
//  * Malformed input throws SourceError. Unresolved references are NOT thrown here: they are
//    an evidence finding reported by sourceChecks.ts (ADR 0013 §3: an input/evidence failure,
//    never infeasibility).

export class SourceError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'SourceError';
    this.path = path;
  }
}

/** A raw JSON number together with its exact source token. */
export interface ExactNumber {
  readonly value: number;
  readonly text: string;
}

export interface RefComponent { readonly itemId: string; readonly count: number }

export interface RefSlot {
  readonly id: string;
  readonly nameKey: string;
  readonly nameId: string;
  readonly required: boolean;
  readonly allowedItemIds: readonly string[];
  readonly allowedCategoryIds: readonly string[];
  readonly excludedItemIds: readonly string[];
  readonly excludedCategoryIds: readonly string[];
}

export interface RefTraderOffer {
  readonly traderId: string;
  readonly currency: string | null;
  readonly price: number | null;
  readonly priceRUB: number | null;
  readonly minTraderLevel: number | null;
  readonly buyLimit: number | null;
  readonly taskUnlock: string | null;
}

export interface RefItem {
  readonly id: string;
  readonly nameKey: string;
  readonly shortNameKey: string;
  readonly normalizedName: string;
  readonly types: readonly string[];
  readonly noFlea: boolean;
  readonly weight: ExactNumber | null;
  readonly basePrice: number | null;
  readonly avg24hPrice: number | null;
  readonly lastLowPrice: number | null;
  readonly minLevelForFlea: number | null;
  readonly accuracyModifier: number | null;
  readonly ergonomicsModifier: number | null;
  readonly recoilModifier: number | null;
  /** Raw `categories`: the item's own category first, then its parent chain. */
  readonly categoryIds: readonly string[];
  readonly handbookCategoryIds: readonly string[];
  readonly conflictingItemIds: readonly string[];
  readonly conflictingSlotIds: readonly string[];
  readonly slots: readonly RefSlot[];
  readonly presetIds: readonly string[];
  readonly defaultPresetId: string | null;
  /** Raw `containsItems`, one entry per raw entry, counts validated. */
  readonly components: readonly RefComponent[];
  readonly buyFromTrader: readonly RefTraderOffer[];
  readonly propertiesType: string | null;
  /** The raw `properties` object (or null) for later mapping of stats such as ergonomics. */
  readonly properties: Readonly<Record<string, unknown>> | null;
}

export interface RefCategory {
  readonly id: string;
  readonly nameKey: string;
  readonly normalizedName: string | null;
  /** null for a root. The source marks a root with `null` or the empty string. */
  readonly parentId: string | null;
  /** True when the source spelled "no parent" as the empty string (observed on a root category). */
  readonly parentWasEmptyString: boolean;
  readonly childIds: readonly string[];
}

export interface RefTrader { readonly id: string; readonly nameKey: string; readonly normalizedName: string }

export interface RefBarterRequirement { readonly itemId: string; readonly count: number }

export interface RefBarter {
  readonly id: string;
  readonly traderId: string;
  readonly minTraderLevel: number | null;
  readonly taskUnlock: string | null;
  readonly requirements: readonly RefBarterRequirement[];
  readonly offered: { readonly itemId: string; readonly count: number };
}

export interface RefFleaMarket {
  readonly nameKey: string;
  readonly normalizedName: string | null;
  readonly foundInRaidRequired: boolean | null;
  readonly enabled: boolean | null;
}

export interface RawWorld {
  readonly lang: string;
  readonly items: ReadonlyMap<string, RefItem>;
  readonly categories: ReadonlyMap<string, RefCategory>;
  readonly handbookCategories: ReadonlyMap<string, RefCategory>;
  readonly traders: ReadonlyMap<string, RefTrader>;
  readonly barters: readonly RefBarter[];
  readonly fleaMarket: RefFleaMarket | null;
  /** requested language -> English -> the key itself. */
  translateItemKey(key: string): string;
  translateTraderKey(key: string): string;
}

export interface RawTexts {
  items: string;
  itemsEn: string;
  barters: string;
  traders: string;
  tradersEn: string;
  /** Required iff the requested language is not English. */
  itemsLang?: string;
  tradersLang?: string;
}

export interface RawDocuments {
  readonly itemsData: Record<string, unknown>;
  /** Holder object -> exact source token of its numeric `weight`. */
  readonly weightSources: WeakMap<object, string>;
  readonly itemsEn: ReadonlyMap<string, string>;
  readonly itemsLang: ReadonlyMap<string, string> | null;
  readonly barters: unknown[];
  readonly tradersData: Record<string, unknown>;
  readonly tradersEn: ReadonlyMap<string, string>;
  readonly tradersLang: ReadonlyMap<string, string> | null;
}

// ---------------------------------------------------------------------------------------
// Field accessors. Each throws SourceError with the document path of the offending value.
// ---------------------------------------------------------------------------------------

function fail(path: string, message: string): never {
  throw new SourceError(path, message);
}

function rec(value: unknown, path: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return fail(path, 'expected an object');
}

function arr(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  return fail(path, 'expected an array');
}

function str(value: unknown, path: string): string {
  if (typeof value === 'string') return value;
  return fail(path, 'expected a string');
}

function optStr(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return str(value, path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value === 'boolean') return value;
  return fail(path, 'expected a boolean');
}

function optBool(value: unknown, path: string): boolean | null {
  if (value === undefined || value === null) return null;
  return bool(value, path);
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number') return fail(path, 'expected a number');
  if (!Number.isFinite(value)) return fail(path, 'expected a finite number');
  return value;
}

function optNum(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  return num(value, path);
}

function strArr(value: unknown, path: string): string[] {
  return arr(value, path).map((entry, index) => str(entry, `${path}[${index}]`));
}

/** `containsItems[].count`: a finite nonnegative integer, never defaulted (ADR 0013 §4A). */
function componentCount(value: unknown, path: string): number {
  if (value === undefined) return fail(path, 'count is absent (a source error; no default is adopted)');
  if (value === null) return fail(path, 'count is null (a source error; no default is adopted)');
  if (typeof value !== 'number') return fail(path, `count must be a number, got ${typeof value}`);
  if (!Number.isFinite(value)) return fail(path, 'count must be finite');
  if (!Number.isInteger(value)) return fail(path, `count must be an integer, got ${value}`);
  if (value < 0) return fail(path, `count must not be negative, got ${value}`);
  return value;
}

/** Barter ingredient/offer counts: finite nonnegative numbers (fractional counts occur in source). */
function barterCount(value: unknown, path: string): number {
  if (value === undefined || value === null) return fail(path, 'count is absent or null (a source error; no default is adopted)');
  const count = num(value, path);
  if (count < 0) return fail(path, `count must not be negative, got ${count}`);
  return count;
}

// ---------------------------------------------------------------------------------------
// Document parsing
// ---------------------------------------------------------------------------------------

interface ReviverContext { source?: string }

function parseEnvelope(text: string, path: string): { data: unknown; weightSources: WeakMap<object, string> } {
  const weightSources = new WeakMap<object, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, function (this: object, key: string, value: unknown, context?: ReviverContext) {
      if (key === 'weight' && typeof value === 'number') {
        if (context?.source === undefined) {
          throw new SourceError(path, 'this runtime does not expose JSON source text (needs Node >= 21 / V8 11.4)');
        }
        weightSources.set(this, context.source);
      }
      return value;
    });
  } catch (error) {
    if (error instanceof SourceError) throw error;
    return fail(path, `not valid JSON (${(error as Error).message})`);
  }
  const envelope = rec(parsed, path);
  if (envelope.data === undefined) return fail(path, 'envelope has no `data` member');
  return { data: envelope.data, weightSources };
}

function parseTranslations(text: string, path: string): ReadonlyMap<string, string> {
  const data = rec(parseEnvelope(text, path).data, `${path}.data`);
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) map.set(key, str(value, `${path}.data[${JSON.stringify(key)}]`));
  return map;
}

/** Parse every document into plain JSON, keeping exact weight tokens. No interpretation yet. */
export function parseRawDocuments(texts: RawTexts, lang: string = 'en'): RawDocuments {
  const items = parseEnvelope(texts.items, 'items');
  const needsLang = lang !== 'en';
  if (needsLang && (texts.itemsLang === undefined || texts.tradersLang === undefined)) {
    fail('items_' + lang, `language "${lang}" requested but its translation documents were not supplied`);
  }
  return {
    itemsData: rec(items.data, 'items.data'),
    weightSources: items.weightSources,
    itemsEn: parseTranslations(texts.itemsEn, 'items_en'),
    itemsLang: needsLang ? parseTranslations(texts.itemsLang as string, `items_${lang}`) : null,
    barters: arr(parseEnvelope(texts.barters, 'barters').data, 'barters.data'),
    tradersData: rec(parseEnvelope(texts.traders, 'traders').data, 'traders.data'),
    tradersEn: parseTranslations(texts.tradersEn, 'traders_en'),
    tradersLang: needsLang ? parseTranslations(texts.tradersLang as string, `traders_${lang}`) : null,
  };
}

// ---------------------------------------------------------------------------------------
// Interpretation into reference structures
// ---------------------------------------------------------------------------------------

function readSlot(raw: unknown, path: string): RefSlot {
  const slot = rec(raw, path);
  const filters = rec(slot.filters, `${path}.filters`);
  return {
    id: str(slot.id, `${path}.id`),
    nameKey: str(slot.name, `${path}.name`),
    nameId: str(slot.nameId, `${path}.nameId`),
    required: bool(slot.required, `${path}.required`),
    allowedItemIds: strArr(filters.allowedItems, `${path}.filters.allowedItems`),
    allowedCategoryIds: strArr(filters.allowedCategories, `${path}.filters.allowedCategories`),
    excludedItemIds: strArr(filters.excludedItems, `${path}.filters.excludedItems`),
    excludedCategoryIds: strArr(filters.excludedCategories, `${path}.filters.excludedCategories`),
  };
}

function readTraderOffer(raw: unknown, path: string): RefTraderOffer {
  const offer = rec(raw, path);
  return {
    traderId: str(offer.trader, `${path}.trader`),
    currency: optStr(offer.currency, `${path}.currency`),
    price: optNum(offer.price, `${path}.price`),
    priceRUB: optNum(offer.priceRUB, `${path}.priceRUB`),
    minTraderLevel: optNum(offer.minTraderLevel, `${path}.minTraderLevel`),
    buyLimit: optNum(offer.buyLimit, `${path}.buyLimit`),
    taskUnlock: optStr(offer.taskUnlock, `${path}.taskUnlock`),
  };
}

function readWeight(raw: Record<string, unknown>, sources: WeakMap<object, string>, path: string): ExactNumber | null {
  if (raw.weight === undefined || raw.weight === null) return null;
  const value = num(raw.weight, `${path}.weight`);
  const text = sources.get(raw);
  if (text === undefined) return fail(`${path}.weight`, 'exact source token was not captured');
  return { value, text };
}

function readItem(key: string, raw: unknown, sources: WeakMap<object, string>): RefItem {
  const path = `items.data.items[${JSON.stringify(key)}]`;
  const item = rec(raw, path);
  const id = str(item.id, `${path}.id`);
  if (id !== key) fail(`${path}.id`, `item id "${id}" differs from its map key "${key}"`);

  const types = strArr(item.types, `${path}.types`);
  const propertiesRaw = item.properties === undefined || item.properties === null ? null : rec(item.properties, `${path}.properties`);

  let slots: RefSlot[] = [];
  let presetIds: string[] = [];
  let defaultPresetId: string | null = null;
  if (propertiesRaw) {
    if (propertiesRaw.slots !== undefined && propertiesRaw.slots !== null) {
      slots = arr(propertiesRaw.slots, `${path}.properties.slots`).map((slot, i) => readSlot(slot, `${path}.properties.slots[${i}]`));
    }
    if (propertiesRaw.presets !== undefined && propertiesRaw.presets !== null) {
      presetIds = strArr(propertiesRaw.presets, `${path}.properties.presets`);
    }
    defaultPresetId = optStr(propertiesRaw.defaultPreset, `${path}.properties.defaultPreset`);
  }

  const components = arr(item.containsItems, `${path}.containsItems`).map((entry, i): RefComponent => {
    const entryPath = `${path}.containsItems[${i}]`;
    const component = rec(entry, entryPath);
    return {
      itemId: str(component.item, `${entryPath}.item`),
      count: componentCount(component.count, `${entryPath}.count`),
    };
  });

  return {
    id,
    nameKey: str(item.name, `${path}.name`),
    shortNameKey: str(item.shortName, `${path}.shortName`),
    normalizedName: str(item.normalizedName, `${path}.normalizedName`),
    types,
    noFlea: types.includes('noFlea'),
    weight: readWeight(item, sources, path),
    basePrice: optNum(item.basePrice, `${path}.basePrice`),
    avg24hPrice: optNum(item.avg24hPrice, `${path}.avg24hPrice`),
    lastLowPrice: optNum(item.lastLowPrice, `${path}.lastLowPrice`),
    minLevelForFlea: optNum(item.minLevelForFlea, `${path}.minLevelForFlea`),
    accuracyModifier: optNum(item.accuracyModifier, `${path}.accuracyModifier`),
    ergonomicsModifier: optNum(item.ergonomicsModifier, `${path}.ergonomicsModifier`),
    recoilModifier: optNum(item.recoilModifier, `${path}.recoilModifier`),
    categoryIds: strArr(item.categories, `${path}.categories`),
    handbookCategoryIds: strArr(item.handbookCategories, `${path}.handbookCategories`),
    conflictingItemIds: strArr(item.conflictingItems, `${path}.conflictingItems`),
    conflictingSlotIds: strArr(item.conflictingSlotIds, `${path}.conflictingSlotIds`),
    slots,
    presetIds,
    defaultPresetId,
    components,
    buyFromTrader: arr(item.buyFromTrader, `${path}.buyFromTrader`).map((offer, i) =>
      readTraderOffer(offer, `${path}.buyFromTrader[${i}]`)),
    propertiesType: propertiesRaw ? optStr(propertiesRaw.propertiesType, `${path}.properties.propertiesType`) : null,
    properties: propertiesRaw,
  };
}

function readCategoryMap(raw: unknown, path: string): ReadonlyMap<string, RefCategory> {
  const out = new Map<string, RefCategory>();
  for (const [key, value] of Object.entries(rec(raw ?? {}, path))) {
    const entryPath = `${path}[${JSON.stringify(key)}]`;
    const category = rec(value, entryPath);
    const id = str(category.id, `${entryPath}.id`);
    if (id !== key) fail(`${entryPath}.id`, `category id "${id}" differs from its map key "${key}"`);
    const parentId = optStr(category.parent, `${entryPath}.parent`);
    out.set(id, {
      id,
      nameKey: str(category.name, `${entryPath}.name`),
      normalizedName: optStr(category.normalizedName, `${entryPath}.normalizedName`),
      parentId: parentId === '' ? null : parentId,
      parentWasEmptyString: parentId === '',
      childIds: category.children === undefined || category.children === null
        ? []
        : strArr(category.children, `${entryPath}.children`),
    });
  }
  return out;
}

function readBarter(raw: unknown, index: number): RefBarter {
  const path = `barters.data[${index}]`;
  const barter = rec(raw, path);
  const offered = rec(barter.offeredItem, `${path}.offeredItem`);
  return {
    id: str(barter.id, `${path}.id`),
    traderId: str(barter.trader, `${path}.trader`),
    minTraderLevel: optNum(barter.minTraderLevel, `${path}.minTraderLevel`),
    taskUnlock: optStr(barter.taskUnlock, `${path}.taskUnlock`),
    requirements: arr(barter.requiredItems, `${path}.requiredItems`).map((entry, i) => {
      const entryPath = `${path}.requiredItems[${i}]`;
      const requirement = rec(entry, entryPath);
      return {
        itemId: str(requirement.item, `${entryPath}.item`),
        count: barterCount(requirement.count, `${entryPath}.count`),
      };
    }),
    offered: {
      itemId: str(offered.item, `${path}.offeredItem.item`),
      count: barterCount(offered.count, `${path}.offeredItem.count`),
    },
  };
}

/** Interpret already-parsed documents as a reference world. */
export function buildWorld(docs: RawDocuments, lang: string = 'en'): RawWorld {
  const itemsRaw = rec(docs.itemsData.items, 'items.data.items');
  const items = new Map<string, RefItem>();
  for (const [key, raw] of Object.entries(itemsRaw)) items.set(key, readItem(key, raw, docs.weightSources));

  const traders = new Map<string, RefTrader>();
  for (const [key, raw] of Object.entries(docs.tradersData)) {
    const path = `traders.data[${JSON.stringify(key)}]`;
    const trader = rec(raw, path);
    const id = str(trader.id, `${path}.id`);
    if (id !== key) fail(`${path}.id`, `trader id "${id}" differs from its map key "${key}"`);
    traders.set(id, {
      id,
      nameKey: str(trader.name, `${path}.name`),
      normalizedName: str(trader.normalizedName, `${path}.normalizedName`),
    });
  }

  const fleaRaw = docs.itemsData.fleaMarket;
  const fleaMarket: RefFleaMarket | null = fleaRaw === undefined || fleaRaw === null
    ? null
    : {
        nameKey: str(rec(fleaRaw, 'items.data.fleaMarket').name, 'items.data.fleaMarket.name'),
        normalizedName: optStr(rec(fleaRaw, 'items.data.fleaMarket').normalizedName, 'items.data.fleaMarket.normalizedName'),
        foundInRaidRequired: optBool(rec(fleaRaw, 'items.data.fleaMarket').foundInRaidRequired, 'items.data.fleaMarket.foundInRaidRequired'),
        enabled: optBool(rec(fleaRaw, 'items.data.fleaMarket').enabled, 'items.data.fleaMarket.enabled'),
      };

  const lookup = (primary: ReadonlyMap<string, string> | null, english: ReadonlyMap<string, string>, key: string): string =>
    primary?.get(key) ?? english.get(key) ?? key;

  return {
    lang,
    items,
    categories: readCategoryMap(docs.itemsData.itemCategories, 'items.data.itemCategories'),
    handbookCategories: readCategoryMap(docs.itemsData.handbookCategories, 'items.data.handbookCategories'),
    traders,
    barters: docs.barters.map((raw, index) => readBarter(raw, index)),
    fleaMarket,
    translateItemKey: key => lookup(docs.itemsLang, docs.itemsEn, key),
    translateTraderKey: key => lookup(docs.tradersLang, docs.tradersEn, key),
  };
}

/** Parse and interpret raw documents in one step. */
export function readRawWorld(texts: RawTexts, lang: string = 'en'): RawWorld {
  return buildWorld(parseRawDocuments(texts, lang), lang);
}

/** Barters grouped by the item they offer, in document order. */
export function indexBartersByOfferedItem(barters: readonly RefBarter[]): ReadonlyMap<string, readonly RefBarter[]> {
  const index = new Map<string, RefBarter[]>();
  for (const barter of barters) {
    const list = index.get(barter.offered.itemId);
    if (list) list.push(barter);
    else index.set(barter.offered.itemId, [barter]);
  }
  return index;
}
