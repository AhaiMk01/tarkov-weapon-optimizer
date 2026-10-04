/**
 * Verifies the JSON API adapter produces the GraphQL-shaped data that
 * dataService's extractors expect, and that a real build still solves.
 *
 * Run: npx tsx test_json_api_adapter.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- this harness probes raw API shapes on purpose */
import { fetchAllData, buildItemLookup, getAvailablePrice } from './src/solver/dataService.ts';
import { fetchAllDataFromJsonApi } from './src/solver/jsonApiAdapter.ts';
import { SourceDataError } from './src/solver/sourceErrors.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve } from './src/solver/solver.ts';
import type { ItemLookup, SolveParams } from './src/solver/types.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';

const M4A1 = '5447a9cd4bdc2dbd208b4567';
const AK74N = '5644bd2b4bdc2d3b4c8b4572';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// --------------------------------------------------------------------------------------------
// Offline: preset quantities through the adapter and the extractors, on a tiny synthetic JSON API
// world served through a stubbed fetch (no network). Counts are explicit; there is no default.
// --------------------------------------------------------------------------------------------

const JSON_API = 'https://json.tarkov.dev/regular/';

async function withStubbedJsonApi<T>(docs: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(JSON_API)) throw new Error(`stub refuses ${url}`);
    const name = url.slice(JSON_API.length);
    if (!(name in docs)) throw new Error(`stub has no document ${name}`);
    return new Response(JSON.stringify({ data: docs[name] }), { status: 200 });
  }) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

const rawItem = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `${id} Name`, shortName: `${id} Short`, normalizedName: `n-${id}`, basePrice: 100, weight: 1, types: [] as string[],
  containsItems: [] as unknown[], categories: [] as string[], handbookCategories: [] as string[], conflictingItems: [] as string[],
  conflictingSlotIds: [] as string[], buyFromTrader: [] as unknown[], properties: null as unknown, ...over,
});

/** One gun, one rail mod and one preset on the gun, whose `containsItems` is supplied by the caller. */
function syntheticDocs(containsItems: unknown[], barter?: { count?: unknown; offeredCount?: unknown }): Record<string, unknown> {
  const items: Record<string, unknown> = {
    gun: rawItem('gun', { types: ['gun'], properties: { slots: [], presets: ['pre'], defaultPreset: 'pre' } }),
    rail: rawItem('rail', { types: ['mods'], buyFromTrader: [{ trader: 't1', price: 50, priceRUB: 50, currency: 'RUB', minTraderLevel: 1 }] }),
    pre: rawItem('pre', {
      types: ['preset'], containsItems,
      buyFromTrader: [{ trader: 't1', price: 1000, priceRUB: 1000, currency: 'RUB', minTraderLevel: 1 }],
    }),
  };
  const names: Record<string, string> = {};
  for (const it of Object.values(items) as Array<{ name: string; shortName: string; id: string }>) {
    names[it.name] = `EN ${it.id}`;
    names[it.shortName] = `EN short ${it.id}`;
  }
  return {
    items: { items, itemCategories: {}, handbookCategories: {}, fleaMarket: { name: 'FleaMarket', normalizedName: 'flea-market' } },
    items_en: { ...names, FleaMarket: 'Flea Market' },
    barters: barter ? [{
      trader: 't1', minTraderLevel: 1,
      // `offeredCount` absent keeps the usual one-unit lot; an explicit undefined drops the field (the source error case).
      offeredItem: { item: 'rail', ...('offeredCount' in barter ? (barter.offeredCount === undefined ? {} : { count: barter.offeredCount }) : { count: 1 }) },
      requiredItems: [{ item: 'rail', ...('count' in barter ? { count: barter.count } : {}) }],
    }] : [],
    traders: { t1: { id: 't1', name: 't1 Nickname', normalizedName: 'prapor' } },
    traders_en: { 't1 Nickname': 'Prapor' },
  };
}

const component = (item: string, count?: unknown) => ({ item, ...(count === undefined ? {} : { count }) });

