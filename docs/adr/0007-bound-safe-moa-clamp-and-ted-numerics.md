# ADR 0007: Bound-Safe MOA, Clamp and TED Numerics

## Status
Proposed (Refs #34). Canonical Resolution v2 2026-10-03.

## Context
Auditing of `lpBuilder.ts`, `trueErgo.ts`, and spatial branch-and-bound search revealed numerical failure modes and unnecessary complexity:
1. **Fixed Big-M in Barrel Selection**: `lpBuilder.ts` hardcoded $M = 1000$ for replacement barrels. When negative accuracy modifiers (suppressors $-3\%, -5\%$) or synthetic fixtures were evaluated, the constraint falsely bound inactive barrels ($x_b = 0$), causing false infeasibility.
2. **Zero-Intrinsic COI Platforms & Missing Fallbacks**: Receiver check `if (baseCOI > 0)` skipped modular barrel constraints entirely when the receiver had `baseCOI == 0`. Constant-only presolve also omitted intrinsic fallback valuations when positive-COI barrels failed.
3. **Multiplicity Underestimation**: Summing reachable templates once underestimated worst-case negative accuracy on multi-copy physical slots.
4. **Precision Loss from Truncation**: Coefficients and RHS values formatted with `.toFixed(6)` rounded fractional numbers, causing exact boundary solutions to be rejected as infeasible by HiGHS.
5. **Redundant Binary Variables in Ergonomics Clamps**: Unconditional 3-regime clamping emitted 3 binary variables and 8 Big-M rows for `capped_ergo`, and blindly duplicated them for `effective_ergo`, even though structural bounds and non-positive equipment modifiers provably restrict values to $[0, 1000]$.
6. **TED Secant Validity**: The weight penalty curve $q(W) = \max(0, 100 - 300/W)$ is non-convex across $W = 3\text{ kg}$. An interval crossing $3\text{ kg}$ produces secants that cut above $q(W)$, producing invalid under-estimates of penalty that corrupt spatial upper bounds. Furthermore, secants are valid under-estimators only within their local weight interval.

## Decision

We establish six core numerical contracts:

1. **Correct Big-M Activation Direction for Replacement Barrels**:
   - For replacement barrel $b$ with $c_b = \text{coi}_b \cdot K$ and selector $x_b \in \{0, 1\}$:
     $$\frac{c_b}{100} A(x) - M_b x_b \ge c_b - L - M_b$$
     *(equivalently $-\frac{c_b}{100} A(x) + M_b x_b \le M_b - (c_b - L)$)*.
   - When $x_b = 1$, enforces $\text{MOA}_b \le L$.
   - When $x_b = 0$, non-binding for all feasible builds when $M_b = \max(0, \text{MOA}_b^{\max} - L)$, where $\text{MOA}_b^{\max} = c_b (1 - A_{\min} / 100)$.
   - If $\text{MOA}_b^{\max} \le L$, the row is vacuous and omitted entirely.
2. **Occurrence-Counted Negative-Accuracy Lower Bound ($A_{\min}$)**:
   - Sum worst-case negative accuracy modifiers across reachable **physical slot instances**:
     $$A_{\min} = \sum_{s \in \text{Slots}_{\text{reachable}}} \min\left(0, \min_{i \in \text{Allowed}(s)} \text{acc}_i\right)$$
   - Guarantees valid bounds under multi-copy placement without banning duplicate parts.
3. **Modular Barrel Invariant & Constant-Only Presolve with Fallback**:
   - Modular barrel constraints emit whenever barrels with $\text{coi}_b > 0$ exist, regardless of receiver intrinsic COI.
   - Any barrel with non-positive or missing COI falls back to $\text{baseCOI} \cdot K$.
   - For constant-only MOA: modular weapon is declared `model_infeasible` in presolve iff all replacement barrels fail, the fallback fails, and no-barrel builds are physically blocked by required slots.
   - Non-compliant barrels have $x_b = 0$ locked in presolve, propagating conditional required child slot rules.
4. **Full IEEE 754 `toString()` Formatting & Honest Error Budget**:
   - Format all LP numbers with `n.toString()` (standard ECMAScript Ryū/dtoa shortest round-trip decimal representation). Fixed truncation (`.toFixed(6)`) and precision-capped `toPrecision(15)` are prohibited.
   - Outward boundary safety pad $\epsilon_{\text{pad}} = 10^{-7}$ ($\text{LHS} \ge \text{RHS} - 10^{-7}$) serves solely as a continuous relaxation buffer.
   - Independent post-solve validation (`validateBuild`) against the unrelaxed original non-linear model with `VALIDATION_EPSILON = 1e-6` is the sole authoritative proof gate.
5. **4-Way Ergonomics Clamp Specialization & Second-Clamp Elimination**:
   - Specialize continuous `capped_ergo` using unclipped structural bounds $[rawLo, rawHi]$:
     - Case 1 ($rawLo \ge 0 \land rawHi \le 1000$): Identity `capped_ergo - raw_ergo = 0` (**0 binary vars, 0 Big-M rows**).
     - Case 2 ($rawLo \ge 0 \land rawHi > 1000$): 1-binary-var upper saturation clamp (**1 binary var, 3 rows**, with $M_{\text{hi}} = rawHi - 1000, M_{\text{lo}} = 1000 - rawLo$).
     - Case 3 ($rawLo < 0 \land rawHi \le 1000$): 1-binary-var lower floor clamp (**1 binary var, 3 rows**, with $M_{\text{neg}} = -rawLo, M_{\text{pos}} = rawHi$).
     - Case 4 ($rawLo < 0 \land rawHi > 1000$): Full 3-regime clamp (**3 binary vars, 8 rows**, with $y_{\text{low}} + y_{\text{mid}} + y_{\text{high}} = 1$).
   - Second Clamp Elimination: When equipment factor $factor = \max(0, 1 + \text{equipErgoModifier}) \le 1.0$, `effective_ergo` is provably contained in $[0, 1000]$. Eliminate the second clamp entirely: `effective_ergo - gear_ergo = 0` (**0 binary vars, 0 Big-M rows**).
   - Prepared bounds are bound to the physical occurrence domain and request scope under the standing invalidation conventions (ADR 0001 / Issue #22).
6. **Spatial Bounds Validity Domains & Exact Incumbent Scoring**:
   - Node weight intervals $[W_1, W_2]$ are enforced as hard LP bounds on `total_weight` ($W_1 \le \text{total\_weight} \le W_2$), ensuring secants are valid under-estimators within their local domain.
   - Initial weight intervals spanning $W = 3\text{ kg}$ must be split at root into $[W_{\min}, 3]$ (where $q(W) \equiv 0$) and $[3, W_{\max}]$ (concave).
   - Every candidate build is re-scored with exact non-linear formulas before updating the incumbent.

## Consequences & Downstream Handoff

- **Issue #38 ([Choose prepared-model ownership and invalidation boundaries](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/38))**: Receives the clamp specialization, second-clamp elimination, and bound invalidation contracts; proceeds once purchase/row reductions resolve.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Receives the IEEE 754 precision, boundary padding, and independent validation requirements; proceeds once purchase/stash decisions resolve.
