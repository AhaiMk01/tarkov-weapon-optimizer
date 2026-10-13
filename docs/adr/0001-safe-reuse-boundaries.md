# ADR 0001: Safe Reuse Boundaries across Optimization, Explore, and Sweet Spot Solves

## Status
Accepted reuse permission (Refs #25), reconciled with the accepted planning contracts in #35, #36, #38, #41 and #42. Reconciled 2026-10-04; this does not claim the later correctness cutover is implemented.

## Acceptance
The authorized session-physical and certified-endpoint reuse tiers remain accepted. Later proof and ownership decisions tighten eligibility without adding or removing a reuse tier.

- **Tier 1 stays.** Session preparation must retain identity-matched, unpruned occurrence geometry and unclipped physical bounds; request caps belong to domain preparation. The preserved implementation's request-clipped structural-bounds key/output is a planned repair, not evidence that this separation already ships.
- **Tier 2 stays.** A Sweet Spot endpoint may be reused only with a qualified precise physical-optimality certificate under the current proof frame, and only the authorized preference weights may change.
- **Tier 3 and Tier 4 stay deferred.** A solution or certificate is not transferred to another Explore step, and a full response is not cached.
- **Historical measurement, not current proof.** Run `reuse-2026-10-01T18-10-24-726Z` compared candidate source `373f5e1` with baseline worker `52b2ae9` on snapshot `219443b449f732f3`. Medians were 22.6 ms to 23.3 ms on the first Sweet Spot weight, 0.8 ms to 0.8 ms on the second weight, 959.2 ms to 963.8 ms on `dense-restricted`, and 1.9 ms to 1.8 ms on `sparse-explore`. The drop from about 23 ms to 0.8 ms is the endpoint cache, and the baseline already had it. Those Sweet Spot cases enabled TrueErgo and used the then-current spatial classifier. No incremental candidate speedup was demonstrated; these samples are not relabeled onto `45e1fcc` or upgraded to the later certificate contract.

### Certificate contracts
- **Precise linear MIP and spatial nonlinear search.** Both require a validated witness, `status: 'optimal'`, `precision_resolved: 'precise'`, `physical_certificate: 'certified_optimal'`, `optimization.termination: 'optimal'`, and justified native/global bounds with a finite gap within the declared tolerance. The linear path must emit native-bound metadata too; status text and validation alone are not proof. Numerical/parser/native prerequisites and the #36 domain/objective lifting/projection proof remain mandatory. The historical `45e1fcc` classifier's exemption from `optimization` metadata is superseded by #35 and the corrected #40 handoff.
- **Fast and provisional-MOA optima** may be qualified `approximate_optimal`, never certified endpoint cache entries. Limited, merely feasible, withheld-proof and rejected-decode results are also ineligible. Removing the preserved worker's status-only caching of Fast/MOA-dependent endpoints is intentional, not removal of Tier 2 permission.
- **Explore** checks every published point against its original request, and certified infeasibility requires the precise authoritative-domain proof. Curve completion is discrete scheduled coverage, not a continuous frontier or endpoint-optimality certificate.

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
- **What is reusable**: The identity-matched unpruned physical occurrence graph and its unclipped physical weight/raw-ergo outer bounds, after the adopted graph, quantity and numerical requirements are proved. A legacy template-BFS output is not made certified by its helper name.
- **Physical bound separation**: The session blueprint retains $[W_{\min}^{\text{phys}}, W_{\max}^{\text{phys}}]$; domain preparation applies a request-scoped cap:
  $$W_{\max}^{\text{domain}} = \min(W_{\max}^{\text{phys}}, \text{max\_weight})$$
  Never expand an impossible cap back to the physical minimum. Empty clipped intervals establish infeasibility only with proved outward-safe bounds and applicable precision/MOA fences.
- **Preparation context**: Loaded generation/immutable lookup identity, snapshot, weapon, preparation/formulation/bound-method and normalization/authority versions, plus unclipped provenance. A weapon-only key or matching caller strings do not authorize reuse.
- **Lifetime**: Owned by the worker's loaded-data session. Reload/replacement, changed lookup, worker replacement or `clearCache` invalidates physical preparation and endpoint entries even when language/game-mode strings are unchanged.

### Tier 2: Certified Sweet Spot Endpoints (Safe across preference weight changes only)
- **What is reusable**: The 3 extreme payoff vectors $(z^*, \text{nad})$ across ergonomics/TED, recoil, and purchase cost.
- **Consistent domain normalization**: Trader loyalty level keys are canonicalized (trimmed and lowercased) across both cache-key construction and solver execution (`dataService.ts:getAvailablePrice`). This ensures `{ Mechanic: 0 }` and `{ mechanic: 0 }` describe identical mathematical domains in both solving and caching.
- **Invalidation inputs**:
  - `data_fingerprint`: Loaded generation/immutable lookup identity, snapshot, language, game mode and preparation/formulation/normalization/model-authority/schema versions.
  - `weapon_id`: Weapon identity.
  - `feasibility_domain`: `max_price`, `min_ergonomics`, `max_recoil_v`, `max_recoil_sum`, `min_mag_capacity`, `min_sighting_range`, `max_weight`, `max_moa`, `include_items`, `exclude_items`, `include_categories`, `exclude_categories`.
  - `market_domain`: `trader_levels`, `flea_available`, `barter_available`, `barter_exclude_dogtags`, `player_level`, legal base/offer data and the full validated canonical `owned_items` multiset.
  - `physical_and_proof_domain`: `equip_ergo_modifier`, `use_true_ergo`, `prevent_overswing`, requested/resolved precision, `bounds_mode`, axis/reference meaning, resolved duration/node/numerical controls and certificate tolerance. The endpoint key is a versioned projection, not the full telemetry hash. Transient request IDs and absolute epoch deadlines are excluded from this identity; the current deadline/cancellation remain runtime guards.
- **Allowed variance (CAN change without invalidating endpoints)**:
  - `ergo_weight`, `recoil_weight`, `price_weight` (scalarization weights $w_E, w_R, w_P$).
- **Certification requirement**: Only qualified precise `certified_optimal` endpoint proofs may enter the cache. Preserve the instance witness, validation, native/global bounds, gap, authority provenance and endpoint objective scale/tolerance. Retain the three existing payoff objectives with weights `[100,0,0]`, `[0,100,0]`, `[0,0,100]`, whose frames are respectively `10*fE`, `-100*fR`, `-0.1*fP`; derive all ideal/nadir coordinates from those three payoff vectors. A retained proof must satisfy the current frame and conservative tolerance eligibility; otherwise solve again. Cache hits cannot promote provisional MOA authority or permit changed non-preference controls.

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
| **Tier 1** | Proved physical occurrence blueprint and unclipped outer bounds | Loaded generation/lookup identity, snapshot/lang/mode, weapon and preparation/formulation/bound/normalization/authority versions | Preference, acquisition, filter, cap and objective changes do not mutate physical preparation | Domain preparation applies request limits separately; adopted physical coverage and outward-safe bounds remain proof prerequisites. |
| **Tier 2** | Certified Sweet Spot payoff endpoints $(z^*, \text{nad})$ | Full normalized domain, owned multiset, loaded context, axis/reference/objective and proof-control frame | Authorized preference weights only | Qualified precise physical-optimal proofs with retained witness, native/global gap, scale/tolerance and authority provenance; no Fast/provisional/limit cache eligibility. |
| **Tier 3** | Explore Solution Reuse | Deferred | Deferred | Subset optimality rule defined; implementation deferred. |
| **Tier 4** | Full Response Caching | Deferred | Deferred | Canonical key defined; full-response caching deferred. |

## Canonical Sources and Reconciliation Scope

- [Certificate/status/deadline contract #35](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/35#issuecomment-5957714022), [independent equivalence/proof contract #36](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36#issuecomment-5974832944) and [preparation/endpoint ownership #38](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38#issuecomment-5976600879) control current eligibility; [MOA authority #41](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/41#issuecomment-5966142296) and [inventory #42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42#issuecomment-5971674033) control qualification and input identity.
- The [post-acceptance review](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5977261158) identifies the status-only cache and clipped-bound defects in preserved baseline `backup/pre-revert-2.13` @ `a4ab2a5fd189c9451304087641a584d90fc249eb`. Those are planned repairs in the single correctness cutover, not new reuse tiers or completed native/parser proof. No new measurement was performed for this reconciliation.
