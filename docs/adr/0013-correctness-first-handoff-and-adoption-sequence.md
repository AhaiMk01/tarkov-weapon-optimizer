# ADR 0013: Correctness-First Handoff and Adoption Sequence

## Status
Proposed (Refs #40). Canonical Resolution 2026-10-04.

## Context
The decision map ([Issue #28](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/28)) resolved the authoritative physical domain (ADR 0002), precise occupancy and rootedness (ADR 0003), certificate and deadline semantics (ADR 0004), telemetry and comparative benchmarks (ADR 0005), provisional MOA authority (ADR 0006), bound-safe numerics and clamps (ADR 0007), stash inventory (ADR 0008), exact purchase deficits and reductions (ADR 0009), independent physical oracles (ADR 0010), binary placement retention (ADR 0011), and model preparation boundaries (ADR 0012). An implementation-ready cutover roadmap was required to govern execution without unverified intermediate states or backward-incompatible shims.

## Decision

We establish four core principles governing implementation sequencing, complete consumer migration, acceptance/rollback gates, and standing boundaries:

1. **Six-Stage Implementation-Ready Cutover Sequence**:
   - **Stage 1 (Verification Foundation)**: Independent Physical Oracle (raw JSON parsing, exhaustive enumeration in $\mathbb{Q}$, 14 scenario families) and upgraded `validateBuild.ts` (manifest validation, exact deficits $d_i$, normative MOA $K=100/2.9089$). *(Gate: Oracle and validateBuild pass on all 14 baseline scenario families before solver edits).*
   - **Stage 2 (Core Physical Correctness Repairs)**: Rooted instance compatibility graph, branch acyclicity ($A \notin \text{Ancestors}$), exact required-slot placement rows ($p_{i,s}$), physical slot-occupancy conflicts (`conflicting_slot_ids`), multi-copy preset supply ($q_{b,i}$), owned stash inventory ($N_{\text{owned}}$), unperturbed deficit acquisition ($u_i \ge d_i$), and hard inventory caps. *(Gate: 100% pass on all 14 Behavioral Regression Families against Tier 1 Oracle).*
   - **Stage 3 (Bound-Safe Numerics, Proof Gating & Outward Rounding)**: Full IEEE 754 `toString()` formatting, expression-DAG error bounds ($\gamma_3$ on $\text{MOA}^{\max}$, row continuous allowances $\epsilon_{\text{row}} \ge \delta_{\text{computed}}$), outward lower secant shift ($s_{\text{outward}}$), linear objective correction ($UB_{\text{valid}} = \text{nextUp}(UB + \Delta_{\text{obj}})$), precision-dependent `outwardSafeCeil`, and offset-grid UI ceiling snapping. *(Gate: Passes all numerical boundary & exact cancellation fixtures; zero false infeasibility).*
   - **Stage 4 (Three-Tier Model Preparation & Endpoint Reuse Seam)**: Tier 1 `preparePhysicalWeapon` & direct `computeStructuralBounds` (no unused LP), Tier 2 `prepareSubproblemDomain` & 24-parameter Invalidation Ledger, Tier 3 `specializeLP` (<0.5 ms assembly) & normalized endpoint scaling ($+10 fE, -100 fR, -0.1 fP$), and separate `endpointDomainKey` with tightened-tolerance reuse qualification. *(Gate: Zero stale filter leakage; 3-solve payoff normalization verified).*
   - **Stage 5 (Exact Model Reductions & Statistical Benchmark Adoption)**: Clamp specialization (0 binary vars in identity regime, 1 in upper/lower), second-clamp elimination ($factor \le 1.0$), $buy_i \equiv x_i$ substitution for single-capacity unowned non-preset mods, and recoil cap collapse into $\min(bound_V, bound_{\text{sum}})$. *(Gate: Gates A, B, C mathematical equivalence proof + full 4-gate comparative benchmark pass under ADR 0005).*
   - **Stage 6 (Public API, Web Worker, and UI Consumer Cutover)**: Exposes `owned_items?: string[]` across client schemas and Explore/MOA-floor; response manifest rendering (`price: 0`, `source: 'owned' | 'preset'`); clean cutover deleting legacy FiR/owned shortcuts and single-copy readers. *(Gate: End-to-end browser smoke test, clean build, zero TypeScript errors).*
2. **Complete Consumer Migration & Zero-Shim Policy**:
   - Migration executes directly across all eight affected layers (`dataService.ts`, `lpBuilder.ts`, `solver.ts`, `solver.worker.ts`, `client.ts`, UI `BuildManifest.tsx`, `validateBuild.ts`, and `benchmarks/`).
   - Strictly prohibits intermediate compatibility shims, dual-path wrappers, or fake fallbacks. Obsolete single-copy readers, flat preset sets, and `purchasable: false => FiR` shortcuts are completely deleted.
3. **Objective Acceptance, Reduction Adoption & Rollback Framework**:
   - **Correctness Repairs (Bug Fixes)**: Earn acceptance strictly via 100% pass across all 14 Behavioral Regression Families against the Physical Oracle and zero validation errors. Never required to demonstrate a 5% speedup.
   - **Exact Performance Reductions (Optimizations)**: Earn adoption via mathematical equivalence (Gates A, B, C) and Gate 3 on the full 4-gate comparative benchmark harness (ADR 0005: $\ge 5\%$ speedup, no tail regression). Gate 4 (Inconclusive) immediately triggers rollback to the unreduced baseline.
4. **Standing Boundaries & Decision Map Completion**:
   - Standing Dense-TED 60-second target remains a deferred stretch goal; no tolerance weakening or valid build dropping is permitted to manufacture a 60s completion.
   - Provisional MOA authority fence preserved (`approximate_optimal` under provisional model).
   - Python / CP-SAT remains differential cross-check evidence only; backend engine migration is out of scope.
   - **Completion of Decision Map ([Issue #28](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/28))**: With the resolution of Issue #40, all 14 sub-issues of the decision map are settled. The planning phase is 100% complete.

## Consequences & Downstream Handoff

- This capstone resolution concludes the decision map ([Issue #28](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/28)) and delivers the implementation handoff.
