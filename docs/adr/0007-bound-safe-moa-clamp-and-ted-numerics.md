# ADR 0007: Bound-Safe MOA, Clamp and TED Numerics

## Status
Accepted (Refs #34). 2026-10-03.

## Context
Auditing of `lpBuilder.ts`, `trueErgo.ts`, and spatial branch-and-bound search revealed numerical failure modes and unnecessary complexity:
1. **Fixed Big-M in Barrel Selection**: `lpBuilder.ts` hardcoded $M = 1000$ for replacement barrels. When negative accuracy modifiers (suppressors $-3\%, -5\%$) or synthetic fixtures were evaluated, the constraint falsely bound inactive barrels ($x_b = 0$), causing false infeasibility.
2. **Zero-Intrinsic COI Platforms & Missing Fallbacks**: Receiver check `if (baseCOI > 0)` skipped modular barrel constraints entirely when the receiver had `baseCOI == 0`. Constant-only presolve also omitted intrinsic fallback valuations when positive-COI barrels failed.
3. **Multiplicity Underestimation**: Summing reachable templates once underestimated worst-case negative accuracy on multi-copy physical slots.
4. **Precision Loss from Truncation**: Coefficients and RHS values formatted with `.toFixed(6)` rounded fractional numbers, causing exact boundary solutions to be rejected as infeasible by HiGHS.
5. **Redundant Binary Variables in Ergonomics Clamps**: Unconditional 3-regime clamping emitted 3 binary variables and 8 Big-M rows for `capped_ergo`, and blindly duplicated them for `effective_ergo`, even though structural bounds and non-positive equipment modifiers provably restrict values to $[0, 1000]$.
6. **TED Secant Validity**: The weight penalty curve $q(W) = \max(0, 100 - 300/W)$ is non-convex across $W = 3\text{ kg}$. An interval crossing $3\text{ kg}$ produces secants that cut above $q(W)$, producing invalid under-estimates of penalty that corrupt spatial upper bounds. Furthermore, floating endpoint evaluations introduce small upward biases that can cause unshifted floating secants to exceed real penalty.
7. **Floor Display Downward Deficit**: Naive ceiling rounding on binary64 floats suffers from multiplication roundoff ($0.043000000000000003 \times 1000 = 43.0$), causing display floor to be strictly smaller than the witness value.

## Decision

We establish six core numerical contracts:

1. **MOA Formulation, Correct Big-M & Edge-Path Coverage**:
   - For replacement barrel $b$ with $\text{coi}_b > 0$, define $c_b = \text{coi}_b \cdot K$ ($K = 100 / 2.9089$).
   - Row coefficients are unscaled: $\frac{c_b}{100}$ and RHS $c_b - L$ (no double-K multiplication):
     $$\frac{c_b}{100} A(x) - M_b x_b \ge c_b - L - M_b$$
   - Non-binding when $x_b = 0$ with $M_b = \max(0, \text{MOA}_b^{\max} - L)$, where $\text{MOA}_b^{\max} = c_b (1 - A_{\min} / 100)$.
   - Nonconstant Intrinsic Fallback Rows:
     - When no positive replacement barrels exist: emit unconditional $\frac{c_{\text{base}}}{100} A(x) \ge c_{\text{base}} - L$.
     - When positive replacement barrels exist: emit $\frac{c_{\text{base}}}{100} A(x) + M_{\text{fb}} \sum_{b} x_b \ge c_{\text{base}} - L$, omitted if a positive barrel is required by the rooted conditional occupancy graph.
   - Nonpositive/missing COI barrels fall back to intrinsic $c_{\text{base}}$.
2. **Conservative Occurrence-Counted Negative-Accuracy Lower Bound ($A_{\min}$)**:
   - Sum worst-case negative accuracy modifiers across reachable **physical slot instances**:
     $$A_{\min} = \sum_{s \in \text{Slots}_{\text{reachable}}} \min\left(0, \min_{i \in \text{Allowed}(s)} \text{acc}_i\right)$$
   - Defined as a provably valid conservative lower bound on installed accuracy (and $\text{MOA}_b^{\max}$ as a conservative upper bound on dispersion), preserving multi-copy placement without claiming an attainable supremum.
3. **Constant-Only Modular Presolve with Graph-Based Impossibility**:
   - Impossibility Predicate: A weapon under constant accuracy is provably incapable of meeting $\text{maxMOA}$ if:
     $$(\forall b \in \text{Eligible Positive Barrels}: C_b > L) \land (\text{fallback is physically impossible} \lor C_{\text{fallback}} > L)$$
     where $\text{Eligible}$ means physically feasible complete alternatives under rooted conditional occupancy and locks.
   - Fallback is physically impossible iff every valid physical build rooted from the weapon is required by slot hierarchy and locks to select a positive-COI barrel.
   - Barrel elimination ($x_b = 0$) propagates conditional required child slot rules.
4. **Full Operation-Level Error Enclosures and Row Gates**:
   - $\text{MOA}^{\max} = c_b \cdot (1 - A_{\min}/100)$ error bound incorporates full three-operation $\gamma_3 = \frac{3u}{1-3u}$ analysis with uncertainty products:
     $$\Delta_{\text{MOA}^{\max}} \le \gamma_3 \cdot |c_b| \left(1 + \frac{|A_{\min}|}{100}\right) + \Delta_{c_b} \left(1 + \frac{|A_{\min}|}{100}\right) + \frac{|c_b| + \Delta_{c_b}}{100} \Delta_{A_{\min}}$$
   - Error in $M = \max(0, \text{MOA}^{\max} - L)$ is bounded by operand magnitudes $\Delta_M \le u (\text{MOA}^{\max} + L) + \Delta_{\text{MOA}^{\max}} + \Delta_L$, NOT the cancelled result $M$.
   - Higham backward summation analysis: $\Delta_{\text{sum}} \le \gamma_{N_{\max}-1} \sum |a_i| B_i$ with $\gamma_{N-1} = \frac{(N-1) u}{1 - (N-1) u}$ ($u = 2^{-53} \approx 1.110223 \times 10^{-16}$) and $B_i = \max(|lower_i|, |upper_i|)$.
   - Directly accommodates fractional data inputs (such as Elcan SpecterDR plate $0.0155\text{ kg} = 15.5\text{ g}$) as exact binary64 floats without integer rounding.
   - For each emitted row $k$, computes conservative construction error $\delta_{\text{computed}}(k)$ accumulated with outward-directed rounding, and dynamically gates against outward allowances: $\epsilon_{\text{row}}(k) \ge \delta_{\text{computed}}(k)$.
   - Applied directions: $\text{LHS} \ge \text{RHS} - \epsilon_{\text{row}}$ for $\ge$; $\text{LHS} \le \text{RHS} + \epsilon_{\text{row}}$ for $\le$; bounded $[-\epsilon, +\epsilon]$ for continuous equalities.
   - Continuous outer relaxation mathematically guarantees that the LP dual bound is a valid upper bound on the true physical objective if and only if all row-domain checks and outward objective-correction gates succeed.
   - If on any row $\delta_{\text{computed}}(k) > \epsilon_{\text{row}}(k)$, or if finite bounds, overflow, or subnormals cannot be verified, spatial proof is withheld (`physical_certificate: 'feasible'` with incumbent, `'none'` without).
   - Post-solve validation (`validateBuild`) against unrelaxed original model with `VALIDATION_EPSILON = 1e-6` is the sole check for candidate feasibility. Prior verified incumbents are strictly retained upon later candidate validation failure.
5. **Exact Ergonomics Clamp Formulations & Second-Clamp Elimination**:
   - Specialize continuous `capped_ergo` ($t$) from unclipped structural bounds $[rawLo, rawHi]$ and `raw_ergo` ($r$):
     - Wholly below-zero ($rawHi \le 0$): $t = 0$ (**0 binary vars, 0 Big-M rows**).
     - Wholly above-cap ($rawLo \ge 1000$): $t = 1000$ (**0 binary vars, 0 Big-M rows**).
     - Identity ($rawLo \ge 0 \land rawHi \le 1000$): $t - r = 0$ (**0 binary vars, 0 Big-M rows**).
     - Upper Saturation Only ($0 \le rawLo \le 1000 < rawHi$): $t \le r$, $t \ge r - (rawHi - 1000)z$, $t \ge 1000 - (1000 - rawLo)(1 - z)$ with $z \in \{0, 1\}$ (**1 binary var, 3 linear rows**).
     - Lower Floor Only ($rawLo < 0 \le rawHi \le 1000$): $t \ge r$, $t \le r + (-rawLo)z$, $t \le rawHi(1 - z)$ with $z \in \{0, 1\}$ (**1 binary var, 3 linear rows**).
     - Full Disjunction ($rawLo < 0 \land rawHi > 1000$): Full 3-regime clamp with $M = \max(|rawLo|, |rawHi|, 1000) + 1000$ (**3 binary vars, 8 Big-M rows**).
   - Second Clamp Elimination: When equipment factor $factor = \max(0, 1 + \text{equipErgoModifier}) \le 1.0$, `effective_ergo` is provably contained in $[0, 1000]$. Eliminate the second clamp entirely: `effective_ergo - gear_ergo = 0` (**0 binary variables, 0 Big-M rows**).
6. **Node-Specific Secant Shift & Objective Upper-Bound Proof**:
   - For node interval $[W_1, W_2]$ with $W_1 \ge 3\text{ kg}$, computes node-specific secant construction error bound $\delta_{\text{secant\_node}}$ (handling singleton $W_2 == W_1$ and non-singleton $W_2 > W_1$).
   - Downward Secant Shift: $\tilde{c}_{\text{outward}} = \text{nextDown}(\tilde{c} - \Delta_{\text{secant\_node}})$ guarantees $s_{\text{outward}}(W) \le q(W)$ for all $W \in [W_1, W_2]$, held strictly within enforced LP bounds $W_1 \le \text{total\_weight} \le W_2$.
   - Linear Objective Correction over Absolute Variable Domains:
     $$\Delta_{\text{obj\_linear}} = \sum_j \Delta_{c_j} B_j + \Delta_{\text{const}} \quad \text{where } B_j = \max(|lower_j|, |upper_j|)$$
   - Total Objective Error Correction: $\Delta_{\text{obj}} = \Delta_{\text{obj\_linear}} + \Delta_{\text{secant\_node}}$.
   - Valid Upper Bound Evaluated with Outward Rounding:
     $$\mathbf{UB_{\text{valid}} = \text{nextUp}(UB_{\text{native}} + \Delta_{\text{obj}})}$$
     mathematically proving that the LP dual bound on any node is a strict upper bound on the true physical objective over reals, and accounting for this correction in spatial gap and pruning ($UB_{\text{valid}} - LB \le \text{tolerance}$).
   - Proof withholding statuses: with verified incumbent $\implies$ `status: 'feasible'`, `physical_certificate: 'feasible'`, `lower_bound: incumbent.objective`, `upper_bound: null`; without verified incumbent $\implies$ `status: 'incomplete'`, `physical_certificate: 'none'`, `lower_bound: null`.
7. **Precision-Dependent Bounded Rounding & Outward UI Submission Contract**:
   - `outwardSafeCeil(hi, decimals)` evaluated on precision-dependent safe representation domain $\text{MAX\_SAFE\_WITNESS}(\text{decimals}) = (\text{Number.MAX\_SAFE\_INTEGER} - 10) / 10^{\text{decimals}}$ for $\text{decimals} \in \{1, 2, 3, 4\}$.
   - Strictly validates `decimals` as integer in $\{1, 2, 3, 4\}$; withholds display rounding and returns `null` on unsupported precision, overflow, or representability failure, preserving raw witness $hi$.
   - Enforces strict postcondition `parsed >= hi`.
   - UI submission contract: zero-aligned grid or outward ceiling snap ($origin + \lceil \frac{hi - origin}{\Delta} \rceil \Delta$) on offset grids, backed by pre-submission guard ($\text{submitted\_cap} \ge hi$).
   - Evaluated under the provisional software model without claiming game-physics authority.

## Consequences & Downstream Handoff

- **Issue #38 ([Choose prepared-model ownership and invalidation boundaries](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38))**: Receives the clamp specialization, second-clamp elimination, and bound invalidation contracts; proceeds once purchase/row reductions resolve.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Receives the IEEE 754 precision, boundary padding, and independent validation requirements; proceeds once purchase/stash decisions resolve.
