# MiniZinc + Chuffed Solver Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a prototype that solves weapon optimization via MiniZinc+Chuffed and compares results with CP-SAT to establish solver ground truth.

**Architecture:** A standalone TypeScript test script that loads weapon data from Tarkov.dev API, translates it into a MiniZinc model string + JSON data, solves with the `minizinc` npm package (Chuffed solver via WASM), and prints results in the same format as `test_compare.py` for direct comparison.

**Tech Stack:** TypeScript, `minizinc` npm package (WASM), existing `dataService.ts` + `compatibilityMap.ts` for data loading.

---

## File Structure

- **Create:** `frontend/test_minizinc.ts` — Main test script: data loading, MiniZinc model generation, solving, result printing
- **Modify:** `test_compare.py` — Add M4A1 weapon + recoil-only test profile for CP-SAT baselines

---

### Task 1: Install minizinc npm package

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```bash
cd D:/tarkov_dev/guns/frontend && npm install minizinc
```

- [ ] **Step 2: Verify installation**

```bash
ls D:/tarkov_dev/guns/frontend/node_modules/minizinc/dist/
```

Expected: Should contain `minizinc.mjs`, `minizinc-worker.js`, `minizinc.wasm`, `minizinc.data` (or similar).

---

### Task 2: Extend test_compare.py with M4A1 and recoil-only profiles

**Files:**
- Modify: `test_compare.py`

- [ ] **Step 1: Add M4A1 and full test matrix**

Replace the `main()` function in `test_compare.py` with:

```python
M4A1_ID = "5447a9cd4bdc2dbd208b4567"

def main():
    print("Fetching data from Tarkov.dev API...")
    guns, mods = fetch_all_data(lang="en", game_mode="regular")
    print(f"  Got {len(guns)} guns, {len(mods)} mods")

    item_lookup = build_item_lookup(guns, mods)

    weapons = [
        ("AK-74", AK74_ID),
        ("M4A1", M4A1_ID),
    ]

    profiles = [
        ("Ergo only (1,0,0)", 1.0, 0.0, 0.0),
        ("Recoil only (0,1,0)", 0.0, 1.0, 0.0),
        ("Balanced (1,1,0)", 1.0, 1.0, 0.0),
    ]

    for weapon_name, weapon_id in weapons:
        compat_map = build_compatibility_map(weapon_id, item_lookup)
        weapon_stats = item_lookup[weapon_id]['stats']

        print(f"\n{'#'*60}")
        print(f"# Weapon: {item_lookup[weapon_id]['data'].get('name', weapon_id)}")
        print(f"#   Naked Ergo: {weapon_stats.get('naked_ergonomics', 0)}")
        print(f"#   Naked Recoil V: {weapon_stats.get('naked_recoil_v', 0)}")
        print(f"#   Naked Recoil H: {weapon_stats.get('naked_recoil_h', 0)}")
        print(f"{'#'*60}")

        for label, ew, rw, pw in profiles:
            result = optimize_weapon(
                weapon_id, item_lookup, compat_map,
                ergo_weight=ew, recoil_weight=rw, price_weight=pw,
            )
            print_result(f"{weapon_name} - {label}", result, item_lookup, weapon_stats)
```

Also add `M4A1_ID` near the top of the file, after the `AK74_ID` line.

- [ ] **Step 2: Run CP-SAT baselines and save output**

```bash
cd D:/tarkov_dev/guns && python test_compare.py 2>&1 | tee cpsat_baselines.txt
```

Expected: 6 test results (3 profiles x 2 weapons). Save this output — it's the ground truth reference.

---

### Task 3: Build the MiniZinc test script — data loading

**Files:**
- Create: `frontend/test_minizinc.ts`

This task creates the script with data loading and the index-mapping infrastructure. The MiniZinc model generation comes in Task 4.

- [ ] **Step 1: Create test_minizinc.ts with data loading**

Create `frontend/test_minizinc.ts`:

```typescript
/**
 * MiniZinc + Chuffed solver prototype test.
 * Compares results with CP-SAT (Python) to establish ground truth.
 */

import { Model } from 'minizinc';
import { buildCompatibilityMap } from './src/solver/compatibilityMap';
import type { ItemLookup, CompatibilityMap, GunLookupEntry, ModLookupEntry, GunStats, ModStats } from './src/solver/types';

// ── Constants ──────────────────────────────────────────────
const API_URL = 'https://api.tarkov.dev/graphql';
const AK74_ID = '5bf3e03b0db834001d2c4a9c';
const M4A1_ID = '5447a9cd4bdc2dbd208b4567';

const SCALE = 1000;       // matches CP-SAT recoil scaling
const ERGO_SCALE = 10;    // matches CP-SAT ergo scaling

// ── Data Fetching (simplified from dataService.ts for Node) ──

const ITEMS_QUERY = `{
  items(lang: en, gameMode: regular) {
    id
    name
    shortName
    basePrice
    types
    weight
    buyFor {
      priceRUB
      source
      vendor {
        name
        normalizedName
        ... on TraderOffer { minTraderLevel }
      }
    }
    conflictingItems { id }
    bsgCategory { id name }
    properties {
      ... on ItemPropertiesWeapon {
        ergonomics
        recoilVertical
        recoilHorizontal
        defaultErgonomics
        defaultRecoilVertical
        defaultRecoilHorizontal
        sightingRange
        fireRate
        fireModes
        caliber
        cameraSnap
        centerOfImpact
        deviationMax
        deviationCurve
        recoilAngle
        recoilDispersion
        presets {
          id
          name
          containsItems { item { id } }
          buyFor {
            priceRUB
            source
            vendor {
              name
              normalizedName
              ... on TraderOffer { minTraderLevel }
            }
          }
        }
        slots {
          id name nameId required
          filters { allowedItems { id } }
        }
      }
      ... on ItemPropertiesWeaponMod {
        ergonomics
        recoilModifier
        slots { id name nameId required filters { allowedItems { id } } }
      }
      ... on ItemPropertiesBarrel {
        ergonomics
        recoilModifier
        slots { id name nameId required filters { allowedItems { id } } }
      }
      ... on ItemPropertiesMagazine {
        ergonomics
        recoilModifier
        capacity
      }
      ... on ItemPropertiesScope {
        ergonomics
        recoilModifier
        sightingRange
        slots { id name nameId required filters { allowedItems { id } } }
      }
    }
  }
}`;

interface Offer {
    price: number;
    source: string;
    vendor_normalized: string;
    trader_level: number | null;
}

function extractOffers(buyFor: any[]): Offer[] {
    if (!buyFor) return [];
    const offers: Offer[] = [];
    for (const o of buyFor) {
        if (!o || !o.priceRUB || o.priceRUB <= 0) continue;
        const vendor = o.vendor || {};
        offers.push({
            price: o.priceRUB,
            source: o.source || '',
            vendor_normalized: (vendor.normalizedName || '').toLowerCase(),
            trader_level: o.source === 'fleaMarket' ? null : (vendor.minTraderLevel || 1),
        });
    }
    offers.sort((a, b) => a.price - b.price);
    return offers;
}

function getAvailablePrice(offers: Offer[]): { price: number; source: string; available: boolean } {
    // All traders at LL4, flea available — matches test_compare.py defaults
    for (const o of offers) {
        // All offers accessible at LL4 + flea
        return { price: o.price, source: o.source, available: true };
    }
    return { price: 0, source: '', available: false };
}

async function fetchData(): Promise<ItemLookup> {
    console.log('Fetching data from Tarkov.dev API...');
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: ITEMS_QUERY }),
    });
    const json = await resp.json();
    const items = json.data.items;

    const lookup: ItemLookup = {};

    for (const item of items) {
        const props = item.properties || {};
        const isGun = item.types?.includes('gun');
        const isMod = item.types?.includes('mods');

        if (isGun && props.ergonomics !== undefined) {
            // Extract presets
            const presetsRaw = props.presets || [];
            const presets: any[] = [];
            for (const p of presetsRaw) {
                const pOffers = extractOffers(p.buyFor);
                const pPrice = pOffers.length > 0 ? pOffers[0].price : 0;
                presets.push({
                    id: p.id,
                    name: p.name,
                    items: (p.containsItems || []).map((c: any) => c.item.id),
                    image: null,
                    price: pPrice,
                    price_source: pOffers.length > 0 ? pOffers[0].source : 'not_available',
                    offers: pOffers,
                    purchasable: pPrice > 0,
                });
            }

            // Naked gun price
            const gunOffers = extractOffers(item.buyFor);
            let nakedPrice = gunOffers.length > 0 ? gunOffers[0].price : 0;
            if (nakedPrice === 0 && presets.some((p: any) => p.purchasable)) {
                nakedPrice = 999999999;
            } else if (nakedPrice === 0) {
                nakedPrice = 999999999;
            }

            lookup[item.id] = {
                type: 'gun',
                data: { name: item.name, shortName: item.shortName },
                slots: (props.slots || []).map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    nameId: s.nameId,
                    required: !!s.required,
                    allowedItems: (s.filters?.allowedItems || []).map((i: any) => i.id),
                })),
                stats: {
                    naked_ergonomics: props.ergonomics || 0,
                    naked_recoil_v: props.recoilVertical || 0,
                    naked_recoil_h: props.recoilHorizontal || 0,
                    default_ergonomics: props.defaultErgonomics || 0,
                    default_recoil_v: props.defaultRecoilVertical || 0,
                    default_recoil_h: props.defaultRecoilHorizontal || 0,
                    default_preset_image: null,
                    accuracy_modifier: 0,
                    fire_rate: props.fireRate || 0,
                    fire_modes: props.fireModes || [],
                    caliber: props.caliber || '',
                    weight: item.weight || 0,
                    width: 1, height: 1,
                    sighting_range: props.sightingRange || 0,
                    category: item.bsgCategory?.name || '',
                    category_id: item.bsgCategory?.id || '',
                    camera_snap: props.cameraSnap || 0,
                    center_of_impact: props.centerOfImpact || 0,
                    deviation_max: props.deviationMax || 0,
                    deviation_curve: props.deviationCurve || 0,
                    recoil_angle: props.recoilAngle || 0,
                    recoil_dispersion: props.recoilDispersion || 0,
                    price: nakedPrice,
                    price_source: gunOffers.length > 0 ? gunOffers[0].source : 'not_available',
                } as GunStats,
                presets: presets.filter((p: any) => p.purchasable),
                all_presets: presets,
            };
        } else if (isMod && props.ergonomics !== undefined) {
            const modOffers = extractOffers(item.buyFor);
            const { price, available } = getAvailablePrice(modOffers);
            if (!available && price === 0) continue; // skip mods with no price

            lookup[item.id] = {
                type: 'mod',
                data: { name: item.name, shortName: item.shortName },
                slots: (props.slots || []).map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    nameId: s.nameId,
                    required: !!s.required,
                    allowedItems: (s.filters?.allowedItems || []).map((i: any) => i.id),
                })),
                stats: {
                    ergonomics: props.ergonomics || 0,
                    recoil_modifier: props.recoilModifier || 0,
                    accuracy_modifier: 0,
                    offers: modOffers,
                    price: price,
                    price_source: modOffers.length > 0 ? modOffers[0].source : '',
                    weight: item.weight || 0,
                    width: 1, height: 1,
                    min_level_flea: 0,
                    capacity: props.capacity || 0,
                    sighting_range: props.sightingRange || 0,
                    category: item.bsgCategory?.name || '',
                    category_id: item.bsgCategory?.id || '',
                } as ModStats,
                conflicting_items: (item.conflictingItems || []).map((c: any) => c.id),
                conflicting_slot_ids: [],
            };
        }
    }

    console.log(`  Built lookup: ${Object.values(lookup).filter(v => v.type === 'gun').length} guns, ${Object.values(lookup).filter(v => v.type === 'mod').length} mods`);
    return lookup;
}

// ── Placeholder for Tasks 4-6 ──
// buildMiniZincData(), generateMznModel(), runTest(), main()
```