async function offlinePresetQuantityChecks() {
  console.log('=== Preset quantities (offline, synthetic JSON API world) ===');

  // Explicit multi-copy counts and repeated entries pass through the adapter verbatim, then accumulate downstream.
  const valid = await withStubbedJsonApi(
    syntheticDocs([component('gun', 1), component('rail', 2), component('rail', 1), component('ammo', 60)]),
    () => fetchAllDataFromJsonApi('en', 'regular'),
  );
  const rawPreset = valid.guns[0].properties.presets[0];
  check('adapter keeps every containsItems entry with its explicit count',
    JSON.stringify(rawPreset.containsItems.map((c: any) => [c.item.id, c.count])) === JSON.stringify([['gun', 1], ['rail', 2], ['rail', 1], ['ammo', 60]]),
    JSON.stringify(rawPreset.containsItems));
  const lookup = buildItemLookup(valid.guns, valid.mods);
  const preset = (lookup.gun as any).all_presets[0];
  check('buildItemLookup keeps the multi-copy count and sums repeated entries',
    JSON.stringify(preset.items) === JSON.stringify([{ itemId: 'rail', count: 3 }, { itemId: 'ammo', count: 60 }]), JSON.stringify(preset.items));
  check('the receiver entry is carried as receiver_id, not as supplied stock', preset.receiver_id === 'gun' && !preset.items.some((c: any) => c.itemId === 'gun'));

  // An absent, null or malformed count is a source error naming the preset and the item; nothing is defaulted.
  const bad: Array<[string, unknown, RegExp]> = [
    ['absent', undefined, /absent/],
    ['null', null, /null/],
    ['fractional', 1.5, /integer/],
    ['negative', -2, /nonnegative/],
    ['numeric string', '2', /string/],
  ];
  for (const [label, count, message] of bad) {
    let error: unknown;
    try {
      await withStubbedJsonApi(syntheticDocs([component('gun', 1), component('rail', count)]), () => fetchAllDataFromJsonApi('en', 'regular'));
    } catch (e) { error = e; }
    check(`adapter rejects an ${label} preset count with a SourceDataError naming preset and item`,
      error instanceof SourceDataError && error.kind === 'preset_component_count' && error.subjectId === 'pre' && error.itemId === 'rail'
        && message.test(error.message) && error.message.includes('pre') && error.message.includes('rail'),
      error instanceof Error ? error.message : String(error));
  }

  // Barter ingredient counts: absent/null throws, a fractional quantity is genuine source data.
  for (const [label, count] of [['absent', undefined], ['null', null]] as const) {
    let error: unknown;
    try {
      await withStubbedJsonApi(syntheticDocs([component('gun', 1)], label === 'absent' ? {} : { count }), () => fetchAllDataFromJsonApi('en', 'regular'));
    } catch (e) { error = e; }
    check(`adapter rejects an ${label} barter ingredient count`,
      error instanceof SourceDataError && error.kind === 'barter_ingredient_count' && error.subjectId === 'rail' && error.itemId === 'rail',
      error instanceof Error ? error.message : String(error));
  }
  const fractional = await withStubbedJsonApi(syntheticDocs([component('gun', 1)], { count: 155.1 }), () => fetchAllDataFromJsonApi('en', 'regular'));
  check('a fractional barter ingredient count is kept exactly', fractional.mods[0].bartersFor[0].requiredItems[0].count === 155.1);
}

// --------------------------------------------------------------------------------------------
// Offline: barter lot sizes, item types and ammunition flags, unpriced mods, on the same synthetic world
// --------------------------------------------------------------------------------------------

