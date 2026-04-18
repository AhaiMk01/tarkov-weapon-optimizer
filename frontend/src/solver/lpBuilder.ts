/**
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
} from './types';
import { getAvailablePrice } from './dataService';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Constants matching CP-SAT implementation
// ---------------------------------------------------------------------------

const ERGO_SCALE = 10;   // Ergo decimal precision (0.5 ergo → 5)
const SCALE = 1000;       // Recoil modifier precision (-0.05 → -50)

/** RUB cost in objective when mod has no buyFor (scaled by price weight). Not counted toward maxPrice. */
const UNPURCHASABLE_OBJECTIVE_PRICE_MIN_RUB = 50_000_000;

// ---------------------------------------------------------------------------
// buildLP — pure function: SolveParams → LPResult
// ---------------------------------------------------------------------------

export function buildLP(params: SolveParams): LPResult {
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

  // Use provided weights with tiny tiebreakers so no dimension is completely
  // ignored.  A zero-weight dimension can produce degenerate solutions where
  // the solver makes arbitrary choices (e.g. price=0 → needlessly expensive).
  const TIEBREAK = 0.01;
  const ewRaw = params.ergoWeight ?? 1;
  const rwRaw = params.recoilWeight ?? 1;
  const pwRaw = params.priceWeight ?? 0;
  const ew = Math.max(ewRaw, TIEBREAK);
  const rw = Math.max(rwRaw, TIEBREAK);
  const pw = Math.max(pwRaw, TIEBREAK);

  // Exclusion sets from params
  const excludeItemSet = new Set(params.excludeItems ?? []);
  const excludeCatSet = new Set(params.excludeCategories ?? []);
  const includeItemSet = new Set(params.includeItems ?? []);

  // ========================================================================
  // 1. Build preset maps (mirrors CP-SAT)
  // ========================================================================

  const presets: PresetInfo[] = weapon.presets;
  const presetItemsMap: Record<string, Set<string>> = {};
  const itemToPresets: Record<string, string[]> = {};
  const presetPricesMap: Record<string, number> = {};

  for (const preset of presets) {
    const [pPrice, , pAvail] = getAvailablePrice(
      preset,
      params.traderLevels ?? undefined,
      params.fleaAvailable ?? true,
      params.playerLevel ?? null,
      params.barterAvailable ?? false,
      params.barterExcludeDogtags ?? false,
    );
    if (pPrice <= 0 && !pAvail) continue; // skip unpurchasable
    const pid = preset.id;
    presetPricesMap[pid] = pPrice;
    const items = new Set(preset.items);
    presetItemsMap[pid] = items;
    for (const itemId of items) {
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
        params.traderLevels ?? undefined,
        params.fleaAvailable ?? true,
        params.playerLevel ?? null,
        params.barterAvailable ?? false,
        params.barterExcludeDogtags ?? false,
      );
    }

    const inPreset = itemId in itemToPresets;
    const defaultPrice = stats.price ?? 0;
    const isFiRMod = entry.type === 'mod' && !(stats as ModStats).purchasable;

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
    if (!canBuyAtSettings && !inPreset && !isFiRMod && !userMustInclude) continue;

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
  let n_items = itemIds.length;

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

  const nakedGunPriceRaw = weaponStats.price ?? 0;
  const nakedGunPurchasable = nakedGunPriceRaw > 0 && nakedGunPriceRaw < 100_000_000;
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

  // Fallback if no purchasable base
  if (baseIds.length === 0) {
    const allPresets = weapon.all_presets;
    if (allPresets.length > 0) {
      const fb = allPresets[0];
      const fbId = fb.id || 'fallback_preset_0';
      baseIds.push(fbId);
      basePrices.push(0);
      baseIsNaked.push(0);
      // Add fallback preset items
      const fbItems = new Set(fb.items);
      presetItemsMap[fbId] = fbItems;
      presetPricesMap[fbId] = 0;
      for (const iid of fbItems) {
        if (!itemToPresets[iid]) itemToPresets[iid] = [];
        itemToPresets[iid].push(fbId);
        if (iid in reachable && !(iid in availableItems)) {
          availableItems[iid] = true;
          itemPrices[iid] = [0, 'fallback_preset', false];
          if (!itemIndex.has(iid)) {
            indexToItem.push(iid);
            itemIndex.set(iid, indexToItem.length - 1);
            n_items++;
          }
        }
      }
    } else {
      baseIds.push('naked');
      basePrices.push(0);
      baseIsNaked.push(1);
    }
  }

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
      item_ergo.push(Math.round(ms.ergonomics * ERGO_SCALE));
      item_recoil.push(Math.round(ms.recoil_modifier * SCALE));
      const listedRub = Math.round(itemPrices[iid]?.[0] ?? 0);
      if (ms.purchasable) {
        item_price_budget.push(listedRub);
        item_price_objective.push(listedRub);
      } else {
        item_price_budget.push(0);
        const ref = ms.reference_price_rub ?? 0;
        item_price_objective.push(Math.round(Math.max(ref, UNPURCHASABLE_OBJECTIVE_PRICE_MIN_RUB)));
      }
      item_available.push(itemPrices[iid]?.[2] ? 1 : 0);
      item_weight_g.push(Math.round((ms.weight ?? 0) * 1000));
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
  for (const pid of Object.keys(presetItemsMap)) {
    const bIdx = baseIndex.get(pid);
    if (bIdx === undefined) continue;
    for (const iid of presetItemsMap[pid]) {
      if (itemIndex.has(iid)) {
        preset_base_of.push(bIdx);
        preset_item_of.push(itemIndex.get(iid)!);
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

  // Group preset memberships by item
  const itemToPresetBases = new Map<number, number[]>();
  for (let m = 0; m < preset_base_of.length; m++) {
    const bIdx = preset_base_of[m];
    const iIdx = preset_item_of[m];
    if (!itemToPresetBases.has(iIdx)) itemToPresetBases.set(iIdx, []);
    itemToPresetBases.get(iIdx)!.push(bIdx);
  }

  // ========================================================================
  // 11. Objective weights
  // ========================================================================

  // Objective weight coefficients.
  // The original formulation multiplied weights by SCALE (1000) to make
  // tiebreaker 0.01 into integer 10 — needed for CP-SAT but not for HiGHS.
  // Dividing all coefficients uniformly by SCALE keeps the same ratios
  // while capping magnitudes at ~10^8 instead of ~10^11.
  //
  // Resulting coefficient magnitudes (for weight=100, max item_recoil≈210):
  //   ergo:   ew * SCALE * capped_ergo                ≈ 100 * 1000 * 1000  = 10^8
  //   recoil: rw * SCALE * ERGO_SCALE * item_recoil   ≈ 100 * 10000 * 210  = 2×10^8
  //   price:  pw * ERGO_SCALE * item_price             ≈ 100 * 10 * 100000  = 10^8
  const ergo_w = ew;                                   // raw weight (0–100)
  const rw_obj = rw * SCALE * ERGO_SCALE;              // rw * 10,000
  const pw_obj = pw * ERGO_SCALE;                      // pw * 10

  const weapon_naked_ergo_scaled = Math.round(weaponStats.naked_ergonomics * ERGO_SCALE);
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

  // Ergo term: ew * SCALE * capped_ergo
  const ergoObjCoeff = ergo_w * SCALE;
  if (ergoObjCoeff !== 0) {
    objTerms.push(`${ergoObjCoeff} capped_ergo`);
  }

  // Recoil + parsimony terms per item.  Parsimony (-1 per selected item) is
  // merged into the recoil coefficient so that each x_i appears only once —
  // HiGHS's CPLEX LP reader rejects duplicate variables in a constraint row.
  for (let i = 1; i <= n_items; i++) {
    const recoilCoeff = -rw_obj * item_recoil[i];
    const combined = recoilCoeff - 1; // parsimony penalty
    objTerms.push(`${combined} x_${i}`);
  }

  // Price terms for buy variables: (-pw_obj) * item_price_objective[i] * buy_i
  for (let i = 1; i <= n_items; i++) {
    const priceCoeff = -pw_obj * item_price_objective[i];
    if (priceCoeff !== 0) {
      objTerms.push(`${priceCoeff} buy_${i}`);
    }
  }

  // Price terms for base variables: (-pw_obj) * base_price[b] * base_b
  for (let b = 0; b < n_bases; b++) {
    const priceCoeff = -pw_obj * basePrices[b];
    if (priceCoeff !== 0) {
      objTerms.push(`${priceCoeff} base_${b + 1}`);
    }
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
  }

  // --- 1. Base sum: exactly one base selected ---
  {
    const terms = [];
    for (let b = 1; b <= n_bases; b++) {
      terms.push(`base_${b}`);
    }
    L(`  base_sum: ${terms.join(' + ')} = 1`);
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

  // --- 6. Item availability: preset-only items; FiR-only mods (no API buy path) skip x_i=0 ---
  for (let i = 1; i <= n_items; i++) {
    const iid = indexToItem[i];
    const entry = itemLookup[iid];
    const fiR = entry.type === 'mod' && !(entry.stats as ModStats).purchasable;

    if (item_available[i] === 1) continue;
    const presetBases = itemToPresetBases.get(i);
    if (presetBases && presetBases.length > 0) {
      const expr = presetBases.map(b => `base_${b}`).join(' + ');
      L(`  avail_${i}: x_${i} - ${expr} <= 0`);
    } else if (!fiR) {
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
      // buy[i] >= x[i] - sum(base[b])
      // buy[i] - x[i] + sum(base[b]) >= 0
      const presetSum = presetBases.map(b => `base_${b}`).join(' + ');
      L(`  buy_ge_${i}: buy_${i} - x_${i} + ${presetSum} >= 0`);
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

    const sumExpr = itemsInSlot.map(i => `x_${i}`).join(' + ');
    const owner = slot_owner_arr[s]; // 0=root, else item index

    if (owner === 0) {
      // Weapon-root required slot: must always have an item
      L(`  req_${s}: ${sumExpr} >= 1`);
    } else {
      // Mod-owned required slot: if owner selected, slot must have an item
      // -x[owner] + sum(x[items in slot]) >= 0
      L(`  mreq_${s}: - x_${owner} + ${sumExpr} >= 0`);
    }
  }

  // --- 9. Ergo cap: capped_ergo <= weapon_naked_ergo_scaled + sum(item_ergo * x_i) ---
  // capped_ergo - sum(item_ergo[i] * x_i) <= weapon_naked_ergo_scaled
  {
    const ergoTerms: string[] = ['capped_ergo'];
    for (let i = 1; i <= n_items; i++) {
      if (item_ergo[i] !== 0) {
        ergoTerms.push(`${-item_ergo[i]} x_${i}`);
      }
    }
    L(`  ergo_cap: ${formatTerms(ergoTerms)} <= ${weapon_naked_ergo_scaled}`);
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

  // maxRecoilV: total recoil modifier sum <= round(SCALE * (maxRecoilV / nakedRecoilV - 1))
  if (params.maxRecoilV != null && nakedRecoilV > 0) {
    const recoilLimit = Math.round(SCALE * (params.maxRecoilV / nakedRecoilV - 1));
    const recoilTerms: string[] = [];
    for (let i = 1; i <= n_items; i++) {
      if (item_recoil[i] !== 0) {
        recoilTerms.push(`${item_recoil[i]} x_${i}`);
      }
    }
    if (recoilTerms.length > 0) {
      L(`  recoil_lim: ${formatTerms(recoilTerms)} <= ${recoilLimit}`);
    }
  }

  // maxRecoilSum: total recoil modifier sum <= round(SCALE * (maxRecoilSum / (nakedRecoilV + nakedRecoilH) - 1))
  if (params.maxRecoilSum != null) {
    const nakedRecoilH = weaponStats.naked_recoil_h;
    const nakedSum = nakedRecoilV + nakedRecoilH;
    if (nakedSum > 0) {
      const recoilSumLimit = Math.round(SCALE * (params.maxRecoilSum / nakedSum - 1));
      const recoilTerms: string[] = [];
      for (let i = 1; i <= n_items; i++) {
        if (item_recoil[i] !== 0) {
          recoilTerms.push(`${item_recoil[i]} x_${i}`);
        }
      }
      if (recoilTerms.length > 0) {
        L(`  recoil_sum_lim: ${formatTerms(recoilTerms)} <= ${recoilSumLimit}`);
      }
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

  // maxWeight
  if (params.maxWeight != null) {
    const baseWeightG = Math.round(weaponStats.weight * 1000);
    const maxWeightG = Math.round(params.maxWeight * 1000);
    const weightBudget = maxWeightG - baseWeightG;
    const weightTerms: string[] = [];
    for (let i = 1; i <= n_items; i++) {
      if (item_weight_g[i] !== 0) {
        weightTerms.push(`${item_weight_g[i]} x_${i}`);
      }
    }
    if (weightTerms.length > 0) {
      L(`  weight_lim: ${formatTerms(weightTerms)} <= ${weightBudget}`);
    }
  }

  // maxMOA: finalMOA = effectiveBaseCOI * (1 - sum(acc_mod)/100) * 100 <= maxMOA
  //   effectiveBaseCOI = coi_b when a barrel mod b is installed, else weapon intrinsic COI (w).
  // When any reachable barrel mod has coi > 0, we add one big-M constraint per barrel b (exact, x_b binary):
  //   when x_b = 1:  coi_b * 100 - (coi_b/100) * sum(item_accuracy_mod[i] * x_i) <= maxMOA
  //   rearranged:    (coi_b/100) * sum(acc_mod[i] * x_i) - M * x_b >= coi_b*100 - maxMOA - M
  //   when x_b = 0, RHS is very negative so the constraint is vacuous.
  // If the barrel slot is OPTIONAL (weapon can run with no COI-barrel installed — e.g. M16A1),
  // we also add an intrinsic-COI fallback guarded by sum_b(x_b): when no barrel is installed,
  // the intrinsic COI applies. When any barrel is installed, a BIG_M * sum_b(x_b) term makes it vacuous.
  // For fixed-barrel weapons (no reachable barrel mods with coi > 0): use the simple linear form with
  // the weapon's intrinsic COI: sum_i (w * acc_mod[i] / 100) * x_i >= w*100 - maxMOA.
  if (params.maxMOA != null) {
    const baseCOI = weaponStats.center_of_impact ?? 0;
    if (baseCOI > 0) {
      const barrelIndices: number[] = [];
      for (let i = 1; i <= n_items; i++) {
        if (item_barrel_coi[i] > 0) barrelIndices.push(i);
      }

      if (barrelIndices.length > 0) {
        const BIG_M = 1000; // safe upper bound on |coi_b*100 − maxMOA|; real values are well under 20.
        for (const bIdx of barrelIndices) {
          const coi_b = item_barrel_coi[bIdx];
          const coeffByItem = new Map<number, number>();
          for (let i = 1; i <= n_items; i++) {
            if (item_accuracy_mod[i] !== 0) {
              coeffByItem.set(i, (coi_b * item_accuracy_mod[i]) / 100);
            }
          }
          coeffByItem.set(bIdx, (coeffByItem.get(bIdx) ?? 0) - BIG_M);
          const terms: string[] = [];
          for (const [i, c] of coeffByItem) {
            if (c !== 0) terms.push(`${c.toFixed(6)} x_${i}`);
          }
          const rhs = coi_b * 100 - params.maxMOA - BIG_M;
          L(`  moa_lim_${bIdx}: ${formatTerms(terms)} >= ${rhs.toFixed(6)}`);
        }

        // Fallback for "no COI-barrel installed" — intrinsic COI applies.
        //   (w/100) * sum_i(acc_mod[i] * x_i) + M * sum_b(x_b) >= w*100 - maxMOA
        // When sum_b(x_b) >= 1 (any barrel installed), M dominates and the constraint is vacuous.
        // When sum_b(x_b) = 0 (no barrel — weapon uses intrinsic COI), the constraint binds.
        const fallbackCoeffs = new Map<number, number>();
        for (let i = 1; i <= n_items; i++) {
          if (item_accuracy_mod[i] !== 0) {
            fallbackCoeffs.set(i, (baseCOI * item_accuracy_mod[i]) / 100);
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
          const fbRhs = baseCOI * 100 - params.maxMOA;
          L(`  moa_lim_nobarrel: ${formatTerms(fbTerms)} >= ${fbRhs.toFixed(6)}`);
        }
      } else {
        const terms: string[] = [];
        for (let i = 1; i <= n_items; i++) {
          if (item_accuracy_mod[i] !== 0) {
            const coef = (baseCOI * item_accuracy_mod[i]) / 100;
            terms.push(`${coef.toFixed(6)} x_${i}`);
          }
        }
        if (terms.length > 0) {
          const rhs = 100 * baseCOI - params.maxMOA;
          L(`  moa_lim: ${formatTerms(terms)} >= ${rhs.toFixed(6)}`);
        }
      }
    }
  }

  // includeItems: force specific items from params (implicit deps are UI-only; see requiredItemDeps + worker)
  if (params.includeItems) {
    for (const iid of params.includeItems) {
      const idx = itemIndex.get(iid);
      if (idx !== undefined) {
        L(`  incl_${idx}: x_${idx} = 1`);
      }
    }
  }

  // includeCategories: OR within each group, at least one item from each group
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
      }
    }
  }

  L('');

  // ------ BOUNDS ------
  L('Bounds');
  L('  0 <= capped_ergo <= 1000');
  L('  -inf <= total_obj <= inf');
  const nSubVars = Math.ceil(objTerms.length / 50);
  for (let s = 0; s < nSubVars; s++) {
    L(`  -inf <= obj_sub_${s} <= inf`);
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
