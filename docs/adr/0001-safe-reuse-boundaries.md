# ADR 0001: Safe Reuse Boundaries across Optimization, Explore, and Sweet Spot Solves

## Status
Accepted (Refs #25). Accepted 2026-10-01.

## Acceptance
The accepted boundary is the implementation already running. It does not add a reuse tier.

- **Tier 1 stays.** Compatibility and unclipped structural bounds stay pinned to the worker's loaded data session. A request cap is applied when the LP is built, so a bound prepared under a tighter cap is not reused as a tighter cap.
- **Tier 2 stays.** A Sweet Spot endpoint may be reused only when it was certified optimal and only the preference weights change.
- **Tier 3 and Tier 4 stay deferred.** A solution or certificate is not transferred to another Explore step, and a full response is not cached.
- **No incremental candidate speedup was demonstrated.** Run `reuse-2026-10-01T18-10-24-726Z` compared candidate source `373f5e1` with baseline worker `52b2ae9` on snapshot `219443b449f732f3`. Medians were 22.6 ms to 23.3 ms on the first Sweet Spot weight, 0.8 ms to 0.8 ms on the second weight, 959.2 ms to 963.8 ms on `dense-restricted`, and 1.9 ms to 1.8 ms on `sparse-explore`. The drop from about 23 ms to 0.8 ms is the endpoint cache, and the baseline already has it. Those Sweet Spot cases enabled TrueErgo, so they were judged on the spatial contract. Later samples are not relabeled onto `45e1fcc`.

### Certificate contracts
- **Precise linear MIP.** This includes Sweet Spot when neither TrueErgo nor Prevent Overswing is enabled. The certificate is `status === 'optimal'`, `precision_resolved === 'precise'`, and `validateBuild` reporting no errors. Spatial `optimization` metadata is not required. `45e1fcc` aligns the benchmark classifier with `solveDetailed`. Its regression accepts that precise linear Sweet Spot result, and rejects the same result when validation fails or the status is not `optimal`.
- **Spatial nonlinear search.** TrueErgo or Prevent Overswing, with or without Sweet Spot, still needs a validated build, a finite `optimization` gap within tolerance, and `termination === 'optimal'`.
- **Fast mode** is not a placement certificate, including fast Sweet Spot.
- **Explore** checks that each emitted point is physically feasible against the original request. That is not a single-build optimality certificate.

### Follow-on questions
These gaps are accepted as outside this decision. They are not a reason to repeat the same runs or to widen the implementation.

- Dense Explore was not measured. One pair did not finish within 60 seconds, and five failing pairs were not collected. What is its certified curve latency for baseline `52b2ae9` and for the current solver?
- The summed worker V8 heap does not isolate ideal-point cache growth, and it does not measure a HiGHS `WebAssembly.Memory` reservation. How should those two quantities be measured if endpoint retention becomes a memory question?

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

### Tier 1: Invariant Graph & Structural Preparation (Safe within same weapon context)
- **What is reusable**: `CompatibilityMap` (BFS traversal of reachable attachments) and unclipped physical `StructuralBounds` (DAG dynamic programming for min/max weight and ergonomics).
- **Physical bound separation**: `computeStructuralBounds` caches the unclipped physical weight range $[W_{\min}^{\text{phys}}, W_{\max}^{\text{phys}}]$. Any request-scoped `max_weight` limit is applied dynamically during LP generation:
  $$W_{\max} = \min(W_{\max}^{\text{phys}}, \text{max\_weight})$$
  This guarantees that a cached bound prepared under a restrictive cap never causes false infeasibility when that cap is later removed or relaxed on the same weapon.
- **Preparation context**: Cached bounds carry `{ weaponId }` context. If the requested weapon does not match the preparation context, bounds are recomputed from scratch.
- **Lifetime**: Pinned to the worker's loaded data session. Data updates terminate and re-instantiate the Web Worker.

### Tier 2: Certified Sweet Spot Endpoints (Safe across preference weight changes only)
- **What is reusable**: The 3 extreme payoff vectors $(z^*, \text{nad})$ across ergonomics/TED, recoil, and purchase cost.
- **Consistent domain normalization**: Trader loyalty level keys are canonicalized (trimmed and lowercased) across both cache-key construction and solver execution (`dataService.ts:getAvailablePrice`). This ensures `{ Mechanic: 0 }` and `{ mechanic: 0 }` describe identical mathematical domains in both solving and caching.
- **Invalidation inputs**:
  - `data_fingerprint`: Language, game mode.
  - `weapon_id`: Weapon identity.
  - `feasibility_domain`: `max_price`, `min_ergonomics`, `max_recoil_v`, `max_recoil_sum`, `min_mag_capacity`, `min_sighting_range`, `max_weight`, `max_moa`, `include_items`, `exclude_items`, `include_categories`, `exclude_categories`.
  - `market_domain`: `trader_levels`, `flea_available`, `barter_available`, `barter_exclude_dogtags`, `player_level`.
  - `physical_domain`: `equip_ergo_modifier`, `use_true_ergo`, `prevent_overswing`, `precise_mode`, `bounds_mode`.
- **Allowed variance (CAN change without invalidating endpoints)**:
  - `ergo_weight`, `recoil_weight`, `price_weight` (scalarization weights $w_E, w_R, w_P$).
- **Certification requirement**: Endpoints MUST be proven optimal (`status === 'optimal'` with certified dual bounds). Endpoints that hit a limit (`status === 'feasible'`) or fail certification MUST NEVER be cached.

### Tier 3: Explore Solution & Warm Start Boundaries (Deferred)
- **Conditional optimality rule**: With an unchanged objective function, if a build $x^*$ was proven globally optimal over a feasible domain $D$, and $x^*$ remains feasible under a restricted domain $D' \subseteq D$ ($x^* \in D'$), then $x^*$ is mathematically guaranteed to be optimal for $D'$. This derives a valid proof from subset optimality without resolving.
- **Non-transferability**: If the objective changes, or if the domain expands ($D \subset D'$), or if the previous optimum is infeasible ($x^* \notin D'$), a certificate cannot be transferred.
- **Status**: Deferred. HiGHS WASM integration currently lacks `Highs_setSolution` or hot-restart exports; persistent C++ model states across changing constraint rows are not exported. Candidate point evaluation is evaluated for feasibility only, not certificate copying.

