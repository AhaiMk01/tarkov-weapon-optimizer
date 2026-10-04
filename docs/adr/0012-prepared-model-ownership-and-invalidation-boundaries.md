# ADR 0012: Prepared-Model Ownership and Invalidation Boundaries

## Status
Accepted planning decision (Refs #38). Reconciled 2026-10-04; preparation interfaces and proof/performance evidence are implementation targets, not completed repairs.

## Context
The planning review identified these preparation/reuse concerns in the preserved source:
1. **Unused LP Serialization**: In `solveDetailed`, an entire thousands-of-lines CPLEX LP string was serialized solely to read `initLp.weightBounds`, only to be discarded immediately before entering spatial branch-and-bound.
2. **Repeated Model Assembly**: Ideal payoff solves and spatial nodes repeatedly prepare domain information. Sharing identical normalized subproblem preparation is adopted, but no universal proportion of invariant text or measured speedup is established here.
3. **Stale Reuse Risk**: Weapon identity alone cannot authorize endpoint or prepared-domain reuse across changed request, loaded context or proof dependencies; complete invalidation is required.

## Decision

We establish five core principles governing model preparation, direct outer bounds, invalidation ledgers, and strictly bounded memory lifecycles:

1. **Concrete Interface Contracts & Preparation Invariants**:
   - **`preparePhysicalWeapon(weaponId, lookup, dataGenerationId, snapshotSha): PhysicalWeaponBlueprint` (Tier 1)**:
     Owned by the existing worker/session data owner, with immutable loaded lookup identity, generation, snapshot, weapon, preparation/formulation/normalization/bound-method and model-authority provenance. Returns physical geometry/attributes/conflicts, full parent-path occurrence identities and stable sparse occurrence/edge indexes, unclipped physical weight/raw-ergo ranges and unfiltered integer preset catalog. Matching caller strings cannot substitute for actual immutable lookup/context identity.
   - **`prepareSubproblemDomain(blueprint, params): PreparedSubproblemDomain` (Tier 2)**:
     Owned by active execution. Takes an identity-matched blueprint and normalized validated request snapshot; returns resolved precision/axis semantics, legal bases/offers, full stock, active occurrence/edge masks, clipped/effective ranges, invariant rows and purchase/proof/decoder metadata. Masks use stable blueprint indexes, never destructive compaction. Normalize/deduplicate only identical physical edges before indexing; preserve siblings and alternative parent paths. Fixed-point pruning removes only banned, unreachable or proved impossible owners, not optional undecided parents. Ancestor-truncated memoization cannot stand in for a globally valid branch.
   - **`specializeLP(domain, options): SpecializedLP` (Tier 3)**:
     Specializes objective/link and active Tchebycheff rows, hard spatial intervals and the complete outward-safe secant DAG (including <=3 kg and singleton cases), retaining `total_obj` parser seam. Returns explicit columns/domains, occurrence/base mapping, axis scale and bound/error frame metadata through native execution, decoding, independent validation and proof extraction. A caller shift is not proof; insufficient overrides withhold qualified bounds. Assembly <0.5 ms is an engineering target, not evidence.
2. **Preservation of Three-Solve Payoff-Table Normalization (ADR 0001)**:
   - In accordance with ADR 0001 and `solver.ts:170–187`, the solver evaluates ideal points using **three extreme payoff solves** (`weights: [100, 0, 0]`, `[0, 100, 0]`, `[0, 0, 100]`), deriving all six $(z, nad)$ coordinates from the resulting payoff vectors.
   - Normalized single-axis endpoint objectives evaluate single axes matching weights `[100, 0, 0]`, `[0, 100, 0]`, `[0, 0, 100]`: $+10 \cdot fE$, $-100 \cdot fR$, $-0.1 \cdot fP$.
3. **Raw Physical Bounds vs. Request-Scoped Clamping & Qualified Infeasibility**:
   - Tier 1 retains request-independent unclipped weight and raw-ergo bounds from the identity-matched unpruned occurrence graph. Adapt/prove `computeStructuralBounds` against that domain before certifying its output; no full LP is serialized merely to read bounds. The <1 ms figure is a target only. Request caps/filters/equipment modifiers never enter the session physical-range key.
   - In Tier 2, effective ergonomics bounds evaluate the normative two-stage clamp:
     $$\text{effectiveErgo}(raw) = \min\left(100, \max\left(0, \min(100, \max(0, \text{rawErgo})) \times factor\right)\right)$$
     Here `factor = max(0, 1 + equip_ergo_modifier)`. Bounds conservatively cover preset/owned/multi-copy cases and negative weights under the adopted finite graph; never invent `rawHi >= 1000` or expand an impossible weight cap back to `physMin`.
   - Empty request-clipped intervals imply impossibility only with conservative outward-safe identity-matched lower bounds and full native/domain proof prerequisites. Precise MOA-independent may return `infeasible/certified_infeasible`; Fast returns `incomplete/none`, reason `Approximate model infeasible`; precise provisional MOA uses `Provisional MOA model infeasible`; combined Fast/provisional uses `Fast provisional MOA model infeasible`, preserving both qualifications. Completed model-emptiness search always has termination `optimal`; unfinished/unstarted search has `limit`. Withheld bounds/proof alone do not change completion. MOA-independent qualification is `null`.
4. **Invalidation Ledgers & Endpoint Reuse Qualification**:
   - **Complete Dependency Ledger, Not a Fixed Field Count**: Loaded generation/immutable lookup identity, snapshot/weapon, preparation/formulation/schema/normalization/model-authority versions; legal bases/offers, trader/player levels, flea/barter/dogtag controls; full validated canonical owned multiset; item/category includes/exclusions with group structure; budget, weight, recoil, ergo, magazine, sighting, MOA and overswing constraints; equipment modifier, raw/TrueErgo axis, bounds mode and requested/resolved precision; and every additional input actually consumed by preparation/pruning. Hashes retain semantic context for mismatch/collision checks, with defaults matching execution.
   - **`endpointDomainKey`**: Separately versioned projection of the complete normalized request/context permitting only authorized preference changes. Preserve model/axis/proof dependencies and full inventory. This is not the full telemetry hash or a full-response cache and does not expand reuse across resolved time-budget/node/numerical controls just because topology matches. Transient request IDs and absolute epoch deadlines are not endpoint-key fields; enforce the current deadline/cancellation as runtime guards, separately from retained-proof eligibility.
   - **Eligibility**: Cache only qualified precise `certified_optimal` endpoint proofs, retaining validated witness, global bounds/gap, scale/tolerance and authority provenance. Fast, provisional-MOA and limit incumbents are not certified endpoint entries. Tightened tolerance requires resolving unless the retained proof satisfies the current frame and conservative eligibility check; a cache hit never promotes authority.
   - Three payoff solves and spatial nodes share preparation only for identical normalized feasible domains. Node-local clipping does not mutate it. Explore constraint changes and MOA cap trials prepare distinct domains; never carry a previous point's certificate as new proof. Request-wide deadlines/cancellation remain effective through preparation/native/validation.
   - Reload/replacement of lookup/data, changed generation or worker replacement invalidates physical and endpoint entries even when language/mode names match; `clearCache` clears endpoints too. Check context at the seam, not by rehashing the whole lookup per node. Managed cache mismatch rebuilds; externally supplied mismatched blueprint/bounds is rejected before emission, never treated as infeasibility.
5. **Memory Lifecycle & Reference Release (Zero New Cache Tiers)**:
   - Tier 1: Session-scoped in worker `stateCache`.
   - Tier 2: Active-subproblem ownership; release references on completion/cancellation/error. This is not an immediate-GC or strict heap-size guarantee.
   - Tier 3: Retain through native solve, decode, validation and certificate extraction, then release. Results retain required immutable data and never borrow buffers overwritten by the next solve. Native handle/reinitialization lifetime follows its separate runtime error contract.
   - Preserve existing session physical and qualified endpoint storage; no new IndexedDB/LocalStorage/global filtered-preparation/full-response tier. Required in-request sharing is not an optional Stage 4 optimization removable after an unrelated inconclusive benchmark.

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Unblocked to formulate the complete implementation sequence and verification gates (now that both #38 and #39 are resolved).

## Proof and Cutover Gates

- [Canonical #38](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38#issuecomment-5976600879) controls. Preserve three endpoint weights and frames `10*fE`, `-100*fR`, `-0.1*fP`, deriving all six z/nad coordinates from the same three payoff vectors; no six-extrema replacement or secondary tie preference.
- Stage 3 keeps the general expense-surrogate baseline. Presence/fully-owned elimination, clamp specialization and equivalent recoil reductions are optional Stage 4 under complete capacity/linking/consumer guards; Stage 2 establishes exact clamp semantics first.
- Prove prepared/unprepared domain, exact score/tie and infeasibility equivalence with both finite raw-source oracle fixtures and a declared-domain lifting/projection theorem. Require full-precision structured native primals/status/dual/gap, pinned reproducible WASM/glue and parsed-model/coefficient verification, finite auxiliary domains and full outward objective-frame corrections. No unqualified stock fallback or native status alone qualifies a proof.
- Complete decoder/worker/client/UI/benchmark and direct-entry migration within the one correctness cutover. Existing source helpers/throwaway contract checks are not preparation implementation, native/browser benchmark, universal game authority or speedup evidence.
