# HiGHS LP Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Z3 solver with a direct CPLEX LP builder + HiGHS WASM solver, producing CP-SAT-equivalent results.

**Architecture:** `lpBuilder.ts` generates a CPLEX LP string with binary variables (matching the validated MiniZinc prototype model), `solver.ts` feeds it to the `highs` npm package and decodes the solution. Z3, async-mutex, and COOP/COEP headers are removed.

**Tech Stack:** TypeScript, `highs` npm package (WASM), CPLEX LP format

---

## File Structure

- **Create:** `frontend/src/solver/lpBuilder.ts` — LP string generation from SolveParams
- **Rewrite:** `frontend/src/solver/solver.ts` — HiGHS integration replacing Z3
- **Delete:** `frontend/src/solver/z3Solver.ts`
- **Modify:** `frontend/src/solver/solver.worker.ts` — Remove async-mutex
- **Modify:** `frontend/vite.config.ts` — Remove Z3-specific config
- **Modify:** `frontend/package.json` — Remove z3-solver, async-mutex deps

---

### Task 1: Create lpBuilder.ts

This is the bulk of the work. The LP builder translates `SolveParams` into a CPLEX LP format string. The model must match the validated MiniZinc prototype exactly.

**Files:**
- Create: `frontend/src/solver/lpBuilder.ts`

**Reference files the implementer MUST read:**
- `frontend/test_minizinc.ts` — The validated prototype. The `buildMznData()` function (lines 95-410) shows exactly how to build index mappings, filter available items, build preset/slot/conflict/parent data. The `generateMznModel()` function (lines 415-730) shows the exact constraint structure. Port these to LP format.
- `frontend/src/solver/types.ts` — `SolveParams`, `ItemLookup`, `CompatibilityMap`, `GunLookupEntry`, `ModLookupEntry`
- `frontend/src/solver/dataService.ts` — `getAvailablePrice()` function (line 621)

- [ ] **Step 1: Create lpBuilder.ts with the full implementation**

Create `frontend/src/solver/lpBuilder.ts`. The function signature:

```typescript
import type { SolveParams, ItemLookup, CompatibilityMap, GunLookupEntry, ModLookupEntry } from './types';
import { getAvailablePrice } from './dataService';

const ERGO_SCALE = 10;
const SCALE = 1000;

export interface LPResult {
  lpString: string;
  // Index mappings for decoding solution
  indexToItem: string[];      // 1-indexed: indexToItem[1] = first item ID
  baseIds: string[];          // 0-indexed: baseIds[0] = 'naked' or preset ID
  nItems: number;
  nBases: number;
  weaponId: string;
}

export function buildLP(params: SolveParams): LPResult { ... }
```

The implementation must:

**A) Data preparation (port from test_minizinc.ts `buildMznData`):**

1. Get weapon entry, stats, presets from `params.itemLookup[params.weaponId]`
2. Build preset maps: `presetItemsMap` (preset ID → Set of item IDs), `itemToPresets` (item ID → preset IDs), `presetPricesMap` (preset ID → price). Use `getAvailablePrice()` to check preset availability against `params.traderLevels`, `params.fleaAvailable`, `params.playerLevel`.
3. Filter reachable items by availability (same logic as test_minizinc.ts lines 128-153): check `getAvailablePrice()`, items with price > 100M only via preset, skip excluded items/categories.
4. Build 1-based item index: `itemIndex: Map<string, number>`, `indexToItem: string[]`
5. Build slot index from slots that have at least one available item
6. Build base options: naked gun (if price < 100M) + purchasable presets. Fallback to price=0 if none.
7. Build flat arrays: slot-item membership, slot ownership (0=weapon root), required slots, conflict pairs (deduplicated), parent connectivity, preset-item membership
8. Per-item stats: `item_ergo[i] = round(ergo * ERGO_SCALE)`, `item_recoil[i] = round(recoil_modifier * SCALE)`, `item_price[i] = round(price)`, `item_available[i] = 0 or 1`

**B) Tiebreaker weights:**

```typescript
const effectiveErgoWeight = params.ergoWeight || 0.001;
const effectiveRecoilWeight = params.recoilWeight || 0.001;
const effectivePriceWeight = params.priceWeight || 0.001;
```

**C) LP string generation (port from test_minizinc.ts `generateMznModel`, but in CPLEX LP format):**

The LP format structure is:

```
\ Tarkov Weapon Optimizer
Maximize
  obj: [objective terms as linear expression]
Subject To
  [constraint_name: linear_expression <= / >= / = rhs]
  ...
Bounds
  0 <= capped_ergo <= 1000
Binary
  x_1 x_2 ... buy_1 buy_2 ... base_1 base_2 ... p_3_1 p_3_5 ...
End
```

