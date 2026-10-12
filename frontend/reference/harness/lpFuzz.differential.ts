// Deterministic randomized fixtures and requests for the model-level gates (Stage 2, phase 2.4b-2).
//
// The 149 ledger cases are hand-derived and few; this generates small random weapons (nested optional and required slots, repeated parts,
// template/self/slot conflicts, categories on a two-level chain, offers of every kind, presets with counts, a stash) with random requests, and
// gives the gates a second, much wider population. Every number is chosen on a binary-exact grid (multiples of 1/32, 1/16 or 1/4), so a cap that
// equals some build's statistic is exactly representable and no case sits within the solver tolerance of its own boundary by rounding alone.
//
// Caps are drawn from the statistics of real builds (found with the oracle on the uncapped request), so a large share of caps sit exactly on a
// feasible build's value: boundary behavior is exercised, not only slack.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import {
  enumerateBuilds, inspectBuild, resolveFixture, resolveRequest, runOracle, toNumber, toString as qToString,
  type ReferenceFixture, type ReferenceItem, type ReferenceOffer, type ReferencePreset, type ReferenceRequest, type ReferenceSlot, type ReferenceWeapon,
} from '../oracle/index';
import { admittedFor } from '../ledger/outcomes';
import type { LedgerCase } from '../ledger/index';