### Tier 4: Repeated Solve Invalidation Key (Deferred)
- A canonical, deterministic hash of all constraint, market, physical, and numerical parameters is computed via `computeExactSolveCacheKey`.
- **Status**: Deferred. Full-response caching is not enabled in production. When implemented, certified optimal results and limit/feasible results require separate eligibility rules: a cached limit response must never be returned if a subsequent request allows a larger time budget.

## Summary of Invalidation Boundaries

| Tier | Reusable Artifact | Invalidation Domain | Allowed Invariant Domain | Certification Safety Guarantee |
|---|---|---|---|---|
| **Tier 1** | `CompatibilityMap`, unclipped `StructuralBounds` | Data snapshot/lang/mode, `weapon_id` | All preference weights, prices, trader levels, flea/barter, locks/bans, `max_weight`, objective modes | Physical graph topology is weapon-invariant. Request limits applied dynamically to unclipped bounds. |
| **Tier 2** | Sweet Spot Endpoints $(z^*, \text{nad})$ | Data snapshot, `weapon_id`, feasibility domain, market domain, physical domain | Preference weights ($w_E, w_R, w_P$) | Endpoints depend strictly on extreme single-objective optima. Normalization prevents case collisions. |
| **Tier 3** | Explore Solution Reuse | Deferred | Deferred | Subset optimality rule defined; implementation deferred. |
| **Tier 4** | Full Response Caching | Deferred | Deferred | Canonical key defined; full-response caching deferred. |
