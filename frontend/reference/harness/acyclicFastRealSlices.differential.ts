// Real-gun micro-domains for the Fast exactness gates (research task: docs/research/acyclic-fast-exactness.md).
//
// The oracle cannot enumerate a whole real weapon (M4A1: 151,479 occurrences), so the gates run on SLICES: the real fixture of a pinned gun (the bridge,
// from the raw documents) reduced to a small connected domain by `sliceFixture`. A slice keeps the real slot ids, required flags, allowlists, conflicts
// (item pairs, self-listings, slot ids), categories, exact statistics, offers (trader, flea, barter lots) and preset counts of the items it keeps; it is
// a derived domain, never a claim about the full weapon.
//
// A slice is built to be nonempty and to carry real structure:
//   skeleton   every required slot (receiver and mods) gets one kept candidate, recursively, preferring items of a real factory preset;
//   alternates a second candidate for some required slots;
//   multi-slot an owner with several slots whose real allowlists overlap keeps one shared item (so several copies fit one owner);
//   extras     random optional parts, each with its own required chain, added while the exact rooted-tree count stays under a budget.
//
// Differential helper: may import production code (reference/independenceScan.ts); no non-differential file may import this one.

import type { ReferenceFixture, ReferenceItem, ReferenceSlot } from '../oracle/index';
import { fixtureForWeapon } from '../bridge/toFixture';
import { sliceFixture } from '../bridge/slice';
import { loadPinnedWorld } from '../source/pinnedWorld';
import { Dice } from './acyclicFastWorlds.differential';

/** Rooted-tree count of a fixture's weapon (the oracle enumerates this many trees, times the bases); exact on an acyclic closure. */
export function treeCount(fixture: ReferenceFixture, weaponId: string): bigint {
  const items = new Map(fixture.items.map(i => [i.id, i]));
  const memo = new Map<string, bigint>();
  const active = new Set<string>();
  const ofSlots = (slots: ReferenceSlot[] | undefined): bigint => {
    let product = 1n;
    for (const slot of slots ?? []) {
      let total = slot.required === true ? 0n : 1n;
      for (const id of new Set(slot.allowedItemIds)) total += ofItem(id);
      product *= total;
    }
    return product;
  };
  const ofItem = (id: string): bigint => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (active.has(id)) return 0n; // a cycle: pruned by the ancestor rule; this DP is a bound there
    active.add(id);
    const item = items.get(id);
    const value = item === undefined ? 0n : ofSlots(item.slots);
    active.delete(id);
    memo.set(id, value);
    return value;
  };
  const weapon = fixture.weapons.find(w => w.id === weaponId);
  return weapon === undefined ? 0n : ofSlots(weapon.slots);
}

export interface RealSlice {
  gunId: string;
  name: string;
  fixture: ReferenceFixture;
  /** What the slice kept, for the report. */
  keptItems: number;
  extras: number;
  trees: bigint;
  multiSlot: boolean;
  slotConflicts: number;
  pairConflicts: number;
  presetCopies: boolean;
}

export const pinnedGunIds = (): { id: string; name: string }[] => {
  const { world } = loadPinnedWorld('en');
  return [...world.items.values()].filter(i => i.types.includes('gun')).map(i => ({ id: i.id, name: world.translateItemKey(i.shortNameKey) })).sort((a, b) => (a.id < b.id ? -1 : 1));
};

/**
 * @param mustKeep items the slice must contain, each with a shortest root path and its required chain; for an item that blocks slots, the owners of the
 *                 blocked slots and one filler for each blocked slot are kept too, so the conflict is live.
 */
