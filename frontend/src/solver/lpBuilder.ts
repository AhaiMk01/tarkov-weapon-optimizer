/**
 * Build CPLEX LP format string for the HiGHS solver.
 * Ported from optimizer.py:optimize_weapon() CP-SAT model.
 *
 * The CP-SAT model is a Binary Integer Program which maps directly to MIP.
 * All variables are binary, all constraints linear, objective linear.
 */

import type { ItemLookup, CompatibilityMap, TraderLevels, GunLookupEntry } from './types.ts';
import { DEFAULT_TRADER_LEVELS } from './types.ts';
import { getAvailablePrice } from './dataService.ts';

export interface LPBuildParams {
  weaponId: string;
  itemLookup: ItemLookup;
  compatibilityMap: CompatibilityMap;
  maxPrice?: number | null;
  minErgonomics?: number | null;
  maxRecoilV?: number | null;
  maxRecoilSum?: number | null;
  minMagCapacity?: number | null;
  minSightingRange?: number | null;
  maxWeight?: number | null;
  includeItems?: string[] | null;
  excludeItems?: string[] | null;
  includeCategories?: string[][] | null;
  excludeCategories?: string[] | null;
  ergoWeight?: number;
  recoilWeight?: number;
  priceWeight?: number;
  traderLevels?: TraderLevels | null;
  fleaAvailable?: boolean;
  playerLevel?: number | null;
}

export interface LPBuildResult {
  lpString: string;
  /** Mapping of variable names to item ids / metadata for solution decoding */
  varMap: VarMap;
  /** Status if infeasible was detected during construction */
  infeasibleReason?: string;
}

export interface VarMap {
  itemVars: Record<string, string>;       // varName -> itemId
  buyVars: Record<string, string>;        // varName -> itemId
  baseVars: Record<string, string>;       // varName -> "naked" | presetId
  presetItemsMap: Record<string, Set<string>>;  // presetId -> set of item ids
  presetPricesMap: Record<string, number>; // presetId -> price
  itemPrices: Record<string, [number, string | null, boolean]>;
  weaponStats: Record<string, number>;
  nakedGunPrice: number;
  fallbackBase: { type: string; id?: string; name?: string; price: number } | null;
  /** Ergo/recoil scaling factors used */
  SCALE: number;
  ERGO_SCALE: number;
}