Key CPLEX LP syntax rules:
- Variable names: letters, digits, underscore. Start with letter. Use `x_1`, `buy_1`, `base_1`, `p_3_1`.
- Coefficients before variables: `5 x_1 + 3 x_2` (space between coefficient and variable)
- Negative coefficients: `- 3 x_2` or `+ -3 x_2`
- Each constraint needs a unique name followed by colon: `c1: x_1 + x_2 <= 1`
- `Maximize` section has one named expression
- `Bounds` section for continuous variables (capped_ergo)
- `Binary` section lists all 0/1 variables (space-separated)
- Lines can be up to ~500 chars; longer expressions can span multiple lines (continuation lines start with space)

**Constraints to generate** (matching the MiniZinc prototype exactly):

1. **Base sum:** `base_sum: base_1 + base_2 + ... = 1`

2. **Slot mutex:** For each slot with >1 item, generate one constraint. Use `p_i_s` for multi-slot items, `x_i` for single-slot items.

3. **Placement linking:** For each multi-slot item: `place_link_i: p_i_s1 + p_i_s2 + ... - x_i = 0`

4. **Connectivity:** For multi-slot items, each placement needs owner: `conn_p_i_s: p_i_s - x_owner <= 0`. For single-slot items not on weapon root: `conn_i: x_i - x_o1 - x_o2 ... <= 0`. Items with no parents: `no_parent_i: x_i = 0`.

5. **Conflicts:** `conf_k: x_a + x_b <= 1`

6. **Item availability:** Items only via preset: `avail_i: x_i - base_b1 - base_b2 ... <= 0`

7. **Buy logic:** For items in presets:
   - `buy_le_x_i: buy_i - x_i <= 0`
   - `buy_le_notbase_i_b: buy_i + base_b <= 1` for each containing preset b
   - `buy_ge_i: buy_i - x_i + base_b1 + base_b2 ... >= 0`
   For items NOT in any preset: `buy_eq_i: buy_i - x_i = 0`

8. **Required slots:** Weapon-root: `req_s: x_a + x_b + ... >= 1`. Mod-owned: `req_s: - x_owner + x_a + x_b + ... >= 0` (equivalently `x_owner - x_a - x_b ... <= 0`).

**Objective:**

```
Maximize
  obj: [ergo_coeff] capped_ergo [+ recoil terms over x_i] [+ price terms over buy_i and base_b]
```

Where:
- Ergo coefficient on `capped_ergo`: `ergo_weight * SCALE` where `ergo_weight = round(effectiveErgoWeight * SCALE)`
- Recoil term per item i: coefficient = `recoil_weight * SCALE * ERGO_SCALE * item_recoil[i]` (negative recoil is good → positive coefficient since item_recoil is already negative for recoil reduction)
- Price term per `buy_i`: coefficient = `-price_weight_obj * item_price[i]` where `price_weight_obj = round(effectivePriceWeight * SCALE * ERGO_SCALE)`
- Price term per `base_b`: coefficient = `-price_weight_obj * base_price[b]`

**Ergo capping constraint:**

```
capped_ergo_le_sum: capped_ergo - [ergo terms over x_i] <= weapon_naked_ergo_scaled
```

(i.e., `capped_ergo <= weapon_naked_ergo_scaled + sum(item_ergo[i] * x_i)`)

The `Bounds` section enforces `0 <= capped_ergo <= 1000`. Since ergo has positive weight in the objective, the solver pushes capped_ergo up to min(actual_ergo, 1000) naturally.

**Hard constraints from SolveParams** (if provided):
- `params.maxPrice`: `price_limit: [base price terms] + [buy price terms] <= maxPrice`
- `params.minErgonomics`: add constraint on capped_ergo (after dividing by ERGO_SCALE, or compare scaled: `capped_ergo >= minErgo * ERGO_SCALE`)
- `params.maxRecoilV`: convert to modifier limit: `recoil_limit: [recoil terms] <= round(SCALE * (maxRecoilV / nakedRecoilV - 1))`
- `params.maxWeight`: `weight_limit: [weight terms] <= round((maxWeight - baseWeight) * 1000)` (in grams)
- `params.includeItems`: `include_i: x_i = 1` for each required item
- `params.excludeItems`: already filtered out in data prep

- [ ] **Step 2: Verify it compiles**

```bash
cd D:/tarkov_dev/guns/frontend && npx tsc --noEmit src/solver/lpBuilder.ts
```

