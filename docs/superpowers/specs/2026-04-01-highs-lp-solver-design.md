# HiGHS LP Solver — Replace Z3 with Direct LP Builder

## Goal

Replace the Z3 WASM solver with a direct CPLEX LP builder + HiGHS WASM solver. This eliminates Z3's SharedArrayBuffer requirement, reduces bundle size, and produces CP-SAT-equivalent results (validated in the MiniZinc prototype).

## Background

The MiniZinc + HiGHS prototype (`frontend/test_minizinc.ts`) validated that the correct model structure produces results matching the Python CP-SAT solver across 5 weapons. The key learnings:

1. **Buy variables** (`buy[i]`) separate preset cost from individual purchase cost — Z3 was missing this
2. **Placement variables** (`p[item][slot]`) for multi-slot items prevent over-constraining slot mutex
3. **Integer scaling** (ERGO_SCALE=10, SCALE=1000) with correct objective term ratios
4. **Ergo capping** at 0-100 (scaled 0-1000)
5. **Tiebreaker weights** — inject 0.001 for any zero-weighted attribute to avoid arbitrary solutions

HiGHS solves these in 0.25-45 seconds and the `highs` npm package (~5MB) is already installed. No MiniZinc compilation step needed.

## Architecture

### Files to create/modify

- **Create:** `frontend/src/solver/lpBuilder.ts` — Generates CPLEX LP format string from `SolveParams`
- **Modify:** `frontend/src/solver/solver.ts` — Replace Z3 delegation with HiGHS LP solve
- **Delete:** `frontend/src/solver/z3Solver.ts` — No longer needed
- **Modify:** `frontend/vite.config.ts` — Remove Z3-specific COOP/COEP headers and optimizeDeps exclusion
- **Modify:** `frontend/package.json` — Remove `z3-solver` and `async-mutex` dependencies

### Data flow (unchanged from consumer perspective)

```
UI → api/client.ts → solver.worker.ts → solver.ts → lpBuilder.ts → HiGHS WASM
                                              ↑
                                    Same SolveParams interface
                                    Same OptimizeResponse return
```

## LP Builder Design (`lpBuilder.ts`)

### Input
`SolveParams` from `types.ts` — same interface the Z3 solver used. No changes to callers.

### Output
CPLEX LP format string with `Binary` section declaring all decision variables as 0/1.

### Decision Variables

- `x_{itemIdx}` — item selected (binary, 1-indexed by reachable item)
- `buy_{itemIdx}` — must purchase individually (binary)
- `base_{baseIdx}` — base option selected: naked gun or preset (binary)
- `p_{itemIdx}_{slotIdx}` — placement variable for multi-slot items only (binary)

### Constraints (mirroring CP-SAT)

1. **Exactly one base:** `sum(base) = 1`
2. **Slot mutex:** For each slot, `sum(placement_or_x_vars) <= 1`. Uses `p_i_s` for multi-slot items, `x_i` for single-slot items.
3. **Placement linking:** For each multi-slot item, `sum(p_i_s for s in slots) - x_i = 0`
4. **Connectivity:** For multi-slot items: `p_i_s <= x_owner_of_s` per placement. For single-slot items not on weapon root: `x_i <= sum(x_owners)`
5. **Conflicts:** For each deduplicated conflict pair: `x_a + x_b <= 1`
6. **Item availability:** Items only available via preset: `x_i <= sum(base_b for containing presets)`
7. **Buy logic (linearized AND-NOT):**
   - `buy_i <= x_i`
   - `buy_i <= 1 - base_b` for each containing preset b
   - `buy_i >= x_i - sum(base_b for containing presets)`
   - If not in any preset: `buy_i - x_i = 0`
8. **Required slots:** Weapon-root required: `sum(items_in_slot) >= 1`. Mod-owned required: `x_owner <= sum(items_in_slot)`

### Objective

```
maximize
  ergo_weight * SCALE * capped_ergo_scaled
  + (-recoil_weight) * SCALE * ERGO_SCALE * total_recoil
  + (-price_weight_obj) * total_price
```

