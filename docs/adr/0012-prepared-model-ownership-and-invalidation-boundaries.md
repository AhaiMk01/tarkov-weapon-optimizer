# ADR 0012: Prepared-Model Ownership and Invalidation Boundaries

## Status
Proposed (Refs #38). Canonical Resolution v2 2026-10-04.

## Context
Auditing of `solver.ts`, `lpBuilder.ts`, and `structuralBounds.ts` revealed two architectural bottlenecks:
1. **Unused LP Serialization**: In `solveDetailed`, an entire thousands-of-lines CPLEX LP string was serialized solely to read `initLp.weightBounds`, only to be discarded immediately before entering spatial branch-and-bound.
2. **Repeated Model Assembly**: Across the 6 ideal-point endpoint solves and dozens of spatial interval nodes within a single request, `buildLP` repeatedly re-parsed compatibility maps, conflicts, preset inventories, and availability rules, even though >95% of the constraint text is identical.
3. **Stale Cache Vulnerability**: Overly broad caching based only on weapon ID caused ideal-point endpoints to leak across changing trader levels or user exclusions.

## Decision

We establish five core principles governing model preparation, direct outer bounds, invalidation ledgers, and strictly bounded memory lifecycles:

1. **Tier 1: Snapshot / Weapon Physical Blueprint & Direct Outer Bounds**:
   - Tier 1 prepares immutable physical geometry depending strictly on loaded data generation and weapon identity `(data_generation_id, snapshot_sha, weapon_id)`: unpruned physical graph, static component attributes (mass, raw ergo, recoil mods, barrel replacement COI), slot-occupancy conflicts (`conflicting_slot_ids`), and unfiltered containing preset inventories ($q_{b,i}$) kept strictly separate from accessible offers.
   - **Direct Outer Bounds Without LP Serialization**: Spatial search initialization (`solveDetailed`) and preparation pipelines must call `computeStructuralBounds(weaponId, itemLookup, physicalGraph)` directly on unpruned, identity-matched physical input. Serializing an unused full LP string solely to read `weightBounds` is **strictly prohibited**. Evaluates $[W_{\text{phys\_min}}, W_{\text{phys\_max}}]$ and $[E_{\text{phys\_min}}, E_{\text{phys\_max}}]$ directly via dynamic programming (engineering target $< 1\text{ ms}$).
   - **Two-Stage Ergonomics Clamping Invariant**: Outer ergonomics bounds evaluate normative two-stage clamping: $\text{effectiveErgo} = \min(100, \max(0, \min(100, \max(0, \text{rawErgo})) \times factor))$. Direct multiplication of unclipped raw extrema by $factor$ is strictly prohibited.
   - **Session Lifetime**: Pinned to an immutable loaded lookup identity (`data_generation_id`). A data reload or changed lookup strictly invalidates all physical graphs and endpoints, even if language or game mode strings remain unchanged.
2. **Tier 2: Subproblem-Domain Preparation & Complete Invalidation Ledger**:
   - Scope: Prepared per distinct subproblem domain (identical constraints, filters, and market access).
     - In `solveDetailed`: The 6 ideal-point endpoints and all spatial B&B nodes share the exact same subproblem domain.
     - In `computeMOAFloor`: Each bisection trial that alters `max_moa` constitutes a distinct subproblem domain.
     - In `explore`: Each sweep point with different constraints constitutes a distinct subproblem domain.
     - Ideal-point endpoints retain all original feasibility constraints (budget, weight, recoil, MOA, required slots).
   - Pre-compiles:
     - Standalone market accessibility (`trader_levels`, `flea_available`, `barter_available`, `barter_exclude_dogtags`, `player_level`).
     - Stash inventory projection $N_{\text{owned}}(i)$ and hard inventory caps on unpurchasable items ($\sum_s p_{i,s} \le \text{preset} + N_{\text{owned}}$).
     - User inclusions/exclusions (`include_items`, `exclude_items`, `include_categories`, `exclude_categories`).
     - Fixed-point orphan deactivations: deactivating unreachable/banned owner occurrences without globally deleting child templates that remain reachable through alternative legal parents.
     - Purchase variable reductions under ADR 0009: $buy_i \equiv x_i$ substitution only when physical installed capacity $\le 1$ under instance unrolling, non-preset, unowned. Fully-owned items ($N_{\text{owned}} \ge \text{max\_installed}$) have $u_i$ eliminated in presolve. Hard inventory caps are never deleted for standalone-inaccessible items, even if stored price is ₽0.
     - Hard physical constraints: `max_price`, `max_weight`, `max_recoil_v`, `max_recoil_sum`, `min_ergonomics`, `min_mag_capacity`, `min_sighting_range`, `max_moa`, `prevent_overswing`, `equip_ergo_modifier`, `use_true_ergo`, `bounds_mode`, `precise_mode`.
     - Request-clipped bounds: $[W_{\min}, \min(W_{\max}, \text{req.max\_weight})]$ (with honest empty-interval handling if $W_{\min} > \text{req.max\_weight} \implies$ certified infeasible).
     - Pre-compiled constraint body.
   - **Comprehensive Invalidation Ledger**: Tier 2 is completely invalidated and cannot be reused across subproblems if ANY of the following change:
     `data_generation_id`, `snapshot_sha`, `weapon_id`, `trader_levels`, `flea_available`, `barter_available`, `barter_exclude_dogtags`, `player_level`, `owned_items` (full multiset), `include_items`, `exclude_items`, `include_categories`, `exclude_categories`, `max_price`, `max_weight`, `max_recoil_v`, `max_recoil_sum`, `min_ergonomics`, `min_mag_capacity`, `min_sighting_range`, `max_moa`, `prevent_overswing`, `equip_ergo_modifier`, `use_true_ergo`, `bounds_mode`, `precise_mode`.
3. **Tier 3: Objective & Spatial Interval Specialization**:
   - Specializes the pre-compiled Tier 2 constraint body by appending node-specific lines:
     - Normalized ideal endpoint objectives: $+1 \cdot fE$, $-1 \cdot fR$, $-1 \cdot fP$ (avoiding double-scaling).
     - Weighted sum: $(e/10) fE - r \cdot fR - (p/1000) fP$.
     - Augmented Tchebycheff: $0.01 (c_e fE - c_r fR - c_p fP) - tch\_t$ with active deviation rows.
     - Hard spatial node weight bounds: $W_1 \le \text{total\_weight} \le W_2$.
     - Interval-local outward secant rows: $s_{\text{outward}}(W) = \tilde{s}(W) - \Delta_{\text{secant\_node}}$.
     - `total_obj` auxiliary variable and defining row retained for HiGHS parser line length limits.
   - Assembles the final LP string in target $< 0.5\text{ ms}$ per node, completely eliminating repeated compatibility graph and conflict parsing.
4. **Endpoint Domain Identity for Preference-Only Reuse (ADR 0001)**:
   - Full canonical request identity (`canonicalRequestHash`) includes preference weights ($e, r, p$) for telemetry and comparative benchmarks (ADR 0005).
   - **Endpoint Domain Projection Key (`endpointDomainKey`)**: A separate canonical projection hash that **excludes preference weights ($e, r, p$)** while strictly retaining all dependencies in the Invalidation Ledger.
   - **Certificate Eligibility**: Only qualified precise proofs (`model_qualification: 'exact'`, `physical_certificate: 'certified_optimal'`) can be cached as certified endpoints. Fast approximate proofs or limit incumbents can never become certified cached endpoints.
   - Cache hits retain original qualified proof/witness provenance; a cache hit cannot manufacture a new proof under a changed domain or upgrade provisional MOA authority.
5. **Ownership, Memory Lifecycle & Zero New Cache Tiers**:
   - Tier 1: Session-scoped in worker `stateCache`.
   - Tier 2: Subproblem-scoped on call stack. Stored in memory only during the active subproblem; references are explicitly cleared upon subproblem completion, cancellation, or error.
   - Tier 3: Ephemeral per-solve.
   - Zero new cache tiers (no IndexedDB, no LocalStorage, no multi-request global maps). Stale filter aliasing across requests is eliminated by reference release.

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Unblocked to formulate the complete implementation sequence and verification gates (now that both #38 and #39 are resolved).