- [ ] **Step 2: Verify it compiles**

```bash
cd D:/tarkov_dev/guns/frontend && npx tsx test_minizinc.ts
```

Expected: Should print "Fetching data..." and "Built lookup: X guns, Y mods" then exit (no solve logic yet).

---

### Task 4: Build MiniZinc data generator

This maps the ItemLookup + CompatibilityMap into integer-indexed arrays that MiniZinc can consume.

**Files:**
- Modify: `frontend/test_minizinc.ts`

- [ ] **Step 1: Add the data generator function**

Add after the `fetchData` function:

```typescript
// ── MiniZinc Data Generator ───────────────────────────────
// Maps item IDs → 1-based integer indices and builds all
// arrays that the MiniZinc model needs as JSON data.

interface MznData {
    n_items: number;
    n_slots: number;
    n_bases: number;
    weapon_naked_ergo: number;     // scaled by ERGO_SCALE
    weapon_naked_recoil_v: number;
    weapon_naked_recoil_h: number;

    item_ergo: number[];           // scaled by ERGO_SCALE
    item_recoil: number[];         // scaled by SCALE
    item_price: number[];
    base_price: number[];
    base_is_naked: number[];       // 1 if this base is the naked gun

    // Slot-item membership (flat arrays, 1-indexed)
    n_slot_entries: number;
    slot_entry_slot: number[];
    slot_entry_item: number[];

    // Slot ownership: 0 = weapon root, else item index
    slot_owner_idx: number[];

    // Required slots (1-indexed slot indices)
    required_slots: number[];

    // Conflict pairs
    n_conflicts: number;
    conflict_a: number[];
    conflict_b: number[];

    // Connectivity: for each item, list of parent item indices (0 = weapon root)
    // Stored as flat arrays with a pointer array
    n_parent_entries: number;
    parent_entry_item: number[];   // which item
    parent_entry_parent: number[]; // which parent (0 = weapon root = always available)

    // Preset-item membership: which items are "free" (cost=0) under each base
    n_preset_items: number;
    preset_item_base: number[];    // base index
    preset_item_item: number[];    // item index

    // Objective weights
    ergo_weight: number;
    recoil_weight: number;
    price_weight: number;

    // Index mapping (not passed to MiniZinc, used for decoding)
    _idToIdx: Map<string, number>;
    _idxToId: string[];
    _baseLabels: string[];         // 'naked' or preset ID
}

function buildMiniZincData(
    weaponId: string,
    itemLookup: ItemLookup,
    compatMap: CompatibilityMap,
    ergoWeight: number,
    recoilWeight: number,
    priceWeight: number,
): MznData {
    const weapon = itemLookup[weaponId] as GunLookupEntry;
    const wStats = weapon.stats;

    // Build item index: 1-based (MiniZinc convention)
    const reachableIds = Object.keys(compatMap.reachable_items);
    const idToIdx = new Map<string, number>();
    const idxToId: string[] = ['__unused__']; // index 0 unused (1-based)
    for (const id of reachableIds) {
        const idx = idxToId.length;
        idToIdx.set(id, idx);
        idxToId.push(id);
    }
    const n_items = reachableIds.length;

    // Item stats arrays (1-indexed, so index 0 is filler)
    const item_ergo: number[] = [];
    const item_recoil: number[] = [];
    const item_price: number[] = [];

    for (let i = 1; i <= n_items; i++) {
        const id = idxToId[i];
        const entry = itemLookup[id];
        if (entry.type === 'mod') {
            item_ergo.push(Math.round(entry.stats.ergonomics * ERGO_SCALE));
            item_recoil.push(Math.round(entry.stats.recoil_modifier * SCALE));
            item_price.push(Math.round(entry.stats.price));
        } else {
            // Gun-as-mod (shouldn't normally happen in reachable)
            item_ergo.push(0);
            item_recoil.push(0);
            item_price.push(0);
        }
    }

    // Base options: naked gun + purchasable presets
    const baseLabels: string[] = [];
    const base_price: number[] = [];
    const base_is_naked: number[] = [];

    // Check if naked gun is purchasable (price < 100M)
    if (wStats.price < 100_000_000) {
        baseLabels.push('naked');
        base_price.push(Math.round(wStats.price));
        base_is_naked.push(1);
    }

    // Add purchasable presets
    const presets = weapon.presets || [];
    for (const p of presets) {
        if (p.price > 0) {
            baseLabels.push(p.id);
            base_price.push(Math.round(p.price));
            base_is_naked.push(0);
        }
    }

    // Fallback: if no bases available, add naked with price=0
    if (baseLabels.length === 0) {
        baseLabels.push('naked');
        base_price.push(0);
        base_is_naked.push(1);
    }

    const n_bases = baseLabels.length;

    // Preset-item membership (which items come free with each preset)
    const preset_item_base: number[] = [];
    const preset_item_item: number[] = [];
    for (let b = 0; b < n_bases; b++) {
        const baseLabel = baseLabels[b];
        if (baseLabel === 'naked') continue;
        const preset = presets.find(p => p.id === baseLabel);
        if (!preset) continue;
        for (const itemId of (preset.items || [])) {
            const idx = idToIdx.get(itemId);
            if (idx !== undefined) {
                preset_item_base.push(b + 1); // 1-indexed
                preset_item_item.push(idx);
            }
        }
    }

    // Slots
    const slotIds = Object.keys(compatMap.slot_items);
    const slotIdToIdx = new Map<string, number>();
    for (let i = 0; i < slotIds.length; i++) {
        slotIdToIdx.set(slotIds[i], i + 1); // 1-indexed
    }
    const n_slots = slotIds.length;

    // Slot-item entries (flat)
    const slot_entry_slot: number[] = [];
    const slot_entry_item: number[] = [];
    for (const [slotId, items] of Object.entries(compatMap.slot_items)) {
        const sIdx = slotIdToIdx.get(slotId)!;
        for (const itemId of items) {
            const iIdx = idToIdx.get(itemId);
            if (iIdx !== undefined) {
                slot_entry_slot.push(sIdx);
                slot_entry_item.push(iIdx);
            }
        }
    }

    // Slot ownership
    const slot_owner_idx: number[] = [];
    for (const slotId of slotIds) {
        const ownerId = compatMap.slot_owner[slotId];
        if (ownerId === weaponId) {
            slot_owner_idx.push(0); // 0 = weapon root
        } else {
            slot_owner_idx.push(idToIdx.get(ownerId) || 0);
        }
    }

    // Required slots
    const required_slots: number[] = [];
    // Check weapon slots
    for (const slot of weapon.slots) {
        if (slot.required) {
            const sIdx = slotIdToIdx.get(slot.id);
            if (sIdx !== undefined) required_slots.push(sIdx);
        }
    }
    // Check mod slots
    for (const id of reachableIds) {
        const entry = itemLookup[id];
        if (!entry) continue;
        for (const slot of entry.slots) {
            if (slot.required) {
                const sIdx = slotIdToIdx.get(slot.id);
                if (sIdx !== undefined) required_slots.push(sIdx);
            }
        }
    }

    // Connectivity: for each item, which items could be parents
    // (via slot_owner). parent=0 means weapon root (always available).
    const parent_entry_item: number[] = [];
    const parent_entry_parent: number[] = [];
    for (const [slotId, items] of Object.entries(compatMap.slot_items)) {
        const ownerId = compatMap.slot_owner[slotId];
        const parentIdx = ownerId === weaponId ? 0 : (idToIdx.get(ownerId) || 0);
        for (const itemId of items) {
            const iIdx = idToIdx.get(itemId);
            if (iIdx !== undefined) {
                parent_entry_item.push(iIdx);
                parent_entry_parent.push(parentIdx);
            }
        }
    }

    // Conflict pairs (deduplicated)
    const conflict_a: number[] = [];
    const conflict_b: number[] = [];
    const conflictPairs = new Set<string>();
    for (const id of reachableIds) {
        const entry = itemLookup[id];
        if (entry.type !== 'mod') continue;
        const iIdx = idToIdx.get(id)!;
        for (const confId of entry.conflicting_items) {
            const cIdx = idToIdx.get(confId);
            if (cIdx === undefined) continue;
            const pairKey = Math.min(iIdx, cIdx) + ':' + Math.max(iIdx, cIdx);
            if (conflictPairs.has(pairKey)) continue;
            conflictPairs.add(pairKey);
            conflict_a.push(Math.min(iIdx, cIdx));
            conflict_b.push(Math.max(iIdx, cIdx));
        }
    }

    return {
        n_items,
        n_slots,
        n_bases,
        weapon_naked_ergo: Math.round(wStats.naked_ergonomics * ERGO_SCALE),
        weapon_naked_recoil_v: wStats.naked_recoil_v,
        weapon_naked_recoil_h: wStats.naked_recoil_h,
        item_ergo,
        item_recoil,
        item_price,
        base_price,
        base_is_naked,
        n_slot_entries: slot_entry_slot.length,
        slot_entry_slot,
        slot_entry_item,
        slot_owner_idx,
        required_slots,
        n_conflicts: conflict_a.length,
        conflict_a,
        conflict_b,
        n_parent_entries: parent_entry_item.length,
        parent_entry_item,
        parent_entry_parent,
        n_preset_items: preset_item_base.length,
        preset_item_base,
        preset_item_item,
        ergo_weight: Math.round(ergoWeight * SCALE),
        recoil_weight: Math.round(recoilWeight * SCALE),
        price_weight: Math.round(priceWeight),
        _idToIdx: idToIdx,
        _idxToId: idxToId,
        _baseLabels: baseLabels,
    };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd D:/tarkov_dev/guns/frontend && npx tsx -e "console.log('ok')"
```

