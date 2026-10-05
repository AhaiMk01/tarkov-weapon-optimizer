// Seeded random worlds for the Fast-versus-Precise differential tests: a weapon of up to seven item templates (acyclic or cyclic), with every request
// feature the Fast rows state drawn at random.
import { buildCompatibilityMap } from '../../src/solver/compatibilityMap';
import { DEFAULT_TRADER_LEVELS } from '../../src/solver/types';
import type { GunLookupEntry, ItemLookup, ModLookupEntry, OfferInfo, SolveParams } from '../../src/solver/types';
import { barter, flea, gunWith, lookupOf, modWith, slot, trader, WEAPON, type SlotSpec } from './lpFixtures';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface World {
  lookup: ItemLookup;
  params: SolveParams;
  ids: string[];
}

export function randomWorld(seed: number, cyclic: boolean): World {
  const rand = rng(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const chance = (p: number): boolean => rand() < p;
  // A cyclic graph unrolls into every simple path of the template graph: keep it small (the blueprint has no other limit).
  const count = cyclic ? int(3, 5) : int(3, 7);
  const ids = Array.from({ length: count }, (_, i) => `t${i + 1}`);
  const allSlotIds: string[] = [];

  const randomSlots = (owner: string, from: number, max: number): SlotSpec[] => {
    const out: SlotSpec[] = [];
    const n = int(owner === WEAPON ? 2 : 0, max);
    for (let k = 0; k < n; k++) {
      const pool = cyclic ? ids.filter(id => id !== owner) : ids.slice(from);
      if (pool.length === 0) break;
      const allowed = pool.filter(() => chance(cyclic ? 0.35 : 0.5));
      if (allowed.length === 0) allowed.push(pick(pool));
      const id = `${owner}_s${k}`;
      allSlotIds.push(id);
      out.push(slot(id, allowed, chance(owner === WEAPON ? 0.2 : 0.15)));
    }
    return out;
  };

  const offersOf = (): OfferInfo[] => {
    const offers: OfferInfo[] = [];
    if (chance(0.15)) return offers;
    if (chance(0.85)) offers.push(trader(pick(['prapor', 'skier', 'mechanic']), int(1, 4), int(1, 10) * 100));
    if (chance(0.3)) offers.push(flea(int(1, 12) * 100));
    if (chance(0.25)) offers.push(barter(pick(['prapor', 'mechanic']), int(1, 3), int(1, 10) * 100, chance(0.2), pick([1, 2, 3])));
    return offers;
  };

  const modEntries: [string, ReturnType<typeof modWith>][] = ids.map((id, i) => {
    const barrel = chance(0.2);
    return [id, modWith(id, {
      ergo: int(-5, 15),
      recoil: pick([-0.1, -0.05, 0, 0.05, 0.1]),
      weight: pick([0, 0.25, 0.5, 1, 2.5]),
      accuracy: chance(0.4) ? int(-5, 8) : 0,
      coi: barrel ? pick([0.5, 1, 2, 4]) : 0,
      capacity: chance(0.15) ? pick([10, 20, 30]) : 0,
      sighting: chance(0.15) ? pick([25, 50, 100]) : 0,
      offers: offersOf(),
      slots: randomSlots(id, i + 1, cyclic ? 2 : 3),
      conflictsItems: [],
      conflictsSlots: [],
    })];
  });
  // Conflicts after every slot id exists.
  for (const [id, entry] of modEntries) {
    for (const other of ids) if (other !== id && chance(0.1)) entry.conflicting_items.push(other);
    if (chance(0.08)) entry.conflicting_items.push(id);
    for (const slotId of allSlotIds) if (chance(0.06)) entry.conflicting_slot_ids.push(slotId);
  }
  const presets = Array.from({ length: int(0, 2) }, (_, k) => ({
    id: `P${k}`,
    items: ids.filter(() => chance(0.4)).map(itemId => ({ itemId, count: int(1, 3) })),
    offers: chance(0.9) ? [trader('prapor', int(1, 3), int(5, 30) * 100)] : [],
  }));
  const weapon = gunWith(WEAPON, {
    ergo: int(0, 20), weight: int(1, 3), recoilV: 100, recoilH: 50, coi: 6, sighting: chance(0.2) ? 25 : 0,
    slots: randomSlots(WEAPON, 0, 4), presets, offers: chance(0.9) ? [trader('prapor', 1, 5000)] : [],
  });
  const lookup = lookupOf(weapon, ...modEntries);

  const extra: Partial<SolveParams> = {
    ergoWeight: pick([0, 1, 2]), recoilWeight: pick([0, 1]), priceWeight: pick([0, 0.1, 1, 10]),
    barterAvailable: chance(0.5), fleaAvailable: chance(0.8),
  };
  if (chance(0.3)) extra.maxPrice = int(50, 120) * 100;
  if (chance(0.25)) extra.minErgonomics = int(0, 30);
  if (chance(0.25)) extra.maxWeight = int(15, 80) / 10;
  if (chance(0.2)) extra.maxRecoilV = int(70, 110);
  if (chance(0.15)) extra.maxRecoilSum = int(110, 160);
  if (chance(0.15)) extra.minMagCapacity = pick([10, 20, 30]);
  if (chance(0.15)) extra.minSightingRange = pick([25, 50]);
  if (chance(0.2)) extra.maxMOA = pick([5, 20, 60, 150]);
  if (chance(0.2)) extra.includeItems = [pick(ids)];
  if (chance(0.2)) extra.excludeItems = [pick(ids)];
  if (chance(0.3)) extra.ownedItems = Array.from({ length: int(1, 4) }, () => pick(ids));
  if (chance(0.2)) extra.traderLevels = { ...DEFAULT_TRADER_LEVELS, prapor: int(0, 4), skier: int(0, 4), mechanic: int(0, 4) };
  if (chance(0.2)) {
    extra.useTchebycheff = true;
    extra.idealPoint = { zE: 300, nadE: int(0, 100), zR: -200, nadR: int(0, 100), zP: int(5, 60) * 100, nadP: int(100, 300) * 100 };
  }
  const params: SolveParams = { weaponId: WEAPON, itemLookup: lookup, compatibilityMap: buildCompatibilityMap(WEAPON, lookup), ...extra };
  return { lookup, params, ids };
}

/**
 * A world that exercises TrueErgo and Prevent Overswing: the seeded world of `randomWorld` with its weights raised to the range where the 3 kg knee
 * matters, an equipment modifier, and at least one of the two TED flags. Drawn from a second generator, so `randomWorld(seed, cyclic)` itself is
 * unchanged. The weights and ergonomics are small multiples of an eighth, so a build's TED sits near the overswing boundary often.
 */
export function randomTedWorld(seed: number, cyclic: boolean): World {
  const world = randomWorld(seed, cyclic);
  const rand = rng(Math.imul(seed, 7919) + 104_729);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const chance = (p: number): boolean => rand() < p;
  const weapon = world.lookup[WEAPON] as GunLookupEntry;
  weapon.stats.weight = pick([0.5, 1, 1.5, 2, 3]);
  weapon.stats.naked_ergonomics = pick([5, 15, 25, 40, 55]);
  for (const id of world.ids) {
    const entry = world.lookup[id] as ModLookupEntry;
    entry.stats.weight = pick([0, 0.125, 0.25, 0.5, 1, 1.5]);
    entry.stats.ergonomics = pick([-8, -3, 0, 2, 5, 9, 14, 22]);
  }
  const useTrueErgo = chance(0.65);
  const params = world.params;
  // Most of the random caps would make the request empty before TED matters: keep each with a small probability.
  for (const cap of ['maxPrice', 'minErgonomics', 'maxWeight', 'maxRecoilV', 'maxRecoilSum', 'minMagCapacity', 'minSightingRange', 'maxMOA', 'includeItems'] as const) {
    if (!chance(0.25)) delete params[cap];
  }
  params.useTrueErgo = useTrueErgo;
  params.preventOverswing = !useTrueErgo || chance(0.5);
  params.equipErgoModifier = pick([0, 0, -0.1, 0.2, -0.35]);
  if (useTrueErgo && !(params.ergoWeight && params.ergoWeight > 0)) params.ergoWeight = 1;
  return world;
}
