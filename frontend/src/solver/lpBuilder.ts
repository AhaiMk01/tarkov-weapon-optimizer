/**
 * LEGACY, NOT USED BY `solve()` (Phase 2.4c). The Fast model is `physical/specializeFast.ts` on the physical domain; this single-copy template
 * LP survives only for its remaining readers, which Phase 2.9 migrates or deletes: `solver.worker.ts` (imports `MOA_K` only), the root scripts
 * test_candidate_prune.ts, test_incumbent_gate.ts, test_multi_weapon_verification.ts, test_preset_quantities.ts and proto_tchebycheff.ts, and the
 * benchmark experiments (benchmarks/compare_bound_strategies.ts, benchmarks/experiments/*). It still carries the pre-cutover approximations
 * (found-in-raid and 100M price stand-ins, single-copy buy aliases, the `compatibilityMap` global visited set): do not build on it.
 *
 * LP Builder — generates a CPLEX LP format string for the HiGHS WASM solver.
 *
 * Ported from the MiniZinc prototype (test_minizinc.ts buildMznData + generateMznModel)
 * and validated against CP-SAT (Python OR-Tools).
 *
 * The model uses binary decision variables for item selection, base choice,
 * purchase tracking, and multi-slot placement, with a continuous capped_ergo variable.
 */

import type {
  SolveParams,
  GunLookupEntry,
  ModLookupEntry,
  ModStats,
  PresetInfo,
  TraderLevels,
} from './types';
import { DEFAULT_TRADER_LEVELS } from './types';
import { getAvailablePrice } from './dataService';
import { presetSupply } from './presetSupply';
import { objectiveModel, objectiveScore, weightPenalty } from './trueErgo';
import type { ObjectiveAxes } from './trueErgo';
import { computeStructuralBounds } from './structuralBounds';
import { canonicalizeTraderLevels } from './reuseKey';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Conversion factor from BSG's centerOfImpact units to in-game MOA, K = 100 / 2.9089 = 1000000 / 29089 (ADR 0006 section 5, ADR 0013 4C):
 * the exact constant of the physical model and its validator, replacing the empirical 34.3 literal.
 *   displayed_MOA = effectiveCenterOfImpact * (1 - totalAccuracyMod/100) * MOA_K
 */
export const MOA_K = 1000000 / 29089;

export interface LPResult {
  lpString: string;
  indexToItem: string[];   // 1-indexed: indexToItem[1] = first item ID
  indexToSlot: string[];   // 1-indexed: indexToSlot[1] = first slot ID
  baseIds: string[];       // 0-indexed: baseIds[0] = 'naked' or preset ID
  nItems: number;
  nBases: number;
  weaponId: string;
  /** For each slot ID, the list of available item IDs that can go in it */
  slotItemsMap: Record<string, string[]>;
  /** For each slot ID, the item ID that owns (provides) that slot */
  slotOwnerMap: Record<string, string>;
  /** Item indices that have p_{item}_{slot} placement variables (precise mode) */
  multiSlotItemIndices: Set<number>;
  /** For each item index, the slot indices it can appear in */
  itemToSlotIndices: Map<number, number[]>;
  weightBounds: [number, number];
  axes(columns: Record<string, { Primal: number }>, ergo: number): ObjectiveAxes;
  score(axes: ObjectiveAxes): number;
}

// ---------------------------------------------------------------------------
// Constants matching CP-SAT implementation
// ---------------------------------------------------------------------------

const ERGO_SCALE = 10;   // Ergo decimal precision (0.5 ergo → 5)
const SCALE = 1000;       // Recoil modifier precision (-0.05 → -50)


/** RUB cost in objective when mod has no buyFor (scaled by price weight). Not counted toward maxPrice. */
const UNPURCHASABLE_OBJECTIVE_PRICE_MIN_RUB = 50_000_000;
const fmt = String;


// ---------------------------------------------------------------------------
// buildLP — pure function: SolveParams → LPResult
// ---------------------------------------------------------------------------

