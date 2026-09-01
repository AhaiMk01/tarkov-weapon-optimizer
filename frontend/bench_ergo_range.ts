/**
 * Largest useful `steps` for the Explore sweep, measured rather than guessed.
 *
 * Two of the three sweeps step over ergonomics with stepSize = max(1, range/steps),
 * so once steps exceeds a weapon's ergo range the step size hits its 1-unit floor
 * and further steps buy nothing. The cap is therefore the widest ergo range across
 * all weapons, computed exactly the way explorePareto derives it: floor(min-ergo
 * solve) to ceil(max-ergo solve), clamped to [0, 100].
 */
import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve } from './src/solver/solver.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';
import type { SolveParams } from './src/solver/types.ts';

const TB = 0.0001;
const { guns, mods } = await fetchAllData('en', 'regular');
const lookup = buildItemLookup(guns, mods);
const gunIds = Object.entries(lookup).filter(([, e]) => e.type === 'gun').map(([id, e]) => ({ id, name: ((e.data as Record<string, unknown>).name as string) ?? id }));
console.log(`Measuring ergo range for ${gunIds.length} weapons...\n`);

const rows: Array<{ name: string; range: number; lo: number; hi: number }> = [];
let failed = 0;
for (const g of gunIds) {
  try {
    const cmap = buildCompatibilityMap(g.id, lookup);
    const base: SolveParams = { weaponId: g.id, itemLookup: lookup, compatibilityMap: cmap,
      traderLevels: DEFAULT_TRADER_LEVELS, fleaAvailable: true, preciseMode: false };
    const low = await solve({ ...base, ergoWeight: TB, recoilWeight: 1, priceWeight: TB });
    const high = await solve({ ...base, ergoWeight: 1, recoilWeight: TB, priceWeight: TB });
    if (low.status === 'infeasible' || !low.final_stats) { failed++; continue; }
    const lo = Math.max(0, Math.floor(low.final_stats.ergonomics));
    const hi = Math.min(100, high.status !== 'infeasible' && high.final_stats ? Math.ceil(high.final_stats.ergonomics) : 100);
    rows.push({ name: g.name, lo, hi, range: Math.max(1, hi - lo) });
  } catch { failed++; }
}

rows.sort((a, b) => b.range - a.range);
console.log('Widest ergo ranges:');
for (const r of rows.slice(0, 10)) console.log(`  ${String(r.range).padStart(3)}  (${r.lo}..${r.hi})  ${r.name}`);
const max = rows[0]?.range ?? 0;
const p95 = rows[Math.floor(rows.length * 0.05)]?.range ?? 0;
const median = rows[Math.floor(rows.length / 2)]?.range ?? 0;
console.log(`\n  weapons measured: ${rows.length}  (failed/skipped ${failed})`);
console.log(`  max range: ${max}   p95: ${p95}   median: ${median}`);
console.log(`\n  => useful steps cap = ${max}`);
