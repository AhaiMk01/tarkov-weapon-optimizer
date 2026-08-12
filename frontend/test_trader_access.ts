/**
 * Verifies per-trader loyalty-level gating and the TRADER_DISABLED (0) state,
 * including Ref, whose weapon-mod offers are all GP-coin barters.
 *
 * Run: npx tsx test_trader_access.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- probes raw solver stats */
import { fetchAllData, buildItemLookup, getAvailablePrice } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve } from './src/solver/solver.ts';
import { DEFAULT_TRADER_LEVELS, TRADER_DISABLED, type TraderLevels } from './src/solver/types.ts';

const M4A1 = '5447a9cd4bdc2dbd208b4567';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const levels = (over: Partial<TraderLevels>): TraderLevels => ({ ...DEFAULT_TRADER_LEVELS, ...over });

async function main() {
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(guns, mods);

  check('ref present in defaults', DEFAULT_TRADER_LEVELS.ref === 4, `${DEFAULT_TRADER_LEVELS.ref}`);
  check('TRADER_DISABLED is 0', TRADER_DISABLED === 0);

  // --- Ref: find mods whose only non-flea purchase path is a Ref barter ---
  const refOnly: Array<{ id: string; name: string; level: number; price: number }> = [];
  for (const [id, entry] of Object.entries(lookup)) {
    const offers = (entry.stats as any).offers ?? [];
    const nonFlea = offers.filter((o: any) => o.source !== 'fleaMarket');
    if (!nonFlea.length) continue;
    if (nonFlea.every((o: any) => (o.vendor_normalized ?? '') === 'ref')) {
      const best = nonFlea[0];
      refOnly.push({ id, name: (entry.data as any).name, level: best.trader_level, price: best.price });
    }
  }
  console.log(`\nmods purchasable only via Ref: ${refOnly.length}`);
  refOnly.slice(0, 5).forEach(m => console.log(`   LL${m.level}  ₽${m.price}  ${m.name}`));
  check('found Ref-only mods to test', refOnly.length > 0, `${refOnly.length}`);
  if (!refOnly.length) { process.exit(1); }

  const sample = refOnly.find(m => m.level >= 2) ?? refOnly[0];
  const stats = (lookup[sample.id].stats as any);
  console.log(`\nusing: ${sample.name} (Ref LL${sample.level})`);

  // barters on, flea off, so Ref is the only path
  const at = (refLevel: number) =>
    getAvailablePrice(stats, levels({ ref: refLevel }), /*flea*/ false, /*playerLevel*/ null, /*barter*/ true, false);

  const [priceMax] = at(4);
  check('Ref LL4 → mod is purchasable', priceMax > 0, `₽${priceMax}`);

  const [priceBelow] = at(sample.level - 1);
  check(`Ref LL${sample.level - 1} → offer gated out`, priceBelow === 0, `₽${priceBelow}`);

  const [priceAtLevel] = at(sample.level);
  check(`Ref LL${sample.level} → offer allowed`, priceAtLevel > 0, `₽${priceAtLevel}`);

  const [priceOff, , availOff] = at(TRADER_DISABLED);
  check('Ref disabled (0) → not purchasable', priceOff === 0 && availOff === false, `₽${priceOff}`);

  // Previously `traderLevels[vendor] ?? 4` silently treated an absent trader as
  // LL4; ref must now actually be honoured rather than defaulted.
  const withoutRefKey = { ...DEFAULT_TRADER_LEVELS } as TraderLevels;
  delete (withoutRefKey as Record<string, number>).ref;
  const [priceNoKey] = getAvailablePrice(stats, withoutRefKey, false, null, true, false);
  check('absent ref key still defaults to allowed (documents old behaviour)', priceNoKey > 0, `₽${priceNoKey}`);

  // --- Disabling a cash trader ---
  const pkMod = Object.entries(lookup).find(([, e]) => {
    const offers = (e.stats as any).offers ?? [];
    const nonFlea = offers.filter((o: any) => o.source !== 'fleaMarket');
    return nonFlea.length > 0 && nonFlea.every((o: any) => (o.vendor_normalized ?? '') === 'peacekeeper');
  });
  if (pkMod) {
    const pkStats = pkMod[1].stats as any;
    const [onPrice] = getAvailablePrice(pkStats, DEFAULT_TRADER_LEVELS, false, null, true, false);
    const [offPrice] = getAvailablePrice(pkStats, levels({ peacekeeper: TRADER_DISABLED }), false, null, true, false);
    check('peacekeeper-only mod available when enabled', onPrice > 0, `₽${onPrice}`);
    check('peacekeeper-only mod unavailable when disabled', offPrice === 0, `₽${offPrice}`);
  } else {
    check('found a peacekeeper-only mod', false);
  }

  // --- End-to-end: disabling every trader with flea off leaves no purchases ---
  const compat = buildCompatibilityMap(M4A1, lookup);
  const allOff = Object.fromEntries(Object.keys(DEFAULT_TRADER_LEVELS).map(k => [k, TRADER_DISABLED])) as TraderLevels;

  const baseline = await solve({
    weaponId: M4A1, itemLookup: lookup, compatibilityMap: compat,
    ergoWeight: 1, recoilWeight: 0, priceWeight: 0,
    traderLevels: DEFAULT_TRADER_LEVELS, fleaAvailable: false, barterAvailable: true, playerLevel: null,
  });
  const restricted = await solve({
    weaponId: M4A1, itemLookup: lookup, compatibilityMap: compat,
    ergoWeight: 1, recoilWeight: 0, priceWeight: 0,
    traderLevels: allOff, fleaAvailable: false, barterAvailable: true, playerLevel: null,
  });

  const boughtIn = (r: any) => (r.selected_items ?? []).filter((i: any) => (i.price ?? 0) > 0).length;
  console.log(`\nbaseline (all traders LL4, no flea): status=${baseline.status} ergo=${baseline.final_stats?.ergonomics} purchased=${boughtIn(baseline)} cost=₽${baseline.final_stats?.total_price}`);
  console.log(`all traders off       (no flea): status=${restricted.status} ergo=${restricted.final_stats?.ergonomics} purchased=${boughtIn(restricted)} cost=₽${restricted.final_stats?.total_price}`);

  check('baseline solves and buys mods', boughtIn(baseline) > 0, `${boughtIn(baseline)} purchased`);
  check('all traders off → nothing purchased', boughtIn(restricted) === 0, `${boughtIn(restricted)} purchased`);
  check('all traders off → cheaper or equal total', (restricted.final_stats?.total_price ?? 0) <= (baseline.final_stats?.total_price ?? 0));

  // Disabling one trader must not silently keep using it.
  const noPk = await solve({
    weaponId: M4A1, itemLookup: lookup, compatibilityMap: compat,
    ergoWeight: 1, recoilWeight: 0, priceWeight: 0,
    traderLevels: levels({ peacekeeper: TRADER_DISABLED }), fleaAvailable: false, barterAvailable: true, playerLevel: null,
  });
  const usedPk = (noPk.selected_items ?? []).filter((i: any) => /peacekeeper/i.test(i.source ?? '')).length;
  console.log(`peacekeeper disabled: status=${noPk.status} purchased=${boughtIn(noPk)} peacekeeper-sourced=${usedPk}`);
  check('peacekeeper disabled → no peacekeeper-sourced purchases', usedPk === 0, `${usedPk}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