// Sanitize ID for use in LP variable names (LP format restricts allowed chars)
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function buildLP(params: LPBuildParams): LPBuildResult {
  const {
    weaponId, itemLookup, compatibilityMap,
    maxPrice, minErgonomics, maxRecoilV, maxRecoilSum,
    minMagCapacity, minSightingRange, maxWeight,
    includeItems, excludeItems,
    includeCategories, excludeCategories,
    ergoWeight = 1.0, recoilWeight = 1.0, priceWeight = 0.0,
    traderLevels = DEFAULT_TRADER_LEVELS,
    fleaAvailable = true, playerLevel = null,
  } = params;

  const tl = traderLevels ?? DEFAULT_TRADER_LEVELS;
  const weapon = itemLookup[weaponId] as GunLookupEntry;

  // --- Feasibility check ---
  const feasibilityReasons = checkFeasibility(
    weapon, itemLookup, compatibilityMap,
    includeItems, includeCategories, minMagCapacity, minSightingRange, maxWeight,
  );
  if (feasibilityReasons) {
    return {
      lpString: '',
      varMap: emptyVarMap(weapon),
      infeasibleReason: feasibilityReasons.join('; '),
    };
  }

  const reachable = compatibilityMap.reachable_items;
  const slotItems = compatibilityMap.slot_items;
  const slotOwner = compatibilityMap.slot_owner;

  // --- Presets ---
  const presets = weapon.presets ?? [];
  const presetItemsMap: Record<string, Set<string>> = {};
  const itemToPresets: Record<string, string[]> = {};
  const presetPricesMap: Record<string, number> = {};

  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const [pPrice, , pAvail] = getAvailablePrice(
      { offers: preset.offers, price: preset.price },
      tl, fleaAvailable, playerLevel,
    );
    if (!pAvail) continue;
    const presetId = preset.id || `preset_${i}`;
    presetPricesMap[presetId] = pPrice;
    const items = new Set(preset.items);
    presetItemsMap[presetId] = items;
    for (const itemId of items) {
      if (!itemToPresets[itemId]) itemToPresets[itemId] = [];
      itemToPresets[itemId].push(presetId);
    }
  }

  // --- Base variables ---
  const nakedGunPriceRaw = weapon.stats.price;
  const nakedGunPurchasable = nakedGunPriceRaw < 100_000_000;

  const baseVarIds: Record<string, string> = {}; // varName -> "naked" | presetId
  let fallbackBase: VarMap['fallbackBase'] = null;

  if (nakedGunPurchasable) {
    baseVarIds['base_naked'] = 'naked';
  }
  for (const presetId of Object.keys(presetItemsMap)) {
    baseVarIds[`base_${sanitizeId(presetId)}`] = presetId;
  }

  if (Object.keys(baseVarIds).length === 0) {
    // No purchasable base — use fallback
    const allPresets = weapon.all_presets ?? [];
    if (allPresets.length > 0) {
      const fb = allPresets[0];
      const fbId = fb.id || 'fallback_preset_0';
      baseVarIds[`base_${sanitizeId(fbId)}`] = fbId;
      presetItemsMap[fbId] = new Set(fb.items);
      presetPricesMap[fbId] = 0;
      for (const itemId of fb.items) {
        if (!itemToPresets[itemId]) itemToPresets[itemId] = [];
        itemToPresets[itemId].push(fbId);
      }
      fallbackBase = { type: 'preset', id: fbId, name: fb.name, price: 0 };
      // Make items in fallback preset available
      for (const itemId of fb.items) {
        if (itemId in reachable && !(itemId in availableItemsCheck())) {
          // Will be handled below
        }
      }
    } else {
      baseVarIds['base_naked'] = 'naked';
      fallbackBase = { type: 'naked', price: 0 };
    }
  }

  function availableItemsCheck() { return {}; } // placeholder, real check below

  // --- Available items ---
  const excludeItemsSet = new Set(excludeItems ?? []);
  const excludeCategoriesSet = new Set(excludeCategories ?? []);

  const availableItems: Record<string, true> = {};
  const itemPrices: Record<string, [number, string | null, boolean]> = {};

  for (const itemId of Object.keys(reachable)) {
    if (!(itemId in itemLookup)) continue;
    if (excludeItemsSet.has(itemId)) continue;
    const entry = itemLookup[itemId];
    const stats = entry.stats;
    const category = 'category' in stats ? stats.category : '';
    if (category && excludeCategoriesSet.has(category)) continue;

    const [price, source, isAvailable] = getAvailablePrice(
      stats as { offers?: { price: number; source: string; vendor_name: string; vendor_normalized: string; trader_level: number | null }[]; price?: number; price_source?: string; min_level_flea?: number },
      tl, fleaAvailable, playerLevel,
    );

    const inPreset = itemId in itemToPresets;
    const defaultPrice = stats.price ?? 0;
    if (defaultPrice > 100_000_000) {
      if (!inPreset) continue;
      itemPrices[itemId] = [0, source, false];
      availableItems[itemId] = true;
      continue;
    }

    if (!isAvailable && !inPreset) continue;
    availableItems[itemId] = true;
    itemPrices[itemId] = [price, source, isAvailable];
  }

  // Add fallback preset items if not already available
  if (fallbackBase?.type === 'preset' && fallbackBase.id) {
    const fbItems = presetItemsMap[fallbackBase.id];
    if (fbItems) {
      for (const itemId of fbItems) {
        if (itemId in reachable && !(itemId in availableItems)) {
          availableItems[itemId] = true;
          itemPrices[itemId] = [0, 'fallback_preset', false];
        }
      }
    }
  }

  // --- Build LP ---
  const constraints: string[] = [];
  const binaries: string[] = [];
  const objTerms: { coeff: number; varName: string }[] = [];

  // Helper to add a named binary variable
  function addBinary(name: string) { binaries.push(name); }

  // Item selection variables: x_<id>
  const xVars: Record<string, string> = {}; // varName -> itemId
  for (const itemId of Object.keys(availableItems)) {
    const vn = `x_${sanitizeId(itemId)}`;
    xVars[vn] = itemId;
    addBinary(vn);
  }

  // Base selection variables
  for (const bv of Object.keys(baseVarIds)) {
    addBinary(bv);
  }

  // Base exactly-one constraint
  const baseVarNames = Object.keys(baseVarIds);
  if (baseVarNames.length > 0) {
    if (fallbackBase) {
      // Fallback: forced to 1
      constraints.push(`c_base_forced: ${baseVarNames[0]} = 1`);
    } else {
      constraints.push(`c_base_sum: ${baseVarNames.join(' + ')} = 1`);
    }
  }

  // --- Preset-availability constraints ---
  // Items only in presets: x[item] <= sum(base_preset for presets containing item)
  for (const itemId of Object.keys(availableItems)) {
    const isAvail = itemPrices[itemId]?.[2] ?? false;
    if (!isAvail) {
      const containingPresets = (itemToPresets[itemId] ?? [])
        .map(pid => `base_${sanitizeId(pid)}`)
        .filter(bv => bv in baseVarIds || baseVarNames.includes(bv));
      const xv = `x_${sanitizeId(itemId)}`;
      if (containingPresets.length > 0) {
        constraints.push(`c_preset_avail_${sanitizeId(itemId)}: ${xv} - ${containingPresets.join(' - ')} <= 0`);
      } else {
        constraints.push(`c_unavail_${sanitizeId(itemId)}: ${xv} = 0`);
      }
    }
  }

  // --- Buy variables: buy[item] = x[item] AND NOT any_preset_containing_item ---
  // buy[item] = 1 means the item must be purchased separately
  const buyVars: Record<string, string> = {}; // varName -> itemId
  let presetHasCount = 0;
  for (const itemId of Object.keys(availableItems)) {
    const bv = `buy_${sanitizeId(itemId)}`;
    buyVars[bv] = itemId;
    addBinary(bv);

    const containingPresetIds = itemToPresets[itemId] ?? [];
    const containingBaseVars = containingPresetIds
      .map(pid => `base_${sanitizeId(pid)}`)
      .filter(v => baseVarNames.includes(v));

    if (containingBaseVars.length > 0) {
      // any_preset_with_item = max(base_p1, base_p2, ...)
      // MIP linearization of max: ph >= base_pk for all k; ph <= sum(base_pk)
      const ph = `ph_${presetHasCount++}`;
      addBinary(ph);
      for (const cbv of containingBaseVars) {
        constraints.push(`c_ph_lb_${ph}_${cbv}: ${ph} - ${cbv} >= 0`);
      }
      constraints.push(`c_ph_ub_${ph}: ${ph} - ${containingBaseVars.join(' - ')} <= 0`);

      // buy <= x
      constraints.push(`c_buy_le_x_${sanitizeId(itemId)}: ${bv} - x_${sanitizeId(itemId)} <= 0`);
      // buy <= 1 - ph
      constraints.push(`c_buy_le_nph_${sanitizeId(itemId)}: ${bv} + ${ph} <= 1`);
      // buy >= x - ph
      constraints.push(`c_buy_ge_${sanitizeId(itemId)}: ${bv} - x_${sanitizeId(itemId)} + ${ph} >= 0`);
    } else {
      // buy = x
      constraints.push(`c_buy_eq_${sanitizeId(itemId)}: ${bv} - x_${sanitizeId(itemId)} = 0`);
    }
  }

  // --- Include items constraint ---
  if (includeItems) {
    for (const reqId of includeItems) {
      const xv = `x_${sanitizeId(reqId)}`;
      if (xv in xVars) {
        constraints.push(`c_incl_${sanitizeId(reqId)}: ${xv} = 1`);
      } else {
        return {
          lpString: '',
          varMap: emptyVarMap(weapon),
          infeasibleReason: `Required item ${reqId} not available`,
        };
      }
    }
  }

  // --- Include categories constraint ---
  if (includeCategories) {
    for (let gi = 0; gi < includeCategories.length; gi++) {
      const group = includeCategories[gi];
      const groupVarNames: string[] = [];
      for (const reqCat of group) {
        for (const [vn, iid] of Object.entries(xVars)) {
          const entry = itemLookup[iid];
          const catId = 'category_id' in entry.stats ? entry.stats.category_id : '';
          const catName = 'category' in entry.stats ? entry.stats.category : '';
          if (catId === reqCat || catName === reqCat) {
            groupVarNames.push(vn);
          }
        }
      }
      if (groupVarNames.length > 0) {
        constraints.push(`c_cat_${gi}: ${groupVarNames.join(' + ')} >= 1`);
      } else {
        return {
          lpString: '',
          varMap: emptyVarMap(weapon),
          infeasibleReason: `No items for required category group`,
        };
      }
    }
  }

  // --- Slot system: each slot holds max 1 item ---
  // Build item_to_valid_slots
  const itemToValidSlots: Record<string, { slotId: string; ownerId: string; isBase: boolean }[]> = {};
  for (const itemId of Object.keys(availableItems)) {
    itemToValidSlots[itemId] = [];
  }

  for (const [slotId, items] of Object.entries(slotItems)) {
    const ownerId = slotOwner[slotId];
    const isBase = ownerId === weaponId;
    const ownerAvailable = isBase || ownerId in availableItems;
    if (ownerAvailable) {
      for (const itemId of items) {
        if (itemId in availableItems) {
          if (!itemToValidSlots[itemId]) itemToValidSlots[itemId] = [];
          itemToValidSlots[itemId].push({ slotId, ownerId, isBase });
        }
      }
    }
  }

  // Placement variables for items in multiple slots
  const itemsNeedingPlacement = new Set<string>();
  const placedIn: Record<string, Record<string, string>> = {}; // itemId -> { slotId -> varName }
  let plCount = 0;

  for (const [itemId, validSlots] of Object.entries(itemToValidSlots)) {
    if (validSlots.length > 1) {
      itemsNeedingPlacement.add(itemId);
      placedIn[itemId] = {};
      for (const { slotId } of validSlots) {
        const vn = `pl_${plCount++}`;
        placedIn[itemId][slotId] = vn;
        addBinary(vn);
      }
    }
  }

  // Placement sum = x[item] for multi-slot items
  for (const itemId of itemsNeedingPlacement) {
    const pvs = Object.values(placedIn[itemId]);
    constraints.push(`c_plsum_${sanitizeId(itemId)}: ${pvs.join(' + ')} - x_${sanitizeId(itemId)} = 0`);
  }

  // At most 1 item per slot
  let slotCnIdx = 0;
  for (const [slotId, items] of Object.entries(slotItems)) {
    const slotPlacements: string[] = [];
    for (const itemId of items) {
      if (!(itemId in availableItems)) continue;
      if (itemsNeedingPlacement.has(itemId)) {
        if (placedIn[itemId]?.[slotId]) {
          slotPlacements.push(placedIn[itemId][slotId]);
        }
      } else {
        const validSlots = itemToValidSlots[itemId] ?? [];
        if (validSlots.some(s => s.slotId === slotId)) {
          slotPlacements.push(`x_${sanitizeId(itemId)}`);
        }
      }
    }
    if (slotPlacements.length > 0) {
      constraints.push(`c_slot_${slotCnIdx++}: ${slotPlacements.join(' + ')} <= 1`);
    }
  }

  // --- Connectivity: items must have a parent selected ---
  let parentOrCount = 0;
  for (const [itemId, validSlots] of Object.entries(itemToValidSlots)) {
    if (validSlots.length === 0) {
      constraints.push(`c_noparent_${sanitizeId(itemId)}: x_${sanitizeId(itemId)} = 0`);
      continue;
    }

    const hasBaseSlot = validSlots.some(s => s.isBase);

    if (itemsNeedingPlacement.has(itemId)) {
      // Placement var <= owner var for non-base slots
      for (const { slotId, ownerId, isBase } of validSlots) {
        if (!(slotId in (placedIn[itemId] ?? {}))) continue;
        const pv = placedIn[itemId][slotId];
        if (!isBase) {
          if (ownerId in availableItems) {
            constraints.push(`c_plown_${pv}: ${pv} - x_${sanitizeId(ownerId)} <= 0`);
          } else {
            constraints.push(`c_plown0_${pv}: ${pv} = 0`);
          }
        }
      }
    } else {
      if (!hasBaseSlot) {
        const parentXVars: string[] = [];
        for (const { ownerId } of validSlots) {
          if (ownerId in availableItems) {
            parentXVars.push(`x_${sanitizeId(ownerId)}`);
          }
        }
        if (parentXVars.length === 0) {
          constraints.push(`c_noreachparent_${sanitizeId(itemId)}: x_${sanitizeId(itemId)} = 0`);
        } else {
          // x[item] <= max(parent_vars) = parent_or
          // parent_or >= parent_k for all k; parent_or <= sum(parent_k)
          const po = `po_${parentOrCount++}`;
          addBinary(po);
          for (const pv of parentXVars) {
            constraints.push(`c_po_lb_${po}_${sanitizeId(pv)}: ${po} - ${pv} >= 0`);
          }
          constraints.push(`c_po_ub_${po}: ${po} - ${parentXVars.join(' - ')} <= 0`);
          constraints.push(`c_conn_${sanitizeId(itemId)}: x_${sanitizeId(itemId)} - ${po} <= 0`);
        }
      }
    }
  }

  // --- Conflict constraints ---
  const conflictPairsAdded = new Set<string>();
  for (const itemId of Object.keys(availableItems)) {
    if (!(itemId in itemLookup)) continue;
    const entry = itemLookup[itemId];
    if (entry.type !== 'mod') continue;
    const conflicting = entry.conflicting_items;
    for (const conflictId of conflicting) {
      if (conflictId in availableItems) {
        const pair = [itemId, conflictId].sort().join('|');
        if (!conflictPairsAdded.has(pair)) {
          conflictPairsAdded.add(pair);
          constraints.push(`c_conflict_${sanitizeId(pair)}: x_${sanitizeId(itemId)} + x_${sanitizeId(conflictId)} <= 1`);
        }
      }
    }
  }

  // --- Required slots (weapon level) ---
  let reqSlotIdx = 0;
  for (const slot of weapon.slots) {
    if (slot.required) {
      const slotId = slot.id;
      const itemsInSlot = (slotItems[slotId] ?? []).filter(i => i in availableItems);
      if (itemsInSlot.length > 0) {
        constraints.push(`c_reqslot_${reqSlotIdx++}: ${itemsInSlot.map(i => `x_${sanitizeId(i)}`).join(' + ')} >= 1`);
      }
    }
  }

  // --- Required slots (mod level, conditional) ---
  // For mods that own required slots: if mod selected, its required slot must be filled
  // Using Big-M: sum(items_in_slot) >= 1 - M*(1 - x[owner])  => sum >= x[owner] when M=len
  let reqModSlotIdx = 0;
  for (const [ownerId, slotIds] of Object.entries(compatibilityMap.item_to_slots)) {
    if (!(ownerId in itemLookup) || !(ownerId in availableItems)) continue;
    const ownerEntry = itemLookup[ownerId];
    for (const slot of ownerEntry.slots) {
      const slotId = slot.id;
      if (!slotIds.includes(slotId)) continue;
      if (slot.required) {
        const itemsInSlot = (slotItems[slotId] ?? []).filter(i => i in availableItems);
        if (itemsInSlot.length > 0) {
          // sum(items_in_slot) >= x[owner]
          // i.e., sum - x[owner] >= 0
          constraints.push(
            `c_modreq_${reqModSlotIdx++}: ${itemsInSlot.map(i => `x_${sanitizeId(i)}`).join(' + ')} - x_${sanitizeId(ownerId)} >= 0`
          );
        }
      }
    }
  }

  // --- Price constraint ---
  const SCALE = 1000;
  function getPriceTerms(): { terms: string[]; constant: number } {
    const terms: string[] = [];
    let constant = 0;
    const nakedGunPrice = (fallbackBase?.type === 'naked') ? 0 : Math.floor(weapon.stats.price);
    if ('base_naked' in baseVarIds && baseVarIds['base_naked'] === 'naked') {
      if (nakedGunPrice > 0) terms.push(`${nakedGunPrice} base_naked`);
    }
    for (const [bv, pid] of Object.entries(baseVarIds)) {
      if (pid === 'naked') continue;
      const pp = Math.floor(presetPricesMap[pid] ?? 0);
      if (pp > 0) terms.push(`${pp} ${bv}`);
    }
    for (const [bvn, iid] of Object.entries(buyVars)) {
      const p = Math.floor(itemPrices[iid]?.[0] ?? 0);
      if (p > 0) terms.push(`${p} ${bvn}`);
    }
    return { terms, constant };
  }

  if (maxPrice != null) {
    const { terms } = getPriceTerms();
    if (terms.length > 0) {
      constraints.push(`c_maxprice: ${terms.join(' + ')} <= ${maxPrice}`);
    }
  }

  // --- Ergonomics ---
  const ERGO_SCALE = 10;
  const weaponNakedErgo = weapon.stats.naked_ergonomics;

  // total_ergo_raw = naked_ergo * ERGO_SCALE + sum(mod_ergo * ERGO_SCALE * x[i])
  // We need capped_ergo in [0, 100]
  // Approach: introduce total_ergo as a general integer var, then capped_ergo <= total_ergo, capped_ergo <= 100, capped >= 0
  // Since we maximize capped_ergo, the solver picks min(total_ergo, 100)

  // For LP/MIP, we use continuous/general-int variables via bounds
  // HiGHS LP format: generals section for integer vars, bounds for ranges

  // Actually, to keep it simple with LP format: introduce capped_ergo as a general integer bounded [0, 100]
  // Constraint: capped_ergo <= (weapon_naked_ergo + sum(mod_ergo * x_i))
  // Since we want capped_ergo = min(100, total_ergo) and we're maximizing,
  // just having capped_ergo <= total_ergo is enough (solver maximizes up to 100)

  const ergoTerms: string[] = [];
  for (const [vn, iid] of Object.entries(xVars)) {
    const entry = itemLookup[iid];
    if (entry.type !== 'mod') continue;
    const ergo = entry.stats.ergonomics;
    if (ergo !== 0) {
      ergoTerms.push(`${ergo} ${vn}`);
    }
  }

  // capped_ergo <= weapon_naked_ergo + sum(ergo_i * x_i)
  // i.e., capped_ergo - sum(ergo_i * x_i) <= weapon_naked_ergo
  {
    const lhs: string[] = ['capped_ergo'];
    for (const [vn, iid] of Object.entries(xVars)) {
      const entry = itemLookup[iid];
      if (entry.type !== 'mod') continue;
      const ergo = entry.stats.ergonomics;
      if (ergo !== 0) {
        // capped_ergo - ergo*x <= naked_ergo => subtract ergo*x from lhs
        lhs.push(`${-ergo} ${vn}`);
      }
    }
    constraints.push(`c_ergo_cap: ${lhs.join(' + ').replace(/\+ -/g, '- ')} <= ${weaponNakedErgo}`);
  }

  // --- Recoil ---
  // total_recoil_mod = sum(recoil_modifier_i * x_i) (in SCALE units)
  // For recoil constraints, final_recoil_v = naked_recoil_v * (1 + total_recoil_mod)
  // Constraint max_recoil_v: final_recoil_v <= max => total_recoil_mod <= max/naked - 1

  const recoilTermsForObj: string[] = [];
  for (const [vn, iid] of Object.entries(xVars)) {
    const entry = itemLookup[iid];
    if (entry.type !== 'mod') continue;
    const recoil = Math.round(entry.stats.recoil_modifier * SCALE);
    if (recoil !== 0) {
      recoilTermsForObj.push(`${recoil} ${vn}`);
    }
  }

  // total_recoil_var = sum(recoil_i_scaled * x_i) -- this is a general integer
  // We represent total_recoil as a linear expression directly in constraints
  // For the objective, we use the expression directly

  if (maxRecoilV != null) {
    const nakedRecoilV = weapon.stats.naked_recoil_v;
    if (nakedRecoilV > 0) {
      const maxRecoilModifier = Math.floor(SCALE * (maxRecoilV / nakedRecoilV - 1));
      // sum(recoil_i * x_i) <= maxRecoilModifier
      if (recoilTermsForObj.length > 0) {
        constraints.push(`c_maxrecoil: ${recoilTermsForObj.join(' + ').replace(/\+ -/g, '- ')} <= ${maxRecoilModifier}`);
      }
    }
  }

  if (maxRecoilSum != null) {
    const nakedRecoilV = weapon.stats.naked_recoil_v;
    const nakedRecoilH = weapon.stats.naked_recoil_h;
    const nakedSum = nakedRecoilV + nakedRecoilH;
    if (nakedSum > 0) {
      const maxModifier = Math.floor(SCALE * (maxRecoilSum / nakedSum - 1));
      if (recoilTermsForObj.length > 0) {
        constraints.push(`c_maxrecoilsum: ${recoilTermsForObj.join(' + ').replace(/\+ -/g, '- ')} <= ${maxModifier}`);
      }
    }
  }

  // --- Min ergonomics constraint ---
  if (minErgonomics != null) {
    // weapon_naked_ergo + sum(ergo_i * x_i) >= minErgonomics
    // sum(ergo_i * x_i) >= minErgonomics - weapon_naked_ergo
    const rhs = minErgonomics - weaponNakedErgo;
    if (ergoTerms.length > 0) {
      constraints.push(`c_minergo: ${ergoTerms.join(' + ').replace(/\+ -/g, '- ')} >= ${rhs}`);
    } else if (weaponNakedErgo < minErgonomics) {
      return {
        lpString: '',
        varMap: emptyVarMap(weapon),
        infeasibleReason: `Cannot reach min ergonomics ${minErgonomics}`,
      };
    }
  }

  // --- Magazine capacity ---
  if (minMagCapacity != null) {
    const magVars: string[] = [];
    for (const [vn, iid] of Object.entries(xVars)) {
      const entry = itemLookup[iid];
      if (entry.type !== 'mod') continue;
      if (entry.stats.capacity >= minMagCapacity) {
        magVars.push(vn);
      }
    }
    if (magVars.length > 0) {
      constraints.push(`c_mag: ${magVars.join(' + ')} >= 1`);
    } else {
      return {
        lpString: '',
        varMap: emptyVarMap(weapon),
        infeasibleReason: `No magazine with capacity >= ${minMagCapacity}`,
      };
    }
  }

  // --- Sighting range ---
  if (minSightingRange != null) {
    const baseSighting = weapon.stats.sighting_range;
    if (baseSighting < minSightingRange) {
      const sightVars: string[] = [];
      for (const [vn, iid] of Object.entries(xVars)) {
        const entry = itemLookup[iid];
        if (entry.type !== 'mod') continue;
        if (entry.stats.sighting_range >= minSightingRange) {
          sightVars.push(vn);
        }
      }
      if (sightVars.length > 0) {
        constraints.push(`c_sight: ${sightVars.join(' + ')} >= 1`);
      } else {
        return {
          lpString: '',
          varMap: emptyVarMap(weapon),
          infeasibleReason: `No sight with sighting range >= ${minSightingRange}`,
        };
      }
    }
  }

  // --- Weight constraint ---
  if (maxWeight != null) {
    const WEIGHT_SCALE = 1000;
    const baseWeightG = Math.floor(weapon.stats.weight * WEIGHT_SCALE);
    const maxWeightG = Math.floor(maxWeight * WEIGHT_SCALE);
    const weightTerms: string[] = [];
    for (const [vn, iid] of Object.entries(xVars)) {
      const entry = itemLookup[iid];
      if (entry.type !== 'mod') continue;
      const wg = Math.floor(entry.stats.weight * WEIGHT_SCALE);
      if (wg > 0) weightTerms.push(`${wg} ${vn}`);
    }
    if (weightTerms.length > 0) {
      constraints.push(`c_weight: ${weightTerms.join(' + ')} <= ${maxWeightG - baseWeightG}`);
    } else if (baseWeightG > maxWeightG) {
      return {
        lpString: '',
        varMap: emptyVarMap(weapon),
        infeasibleReason: `Base weapon weight exceeds limit`,
      };
    }
  }

  // --- Objective function ---
  // Maximize: ergo_weight * capped_ergo - recoil_weight * total_recoil - price_weight * total_price
  // total_recoil = sum(recoil_i_scaled * x_i)
  // total_price = sum(price_i * buy_i) + base_price

  // Ergo component
  if (ergoWeight > 0) {
    const c = Math.round(ergoWeight * SCALE);
    objTerms.push({ coeff: c, varName: 'capped_ergo' });
  }

  // Recoil component (negative = minimize recoil)
  if (recoilWeight > 0) {
    for (const [vn, iid] of Object.entries(xVars)) {
      const entry = itemLookup[iid];
      if (entry.type !== 'mod') continue;
      const recoil = Math.round(entry.stats.recoil_modifier * SCALE);
      if (recoil !== 0) {
        // Objective: -recoilWeight * recoil * x = minimize recoil (recoil is negative for good mods)
        const c = Math.round(-recoilWeight * SCALE * entry.stats.recoil_modifier * SCALE) / SCALE;
        objTerms.push({ coeff: Math.round(c), varName: vn });
      }
    }
  }

  // Price component
  if (priceWeight > 0) {
    const nakedGunPrice = (fallbackBase?.type === 'naked') ? 0 : Math.floor(weapon.stats.price);
    if ('base_naked' in baseVarIds && baseVarIds['base_naked'] === 'naked' && nakedGunPrice > 0) {
      objTerms.push({ coeff: Math.round(-priceWeight * nakedGunPrice), varName: 'base_naked' });
    }
    for (const [bv, pid] of Object.entries(baseVarIds)) {
      if (pid === 'naked') continue;
      const pp = Math.floor(presetPricesMap[pid] ?? 0);
      if (pp > 0) objTerms.push({ coeff: Math.round(-priceWeight * pp), varName: bv });
    }
    for (const [bvn, iid] of Object.entries(buyVars)) {
      const p = Math.floor(itemPrices[iid]?.[0] ?? 0);
      if (p > 0) objTerms.push({ coeff: Math.round(-priceWeight * p), varName: bvn });
    }
  }

  // --- Assemble LP string ---
  let lp = 'Maximize\n  obj:';
  {
    const parts: string[] = [];
    for (const { coeff, varName } of objTerms) {
      if (coeff === 0) continue;
      if (parts.length === 0) {
        parts.push(` ${coeff} ${varName}`);
      } else if (coeff > 0) {
        parts.push(` + ${coeff} ${varName}`);
      } else {
        parts.push(` - ${-coeff} ${varName}`);
      }
    }
    if (parts.length === 0) {
      lp += ' capped_ergo'; // ensure non-empty objective
    } else {
      lp += parts.join('');
    }
  }

  lp += '\nSubject To\n';
  for (const c of constraints) {
    lp += `  ${c}\n`;
  }

  lp += 'Bounds\n';
  lp += '  0 <= capped_ergo <= 100\n';

  lp += 'General\n';
  lp += '  capped_ergo\n';

  lp += 'Binary\n';
  for (const b of binaries) {
    lp += `  ${b}\n`;
  }

  lp += 'End\n';

  return {
    lpString: lp,
    varMap: {
      itemVars: xVars,
      buyVars,
      baseVars: baseVarIds,
      presetItemsMap,
      presetPricesMap,
      itemPrices,
      weaponStats: {
        naked_ergonomics: weapon.stats.naked_ergonomics,
        naked_recoil_v: weapon.stats.naked_recoil_v,
        naked_recoil_h: weapon.stats.naked_recoil_h,
        weight: weapon.stats.weight,
        price: weapon.stats.price,
        sighting_range: weapon.stats.sighting_range,
      },
      nakedGunPrice: (fallbackBase?.type === 'naked') ? 0 : Math.floor(weapon.stats.price),
      fallbackBase,
      SCALE,
      ERGO_SCALE,
    },
  };
}

