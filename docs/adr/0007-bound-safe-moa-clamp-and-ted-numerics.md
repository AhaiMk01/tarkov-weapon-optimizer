# ADR 0007: Bound-Safe MOA, Clamp and TED Numerics

## Status
Proposed (Refs #34). Canonical Resolution v5 2026-10-03.

## Context
Auditing of `lpBuilder.ts`, `trueErgo.ts`, and spatial branch-and-bound search revealed numerical failure modes and unnecessary complexity:
1. **Fixed Big-M in Barrel Selection**: `lpBuilder.ts` hardcoded $M = 1000$ for replacement barrels. When negative accuracy modifiers (suppressors $-3\%, -5\%$) or synthetic fixtures were evaluated, the constraint falsely bound inactive barrels ($x_b = 0$), causing false infeasibility.
2. **Zero-Intrinsic COI Platforms & Missing Fallbacks**: Receiver check `if (baseCOI > 0)` skipped modular barrel constraints entirely when the receiver had `baseCOI == 0`. Constant-only presolve also omitted intrinsic fallback valuations when positive-COI barrels failed.
3. **Multiplicity Underestimation**: Summing reachable templates once underestimated worst-case negative accuracy on multi-copy physical slots.
4. **Precision Loss from Truncation**: Coefficients and RHS values formatted with `.toFixed(6)` rounded fractional numbers, causing exact boundary solutions to be rejected as infeasible by HiGHS.
5. **Redundant Binary Variables in Ergonomics Clamps**: Unconditional 3-regime clamping emitted 3 binary variables and 8 Big-M rows for `capped_ergo`, and blindly duplicated them for `effective_ergo`, even though structural bounds and non-positive equipment modifiers provably restrict values to $[0, 1000]$.
6. **TED Secant Validity**: The weight penalty curve $q(W) = \max(0, 100 - 300/W)$ is non-convex across $W = 3\text{ kg}$. An interval crossing $3\text{ kg}$ produces secants that cut above $q(W)$, producing invalid under-estimates of penalty that corrupt spatial upper bounds. Furthermore, secants are valid under-estimators only within their local weight interval.
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
4. **Derived Row-Wise Continuous Error Allowances & Dual-Model Relaxation Policy**:
   - Total floating-point evaluation deficit across any row on the admitted physical domain is derived using standard Higham backward error analysis: $\Delta_{\text{sum}} \le \gamma_{N_{\max}-1} \sum |a_i x_i|$ with $\gamma_{N-1} = \frac{(N-1) u}{1 - (N-1) u}$ ($u = 2^{-53} \approx 1.110223 \times 10^{-16}$).
   - Row-wise continuous allowances on verified software domains:
     - MOA rows ($N \le 200, \sum |a_i| \le 140, M \le 500$): $\delta_{\text{MOA}} \le 3.32 \times 10^{-12}\text{ MOA} \implies \epsilon_{\text{MOA}} = 10^{-7}\text{ MOA}$.
     - Ergonomics clamp rows ($N \le 200, \sum |a_i| \le 101{,}000, M \le 12{,}000\text{ scaled units}$): $\delta_{\text{ergo}} \le 2.25 \times 10^{-9}\text{ scaled units} \implies \epsilon_{\text{ergo}} = 10^{-6}\text{ scaled units}$ ($10^{-7}\text{ raw ergo}$).
     - Recoil rows (scaled $\times 1000$): $\epsilon_{\text{recoil}} = 10^{-6}$ scaled units.
     - Weight rows ($W \le 30\text{ kg}$): $\epsilon_{\text{weight}} = 10^{-7}\text{ kg}$.
   - Adding $\epsilon_{\text{row}}$ to inequality constraints ($\text{LHS} \ge \text{RHS} - \epsilon_{\text{row}}$) mathematically proves that the represented LP in HiGHS is a strict outer relaxation of the physical model.
   - Dual bounds provide valid upper bounds on the true objective; if a provable outer relaxation cannot be constructed, spatial proof is withheld.
   - Post-solve validation (`validateBuild`) against the unrelaxed original non-linear model with `VALIDATION_EPSILON = 1e-6` is the sole authoritative proof gate for discrete candidate feasibility. Prior verified incumbents are strictly retained upon later candidate validation failure.
5. **Exact Ergonomics Clamp Formulations & Second-Clamp Elimination**:
   - Specialize continuous `capped_ergo` ($t$) from unclipped structural bounds $[rawLo, rawHi]$ and `raw_ergo` ($r$):
     - Wholly below-zero ($rawHi \le 0$): $t = 0$ (**0 binary vars, 0 Big-M rows**).
     - Wholly above-cap ($rawLo \ge 1000$): $t = 1000$ (**0 binary vars, 0 Big-M rows**).
     - Identity ($rawLo \ge 0 \land rawHi \le 1000$): $t - r = 0$ (**0 binary vars, 0 Big-M rows**).
     - Upper Saturation Only ($0 \le rawLo \le 1000 < rawHi$): $t \le r$, $t \ge r - (rawHi - 1000)z$, $t \ge 1000 - (1000 - rawLo)(1 - z)$ with $z \in \{0, 1\}$ (**1 binary var, 3 linear rows**).
     - Lower Floor Only ($rawLo < 0 \le rawHi \le 1000$): $t \ge r$, $t \le r + (-rawLo)z$, $t \le rawHi(1 - z)$ with $z \in \{0, 1\}$ (**1 binary var, 3 linear rows**).
     - Full Disjunction ($rawLo < 0 \land rawHi > 1000$): Full 3-regime clamp with $M = \max(|rawLo|, |rawHi|, 1000) + 1000$ (**3 binary vars, 8 Big-M rows**).
   - Second Clamp Elimination: When equipment factor $factor = \max(0, 1 + \text{equipErgoModifier}) \le 1.0$, `effective_ergo` is provably contained in $[0, 1000]$. Eliminate the second clamp entirely: `effective_ergo - gear_ergo = 0` (**0 binary vars, 0 Big-M rows**).
6. **Spatial Bounds Weight Interval Enforcement & Exact Incumbent Scoring**:
   - Node weight intervals $[W_1, W_2]$ are enforced as hard LP bounds on `total_weight` ($W_1 \le \text{total\_weight} \le W_2$).
   - Initial weight intervals spanning $W = 3\text{ kg}$ must be split at root into $[W_{\min}, 3]$ and $[3, W_{\max}]$.
   - Every candidate build is re-scored with exact non-linear formulas before updating the incumbent.
7. **Precision-Dependent Bounded Rounding & Outward UI Submission Contract**:
   - `outwardSafeCeil(hi, decimals)` evaluated on precision-dependent safe representation domain $\text{MAX\_SAFE\_WITNESS}(\text{decimals}) = (\text{Number.MAX\_SAFE\_INTEGER} - 10) / 10^{\text{decimals}}$ for $\text{decimals} \in \{1, 2, 3, 4\}$.
   - Strictly validates `decimals` as integer in $\{1, 2, 3, 4\}$; withholds display rounding and returns `null` on unsupported precision, overflow, or representability failure, preserving raw witness $hi$.
   - Enforces strict postcondition `parsed >= hi`.
   - UI submission contract: zero-aligned grid or outward ceiling snap ($origin + \lceil \frac{hi - origin}{\Delta} \rceil \Delta$) on offset grids, backed by pre-submission guard ($\text{submitted\_cap} \ge hi$).
   - Evaluated under the provisional software model without claiming game-physics authority.

## Consequences & Downstream Handoff

- **Issue #38 ([Choose prepared-model ownership and invalidation boundaries](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38))**: Receives the clamp specialization, second-clamp elimination, and bound invalidation contracts; proceeds once purchase/row reductions resolve.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Receives the IEEE 754 precision, boundary padding, and independent validation requirements; proceeds once purchase/stash decisions resolve.
