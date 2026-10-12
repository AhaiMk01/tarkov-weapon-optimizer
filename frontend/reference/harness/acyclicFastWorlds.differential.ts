// Adversarial worlds for the Fast exactness gates (research task: docs/research/acyclic-fast-exactness.md).
//
// `lpFuzz.differential.ts` draws small weapons; this generator is aimed at the families where a per-template COUNT model could differ
// from the per-occurrence physical domain. Every world is a ReferenceFixture plus request, so the oracle enumerates it exhaustively.
//
//   multi-slot owner   an owner with two or three slots whose allowlists overlap (one item allowed in several slots of one owner);
//   hub                a template with a REQUIRED slot that several different owners allow, so it appears under several parents;
//   slot conflicts     blockers that name required slots, their own host slot, their own slots, slots of the hub, slots of other owners;
//   self conflicts     a template that lists itself, with multi-copy supply (a preset count above one, owned stock) and several slots to sit in;
//   supply             presets supplying copies, owned stock, capped templates (no standalone offer), whole-lot barters (lot sizes 2 to 4), zero-price
//                      lots, dominated offers, several offers of one item;
//   MOA                several barrel templates (centre of impact above zero) in different slots at once, with the accuracy sum able to pass 100 percent
//                      points when `bigAccuracy` is on, and caps on both sides of zero;
//   tight caps         caps equal to the statistic of some enumerated build, or one grid step away.
//
// Every world has an acyclic part graph (children always have a higher index). The back-edge modes that drew cyclic closures were removed with
// cyclic part data (owner decision 2026-10-12: out of scope); they drew only after every other slot draw, so every remaining seed draws the same world.
//
// Every number sits on a binary-exact grid so a cap that equals a build statistic is exactly representable. The structural features of the final
// world are measured from the world itself (`featuresOf`), never taken from what the generator intended.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import {
  enumerateBuilds, inspectBuild, resolveFixture, resolveRequest, toNumber,
  type ReferenceFixture, type ReferenceItem, type ReferenceOffer, type ReferencePreset, type ReferenceRequest, type ReferenceSlot, type ReferenceWeapon,
} from '../oracle/index';

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

export class Dice {
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

export interface AdversarialOptions {
  /** Accuracy modifiers large enough for the accuracy sum to pass 100 percent points (the MOA row's monotonicity assumption). */
  bigAccuracy?: boolean;
  /** Few templates, many slots with overlapping allowlists, and larger preset counts: deep multi-copy structure. */
  dense?: boolean;
  /** Force several barrel templates and a MOA cap. */
  moa?: boolean;
}

export interface AdversarialCase {
  seed: number;
  fixture: ReferenceFixture;
  request: ReferenceRequest;
  options: AdversarialOptions;
  /** Structural features measured from the final world (see `featuresOf`). */
  features: string[];
}

function itemOffers(d: Dice): ReferenceOffer[] {
  const out: ReferenceOffer[] = [];
  const price = (lo: number, hi: number, step: number): number => step * d.int(lo / step, hi / step);
  if (d.chance(0.12)) return out; // capped: no standalone offer at all
  if (d.chance(0.9)) out.push({ kind: 'trader', trader: 'prapor', level: 1, price: price(50, 400, 50) }); // always legal: prapor is never disabled below
  else if (d.chance(0.6)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 3), price: price(50, 400, 50) });
  if (d.chance(0.15)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 4), price: price(50, 400, 50) }); // often dominated
  if (d.chance(0.25)) out.push({ kind: 'flea', price: price(50, 500, 50), minPlayerLevel: d.pick([0, 15, 25]) });
  if (d.chance(0.35)) {
    out.push({
      kind: 'barter', trader: d.pick(TRADERS), level: d.int(1, 3), offeredCount: d.pick([1, 2, 2, 3, 4]), requiresDogtag: d.chance(0.15),
      requirements: [{ count: d.int(1, 3), basePrice: price(50, 200, 50) }],
    });
  }
  if (d.chance(0.07)) {
    // a lot whose exact total is positive but rounds to a stored price of 0 (still a legal offer)
    out.push({ kind: 'barter', trader: d.pick(TRADERS), level: 1, offeredCount: d.pick([1, 2, 3]), requirements: [{ count: 1, basePrice: 0.25 }] });
  }
  return out;
}

