/**
 * Benchmark for the proposed 3-objective simplex sweep.
 *
 * The open question is not whether a sweep is possible -- paretoExplorer already
 * sweeps one axis -- but whether it is worth doing:
 *   1. how long one Tchebycheff solve takes on a real weapon,
 *   2. how many DISTINCT builds N weight vectors actually produce.
 *
 * (2) is the one that decides it. If 45 weight vectors collapse to 5 builds, the
 * sweep is 40 wasted solves and the answer is a solution pool instead.
 *
 * Run: cd frontend && npx tsx bench_simplex_sweep.ts
 */

import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve, computeIdealPoint } from './src/solver/solver.ts';
import type { ItemLookup, SolveParams } from './src/solver/types.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';

/** All (e, r, p) with e + r + p = 100, on a grid of `k` divisions. */
function simplexWeights(k: number): Array<{ e: number; r: number; p: number }> {
  const out: Array<{ e: number; r: number; p: number }> = [];
  for (let i = 0; i <= k; i++) {
    for (let j = 0; j <= k - i; j++) {
      out.push({
        e: Math.round((i * 100) / k),
        r: Math.round((j * 100) / k),
        p: Math.round(((k - i - j) * 100) / k),
      });
    }
  }
  return out;
}

function pct(n: number, d: number): string {
  return d === 0 ? '-' : `${((100 * n) / d).toFixed(0)}%`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

async function benchWeapon(lookup: ItemLookup, weaponName: string, k: number, precise: boolean) {
  let weaponId = '';
  for (const [id, entry] of Object.entries(lookup)) {
    if (entry.type === 'gun' && ((entry.data as Record<string, unknown>).name as string ?? '').includes(weaponName)) {
      weaponId = id;
      break;
    }
  }
  if (!weaponId) {
    console.log(`  (weapon not found: ${weaponName})`);
    return null;
  }

  const tMap = performance.now();
  const cmap = buildCompatibilityMap(weaponId, lookup);
  const mapMs = performance.now() - tMap;

  const base: SolveParams = {
    weaponId,
    itemLookup: lookup,
    compatibilityMap: cmap,
    traderLevels: DEFAULT_TRADER_LEVELS,
    fleaAvailable: true,
    preciseMode: precise,
  };

  const tIdeal = performance.now();
  const ideal = await computeIdealPoint(base);
  const idealMs = performance.now() - tIdeal;

  const weights = simplexWeights(k);
  const times: number[] = [];
  const buildSigs = new Set<string>();
  const statSigs = new Set<string>();
  const points: Array<{ ergo: number; rv: number; price: number }> = [];
  let failed = 0;

  const tAll = performance.now();
  for (const w of weights) {
    const t0 = performance.now();
    const res = await solve({
      ...base,
      ergoWeight: w.e,
      recoilWeight: w.r,
      priceWeight: w.p,
      useTchebycheff: true,
      idealPoint: ideal,
    });
    times.push(performance.now() - t0);
    if (res.status !== 'optimal' || !res.final_stats) {
      failed++;
      continue;
    }
    // Identity of a build is its item set, not its objective values.
    buildSigs.add(res.selected_items.map(i => i.id).sort().join(','));
    const s = res.final_stats;
    statSigs.add(`${s.ergonomics.toFixed(1)}|${s.recoil_vertical.toFixed(1)}|${Math.round(s.total_price)}`);
    points.push({ ergo: s.ergonomics, rv: s.recoil_vertical, price: s.total_price });
  }
  const totalMs = performance.now() - tAll;

  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);

  console.log(`\n  ${weaponName}  [${precise ? 'precise' : 'fast'}]  k=${k}`);
  console.log(`    compat map: ${Math.round(mapMs)}ms   ideal point: ${Math.round(idealMs)}ms`);
  console.log(`    solves: ${weights.length}  failed: ${failed}`);
  console.log(`    per solve: mean ${Math.round(mean)}ms  p50 ${Math.round(quantile(times, 0.5))}ms  p90 ${Math.round(quantile(times, 0.9))}ms  max ${Math.round(times[times.length - 1] ?? 0)}ms`);
  console.log(`    sweep wall clock: ${(totalMs / 1000).toFixed(1)}s  (+${Math.round(idealMs)}ms ideal)`);
  console.log(`    DISTINCT builds: ${buildSigs.size} / ${weights.length}  (${pct(buildSigs.size, weights.length)} unique)`);
  console.log(`    distinct stat triples: ${statSigs.size}`);

  if (points.length) {
    const er = points.map(p => p.ergo);
    const rr = points.map(p => p.rv);
    const pr = points.map(p => p.price);
    console.log(`    spread: ergo ${Math.min(...er).toFixed(1)}..${Math.max(...er).toFixed(1)}  recoil ${Math.min(...rr).toFixed(1)}..${Math.max(...rr).toFixed(1)}  price ₽${Math.round(Math.min(...pr)).toLocaleString()}..₽${Math.round(Math.max(...pr)).toLocaleString()}`);
  }

  return { weaponName, k, precise, solves: weights.length, distinct: buildSigs.size, totalMs, mean, idealMs };
}

async function main() {
  console.log('Fetching game data via JSON API...');
  const t0 = performance.now();
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(guns, mods);
  console.log(`Data loaded in ${Math.round(performance.now() - t0)}ms\n`);

  console.log('=== Simplex sweep benchmark ===');
  console.log('grid k -> solves: k=2->6, k=4->15, k=6->28, k=8->45');

  const results = [];
  // Two weapons of different mod-tree size, plus one precise-mode comparison.
  results.push(await benchWeapon(lookup, 'M4A1', 4, false));
  results.push(await benchWeapon(lookup, 'M4A1', 6, false));
  results.push(await benchWeapon(lookup, 'AK-74M', 6, false));
  results.push(await benchWeapon(lookup, 'MP5', 6, false));
  results.push(await benchWeapon(lookup, 'M4A1', 4, true));

  console.log('\n=== Summary ===');
  for (const r of results) {
    if (!r) continue;
    const perBuild = r.totalMs / Math.max(1, r.distinct);
    console.log(
      `  ${r.weaponName.padEnd(8)} k=${r.k} ${(r.precise ? 'precise' : 'fast').padEnd(7)} ` +
      `${String(r.solves).padStart(2)} solves -> ${String(r.distinct).padStart(2)} builds  ` +
      `${(r.totalMs / 1000).toFixed(1)}s total  ${Math.round(perBuild)}ms per distinct build`,
    );
  }
}

main().catch(e => {
  console.error('Benchmark failed:', e);
  process.exit(1);
});
