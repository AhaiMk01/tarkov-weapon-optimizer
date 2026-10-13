// The Gunsmith tab on the pinned capture (ADR 0013 section 1: frontend/benchmarks/snapshot.json, SHA-256 219443b4..., restored from the hashed
// artifact when missing, never regenerated). Every task of public/tasks.json is solved the way App.handleGunsmithOptimize asks for it: Precise,
// weights 1 / 1 / 0.5, the task constraints, required items and category groups, here with the default trader levels, flea on, barters off and
// player level 60. Replaces the network-bound test_gunsmith_all.ts (Phase 2.9).
//
// Two tasks have no build in this capture, and both are facts of the data, not of the solver:
//   Part 22 (M4A1) requires the Trijicon REAP-IR, which is sold only as a barter: certified infeasible with barters off, optimal with them on.
//   Part 25 (PKP)  the PKP has no trader offer and no barter, and none of its three presets has one, so no base is accessible (ADR 0002: no
//                  free receiver; this is the "PKP preset purchase" failure the pre-cutover test reported).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OptimizeResponse } from '../../src/api/client';
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { buildItemLookup } from '../../src/solver/dataService';
import { validatePhysicalBuild } from '../../src/solver/physical';
import { solve } from '../../src/solver/solver';
import { DEFAULT_TRADER_LEVELS } from '../../src/solver/types';
import type { GunLookupEntry, ItemLookup, SolveParams } from '../../src/solver/types';

const SNAPSHOT_PATH = fileURLToPath(new URL('../../benchmarks/snapshot.json', import.meta.url));
const SNAPSHOT_SHA256 = '219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c';
const TASKS_PATH = fileURLToPath(new URL('../../public/tasks.json', import.meta.url));
const skip = existsSync(SNAPSHOT_PATH) ? false : 'frontend/benchmarks/snapshot.json is not restored (ADR 0013 section 1)';

interface GunsmithTask {
  task_name: string;
  weapon_id: string;
  constraints: { min_ergonomics?: number; max_recoil_sum?: number; min_mag_capacity?: number; min_sighting_range?: number; max_weight?: number };
  required_item_ids?: string[];
  required_category_group_ids?: string[][];
}

const REAP_IR = '5a1eaa87fcdbcb001865f75e';
const NO_BUILD_WITHOUT_BARTERS = 'Gunsmith - Part 22 (M4A1)';
const NO_BASE = 'Gunsmith - Part 25 (PKP)';

let lookup: ItemLookup = {};
if (!skip) {
  const bytes = readFileSync(SNAPSHOT_PATH);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SNAPSHOT_SHA256, 'the snapshot must be the pinned artifact');
  const snapshot = JSON.parse(bytes.toString('utf8')) as { guns: unknown[]; mods: unknown[] };
  lookup = buildItemLookup(snapshot.guns as never, snapshot.mods as never);
}
const tasks = JSON.parse(readFileSync(TASKS_PATH, 'utf8')) as GunsmithTask[];

/** The request of App.handleGunsmithOptimize for a task (always Precise). */
function paramsOf(task: GunsmithTask, barterAvailable = false): SolveParams {
  return {
    weaponId: task.weapon_id, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(task.weapon_id, lookup),
    ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5,
    minErgonomics: task.constraints.min_ergonomics, maxRecoilSum: task.constraints.max_recoil_sum, minMagCapacity: task.constraints.min_mag_capacity,
    minSightingRange: task.constraints.min_sighting_range, maxWeight: task.constraints.max_weight,
    includeItems: task.required_item_ids?.length ? task.required_item_ids : null,
    includeCategories: task.required_category_group_ids?.length ? task.required_category_group_ids : null,
    traderLevels: DEFAULT_TRADER_LEVELS, fleaAvailable: true, barterAvailable, playerLevel: 60, preciseMode: true,
  };
}

