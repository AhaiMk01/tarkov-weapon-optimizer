# MiniZinc + Chuffed Solver Prototype

## Goal

Establish ground truth for solver correctness by running the same weapon optimization problem through three solvers and comparing results:

1. **CP-SAT** (Python, OR-Tools) — trusted reference implementation
2. **MiniZinc + Chuffed** (WASM via `minizinc` npm package) — new candidate
3. **Z3** (current frontend solver) — unknown correctness

If CP-SAT and Chuffed agree but Z3 disagrees, Z3's model has bugs. If all three agree, Z3 is fine and Chuffed becomes a validated alternative. If all three disagree, there are model translation bugs to fix.

## Approach

### Step 1: Get CP-SAT baselines

Extend `test_compare.py` to cover both AK-74 and M4A1 with these weight profiles:
- Ergo-only: `(ergo=1, recoil=0, price=0)`
- Recoil-only: `(ergo=0, recoil=1, price=0)`
- Balanced: `(ergo=1, recoil=1, price=0)`

Capture for each: status, selected item IDs (sorted), final ergonomics, final vertical recoil, total price.

### Step 2: Build MiniZinc prototype

Create `frontend/test_minizinc.ts` that:

1. **Loads data** — fetch from Tarkov.dev API, build `ItemLookup` and `CompatibilityMap` using existing `dataService.ts` and `compatibilityMap.ts`
2. **Generates a MiniZinc model** as a string, mirroring the CP-SAT model:
   - Decision variables: `array[1..N] of var 0..1: x` (item selected), `array[1..B] of var 0..1: base` (base/preset selected)
   - Constraint: exactly one base selected
   - Constraint: slot mutex (at most 1 item per slot)
   - Constraint: connectivity (item selected => at least one parent selected)
   - Constraint: conflicts (conflicting items can't both be selected)
   - Constraint: required slots (if owner selected, required slot must have an item)
   - Objective: `maximize ergo_weight * capped_ergo + (-recoil_weight * total_recoil_mod) + (-price_weight * total_price)`
   - Integer scaling matching CP-SAT: SCALE=1000, ERGO_SCALE=10
   - Ergo capping at 0-100
3. **Passes data** via `Model.addJson()` — item stats, slot relationships, conflicts as JSON arrays
4. **Solves** with `{ solver: 'chuffed' }` 
5. **Decodes** solution: which items selected, computed stats
6. **Prints** results in same format as `test_compare.py` for easy visual comparison

### Step 3: Run Z3 with same profiles

Already possible via `test_recoil_maximizer.ts` pattern — just add the same weight profiles.

### Step 4: Compare

Side-by-side comparison of all three solvers' outputs for each test case.

## MiniZinc Model Design

The model must be **structurally identical** to CP-SAT to ensure a fair comparison. Key design:

```minizinc
% Parameters (passed via JSON data)
int: n_items;                          % number of reachable items
int: n_slots;                          % number of slots
int: n_bases;                          % number of base options (naked + presets)
int: weapon_naked_ergo;                % scaled by ERGO_SCALE=10
int: weapon_naked_recoil_v;
int: weapon_naked_recoil_h;

array[1..n_items] of int: item_ergo;         % scaled by ERGO_SCALE
array[1..n_items] of int: item_recoil;       % scaled by SCALE=1000
array[1..n_items] of int: item_price;
array[1..n_bases] of int: base_price;

% Slot data: which items can go in which slot
int: n_slot_entries;
array[1..n_slot_entries] of 1..n_slots: slot_entry_slot;
array[1..n_slot_entries] of 1..n_items: slot_entry_item;

% Conflict pairs
int: n_conflicts;
array[1..n_conflicts] of 1..n_items: conflict_a;
array[1..n_conflicts] of 1..n_items: conflict_b;

% Slot ownership: which item owns which slot
array[1..n_slots] of 0..n_items: slot_owner_idx;  % 0 = weapon root

% Required slots
set of int: required_slots;

% Objective weights (integers)
int: ergo_weight;
int: recoil_weight;
int: price_weight;

% Decision variables
array[1..n_items] of var 0..1: x;
array[1..n_bases] of var 0..1: base;

% C1: Exactly one base
constraint sum(base) = 1;

% C2: Slot mutex — at most one item per slot
constraint forall(s in 1..n_slots)(
  sum(e in 1..n_slot_entries where slot_entry_slot[e] = s)(x[slot_entry_item[e]]) <= 1
);

% C3: Connectivity — if item selected, at least one parent must be selected
% (items whose only slot owner is weapon root are always connectable)

% C4: Conflicts
constraint forall(c in 1..n_conflicts)(
  x[conflict_a[c]] + x[conflict_b[c]] <= 1
);

% C5: Required slots — if owner selected, slot must have an item

% Stats
var int: total_ergo_scaled = weapon_naked_ergo + sum(i in 1..n_items)(item_ergo[i] * x[i]);
var int: total_recoil = sum(i in 1..n_items)(item_recoil[i] * x[i]);
var int: total_price = sum(b in 1..n_bases)(base_price[b] * base[b]) 
                     + sum(i in 1..n_items)(item_price[i] * x[i]);

% Ergo capping (game caps at 0-100, scaled by ERGO_SCALE)
var int: capped_ergo = max(0, min(1000, total_ergo_scaled));  % 100 * ERGO_SCALE=10

% Objective (all integer)
solve maximize ergo_weight * capped_ergo + (-recoil_weight) * total_recoil + (-price_weight) * total_price;
```

## Data Flow

```
Tarkov.dev API → dataService.ts → ItemLookup + CompatibilityMap
                                        ↓
                              MiniZinc data generator
                              (maps item IDs → integer indices,
                               builds slot/conflict/ownership arrays)
                                        ↓
                              Model.addFile('weapon.mzn', modelString)
                              Model.addJson(dataObject)
                                        ↓
                              Model.solve({ solver: 'chuffed' })
                                        ↓
                              Parse solution.output.json → x[], base[]
                              Map indices back to item IDs
                              Compute final stats
```

## Test Cases

| Weapon | Ergo Weight | Recoil Weight | Price Weight | Label |
|--------|-------------|---------------|--------------|-------|
| AK-74  | 1           | 0             | 0            | Ergo only |
| AK-74  | 0           | 1             | 0            | Recoil only |
| AK-74  | 1           | 1             | 0            | Balanced |
| M4A1   | 1           | 0             | 0            | Ergo only |
| M4A1   | 0           | 1             | 0            | Recoil only |
| M4A1   | 1           | 1             | 0            | Balanced |

## Files to Create/Modify

- `frontend/test_minizinc.ts` — MiniZinc + Chuffed prototype test (new)
- `test_compare.py` — add M4A1 test cases (modify)
- `frontend/test_recoil_maximizer.ts` — add matching weight profiles for Z3 comparison (modify)

## Success Criteria

- MiniZinc+Chuffed produces `optimal` status for all 6 test cases
- Results can be compared side-by-side with CP-SAT output
- Solve times are under 30 seconds per weapon
