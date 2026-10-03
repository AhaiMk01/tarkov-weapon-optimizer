# ADR 0010: Independent Physical-Oracle and Equivalence Proof Gates

## Status
Proposed (Refs #36). Canonical Resolution v2 2026-10-03.

## Context
During the frontend solver audit, existing verification entrypoints passed cleanly despite targeted counterexamples exhibiting severe mathematical bugs (e.g. single-item satisfaction of multiple required slots, inverted Big-M rows, phantom spend under zero price weight, and missing fallbacks in zero-intrinsic MOA). Tests passed because they were written against the solver's internal compatibility maps and LP abstractions rather than raw physical reality. Furthermore, mathematical reductions require formal equivalence gates to guarantee that no valid physical builds or optimizing ties are lost.

## Decision

We establish six core principles governing physical verification, behavioral regression, reduction equivalence, and authority hierarchies:

1. **Independent Physical Oracle Contract & Authority Scope**:
   - The oracle operates strictly via exhaustive combinatorial tree enumeration directly on unpruned raw `ItemLookup` data, completely decoupled from `buildLP`, `highs`, `compatibilityMap`, or continuous relaxations.
   - For any oracle fixture, it constructs every legally attachable tree of components rooted from the weapon receiver, respecting parent instance coupling and branch acyclicity ($A \notin \text{Ancestors}(s)$).
   - Enforces physical slot capacities, required mod-slot occupancy, physical slot conflicts (`conflicting_slot_ids`), and standalone market accessibility caps.
   - Evaluates exact physical equations directly (unrounded TrueErgo non-linear penalty $q(W) = \max(0, 100 - 300/W)$, raw ergo clamps, unrounded MOA with $K = 100 / 2.9089$, exact `avg24hPrice` barter valuations).
   - Determines:
     (a) Complete set of feasible physical builds $\mathcal{F}_{\text{physical}} = \{B_1, \dots, B_K\}$ canonically identified by chosen base, installed item multiset, and rooted physical parent-slot instance paths;
     (b) True maximum physical score $S^* = \max_{B \in \mathcal{F}} \text{objectiveScore}(B)$;
     (c) Exact set of optimal tie builds $\mathcal{T}^* = \{B \in \mathcal{F} \mid \text{score}(B) == S^*\}$;
     (d) Proved Physical Infeasibility if $\mathcal{F}_{\text{physical}} == \emptyset$.
   - **Software Authority & Accepted Status/MOA Fences**:
     - The oracle defines ground truth within the **versioned adopted software domain** (`snapshot.json` SHA-256 `219443b4...`), not an assertion of universal game-engine truth.
     - Feasible Oracle:
       - *MOA-Independent Requests*: Returns certified `status: 'optimal'`, `physical_certificate: 'certified_optimal'`, returned build matches an element of $\mathcal{T}^*$, decoded objective matches $S^*$ within $10^{-5}$, and independent validation reports 0 errors.
       - *MOA-Dependent Requests (under ADR 0006)*: Returns `status: 'optimal'`, `model_qualification: 'exact'`, `moa_qualification: 'provisional_model'`, **`physical_certificate: 'approximate_optimal'`** (strictly fenced from `certified_optimal`).
     - Infeasible Oracle:
       - *MOA-Independent Requests*: Returns certified `status: 'infeasible'`, `physical_certificate: 'certified_infeasible'`.
       - *MOA-Dependent Requests (under ADR 0006)*: Returns public `status: 'incomplete'`, `reason: 'Provisional MOA model infeasible'`, **`physical_certificate: 'none'`**, while retaining solver-internal `model_infeasible` for bisection bounds.
     - Search Limits: Any solve halted by deadline or node limits with an incumbent receives `status: 'feasible'`, `physical_certificate: 'feasible'`, and is never promoted to optimal.
2. **Canonical 14-Scenario Behavioral Regression Matrix**:
   Every solver repair, numerical update, or model reduction must pass all 14 canonical physical scenario families evaluated against the independent physical oracle:
   1. *Occupied vs. Alternative Non-Conflicting Slots*: Part equips in clear alternative slot when first slot is blocked. Covers pairwise item conflicts and physical slot conflicts (`conflicting_slot_ids`).
   2. *Exhaustive Empty-Required Routes*: Root empty required returns `infeasible`; mod-owned required slot deactivates parent; unreachable allowed items return `infeasible`.
   3. *Owner/Descendant Deactivation & Acyclicity*: Unselected/conflicted parents strictly prune all descendants. Self-referential and ancestor-repetition loops ($A \notin \text{Ancestors}(s)$) pruned.
   4. *Impossible Includes*: Conflicting or incompatible forced inclusions return certified `infeasible`.
   5. *No Accessible Naked Base vs. Accessible Preset*: Solves with preset base when naked receiver is locked. When all bases locked $\implies$ certified `infeasible`.
   6. *Preset Stripping & Multi-Copy Retention*: Retains included preset parts at ₽0 marginal cost up to $q_{b,i}$; strips unwanted parts at ₽0 penalty.
   7. *Stash Inventory Monotonicity*: Fixed-build spend non-increase ($\text{spend}(B \mid N_{\text{owned}}+\Delta) \le \text{spend}(B \mid N_{\text{owned}})$); feasible set expansion ($\mathcal{F}(N) \subseteq \mathcal{F}(N+\Delta)$); optimal score non-decrease ($S^*(N+\Delta) \ge S^*(N)$).
   8. *MOA Numerics & Boundary Fallbacks*: Constant-only MOA with optional vs required barrels; zero-intrinsic receivers with modular barrels; worst-case negative suppressors; nonpositive/missing COI barrels fallback to intrinsic COI.
   9. *One Item / Two Required Slots*: When item is **standalone-inaccessible ($buy_i = 0$ enforced)**, 0 preset copies, and $N_{\text{owned}} = 1 \implies$ certified `infeasible` on precise model; fast mode approximation cannot claim exact `optimal`.
   10. *Disconnected Cycles & Self-Loops*: Floating recursive loops without weapon connection strictly unselected.
   11. *Negative, Saturated & Equipment Ergonomics*: Exact piecewise clamping evaluated by physical output statistics; second clamp eliminated when $factor \le 1.0$.
   12. *Exact 3 kg TED Boundary Behavior*: Zero penalty at $W \le 3$; concave penalty above 3 kg; node bounds strictly enforced; outward lower secant shift applied.
   13. *Zero Price Weight ($p=0$) & Multiple Presets*: Minimal deficit $buy_i^*$ evaluated; zero phantom spend. Unperturbed epigraph projection holds.
   14. *Exact Multi-Copy Instance Tracking*: Distinct instance IDs in manifest; instance quantities tracked.
3. **Model Reduction Equivalence Proof Gates**:
   Any mathematical reduction must satisfy four formal equivalence gates compared against a **correct, versioned unreduced baseline model** before adoption:
   - **Gate A (Physical Projection Equivalence)**: $\pi(\mathcal{F}(\mathcal{M}_{\text{reduced}})) \equiv \pi(\mathcal{F}(\mathcal{M}_{\text{baseline}}))$ where $\pi$ maps to canonical physical projections (chosen base, installed multiset, rooted physical parent-slot paths). Accommodates many-to-one expense surrogates at $p=0$.
   - **Gate B (Optimum Value & Ties Invariance)**: $|S^*(\mathcal{M}_{\text{red}}) - S^*(\mathcal{M}_{\text{base}})| \le 10^{-5}$ and $\pi(\mathcal{T}^*(\mathcal{M}_{\text{red}})) \equiv \pi(\mathcal{T}^*(\mathcal{M}_{\text{base}}))$, with finite well-separated fixture gaps ($\Delta_{\text{score}} > 10^{-4}$).
   - **Gate C (Infeasibility Equivalence)**: $\text{Infeasible}(\mathcal{M}_{\text{red}}) \iff \text{Infeasible}(\mathcal{M}_{\text{base}})$.
   - **Gate D (Statistical Comparative Benchmarks - ADR 0005)**: Evaluated on paired browser-worker harness: Gate 1 (0 errors), Gate 2 (no rate/tail regression), Gate 3 ($N_{\text{both}} \ge 5$, bootstrap 95% CI upper bound $< 0.95$), and Gate 4 Inconclusive.
4. **Strict Separation: Correctness Repairs vs. Performance Reductions**:
   - **Correctness Repairs (Bug Fixes)**: Evaluated against the Independent Physical Oracle across the 14 Regression Families. Must achieve 100% physical correctness; **never** required to demonstrate a 5% speedup.
   - **Exact Reductions (Optimizations)**: Evaluated against the Correct Versioned Baseline Model. Must satisfy Gates A, B, C, and achieve Gate 3 on comparative benchmarks.
5. **Independent Raw Data Input & `validateBuild` Cutover Contract**:
   - The Physical Oracle and `validateBuild` must read raw, unpruned item properties and raw presets directly from `ItemLookup`, completely decoupled from `buildCompatibilityMap`, `buildLP`, or solver decoding arrays. Presets represented with explicit integer counts $q_{b,i}$.
   - Upgraded `validateBuild.ts` must strictly enforce: unique `instanceId` mappings per physical connection; exact purchase deficits $d_i = \max(0, \text{installed}_i - N_{\text{owned}}(i) - \sum_b q_{b,i} base_b)$; hard inventory caps on unpurchasable items; normative MOA with $K = 100 / 2.9089$; exact TrueErgo penalty $q(W) = \max(0, 100 - 300/W)$; `avg24hPrice` barter valuations; and out-of-pocket wallet spend $\sum_b \text{cost}_b base_b + \sum_i \text{price}_i d_i \le \text{max\_price}$.
6. **Three-Tier Verification Authority Hierarchy**:
   - **Tier 1 (Ground Truth Authority)**: Brute-Force Physical Oracle (on small DAGs) and Independent Build Validator (`validateBuild.ts` on all solves).
   - **Tier 2 (Implementation Under Test)**: React frontend solver pipeline (JS / HiGHS WASM).
   - **Tier 3 (Differential Oracle - Python / CP-SAT)**: Cross-check evidence only on strictly reconciled common linear sub-problems; cannot overrule Tier 1.

## Consequences & Downstream Handoff

- **Issue #39 ([Reconsider continuous precise placement against matching and performance evidence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39))**: Unblocked to evaluate continuous placement prototypes against this independent physical oracle and 4-gate reduction equivalence framework.
