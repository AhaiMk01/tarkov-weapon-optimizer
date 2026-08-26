/**
 * Verifies the naked-receiver base respects trader loyalty levels and
 * TRADER_DISABLED, the way mods and presets already did. Before the fix,
 * lpBuilder read the unfiltered `weaponStats.price`, so the LP would buy a
 * bare receiver from a trader the player's settings had gated out.
 *
 * Run: npx tsx test_naked_base_availability.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchAllData, buildItemLookup, getAvailablePrice } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve } from './src/solver/solver.ts';
import { DEFAULT_TRADER_LEVELS, TRADER_DISABLED, type TraderLevels } from './src/solver/types.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const levels = (over: Partial<TraderLevels>): TraderLevels => ({ ...DEFAULT_TRADER_LEVELS, ...over });

async function main() {
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(guns, mods);

  // --- guns now carry an offers[] with trader levels ---
  const gunEntries = Object.entries(lookup).filter(([, e]) => e.type === 'gun');
  const withOffers = gunEntries.filter(([, e]) => ((e.stats as any).offers ?? []).length > 0);
  check('gun stats expose offers[]', withOffers.length > 0, `${withOffers.length}/${gunEntries.length} guns have offers`);

  // --- guns with no trader offer report an honest "no purchase path" ---
  // (this used to be a 999999999 sentinel that getAvailablePrice read back as
  //  a real price and reported as available)
  const noOffer = gunEntries.find(([, e]) => (((e.stats as any).offers ?? []).length === 0));
  if (noOffer) {
    const stats = noOffer[1].stats as any;
    const [p, src, avail] = getAvailablePrice(stats, DEFAULT_TRADER_LEVELS, true, null, false, false);
    check('gun with no trader offer is not available', !avail && p === 0,
      `${(noOffer[1].data as any).name} — ₽${p} src=${src} price_source=${stats.price_source}`);
  }

  // --- find a gun whose bare receiver needs LL >= 2 ---
  let target: { id: string; name: string; vendor: string; level: number; price: number } | null = null;
  for (const [id, entry] of gunEntries) {
    const offers = (entry.stats as any).offers ?? [];
    if (!offers.length) continue;
    const minLevel = Math.min(...offers.map((o: any) => o.trader_level ?? 1));
    if (minLevel >= 2) {
      const best = offers.find((o: any) => (o.trader_level ?? 1) === minLevel);
      target = { id, name: (entry.data as any).name, vendor: best.vendor_normalized, level: minLevel, price: best.price };
      break;
    }
  }
  check('found a loyalty-gated bare receiver', target !== null, target ? `${target.name} — ${target.vendor} LL${target.level} ₽${target.price}` : '');
  if (!target) { process.exit(1); }

  const stats = (lookup[target.id].stats as any);
  const at = (lvl: number) => getAvailablePrice(stats, levels({ [target!.vendor]: lvl } as any), false, null, false, false);

  const [pOk, , availOk] = at(target.level);
  const [pLow, , availLow] = at(target.level - 1);
  const [pOff, , availOff] = at(TRADER_DISABLED);
  check(`${target.vendor} LL${target.level} → receiver purchasable`, availOk && pOk === target.price, `₽${pOk}`);
  check(`${target.vendor} LL${target.level - 1} → receiver gated out`, !availLow, `₽${pLow}`);
  check(`${target.vendor} disabled → receiver gated out`, !availOff, `₽${pOff}`);

  // --- end to end: the LP must not pick the gated naked base ---
  const cmap = buildCompatibilityMap(target.id, lookup);
  const base = {
    weaponId: target.id, itemLookup: lookup, compatibilityMap: cmap,
    ergoWeight: 0, recoilWeight: 0, priceWeight: 1, fleaAvailable: false, barterAvailable: false,
  };
  const hi = await solve({ ...base, traderLevels: levels({ [target.vendor]: target.level } as any) } as any);
  const lo = await solve({ ...base, traderLevels: levels({ [target.vendor]: TRADER_DISABLED } as any) } as any);
  const nakedName = (lookup[target.id].data as any).name;
  const hiBase = hi.selected_preset?.name ?? '(none)';
  const loBase = lo.selected_preset?.name ?? '(none)';
  console.log(`\n  ${target.vendor} LL${target.level}: status=${hi.status} base="${hiBase}" basePrice=₽${hi.selected_preset?.price ?? 0}`);
  console.log(`  ${target.vendor} off:  status=${lo.status} base="${loBase}" basePrice=₽${lo.selected_preset?.price ?? 0}`);
  check('gated receiver is not chosen as the base when the trader is disabled', loBase !== nakedName || (lo.selected_preset?.price ?? 0) === 0, `base="${loBase}"`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