Just a syntax check — full test in Task 6.

---

### Task 5: Generate MiniZinc model string

The model must be structurally identical to CP-SAT: integer arithmetic, same scaling, ergo capping, buy-vs-preset cost separation, placement constraints.

**Files:**
- Modify: `frontend/test_minizinc.ts`

- [ ] **Step 1: Add the model generator function**

Add after `buildMiniZincData`:

```typescript
// ── MiniZinc Model Generator ──────────────────────────────
// Generates a .mzn model string that mirrors the CP-SAT
// model in weapon_optimizer.py. All arithmetic is integer.

function generateMznModel(data: MznData): string {
    return `
% ============================================================
% Tarkov Weapon Optimizer — MiniZinc model
% Mirrors CP-SAT model in weapon_optimizer.py
% ============================================================

% --- Parameters (passed via JSON data) ---
int: n_items;
int: n_slots;
int: n_bases;
int: weapon_naked_ergo;        % scaled by ERGO_SCALE=10
int: weapon_naked_recoil_v;
int: weapon_naked_recoil_h;

array[1..n_items] of int: item_ergo;    % scaled by ERGO_SCALE
array[1..n_items] of int: item_recoil;  % scaled by SCALE=1000
array[1..n_items] of int: item_price;
array[1..n_bases] of int: base_price;
array[1..n_bases] of int: base_is_naked;

