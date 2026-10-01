# ADR 0001: Safe Reuse Boundaries across Optimization, Explore, and Sweet Spot Solves

## Status
Accepted / In-Progress (Refs #25)

## Context
Tarkov Weapon Mod Optimizer solves mixed-integer linear and spatial nonlinear constraint problems via HiGHS WASM in browser Web Workers. Several user-facing workflows perform multiple closely related solves:
1. **Sweet Spot**: Computes 3 extreme payoff endpoints ($z^*_E, z^*_R, z^*_P$) to establish ideal and nadir bounds, then solves an augmented Tchebycheff scalarization model. Users frequently adjust the 3 ternary weights ($w_E, w_R, w_P$) while keeping weapon, access, and constraint parameters unchanged.
2. **Explore (Pareto Frontier Sweep)**: Solves 10-15 sequential constrained optimization problems along an objective trade-off curve (e.g. AUGMECON stepping through `minErgonomics` or `maxRecoilV`).
3. **Repeated Optimization**: Interactive slider adjustments, mod locking/banning, and trader access level toggling.

Without strict mathematical reuse boundaries, optimization risks:
- Reusing certified endpoints when constraints or access rules changed, poisoning the Tchebycheff reference frame.
- Reusing a solution that is merely feasible or near-optimal under a previous objective as if it were a proven optimum for a different problem.
- Recomputing expensive invariant graph compatibility and structural bounds repeatedly across sequential curve steps.

## Decision: The 4-Tier Reuse Boundary

We define four explicit tiers of reuse with mathematical validity rules:

### Tier 1: Invariant Graph & Structural Preparation (Safe within same weapon & lookup)
- **What is reusable**: `CompatibilityMap` (BFS traversal of reachable attachments) and `computeStructuralBounds` (DAG dynamic programming for min/max weight and ergonomics).
- **Invalidation inputs**:
  - `data_fingerprint`: Language, game mode, data snapshot/cache version.
  - `weapon_id`: Weapon identity.
  - `max_weight`: Structural bounds constraint input (when specified).
- **Scope**: Reusable across *all* weights, prices, trader access, flea settings, barter settings, and objective modes for the same weapon.
- **Safety guarantee**: Reachable item topology and physical slot graphs depend purely on weapon data.

### Tier 2: Certified Sweet Spot Endpoints (Safe across preference weight changes only)
- **What is reusable**: The 3 extreme payoff vectors $(z^*, \text{nad})$ across ergonomics/TED, recoil, and purchase cost.
- **Invalidation inputs**:
  - `data_fingerprint`: Language, game mode.
  - `weapon_id`: Weapon identity.
  - `feasibility_domain`: `max_price`, `min_ergonomics`, `max_recoil_v`, `max_recoil_sum`, `min_mag_capacity`, `min_sighting_range`, `max_weight`, `max_moa`, `include_items`, `exclude_items`, `include_categories`, `exclude_categories`.
  - `market_domain`: `trader_levels`, `flea_available`, `barter_available`, `barter_exclude_dogtags`, `player_level`.
  - `physical_domain`: `equip_ergo_modifier`, `use_true_ergo`, `prevent_overswing`, `precise_mode`, `bounds_mode`.
- **Allowed variance (CAN change without invalidating endpoints)**:
  - `ergo_weight`, `recoil_weight`, `price_weight` (scalarization weights $w_E, w_R, w_P$).
- **Certification requirement**: Endpoints MUST be proven optimal (`status === 'optimal'` with certified dual bounds). Endpoints that hit a limit (`status === 'feasible'`) or fail certification MUST NEVER be cached.

### Tier 3: Explore Solution & Warm Start Boundaries
- **What is reusable**: Evaluated physical build solutions as candidate warm starts or bounding anchors.
- **Strict Prohibition**: A certified optimal solution for step $k$ (`minErgonomics >= E_k`) MUST NEVER be reported as certified optimal for step $k+1$ (`minErgonomics >= E_{k+1}`).
- **Allowed reuse**: A previously found valid build that satisfies the new constraint can be evaluated instantly as a verified *feasible point* without solving, or used to prune non-improving points.
- **Backend constraint**: HiGHS WASM integration currently lacks `Highs_setSolution` or hot-restart exports; persistent C++ model states across changing constraint rows are not exported. Model text generation is request-scoped.

### Tier 4: Repeated Solve Invalidation Key
- A canonical, deterministic hash of all constraint, market, physical, and numerical parameters is computed. If and only if the hash matches an un-invalidated entry in the worker's session cache, the proven result may be delivered immediately.

## Consequences
- Sweet Spot weight tweaks become near-instant (~0ms for endpoints) when only weights change, while strictly invalidating whenever any constraint, trader level, or part lock changes.
- Explore sweeps reuse base compatibility and structural bounds across all curve points, avoiding 10-15 redundant DAG traversals.
- No false optimality certificates can ever be transferred across different mathematical problems.
