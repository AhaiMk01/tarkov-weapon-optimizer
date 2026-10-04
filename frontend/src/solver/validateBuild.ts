import type { OptimizeRequest, OptimizeResponse } from '../api/client';
import type { ItemLookup, OfferInfo, SlotInfo } from './types';
import { canonicalizeTraderLevels } from './reuseKey';
import { presetSupply } from './presetSupply';

/** Absolute tolerances: hard constraints and reconstructed display statistics. */
export const VALIDATION_EPSILON = 1e-6;

/** Exact Prevent Overswing failure. A secant relaxation may still be a valid upper bound. */
export const PREVENT_OVERSWING_VIOLATION = 'Prevent overswing TED constraint violated';

// Deliberately independent of the LP, its compatibility map and decoded columns.
export function validateBuild(request: OptimizeRequest, result: OptimizeResponse, lookup: ItemLookup): string[] {
  const errors: string[] = [];
  const fail = (message: string) => { errors.push(message); };
  const close = (name: string, actual: number | undefined, expected: number) => {
    if (actual == null || !Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > VALIDATION_EPSILON) fail(`${name}: expected ${expected}, received ${actual}`);
  };
  const weapon = lookup[request.weapon_id];
  if (weapon?.type !== 'gun') return ['Unknown weapon'];
  if (!['optimal', 'feasible'].includes(result.status) || !result.final_stats) return ['No returned build to validate'];
  const selected = new Set(result.selected_items.map(i => i.id));
  if (selected.size !== result.selected_items.length) fail('Duplicate selected item id');
  const mods = result.selected_items.flatMap(detail => {
    const entry = lookup[detail.id];
    if (entry?.type !== 'mod') { fail(`Unknown/non-mod selected item ${detail.id}`); return []; }
    return [{ id: detail.id, detail, entry }];
  });
  const slots = new Map<string, { owner: string; slot: SlotInfo }>();
  for (const owner of [request.weapon_id, ...selected]) {
    for (const slot of lookup[owner]?.slots ?? []) {
      if (slots.has(slot.id)) fail(`Unsupported ambiguous slot identity ${slot.id}`);
      slots.set(slot.id, { owner, slot });
    }
  }
  const occupied = new Set<string>();
  const placed = new Set<string>();
  const children = new Map<string, string[]>();
  if (!result.slot_pairs) fail('Missing complete slot placement');
  for (const [slotId, id] of result.slot_pairs ?? []) {
    if (!selected.has(id)) fail(`Placement references unselected item ${id}`);
    if (placed.has(id)) fail(`Duplicate placement of ${id}`);
    if (occupied.has(slotId)) fail(`Slot capacity exceeded ${slotId}`);
    placed.add(id); occupied.add(slotId);
    const location = slots.get(slotId);
    if (!location) { fail(`Placement has absent parent/slot ${slotId}`); continue; }
    if (!location.slot.allowedItems.includes(id)) fail(`Illegal placement ${id} in ${slotId}`);
    const list = children.get(location.owner) ?? [];
    list.push(id); children.set(location.owner, list);
  }
  for (const id of selected) if (!placed.has(id)) fail(`Selected item is unplaced: ${id}`);
  for (const [id, { slot }] of slots) if (slot.required && !occupied.has(id)) fail(`Required slot is empty: ${id}`);
  const rooted = new Set([request.weapon_id]);
  const queue = [request.weapon_id];
  for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
    if (!rooted.has(child)) { rooted.add(child); queue.push(child); }
  }
  for (const id of selected) if (!rooted.has(id)) fail(`Placement is not rooted at weapon: ${id}`);
  for (const { id, entry } of mods) {
    for (const other of entry.conflicting_items) if (selected.has(other) || other === request.weapon_id) fail(`Item conflict ${id}/${other}`);
    for (const slot of entry.conflicting_slot_ids) if (occupied.has(slot)) fail(`Slot conflict ${id}/${slot}`);
    if (request.exclude_items?.includes(id)) fail(`Banned item ${id}`);
    if (request.exclude_categories?.includes(entry.stats.category_id)) fail(`Banned category ${entry.stats.category_id}`);
  }
  for (const id of request.include_items ?? []) if (!selected.has(id)) fail(`Missing locked item ${id}`);
  for (const group of request.include_categories ?? []) if (!mods.some(m => group.includes(m.entry.stats.category_id))) fail(`Missing required category group ${group.join('|')}`);

  type Priced = { offers: OfferInfo[]; price: number; price_source: string; purchasable?: boolean; min_level_flea?: number };
  // Canonicalize trader levels once upfront for validation: identical mapping as solver and cache key
  const normalizedValidationTraders = canonicalizeTraderLevels(request.trader_levels);
  const offer = (stats: Priced): { price: number; source: string } | undefined => {
    if (stats.purchasable === false) return undefined;
    const fleaAllowed = request.flea_available !== false && (request.player_level == null || request.player_level >= (stats.min_level_flea ?? 0));
    if (!stats.offers.length) return stats.price > 0 && fleaAllowed ? { price: stats.price, source: stats.price_source ?? 'market' } : undefined;
    const allowed = stats.offers.filter(o => {
      if (o.source.startsWith('barter:') && !request.barter_available) return false;
      if (request.barter_exclude_dogtags && o.requires_dogtag) return false;
      if (o.source === 'fleaMarket') return fleaAllowed;
      const vnorm = o.vendor_normalized.toLowerCase();
      const traderLevel = normalizedValidationTraders ? (normalizedValidationTraders[vnorm] ?? 4) : 4;
      return o.trader_level == null || o.trader_level <= traderLevel;
    });
    return allowed.reduce<OfferInfo | undefined>((best, o) => !best || o.price < best.price ? o : best, undefined);
  };
  const base = result.selected_preset;
  let price = 0;
  let retained = new Set<string>();
  if (!base) fail('Missing purchase base; fallback_base cannot establish access/accounting');
  else {
    const preset = base.id === request.weapon_id ? undefined : weapon.presets.find(p => p.id === base.id);
    if (base.id !== request.weapon_id && !preset) fail(`Unknown/unavailable purchase preset ${base.id}`);
    else {
      const supplied = presetSupply(preset?.items);
      retained = new Set(supplied.keys());
      // The response must carry the preset's exact count-bearing contents: same items, same copies.
      const reported = presetSupply(base.items);
      if (reported.size !== supplied.size || [...supplied].some(([id, copies]) => reported.get(id) !== copies)) fail('Preset contents mismatch');
      const purchase = offer(preset ?? weapon.stats);
      if (!purchase) fail('Purchase base is inaccessible');
      else { price = purchase.price; close('Base price', base.price, purchase.price); if (base.source !== purchase.source) fail('Base purchase source mismatch'); }
    }
  }
  for (const { id, entry, detail } of mods) {
    if (retained.has(id) || !entry.stats.purchasable) {
      close(`Retained/owned part price ${id}`, detail.price, 0);
      if (detail.source && detail.source !== 'not_purchasable') fail(`Unexpected purchase of retained/owned part ${id}`);
    } else {
      const purchase = offer(entry.stats);
      if (!purchase || entry.stats.price > 100_000_000) fail(`Inaccessible purchase ${id}`);
      else { price += purchase.price; close(`Part price ${id}`, detail.price, purchase.price); if (detail.source !== purchase.source) fail(`Part purchase source mismatch ${id}`); }
    }
  }
  const sum = (value: (m: typeof mods[number]) => number) => mods.reduce((n, m) => n + value(m), 0);
  const rawErgo = weapon.stats.naked_ergonomics + sum(m => m.entry.stats.ergonomics);
  const ergo = Math.max(0, Math.min(100, rawErgo));
  const weight = weapon.stats.weight + sum(m => m.entry.stats.weight);
  const recoilFactor = 1 + sum(m => m.entry.stats.recoil_modifier);
  const recoilV = weapon.stats.naked_recoil_v * recoilFactor;
  const recoilH = weapon.stats.naked_recoil_h * recoilFactor;
  const effective = Math.max(0, Math.min(100, ergo * (1 + (request.equip_ergo_modifier ?? 0))));
  const ted = effective - (weight <= 3 ? 0 : 100 - 300 / weight);
  const barrels = mods.filter(m => m.entry.stats.center_of_impact > 0);
  if (barrels.length > 1) fail('Unsupported multiple COI-replacing barrels');
  const coi = barrels[0]?.entry.stats.center_of_impact ?? weapon.stats.center_of_impact;
  const moa = coi * (1 - sum(m => m.entry.stats.accuracy_modifier) / 100) * 34.3;
  const stats = result.final_stats;
  close('Ergonomics', stats.ergonomics, ergo); close('Weight', stats.total_weight, weight);
  close('Vertical recoil', stats.recoil_vertical, recoilV); close('Horizontal recoil', stats.recoil_horizontal, recoilH);
  close('Total price', stats.total_price, price); close('TED', stats.true_ergo_delta, ted); close('MOA', stats.moa, moa);
  close('Overswing', stats.overswing_pct, Math.max(0, Math.min(1, (weight * (1 - effective / 100) - 3) / 4)) * 100);
  const max = (name: string, actual: number, limit: number | undefined) => { if (limit != null && actual > limit + VALIDATION_EPSILON) fail(`${name} hard limit exceeded`); };
  max('Price', price, request.max_price); max('Weight', weight, request.max_weight); max('Recoil', recoilV, request.max_recoil_v);
  max('Recoil sum', recoilV + recoilH, request.max_recoil_sum); max('MOA', moa, request.max_moa);
  if (request.min_ergonomics != null && ergo < request.min_ergonomics - VALIDATION_EPSILON) fail('Minimum ergonomics not met');
  if (request.prevent_overswing && ted < -VALIDATION_EPSILON) fail(PREVENT_OVERSWING_VIOLATION);
  if (request.min_mag_capacity != null && !mods.some(m => m.entry.stats.capacity >= request.min_mag_capacity!)) fail('Minimum magazine capacity not met');
  if (request.min_sighting_range != null && Math.max(weapon.stats.sighting_range, ...mods.map(m => m.entry.stats.sighting_range)) < request.min_sighting_range) fail('Minimum sighting range not met');
  return errors;
}
