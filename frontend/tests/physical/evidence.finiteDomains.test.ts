// Stage 3 evidence, item 4 (ADR 0013 sections 4B and 4C, docs/stage3/native-evidence.md): every auxiliary column of the certified count model has a finite,
// proved domain ("give every auxiliary with nonzero error a finite proved range"; no free column). Scanned on the emitted text with the strict independent
// parser: every column of every certified model of all 153 nonempty pinned guns (default request), of MP5 / SR-25 / AK-74N / M4A1 under requests that
// add every auxiliary family (Tchebycheff deviations, caps, MOA, TED node with gear and penalty line), and of 120 seeded worlds. Each bound is also below
// HiGHS's `infinite_bound` (1e20), so the parser cannot turn it into infinity on read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLpText } from '../../src/solver/native';
import {
  computeActiveBounds, preparePhysicalWeapon, prepareSubproblemDomain, specializeCount, type CountModel, type SpatialNode, type SpecializeRequest, type SubproblemRequest,
} from '../../src/solver/physical';
import type { ItemLookup } from '../../src/solver/types';
import { loadPinned, pinnedSkip } from '../native/evidence/pinned';
import { randomTedWorld, randomWorld } from './randomWorlds';
import { WEAPON } from './lpFixtures';

const INFINITE_BOUND = 1e20;

interface Scan { columns: number; auxiliary: number; families: Set<string> }

/** Every column of both texts of a certified model: finite lower and upper bound, lower <= upper, |bound| < 1e20. */
function scanModel(label: string, model: CountModel, scan: Scan): void {
  const decision = new Set(model.decision.map(d => d.name));
  for (const text of model.edges.length > 0 ? [model.lp(), model.lpRelaxedEdges()] : [model.lp()]) {
    for (const column of parseLpText(text).columns) {
      assert.ok(Number.isFinite(column.lower) && Number.isFinite(column.upper), `${label}: column ${column.name} has domain [${column.lower}, ${column.upper}]`);
      assert.ok(column.lower <= column.upper, `${label}: column ${column.name} has an empty domain`);
      assert.ok(Math.abs(column.lower) < INFINITE_BOUND && Math.abs(column.upper) < INFINITE_BOUND, `${label}: column ${column.name} bound would read as infinite`);
    }
  }
  for (const column of parseLpText(model.lp()).columns) {
    scan.columns++;
    if (!decision.has(column.name)) {
      scan.auxiliary++;
      scan.families.add(column.name.replace(/[_\d]+$/, '').replace(/_\d+.*$/, ''));
    }
  }
}

type Request = SpecializeRequest & SubproblemRequest;
const nodeOf = (lookup: ItemLookup, blueprint: ReturnType<typeof preparePhysicalWeapon>, request: Request): SpatialNode => {
  const weight = computeActiveBounds(blueprint, prepareSubproblemDomain(blueprint, lookup, request)).weight;
  return { weightMin: weight.lo, weightMax: weight.hi };
};

test('item 4, all 153 nonempty pinned guns: every column of the certified count model (and its relaxed-first text) has a finite domain', { skip: pinnedSkip, timeout: 1_800_000 }, t => {
  const pinned = loadPinned();
  const scan: Scan = { columns: 0, auxiliary: 0, families: new Set() };
  let eligible = 0;
  const started = performance.now();
  for (const gun of pinned.guns) {
    const blueprint = preparePhysicalWeapon(pinned.lookup, gun.id, { isAmmo: pinned.isAmmo });
    const request: Request = { ergoWeight: 1, recoilWeight: 1, priceWeight: 0.5 };
    const domain = prepareSubproblemDomain(blueprint, pinned.lookup, request);
    if (domain.empty) continue;
    eligible++;
    const model = specializeCount(blueprint, domain, request);
    if (model.provedEmpty !== null) continue;
    scanModel(gun.shortName, model, scan);
  }
  assert.equal(eligible, 153);
  assert.ok(scan.auxiliary > 0);
  t.diagnostic(`${eligible} guns, ${scan.columns} columns (${scan.auxiliary} auxiliary; families ${[...scan.families].sort().join(', ')}), all finite; ${((performance.now() - started) / 1000).toFixed(1)} s`);
});

const RICH: Record<string, { request: Request; ted?: true }> = {
  tchebycheff: { request: { priceWeight: 1, recoilWeight: 1, useTchebycheff: true, idealPoint: { zE: 500, nadE: 100, zR: -300, nadR: 0, zP: 1000, nadP: 100000 } } },
  capped: { request: { maxMOA: 5, maxPrice: 300000, minMagCapacity: 20, maxRecoilV: 300, maxRecoilSum: 450, minSightingRange: 50, maxWeight: 6, minErgonomics: 20 } },
  trueErgo: { request: { useTrueErgo: true, equipErgoModifier: -0.15, recoilWeight: 1 }, ted: true },
  tedTchebycheff: { request: { useTrueErgo: true, preventOverswing: true, useTchebycheff: true, priceWeight: 1, idealPoint: { zE: 500, nadE: 100, zR: -300, nadR: 0, zP: 1000, nadP: 100000 } }, ted: true },
};

test('item 4, MP5, both SR-25s, AK-74N and M4A1 under requests that add every auxiliary family (deviations, caps, MOA, TED node with gear and penalty line): every column finite', { skip: pinnedSkip, timeout: 900_000 }, t => {
  const pinned = loadPinned();
  const scan: Scan = { columns: 0, auxiliary: 0, families: new Set() };
  let models = 0;
  for (const name of ['MP5', 'SR-25', 'AK-74N', 'M4A1']) {
    for (const gun of pinned.gunsNamed(name)) {
      const blueprint = preparePhysicalWeapon(pinned.lookup, gun.id, { isAmmo: pinned.isAmmo });
      for (const [variant, { request, ted }] of Object.entries(RICH)) {
        const domain = prepareSubproblemDomain(blueprint, pinned.lookup, request);
        if (domain.empty) continue;
        const model = specializeCount(blueprint, domain, request, ted ? nodeOf(pinned.lookup, blueprint, request) : undefined);
        if (model.provedEmpty !== null) continue;
        scanModel(`${name} ${variant}`, model, scan);
        models++;
      }
    }
  }
  assert.ok(models >= 16, `${models} models`);
  t.diagnostic(`${models} models, ${scan.columns} columns (${scan.auxiliary} auxiliary; families ${[...scan.families].sort().join(', ')}), all finite`);
});

test('item 4, 60 plain and 60 TED seeded worlds: every column of the certified count model finite, at the root and on a TED node', () => {
  const scan: Scan = { columns: 0, auxiliary: 0, families: new Set() };
  let models = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const world of [randomWorld(seed, false), randomTedWorld(seed, false)]) {
      const blueprint = preparePhysicalWeapon(world.lookup, WEAPON);
      const domain = prepareSubproblemDomain(blueprint, world.lookup, world.params);
      if (domain.empty) continue;
      const ted = world.params.useTrueErgo === true || world.params.preventOverswing === true;
      const model = specializeCount(blueprint, domain, world.params, ted ? nodeOf(world.lookup, blueprint, world.params) : undefined);
      if (model.provedEmpty !== null) continue;
      scanModel(`world ${seed}`, model, scan);
      models++;
    }
  }
  assert.ok(models >= 60, `${models} models`);
});
