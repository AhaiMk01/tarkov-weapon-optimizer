# ADR 0010: Independent Physical-Oracle and Equivalence Proof Gates

## Status
Proposed (Refs #36). Canonical Resolution v3 2026-10-03.

## Context
During the frontend solver audit, existing verification entrypoints passed cleanly despite targeted counterexamples exhibiting severe mathematical bugs (e.g. single-item satisfaction of multiple required slots, inverted Big-M rows, phantom spend under zero price weight, and missing fallbacks in zero-intrinsic MOA). Tests passed because they were written against the solver's internal compatibility maps and LP abstractions rather than raw physical reality. Furthermore, mathematical reductions require formal equivalence gates to guarantee that no valid physical builds or optimizing ties are lost.

## Decision

We establish six core principles governing physical verification, behavioral regression, reduction equivalence, and authority hierarchies:

1. **Independent Physical Oracle Contract & Qualified Status Rules**:
   - The oracle operates strictly via exhaustive combinatorial tree enumeration directly on unpruned raw `ItemLookup` data, completely decoupled from `buildLP`, `highs`, `compatibilityMap`, or continuous relaxations.
   - Operates within the versioned adopted software domain (`snapshot.json` SHA-256 `219443b4...`), not an assertion of universal game-engine truth.
   - Evaluates exact physical equations directly (unrounded TrueErgo non-linear penalty $q(W) = \max(0, 100 - 300/W)$, raw ergo clamps, unrounded MOA with $K = 100 / 2.9089$, exact `avg24hPrice` barter valuations).
   - Determines:
     (a) Complete set of feasible physical builds $\mathcal{F}_{\text{physical}} = \{B_1, \dots, B_K\}$;
     (b) True maximum physical score evaluated in exact rational arithmetic: $S^* = \max_{B \in \mathcal{F}} \text{score}_{\mathbb{Q}}(B)$;
     (c) Exact set of optimal tie builds $\mathcal{T}^* = \{B \in \mathcal{F} \mid \text{score}_{\mathbb{Q}}(B) == S^*\}$;
     (d) Proved Physical Infeasibility if $\mathcal{F}_{\text{physical}} == \emptyset$.
   - **Qualified Status and Retention Rules (ADR 0004 / ADR 0006)**:
     - Completed Precise Mode Proof (MOA-independent): `status: 'optimal'`, `model_qualification: 'exact'`, `precision_resolved: 'precise'`, `physical_certificate: 'certified_optimal'`.
     - Completed Fast Mode Proof (MOA-independent): `status: 'optimal'`, `model_qualification: 'approximate'`, `precision_resolved: 'fast'`, `physical_certificate: 'approximate_optimal'`.
     - Completed Precise Mode Proof (MOA-dependent under ADR 0006): `status: 'optimal'`, `model_qualification: 'exact'`, `moa_qualification: 'provisional_model'`, `physical_certificate: 'approximate_optimal'`.
     - Completed Fast Mode Proof (MOA-dependent under ADR 0006): `status: 'optimal'`, `model_qualification: 'approximate'`, `moa_qualification: 'provisional_model'`, `physical_certificate: 'approximate_optimal'`.
     - Proved Infeasible on Precise Model (MOA-independent): `status: 'infeasible'`, `physical_certificate: 'certified_infeasible'`.
     - Proved Infeasible on Fast Model: Cannot claim physical infeasibility! (Returns `status: 'incomplete'`, `reason: 'Fast model infeasible'`).
     - Proved Infeasible on Precise Model (MOA-dependent under ADR 0006): `status: 'incomplete'`, `reason: 'Provisional MOA model infeasible'`, `physical_certificate: 'none'`, with internal `model_infeasible` retained.
     - Deadline / cancellation after already-proved optimum: **Must preserve already-proved optimum status**; late cancel/deadline never downgrades.
     - Deadline / cancellation with unproved incumbent: `status: 'feasible'`, `physical_certificate: 'feasible'`, `lower_bound: incumbent.objective`, `upper_bound: global_upper_bound`.
     - Deadline / cancellation with NO incumbent: `status: 'incomplete'`, `physical_certificate: 'none'`, `lower_bound: null`.
2. **Exact Reference Arithmetic & Tie Semantics**:
   - Reference oracle evaluates all scores, objectives, and constraints in **exact rational arithmetic over $\mathbb{Q}$**, eliminating floating-point evaluation order artifacts (such as $\alpha = 0.35 \implies \alpha \cdot 9 = 3.15$ vs $\alpha \cdot 3 + \alpha \cdot 6 = 3.1499999999999995$).
   - Exact physical ties are defined strictly by equality in $\mathbb{Q}$: $\text{score}_{\mathbb{Q}}(B_1) == \text{score}_{\mathbb{Q}}(B_2)$.
   - Evaluates augmented Tchebycheff without outer zero clamp ($0.01 (c_e fE_{\mathbb{Q}} - c_r fR_{\mathbb{Q}} - c_p fP_{\mathbb{Q}}) - \max_a d_a$), handling signed axes and all-zero weights without NaN.
   - **Gate B Exact Invariance**: Exact reductions must preserve mathematical objective and exact rational tie set: $\pi_{\text{sel}}(\mathcal{T}_{\mathbb{Q}}^*(\mathcal{M}_{\text{reduced}})) \equiv \pi_{\text{sel}}(\mathcal{T}_{\mathbb{Q}}^*(\mathcal{M}_{\text{baseline}}))$. Numerical allowance $\le 10^{-5}$ is a runtime solver reporting/stopping tolerance, not permission to alter objectives or drop ties.
   - Primary test fixtures must use finite, well-separated score gaps ($\Delta_{\text{score}} > 10^{-4} \gg 10^{-5}$). Boundary regression fixtures with deliberate exact ties ($\Delta_{\text{score}} = 0$) test that solver accepts any valid element of $\pi_{\text{sel}}(\mathcal{T}_{\mathbb{Q}}^*)$.
3. **Canonical Selection Projection vs. Rooted Occurrence Witnesses**:
   - **Canonical Selection Projection**: $\mathbf{\pi_{\text{sel}}(B) = (base^*, \text{multiset of installed item IDs with counts})}$.
   - **Gate A (Selection Projection Equivalence)**:
     $$\mathbf{\pi_{\text{sel}}(\mathcal{F}(\mathcal{M}_{\text{reduced}})) \equiv \pi_{\text{sel}}(\mathcal{F}(\mathcal{M}_{\text{baseline}}))}$$
     Surjective many-to-one projection accommodating unperturbed expense surrogates at $p=0$ and interchangeable legal physical slot assignments without requiring bijective LP variable equality.
   - **Rooted Occurrence Witness Invariant**: Any returned physical build must be accompanied by a valid, rooted physical instance tree manifest ($p_{i,s}$) with unique instance IDs, verified by `validateBuild` to have zero conflicts, full parent connectivity, and exact capacity compliance.
   - Continuous Placement Reconsideration (Issue #39) requires exact bipartite/network matching reconstruction theorem proving that every decoded placement is physically legal, conflict-free, and rooted.
4. **Canonical 14-Family Behavioral Regression Ledger**:
   Every solver repair, numerical update, or model reduction must pass all 14 canonical physical scenario families evaluated against the independent physical oracle:
   1. *Slot Occupancy & Conflicts Family*: Pairwise item conflicts, self-conflicts on duplicate copies, and slot-occupancy conflicts (`conflicting_slot_ids`). Part equips in clear alternative slot when first slot is blocked.
   2. *Exhaustive Empty-Required Routes Family*: Root required empty $\implies$ certified `infeasible`; mod-owned required empty $\implies$ parent forced off ($x_{\text{parent}} = 0$) while alternative attachment paths survive; allowed candidates unreachable by market or parent deactivation $\implies$ certified `infeasible` if root.
   3. *Rootedness & Acyclicity Family*: Deep tree deactivation ($Root \to Parent \to Child \to Grandchild$); unselected parent strictly prunes all descendants. Self-referential and ancestor-repetition loops ($A \notin \text{Ancestors}(s)$) strictly pruned.
   4. *Includes & Constraints Family*: Forced inclusions (`include_items`), categorical includes (`include_categories`), impossible/conflicting includes (certified `infeasible`), and includes exceeding total physical slot capacity.
   5. *Base Accessibility Family*: Naked receiver locked by trader level but containing preset accessible $\implies$ solves with preset base at real spend; all bases locked $\implies$ certified `infeasible`.
   6. *Preset Stripping & Multi-Copy Supply Family*: Retains included preset parts at ₽0 marginal cost up to $q_{b,i}$; strips unwanted parts at ₽0 penalty; exact out-of-pocket mod spend added to base preset cost.
   7. *Stash Inventory Monotonicity Family*: Adding owned items satisfies: (a) fixed-build spend non-increase $\text{spend}(B \mid N+\Delta) \le \text{spend}(B \mid N)$; (b) feasible-set expansion $\mathcal{F}(N) \subseteq \mathcal{F}(N+\Delta)$; (c) optimal score non-decrease $S^*(N+\Delta) \ge S^*(N)$.
   8. *MOA Numerics & Boundary Fallbacks Family*: Constant-only MOA exceeding cap with optional vs required barrels; zero-intrinsic receivers with modular barrels; worst-case negative suppressors ($-5\%$); nonpositive/missing COI barrels fallback to intrinsic COI.
   9. *One Item / Two Required Slots Family*: Two required slots accept only item $T$. Item $T$ is **standalone-inaccessible ($buy_T = 0$ enforced)**, 0 preset copies, and stash contains exactly 1 copy ($N_{\text{owned}}(T) = 1$) $\implies$ certified `infeasible` on precise model; fast mode approximation cannot claim exact `optimal`.
   10. *Disconnected Cycles & Self-Loops Family*: Floating recursive loops without weapon connection strictly unselected ($x_A = 0, x_B = 0$).
   11. *Ergonomics Clamping Family*: Physical output statistics verified across all 4 regimes (wholly below 0, wholly above 100, upper saturation, lower floor, full disjunction, equipment factor $\le 1.0$ vs $> 1.0$).
   12. *TrueErgo (TED) & Overswing Family*: Zero penalty at $W \le 3\text{ kg}$; concave penalty above 3 kg; node bounds strictly enforced; outward lower secant shift ($10^{-9}$); overswing percent non-zero iff $\text{TED} < 0$.
   13. *Zero Price Weight ($p=0$) & Multiple Presets Family*: Minimal deficit $d_i$ evaluated; zero phantom spend; unperturbed epigraph projection holds without objective penalties.
   14. *Multi-Copy Instance Tracking Family*: Distinct instance IDs in manifest, quantity-aware purchase deficits, fractional source weights (such as $0.0155\text{ kg} = 15.5\text{ g}$ mount).
5. **Independent Raw Data Input & `validateBuild` Cutover Contract**:
   - The Physical Oracle and test harness parse raw Tarkov.dev JSON documents independently of the legacy adapter in `dataService.ts`:
     - Preserving multi-copy preset supply $q_{b,i}$ as integer arrays/counts (not flattened sets).
     - Preserving exact fractional weights (`0.0155 kg`).
     - Using exact barter ingredient requirements with `avg24hPrice ?? basePrice ?? 0`.
     - Using normative $\text{MOA\_K} = 100 / 2.9089$.
   - Upgraded `validateBuild.ts` strictly enforces: unique `instanceId` mappings per connection; exact purchase deficits $d_i = \max(0, \text{installed}_i - N_{\text{owned}}(i) - \sum_b q_{b,i} base_b)$; hard inventory caps on unpurchasable items; normative MOA with $K = 100 / 2.9089$; exact TrueErgo penalty $q(W) = \max(0, 100 - 300/W)$; and `avg24hPrice` barter valuations.
6. **Full Comparative Benchmark Contract & Separation of Concerns**:
   - **Correctness Repairs (Bug Fixes)**: Evaluated against the Independent Physical Oracle across the 14 Regression Families. Must achieve 100% physical correctness; **never** required to demonstrate a 5% speedup.
   - **Exact Reductions (Optimizations)**: Evaluated against the Correct Versioned Baseline Model. Must satisfy Gates A, B, C, and achieve Gate 3 on the full 4-gate comparative benchmark harness.
   - **Full 4-Gate Comparative Benchmark Contract (ADR 0005 / Issue #37)**:
     - Gate 1 (Hard Fail): Any physical validation failure (`validateBuild` errors > 0) or oracle violation $\implies$ `FAIL`.
     - Gate 2 (Hard Fail): Any primary on-time success rate drop, tail regression ($P95 > 1.05 \times$), or bootstrap 95% BCa CI lower bound $> 1.0 \implies$ `FAIL`.
     - Gate 3 (Pass): Zero correctness failures, rate/tail non-regression, $N_{\text{both}} \ge 5$, and bootstrap 95% BCa CI non-degenerate with upper bound strictly $< 0.95$ ($\ge 5\%$ practical speedup) $\implies$ `PASS`.
     - Gate 4 (Inconclusive): All other outcomes (speedup unproven, zero variance, or CI spans across 1.0) $\implies$ `INCONCLUSIVE` (rejected for production adoption).

## Consequences & Downstream Handoff

- **Issue #39 ([Reconsider continuous precise placement against matching and performance evidence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39))**: Unblocked to evaluate continuous placement prototypes against this independent physical oracle and 4-gate reduction equivalence framework.
