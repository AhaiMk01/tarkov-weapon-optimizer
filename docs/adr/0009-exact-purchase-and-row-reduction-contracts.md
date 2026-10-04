# ADR 0009: Exact Purchase and Row-Reduction Contracts

## Status
Accepted planning decision (Refs #33). Reconciled 2026-10-04; no implemented reduction or native/performance proof is claimed.

## Context
Under the authoritative physical-build and acquisition domain settled in [ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0008 / Issue #42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42), items can occupy multiple distinct physical slots simultaneously, while free components originate from personal stash inventory ($N_{\text{owned}}(i)$) and containing preset bases ($q_{b,i} \cdot base_b$). The legacy purchase formulation in `lpBuilder.ts` assumed single-copy placement, single-copy presets, and lacked free inventory offsetting. Furthermore, under zero price weight ($price\_weight == 0$), the solver was indifferent to purchase variables. An artificial epsilon penalty was proposed and rejected because it inverted primary Pareto preferences.

## Decision

We establish four core principles governing purchase formulation, unperturbed epigraph projection, economic expenditure, and model reductions:

1. **Exact Quantity-Aware Purchase Deficit Formulation**:
   - The normative purchase quantity equality across all budget and objective settings is defined as:
     $$\mathbf{d_i = \max\left(0, \text{installed}_i - \text{owned}_i - \text{selectedPresetSupply}_i\right)}$$
     where $\text{installed}_i = \sum_s p_{i,s}$ in the physical instance domain.
   - **Unreduced Stage 3 Baseline**: Emit a general integer expense surrogate $u_i$ for every tracked item with a proved safe physical capacity bound and $0 \le u_i \le \max(0,\text{max\_installed}_i-N_{\text{owned}}(i))$. An upper bound of zero may fix the column; optional deletion or binary/presence specialization is not part of this general baseline.
   - Single-capacity binary typing, presence substitution and fully-owned bookkeeping elimination are optional Stage 4 candidates. Their capacity bounds must be proved over the adopted occurrence domain.
   - **Primary Offsetting Inequality**:
     $$u_i - \sum_{s \in \text{Slots}(i)} p_{i,s} + \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b \ge -N_{\text{owned}}(i)$$
2. **Unperturbed Epigraph Projection and Minimal Lifting**:
   - We explicitly reject artificial objective penalties (such as $-10^{-7} \sum u_i$), which invert primary Pareto preferences.
   - In the LP, the decision variable $u_i$ functions as an upper expense surrogate:
     $$u_i \ge \sum_{s \in \text{Slots}(i)} p_{i,s} - N_{\text{owned}}(i) - \sum_{b \in \text{Bases}} q_{b,i} \cdot base_b, \quad u_i \ge 0$$
   - **Lifting & Projection Proofs**:
     - Any physical build $(p^*, base^*)$ with exact deficit $d_i$ is mathematically feasible in the LP by setting $u_i = d_i$.
     - Every feasible surrogate point projects to the same placements/base with exact deficit $d_i$; availability caps remain independently enforced.
     - Budget monotonicity: because legal prices $\ge 0$, $\text{spend}^* \le \text{spend}^{\text{LP}} \le \text{max\_price}$.
     - Weighted and augmented Tchebycheff objectives are nonincreasing in legal spend, with all active/inactive/all-zero cases included. Projection therefore cannot reduce score; minimal lifting and projection together establish equal feasible selected-build projections, exact maxima and the full optimizing projection/tie set. Surplus surrogate lifts at $p=0$ add no new selected-build tie preference.
     - Decoder, wallet, shopping lists, price axes and provenance always reconstruct $d_i$, never arbitrary $u_i$. No objective rewards surplus expense and no artificial epsilon/base-count penalty is introduced.
   - A qualified native dual bound upper-bounds the declared objective only after parsed-model equivalence, finite domains and complete objective-frame/outward-error corrections; raw HiGHS output alone is not a real-arithmetic physical certificate.
3. **Hard Budget Wallet Spend, Stored Price vs. Legal Acquisition, and Barter Valuations**:
   - Zero stored price does not establish free legal acquisition: standalone-inaccessible items are strictly governed by hard inventory caps ($\sum_s p_{i,s} \le \sum_b q_{b,i} base_b + N_{\text{owned}}(i)$); their supply/availability rows are never omitted.
   - Genuinely accessible zero-cost offers retain actual vendor provenance and $d_i$, never marked `'owned'`.
   - Mixed supply: an item can have free owned instances and positive $d_i$ for additional copies, allocated preset-first, owned-next, purchased-remainder.
   - Hard budget constraint `max_price`: applies strictly to real out-of-pocket currency/barter spend, with owned parts contributing zero marginal spend.
   - Established Barter Valuation: evaluated exactly as in `frontend/src/solver/dataService.ts:633–645`:
     $$\mathbf{\text{price}_{\text{barter}} = \text{Math.round}\left(\sum_{\text{req}} \text{count}_{\text{req}} \cdot \left(\text{avg24hPrice}_{\text{req}} \ ??\ \text{basePrice}_{\text{req}} \ ??\ 0\right)\right)}$$
4. **Permitted Model Reductions, Inlining & Equivalence Gates**:
   - **Optional Stage 4 Presence Substitution**: Require proved total physical capacity at most one, zero owned stock, no supply from any accessible preset, and exact presence/occurrence linking. Substitute the exact presence/count into every budget/objective/axis reader and reconstruct $d_i$ without a surrogate; no obsolete `buy` alias or shim survives.
   - **Optional Stage 4 Fully-Owned Elimination**: Require a proved safe capacity bound dominated by owned stock. Remove economic surrogate bookkeeping only; retain availability/supply caps, includes, conflicts, rootedness and occupancy.
   - **Auxiliary Axis Reduction & Recoil Inlining**: If `recoil_def` is removed, its multi-copy expression $\sum_i \text{item\_recoil}[i] \sum_s p_{i,s}$ must be directly inlined into every surviving constraint (`rec_v_lim`, `rec_sum_lim`, and `total_obj`), leaving no uncoupled free `rec_axis`.
   - **Recoil Cap Redundancy & Collapse**: When both `max_recoil_v` and `max_recoil_sum` are active, collapse into the single stricter bound $\text{mod} \le \min(\frac{Cap_V}{naked_V} - 1, \frac{Cap_{\text{Sum}}}{naked_V + naked_H} - 1)$ with positive denominator validation.
     For zero/unsupported denominators retain/evaluate the original physical cap or apply input/proof-failure policy; never silently drop a nontrivial cap. Inlined scaled recoil sums compare against `SCALE` times converted raw thresholds, with outward boundary allowances preserved.
   - Retain `total_obj` due to HiGHS parser line length limits. Retain `rec_axis` and `price_axis` when `use_tchebycheff: true`.
   - **Independent Physical-Oracle and Equivalence Proof Gates (Issue #36)**: Decoder/validation parity is an incumbent check; model reduction equivalence is delegated to Issue #36 oracle/equivalence proof gates across deterministic test suites.

## Consequences & Downstream Handoff

- **Issue #38 ([Choose prepared-model ownership and invalidation boundaries](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38))**: Unblocked to formulate prepared model caching, parameter sensitivity, and invalidation rules against this exact purchase reduction contract.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Unblocked to validate build purchasing, zero-spend assertions, and inventory caps in independent verification.

## Baseline and Adoption Boundary

- [Canonical #33](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/33#issuecomment-5972663056) controls, including its full linking/capacity/consumer guards. Stage 2 repairs exact semantics (including both ergonomics clamps); Stage 3 establishes the unreduced general-surrogate correctness baseline. Stage 4 may specialize clamps or remove equivalent rows/columns only with the lifting/projection theorem, exact fixture Gates A–C and applicable comparative evidence.
- Correctness cutover is not held hostage to optional speedup gates. Axis deletion must migrate every bound/native reader and leave no uncoupled free axis; `total_obj` stays as the parser seam and Tchebycheff axes remain. All proof-relevant auxiliaries require finite justified domains.
- Full consumer migration covers LP adapters, decoding/stats/economics, worker/client schemas, Optimize/Explore/Gunsmith/MOA-floor manifests, endpoints/caches, shopping lists and telemetry/reference validation. Legal zero-cost purchases keep offer provenance. Artificial inaccessible-item prices disappear without inventing free acquisition.