async function offlineLotAndTypeChecks() {
  console.log('=== Barter lot sizes, item types, ammunition flags, unpriced mods (offline, synthetic JSON API world) ===');

  const world = (offeredCount?: unknown): Record<string, unknown> => {
    const docs = syntheticDocs([component('gun', 1)], { count: 2, offeredCount });
    const items = (docs.items as any).items;
    items.gun.properties.slots = [
      { id: 'grip', name: 'grip Slot', nameId: 'grip', required: false, filters: { allowedItems: ['rail', 'ghost'] } },
      { id: 'chamber', name: 'chamber Slot', nameId: 'chamber', required: true, filters: { allowedItems: ['round'] } },
    ];
    items.round = rawItem('round', { types: ['ammo'], basePrice: 5 });
    items.free = rawItem('free', { types: ['mods'], basePrice: 0 }); // no offer, no reference price: unpriced
    const names = docs.items_en as Record<string, string>;
    for (const id of ['round', 'free']) { names[items[id].name] = `EN ${id}`; names[items[id].shortName] = `EN short ${id}`; }
    return docs;
  };

  // Lot size: offeredItem.count -> rewardItems -> OfferInfo.lot_size (the price stays the price of one whole lot).
  const lotted = await withStubbedJsonApi(world(30), () => fetchAllDataFromJsonApi('en', 'regular'));
  const rail = lotted.mods.find((m: any) => m.id === 'rail');
  check('adapter carries offeredItem.count as rewardItems (GraphQL Barter.rewardItems)',
    JSON.stringify(rail.bartersFor[0].rewardItems) === JSON.stringify([{ item: { id: 'rail' }, count: 30 }]), JSON.stringify(rail.bartersFor[0].rewardItems));
  const lotLookup = buildItemLookup(lotted.guns, lotted.mods);
  const barterOffer = (lotLookup.rail as any).stats.offers.find((o: any) => o.source.startsWith('barter:'));
  check('the barter offer carries lot_size and a whole-lot price', barterOffer?.lot_size === 30 && barterOffer?.price === 200, JSON.stringify(barterOffer));
  const cashOffer = (lotLookup.rail as any).stats.offers.find((o: any) => !o.source.startsWith('barter:'));
  check('a cash offer carries no lot size', cashOffer && !('lot_size' in cashOffer));
  for (const [label, offeredCount] of [['absent', undefined], ['null', null], ['zero', 0], ['fractional', 1.5], ['string', '30']] as const) {
    let error: unknown;
    try { await withStubbedJsonApi(world(offeredCount), () => fetchAllDataFromJsonApi('en', 'regular')); } catch (e) { error = e; }
    check(`adapter rejects an ${label} barter offeredItem.count with a SourceDataError naming the offered item`,
      error instanceof SourceDataError && error.kind === 'barter_lot_size' && error.subjectId === 'rail' && error.message.includes('rail'),
      error instanceof Error ? error.message : String(error));
  }

  // Item types and ammunition flags.
  const typed = await withStubbedJsonApi(world(1), () => fetchAllDataFromJsonApi('en', 'regular'));
  const gun = typed.guns[0];
  check('converted items carry their raw types', JSON.stringify(gun.types) === JSON.stringify(['gun']) && JSON.stringify(rail.types) === JSON.stringify(['mods']));
  const allowed = gun.properties.slots.map((s: any) => s.filters.allowedItems);
  check('allowedItems entries are { id, types } (the types of an unknown id are empty)',
    JSON.stringify(allowed) === JSON.stringify([[{ id: 'rail', types: ['mods'] }, { id: 'ghost', types: [] }], [{ id: 'round', types: ['ammo'] }]]), JSON.stringify(allowed));
  const typedLookup = buildItemLookup(typed.guns, typed.mods);
  const slots = (typedLookup.gun as any).slots;
  check('the extractor flags only ammunition, per slot (ammoItems), and keeps allowedItems as plain ids',
    JSON.stringify(slots.map((s: any) => [s.allowedItems, s.ammoItems ?? null])) === JSON.stringify([[['rail', 'ghost'], null], [['round'], ['round']]]), JSON.stringify(slots));

  // Unpriced mods stay in the lookup, with no offers and no stand-in price.
  const free = typedLookup.free as any;
  check('an unpriced mod (no offer, no reference price) stays in the lookup with an empty offer list',
    free?.type === 'mod' && free.stats.offers.length === 0 && free.stats.purchasable === false && free.stats.price === 0, JSON.stringify(free?.stats));
}

