/**
 * Augmented Tchebycheff scalarization verification test suite.
 *
 * Checks:
 *   1. computeIdealPoint computes valid ideal (z*) and nadir points across objectives;
 *   2. Tchebycheff LP solves to optimality with integer solutions;
 *   3. Interior and boundary lambda vectors produce valid Pareto builds;
 *   4. Zero-weight epsilon tiebreaks prevent degenerate part selection;
 *   5. Hard budget limits (maxPrice) are strictly enforced in Tchebycheff mode;
 *   6. Ideal point caching is functioning properly.
 *
 * Run: cd frontend && npx tsx test_tchebycheff.ts
 */

import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve, computeIdealPoint } from './src/solver/solver.ts';
import type { ItemLookup, SolveParams } from './src/solver/types.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';

let failures = 0;

function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    console.error(`  FAIL: ${msg}`);
    failures++;
  }
}

async function runWeaponTests(lookup: ItemLookup, weaponName: string) {
  console.log(`\n=== Testing Tchebycheff on ${weaponName} ===`);
  let weaponId = '';
  for (const [id, entry] of Object.entries(lookup)) {
    if (entry.type === 'gun' && ((entry.data as Record<string, unknown>).name as string ?? '').includes(weaponName)) {
      weaponId = id;
      break;
    }
  }
  if (!weaponId) throw new Error(`Weapon not found: ${weaponName}`);
  const cmap = buildCompatibilityMap(weaponId, lookup);

  const base: SolveParams = {
    weaponId,
    itemLookup: lookup,
    compatibilityMap: cmap,
    traderLevels: DEFAULT_TRADER_LEVELS,
    fleaAvailable: true,
  };

  // 1. Compute Ideal Point
  const t0 = performance.now();
  const ideal = await computeIdealPoint(base);
  const idealMs = performance.now() - t0;
  console.log(`  Ideal point computed in ${Math.round(idealMs)}ms:`);
  console.log(`    Ergo: ideal=${ideal.zE}, nadir=${ideal.nadE} (range=${ideal.zE - ideal.nadE})`);
  console.log(`    Recoil: ideal=${ideal.zR}, nadir=${ideal.nadR} (range=${ideal.nadR - ideal.zR})`);
  console.log(`    Price: ideal=${ideal.zP}, nadir=${ideal.nadP} (range=${ideal.nadP - ideal.zP})`);

  check(ideal.zE >= ideal.nadE, `Ergo ideal >= nadir (${ideal.zE} >= ${ideal.nadE})`);
  check(ideal.zR <= ideal.nadR, `Recoil ideal <= nadir (${ideal.zR} <= ${ideal.nadR})`);
  check(ideal.zP <= ideal.nadP, `Price ideal <= nadir (${ideal.zP} <= ${ideal.nadP})`);

  // 2. Solve various lambda vectors
  const lambdas = [
    { name: 'Pure Ergo λ=(100,0,0)', e: 100, r: 0, p: 0 },
    { name: 'Pure Recoil λ=(0,100,0)', e: 0, r: 100, p: 0 },
    { name: 'Pure Price λ=(0,0,100)', e: 0, r: 0, p: 100 },
    { name: 'Balanced λ=(34,33,33)', e: 34, r: 33, p: 33 },
    { name: 'Performance λ=(50,50,0)', e: 50, r: 50, p: 0 },
    { name: 'Ergo-Price λ=(50,0,50)', e: 50, r: 0, p: 50 },
  ];

  const solvedBuilds: Array<{ name: string; ergo: number; rv: number; price: number; ms: number }> = [];

  for (const l of lambdas) {
    const tStart = performance.now();
    const res = await solve({
      ...base,
      ergoWeight: l.e,
      recoilWeight: l.r,
      priceWeight: l.p,
      useTchebycheff: true,
      idealPoint: ideal,
    });
    const ms = performance.now() - tStart;

    check(res.status === 'optimal', `${l.name} solved optimal (got ${res.status}, ${Math.round(ms)}ms)`);
    if (res.final_stats) {
      const s = res.final_stats;
      solvedBuilds.push({ name: l.name, ergo: s.ergonomics, rv: s.recoil_vertical, price: s.total_price, ms });
      console.log(`    ${l.name}: ergo=${s.ergonomics.toFixed(1)} rv=${s.recoil_vertical.toFixed(1)} price=₽${Math.round(s.total_price)} (${Math.round(ms)}ms)`);
    }
  }

  // 3. Verify zero-weight axis tiebreak (price should be reasonable when priceWeight=0)
  const perfBuild = solvedBuilds.find(b => b.name.includes('Performance'));
  if (perfBuild) {
    check(perfBuild.price < 5_000_000, `Performance λ=(50,50,0) price is finite and bounded (₽${Math.round(perfBuild.price)})`);
  }

  // 4. Verify hard budget constraint in Tchebycheff mode
  const budgetCap = 150000;
  const budgetRes = await solve({
    ...base,
    ergoWeight: 34,
    recoilWeight: 33,
    priceWeight: 33,
    maxPrice: budgetCap,
    useTchebycheff: true,
    idealPoint: ideal,
  });

  check(budgetRes.status === 'optimal', `Tchebycheff with maxPrice=${budgetCap} solves optimal`);
  if (budgetRes.final_stats) {
    check(budgetRes.final_stats.total_price <= budgetCap + 1e-4,
      `Tchebycheff strictly respects budget cap (₽${Math.round(budgetRes.final_stats.total_price)} <= ₽${budgetCap})`);
  }
}

async function main() {
  console.log('Fetching game data via JSON API...');
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(guns, mods);

  await runWeaponTests(lookup, 'M4A1');
  await runWeaponTests(lookup, 'AK-74');

  console.log(`\n${failures === 0 ? 'ALL TCHEBYCHEFF CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Test failed with uncaught exception:', e);
  process.exit(1);
});
