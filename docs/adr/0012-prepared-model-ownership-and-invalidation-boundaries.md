# ADR 0012: Prepared-Model Ownership and Invalidation Boundaries

## Status
Accepted (Refs #38). 2026-10-04.

## Context
Auditing of `solver.ts`, `lpBuilder.ts`, and `structuralBounds.ts` revealed two architectural bottlenecks:
1. **Unused LP Serialization**: In `solveDetailed`, an entire thousands-of-lines CPLEX LP string was serialized solely to read `initLp.weightBounds`, only to be discarded immediately before entering spatial branch-and-bound.
2. **Repeated Model Assembly**: Across the 3 ideal-point payoff solves and dozens of spatial interval nodes within a single request, `buildLP` repeatedly re-parsed compatibility maps, conflicts, preset inventories, and availability rules, even though >95% of the constraint text is identical.
3. **Stale Cache Vulnerability**: Overly broad caching based only on weapon ID caused ideal-point endpoints to leak across changing trader levels or user exclusions.

## Decision

We establish five core principles governing model preparation, direct outer bounds, invalidation ledgers, and strictly bounded memory lifecycles:

1. **Concrete Interface Contracts & Preparation Invariants**:
   - **`preparePhysicalWeapon(weaponId, lookup, dataGenerationId, snapshotSha): PhysicalWeaponBlueprint` (Tier 1)**:
     Owned by Web Worker session data service (`stateCache`), pinned to `(dataGenerationId, weaponId)`. Prepares immutable physical geometry: normalized sparse adjacency with occurrence/edge identity `(parentInstanceId, templateSlotId, childItemId)`, branch acyclicity ($A \notin \text{Ancestors}(s)$), dense index map for occurrence variables $p_{i,s}$, unclipped physical bounds $[W_{\text{phys\_min}}, W_{\text{phys\_max}}]$ and raw $[E_{\text{raw\_min}}, E_{\text{raw\_max}}]$, and unfiltered preset catalog ($q_{b,i}$).
   - **`prepareSubproblemDomain(blueprint, params): PreparedSubproblemDomain` (Tier 2)**:
     Owned by the active execution context on the call stack. Pre-compiles market availability, stash stock, user bans/includes, fixed-point orphan deactivations (preserving alternative parents), exact deficit purchase plan under ADR 0009, request-clipped bounds, and static constraint body.
   - **`specializeLP(domain, options): SpecializedLP` (Tier 3)**:
     Specializes Tier 2 by appending node-specific lines: normalized objective function line, Tchebycheff active deviation rows, spatial node weight bounds ($W_1 \le \text{total\_weight} \le W_2$), interval-local outward lower secant rows ($s_{\text{outward}}(W) = \tilde{s}(W) - \Delta_{\text{secant\_node}}$), and `total_obj` line-length parser seam. Assembles final LP string in target $< 0.5\text{ ms}$.
2. **Preservation of Three-Solve Payoff-Table Normalization (ADR 0001)**:
   - In accordance with ADR 0001 and `solver.ts:170–187`, the solver evaluates ideal points using **three extreme payoff solves** (`weights: [100, 0, 0]`, `[0, 100, 0]`, `[0, 0, 100]`), deriving all six $(z, nad)$ coordinates from the resulting payoff vectors.
   - Normalized single-axis endpoint objectives evaluate single axes matching weights `[100, 0, 0]`, `[0, 100, 0]`, `[0, 0, 100]`: $+10 \cdot fE$, $-100 \cdot fR$, $-0.1 \cdot fP$.
3. **Raw Physical Bounds vs. Request-Scoped Clamping & Qualified Infeasibility**:
   - Tier 1 stores request-independent raw ergonomics bounds: `rawErgoBounds = [minRaw, maxRaw]`. Direct physical outer bounds are computed via `computeStructuralBounds(weaponId, lookup, physicalGraph)` from unpruned physical input (engineering target $< 1\text{ ms}$).
   - In Tier 2, effective ergonomics bounds evaluate the normative two-stage clamp:
     $$\text{effectiveErgo}(raw) = \min\left(100, \max\left(0, \min(100, \max(0, \text{rawErgo})) \times factor\right)\right)$$
   - Empty clipped interval ($W_{\text{phys\_min}} > \text{req.max\_weight}$): Precise Mode $\implies$ certified `status: 'infeasible'`, `physical_certificate: 'certified_infeasible'`; Fast Mode $\implies$ `status: 'incomplete'`, `reason: 'Fast model infeasible'`, `physical_certificate: 'none'`; MOA-dependent $\implies$ `status: 'incomplete'`, `reason: 'Provisional MOA model infeasible'`.
4. **Invalidation Ledgers & Endpoint Reuse Qualification**:
   - **Tier 2 Invalidation Ledger**: Tier 2 is completely invalidated if any of the following 24 parameters change:
     `data_generation_id`, `snapshot_sha`, `weapon_id`, `trader_levels`, `flea_available`, `barter_available`, `barter_exclude_dogtags`, `player_level`, `owned_items` (full validated multiset), `include_items`, `exclude_items`, `include_categories`, `exclude_categories`, `max_price`, `max_weight`, `max_recoil_v`, `max_recoil_sum`, `min_ergonomics`, `min_mag_capacity`, `min_sighting_range`, `max_moa`, `prevent_overswing`, `equip_ergo_modifier`, `use_true_ergo`, `bounds_mode`, `precise_mode`.
   - **`endpointDomainKey`**: A separate canonical projection hash that excludes preference weights ($e, r, p$) while strictly retaining all parameters in the Invalidation Ledger.
   - **Certificate Eligibility & Tightened Tolerance**: Only certified precise proofs (`physical_certificate: 'certified_optimal'`) can be cached. Cached endpoints require a tightened-tolerance check (re-solving if $\tau_{\text{req}} < \tau_{\text{cached}}$). Fast or limit incumbents are strictly excluded.
5. **Memory Lifecycle & Reference Release (Zero New Cache Tiers)**:
   - Tier 1: Session-scoped in worker `stateCache`.
   - Tier 2: Subproblem-scoped on call stack. Stored in memory only during the active subproblem; references are explicitly cleared upon subproblem completion, cancellation, or error.
   - Tier 3: Ephemeral per-solve. Retained until decoding, validation, and certificate extraction complete, then released.
   - Zero new persistent cache tiers (no IndexedDB, no LocalStorage, no multi-request global maps).

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Unblocked to formulate the complete implementation sequence and verification gates (now that both #38 and #39 are resolved).