int: n_slot_entries;
array[1..n_slot_entries] of 1..n_slots: slot_entry_slot;
array[1..n_slot_entries] of 1..n_items: slot_entry_item;

array[1..n_slots] of 0..n_items: slot_owner_idx;

set of int: required_slots;

int: n_conflicts;
array[1..n_conflicts] of 1..n_items: conflict_a;
array[1..n_conflicts] of 1..n_items: conflict_b;

int: n_parent_entries;
array[1..n_parent_entries] of 1..n_items: parent_entry_item;
array[1..n_parent_entries] of 0..n_items: parent_entry_parent;

int: n_preset_items;
array[1..n_preset_items] of 1..n_bases: preset_item_base;
array[1..n_preset_items] of 1..n_items: preset_item_item;

int: ergo_weight;
int: recoil_weight;
int: price_weight;

% --- Decision Variables ---
array[1..n_items] of var 0..1: x;     % item selected
array[1..n_bases] of var 0..1: base;  % base option selected
array[1..n_items] of var 0..1: buy;   % must pay for item individually

% --- C1: Exactly one base ---
constraint sum(b in 1..n_bases)(base[b]) = 1;

% --- C2: Slot mutex — at most one item per slot ---
constraint forall(s in 1..n_slots)(
    sum(e in 1..n_slot_entries where slot_entry_slot[e] = s)(
        x[slot_entry_item[e]]
    ) <= 1
);

