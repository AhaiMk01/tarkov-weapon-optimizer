// A tiny synthetic tarkov.dev JSON API world served through a stubbed `fetch` (no network), for the data-layer unit tests.
//
// It mimics the real document shapes (`items`, `items_en`, `barters`, `traders`, `traders_en`) closely enough to run the production adapter and
// extractors end to end. It is a hand-built fixture: it is evidence about the code under test, never about upstream data.

export const JSON_API = 'https://json.tarkov.dev/regular/';

/** Run `run` with `fetch` answering only the given JSON API documents (envelope `{ data }`), refusing every other URL. */
export async function withStubbedJsonApi<T>(docs: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(JSON_API)) throw new Error(`stub refuses ${url}`);
    const name = url.slice(JSON_API.length);
    if (!(name in docs)) throw new Error(`stub has no document ${name}`);
    return new Response(JSON.stringify({ data: docs[name] }), { status: 200 });
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export type RawItemDoc = Record<string, unknown> & { id: string; name: string; shortName: string };

export function rawItem(id: string, over: Record<string, unknown> = {}): RawItemDoc {
  return {
    id,
    name: `${id} Name`,
    shortName: `${id} Short`,
    normalizedName: `n-${id}`,
    basePrice: 100,
    weight: 1,
    types: [] as string[],
    containsItems: [] as unknown[],
    categories: [] as string[],
    handbookCategories: [] as string[],
    conflictingItems: [] as string[],
    conflictingSlotIds: [] as string[],
    buyFromTrader: [] as unknown[],
    properties: null as unknown,
    ...over,
  };
}

/** A priced trader offer in the raw `buyFromTrader` shape. */
export const traderOffer = (price: number, minTraderLevel = 1) => ({ trader: 't1', price, priceRUB: price, currency: 'RUB', minTraderLevel });

export interface RawSlotSpec {
  id: string;
  allowed: string[];
  required?: boolean;
}

export const rawSlots = (slots: RawSlotSpec[]) =>
  slots.map(s => ({ id: s.id, name: `${s.id} Slot`, nameId: s.id, required: s.required === true, filters: { allowedItems: [...s.allowed] } }));

export interface RawCategorySpec {
  id: string;
  /** Parent category id, or null for the root. */
  parent: string | null;
}

export interface WorldSpec {
  items: RawItemDoc[];
  barters?: unknown[];
  categories?: RawCategorySpec[];
}

/** The five JSON API documents (plus the two language documents for `en`) of a synthetic world. */
export function docsOf(spec: WorldSpec): Record<string, unknown> {
  const items: Record<string, unknown> = {};
  const names: Record<string, string> = {};
  for (const item of spec.items) {
    items[item.id] = item;
    names[item.name] = `EN ${item.id}`;
    names[item.shortName] = `EN short ${item.id}`;
  }
  const itemCategories: Record<string, unknown> = {};
  for (const category of spec.categories ?? []) {
    itemCategories[category.id] = {
      id: category.id,
      name: `${category.id} Name`,
      normalizedName: `n-${category.id}`,
      parent: category.parent,
      children: [],
    };
    names[`${category.id} Name`] = `EN ${category.id}`;
  }
  return {
    items: { items, itemCategories, handbookCategories: {}, fleaMarket: { name: 'FleaMarket', normalizedName: 'flea-market' } },
    items_en: { ...names, FleaMarket: 'Flea Market' },
    barters: spec.barters ?? [],
    traders: { t1: { id: 't1', name: 't1 Nickname', normalizedName: 'prapor' } },
    traders_en: { 't1 Nickname': 'Prapor' },
  };
}

/** A raw barter document entry offering `count` units of `offered` for the given ingredients. */
export function rawBarter(offered: string, offeredCount: unknown, requiredItems: { item: string; count: unknown }[], level = 1) {
  return {
    trader: 't1',
    minTraderLevel: level,
    offeredItem: { item: offered, ...(offeredCount === undefined ? {} : { count: offeredCount }) },
    requiredItems,
  };
}
