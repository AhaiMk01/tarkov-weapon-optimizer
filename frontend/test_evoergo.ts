/**
 * EvoErgo objective verification (k-sweep version).
 *
 * solveEvoErgo sweeps k ∈ EVO_ERGO_SWEEP_KS and returns the build with the
 * best true EED (EFTForge's quadratic threshold curve, b = 0). Checks:
 *   1. raw-ergo and EvoErgo solves are optimal;
 *   2. the raw-ergo build has the highest raw ergo of the two;
 *   3. the sweep build's true EED beats the raw build's and is at least as
 *      good as every fixed-k single solve (sweep dominates its members);
 *   4. final_stats.evo_ergo is the community metric min(100, ergo) − 15·kg and
 *      final_stats.eed matches the quadratic, on both paths;
 *   5. the response reports which k won (evo_ergo_k ∈ EVO_ERGO_SWEEP_KS).
 *
 * Run: cd frontend && npx tsx test_evoergo.ts
 */

import { fetchAllData, buildItemLookup } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve, solveEvoErgo } from './src/solver/solver.ts';
import { EVO_ERGO_K, EVO_ERGO_SWEEP_KS, eedOf } from './src/solver/lpBuilder.ts';
import type { ItemLookup, SolveParams } from './src/solver/types.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';

const EPS = 1e-6;
let failures = 0;

function check(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}

function ee15Of(stats: { ergonomics: number; total_weight: number }): number {
  return Math.min(100, Math.max(0, stats.ergonomics)) - EVO_ERGO_K * stats.total_weight;
}

async function runWeapon(lookup: ItemLookup, weaponId: string, name: string) {
  console.log(`\n=== ${name} (${weaponId}) ===`);
  const cmap = buildCompatibilityMap(weaponId, lookup);

  const base: SolveParams = {
    weaponId,
    itemLookup: lookup,
    compatibilityMap: cmap,
    ergoWeight: 100,
    recoilWeight: 0,
    priceWeight: 0,
    traderLevels: DEFAULT_TRADER_LEVELS,
    fleaAvailable: true,
  };

  const rawResult = await solve({ ...base, useEvoErgo: false });
  const eeResult = await solveEvoErgo({ ...base, useEvoErgo: true });

  check(rawResult.status === 'optimal', `raw-ergo solve optimal (got ${rawResult.status})`);
  check(eeResult.status === 'optimal', `EvoErgo sweep solve optimal (got ${eeResult.status})`);
  if (!rawResult.final_stats || !eeResult.final_stats) return;

  const raw = rawResult.final_stats;
  const ee = eeResult.final_stats;
  const rawEed = eedOf(raw.ergonomics, raw.total_weight);
  const eeEed = eedOf(ee.ergonomics, ee.total_weight);
  console.log(`  raw-ergo build: ergo=${raw.ergonomics.toFixed(1)} weight=${raw.total_weight.toFixed(2)}kg EE15=${ee15Of(raw).toFixed(1)} EED=${rawEed.toFixed(1)}`);
  console.log(`  EvoErgo build:  ergo=${ee.ergonomics.toFixed(1)} weight=${ee.total_weight.toFixed(2)}kg EE15=${ee15Of(ee).toFixed(1)} EED=${eeEed.toFixed(1)} (k=${eeResult.evo_ergo_k})`);

  check(raw.ergonomics >= ee.ergonomics - EPS,
    `raw-ergo objective maximizes raw ergo (${raw.ergonomics.toFixed(1)} >= ${ee.ergonomics.toFixed(1)})`);
  check(eeEed >= rawEed - EPS,
    `sweep build's true EED beats raw build (${eeEed.toFixed(1)} >= ${rawEed.toFixed(1)})`);
  // winning k is a sweep value or the weapon-specific tangent refinement k(E) ∈ (5.6, 15]
  check(eeResult.evo_ergo_k != null && eeResult.evo_ergo_k >= 5 && eeResult.evo_ergo_k <= 16,
    `winning k reported and plausible (k=${eeResult.evo_ergo_k?.toFixed(2)})`);

  // Sweep must dominate each of its fixed-k members. Tolerance 0.5 EED: the
  // winner is picked by a weight-consistent score, so the floored recoil/price
  // tiebreak weights may legitimately prefer a near-tied candidate.
  for (const k of EVO_ERGO_SWEEP_KS) {
    const single = await solve({ ...base, useEvoErgo: true, evoErgoK: k });
    if (single.status !== 'optimal' || !single.final_stats) {
      check(false, `fixed k=${k} solve optimal (got ${single.status})`);
      continue;
    }
    const singleEed = eedOf(single.final_stats.ergonomics, single.final_stats.total_weight);
    check(eeEed >= singleEed - 0.5,
      `sweep EED >= fixed k=${k} EED (${eeEed.toFixed(2)} >= ${singleEed.toFixed(2)})`);
  }

  // Stat integrity on both paths
  check(ee.evo_ergo != null && Math.abs(ee.evo_ergo - ee15Of(ee)) < 1e-9,
    `evo_ergo stat is community ergo − 15·kg (${ee.evo_ergo?.toFixed(3)})`);
  check(ee.eed != null && Math.abs(ee.eed - eeEed) < 1e-9,
    `eed stat matches quadratic (${ee.eed?.toFixed(3)})`);
  check(raw.evo_ergo != null && raw.eed != null,
    `evo_ergo and eed also reported when EE mode is off`);

  // Show what the weight penalty actually changed
  const rawIds = new Set(rawResult.selected_items.map(i => i.id));
  const eeIds = new Set(eeResult.selected_items.map(i => i.id));
  const dropped = rawResult.selected_items.filter(i => !eeIds.has(i.id));
  const added = eeResult.selected_items.filter(i => !rawIds.has(i.id));
  if (dropped.length || added.length) {
    console.log(`  swapped by weight penalty: ${dropped.length} out, ${added.length} in`);
  } else {
    console.log(`  (identical builds — weight penalty changed nothing for this weapon)`);
  }
}

async function main() {
  console.log('Fetching en/regular via fetchAllData (JSON API path)...');
  const { guns, mods } = await fetchAllData('en', 'regular');
  const lookup = buildItemLookup(guns, mods);

  const findGun = (needle: string): [string, string] | null => {
    for (const [id, entry] of Object.entries(lookup)) {
      if (entry.type !== 'gun') continue;
      const name = ((entry.data as Record<string, unknown>).name as string) ?? '';
      if (name.toLowerCase().includes(needle.toLowerCase())) return [id, name];
    }
    return null;
  };

  // M700: heavy high-ergo stock options. AKS-74U: the case where k=15 alone
  // over-trades ergo for weight and the sweep must recover the k=10 build.
  for (const needle of ['Model 700', 'M4A1', 'AKS-74U 5.45']) {
    const g = findGun(needle);
    if (g) await runWeapon(lookup, g[0], g[1]);
    else { failures++; console.error(`FAIL: ${needle} not found in data`); }
  }

  console.log(failures === 0 ? '\nAll EvoErgo checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