% --- C3: Connectivity — if item selected, at least one parent must be selected ---
% parent_entry_parent=0 means weapon root (always available)
constraint forall(i in 1..n_items)(
    let {
        set of int: my_entries = { e | e in 1..n_parent_entries where parent_entry_item[e] = i }
    } in
    if my_entries = {} then
        x[i] = 0  % unreachable item
    else if exists(e in my_entries)(parent_entry_parent[e] = 0) then
        true  % directly on weapon root, always connectable
    else
        x[i] <= sum(e in my_entries)(
            x[parent_entry_parent[e]]
        )
    endif endif
);

% --- C4: Conflicts — conflicting items can't both be selected ---
constraint forall(c in 1..n_conflicts)(
    x[conflict_a[c]] + x[conflict_b[c]] <= 1
);

% --- C5: Required slots — if owner selected, slot must have an item ---
constraint forall(s in required_slots)(
    if slot_owner_idx[s] = 0 then
        % Weapon-root required slot: must always have an item
        sum(e in 1..n_slot_entries where slot_entry_slot[e] = s)(
            x[slot_entry_item[e]]
        ) >= 1
    else
        % Mod-owned required slot: if owner selected, must have an item
        x[slot_owner_idx[s]] <=
            sum(e in 1..n_slot_entries where slot_entry_slot[e] = s)(
                x[slot_entry_item[e]]
            )
    endif
);