---

### Task 2: Rewrite solver.ts for HiGHS

**Files:**
- Rewrite: `frontend/src/solver/solver.ts`

- [ ] **Step 1: Replace solver.ts with HiGHS integration**

Replace the entire contents of `frontend/src/solver/solver.ts` with:

```typescript
/**
 * HiGHS LP Solver Integration
 * Builds LP string via lpBuilder, solves with HiGHS WASM, decodes result.
 */

import type { OptimizeResponse, ItemDetail, PresetDetail, FinalStats } from '../api/client';
import type { SolveParams, GunLookupEntry } from './types';
export type { SolveParams } from './types';
import { buildLP } from './lpBuilder';

// @ts-expect-error — highs package has no type declarations
import highsLoader from 'highs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let highs: any = null;

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  const startTime = performance.now();

  try {
    if (!highs) {
      highs = await highsLoader();
    }

    const lp = buildLP(params);
    const result = highs.solve(lp.lpString);

    if (result.Status !== 'Optimal') {
      return {
        status: 'infeasible',
        reason: result.Status === 'Infeasible' ? 'No valid configuration found' : result.Status,
        selected_items: [],
        selected_preset: undefined,
        objective_value: 0,
        solve_time_ms: performance.now() - startTime,
      };
    }

    // Decode solution: read x_i variables
    const columns = result.Columns || {};
    const selectedIds: string[] = [];
    for (let i = 1; i <= lp.nItems; i++) {
      const col = columns[`x_${i}`];
      if (col && col.Primal > 0.5) {
        selectedIds.push(lp.indexToItem[i]);
      }
    }

    // Find selected base
    let selectedBaseId: string | null = null;
    for (let b = 0; b < lp.nBases; b++) {
      const col = columns[`base_${b + 1}`];
      if (col && col.Primal > 0.5) {
        selectedBaseId = lp.baseIds[b];
        break;
      }
    }

    // Compute stats from raw item data (matching test_compare.py)
    const weapon = params.itemLookup[params.weaponId] as GunLookupEntry;
    const wStats = weapon.stats;

    let totalErgo = wStats.naked_ergonomics;
    let totalRecoilMod = 0;
    let totalPrice = 0;
    let totalWeight = wStats.weight || 0;

    const detailedItems: ItemDetail[] = [];

    for (const itemId of selectedIds) {
      const entry = params.itemLookup[itemId];
      if (!entry) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = entry.data as Record<string, any>;
      const icon = data.iconLink ?? data.iconLinkFallback ?? data.imageLink ?? data.image512pxLink;

      if (entry.type === 'mod') {
        const ms = entry.stats;
        totalErgo += ms.ergonomics || 0;
        totalRecoilMod += ms.recoil_modifier || 0;
        totalPrice += ms.price || 0;
        totalWeight += ms.weight || 0;

        detailedItems.push({
          id: itemId,
          name: data.name ?? 'Unknown',
          price: ms.price || 0,
          icon,
          source: ms.price_source ?? 'Unknown',
          ergonomics: ms.ergonomics || 0,
          recoil_modifier: ms.recoil_modifier || 0,
        });
      } else {
        detailedItems.push({
          id: itemId,
          name: data.name ?? 'Unknown',
          price: 0,
          icon,
          source: '',
          ergonomics: 0,
          recoil_modifier: 0,
        });
      }
    }

    // Subtract preset item prices (they're free via buy logic, but we summed all prices above)
    // Actually: we should only sum prices for items where buy=1, not all selected items.
    // Re-compute price correctly using buy variables:
    let buyPrice = 0;
    for (let i = 1; i <= lp.nItems; i++) {
      const buyCol = columns[`buy_${i}`];
      if (buyCol && buyCol.Primal > 0.5) {
        const itemId = lp.indexToItem[i];
        const entry = params.itemLookup[itemId];
        if (entry?.type === 'mod') {
          buyPrice += entry.stats.price || 0;
        }
      }
    }

    // Base price
    let basePrice = 0;
    let presetDetail: PresetDetail | undefined;
    if (selectedBaseId === 'naked') {
      basePrice = wStats.price < 100_000_000 ? wStats.price : 0;
    } else if (selectedBaseId) {
      const preset = (weapon.presets || []).find(p => p.id === selectedBaseId)
        || (weapon.all_presets || []).find(p => p.id === selectedBaseId);
      if (preset) {
        basePrice = preset.price;
        presetDetail = {
          id: preset.id,
          name: preset.name,
          price: preset.price,
          items: preset.items || [],
        };
      }
    }

    totalPrice = buyPrice + basePrice;

    const finalStats: FinalStats = {
      ergonomics: Math.max(0, Math.min(100, totalErgo)),
      recoil_vertical: wStats.naked_recoil_v * (1 + totalRecoilMod),
      recoil_horizontal: wStats.naked_recoil_h * (1 + totalRecoilMod),
      total_price: totalPrice,
      total_weight: totalWeight,
    };

    return {
      status: 'optimal',
      selected_items: detailedItems,
      selected_preset: presetDetail,
      objective_value: result.ObjectiveValue || 0,
      final_stats: finalStats,
      solve_time_ms: performance.now() - startTime,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown solver error';
    console.error('HiGHS Solve Error:', e);
    return {
      status: 'infeasible',
      reason: msg,
      selected_items: [],
      selected_preset: undefined,
      objective_value: 0,
      solve_time_ms: performance.now() - startTime,
    };
  }
}
```

