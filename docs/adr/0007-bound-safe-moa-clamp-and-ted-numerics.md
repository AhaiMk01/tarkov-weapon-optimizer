# ADR 0007: Bound-Safe MOA, Clamp and TED Numerics

## Status
Accepted (Refs #34). 2026-10-03.

## Context
Auditing of `lpBuilder.ts`, `trueErgo.ts`, and spatial branch-and-bound search revealed numerical failure modes and unnecessary complexity:
1. **Fixed Big-M in Barrel Selection**: `lpBuilder.ts` hardcoded $M = 1000$ for replacement barrels. When negative accuracy modifiers (suppressors $-3\%, -5\%$) or synthetic fixtures were evaluated, the constraint falsely bound inactive barrels ($x_b = 0$), causing false infeasibility.
2. **Zero-Intrinsic COI Platforms**: Receiver check `if (baseCOI > 0)` skipped modular barrel constraints entirely when the receiver had `baseCOI == 0`, failing to constrain barrels.
3. **Constant-Only MOA Platforms**: When no reachable mods carried non-zero accuracy modifiers, `terms.length === 0` caused the solver to emit zero MOA rows, returning invalid builds when constant MOA exceeded `max_moa`.
4. **Precision Loss from Truncation**: Coefficients and RHS values formatted with `.toFixed(6)` rounded fractional numbers, causing exact boundary solutions to be rejected as infeasible by HiGHS.
5. **Redundant Binary Variables in Ergonomics Clamps**: Unconditional 3-regime clamping emitted 3 binary variables and 8 Big-M rows for `capped_ergo`, and blindly duplicated them for `effective_ergo`, even though structural bounds and non-positive equipment modifiers provably restrict values to $[0, 1000]$.
6. **TED Secant Validity**: The weight penalty curve $q(W) = \max(0, 100 - 300/W)$ is non-convex across $W = 3\text{ kg}$. An interval crossing $3\text{ kg}$ produces secants that cut above $q(W)$, producing invalid under-estimates of penalty that corrupt spatial upper bounds.

## Decision

We establish five core numerical contracts:

1. **Data-Derived Signed-Accuracy Big-M ($M_b$)**:
   - To make unselected barrel constraints ($x_b = 0$) mathematically vacuous under any feasible attachment combination, derive $M_b$ by summing reachable negative accuracy modifiers:
     $$\text{acc}_{\min} = \sum_{i \in \text{Reachable}, \text{acc}_i < 0} \text{acc}_i$$
     $$M_b = \text{coi}_b \cdot K \cdot \left(1 - \frac{\text{acc}_{\min}}{100}\right)$$
   - If $M_b \le \text{maxMOA}$: Barrel $b$ unconditionally satisfies $\text{maxMOA}$; omit row entirely.
   - If $M_b > \text{maxMOA}$: Emit exact row:
     $$\sum_i \left(\frac{\text{coi}_b \cdot K}{100} \text{acc}_i\right) x_i + M_b x_b \ge \text{coi}_b \cdot K - \text{maxMOA}$$
2. **Modular Barrel Invariant & Constant-Only Presolve**:
   - Remove `baseCOI > 0` prerequisite: modular barrel constraints emit whenever barrels with $\text{coi}_b > 0$ exist.
   - For constant-only MOA (zero accuracy modifiers across all reachable mods):
     - Fixed barrel: If $C = \text{baseCOI} \cdot K > \text{maxMOA} \implies$ return `status: 'model_infeasible'` in presolve; else omit row.
     - Modular barrels: Fix $x_b = 0$ for any barrel with $C_b > \text{maxMOA}$. If all barrels exceed $\text{maxMOA} \implies$ return `status: 'model_infeasible'` in presolve. Emit zero Big-M rows.
3. **Full IEEE 754 Precision & Boundary Padding Contract**:
   - Format all LP numbers with full precision ($\ge 15$ significant digits or `.toString()`), eliminating `.toFixed(6)` truncation.
   - Formulate LP inequality boundaries with an outward numerical safety pad $\epsilon_{\text{pad}} = 10^{-7}$ relative to `VALIDATION_EPSILON = 1e-6`:
     $$\text{LHS} \ge \text{RHS} - 10^{-7}$$
     guaranteeing that exact mathematical boundary solutions are not rejected by solver feasibility tolerances.
4. **4-Way Ergonomics Clamp Specialization & Second-Clamp Elimination**:
   - Specialize `capped_ergo` using provable structural bounds $[rawLo, rawHi]$:
     - Case 1 ($rawLo \ge 0 \land rawHi \le 1000$): Identity `capped_ergo - raw_ergo = 0` (**0 binary vars, 0 Big-M rows**).
     - Case 2 ($rawLo \ge 0 \land rawHi > 1000$): 1-binary-var upper saturation clamp (**1 binary var, 3 rows**).
     - Case 3 ($rawLo < 0 \land rawHi \le 1000$): 1-binary-var lower floor clamp (**1 binary var, 3 rows**).
     - Case 4 ($rawLo < 0 \land rawHi > 1000$): Full 3-regime clamp (**3 binary vars, 8 rows**).
   - Second Clamp Elimination: When equipment factor $factor = \max(0, 1 + \text{equipErgoModifier}) \le 1.0$, `effective_ergo` is provably contained in $[0, 1000]$. Eliminate the second clamp entirely: `effective_ergo - gear_ergo = 0` (**0 binary vars, 0 Big-M rows**).
5. **3 kg Root Split & Bound Provenance Separation**:
   - Initial weight intervals spanning $W = 3\text{ kg}$ must be split at the root node into $[W_{\min}, 3]$ (where $q(W) \equiv 0$) and $[3, W_{\max}]$ (where $q(W)$ is strictly concave and secants are guaranteed under-estimators of $q(W)$ and valid upper bounds on TED).
   - Search intervals and queues strictly operate on tight physical domain extrema (`provenance: 'structural_dag'`). Padded Big-M constants are strictly isolated to LP equation coefficients.

## Consequences & Downstream Handoff

- **Issue #38 (Exact LP Reductions)**: Implements clamp specialization and second-clamp elimination, eliminating up to 6 binary variables and 16 Big-M rows per solve.
- **Issue #36 (Oracles & Validation)**: Implements full IEEE 754 precision and outward $\epsilon_{\text{pad}} = 10^{-7}$ in `validateBuild` and benchmark tests.