async function main() {
  await offlinePresetQuantityChecks();
  await offlineLotAndTypeChecks();

  console.log('=== Fetching en/regular via fetchAllData (JSON API path) ===');
  const t0 = Date.now();
  const { guns, mods } = await fetchAllData('en', 'regular');
  console.log(`fetched in ${Date.now() - t0}ms: ${guns.length} guns, ${mods.length} mods\n`);

  check('guns present', guns.length > 100, `${guns.length}`);
  check('mods present', mods.length > 1000, `${mods.length}`);

  const m4 = guns.find(g => g.id === M4A1);
  check('M4A1 found', !!m4);
  if (!m4) { process.exit(1); }

  // --- Translations resolved (not raw keys) ---
  check('gun name translated', m4.name === 'Colt M4A1 5.56x45 assault rifle', JSON.stringify(m4.name));
  check('gun shortName translated', m4.shortName === 'M4A1', JSON.stringify(m4.shortName));
  check('no items left with raw " Name" key', !guns.some(g => / Name$/.test(g.name)) && !mods.some(m => / Name$/.test(m.name)));

  // --- Slots ---
  const slots = m4.properties?.slots ?? [];
  check('gun has slots', slots.length > 0, `${slots.length}`);
  check('slot name translated', slots[0]?.name === 'Pistol Grip', JSON.stringify(slots[0]?.name));
  check('slot nameId preserved', slots[0]?.nameId === 'mod_pistol_grip', slots[0]?.nameId);
  check('slot allowedItems non-empty', (slots[0]?.filters?.allowedItems ?? []).length > 0);

  // --- bsgCategory + parent chain ---
  check('bsgCategory name', m4.bsgCategory?.name === 'Assault rifle', JSON.stringify(m4.bsgCategory?.name));
  check('bsgCategory parent chain', m4.bsgCategory?.parent?.name === 'Weapon', JSON.stringify(m4.bsgCategory?.parent?.name));
  check('bsgCategory id set', !!m4.bsgCategory?.id, m4.bsgCategory?.id);

  // --- buyFor: trader offers + synthesized flea offer ---
  const buyFor = m4.buyFor ?? [];
  check('gun buyFor non-empty', buyFor.length > 0, `${buyFor.length}`);
  const flea = buyFor.find((o: any) => o.source === 'fleaMarket');
  check('flea offer uses source "fleaMarket"', !!flea);
  check('flea offer priced', (flea?.priceRUB ?? 0) > 0, `${flea?.priceRUB}`);
  check('flea vendor normalizedName', flea?.vendor?.normalizedName === 'flea-market', flea?.vendor?.normalizedName);

  const traderOffers = mods.flatMap((m: any) => (m.buyFor ?? []).filter((o: any) => o.source !== 'fleaMarket'));
  check('trader offers exist across mods', traderOffers.length > 500, `${traderOffers.length}`);
  check('trader offer has minTraderLevel', traderOffers.every((o: any) => typeof o.vendor?.minTraderLevel === 'number'));
  check('trader offer source is trader normalizedName',
    traderOffers.every((o: any) => o.source && o.source === o.vendor?.normalizedName));
  const knownTraders = new Set(['prapor', 'therapist', 'fence', 'skier', 'peacekeeper', 'mechanic', 'ragman', 'jaeger', 'ref']);
  check('trader sources are known traders',
    traderOffers.every((o: any) => knownTraders.has(o.source)),
    [...new Set(traderOffers.map((o: any) => o.source))].join(','));

  // --- bartersFor ---
  const withBarter = mods.filter((m: any) => (m.bartersFor ?? []).length > 0);
  check('some mods have barters', withBarter.length > 0, `${withBarter.length}`);
  const barter = withBarter[0]?.bartersFor[0];
  check('barter has trader normalizedName', !!barter?.trader?.normalizedName, barter?.trader?.normalizedName);
  check('barter level is a number', typeof barter?.level === 'number', `${barter?.level}`);
  check('barter requiredItems resolved with names',
    (barter?.requiredItems ?? []).every((r: any) => r.item?.id && typeof r.item?.name === 'string' && r.item.name.length > 0));

  // --- Item types, ammunition flags and lot sizes on the live data ---
  check('every gun and mod carries its raw item types',
    guns.every((g: any) => Array.isArray(g.types) && g.types.includes('gun')) && mods.every((m: any) => Array.isArray(m.types) && m.types.includes('mods')));
  const allowedEntries = [...guns, ...mods].flatMap((it: any) => (it.properties?.slots ?? []).flatMap((s: any) => s.filters?.allowedItems ?? []));
  check('every allowed item is { id, types }', allowedEntries.length > 1000 && allowedEntries.every((a: any) => typeof a.id === 'string' && Array.isArray(a.types)), `${allowedEntries.length} entries`);
  check('some allowed items are ammunition (camora slots)', allowedEntries.some((a: any) => a.types.includes('ammo')));
  const liveBarters = [...guns, ...mods].flatMap((it: any) => it.bartersFor ?? []);
  check('every converted barter carries rewardItems with an integer lot size >= 1',
    liveBarters.length > 0 && liveBarters.every((b: any) => Array.isArray(b.rewardItems) && b.rewardItems.length === 1 && Number.isSafeInteger(b.rewardItems[0].count) && b.rewardItems[0].count >= 1), `${liveBarters.length} barters`);

  // --- Presets dereferenced ---
  const presets = m4.properties?.presets ?? [];
  check('gun presets dereferenced to objects', presets.length > 0 && typeof presets[0] === 'object', `${presets.length}`);
  check('preset has containsItems as {item:{id}}',
    (presets[0]?.containsItems ?? []).every((c: any) => typeof c.item?.id === 'string'));
  check('every preset component carries an explicit nonnegative integer count (no default)',
    guns.every((g: any) => (g.properties?.presets ?? []).every((p: any) =>
      (p.containsItems ?? []).every((c: any) => Number.isInteger(c.count) && c.count >= 0))));
  check('some gun preset holds more than one copy of a part (counts are real, not all 1)',
    guns.some((g: any) => (g.properties?.presets ?? []).some((p: any) => (p.containsItems ?? []).some((c: any) => c.count > 1))));
  check('preset has buyFor array', Array.isArray(presets[0]?.buyFor));
  check('preset name translated', typeof presets[0]?.name === 'string' && !/ Name$/.test(presets[0].name), presets[0]?.name);
  check('defaultPreset is an object with images',
    typeof m4.properties?.defaultPreset === 'object' && m4.properties.defaultPreset !== null
      && !!(m4.properties.defaultPreset.image512pxLink ?? m4.properties.defaultPreset.imageLink));

  // --- conflictingItems wrapped ---
  const withConflicts = mods.find((m: any) => (m.conflictingItems ?? []).length > 0);
  check('conflictingItems wrapped as {id}',
    !!withConflicts && withConflicts.conflictingItems.every((c: any) => typeof c?.id === 'string'));

  // --- Numeric modifier fields ---
  check('mods carry recoil/ergo modifiers',
    mods.some((m: any) => (m.recoilModifier ?? 0) !== 0) && mods.some((m: any) => (m.ergonomicsModifier ?? 0) !== 0));

  // --- Downstream: buildItemLookup + extractors ---
  console.log('\n=== buildItemLookup ===');
  const lookup: ItemLookup = buildItemLookup(guns, mods);
  const entries = Object.keys(lookup).length;
  check('lookup built', entries > 1000, `${entries} entries`);

  const m4Entry = lookup[M4A1];
  check('gun stats ergonomics', (m4Entry as any).stats.naked_ergonomics > 0, `${(m4Entry as any).stats.naked_ergonomics}`);
  check('gun stats recoil', (m4Entry as any).stats.naked_recoil_v > 0, `${(m4Entry as any).stats.naked_recoil_v}`);
  check('gun stats category', (m4Entry as any).stats.category === 'Assault rifle', (m4Entry as any).stats.category);
  check('gun purchasable presets extracted', (m4Entry as any).presets.length > 0, `${(m4Entry as any).presets.length}`);
  check('preset prices > 0', (m4Entry as any).presets.every((p: any) => p.price > 0));

  // Every preset's extracted quantities equal the raw containsItems counts (repeated entries summed, receiver apart).
  let presetsChecked = 0;
  let multiCopy = 0;
  const quantityMismatches: string[] = [];
  for (const gun of guns as any[]) {
    const entry = lookup[gun.id] as any;
    const rawPresets: any[] = gun.properties?.presets ?? [];
    rawPresets.forEach((raw, index) => {
      const extracted = entry.all_presets[index];
      const expected = new Map<string, number>();
      for (const c of raw.containsItems ?? []) {
        if (c.item.id === gun.id) continue;
        expected.set(c.item.id, (expected.get(c.item.id) ?? 0) + c.count);
      }
      const got = new Map<string, number>(extracted.items.map((c: any) => [c.itemId, c.count] as [string, number]));
      presetsChecked++;
      for (const [, count] of expected) if (count > 1) multiCopy++;
      if (extracted.id !== raw.id || extracted.receiver_id !== gun.id
        || JSON.stringify([...expected].sort()) !== JSON.stringify([...got].sort())) quantityMismatches.push(`${gun.id}/${raw.id}`);
    });
  }
  check('every extracted preset quantity equals the raw count', quantityMismatches.length === 0 && presetsChecked > 300, `${presetsChecked} presets, ${multiCopy} multi-copy entries, mismatches: ${quantityMismatches.slice(0, 3).join(',')}`);
  check('multi-copy preset entries are kept (not collapsed to one)', multiCopy > 0, `${multiCopy}`);

  const modEntries = Object.values(lookup).filter((e: any) => e.type === 'mod') as any[];
  check('no mod is dropped from the lookup, priced or not', modEntries.length === mods.length, `${modEntries.length}/${mods.length}`);
  check('every barter offer carries a lot_size >= 1', modEntries.every(e => e.stats.offers.filter((o: any) => o.source.startsWith('barter:')).every((o: any) => Number.isSafeInteger(o.lot_size) && o.lot_size >= 1)));
  const purchasable = modEntries.filter(e => e.stats.purchasable);
  check('most mods purchasable', purchasable.length > 500, `${purchasable.length}/${modEntries.length}`);
  check('mod categories populated',
    modEntries.filter(e => e.stats.category && e.stats.category.length > 0).length > modEntries.length * 0.9);

  // Trader-level gating still works through offers
  const gated = purchasable.find(e => e.stats.offers.some((o: any) => o.source !== 'fleaMarket' && o.trader_level > 1));
  if (gated) {
    const [priceL4] = getAvailablePrice(gated.stats, DEFAULT_TRADER_LEVELS, true, null);
    const lockedLevels = { ...DEFAULT_TRADER_LEVELS };
    for (const k of Object.keys(lockedLevels)) (lockedLevels as any)[k] = 1;
    const [priceL1] = getAvailablePrice(gated.stats, lockedLevels, false, null);
    check('trader level gating changes availability', priceL4 > 0 && priceL4 !== priceL1, `L4=${priceL4} L1(noFlea)=${priceL1}`);
  } else {
    check('trader level gating changes availability', false, 'no level-gated mod found');
  }

  // --- End-to-end solve on two weapons ---
  for (const [name, id] of [['M4A1', M4A1], ['AK-74N', AK74N]] as const) {
    console.log(`\n=== Solving ${name} (ergonomics) ===`);
    const gun = lookup[id];
    if (!gun) { check(`${name} in lookup`, false); continue; }
    const compat = buildCompatibilityMap(id, lookup);
    check(`${name} compat map reachable`, Object.keys(compat.reachable_items).length > 50,
      `${Object.keys(compat.reachable_items).length} items`);

    const params: SolveParams = {
      weaponId: id,
      itemLookup: lookup,
      compatibilityMap: compat,
      ergoWeight: 1, recoilWeight: 0, priceWeight: 0,
      traderLevels: DEFAULT_TRADER_LEVELS,
      fleaAvailable: true,
      playerLevel: null,
    };

    const result = await solve(params);
    const status = (result.status ?? '').toLowerCase();
    check(`${name} solved`, status === 'optimal' || status === 'feasible', result.status);
    const stats = result.final_stats;
    if (stats) {
      console.log(`   ergo=${stats.ergonomics} recoilV=${stats.recoil_vertical} price=${stats.total_price}`);
      check(`${name} ergonomics improved over naked`,
        stats.ergonomics > (gun as any).stats.naked_ergonomics,
        `${stats.ergonomics} > ${(gun as any).stats.naked_ergonomics}`);
      check(`${name} price is finite`, Number.isFinite(stats.total_price) && stats.total_price > 0, `${stats.total_price}`);
    }
  }

  // --- Localized fetch ---
  console.log('\n=== Fetching zh/regular (translation path) ===');
  const zh = await fetchAllData('zh', 'regular');
  const zhM4 = zh.guns.find(g => g.id === M4A1);
  check('zh gun name localized', zhM4?.name === '柯尔特 M4A1 5.56x45 卡宾枪', JSON.stringify(zhM4?.name));
  check('zh slot name localized', zhM4?.properties?.slots?.[0]?.name === '手枪式握把',
    JSON.stringify(zhM4?.properties?.slots?.[0]?.name));
  check('zh flea vendor localized', (zhM4?.buyFor ?? []).find((o: any) => o.source === 'fleaMarket')?.vendor?.name === '跳蚤市场');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