---

### Task 3: Clean up worker, vite config, and dependencies

**Files:**
- Modify: `frontend/src/solver/solver.worker.ts` — Remove async-mutex import and workerMutex
- Modify: `frontend/vite.config.ts` — Remove Z3-specific config
- Delete: `frontend/src/solver/z3Solver.ts`

- [ ] **Step 1: Update solver.worker.ts**

Remove these lines from `solver.worker.ts`:

```typescript
// DELETE: import { Mutex } from 'async-mutex';
// DELETE: const workerMutex = new Mutex();
```

And replace `await workerMutex.runExclusive(async () => {` with just executing the body directly (remove the mutex wrapper but keep the logic inside).

- [ ] **Step 2: Update vite.config.ts**

Replace `frontend/vite.config.ts` with:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(Date.now().toString()),
  },
  worker: {
    format: 'es',
  },
})
```

Removed: COOP/COEP headers, `global: 'globalThis'` define, `optimizeDeps.exclude: ['z3-solver']`.

- [ ] **Step 3: Delete z3Solver.ts**

```bash
rm frontend/src/solver/z3Solver.ts
```

- [ ] **Step 4: Remove z3-solver and async-mutex dependencies**

```bash
cd frontend && npm uninstall z3-solver async-mutex
```

- [ ] **Step 5: Verify build**

```bash
cd frontend && npm run build
```

Expected: Clean build with no Z3 references.

---

### Task 4: Test against CP-SAT baselines

**Files:**
- Create: `frontend/test_highs.ts` — Test script comparing HiGHS results to CP-SAT

- [ ] **Step 1: Create test script**

Create `frontend/test_highs.ts` that uses the new `solve()` from `solver.ts` with the same weapon/profile matrix as `test_compare.py`. The script should:

1. Import `solve` from `./src/solver/solver`
2. Import `buildCompatibilityMap` from `./src/solver/compatibilityMap`
3. Import `fetchAllData`, `buildItemLookup` from `./src/solver/dataService`
4. Test 5 weapons (AK-74, M4A1, P90, RSASS, Vector) × 3 profiles ((1,0.001,0.001), (0.001,1,0.001), (1,1,0.01))
5. Print status, ergo, recoil, price, item list — same format as `test_compare.py`

The test uses the public `solve(SolveParams)` API, not internal LP functions, to verify the full pipeline end-to-end.

- [ ] **Step 2: Run and compare**

```bash
export PATH="$PATH:/c/Program Files/MiniZinc"
cd frontend && npx tsx test_highs.ts 2>&1 | tee highs_results.txt
cd .. && python test_compare.py 2>&1 | tee cpsat_results.txt
```

Compare: primary objectives should match within ~2%. Prices should be within ~5%.

---

## Self-Review

1. **Spec coverage:**
   - LP builder with all constraints (buy, placement, mutex, connectivity, conflicts, required, ergo cap, hard constraints): Task 1 ✓
   - HiGHS integration replacing Z3: Task 2 ✓
   - Tiebreaker weights: Task 1 ✓
   - Z3/async-mutex/COOP-COEP cleanup: Task 3 ✓
   - Testing against CP-SAT: Task 4 ✓

2. **Placeholder scan:** No TBD/TODO. Task 1 describes exact constraint generation logic with LP syntax examples. Task 2 has complete solver.ts code. Task 3 has exact deletions. Task 4 describes test structure.

3. **Type consistency:** `LPResult` (Task 1) fields `indexToItem`, `baseIds`, `nItems`, `nBases`, `weaponId` match usage in `solver.ts` (Task 2). `SolveParams` and `OptimizeResponse` types from existing `types.ts` and `client.ts` used consistently.
