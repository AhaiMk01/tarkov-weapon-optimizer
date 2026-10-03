# ADR 0009: Exact Purchase and Row-Reduction Contracts

## Status
Proposed (Refs #33). Canonical Resolution 2026-10-03.

## Context
Under the authoritative physical-build and acquisition domain settled in [ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0008 / Issue #42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42), items can occupy multiple distinct physical slots simultaneously, while free components originate from personal stash inventory ($N_{\text{owned}}(i)$) and containing preset bases ($q_{b,i} \cdot base_b$). The legacy purchase formulation in `lpBuilder.ts` assumed single-copy placement, single-copy presets, and lacked free inventory offsetting. Furthermore, under zero price weight ($price\_weight == 0$), the solver was indifferent to purchase variables, introducing phantom spend into shopping lists.

## Decision

We establish four core principles governing purchase formulation, zero-price-weight tie-breaking, economic expenditure, and model reductions:

1. **Exact Quantity-Aware Purchase Deficit Formulation**:
   - The normative purchase quantity equality across all budget and objective settings is defined as:
     $$\mathbf{buy_i = \max\left(0, \sum_{s \in \text{Slots}(i)} p_{i,s} - N_{\text{owned}}(i) - \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b\right)}$$
     where $\text{installed}_i = \sum_s p_{i,s}$ in the physical instance domain.
   - **Variable Typing**:
     - Single-capacity items ($\text{max\_installed}_i == 1$): declared as **binary variables** $buy_i \in \{0, 1\}$.
     - Multi-capacity items ($\text{max\_installed}_i > 1$): declared as **general integer variables** $0 \le buy_i \le \max(0, \text{max\_installed}_i - N_{\text{owned}}(i))$.
     - Fully owned items ($N_{\text{owned}}(i) \ge \text{max\_installed}_i$): $buy_i \equiv 0$, completely eliminated in presolve.
   - **Primary Offsetting Inequality**:
     $$buy_i - \sum_{s \in \text{Slots}(i)} p_{i,s} + \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b \ge -N_{\text{owned}}(i)$$
2. **Zero Price Weight & Indifference: Phantom Spend Elimination**:
   - **Secondary Lexicographic Tie-Breaker**: In all solves, add a secondary tie-breaker penalty to the LP objective:
     $$\text{penalty}_{\text{tie-break}} = -10^{-7} \sum_i buy_i - 10^{-7} \sum_b base_b$$
     ensuring HiGHS always strictly minimizes purchase quantities even when user $price\_weight == 0$, breaking indifference without perturbing ergonomics/recoil Pareto tradeoffs.
   - **Exact Decoder Re-Assignment**: The response decoder assigns $buy_i^*$ using the exact normative equality from solved placement variables ($p_{i,s}^*$ and $base_b^*$), guaranteeing zero phantom spend in shopping lists and public responses.
   - **Budget Feasibility**: Because $buy_i^{\text{LP}} \ge buy_i^*$, any build satisfying the LP budget constraint strictly satisfies the budget constraint on exact out-of-pocket expenditure.
3. **Hard Budget Wallet Expenditure vs. Objective Prices**:
   - Hard budget constraint `max_price`:
     $$\sum_b \text{cost}_b \cdot base_b + \sum_i \text{price}_i \cdot buy_i \le \text{max\_price}$$
     applies strictly to real out-of-pocket currency/barter spend, with owned parts contributing $buy_i = 0$ (₽0 spend).
   - Price objective axis ($fP$): evaluates actual out-of-pocket acquisition cost. Standalone-inaccessible parts are enforced by hard inventory caps ($\sum_s p_{i,s} \le \text{preset} + N_{\text{owned}}$), eliminating legacy ₽100,000,000 stand-in prices.
   - Barters are valued using established RUB-equivalent market valuations $\sum_{req} \text{count}_{req} \cdot \text{price}_{req}$.
4. **Permitted Variable & Row Reductions**:
   - **$buy_i \equiv x_i$ Substitution**: For single-slot, unowned, non-preset mods ($q_{b,i} == 0 \land N_{\text{owned}}(i) == 0 \land \text{max\_installed}_i == 1$), substitute $x_i$ directly and omit the $buy_i$ variable and `buy_eq_i` row.
   - **Full Presolve Elimination**: Fully owned ($N_{\text{owned}} \ge \text{max\_installed}$) or zero-cost items omit $buy_i$ and purchase rows entirely.
   - **Auxiliary Objective Rows**: Retain `rec_axis` and `price_axis` when `use_tchebycheff: true`; permit direct objective emission when `use_tchebycheff: false`.
   - **Validation Parity**: `validateBuild` and telemetry evaluate the exact normative deficit formula, guaranteeing exact equivalence across reduced and unreduced formulations.

## Consequences & Downstream Handoff

- **Issue #38 ([Choose prepared-model ownership and invalidation boundaries](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38))**: Unblocked to formulate prepared model caching, parameter sensitivity, and invalidation rules against this exact purchase reduction contract.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Unblocked to validate build purchasing, zero-spend assertions, and inventory caps in independent verification.
