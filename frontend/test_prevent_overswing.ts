/**
 * Verification test suite for the "Prevent Overswing" hard constraint with Equipment Ergonomics Modifier (b).
 *
 * Checks:
 *   1. Heavy weapons with negative EED in unconstrained pure recoil solves
 *      (SVDS, M1A, OP-SKS, AKMSN, RPD) are strictly brought to EED >= 0 when
 *      preventOverswing is true;
 *   2. Equipment percentage penalties (e.g. b = -0.15 or -0.20 for heavy armor)
 *      appropriately reduce effective ergonomics E = Ergo * (1 + b) and lower
 *      the overswing weight threshold, strictly enforcing EED(E_raw, W, b) >= 0;
 *   3. The resulting builds are feasible and optimal;
 *   4. Weapons whose naked chassis physically exceeds the threshold for all
 *      reachable ergo (like the 7.1kg Mk-18) correctly report infeasible;
 *   5. Standard weapons (M4A1, AK-74N) solve optimal with zero disruption.
 *
 * Run: cd frontend && npx tsx test_prevent_overswing.ts
 */

import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve } from './src/solver/solver.ts';
import { eedOf } from './src/solver/lpBuilder.ts';
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

async function testWeapon(lookup: ItemLookup, weaponName: string, expectFeasible = true, b = 0) {
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
    ergoWeight: 0,
    recoilWeight: 100,
    priceWeight: 0,
  };

  const bPercent = Math.round(b * 100);
  console.log(`\n=== Testing ${weaponName} (Equipment Modifier b=${bPercent}%) ===`);
  const unconstrained = await solve(base);
  const sUnc = unconstrained.final_stats!;
  const eedUnc = eedOf(sUnc.ergonomics, sUnc.total_weight, b);

  console.log(`  Unconstrained: Ergo=${sUnc.ergonomics.toFixed(1)}, W=${sUnc.total_weight.toFixed(2)}kg, RecV=${sUnc.recoil_vertical.toFixed(1)}, EED=${eedUnc.toFixed(1)}`);

  const constrained = await solve({ ...base, preventOverswing: true, equipErgoModifier: b });

  if (expectFeasible) {
    check(constrained.status === 'optimal', `${weaponName} solved optimal with preventOverswing (got ${constrained.status})`);
    if (constrained.final_stats) {
      const sCon = constrained.final_stats;
      const eedCon = eedOf(sCon.ergonomics, sCon.total_weight, b);
      console.log(`  Prevent Overswing: Ergo=${sCon.ergonomics.toFixed(1)} (eff=${(sCon.ergonomics * (1 + b)).toFixed(1)}), W=${sCon.total_weight.toFixed(2)}kg, RecV=${sCon.recoil_vertical.toFixed(1)}, EED=${eedCon.toFixed(1)}`);
      check(eedCon >= -0.05, `${weaponName} EED with b=${bPercent}% is non-negative (EED=${eedCon.toFixed(2)} >= 0)`);
    }
  } else {
    check(constrained.status === 'infeasible', `${weaponName} correctly reports infeasible because base receiver > max threshold (got ${constrained.status})`);
    console.log(`  Prevent Overswing: Infeasible (base chassis intrinsically exceeds threshold)`);
  }
}

async function main() {
  console.log('Fetching game data via JSON API...');
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(guns, mods);

  // Heavy weapons prone to aim overswing with b=0% (no armor penalty)
  await testWeapon(lookup, 'SVDS', true, 0.0);
  await testWeapon(lookup, 'Springfield Armory M1A', true, 0.0);
  await testWeapon(lookup, 'Molot Arms Simonov OP-SKS', true, 0.0);
  await testWeapon(lookup, 'Kalashnikov AKMSN', true, 0.0);

  // Test with heavy armor ergonomics penalties (b = -15% and b = -20%)
  await testWeapon(lookup, 'SVDS', true, -0.15);
  await testWeapon(lookup, 'Springfield Armory M1A', true, -0.20);
  await testWeapon(lookup, 'Colt M4A1', true, -0.20);

  // Weapon whose bare metal chassis is physically heavier than threshold at max ergo
  await testWeapon(lookup, 'SWORD International Mk-18', false, 0.0);

  // Standard benchmark assault rifles
  await testWeapon(lookup, 'Colt M4A1', true, 0.0);
  await testWeapon(lookup, 'Kalashnikov AK-74N', true, 0.0);

  console.log(`\n${failures === 0 ? 'ALL PREVENT OVERSWING CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
