# ADR 0009: Exact Purchase and Row-Reduction Contracts

## Status
Proposed (Refs #33). Canonical Resolution v2 2026-10-03.

## Context
Under the authoritative physical-build and acquisition domain settled in [ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0008 / Issue #42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42), items can occupy multiple distinct physical slots simultaneously, while free components originate from personal stash inventory ($N_{\text{owned}}(i)$) and containing preset bases ($q_{b,i} \cdot base_b$). The legacy purchase formulation in `lpBuilder.ts` assumed single-copy placement, single-copy presets, and lacked free inventory offsetting. Furthermore, under zero price weight ($price\_weight == 0$), the solver was indifferent to purchase variables. An artificial epsilon penalty was proposed and rejected because it inverted primary Pareto preferences.

## Decision

We establish four core principles governing purchase formulation, unperturbed epigraph projection, economic expenditure, and model reductions:

1. **Exact Quantity-Aware Purchase Deficit Formulation**:
   - The normative purchase quantity equality across all budget and objective settings is defined as:
     $$\mathbf{buy_i^* = \max\left(0, \sum_{s \in \text{Slots}(i)} p_{i,s} - N_{\text{owned}}(i) - \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b\right)}$$
     where $\text{installed}_i = \sum_s p_{i,s}$ in the physical instance domain.
   - **Variable Typing**:
     - Single-capacity items ($\text{max\_installed}_i == 1$): declared as **binary variables** $buy_i \in \{0, 1\}$.
     - Multi-capacity items ($\text{max\_installed}_i > 1$): declared as **general integer variables** $0 \le buy_i \le \max(0, \text{max\_installed}_i - N_{\text{owned}}(i))$.
     - Fully owned items ($N_{\text{owned}}(i) \ge \text{max\_installed}_i$): $buy_i \equiv 0$, completely eliminated in presolve.
   - **Primary Offsetting Inequality**:
     $$buy_i - \sum_{s \in \text{Slots}(i)} p_{i,s} + \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b \ge -N_{\text{owned}}(i)$$
2. **Epigraph Projection & Minimal-Surrogate Lifting Contract (Without Objective Perturbation)**:
   - We explicitly reject artificial objective penalties (such as $-10^{-7} \sum buy_i$), which invert primary Pareto preferences.
   - In the LP, the decision variable $buy_i^{\text{LP}}$ functions as an upper expense surrogate:
     $$buy_i^{\text{LP}} \ge \sum_{s \in \text{Slots}(i)} p_{i,s} - N_{\text{owned}}(i) - \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b, \quad buy_i^{\text{LP}} \ge 0$$
   - **Lifting & Projection Proofs**:
     - Any physical build $(p^*, base^*)$ with exact deficit $buy_i^*$ is mathematically feasible in the LP.
     - Any LP optimal solution $(p^*, base^*, buy^{\text{LP}})$ projects to an exact physical build via the exact deficit formula.
     - Budget monotonicity: because legal prices $\ge 0$, $\text{spend}^* \le \text{spend}^{\text{LP}} \le \text{max\_price}$.
     - Objective monotonicity: because price has non-positive weight, $\text{score}(p^*, base^*, buy^*) \ge \text{score}(p^*, base^*, buy^{\text{LP}})$. No objective ever rewards inflating surrogate spend.
     - Optimizing ties under $p = 0$: the objective value is completely independent of $buy^{\text{LP}}$; HiGHS maximizes ergonomics and recoil, and the decoder computes the exact minimal deficit $buy_i^*$, reporting 0% phantom spend.
   - Native dual bounds from HiGHS directly upper-bound the true physical objective over reals without penalty distortion.
3. **Hard Budget Wallet Spend, Stored Price vs. Legal Acquisition, and Barter Valuations**:
   - Zero stored price does not establish free legal acquisition: standalone-inaccessible items are strictly governed by hard inventory caps ($\sum_s p_{i,s} \le \sum_b q_{b,i} base_b + N_{\text{owned}}(i)$); their supply/availability rows are never omitted.
   - Genuinely accessible zero-cost offers retain actual vendor provenance and $buy_i^*$, never marked `'owned'`.
   - Mixed supply: an item can have free owned instances and positive $buy_i^*$ for additional copies.
   - Hard budget constraint `max_price`: applies strictly to real out-of-pocket currency/barter spend, with owned parts contributing $buy_i = 0$ (₽0 spend).
   - Established Barter Valuation: evaluated exactly as in `frontend/src/solver/dataService.ts:633–645`:
     $$\text{price}_{\text{barter}} = \text{Math.round}\left(\sum_{\text{req}} \text{count}_{\text{req}} \cdot \left(\text{avg24hPrice}_{\text{req}} \ ??\ \text{basePrice}_{\text{req}} \ ??\ 0\right)\right)$$
4. **Permitted Model Reductions, Inlining & Equivalence Gates**:
   - **$buy_i \equiv x_i$ Substitution**: For single-slot, unowned, non-preset mods ($q_{b,i} == 0 \land N_{\text{owned}}(i) == 0 \land \text{max\_installed}_i == 1$), substitute $x_i$ directly into budget and price objective rows, omitting the $buy_i$ variable and row.
   - **Full Presolve Elimination**: Fully owned ($N_{\text{owned}} \ge \text{max\_installed}$) items omit $buy_i$ and purchase rows entirely.
   - **Auxiliary Axis Reduction & Recoil Inlining**: If `recoil_def` is removed, its multi-copy expression $\sum_i \text{item\_recoil}[i] \sum_s p_{i,s}$ must be directly inlined into every surviving constraint (`rec_v_lim`, `rec_sum_lim`, and `total_obj`), leaving no uncoupled free `rec_axis`.
   - **Recoil Cap Redundancy & Collapse**: When both `max_recoil_v` and `max_recoil_sum` are active, collapse into the single stricter bound $\text{mod} \le \min(\frac{Cap_V}{naked_V} - 1, \frac{Cap_{\text{Sum}}}{naked_V + naked_H} - 1)$.
   - Retain `total_obj` due to HiGHS parser line length limits. Retain `rec_axis` and `price_axis` when `use_tchebycheff: true`.
   - **Independent Physical-Oracle and Equivalence Proof Gates (Issue #36)**: Decoder/validation parity is an incumbent check; model reduction equivalence is delegated to Issue #36 oracle/equivalence proof gates across deterministic test suites.

## Consequences & Downstream Handoff

- **Issue #38 ([Choose prepared-model ownership and invalidation boundaries](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38))**: Unblocked to formulate prepared model caching, parameter sensitivity, and invalidation rules against this exact purchase reduction contract.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Unblocked to validate build purchasing, zero-spend assertions, and inventory caps in independent verification.