function checkFeasibility(
  weapon: GunLookupEntry,
  itemLookup: ItemLookup,
  compatibilityMap: CompatibilityMap,
  includeItems?: string[] | null,
  includeCategories?: string[][] | null,
  minMagCapacity?: number | null,
  minSightingRange?: number | null,
  maxWeight?: number | null,
): string[] | null {
  const reasons: string[] = [];
  const available = compatibilityMap.reachable_items;

  if (includeItems) {
    for (const reqId of includeItems) {
      if (!(reqId in available)) {
        const name = (itemLookup[reqId]?.data as Record<string, unknown>)?.name as string ?? reqId;
        reasons.push(`Required item '${name}' is not compatible with this weapon`);
      }
    }
  }

  if (includeCategories) {
    for (const group of includeCategories) {
      const groupIds = group.filter(c => typeof c === 'string');
      if (!groupIds.length) continue;
      let found = false;
      for (const itemId of Object.keys(available)) {
        const entry = itemLookup[itemId];
        if (!entry) continue;
        const catId = 'category_id' in entry.stats ? entry.stats.category_id : '';
        const catName = 'category' in entry.stats ? entry.stats.category : '';
        if (groupIds.includes(catId) || groupIds.includes(catName)) {
          found = true;
          break;
        }
      }
      if (!found) {
        reasons.push(`No items found for required category group: ${groupIds.join(', ')}`);
      }
    }
  }

  if (minMagCapacity) {
    let found = false;
    for (const itemId of Object.keys(available)) {
      const entry = itemLookup[itemId];
      if (entry?.type === 'mod' && entry.stats.capacity >= minMagCapacity) {
        found = true; break;
      }
    }
    if (!found) reasons.push(`No magazine with capacity >= ${minMagCapacity} rounds available`);
  }

  if (minSightingRange) {
    const baseSighting = weapon.stats.sighting_range;
    if (baseSighting < minSightingRange) {
      let found = false;
      for (const itemId of Object.keys(available)) {
        const entry = itemLookup[itemId];
        if (entry?.type === 'mod' && entry.stats.sighting_range >= minSightingRange) {
          found = true; break;
        }
      }
      if (!found) reasons.push(`No sight with sighting range >= ${minSightingRange}m available`);
    }
  }

  if (maxWeight != null) {
    const baseWeight = weapon.stats.weight;
    if (baseWeight > maxWeight) {
      reasons.push(`Base weapon weight exceeds limit (${baseWeight.toFixed(2)}kg > ${maxWeight}kg)`);
    }
  }

  return reasons.length > 0 ? reasons : null;
}

function emptyVarMap(weapon: GunLookupEntry): VarMap {
  return {
    itemVars: {},
    buyVars: {},
    baseVars: {},
    presetItemsMap: {},
    presetPricesMap: {},
    itemPrices: {},
    weaponStats: {
      naked_ergonomics: weapon.stats.naked_ergonomics,
      naked_recoil_v: weapon.stats.naked_recoil_v,
      naked_recoil_h: weapon.stats.naked_recoil_h,
      weight: weapon.stats.weight,
      price: weapon.stats.price,
      sighting_range: weapon.stats.sighting_range,
    },
    nakedGunPrice: 0,
    fallbackBase: null,
    SCALE: 1000,
    ERGO_SCALE: 10,
  };
}