function baseOffers(d: Dice): ReferenceOffer[] {
  const out: ReferenceOffer[] = [];
  out.push({ kind: 'trader', trader: d.pick(TRADERS), level: 1, price: 500 * d.int(6, 12) });
  if (d.chance(0.15)) out.push({ kind: 'trader', trader: d.pick(TRADERS), level: d.int(1, 3), price: 500 * d.int(4, 10) });
  return out;
}

export function adversarialCase(seed: number, options: AdversarialOptions = {}): AdversarialCase {
  const d = new Dice(seed);
  const n = options.dense === true ? d.int(3, 4) : d.int(4, 6);
  const ids = Array.from({ length: n }, (_, i) => `i${i}`);
  const categoryLeaf = ['catA', 'catB', 'catC'];
  const categoryParent = ['parP', 'parQ'];
  const hubIndex = d.chance(0.85) && n >= 4 ? d.int(1, n - 2) : -1;
  const hub = hubIndex >= 0 ? ids[hubIndex] : null;

  // --- slots: owners are the weapon (-1) and the items; children always have a higher index (acyclic) ---
  const slotsByOwner = new Map<string, ReferenceSlot[]>();
  const ownerIndexOf = (owner: string): number => (owner === 'gun' ? -1 : ids.indexOf(owner));
  for (const owner of ['gun', ...ids]) {
    const oi = ownerIndexOf(owner);
    const pool = ids.filter((_, j) => j > oi);
    const slots: ReferenceSlot[] = [];
    if (pool.length > 0) {
      const count = options.dense === true ? (owner === 'gun' ? d.int(3, 4) : d.chance(0.7) ? d.int(2, 3) : 0) : owner === 'gun' ? d.int(2, 3) : d.chance(0.5) ? (d.chance(0.12) ? 3 : d.int(1, 2)) : 0;
      for (let k = 0; k < count; k++) {
        let allowed: string[];
        if (k > 0 && d.chance(options.dense === true ? 0.75 : 0.4)) allowed = [...slots[d.int(0, k - 1)].allowedItemIds]; // overlapping allowlist: an item allowed in several slots of one owner
        else allowed = d.some(pool, d.chance(0.12) ? Math.min(3, pool.length) : d.int(1, Math.min(2, pool.length)));
        if (hub !== null && hubIndex > oi && d.chance(owner === 'gun' ? 0.6 : 0.5) && !allowed.includes(hub)) allowed.push(hub);
        const required = owner === hub ? d.chance(0.7) : d.chance(owner === 'gun' ? 0.25 : 0.2);
        slots.push({ id: `${owner}_s${k}`, required, allowedItemIds: allowed });
      }
    }
    if (owner === hub && slots.length === 0) {
      const below = ids.filter((_, j) => j > hubIndex);
      if (below.length > 0) slots.push({ id: `${owner}_s0`, required: true, allowedItemIds: d.some(below, Math.min(2, below.length)) });
    }
    slotsByOwner.set(owner, slots);
  }
  // Barrels: several templates with a positive centre of impact, each allowed in its own slot so they can be installed together.
  const barrelIds = options.moa === true || d.chance(0.35) ? d.some(ids, d.int(2, Math.min(3, n))) : [];
  const allSlots = (): ReferenceSlot[] => [...slotsByOwner.values()].flat();
  barrelIds.forEach((b, k) => {
    const host = allSlots().filter(s => ownerIndexOf(s.id.split('_s')[0]) < ids.indexOf(b));
    if (host.length === 0) return;
    const slot = host[(k * 2 + d.int(0, host.length - 1)) % host.length];
    if (!slot.allowedItemIds.includes(b)) slot.allowedItemIds.push(b);
  });

  const accuracyPool = options.bigAccuracy === true ? [60, -40, 45, 80, -30, 55, 0, 25] : [0, 0, -5, -2, 2, 5, 10];
  const items: ReferenceItem[] = ids.map(id => {
    const isBarrel = barrelIds.includes(id);
    return {
      id,
      categories: [d.pick(categoryLeaf), d.pick(categoryParent)],
      weightKg: d.pick([-0.25, 0, 0.25, 0.5, 0.75, 1, 1.5]),
      ergonomics: d.int(-6, 12),
      recoilModifier: d.int(-6, 4) / 32,
      accuracyModifier: d.pick(accuracyPool),
      centerOfImpact: isBarrel ? d.pick([0.125, 0.25, 0.5, 1]) : d.chance(0.05) ? d.pick([-0.25, 0]) : 0,
      magazineCapacity: d.chance(0.2) ? d.pick([10, 20, 30]) : 0,
      sightingRange: d.chance(0.2) ? d.pick([100, 200]) : 0,
      slots: slotsByOwner.get(id) ?? [],
      conflictingItemIds: [],
      conflictingSlotIds: [],
      offers: itemOffers(d),
    };
  });
  const weapon: ReferenceWeapon = {
    id: 'gun',
    categories: ['catW', 'parW'],
    weightKg: d.pick([1, 1.5, 2, 3]),
    ergonomics: d.int(0, 60),
    recoilVertical: d.int(50, 150),
    recoilHorizontal: d.int(20, 90),
    centerOfImpact: d.pick([0, 0.0625, 0.125, 0.5]),
    sightingRange: d.chance(0.3) ? 100 : 0,
    slots: slotsByOwner.get('gun') ?? [],
    conflictingItemIds: d.chance(0.1) ? [d.pick(ids)] : [],
    offers: baseOffers(d),
  };

  // --- conflicts ---
  const slotIds = allSlots().map(s => s.id);
  const hostSlotsOf = (id: string): string[] => allSlots().filter(s => s.allowedItemIds.includes(id)).map(s => s.id);
  const multiplicity = (id: string): number => hostSlotsOf(id).length;
  const requiredSlotIds = allSlots().filter(s => s.required).map(s => s.id);
  for (const a of items) {
    for (const b of items) if (a.id !== b.id && d.chance(0.05)) a.conflictingItemIds = [...(a.conflictingItemIds ?? []), b.id];
    if (d.chance(multiplicity(a.id) >= 2 ? 0.25 : 0.04)) a.conflictingItemIds = [...(a.conflictingItemIds ?? []), a.id];
    if (d.chance(0.15) && slotIds.length > 0) {
      const blocked: string[] = [];
      for (let k = 0; k < d.int(1, 2); k++) {
        const r = d.next();
        const own = (slotsByOwner.get(a.id) ?? []).map(s => s.id);
        const host = hostSlotsOf(a.id);
        const pool = r < 0.35 && requiredSlotIds.length > 0 ? requiredSlotIds : r < 0.6 && host.length > 0 ? host : r < 0.75 && own.length > 0 ? own : slotIds;
        blocked.push(d.pick(pool));
      }
      a.conflictingSlotIds = [...new Set(blocked)];
    }
  }

  // --- presets with supplied copies ---
  const presets: ReferencePreset[] = [];
  for (let p = 0, count = d.int(0, 2); p < count; p++) {
    presets.push({
      id: `P${p}`,
      weaponId: 'gun',
      components: d.some(ids, d.int(1, 4)).map(itemId => ({ itemId, count: d.pick(options.dense === true ? [1, 2, 3, 4] : [1, 1, 2, 3]) })),
      offers: [
        ...(d.chance(0.9) ? [{ kind: 'trader' as const, trader: d.pick(TRADERS), level: d.int(1, 2), price: 500 * d.int(4, 9) }] : []),
        ...(d.chance(0.2) ? [{ kind: 'trader' as const, trader: d.pick(TRADERS), level: d.int(1, 3), price: 500 * d.int(2, 8) }] : []),
      ],
    });
  }
  const fixture: ReferenceFixture = { schemaVersion: 1, items, weapons: [weapon], presets };

  const { request, tight } = drawRequest(d, fixture, options);
  const result: AdversarialCase = { seed, fixture, request, options, features: [] };
  result.features = [...featuresOf(fixture, request), ...tight.map(t => `tight:${t}`)];
  return result;
}


