# ADR 0012: Prepared-Model Ownership and Invalidation Boundaries

## Status
Proposed (Refs #38). Canonical Resolution 2026-10-03.

## Context
Auditing of `solver.ts`, `lpBuilder.ts`, and `structuralBounds.ts` revealed two architectural bottlenecks:
1. **Unused LP Serialization**: In `solveDetailed`, an entire thousands-of-lines CPLEX LP string was serialized solely to read `initLp.weightBounds`, only to be discarded immediately before entering spatial branch-and-bound.
2. **Repeated Model Assembly**: Across the 6 ideal-point endpoint solves and dozens of spatial interval nodes within a single request, `buildLP` repeatedly re-parsed compatibility maps, conflicts, preset inventories, and availability rules, even though >95% of the constraint text is identical.
3. **Stale Cache Vulnerability**: Overly broad caching based only on weapon ID caused ideal-point endpoints to leak across changing trader levels or user exclusions.

## Decision

We establish four core principles governing model preparation, direct outer bounds, invalidation ledgers, and strictly bounded memory lifecycles:

1. **Tier 1: Snapshot / Weapon Physical Blueprint & Direct Outer Bounds**:
   - Tier 1 prepares immutable physical geometry depending strictly on `(snapshot_sha, weapon_id)`: unpruned physical graph, static component attributes (mass, raw ergo, recoil mods, barrel COI), slot-occupancy conflicts (`conflicting_slot_ids`), and containing preset inventories ($q_{b,i}$).
   - **Direct Outer Bounds Without LP Serialization**: Spatial search initialization (`solveDetailed`) and preparation pipelines must call `computeStructuralBounds(weaponId, itemLookup, compatibilityMap)` directly. Serializing an unused full LP string solely to read `weightBounds` is strictly prohibited. Evaluates $[W_{\text{phys\_min}}, W_{\text{phys\_max}}]$ and $[E_{\text{phys\_min}}, E_{\text{phys\_max}}]$ directly via dynamic programming in $< 1\text{ ms}$.
2. **Tier 2: Request-Scoped Acquisition Preparation & Invalidation Ledger**:
   - Tier 2 applies caller request settings to Tier 1's physical blueprint. Constructed once per user request and reused across all internal solves (6 ideal-point endpoints and all spatial B&B nodes).
   - Pre-compiles: standalone market accessibility, stash inventory projection $N_{\text{owned}}(i)$ and hard inventory caps, user inclusions/exclusions, fixed-point orphan deactivations, purchase variable reductions ($buy_i \equiv x_i$ vs integer vs eliminated), request-clipped physical bounds $[W_{\min}, \min(W_{\max}, \text{req.max\_weight})]$, and static constraint rows.
   - **Comprehensive Invalidation Ledger**: Tier 2 is completely invalidated and cannot be reused if any of the following change: `snapshot_sha`, `weapon_id`, `trader_levels`, `flea_available`, `barter_available`, `player_level`, `owned_items`, `include_items`, `exclude_items`, categories, hard physical caps (`max_price`, `max_weight`, `max_recoil_v`, `max_recoil_sum`, `min_ergo`, `max_moa`, `prevent_overswing`, `equip_ergo_modifier`), or `precise_mode`. Reusing filtered structures under a weapon-only key is strictly forbidden.
3. **Tier 3: Objective & Spatial Interval Specialization**:
   - Only three lightweight components vary between individual node solves: objective function line, spatial node weight bounds ($W_1 \le \text{total\_weight} \le W_2$), and interval-local outward secant rows ($s_{\text{outward}}(W) = \tilde{s}(W) - \Delta_{\text{secant\_node}}$).
   - The solver specializes the pre-compiled Tier 2 constraint body by appending Tier 3 lines, assembling the final LP string in $< 0.5\text{ ms}$ per node, completely eliminating repeated compatibility graph and conflict parsing.
4. **Ownership, Lifetime & Memory Lifecycle (Zero New Cache Tiers)**:
   - **Tier 1 (Session-Scoped)**: Owned by Web Worker session data service (`stateCache`), invalidated only on language or game mode reload.
   - **Tier 2 (Strictly Request-Scoped)**: Owned by active request execution context (`solveDetailed`, `explorePoint`, `computeMOAFloor`). Lives only for the duration of the current public request on the call stack; discarded immediately upon request completion. Zero new cache tiers (never persisted to IndexedDB, LocalStorage, or global multi-request maps).
   - **Tier 3 (Ephemeral)**: Lives only for the duration of a single `highs.solve` call.
   - Standing ADR 0001 endpoint reuse preserved under full canonical request identity (ADR 0005).

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Unblocked to formulate the complete implementation sequence and verification gates (now that #38 and #39 are resolved).