/** A certified optimum whose build stands on its own: the validator accepts it and every required item is installed. */
function assertCertifiedBuild(task: GunsmithTask, params: SolveParams, r: OptimizeResponse): void {
  assert.equal(r.status, 'optimal', `${task.task_name}: ${r.status} ${r.reason ?? ''}`);
  assert.equal(r.physical_certificate, 'certified_optimal', task.task_name);
  assert.ok(r.selected_preset && r.slot_pairs && r.final_stats, task.task_name);
  const v = validatePhysicalBuild(lookup, params, {
    base: r.selected_preset.id === task.weapon_id ? { kind: 'naked' } : { kind: 'preset', presetId: r.selected_preset.id },
    placements: r.slot_pairs,
  }, { requirePathInstanceIds: true });
  assert.equal(v.ok, true, `${task.task_name}: ${JSON.stringify(v.violations)}`);
  for (const id of task.required_item_ids ?? []) assert.ok(r.selected_item_ids?.includes(id), `${task.task_name}: required ${id} is installed`);
  const s = r.final_stats;
  const c = task.constraints;
  if (c.min_ergonomics != null) assert.ok(s.ergonomics >= c.min_ergonomics - 1e-9, `${task.task_name}: ergonomics ${s.ergonomics}`);
  if (c.max_weight != null) assert.ok(s.total_weight <= c.max_weight + 1e-9, `${task.task_name}: weight ${s.total_weight}`);
}

test('every Gunsmith task with a build in the capture is a certified optimum the validator accepts, with its required parts installed', { skip, timeout: 300_000 }, async () => {
  let certified = 0;
  for (const task of tasks) {
    if (task.task_name === NO_BUILD_WITHOUT_BARTERS || task.task_name === NO_BASE) continue;
    const params = paramsOf(task);
    assertCertifiedBuild(task, params, await solve(params));
    certified++;
  }
  assert.equal(certified, tasks.length - 2);
  assert.equal(tasks.length, 29);
});

test('Part 22 (M4A1): the required REAP-IR is barter-only, so the task is certified empty without barters and a certified optimum with them', { skip, timeout: 120_000 }, async () => {
  const task = tasks.find(t => t.task_name === NO_BUILD_WITHOUT_BARTERS)!;
  const offers = (lookup[REAP_IR] as { stats: { offers: { source: string }[] } }).stats.offers;
  assert.ok(offers.length > 0 && offers.every(o => o.source.startsWith('barter:')), 'the REAP-IR has only barter offers in the capture');
  const without = await solve(paramsOf(task));
  assert.equal(without.status, 'infeasible');
  assert.equal(without.physical_certificate, 'certified_infeasible');
  const params = paramsOf(task, true);
  const withBarters = await solve(params);
  assertCertifiedBuild(task, params, withBarters);
  assert.ok(withBarters.selected_item_ids?.includes(REAP_IR));
});

test('Part 25 (PKP): no offer, barter or preset makes the receiver accessible, so the task is certified empty with barters on or off', { skip }, async () => {
  const task = tasks.find(t => t.task_name === NO_BASE)!;
  const pkp = lookup[task.weapon_id] as GunLookupEntry;
  assert.equal(pkp.type, 'gun');
  assert.deepEqual(pkp.stats.offers, [], 'no trader or barter offer for the naked receiver');
  assert.equal(pkp.all_presets.length, 3, 'the capture lists three PKP presets');
  assert.ok(pkp.all_presets.every(p => p.offers.length === 0 && !p.purchasable), 'none of them has an offer');
  assert.deepEqual(pkp.presets, []);
  for (const barters of [false, true]) {
    const r = await solve(paramsOf(task, barters));
    assert.equal(r.status, 'infeasible', `barters ${barters}`);
    assert.equal(r.physical_certificate, 'certified_infeasible', `barters ${barters}`);
    assert.equal(r.selected_preset ?? null, null, 'no free receiver is invented');
  }
});