/**
 * A random request for a fixture: weights (Tchebycheff sometimes), stash, includes and excludes, market settings, and caps drawn from the statistics of
 * builds the uncapped request accepts, mostly exactly ON a build's value (a tight cap) so a boundary build must stay feasible. The weapon id is the
 * fixture's first weapon. `tight` names the caps that sit exactly on a build statistic.
 */
export function drawRequest(d: Dice, fixture: ReferenceFixture, options: AdversarialOptions = {}): { request: ReferenceRequest; tight: string[] } {
  const ids = fixture.items.map(i => i.id);
  const categories = [...new Set(fixture.items.flatMap(i => i.categories ?? []))];
  const request: ReferenceRequest = { weapon_id: fixture.weapons[0].id };
  request.ergo_weight = d.pick([0, 1, 1, 2]);
  request.recoil_weight = d.pick([0, 1, 1, 3]);
  request.price_weight = d.pick([0, 0, 1, 500, 2000]);
  if (d.chance(0.55)) request.owned_items = ids.flatMap(id => (d.chance(0.35) ? Array.from({ length: d.int(1, 3) }, () => id) : []));
  if (request.owned_items?.length === 0) delete request.owned_items;
  if (d.chance(0.12)) request.include_items = [d.pick(ids)];
  if (d.chance(0.08) && categories.length > 0) request.include_categories = [[d.pick(categories)]];
  if (d.chance(0.06)) request.exclude_items = [d.pick(ids)];
  if (d.chance(0.05) && categories.length > 0) request.exclude_categories = [d.pick(categories)];
  if (d.chance(0.2)) request.trader_levels = Object.fromEntries(['skier', 'mechanic'].map(t => [t, d.pick([0, 1, 2, 3, 4, 4, 4, 4])]).filter(() => d.chance(0.5)));
  if (d.chance(0.1)) request.flea_available = false;
  request.barter_available = d.chance(0.65);
  if (d.chance(0.25)) request.barter_exclude_dogtags = true;
  if (d.chance(0.3)) request.player_level = d.pick([10, 20, 30]);
  if (d.chance(0.15)) {
    const zE = d.int(50, 300);
    const zR = -d.int(0, 300);
    const zP = d.int(0, 5000);
    request.use_tchebycheff = true;
    request.ideal_point = { zE, nadE: zE - d.int(0, 200), zR, nadR: zR + d.int(0, 300), zP, nadP: zP + d.int(0, 8000) };
  }

  // --- caps drawn from real builds' statistics, mostly exactly on a build's value ---
  const builds = enumerateBuilds(fixture, request, { maxBuilds: 4000 }).builds;
  const tight: string[] = [];
  if (builds.length > 0) {
    const rf = resolveFixture(fixture);
    const rr = resolveRequest(fixture, request);
    const stats: NonNullable<ReturnType<typeof inspectBuild>['stats']>[] = [];
    // statistics of builds the uncapped request ACCEPTS, so a cap drawn from one of them keeps it feasible
    const stride = Math.max(1, Math.floor(builds.length / 400));
    for (let k = 0; k < builds.length && stats.length < 80; k += stride) {
      const { stats: s, violations } = inspectBuild(rf, rr, builds[k]);
      if (s && violations.length === 0) stats.push(s);
    }
    if (stats.length > 0) {
      const anchor = d.chance(0.7) ? d.pick(stats) : null;
      const any = () => anchor ?? d.pick(stats);
      const exact = (name: string, p: number, value: () => number, deltas: number[], set: (v: number) => void): void => {
        if (!d.chance(p)) return;
        const delta = d.pick(deltas);
        set(value() + delta);
        if (delta === 0) tight.push(name);
      };
      exact('max_price', 0.3, () => toNumber(any().spend), [0, 0, 0, -1, 250], v => { request.max_price = v; });
      exact('min_ergonomics', 0.2, () => toNumber(any().ergonomics), [0, 0, 1], v => { request.min_ergonomics = v; });
      exact('max_recoil_v', 0.15, () => toNumber(any().recoilVertical), [0, 0, -1], v => { request.max_recoil_v = v; });
      exact('max_recoil_sum', 0.1, () => toNumber(any().recoilVertical) + toNumber(any().recoilHorizontal), [0, 5], v => { request.max_recoil_sum = v; });
      exact('max_weight', 0.2, () => toNumber(any().weight), [0, 0, -0.25], v => { request.max_weight = v; });
      exact('min_mag_capacity', 0.12, () => toNumber(any().magazineCapacity), [0, 0, 5], v => { request.min_mag_capacity = v; });
      exact('min_sighting_range', 0.12, () => toNumber(any().sightingRange), [0, 0, 50], v => { request.min_sighting_range = v; });
      if (options.moa === true || options.bigAccuracy === true || d.chance(0.2)) {
        const moaStats = stats.map(s => toNumber(s.moa));
        const negative = options.bigAccuracy === true && moaStats.some(m => m < 0);
        const cap = negative && d.chance(0.7) ? d.pick(moaStats.filter(m => m < 0)) + d.pick([0, 0, 0.05, -0.05]) : toNumber(any().moa) + d.pick([0, 0, 0.05, -0.05, 0.3, -0.3]);
        request.max_moa = Math.round(cap * 100) / 100; // a coarse decimal: a cap rounded finer would sit within the solver tolerance of some build's exact MOA
      }
    }
  }
  return { request, tight };
}