Where:
- `ergo_weight = round(effectiveErgoWeight * SCALE)`
- `recoil_weight = round(effectiveRecoilWeight * SCALE)`
- `price_weight_obj = round(effectivePriceWeight * SCALE * ERGO_SCALE)`
- `capped_ergo_scaled` = weapon_naked_ergo * ERGO_SCALE + sum(item_ergo_scaled * x_i), capped at 0-1000
- `total_recoil` = sum(item_recoil_scaled * x_i)
- `total_price` = sum(base_price * base_b) + sum(item_price * buy_i)

### Tiebreaker weights

```typescript
const effectiveErgoWeight = ergoWeight || 0.001;
const effectiveRecoilWeight = recoilWeight || 0.001;
const effectivePriceWeight = priceWeight || 0.001;
```

### Ergo capping in LP format

Ergo capping (0-100, scaled 0-1000) requires auxiliary variables since LP format can't express `min`/`max` directly:

```
var: ergo_sum (continuous, unbounded) = weapon_naked_ergo_scaled + sum(item_ergo * x_i)
var: capped_ergo (continuous, 0-1000)
constraints:
  capped_ergo <= ergo_sum        (can't exceed actual)
  capped_ergo <= 1000            (game cap)
  capped_ergo >= 0               (floor)
```

Since ergo has positive weight in the objective, the solver will naturally push `capped_ergo` to its maximum allowed value (= min(ergo_sum, 1000)), so no extra binary indicator is needed.

### LP Format Structure

```
\ Tarkov Weapon Optimizer
Maximize
  obj: [ergo terms] + [recoil terms] + [price terms]
Subject To
  base_sum: base_1 + base_2 + ... = 1
  slot_1_mutex: p_3_1 + x_5 + x_7 <= 1
  ...
  connectivity_3: p_3_1 - x_owner_1 <= 0
  ...
  conflict_1: x_12 + x_45 <= 1
  ...
  buy_link_3: buy_3 - x_3 <= 0
  ...
Bounds
  0 <= capped_ergo <= 1000
Binary
  x_1 x_2 ... buy_1 buy_2 ... base_1 base_2 ... p_3_1 p_3_2 ...
End
```

## Solver Integration (`solver.ts`)

Replace `z3Solver.ts` delegation with:

```typescript
import highsLoader from 'highs';

let highs: any = null;

export async function solve(params: SolveParams): Promise<OptimizeResponse> {
  if (!highs) highs = await highsLoader();
  
  const { lpString, indexToItem, baseIds, ... } = buildLP(params);
  const result = highs.solve(lpString);
  
  if (result.Status !== 'Optimal') return infeasibleResponse(...);
  
  // Decode: read x_i columns, map back to item IDs
  // Compute stats from raw item data (not LP output)
  return { status: 'optimal', selected_items, final_stats, ... };
}
```

Mutex from `async-mutex` is no longer needed — HiGHS WASM is synchronous (returns result directly, no shared state like Z3 context).

## Cleanup

- Delete `z3Solver.ts`
- Remove from `package.json`: `z3-solver`, `async-mutex`
- Remove from `vite.config.ts`:
  - `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers
  - `optimizeDeps.exclude: ['z3-solver']`
  - `define: { global: 'globalThis' }`
- Remove `z3Mutex` and `workerMutex` from `solver.worker.ts`

## Testing

Validate with the same test script pattern as the prototype:
- AK-74, M4A1, P90 with weights (1, 0.001, 0.001), (0.001, 1, 0.001), (1, 1, 0.01)
- Compare ergo/recoil/price against CP-SAT baselines
- Verify OPTIMAL status for all cases

## Success Criteria

- All test cases produce OPTIMAL_SOLUTION matching CP-SAT within ~2%
- No COOP/COEP headers required
- Bundle size reduced (no z3-solver ~30MB → highs ~5MB)
- Solve times under 60 seconds for all weapons