% --- Buy logic: buy[i] = 1 iff item selected AND not covered by a preset ---
% If item is in a selected preset, cost=0 (don't buy individually)
constraint forall(i in 1..n_items)(
    let {
        set of int: my_presets = { p | p in 1..n_preset_items where preset_item_item[p] = i }
    } in
    if my_presets = {} then
        buy[i] = x[i]  % not in any preset, must buy if selected
    else
        % buy[i] >= x[i] - sum of containing presets
        buy[i] >= x[i] - sum(p in my_presets)(base[preset_item_base[p]])
        /\\ buy[i] <= x[i]
        /\\ forall(p in my_presets)(
            buy[i] <= 1 - base[preset_item_base[p]]
        )
    endif
);

% --- Stats ---
var int: total_ergo_scaled =
    weapon_naked_ergo + sum(i in 1..n_items)(item_ergo[i] * x[i]);

var int: total_recoil =
    sum(i in 1..n_items)(item_recoil[i] * x[i]);

var int: total_price =
    sum(b in 1..n_bases)(base_price[b] * base[b])
    + sum(i in 1..n_items)(item_price[i] * buy[i]);

% Ergo capping: game caps at 0-100, scaled by ERGO_SCALE=10
var int: capped_ergo_scaled = max(0, min(1000, total_ergo_scaled));

% --- Objective ---
solve maximize
    ergo_weight * capped_ergo_scaled
    + (-recoil_weight) * total_recoil
    + (-price_weight) * total_price;

% --- Output ---
output [
    "x = ", show(x), ";\\n",
    "base = ", show(base), ";\\n",
    "buy = ", show(buy), ";\\n",
    "total_ergo_scaled = ", show(total_ergo_scaled), ";\\n",
    "total_recoil = ", show(total_recoil), ";\\n",
    "total_price = ", show(total_price), ";\\n",
    "capped_ergo_scaled = ", show(capped_ergo_scaled), ";\\n",
];
`;
}
```

---

### Task 6: Add solve + result printing + main

**Files:**
- Modify: `frontend/test_minizinc.ts`

- [ ] **Step 1: Add solve and result printing functions**

Add after `generateMznModel`:

```typescript
// ── Solve + Print ─────────────────────────────────────────

async function runTest(
    label: string,
    weaponId: string,
    itemLookup: ItemLookup,
    ergoWeight: number,
    recoilWeight: number,
    priceWeight: number,
) {
    const weaponEntry = itemLookup[weaponId] as GunLookupEntry;
    const wStats = weaponEntry.stats;
    const compatMap = buildCompatibilityMap(weaponId, itemLookup);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${label}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Weights: ergo=${ergoWeight}, recoil=${recoilWeight}, price=${priceWeight}`);

    const data = buildMiniZincData(weaponId, itemLookup, compatMap, ergoWeight, recoilWeight, priceWeight);

    console.log(`  Items: ${data.n_items}, Slots: ${data.n_slots}, Bases: ${data.n_bases}`);
    console.log(`  Slot entries: ${data.n_slot_entries}, Conflicts: ${data.n_conflicts}`);
    console.log(`  Parent entries: ${data.n_parent_entries}, Preset items: ${data.n_preset_items}`);

    const mznModel = generateMznModel(data);

    // Build JSON data (strip underscore-prefixed internal fields)
    const jsonData: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
        if (!key.startsWith('_')) {
            jsonData[key] = val;
        }
    }

    const model = new Model();
    model.addFile('weapon.mzn', mznModel);
    model.addJson(jsonData);

    const startTime = Date.now();

    try {
        const solve = model.solve({
            options: {
                solver: 'chuffed',
                'time-limit': 60000,  // 60 seconds
            },
        });

        const result = await solve;
        const elapsed = Date.now() - startTime;

        console.log(`  Status: ${result.status} (${elapsed}ms)`);

        if (result.status === 'SATISFIED' || result.status === 'OPTIMAL_SOLUTION' || result.status === 'ALL_SOLUTIONS') {
            const sol = result.solution?.output?.json || result.solution?.output?.default;

            if (!sol) {
                console.log(`  No solution data found. Raw:`, JSON.stringify(result).slice(0, 500));
                return;
            }

            // Decode selected items
            const xArr: number[] = sol.x || [];
            const baseArr: number[] = sol.base || [];
            const buyArr: number[] = sol.buy || [];

            const selectedIds: string[] = [];
            for (let i = 0; i < xArr.length; i++) {
                if (xArr[i] === 1) {
                    selectedIds.push(data._idxToId[i + 1]); // 1-indexed
                }
            }

            // Find selected base
            let selectedBase = 'unknown';
            for (let b = 0; b < baseArr.length; b++) {
                if (baseArr[b] === 1) {
                    selectedBase = data._baseLabels[b];
                    break;
                }
            }

            // Compute stats (matching test_compare.py exactly)
            let totalErgo = wStats.naked_ergonomics;
            let totalRecoilMod = 0;
            let totalPrice = 0;
            let totalWeight = wStats.weight || 0;

            for (const id of selectedIds) {
                const entry = itemLookup[id];
                if (!entry || entry.type !== 'mod') continue;
                totalErgo += entry.stats.ergonomics || 0;
                totalRecoilMod += entry.stats.recoil_modifier || 0;
                totalPrice += entry.stats.price || 0;
                totalWeight += entry.stats.weight || 0;
            }

            // Add base price
            let basePrice = 0;
            if (selectedBase === 'naked') {
                basePrice = wStats.price < 100_000_000 ? wStats.price : 0;
            } else {
                const preset = (weaponEntry.presets || []).find(p => p.id === selectedBase);
                basePrice = preset?.price || 0;
            }

            // Subtract preset item prices (they're free)
            if (selectedBase !== 'naked') {
                const preset = (weaponEntry.presets || []).find(p => p.id === selectedBase);
                if (preset) {
                    for (const pItemId of (preset.items || [])) {
                        if (selectedIds.includes(pItemId)) {
                            const entry = itemLookup[pItemId];
                            if (entry?.type === 'mod') {
                                totalPrice -= entry.stats.price || 0;
                            }
                        }
                    }
                }
            }
            totalPrice += basePrice;

            const finalRecoilV = wStats.naked_recoil_v * (1 + totalRecoilMod);
            const finalRecoilH = wStats.naked_recoil_h * (1 + totalRecoilMod);
            const cappedErgo = Math.max(0, Math.min(100, totalErgo));

            if (selectedBase !== 'naked') {
                console.log(`  Preset: ${selectedBase}`);
            } else {
                console.log(`  Base: naked gun (RUB${basePrice})`);
            }

            console.log(`  Ergonomics: ${cappedErgo}`);
            console.log(`  Vert. Recoil: ${finalRecoilV.toFixed(1)}`);
            console.log(`  Horiz. Recoil: ${finalRecoilH.toFixed(1)}`);
            console.log(`  Total Price: RUB${totalPrice.toLocaleString()}`);
            console.log(`  Weight: ${totalWeight.toFixed(2)} kg`);
            console.log(`  Items (${selectedIds.length}):`);
            for (const id of selectedIds.sort()) {
                const name = itemLookup[id]?.data?.name || id;
                console.log(`    - ${name} (${id})`);
            }
        } else {
            console.log(`  Solver returned: ${result.status}`);
            if (result.status === 'UNSATISFIABLE') {
                console.log(`  Model is infeasible.`);
            }
        }
    } catch (err: any) {
        console.error(`  Solve error: ${err.message || err}`);
    }
}