export function realSlice(gunId: string, seed: number, budget = 30_000n, mustKeep: readonly string[] = []): RealSlice | null {
  const d = new Dice(seed);
  const { world } = loadPinnedWorld('en');
  const full = fixtureForWeapon(world, gunId).fixture;
  const weapon = full.weapons[0];
  const items = new Map(full.items.map(i => [i.id, i]));
  const presetComponents = new Set((full.presets ?? []).flatMap(p => p.components.map(c => c.itemId)));
  const keep = new Set<string>();

  const completable = (id: string, trail: Set<string>): boolean => {
    const item = items.get(id);
    if (!item) return false;
    if (trail.has(id)) return false;
    const next = new Set(trail).add(id);
    return (item.slots ?? []).every(s => s.required !== true || s.allowedItemIds.some(c => completable(c, next)));
  };
  /** Keep one candidate for every required slot of `owner`, recursively (the first completable one, preset items first). */
  const closeRequired = (slots: ReferenceSlot[] | undefined, trail: Set<string>): boolean => {
    for (const slot of slots ?? []) {
      if (slot.required !== true) continue;
      if (slot.allowedItemIds.some(c => keep.has(c))) continue;
      const ordered = [...slot.allowedItemIds].filter(c => completable(c, trail));
      if (ordered.length === 0) return false;
      const preferred = ordered.filter(c => presetComponents.has(c));
      const chosen = d.pick(preferred.length > 0 && d.chance(0.8) ? preferred : ordered);
      keep.add(chosen);
      if (!closeRequired(items.get(chosen)?.slots, new Set(trail).add(chosen))) return false;
    }
    return true;
  };
  if (!closeRequired(weapon.slots, new Set())) return null; // the receiver cannot be completed from kept parts alone

  /** Shortest chain of items from the receiver's slots to `target`, or null when no kept-or-keepable chain exists. */
  const pathTo = (target: string): string[] | null => {
    const parent = new Map<string, string | null>();
    const queue: string[] = [];
    for (const slot of weapon.slots ?? []) for (const id of slot.allowedItemIds) if (!parent.has(id)) { parent.set(id, null); queue.push(id); }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (id === target) break;
      for (const slot of items.get(id)?.slots ?? []) for (const c of slot.allowedItemIds) if (!parent.has(c)) { parent.set(c, id); queue.push(c); }
    }
    if (!parent.has(target)) return null;
    const path: string[] = [];
    for (let at: string | null | undefined = target; at !== null && at !== undefined; at = parent.get(at)) path.unshift(at);
    return path;
  };
  const keepWithPath = (target: string): boolean => {
    const path = pathTo(target);
    if (path === null || !path.every(id => completable(id, new Set()))) return false;
    for (const id of path) {
      keep.add(id);
      if (!closeRequired(items.get(id)?.slots, new Set([id]))) return false;
    }
    return true;
  };
  for (const target of mustKeep) {
    if (!keepWithPath(target)) return null;
    // a blocker: keep the owners of the slots it blocks (with a filler each), so the conflict can bind
    for (const blocked of items.get(target)?.conflictingSlotIds ?? []) {
      const owner = full.items.find(o => (o.slots ?? []).some(s => s.id === blocked));
      if (owner === undefined || !keepWithPath(owner.id)) continue;
      const slot = (owner.slots ?? []).find(s => s.id === blocked) as ReferenceSlot;
      const filler = slot.allowedItemIds.filter(c => completable(c, new Set()));
      if (filler.length > 0) {
        const pick = d.pick(filler);
        keep.add(pick);
        closeRequired(items.get(pick)?.slots, new Set([pick]));
      }
    }
  }

  const sliceOf = (): ReferenceFixture => sliceFixture(full, { keepItemIds: [...keep] }).fixture;
  const within = (): boolean => treeCount(sliceOf(), gunId) <= budget;
  if (!within()) return null;

  // alternates for required slots
  for (const owner of [weapon as { slots?: ReferenceSlot[] }, ...[...keep].map(id => items.get(id) as ReferenceItem)]) {
    for (const slot of owner.slots ?? []) {
      if (slot.required !== true || !d.chance(0.35)) continue;
      const other = slot.allowedItemIds.filter(c => !keep.has(c) && completable(c, new Set()));
      if (other.length === 0) continue;
      const before = new Set(keep);
      keep.add(d.pick(other));
      closeRequired(items.get([...keep].find(k => !before.has(k)) as string)?.slots, new Set());
      if (!within()) { keep.clear(); for (const k of before) keep.add(k); }
    }
  }

  // multi-slot: an owner whose real slots share an allowed item keeps that item once (it then fits several slots of one owner)
  let multiSlot = false;
  const owners: { slots?: ReferenceSlot[] }[] = [weapon, ...[...keep].map(id => items.get(id) as ReferenceItem)];
  for (const owner of d.some(owners, owners.length)) {
    const slots = owner.slots ?? [];
    const shared = new Map<string, number>();
    for (const s of slots) for (const id of new Set(s.allowedItemIds)) shared.set(id, (shared.get(id) ?? 0) + 1);
    const candidates = [...shared].filter(([id, n]) => n >= 2 && completable(id, new Set()) && !keep.has(id));
    if (candidates.length === 0 || !d.chance(0.7)) continue;
    const before = new Set(keep);
    const [id] = d.pick(candidates);
    keep.add(id);
    closeRequired(items.get(id)?.slots, new Set());
    if (within()) multiSlot = true;
    else { keep.clear(); for (const k of before) keep.add(k); }
  }

  // extras: random optional parts reachable from kept owners
  let extras = 0;
  for (let attempt = 0, goal = d.int(2, 8); attempt < 40 && extras < goal; attempt++) {
    const owner = d.pick([weapon as { slots?: ReferenceSlot[] }, ...[...keep].map(id => items.get(id) as ReferenceItem)]);
    const slots = owner.slots ?? [];
    if (slots.length === 0) continue;
    const slot = d.pick(slots);
    const pool = slot.allowedItemIds.filter(c => !keep.has(c) && completable(c, new Set()));
    if (pool.length === 0) continue;
    const preferred = pool.filter(c => presetComponents.has(c));
    const before = new Set(keep);
    const chosen = d.pick(preferred.length > 0 && d.chance(0.5) ? preferred : pool);
    keep.add(chosen);
    closeRequired(items.get(chosen)?.slots, new Set());
    if (within()) extras++;
    else { keep.clear(); for (const k of before) keep.add(k); }
  }

  const sliced = sliceOf();
  // The production inputs carry a flea player-level gate only on mods (`min_level_flea`); the real presets are gated at 20 to 40. The slice drops the
  // gate on presets (a documented change of the derived domain, identical for the oracle and for production), so such a slice stays runnable.
  const fixture: ReferenceFixture = {
    ...sliced,
    presets: (sliced.presets ?? []).map(preset => ({
      ...preset,
      offers: (preset.offers ?? []).map(offer => (offer.kind === 'flea' ? { kind: 'flea' as const, price: offer.price } : offer)),
    })),
  };
  const slotConflicts = fixture.items.filter(i => (i.conflictingSlotIds ?? []).length > 0).length;
  const pairConflicts = fixture.items.filter(i => (i.conflictingItemIds ?? []).some(x => x !== i.id)).length;
  return {
    gunId,
    name: gunId,
    fixture,
    keptItems: fixture.items.length,
    extras,
    trees: treeCount(fixture, gunId),
    multiSlot,
    slotConflicts,
    pairConflicts,
    presetCopies: (fixture.presets ?? []).some(p => p.components.some(c => c.count >= 2 && keep.has(c.itemId))),
  };
}