/** Structural features of a world, measured from the fixture and request themselves. */
export function featuresOf(fixture: ReferenceFixture, request: ReferenceRequest): string[] {
  const features = new Set<string>();
  const owners: { id: string; slots: ReferenceSlot[] }[] = [...fixture.weapons.map(w => ({ id: w.id, slots: w.slots ?? [] })), ...fixture.items.map(i => ({ id: i.id, slots: i.slots ?? [] }))];
  const slots = owners.flatMap(o => o.slots.map(s => ({ owner: o.id, slot: s })));
  const hostCount = (itemId: string): number => slots.filter(s => s.slot.allowedItemIds.includes(itemId)).length;

  if (owners.some(o => o.slots.some((a, i) => o.slots.some((b, j) => j > i && a.allowedItemIds.some(x => b.allowedItemIds.includes(x)))))) features.add('multi-slot-same-owner');
  for (const item of fixture.items) {
    const required = (item.slots ?? []).some(s => s.required === true);
    const parents = new Set(slots.filter(s => s.slot.allowedItemIds.includes(item.id)).map(s => s.owner));
    if (required && parents.size >= 2) features.add('required-slots-under-several-parents');
  }
  const requiredSlotIds = new Set(slots.filter(s => s.slot.required === true).map(s => s.slot.id));
  for (const item of fixture.items) {
    const blocked = item.conflictingSlotIds ?? [];
    if (blocked.length > 0) features.add('slot-conflict');
    if (blocked.some(b => requiredSlotIds.has(b))) features.add('slot-conflict-vs-required');
    if (blocked.some(b => slots.some(s => s.slot.id === b && s.slot.allowedItemIds.includes(item.id)))) features.add('slot-conflict-own-host-slot');
    if (blocked.some(b => (item.slots ?? []).some(s => s.id === b))) features.add('slot-conflict-own-slots');
    if ((item.conflictingItemIds ?? []).includes(item.id)) {
      features.add('self-conflict');
      const supplyCopies = Math.max(0, ...(fixture.presets ?? []).map(p => p.components.filter(c => c.itemId === item.id).reduce((a, c) => a + c.count, 0)))
        + (request.owned_items ?? []).filter(x => x === item.id).length;
      if (supplyCopies >= 2 && hostCount(item.id) >= 2) features.add('self-conflict-multi-copy-supply');
    }
    if ((item.conflictingItemIds ?? []).some(x => x !== item.id)) features.add('pair-conflict');
  }
  if ((fixture.presets ?? []).some(p => p.components.some(c => c.count >= 2))) features.add('preset-copies');
  if ((request.owned_items ?? []).length > 0) features.add('owned-stock');
  if (request.barter_available === true && fixture.items.some(i => (i.offers ?? []).some(o => o.kind === 'barter' && (o.offeredCount ?? 1) >= 2))) features.add('whole-lot-barter');
  if (fixture.items.some(i => (i.offers ?? []).length === 0)) features.add('capped-template');
  const barrels = fixture.items.filter(i => (i.centerOfImpact ?? 0) > 0);
  if (request.max_moa !== undefined && request.max_moa !== null) {
    features.add('moa-cap');
    if (barrels.length >= 2) features.add('moa-several-barrels');
    if (request.max_moa < 0) features.add('moa-negative-cap');
  }
  if (fixture.items.reduce((a, i) => a + Math.max(0, i.accuracyModifier ?? 0), 0) > 100) features.add('accuracy-sum-can-pass-100');
  if (request.use_tchebycheff === true) features.add('tchebycheff');
  if (request.include_items?.length || request.include_categories?.length) features.add('include');
  if (request.exclude_items?.length || request.exclude_categories?.length) features.add('exclude');
  return [...features].sort();
}