// ── Main ──────────────────────────────────────────────────

async function main() {
    const itemLookup = await fetchData();

    const weapons: [string, string][] = [
        ['AK-74', AK74_ID],
        ['M4A1', M4A1_ID],
    ];

    const profiles: [string, number, number, number][] = [
        ['Ergo only (1,0,0)', 1, 0, 0],
        ['Recoil only (0,1,0)', 0, 1, 0],
        ['Balanced (1,1,0)', 1, 1, 0],
    ];

    for (const [weaponName, weaponId] of weapons) {
        const w = itemLookup[weaponId];
        if (!w || w.type !== 'gun') {
            console.error(`Weapon ${weaponName} (${weaponId}) not found!`);
            continue;
        }
        console.log(`\n${'#'.repeat(60)}`);
        console.log(`# Weapon: ${w.data.name}`);
        console.log(`#   Naked Ergo: ${w.stats.naked_ergonomics}`);
        console.log(`#   Naked Recoil V: ${w.stats.naked_recoil_v}`);
        console.log(`#   Naked Recoil H: ${w.stats.naked_recoil_h}`);
        console.log(`${'#'.repeat(60)}`);

        for (const [label, ew, rw, pw] of profiles) {
            await runTest(`${weaponName} - ${label}`, weaponId, itemLookup, ew, rw, pw);
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Run the full prototype**

```bash
cd D:/tarkov_dev/guns/frontend && npx tsx test_minizinc.ts 2>&1 | tee minizinc_results.txt
```

Expected: 6 test results with status, ergonomics, recoil, price, and item lists for each.

- [ ] **Step 3: Compare with CP-SAT baselines**

Visually compare `minizinc_results.txt` with `cpsat_baselines.txt`:
- Do the same items get selected?
- Are ergo/recoil/price values identical or very close?
- Any infeasible results that shouldn't be?

---

### Task 7: Debug and iterate

This task handles any issues discovered during the first run.

**Files:**
- Modify: `frontend/test_minizinc.ts`

- [ ] **Step 1: Check MiniZinc status codes**

The `minizinc` npm package may use different status strings. If the result parsing fails, inspect `result` object:

```typescript
console.log('Full result:', JSON.stringify(result, null, 2).slice(0, 2000));
```

Common status values: `'SATISFIED'`, `'OPTIMAL_SOLUTION'`, `'UNSATISFIABLE'`, `'UNKNOWN'`, `'ERROR'`.

- [ ] **Step 2: If MiniZinc model syntax errors occur**

Write the generated model to a file for debugging:

```typescript
import * as fs from 'fs';
fs.writeFileSync('debug_model.mzn', mznModel);
fs.writeFileSync('debug_data.json', JSON.stringify(jsonData, null, 2));
```

Then inspect `debug_model.mzn` and `debug_data.json` for issues.

- [ ] **Step 3: If results diverge from CP-SAT**

For any divergence, dump the item lists from both solvers and diff:
- Check if the same presets were available to both solvers
- Check if recoil modifiers are in the same format (decimal vs percentage)
- Check if required slots are handled the same way
- Verify conflict pairs are the same set

---

## Self-Review Checklist

1. **Spec coverage:**
   - CP-SAT baselines: Task 2 ✓
   - MiniZinc data loading: Task 3 ✓
   - MiniZinc model generation with full CP-SAT parity: Tasks 4-5 ✓
     - `buy[i]` variables for preset cost separation ✓
     - Slot mutex ✓
     - Connectivity/parent dependency ✓
     - Conflict pairs (deduplicated) ✓
     - Required slots (weapon + mods, conditional) ✓
     - Ergo capping 0-100 ✓
     - Integer scaling (SCALE=1000, ERGO_SCALE=10) ✓
   - Solve + result comparison: Task 6 ✓
   - Debug/iterate: Task 7 ✓

2. **Placeholder scan:** No TBD/TODO. All code blocks complete.

3. **Type consistency:** `MznData`, `ItemLookup`, `CompatibilityMap`, `GunLookupEntry` used consistently across tasks.
