# ADR 0010: Independent Physical-Oracle and Equivalence Proof Gates

## Status
Proposed (Refs #36). Canonical Resolution 2026-10-03.

## Context
During the frontend solver audit, existing verification entrypoints passed cleanly despite targeted counterexamples exhibiting severe mathematical bugs (e.g. single-item satisfaction of multiple required slots, inverted Big-M rows, phantom spend under zero price weight, and missing fallbacks in zero-intrinsic MOA). Tests passed because they were written against the solver's internal compatibility maps and LP abstractions rather than raw physical reality. Furthermore, mathematical reductions require formal equivalence gates to guarantee that no valid physical builds or optimizing ties are lost.

## Decision

We establish four core principles governing physical verification, behavioral regression, reduction equivalence, and authority hierarchies:

1. **Independent Physical Oracle Contract**:
   - The oracle operates strictly via exhaustive combinatorial tree enumeration directly on unpruned raw `ItemLookup` data, completely decoupled from `buildLP`, `highs`, `compatibilityMap`, or continuous relaxations.
   - For any oracle fixture, it constructs every legally attachable tree of components rooted from the weapon receiver, respecting parent instance coupling and branch acyclicity ($A \notin \text{Ancestors}(s)$).
   - Enforces physical slot capacities, required mod-slot occupancy, physical slot conflicts (`conflicting_slot_ids`), and standalone market accessibility caps.
   - Evaluates exact physical equations directly (unrounded TrueErgo non-linear penalty $q(W) = \max(0, 100 - 300/W)$, raw ergo clamps, unrounded MOA, exact RUB-equivalent barter valuations).
   - Determines:
     (a) Complete set of feasible physical builds $\mathcal{F}_{\text{physical}} = \{B_1, \dots, B_K\}$;
     (b) True maximum physical score $S^* = \max_{B \in \mathcal{F}} \text{score}(B)$;
     (c) Exact set of optimal tie builds $\mathcal{T}^* = \{B \in \mathcal{F} \mid \text{score}(B) == S^*\}$;
     (d) Proved Physical Infeasibility if $\mathcal{F}_{\text{physical}} == \emptyset$.
   - **Pass Criteria**: Solver passes iff: when oracle is feasible $\implies$ solver returns certified `status: 'optimal'`, its returned build matches an element of $\mathcal{T}^*$, its decoded objective matches $S^*$ within $10^{-5}$, and `validateBuild` reports 0 errors; when oracle is infeasible $\implies$ solver returns certified `status: 'infeasible'`.
2. **Canonical 14-Scenario Behavioral Regression Matrix**:
   Every solver repair, numerical update, or model reduction must pass all 14 canonical physical scenarios evaluated against the independent physical oracle:
   1. *Occupied vs. Alternative Non-Conflicting Slots*: Part equips in clear alternative slot when first slot is blocked.
   2. *Exhaustive Empty-Required Routes*: Root empty required returns `infeasible`; mod-owned required slot deactivates parent; unreachable allowed items return `infeasible`.
   3. *Owner/Descendant Deactivation Propagation*: Unselected/conflicted parents strictly prune all descendants.
   4. *Impossible Includes*: Conflicting or incompatible forced inclusions return certified `infeasible`.
   5. *No Accessible Naked Base vs. Accessible Preset*: Solves with preset base when naked receiver is locked.
   6. *Preset Stripping & Retention*: Retains included preset parts at ₽0 marginal cost; strips unwanted parts at ₽0 penalty.
   7. *Owned / Stash Monotonicity*: Adding owned items decreases or maintains spend, increases or maintains score.
   8. *MOA Numerics & Boundary Fallbacks*: Big-M non-binding on unselected barrels; zero-intrinsic receivers constrained by barrel COI.
   9. *One Item / Two Required Slots*: Returns certified `infeasible` when single item cannot fill both slots.
   10. *Disconnected Cycles & Self-Loops*: Floating recursive loops without weapon connection strictly unselected.
   11. *Negative, Saturated & Equipment Ergonomics*: Exact piecewise clamping; second clamp eliminated when $factor \le 1.0$.
   12. *Exact 3 kg TED Boundary Behavior*: Zero penalty at $W \le 3$; concave penalty above 3 kg; node bounds enforced.
   13. *Zero Price Weight ($p=0$) & Multiple Presets*: Minimal deficit $buy_i^*$ evaluated; zero phantom spend.
   14. *Exact Multi-Copy Instance Tracking*: Distinct instance IDs in manifest; instance quantities tracked.
3. **Model Reduction Equivalence Proof Gates**:
   Any mathematical reduction must satisfy four formal equivalence gates before adoption:
   - **Gate A (Bijective Feasibility)**: $\mathcal{F}(\mathcal{M}_{\text{reduced}}) \equiv \mathcal{F}(\mathcal{M}_{\text{baseline}})$.
   - **Gate B (Optimum Value & Ties Invariance)**: $|S^*(\mathcal{M}_{\text{red}}) - S^*(\mathcal{M}_{\text{base}})| \le 10^{-5}$ and $\mathcal{T}^*(\mathcal{M}_{\text{red}}) \equiv \mathcal{T}^*(\mathcal{M}_{\text{base}})$.
   - **Gate C (Infeasibility Equivalence)**: $\text{Infeasible}(\mathcal{M}_{\text{red}}) \iff \text{Infeasible}(\mathcal{M}_{\text{base}})$.
   - **Gate D (Statistical Comparative Benchmarks - ADR 0005)**: Passes Gate 1 (0 errors) and Gate 2 (no rate/tail regression).
4. **Three-Tier Verification Authority Hierarchy**:
   - **Tier 1 (Ground Truth Authority)**: Brute-Force Physical Oracle (on small DAGs) and Independent Build Validator (`validateBuild.ts` on all solves).
   - **Tier 2 (Implementation Under Test)**: React frontend solver pipeline (JS / HiGHS WASM).
   - **Tier 3 (Differential Oracle - Python / CP-SAT)**: Cross-check evidence only on strictly reconciled common linear sub-problems; cannot overrule Tier 1.

## Consequences & Downstream Handoff

- **Issue #39 ([Reconsider continuous precise placement against matching and performance evidence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39))**: Unblocked to evaluate continuous placement prototypes against this independent physical oracle and 4-gate reduction equivalence framework.