export function buildLP(params: SolveParams, weightInterval?: [number, number]): LPResult {
  const {
    weaponId,
    itemLookup,
    compatibilityMap: cmap,
  } = params;

  const weapon = itemLookup[weaponId] as GunLookupEntry;
  const weaponStats = weapon.stats;
  const reachable = cmap.reachable_items;
  const slotItems = cmap.slot_items;
  const slotOwner = cmap.slot_owner;


  // Normalize trader levels map once at LP build entry (avoids allocations in hot pricing loops)
  const traderLevels = (canonicalizeTraderLevels(params.traderLevels) ?? DEFAULT_TRADER_LEVELS) as TraderLevels;

  // Exclusion sets from params
  const excludeItemSet = new Set(params.excludeItems ?? []);
  const excludeCatSet = new Set(params.excludeCategories ?? []);
  const includeItemSet = new Set(params.includeItems ?? []);
  // Stash (ADR 0008): the template model is single-copy, so an owned part is one free copy, available whatever its offers say.
  const ownedSet = new Set(params.ownedItems ?? []);

  // ========================================================================
  // 1. Build preset maps (mirrors CP-SAT)
  // ========================================================================

  const presets: PresetInfo[] = weapon.presets;
  // Component supply q_{b,i}: preset id -> item id -> copies supplied (positive only).
  const presetSupplyMap: Record<string, Map<string, number>> = {};
  const itemToPresets: Record<string, string[]> = {};
  const presetPricesMap: Record<string, number> = {};

  for (const preset of presets) {
    const [pPrice, , pAvail] = getAvailablePrice(
      preset,
      traderLevels,
      params.fleaAvailable ?? true,
      params.playerLevel ?? null,
      params.barterAvailable ?? false,
      params.barterExcludeDogtags ?? false,
    );
    if (pPrice <= 0 && !pAvail) continue; // skip unpurchasable
    const pid = preset.id;
    presetPricesMap[pid] = pPrice;
    const supply = presetSupply(preset.items);
    presetSupplyMap[pid] = supply;
    for (const itemId of supply.keys()) {
      if (!itemToPresets[itemId]) itemToPresets[itemId] = [];
      itemToPresets[itemId].push(pid);
    }
  }

  // ========================================================================
  // 2. Filter available items (mirrors CP-SAT)
  // ========================================================================

  const availableItems: Record<string, true> = {};
  const itemPrices: Record<string, [number, string | null, boolean]> = {};

  for (const itemId of Object.keys(reachable)) {
    if (!(itemId in itemLookup)) continue;
    if (excludeItemSet.has(itemId)) continue;

    const entry = itemLookup[itemId];
    const stats = entry.stats;

    // Category exclusion
    if (entry.type === 'mod') {
      const catId = (stats as import('./types').ModStats).category_id;
      if (catId && excludeCatSet.has(catId)) continue;
    }

    let price: number;
    let source: string | null;
    let canBuyAtSettings: boolean;
    if (entry.type === 'mod' && !(stats as ModStats).purchasable) {
      price = 0;
      source = 'not_purchasable';
      canBuyAtSettings = false;
    } else {
      [price, source, canBuyAtSettings] = getAvailablePrice(
        stats,
        traderLevels,
        params.fleaAvailable ?? true,
        params.playerLevel ?? null,
        params.barterAvailable ?? false,
        params.barterExcludeDogtags ?? false,
      );
    }

    if (entry.type === 'mod' && ownedSet.has(itemId)) {
      price = 0;
      source = 'owned';
      canBuyAtSettings = true;
    }

    const inPreset = itemId in itemToPresets;
    const defaultPrice = stats.price ?? 0;

    // Items >100M price can only come via preset
    if (defaultPrice > 100_000_000) {
      if (!inPreset) continue;
      itemPrices[itemId] = [0, source, false];
      availableItems[itemId] = true;
      continue;
    }

    // User-required mods stay in the model even when not purchasable at current trader/flea settings
    // (connectivity + buy variables still apply; avoids silently dropping x_i = 1 constraints).
    const userMustInclude = includeItemSet.has(itemId);
    // A part with no legal purchase path and no preset supply is not modelled: the former free "found in raid" stand-in installed parts
    // the physical model caps at zero copies (ADR 0013 section 4A).
    if (!canBuyAtSettings && !inPreset && !userMustInclude) continue;

    availableItems[itemId] = true;
    itemPrices[itemId] = [price, source, canBuyAtSettings];
  }

  // ========================================================================
  // 3. Build 1-indexed item and slot mappings
  // ========================================================================

  const itemIds = Object.keys(availableItems).sort();
  const itemIndex = new Map<string, number>();
  const indexToItem: string[] = ['']; // 0 unused
  for (let i = 0; i < itemIds.length; i++) {
    itemIndex.set(itemIds[i], i + 1);
    indexToItem.push(itemIds[i]);
  }
  const n_items = itemIds.length;

  // Collect only slots that have at least one available item
  const usedSlotIds = new Set<string>();
  for (const slotId of Object.keys(slotItems)) {
    for (const iid of slotItems[slotId]) {
      if (iid in availableItems) {
        usedSlotIds.add(slotId);
        break;
      }
    }
  }
  const slotIdsSorted = [...usedSlotIds].sort();
  const slotIndex = new Map<string, number>();
  const indexToSlot: string[] = [''];
  for (let i = 0; i < slotIdsSorted.length; i++) {
    slotIndex.set(slotIdsSorted[i], i + 1);
    indexToSlot.push(slotIdsSorted[i]);
  }
  const n_slots = slotIdsSorted.length;

  // ========================================================================
  // 4. Build base options (naked gun + presets)
  // ========================================================================

  const baseIds: string[] = [];
  const basePrices: number[] = [];
  const baseIsNaked: number[] = [];

  // Naked base goes through getAvailablePrice like every mod and preset, so
  // trader loyalty levels and TRADER_DISABLED gate the bare receiver too.
  // (weaponStats.price is the unfiltered cheapest offer — reading it directly
  // let the LP buy a receiver the player's trader settings forbid.)
  // Gun offers are trader-only, so the flea and player-level arguments never
  // decide anything here; they are passed for signature parity.
  const [nakedAvailPrice, , nakedAvailable] = getAvailablePrice(
    weaponStats,
    traderLevels,
    params.fleaAvailable ?? true,
    params.playerLevel ?? null,
    params.barterAvailable ?? false,
    params.barterExcludeDogtags ?? false,
  );
  const nakedGunPriceRaw = nakedAvailPrice;
  const nakedGunPurchasable = nakedAvailable && nakedGunPriceRaw > 0;
  if (nakedGunPurchasable) {
    baseIds.push('naked');
    basePrices.push(nakedGunPriceRaw);
    baseIsNaked.push(1);
  }
  for (const pid of Object.keys(presetPricesMap)) {
    baseIds.push(pid);
    basePrices.push(presetPricesMap[pid]);
    baseIsNaked.push(0);
  }

  // No purchasable base: the model is empty (the base-choice row below is a contradiction). The former fallback installed the first preset at
  // 0 RUB, a free base no player can buy (ADR 0013 section 4A).

  const n_bases = baseIds.length;

  // Map base IDs to 1-indexed
  const baseIndex = new Map<string, number>();
  for (let i = 0; i < baseIds.length; i++) {
    baseIndex.set(baseIds[i], i + 1);
  }

  // ========================================================================
  // 5. Per-item arrays (1-indexed, element 0 unused)
  // ========================================================================

  const item_ergo: number[] = [0];
  const item_recoil: number[] = [0];
  const item_price_budget: number[] = [0]; // real spend / maxPrice cap only
  const item_price_objective: number[] = [0]; // includes large stand-in for unpurchasable mods
  const item_available: number[] = [0];
  const item_weight_g: number[] = [0]; // weight in grams for weight constraint
  const item_capacity: number[] = [0]; // magazine capacity
  const item_sighting_range: number[] = [0]; // sighting range
  const item_accuracy_mod: number[] = [0]; // accuracy modifier (percentage * 100 for integer math)
  const item_barrel_coi: number[] = [0]; // barrel-only: centerOfImpact when installed (replaces weapon base), 0 for non-barrel mods

  for (let idx = 1; idx <= n_items; idx++) {
    const iid = indexToItem[idx];
    const entry = itemLookup[iid];
    const stats = entry.stats;

    if (entry.type === 'mod') {
      const ms = stats as import('./types').ModStats;
      item_ergo.push(ms.ergonomics * ERGO_SCALE);
      item_recoil.push(ms.recoil_modifier * SCALE);
      const listedRub = itemPrices[iid]?.[0] ?? 0;
      if (ms.purchasable || ownedSet.has(iid)) {
        item_price_budget.push(listedRub);
        item_price_objective.push(listedRub);
      } else {
        item_price_budget.push(0);
        const ref = ms.reference_price_rub ?? 0;
        item_price_objective.push(Math.round(Math.max(ref, UNPURCHASABLE_OBJECTIVE_PRICE_MIN_RUB)));
      }
      item_available.push(itemPrices[iid]?.[2] ? 1 : 0);
      item_weight_g.push((ms.weight ?? 0) * 1000);
      item_capacity.push(ms.capacity ?? 0);
      item_sighting_range.push(ms.sighting_range ?? 0);
      item_accuracy_mod.push(Math.round((ms.accuracy_modifier ?? 0) * 100));
      item_barrel_coi.push(ms.center_of_impact ?? 0);
    } else {
      item_ergo.push(0);
      item_recoil.push(0);
      item_price_budget.push(0);
      item_price_objective.push(0);
      item_available.push(0);
      item_weight_g.push(0);
      item_capacity.push(0);
      item_sighting_range.push(0);
      item_accuracy_mod.push(0);
      item_barrel_coi.push(0);
    }
  }

  // ========================================================================
  // 6. Slot-item membership
  // ========================================================================

  const slot_of_member: number[] = [];
  const item_of_member: number[] = [];
  for (const slotId of slotIdsSorted) {
    const sIdx = slotIndex.get(slotId)!;
    for (const iid of slotItems[slotId]) {
      if (itemIndex.has(iid)) {
        slot_of_member.push(sIdx);
        item_of_member.push(itemIndex.get(iid)!);
      }
    }
  }
  const n_memberships = slot_of_member.length;

  // Build slotId → nameId map for slot grouping
  const slotNameId = new Map<string, string>();
  for (const slot of weapon.slots) {
    slotNameId.set(slot.id, slot.nameId);
  }
  for (const iid of Object.keys(cmap.item_to_slots)) {
    if (!(iid in itemLookup)) continue;
    for (const slot of itemLookup[iid].slots) {
      slotNameId.set(slot.id, slot.nameId);
    }
  }

  // ========================================================================
  // 7. Slot ownership and required flag
  // ========================================================================

  const slot_owner_arr: number[] = [0]; // 0 unused (1-indexed)
  const slot_required: number[] = [0];

  const requiredSlots = new Set<string>();
  for (const slot of weapon.slots) {
    if (slot.required) requiredSlots.add(slot.id);
  }
  for (const iid of Object.keys(cmap.item_to_slots)) {
    if (!(iid in itemLookup)) continue;
    const entry = itemLookup[iid];
    for (const slot of entry.slots) {
      if (slot.required) requiredSlots.add(slot.id);
    }
  }

  for (const slotId of slotIdsSorted) {
    const ownerId = slotOwner[slotId];
    if (ownerId === weaponId) {
      slot_owner_arr.push(0); // weapon root
    } else if (itemIndex.has(ownerId)) {
      slot_owner_arr.push(itemIndex.get(ownerId)!);
    } else {
      slot_owner_arr.push(-1); // owner not in LP — slot is orphaned
    }
    slot_required.push(requiredSlots.has(slotId) ? 1 : 0);
  }

  // ========================================================================
  // 8. Conflict pairs (deduplicated)
  // ========================================================================

  const conflict_a: number[] = [];
  const conflict_b: number[] = [];
  const conflictPairsSeen = new Set<string>();

  for (const iid of itemIds) {
    const entry = itemLookup[iid];
    if (entry.type !== 'mod') continue;
    const conflicts = (entry as ModLookupEntry).conflicting_items;
    for (const cid of conflicts) {
      if (cid === iid) continue; // self-conflict: tarkov.dev sometimes lists an item as its own conflict (e.g. AK-105 5.56 barrel) — would emit `conf_N: x_i + x_i <= 1` which HiGHS rejects as a duplicate column
      if (!itemIndex.has(cid)) continue;
      const a = itemIndex.get(iid)!;
      const b = itemIndex.get(cid)!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (conflictPairsSeen.has(key)) continue;
      conflictPairsSeen.add(key);
      conflict_a.push(Math.min(a, b));
      conflict_b.push(Math.max(a, b));
    }
  }

  // ========================================================================
  // 9. Preset-item membership for buy logic
  // ========================================================================

  const preset_base_of: number[] = [];
  const preset_item_of: number[] = [];
  const preset_supply_of: number[] = []; // q_{b,i}: copies of the item the preset supplies
  for (const pid of Object.keys(presetSupplyMap)) {
    const bIdx = baseIndex.get(pid);
    if (bIdx === undefined) continue;
    for (const [iid, supplied] of presetSupplyMap[pid]) {
      if (itemIndex.has(iid)) {
        preset_base_of.push(bIdx);
        preset_item_of.push(itemIndex.get(iid)!);
        preset_supply_of.push(supplied);
      }
    }
  }

  // ========================================================================
  // 10. Build slot→items and item→slots maps from membership data
  // ========================================================================

  const slotToItemIndices = new Map<number, number[]>();
  const itemToSlotIndices = new Map<number, number[]>();
  for (let m = 0; m < n_memberships; m++) {
    const s = slot_of_member[m];
    const i = item_of_member[m];
    if (!slotToItemIndices.has(s)) slotToItemIndices.set(s, []);
    const slotItemsArr = slotToItemIndices.get(s)!;
    // HiGHS rejects duplicate columns in one row; cmap may list the same item twice per slot.
    if (!slotItemsArr.includes(i)) slotItemsArr.push(i);
    if (!itemToSlotIndices.has(i)) itemToSlotIndices.set(i, []);
    if (!itemToSlotIndices.get(i)!.includes(s)) itemToSlotIndices.get(i)!.push(s);
  }

  // ========================================================================
  // 10b. Multi-slot handling strategy
  // ========================================================================
  //
  // Items that appear in multiple slots cause over-constraining: x_i counts
  // in ALL slot mutexes, blocking slots the item doesn't physically occupy.
  //
  // Combined approach (always active, no preciseMode needed):
  //
  // 1. BIG-M CONDITIONAL MUTEX: For slots owned by non-root mods, relax the
  //    mutex when the owner is not selected. This correctly handles items
  //    that span slots on different owners (the common case, ~60% of items).
  //    Formula: sum(items) - M * x_owner <= 1 - M  (active only when owner=1)
  //
  // 2. SLOT GROUPING: Merge same-owner, same-item-set slots into a single
  //    capacity constraint. Handles items in identical slots on the same owner.
  //
  // 3. TARGETED PLACEMENT VARS: Only for the rare items that appear in
  //    multiple slots on the SAME owner with DIFFERENT item sets. Typically
  //    ~0-5 items instead of ~300.
  //
  // This gives CP-SAT equivalence with minimal extra variables.
  // ========================================================================

  // In precise mode: full placement variables for all multi-slot items.
  // In fast mode: simple per-slot mutex with x_i (sub-second, ~1-2% suboptimal).
  const usePrecise = !!params.preciseMode;
  const multiSlotItems = new Set<number>();
  if (usePrecise) {
    for (const [item, slots] of itemToSlotIndices) {
      if (slots.length > 1) multiSlotItems.add(item);
    }
  }

  // Group preset memberships by item: the bases that supply it and q_{b,i} per base.
  const itemToPresetBases = new Map<number, number[]>();
  const itemToPresetSupply = new Map<number, number[]>();
  for (let m = 0; m < preset_base_of.length; m++) {
    const bIdx = preset_base_of[m];
    const iIdx = preset_item_of[m];
    if (!itemToPresetBases.has(iIdx)) {
      itemToPresetBases.set(iIdx, []);
      itemToPresetSupply.set(iIdx, []);
    }
    itemToPresetBases.get(iIdx)!.push(bIdx);
    itemToPresetSupply.get(iIdx)!.push(preset_supply_of[m]);
  }
  /** `base_b` terms weighted by the copies each preset supplies: sum_b q_{b,i} * base_b (unit weight omitted). */
  const suppliedBy = (item: number): string => {
    const bases = itemToPresetBases.get(item)!;
    const supply = itemToPresetSupply.get(item)!;
    return bases.map((b, k) => (supply[k] === 1 ? `base_${b}` : `${fmt(supply[k])} base_${b}`)).join(' + ');
  };

  const model = objectiveModel(params);
  const weapon_naked_ergo_scaled = weaponStats.naked_ergonomics * ERGO_SCALE;
  const baseWeight = weaponStats.weight || 0;
  let weightBounds: [number, number];
  let rawLo: number;
  let rawHi: number;
  if (params.boundsMode === 'naive') {
    weightBounds = [
      Math.max(0, baseWeight + item_weight_g.reduce((sum, w) => sum + Math.min(0, w) / 1000, 0)),
      baseWeight + item_weight_g.reduce((sum, w) => sum + Math.max(0, w) / 1000, 0),
    ];
    rawLo = weapon_naked_ergo_scaled + item_ergo.reduce((s, e) => s + Math.min(0, e), 0);
    rawHi = weapon_naked_ergo_scaled + item_ergo.reduce((s, e) => s + Math.max(0, e), 0);
  } else {
    // Require unclipped physical bounds and matching preparation context for reuse.
    // Recompute when provenance is absent or legacy-shaped; never trust a clipped fallback.
    const supplied = params.structuralBounds;
    const isProven = supplied &&
      supplied.context &&
      typeof supplied.context === 'object' &&
      supplied.context.weaponId === params.weaponId &&
      Array.isArray(supplied.physicalWeightBounds) &&
      supplied.physicalWeightBounds.length === 2 &&
      Number.isFinite(supplied.physicalWeightBounds[0]) &&
      Number.isFinite(supplied.physicalWeightBounds[1]);

    const structural = isProven ? supplied : computeStructuralBounds(
      params.weaponId,
      params.itemLookup,
      params.compatibilityMap,
      { maxWeight: params.maxWeight },
    );
    // Apply request maxWeight dynamically to verified unclipped physical bounds
    const [physMin, physMax] = structural.physicalWeightBounds;
    const effectiveMax = params.maxWeight != null && params.maxWeight > 0
      ? Math.max(physMin, Math.min(physMax, params.maxWeight))
      : physMax;
    weightBounds = [physMin, effectiveMax];
    rawLo = Math.min(weapon_naked_ergo_scaled, structural.ergoBounds[0] * ERGO_SCALE);
    rawHi = Math.max(1000, structural.ergoBounds[1] * ERGO_SCALE);
  }
  const interval = weightInterval ?? weightBounds;
  const nakedRecoilV = weaponStats.naked_recoil_v;

  // ========================================================================
  // 12. Generate CPLEX LP format string
  // ========================================================================

  const lines: string[] = [];
  const L = (s: string) => lines.push(s);

  // Collect all binary variable names
  const binaryVars: string[] = [];

  // ------ OBJECTIVE ------
  L('Maximize');

  const objTerms: string[] = [];
  const isTchebycheff = !!(params.useTchebycheff && params.idealPoint);
  const tchAuxRows: string[] = [];
  const tchFreeBounds: string[] = [];

  const ergoAxis = params.useTrueErgo ? 'ted_axis' : 'capped_ergo';
  objTerms.push(`${fmt(model.ergo)} ${ergoAxis}`);
  objTerms.push(`${fmt(model.recoil)} rec_axis`);
  objTerms.push(`${fmt(model.price)} price_axis`);
  if (isTchebycheff) {
    objTerms.push('-1 tch_t');
    const variables = { fE: ergoAxis, fR: 'rec_axis', fP: 'price_axis' };
    for (const [i, d] of model.deviations.entries()) {
      tchAuxRows.push(`  tch_${i}: tch_t ${d.coefficient < 0 ? '+' : '-'} ${fmt(Math.abs(d.coefficient))} ${variables[d.axis]} >= ${fmt(-d.coefficient * d.ideal)}`);
    }
    tchFreeBounds.push(model.deviations.length ? '  tch_t free' : '  tch_t = 0');
  }

  // HiGHS WASM has issues parsing long objective lines. Use an auxiliary
  // continuous variable and move all terms to a constraint.
  L('  obj: total_obj');
  L('');

  // Define total_obj via constraint (in Subject To section)
  // total_obj - [all terms] = 0  =>  total_obj = sum of all terms
  const objDefTerms = ['total_obj'];
  for (const term of objTerms) {
    const t = term.trim();
    // Negate each term for the constraint (moving to RHS)
    if (t.startsWith('-')) {
      objDefTerms.push(t.slice(1).trim()); // remove leading '-', becomes positive
    } else {
      objDefTerms.push('-' + t); // negate positive to negative
    }
  }
  L('');

  // ------ CONSTRAINTS ------
  L('Subject To');

  // Objective definition: total_obj = sum(all objective terms)
  // Split across multiple equality constraints to avoid long lines.
  // obj_def_1: total_obj - chunk1_terms - ... = partial_sum (absorbed into total_obj)
  // Actually simpler: use multiple sub-total vars
  {
    const SUB_SIZE = 50; // terms per sub-constraint
    const subVars: string[] = [];
    for (let c = 0; c < objTerms.length; c += SUB_SIZE) {
      const chunk = objTerms.slice(c, c + SUB_SIZE);
      const subVar = `obj_sub_${Math.floor(c / SUB_SIZE)}`;
      subVars.push(subVar);
      // sub_var = sum(chunk terms)
      // sub_var - term1 - term2 ... = 0
      const negated = chunk.map(t => {
        const trimmed = t.trim();
        return trimmed.startsWith('-') ? trimmed.slice(1).trim() : '-' + trimmed;
      });
      L(`  obj_def_${Math.floor(c / SUB_SIZE)}: ${subVar} ${negated.map(t => t.startsWith('-') ? '- ' + t.slice(1) : '+ ' + t).join(' ')} = 0`);
    }
    // total_obj = sum(sub vars)
    L(`  obj_link: total_obj - ${subVars.join(' - ')} = 0`);
    if (tchAuxRows.length > 0) {
      for (const row of tchAuxRows) {
        L(row);
      }
    }
  }

  // --- 1. Base sum: exactly one base selected ---
  {
    const terms = [];
    for (let b = 1; b <= n_bases; b++) {
      terms.push(`base_${b}`);
    }
    L(terms.length > 0 ? `  base_sum: ${terms.join(' + ')} = 1` : '  base_sum: 0 __dummy = 1');
  }

  // --- 2. Slot mutex ---
  for (const [slot, items] of slotToItemIndices) {
    if (items.length <= 1) continue;
    const terms: string[] = [];
    for (const item of items) {
      if (multiSlotItems.has(item)) {
        terms.push(`p_${item}_${slot}`);
      } else {
        terms.push(`x_${item}`);
      }
    }
    L(`  slot_${slot}: ${terms.join(' + ')} <= 1`);
  }


  // --- 3. Placement linking (precise mode only) ---
  for (const item of multiSlotItems) {
    const slots = itemToSlotIndices.get(item)!;
    const placementVars = slots.map(s => `p_${item}_${s}`);
    L(`  place_${item}: ${placementVars.join(' + ')} - x_${item} = 0`);
  }

  // --- 4. Connectivity ---
  for (let i = 1; i <= n_items; i++) {
    const slots = itemToSlotIndices.get(i);
    if (!slots || slots.length === 0) {
      L(`  nop_${i}: x_${i} = 0`);
      continue;
    }

    if (multiSlotItems.has(i)) {
      // Each placement var requires its slot owner
      for (const slot of slots) {
        const owner = slot_owner_arr[slot];
        if (owner === -1) {
          // Orphaned slot — force placement to 0
          L(`  conn_p_${i}_${slot}: p_${i}_${slot} = 0`);
        } else if (owner !== 0) {
          L(`  conn_p_${i}_${slot}: p_${i}_${slot} - x_${owner} <= 0`);
        }
      }
    } else {
      const owners = slots.map(s => slot_owner_arr[s]);
      const hasRoot = owners.includes(0);
      if (hasRoot) {
        // On weapon root — always connectable
      } else {
        // Filter out orphaned owners (-1) — their slots don't exist in the LP
        const uniqueOwners = [...new Set(owners)].filter(o => o > 0);
        if (uniqueOwners.length === 0) {
          L(`  nop_${i}: x_${i} = 0`);
        } else if (uniqueOwners.length === 1) {
          L(`  conn_${i}: x_${i} - x_${uniqueOwners[0]} <= 0`);
        } else {
          L(`  conn_${i}: x_${i} - ${uniqueOwners.map(o => `x_${o}`).join(' - ')} <= 0`);
        }
      }
    }
  }

  // --- 5. Conflicts ---
  for (let c = 0; c < conflict_a.length; c++) {
    L(`  conf_${c}: x_${conflict_a[c]} + x_${conflict_b[c]} <= 1`);
  }

  // --- 6. Item availability: preset-only items; a part with no purchase path and no preset supply is never installed ---
  for (let i = 1; i <= n_items; i++) {
    if (item_available[i] === 1) continue;
    const presetBases = itemToPresetBases.get(i);
    if (presetBases && presetBases.length > 0) {
      // x_i can only be 1 when some selected preset supplies at least one copy: x_i <= sum_b q_{b,i} base_b.
      L(`  avail_${i}: x_${i} - ${suppliedBy(i)} <= 0`);
    } else {
      L(`  avail_${i}: x_${i} = 0`);
    }
  }

  // --- 7. Buy logic ---
  for (let i = 1; i <= n_items; i++) {
    const presetBases = itemToPresetBases.get(i);
    if (presetBases && presetBases.length > 0) {
      // buy[i] <= x[i]
      L(`  buy_le_x_${i}: buy_${i} - x_${i} <= 0`);
      // buy[i] + base[b] <= 1 for each containing preset b
      for (const b of presetBases) {
        L(`  buy_le_nb_${i}_${b}: buy_${i} + base_${b} <= 1`);
      }
      // buy[i] >= x[i] - sum_b q_{b,i} base[b]: the single installed copy is paid for unless a preset supplies it.
      // buy[i] - x[i] + sum_b q_{b,i} base[b] >= 0
      L(`  buy_ge_${i}: buy_${i} - x_${i} + ${suppliedBy(i)} >= 0`);
    } else {
      // Not in any preset — buy = x (unpurchasable mods use stand-in objective price only)
      L(`  buy_eq_${i}: buy_${i} - x_${i} = 0`);
    }
  }

  // --- 8. Required slots ---
  for (let s = 1; s <= n_slots; s++) {
    if (slot_required[s] !== 1) continue;
    const itemsInSlot = slotToItemIndices.get(s);
    if (!itemsInSlot || itemsInSlot.length === 0) continue;

    // Count the variable that actually occupies this slot. A multi-slot item's
    // x_i is 1 when it fills any one of its slots, so using x_i here lets one
    // item satisfy every required slot it could have been placed in.
    const sumExpr = itemsInSlot.map(i => (
      multiSlotItems.has(i) ? `p_${i}_${s}` : `x_${i}`
    )).join(' + ');
    const owner = slot_owner_arr[s]; // 0=root, else item index, -1 = the owner has no column in this LP

    if (owner === -1) {
      // An owner that has no column can never be installed, so its required slot binds nothing. (The row used to be written as
      // `- x_-1 + ...`: HiGHS reads `x_-1` as the column `x_` and the number -1, a different model than the one written.)
      continue;
    }
    if (owner === 0) {
      // Weapon-root required slot: must always have an item
      L(`  req_${s}: ${sumExpr} >= 1`);
    } else {
      // Mod-owned required slot: if owner selected, slot must have an item
      // -x[owner] + sum(x[items in slot]) >= 0
      L(`  mreq_${s}: - x_${owner} + ${sumExpr} >= 0`);
    }
  }

  // Exact clamp, including negative raw ergo and the equipment saturation.
  // Each clamp has three disjoint linear regimes with valid data-derived M.
  const clampRows = (name: string, source: string, lo: number, hi: number, cap: number) => {
    const m = Math.max(Math.abs(lo), Math.abs(hi), cap) + cap;
    binaryVars.push(`${name}_low`, `${name}_mid`, `${name}_high`);
    L(`  ${name}_regime: ${name}_low + ${name}_mid + ${name}_high = 1`);
    L(`  ${name}_lo: ${source} + ${fmt(m)} ${name}_low <= ${fmt(m)}`);
    L(`  ${name}_hi: ${source} - ${fmt(m)} ${name}_high >= ${fmt(cap - m)}`);
    L(`  ${name}_midlo: ${source} - ${fmt(m)} ${name}_mid >= ${fmt(-m)}`);
    L(`  ${name}_midhi: ${source} + ${fmt(m)} ${name}_mid <= ${fmt(cap + m)}`);
    L(`  ${name}_zero: ${name} + ${fmt(cap)} ${name}_low <= ${fmt(cap)}`);
    L(`  ${name}_full: ${name} - ${fmt(cap)} ${name}_high >= 0`);
    L(`  ${name}_eqlo: ${name} - ${source} - ${fmt(m)} ${name}_mid >= ${fmt(-m)}`);
    L(`  ${name}_eqhi: ${name} - ${source} + ${fmt(m)} ${name}_mid <= ${fmt(m)}`);
  };
  const rawTerms = ['raw_ergo'];
  const weightTerms = ['total_weight'];
  const recoilTerms = ['rec_axis'];
  const priceTerms = ['price_axis'];
  for (let i = 1; i <= n_items; i++) {
    if (item_ergo[i]) rawTerms.push(`${fmt(-item_ergo[i])} x_${i}`);
    if (item_weight_g[i]) weightTerms.push(`${fmt(-item_weight_g[i] / 1000)} x_${i}`);
    if (item_recoil[i]) recoilTerms.push(`${fmt(-item_recoil[i])} x_${i}`);
    if (item_price_objective[i]) priceTerms.push(`${fmt(-item_price_objective[i])} buy_${i}`);
  }
  for (let b = 0; b < n_bases; b++) {
    if (basePrices[b]) priceTerms.push(`${fmt(-basePrices[b])} base_${b + 1}`);
  }
  L(`  raw_ergo_def: ${formatTerms(rawTerms)} = ${fmt(weapon_naked_ergo_scaled)}`);
  L(`  weight_def: ${formatTerms(weightTerms)} = ${fmt(baseWeight)}`);
  L(`  recoil_def: ${formatTerms(recoilTerms)} = 0`);
  L(`  price_def: ${formatTerms(priceTerms)} = 0`);
  clampRows('capped_ergo', 'raw_ergo', rawLo, rawHi, 1000);
  if (params.useTrueErgo || params.preventOverswing) {
    const factor = Math.max(0, 1 + (params.equipErgoModifier ?? 0));
    L(`  gear_def: gear_ergo - ${fmt(factor)} capped_ergo = 0`);
    clampRows('effective_ergo', 'gear_ergo', 0, factor * 1000, 1000);
    // q is concave above 3 kg: its secant lies BELOW the true penalty.
    // Thus ted_axis is an UPPER relaxation, never an inner restriction.
    const [lo, hi] = interval;
    const slope = hi > lo ? (weightPenalty(hi) - weightPenalty(lo)) / (hi - lo) : 0;
    const intercept = weightPenalty(lo) - slope * lo;
    // An interval crossing 3 uses q >= 0, also a valid outer relaxation.
    const crossesThree = lo < 3 && hi > 3;
    L(`  ted_def: ted_axis - effective_ergo + ${fmt(crossesThree ? 0 : 10 * slope)} total_weight = ${fmt(crossesThree ? 0 : -10 * intercept)}`);
    if (params.preventOverswing) L('  no_overswing: ted_axis >= 0');
  }

  // --- 10. Hard constraints from SolveParams ---

  // maxPrice
  if (params.maxPrice != null) {
    const priceTerms: string[] = [];
    for (let b = 0; b < n_bases; b++) {
      if (basePrices[b] !== 0) {
        priceTerms.push(`${basePrices[b]} base_${b + 1}`);
      }
    }
    for (let i = 1; i <= n_items; i++) {
      if (item_price_budget[i] !== 0) {
        priceTerms.push(`${item_price_budget[i]} buy_${i}`);
      }
    }
    if (priceTerms.length > 0) {
      L(`  price_lim: ${formatTerms(priceTerms)} <= ${params.maxPrice}`);
    }
  }

  // minErgonomics
  if (params.minErgonomics != null) {
    L(`  ergo_min: capped_ergo >= ${params.minErgonomics * ERGO_SCALE}`);
  }

  if (params.maxRecoilV != null && nakedRecoilV > 0) {
    L(`  recoil_lim: rec_axis <= ${fmt(SCALE * (params.maxRecoilV / nakedRecoilV - 1))}`);
  }

  if (params.maxRecoilSum != null) {
    const nakedSum = nakedRecoilV + weaponStats.naked_recoil_h;
    if (nakedSum > 0) {
      L(`  recoil_sum_lim: rec_axis <= ${fmt(SCALE * (params.maxRecoilSum / nakedSum - 1))}`);
    }
  }

  // minMagCapacity: at least one selected item must have capacity >= minMagCapacity
  if (params.minMagCapacity != null) {
    const magItems: number[] = [];
    for (let i = 1; i <= n_items; i++) {
      if (item_capacity[i] >= params.minMagCapacity) {
        magItems.push(i);
      }
    }
    if (magItems.length > 0) {
      const sumExpr = magItems.map(i => `x_${i}`).join(' + ');
      L(`  mag_cap: ${sumExpr} >= 1`);
    } else {
      // No magazines meet the capacity requirement — force infeasibility
      L(`  mag_cap: 0 __dummy >= 1`);
    }
  }

  // minSightingRange: at least one selected item (or the base gun) must have sighting_range >= minSightingRange
  if (params.minSightingRange != null) {
    const baseSightingRange = weaponStats.sighting_range ?? 0;
    if (baseSightingRange < params.minSightingRange) {
      const sightItems: number[] = [];
      for (let i = 1; i <= n_items; i++) {
        if (item_sighting_range[i] >= params.minSightingRange) {
          sightItems.push(i);
        }
      }
      if (sightItems.length > 0) {
        const sumExpr = sightItems.map(i => `x_${i}`).join(' + ');
        L(`  sight_range: ${sumExpr} >= 1`);
      } else {
        // No sights meet the range requirement — force infeasibility
        L(`  sight_range: 0 __dummy >= 1`);
      }
    }
  }

  if (params.maxWeight != null) {
    L(`  weight_lim: total_weight <= ${fmt(params.maxWeight)}`);
  }


  // maxMOA: finalMOA = effectiveBaseCOI * (1 - sum(acc_mod_real)/100) * MOA_K <= maxMOA
  //   where acc_mod_real = item_accuracy_mod[i] / 100 (stored pre-scaled by ×100).
  //   effectiveBaseCOI = coi_b when a barrel mod b is installed (REPLACES weapon intrinsic),
  //                      else weapon intrinsic COI (w).
  // Per-barrel big-M constraint (exact, x_b binary):
  //   when x_b = 1:  coi_b*K - (coi_b*K/10000) * sum(item_accuracy_mod[i] * x_i) <= maxMOA
  //   rearranged:    (coi_b*K/10000) * sum(acc_mod[i] * x_i) - M * x_b >= coi_b*K - maxMOA - M
  //   when x_b = 0, RHS is very negative so the constraint is vacuous.
  // If the barrel slot is OPTIONAL, also add an intrinsic-COI fallback guarded by sum_b(x_b).
  // For fixed-barrel weapons: (w*K/10000) * sum_i(acc_mod[i] * x_i) >= w*K - maxMOA.
  if (params.maxMOA != null) {
    const baseCOI = weaponStats.center_of_impact ?? 0;
    if (baseCOI > 0) {
      const barrelIndices: number[] = [];
      for (let i = 1; i <= n_items; i++) {
        if (item_barrel_coi[i] > 0) barrelIndices.push(i);
      }

      if (barrelIndices.length > 0) {
        const BIG_M = 1000; // safe upper bound on |coi_b*K − maxMOA|; real values are well under 100.
        for (const bIdx of barrelIndices) {
          const coi_b = item_barrel_coi[bIdx];
          const coefScale = (coi_b * MOA_K) / 10000;
          const coeffByItem = new Map<number, number>();
          for (let i = 1; i <= n_items; i++) {
            if (item_accuracy_mod[i] !== 0) {
              coeffByItem.set(i, coefScale * item_accuracy_mod[i]);
            }
          }
          coeffByItem.set(bIdx, (coeffByItem.get(bIdx) ?? 0) - BIG_M);
          const terms: string[] = [];
          for (const [i, c] of coeffByItem) {
            if (c !== 0) terms.push(`${c.toFixed(6)} x_${i}`);
          }
          const rhs = coi_b * MOA_K - params.maxMOA - BIG_M;
          L(`  moa_lim_${bIdx}: ${formatTerms(terms)} >= ${rhs.toFixed(6)}`);
        }

        // Fallback for "no COI-barrel installed" — intrinsic COI applies.
        const fbScale = (baseCOI * MOA_K) / 10000;
        const fallbackCoeffs = new Map<number, number>();
        for (let i = 1; i <= n_items; i++) {
          if (item_accuracy_mod[i] !== 0) {
            fallbackCoeffs.set(i, fbScale * item_accuracy_mod[i]);
          }
        }
        for (const bIdx of barrelIndices) {
          fallbackCoeffs.set(bIdx, (fallbackCoeffs.get(bIdx) ?? 0) + BIG_M);
        }
        const fbTerms: string[] = [];
        for (const [i, c] of fallbackCoeffs) {
          if (c !== 0) fbTerms.push(`${c.toFixed(6)} x_${i}`);
        }
        if (fbTerms.length > 0) {
          const fbRhs = baseCOI * MOA_K - params.maxMOA;
          L(`  moa_lim_nobarrel: ${formatTerms(fbTerms)} >= ${fbRhs.toFixed(6)}`);
        }
      } else {
        const coefScale = (baseCOI * MOA_K) / 10000;
        const terms: string[] = [];
        for (let i = 1; i <= n_items; i++) {
          if (item_accuracy_mod[i] !== 0) {
            const coef = coefScale * item_accuracy_mod[i];
            terms.push(`${coef.toFixed(6)} x_${i}`);
          }
        }
        if (terms.length > 0) {
          const rhs = baseCOI * MOA_K - params.maxMOA;
          L(`  moa_lim: ${formatTerms(terms)} >= ${rhs.toFixed(6)}`);
        }
      }
    }
  }

  // includeItems: force specific items from params (implicit deps are UI-only; see requiredItemDeps + worker).
  // An id with no variable on this weapon is infeasible — do not drop the row.
  if (params.includeItems) {
    let missingIncl = 0;
    for (const iid of params.includeItems) {
      const idx = itemIndex.get(iid);
      if (idx !== undefined) {
        L(`  incl_${idx}: x_${idx} = 1`);
      } else {
        L(`  incl_unavail_${missingIncl}: 0 >= 1`);
        missingIncl += 1;
      }
    }
  }

  // includeCategories: OR within each group, at least one item from each group.
  // An empty group is infeasible — the gun cannot satisfy that required category.
  if (params.includeCategories) {
    for (let g = 0; g < params.includeCategories.length; g++) {
      const catGroup = params.includeCategories[g];
      const matchingItems: number[] = [];
      for (let i = 1; i <= n_items; i++) {
        const iid = indexToItem[i];
        const entry = itemLookup[iid];
        if (entry.type === 'mod') {
          const catId = (entry.stats as import('./types').ModStats).category_id;
          if (catId && catGroup.includes(catId)) {
            matchingItems.push(i);
          }
        }
      }
      if (matchingItems.length > 0) {
        const sumExpr = matchingItems.map(i => `x_${i}`).join(' + ');
        L(`  catreq_${g}: ${sumExpr} >= 1`);
      } else {
        L(`  catreq_${g}: 0 >= 1`);
      }
    }
  }

  L('');

  // ------ BOUNDS ------
  L('Bounds');
  L('  0 <= capped_ergo <= 1000');
  L('  -inf <= total_obj <= inf');
  L('  raw_ergo free');
  L('  rec_axis free');
  L('  price_axis free');
  if (params.useTrueErgo || params.preventOverswing) {
    L(`  ${fmt(interval[0])} <= total_weight <= ${fmt(interval[1])}`);
    L('  gear_ergo free');
    L('  0 <= effective_ergo <= 1000');
    L('  ted_axis free');
  }
  const nSubVars = Math.ceil(objTerms.length / 50);
  for (let s = 0; s < nSubVars; s++) {
    L(`  -inf <= obj_sub_${s} <= inf`);
  }
  if (tchFreeBounds.length > 0) {
    for (const b of tchFreeBounds) {
      L(b);
    }
  }
  L('');

  // ------ BINARY ------
  L('Binary');

  // Collect all binary variables
  for (let i = 1; i <= n_items; i++) {
    binaryVars.push(`x_${i}`);
  }
  for (let i = 1; i <= n_items; i++) {
    binaryVars.push(`buy_${i}`);
  }
  for (let b = 1; b <= n_bases; b++) {
    binaryVars.push(`base_${b}`);
  }
  for (const item of multiSlotItems) {
    for (const slot of itemToSlotIndices.get(item)!) {
      binaryVars.push(`p_${item}_${slot}`);
    }
  }

  // Write binary vars (multiple per line for readability)
  const VARS_PER_LINE = 20;
  for (let i = 0; i < binaryVars.length; i += VARS_PER_LINE) {
    const chunk = binaryVars.slice(i, i + VARS_PER_LINE);
    L('  ' + chunk.join(' '));
  }
  L('');

  // ------ END ------
  L('End');

  // Build filtered slotItems map (only slots/items that are in the LP)
  const filteredSlotItems: Record<string, string[]> = {};
  const filteredSlotOwner: Record<string, string> = {};
  for (const slotId of slotIdsSorted) {
    const items = slotItems[slotId].filter(iid => itemIndex.has(iid));
    if (items.length > 0) {
      filteredSlotItems[slotId] = items;
      filteredSlotOwner[slotId] = slotOwner[slotId];
    }
  }

  return {
    lpString: lines.join('\n'),
    indexToItem,
    indexToSlot,
    baseIds,
    nItems: n_items,
    nBases: n_bases,
    weaponId,
    slotItemsMap: filteredSlotItems,
    slotOwnerMap: filteredSlotOwner,
    multiSlotItemIndices: multiSlotItems,
    itemToSlotIndices,
    weightBounds,
    axes(columns, ergo) {
      let recoil = 0;
      let price = 0;
      for (let i = 1; i <= n_items; i++) {
        if (columns[`x_${i}`]?.Primal > 0.5) recoil += item_recoil[i];
        if (columns[`buy_${i}`]?.Primal > 0.5) price += item_price_objective[i];
      }
      for (let b = 0; b < n_bases; b++) {
        if (columns[`base_${b + 1}`]?.Primal > 0.5) price += basePrices[b];
      }
      return { fE: ergo * 10, fR: recoil, fP: price };
    },
    score(axes) { return objectiveScore(model, axes); },
  };
}

// ---------------------------------------------------------------------------
// Helper: format a list of "coeff var" terms into a valid LP expression string
// ---------------------------------------------------------------------------
function formatTerms(terms: string[]): string {
  if (terms.length === 0) return '0 __dummy';
  const parts: string[] = [];
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i].trim();
    if (i === 0) {
      parts.push(term);
    } else {
      if (term.startsWith('-')) {
        parts.push('- ' + term.slice(1));
      } else {
        parts.push('+ ' + term);
      }
    }
  }
  return parts.join(' ');
}
