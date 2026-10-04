// Small synthetic raw documents for unit tests of the reference reader and source checks.
// They mimic the real document shapes (see pinned captures) but are hand-built so each source
// rule can be exercised in isolation. Never used as evidence about the real upstream data.
import type { RawTexts } from './rawReader';

interface ItemOverrides { [key: string]: unknown }

export function item(id: string, over: ItemOverrides = {}): Record<string, unknown> {
  return {
    id,
    name: `${id} Name`,
    shortName: `${id} ShortName`,
    normalizedName: `item-${id}`,
    weight: 1,
    types: ['mods'],
    containsItems: [],
    categories: [],
    handbookCategories: [],
    conflictingItems: [],
    conflictingSlotIds: [],
    buyFromTrader: [],
    lastLowPrice: null,
    avg24hPrice: null,
    basePrice: 100,
    properties: null,
    ...over,
  };
}

export function texts(items: Record<string, unknown>[], over: Partial<RawTexts> = {}, extraData: Record<string, unknown> = {}): RawTexts {
  const keyed: Record<string, unknown> = {};
  for (const it of items) keyed[(it as { id: string }).id] = it;
  const names: Record<string, string> = {};
  for (const it of items) {
    names[(it as { name: string }).name] = `EN ${(it as { id: string }).id}`;
    names[(it as { shortName: string }).shortName] = `EN short ${(it as { id: string }).id}`;
  }
  return {
    items: JSON.stringify({
      data: {
        items: keyed,
        itemCategories: {},
        handbookCategories: {},
        fleaMarket: { name: 'FleaMarket', normalizedName: 'flea-market', foundInRaidRequired: false, enabled: true },
        ...extraData,
      },
    }),
    itemsEn: JSON.stringify({ data: { ...names, FleaMarket: 'Flea Market' } }),
    barters: JSON.stringify({ data: [] }),
    traders: JSON.stringify({ data: { t1: { id: 't1', name: 't1 Nickname', normalizedName: 'prapor' } } }),
    tradersEn: JSON.stringify({ data: { 't1 Nickname': 'Prapor' } }),
    ...over,
  };
}

export const presetOf = (containsItems: unknown[]) => item('P', { types: ['preset'], containsItems });

