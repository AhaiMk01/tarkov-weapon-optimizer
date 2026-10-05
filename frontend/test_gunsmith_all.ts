/**
 * Verify every row in public/tasks.json against the HiGHS solver (same params as Gunsmith UI).
 *
 * Precision is resolved as the app resolves 'auto': the exact (Precise) model for a weapon whose exact model is small enough to solve to a proof
 * within the request deadline, the Fast model for the large ones (the AK and M4A1 families, whose unreduced exact model is far slower:
 * Part 7 (M4A1) found no incumbent in the 60 s default deadline, Part 6 (AKM) needed 54 s). This test used to force Precise on every task,
 * which was affordable only while Precise was the cheap template model with a placement trick.
 * Run: cd frontend && npx tsx test_gunsmith_all.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ensureDataLoaded } from './src/solver/dataService.ts';
import { buildCompatibilityMap } from './src/solver/compatibilityMap.ts';
import { solve } from './src/solver/solver.ts';
import { DEFAULT_TRADER_LEVELS } from './src/solver/types.ts';
import { normalizePrecisionRequest, resolvePreciseFlag } from './src/solver/precisionMode.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface GunsmithTaskRow {
  task_name: string;
  weapon_id: string;
  constraints: {
    min_ergonomics?: number;
    max_recoil_sum?: number;
    min_mag_capacity?: number;
    min_sighting_range?: number;
    max_weight?: number;
  };
  required_item_ids?: string[];
  required_category_group_ids?: string[][];
}

async function runTask(
  t: GunsmithTaskRow,
  itemLookup: Awaited<ReturnType<typeof ensureDataLoaded>>['itemLookup'],
) {
  const cmap = buildCompatibilityMap(t.weapon_id, itemLookup);
  const preciseMode = resolvePreciseFlag(normalizePrecisionRequest('auto'), cmap);
  return { mode: preciseMode ? 'precise' : 'fast', result: await solve({
    weaponId: t.weapon_id,
    itemLookup,
    compatibilityMap: cmap,
    minErgonomics: t.constraints.min_ergonomics ?? null,
    maxRecoilSum: t.constraints.max_recoil_sum ?? null,
    minMagCapacity: t.constraints.min_mag_capacity ?? null,
    minSightingRange: t.constraints.min_sighting_range ?? null,
    maxWeight: t.constraints.max_weight ?? null,
    includeItems: t.required_item_ids?.length ? t.required_item_ids : null,
    includeCategories: t.required_category_group_ids?.length
      ? t.required_category_group_ids.map((g) => [...g])
      : null,
    ergoWeight: 1,
    recoilWeight: 1,
    priceWeight: 0.5,
    traderLevels: DEFAULT_TRADER_LEVELS,
    fleaAvailable: true,
    playerLevel: 60,
    preciseMode,
  }) };
}

async function main() {
  const tasksPath = path.join(__dirname, 'public', 'tasks.json');
  const tasks: GunsmithTaskRow[] = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

  console.log('Loading Tarkov.dev data (en/regular)...');
  const { itemLookup } = await ensureDataLoaded('en', 'regular');

  let pass = 0;
  let fail = 0;

  for (const t of tasks) {
    const gun = itemLookup[t.weapon_id];
    if (!gun || gun.type !== 'gun') {
      console.log(`[SKIP] ${t.task_name}: weapon_id ${t.weapon_id} missing from lookup`);
      fail++;
      continue;
    }

    const missingReq = (t.required_item_ids ?? []).filter((id) => !itemLookup[id]);
    if (missingReq.length) {
      console.log(`[SKIP] ${t.task_name}: required_item_ids not in lookup: ${missingReq.join(', ')}`);
      fail++;
      continue;
    }

    const { mode, result: res } = await runTask(t, itemLookup);

    if (res.status === 'optimal') {
      pass++;
      const st = res.final_stats!;
      console.log(
        `[OK] ${t.task_name} (${mode} ${res.solve_time_ms?.toFixed(0) ?? '?'}ms) ergo=${st.ergonomics.toFixed(1)} recoil_v=${st.recoil_vertical.toFixed(1)} ₽${st.total_price}`,
      );
    } else {
      fail++;
      console.log(
        `[FAIL] ${t.task_name} (${mode}) status=${res.status} reason=${res.reason ?? 'n/a'}`,
      );
    }
  }

  console.log(`\nSummary: ${pass} optimal, ${fail} failed/skipped (of ${tasks.length})`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
