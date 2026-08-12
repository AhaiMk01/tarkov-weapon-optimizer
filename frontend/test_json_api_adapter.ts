/**
 * Verifies the JSON API adapter produces the GraphQL-shaped data that
 * dataService's extractors expect, and that a real build still solves.
 *
 * Run: npx tsx test_json_api_adapter.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- this harness probes raw API shapes on purpose */
import { fetchAllData, buildItemLookup, getAvailablePrice } from './src/solver/dataService.ts';
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

async function main() {
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

  // --- Presets dereferenced ---
  const presets = m4.properties?.presets ?? [];
  check('gun presets dereferenced to objects', presets.length > 0 && typeof presets[0] === 'object', `${presets.length}`);
  check('preset has containsItems as {item:{id}}',
    (presets[0]?.containsItems ?? []).every((c: any) => typeof c.item?.id === 'string'));
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

  const modEntries = Object.values(lookup).filter((e: any) => e.type === 'mod') as any[];
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