/** mulberry32. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Dice {
  readonly next: () => number;
  constructor(seed: number) {
    this.next = prng(seed);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  some<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < count && pool.length > 0) out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    return out;
  }
}

const TRADERS = ['prapor', 'skier', 'mechanic'];

function offersFor(d: Dice, kind: 'item' | 'receiver' | 'preset'): ReferenceOffer[] {
  const out: ReferenceOffer[] = [];
  const price = (lo: number, hi: number, step: number): number => step * d.int(lo / step, hi / step);
  if (kind === 'item') {
    if (d.chance(0.8)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 3), price: price(50, 400, 50) });
    if (d.chance(0.12)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 4), price: price(50, 400, 50) });
    if (d.chance(0.25)) out.push({ kind: 'flea', price: price(50, 500, 50), minPlayerLevel: d.pick([0, 15, 25]) });
    if (d.chance(0.25)) {
      const offeredCount = d.chance(0.5) ? d.int(2, 3) : 1;
      out.push({
        kind: 'barter', trader: d.pick(TRADERS), level: d.int(1, 3), offeredCount, requiresDogtag: d.chance(0.2),
        requirements: [{ count: d.int(1, 3), basePrice: price(50, 200, 50) }],
      });
    }
    return out;
  }
  if (d.chance(kind === 'receiver' ? 0.92 : 0.9)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 2), price: price(3000, 6000, 500) });
  if (kind === 'preset' && d.chance(0.2)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 3), price: price(2000, 5000, 500) });
  return out;
}

export interface FuzzCase {
  seed: number;
  fixture: ReferenceFixture;
  request: ReferenceRequest;
}

export function generateCase(seed: number): FuzzCase {
  const d = new Dice(seed);
  const itemCount = d.int(4, 7);
  const itemIds = Array.from({ length: itemCount }, (_, i) => `i${i}`);
  const categoryLeaf = ['catA', 'catB', 'catC'];
  const categoryParent = ['parP', 'parQ'];

  const slotsOf = (ownerId: string, ownerIndex: number, count: number): ReferenceSlot[] => {
    const slots: ReferenceSlot[] = [];
    for (let k = 0; k < count; k++) {
      // Mostly acyclic (children have a higher index); occasionally a back reference, which makes the part graph cyclic: such a world is out of
      // scope (owner decision 2026-10-12; production throws an internal error) and the gates skip it, so every seed still draws the world it drew before.
      const forward = itemIds.filter((_, j) => j > ownerIndex);
      const pool = d.chance(0.1) ? itemIds : forward.length > 0 ? forward : itemIds;
      const allowed = d.some(pool, d.int(1, Math.min(3, pool.length)));
      slots.push({ id: `${ownerId}_s${k}`, required: d.chance(0.1), allowedItemIds: allowed });
    }
    return slots;
  };

  const items: ReferenceItem[] = itemIds.map((id, index) => {
    const item: ReferenceItem = {
      id,
      categories: [d.pick(categoryLeaf), d.pick(categoryParent)],
      weightKg: d.pick([-0.25, 0, 0.25, 0.5, 0.75, 1, 1.5]),
      ergonomics: d.int(-6, 12),
      recoilModifier: d.int(-6, 4) / 32,
      accuracyModifier: d.pick([0, 0, -5, -2, 2, 5, 10]),
      centerOfImpact: d.chance(0.18) ? d.pick([0.125, 0.25, 0.5, -0.25]) : 0,
      magazineCapacity: d.chance(0.2) ? d.pick([10, 20, 30]) : 0,
      sightingRange: d.chance(0.2) ? d.pick([100, 200]) : 0,
      slots: d.chance(0.5) ? slotsOf(id, index, d.chance(0.25) ? 2 : 1) : [],
      conflictingItemIds: [],
      conflictingSlotIds: [],
      offers: offersFor(d, 'item'),
    };
    return item;
  });
  const weapon: ReferenceWeapon = {
    id: 'gun',
    categories: ['catW', 'parW'],
    weightKg: d.pick([1, 1.5, 2, 3]),
    ergonomics: d.int(0, 60),
    recoilVertical: d.chance(0.12) ? d.pick([0, -10]) : d.int(50, 150),
    recoilHorizontal: d.int(20, 90),
    centerOfImpact: d.pick([0, 0.0625, 0.125]),
    sightingRange: d.chance(0.3) ? 100 : 0,
    slots: slotsOf('gun', -1, d.int(2, 3)),
    conflictingItemIds: d.chance(0.1) ? [d.pick(itemIds)] : [],
    offers: offersFor(d, 'receiver'),
  };
  // Conflicts (listed on one side), self-conflicts and slot conflicts.
  const everySlotId = [...(weapon.slots ?? []), ...items.flatMap(i => i.slots ?? [])].map(s => s.id);
  for (const a of items) {
    for (const b of items) if (a.id !== b.id && d.chance(0.07)) a.conflictingItemIds = [...(a.conflictingItemIds ?? []), b.id];
    if (d.chance(0.05)) a.conflictingItemIds = [...(a.conflictingItemIds ?? []), a.id];
    if (d.chance(0.08) && everySlotId.length > 0) a.conflictingSlotIds = [d.pick(everySlotId)];
  }
  const presets: ReferencePreset[] = [];
  for (let p = 0; p < d.int(0, 2); p++) {
    presets.push({
      id: `P${p}`,
      weaponId: 'gun',
      components: d.some(itemIds, d.int(1, 3)).map(itemId => ({ itemId, count: d.int(1, 2) })),
      offers: offersFor(d, 'preset'),
    });
  }
  const fixture: ReferenceFixture = { schemaVersion: 1, items, weapons: [weapon], presets };

  // --- request without caps ---
  const request: ReferenceRequest = { weapon_id: 'gun' };
  request.ergo_weight = d.pick([0, 1, 1, 2]);
  request.recoil_weight = d.pick([0, 1, 1, 3]);
  request.price_weight = d.pick([0, 0, 1, 500, 2000]);
  if (d.chance(0.35)) request.owned_items = Array.from({ length: d.int(1, 3) }, () => d.pick(itemIds));
  if (d.chance(0.2)) request.include_items = [d.pick(itemIds)];
  if (d.chance(0.12)) request.include_categories = [[d.pick([...categoryLeaf, ...categoryParent])]];
  if (d.chance(0.12)) request.exclude_items = [d.pick(itemIds)];
  if (d.chance(0.1)) request.exclude_categories = [d.pick([...categoryLeaf, ...categoryParent])];
  if (d.chance(0.25)) request.trader_levels = Object.fromEntries(TRADERS.map(t => [t, d.pick([0, 1, 2, 3, 4, 4, 4])]).filter(() => d.chance(0.6)));
  if (d.chance(0.1)) request.flea_available = false;
  if (d.chance(0.5)) request.barter_available = true;
  if (d.chance(0.3)) request.barter_exclude_dogtags = true;
  if (d.chance(0.3)) request.player_level = d.pick([10, 20, 30]);
  if (d.chance(0.2)) request.use_true_ergo = true;
  if (d.chance(0.12)) request.prevent_overswing = true;
  if (request.use_true_ergo || request.prevent_overswing) request.equip_ergo_modifier = d.pick([0, 0, -0.25, 0.25, -1, -2]);
  if (d.chance(0.1)) {
    const zE = d.int(50, 300);
    const zR = -d.int(0, 300);
    const zP = d.int(0, 5000);
    request.use_tchebycheff = true;
    request.ideal_point = { zE, nadE: zE - d.int(0, 200), zR, nadR: zR + d.int(0, 300), zP, nadP: zP + d.int(0, 8000) };
  }

  // --- caps drawn from real builds' statistics ---
  const builds = enumerateBuilds(fixture, request, { maxBuilds: 4000 }).builds;
  if (builds.length > 0) {
    const rf = resolveFixture(fixture);
    const rr = resolveRequest(fixture, request);
    const stats: NonNullable<ReturnType<typeof inspectBuild>['stats']>[] = [];
    for (let k = 0; k < Math.min(builds.length, 60); k++) {
      const { stats: s } = inspectBuild(rf, rr, builds[Math.floor((k * builds.length) / Math.min(builds.length, 60))]);
      if (s) stats.push(s);
    }
    if (stats.length > 0) {
      const any = () => d.pick(stats);
      if (d.chance(0.22)) request.max_price = toNumber(any().spend) + d.pick([0, 0, 0, -1, 250]);
      if (d.chance(0.15)) request.min_ergonomics = toNumber(any().ergonomics) + d.pick([0, 0, 1]);
      if (d.chance(0.12)) request.max_recoil_v = toNumber(any().recoilVertical) + d.pick([0, 0, -1]);
      if (d.chance(0.1)) request.max_recoil_sum = toNumber(any().recoilVertical) + toNumber(any().recoilHorizontal) + d.pick([0, 5]);
      if (d.chance(0.12)) request.max_weight = toNumber(any().weight) + d.pick([0, 0, -0.25]);
      if (d.chance(0.1)) request.min_mag_capacity = toNumber(any().magazineCapacity) + d.pick([0, 0, 5]);
      if (d.chance(0.1)) request.min_sighting_range = toNumber(any().sightingRange) + d.pick([0, 0, 50]);
      if (d.chance(0.15)) request.max_moa = Math.round((toNumber(any().moa) + d.pick([0.05, -0.05, 0.3, -0.3])) * 100) / 100;
    }
  }
  return { seed, fixture, request };
}

/**
 * The case as a ledger-shaped record the gates can run: the expectation is the oracle's own exact maximum (there is no hand derivation
 * for a random case; the gates compare the model with the oracle's exhaustive answer, not with a derived one).
 */
export function asLedgerCase(fuzz: FuzzCase): LedgerCase | null {
  const oracle = runOracle(fuzz.fixture, fuzz.request);
  if (!oracle.complete) return null;
  const moaDependent = fuzz.request.max_moa !== undefined && fuzz.request.max_moa !== null;
  return {
    id: `fuzz-${fuzz.seed}`,
    family: 1,
    subcases: [],
    title: `random case ${fuzz.seed}`,
    adrRefs: [],
    prerequisites: '',
    source: '',
    fixture: fuzz.fixture,
    request: fuzz.request,
    moaDependent,
    expected: {
      projectionKeys: oracle.projectionKeys,
      maxScore: oracle.maxScore === null ? null : qToString(oracle.maxScore),
      maximizers: oracle.maximizers,
      empty: oracle.empty,
    },
    runtimeTolerance: { absolute: 1e-9, kind: 'well_separated', gap: null, resolvableAtTolerance: true },
    admitted: admittedFor(moaDependent, oracle.empty),
    derivation: '',
    notes: [],
  };
}
