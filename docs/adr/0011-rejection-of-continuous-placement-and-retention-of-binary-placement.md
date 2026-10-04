# ADR 0011: Rejection of Continuous Placement and Retention of Binary Placement

## Status
Proposed (Refs #39). Canonical Resolution v2 2026-10-03.

## Context
Under the authoritative instance-aware physical domain ([ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0003 / Issue #32](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32)), items can occupy multiple distinct physical slots simultaneously, represented by occurrence placement variables $p_{i,s}$. In continuous precise placement proposals, relaxing $p_{i,s}$ to continuous intervals $[0, 1]$ and reconstructing discrete placement via post-solve bipartite matching was hypothesized to reduce integer decision variables. The proposal was previously rejected after simplex degeneracy, and was reconsidered under [Issue #39](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39) against formal mathematical structure and empirical HiGHS solve evidence.

## Decision

We establish four core conclusions permanently governing physical placement variables:

1. **Definitive Decision: Retain Binary Placement Variables**:
   - The repaired precise placement model firmly **retains the already-adopted binary placement formulation** ($p_{i,s} \in \{0, 1\}$) for all physical placement occurrences.
   - The candidate continuous placement relaxation ($p_{i,s} \in [0, 1]$) with post-solve matching reconstruction is **not admitted** to the solver.
2. **Structural Obstruction to Gate A (Lifting and Projection Equivalence)**:
   - A continuous relaxation cannot be adopted as an exact reduction unless it satisfies Gate A of ADR 0010 (Issue #36), requiring that every feasible model selection lifts to a valid physical build and every integer solution projects to an independently valid physical witness.
   - While a non-totally-unimodular constraint matrix does not by itself preclude integer vertices for a specific right-hand side, the naive continuous placement relaxation suffers from a fundamental **lifting failure** on physical conflict graphs:
     - *Counterexample (Disjoint Conflict Triangles)*: Consider six optional root slots admitting template $T$, with physical slot-occupancy conflicts (`conflicting_slot_ids`) partitioned into two disjoint triangles (slots $\{0, 1, 2\}$ and slots $\{3, 4, 5\}$). If the integer installed count is fixed to $3$, the continuous placement vector $p = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]$ satisfies individual slot capacity ($0 \le p_s \le 1$), total installed count ($\sum p_s = 3$), and all pairwise conflicts ($p_u + p_v = 1.0 \le 1$). Over integers, however, each triangle permits at most one installed copy, so the maximum physical integer count across both triangles is $1 + 1 = 2$. For fixed count $3$, exhaustive binary enumeration over all $2^6 = 64$ vectors reveals **exactly zero valid integral witnesses**. The continuous relaxation admits a fractional solution with count $3$ that has no physical integer lifting, violating Gate A.
   - Furthermore, finding a maximum conflict-free matching on general conflict graphs contains Independent Set, which is **NP-hard** in optimization and **NP-complete** in decision. No polynomial-time matching decoder has been proven admissible for this conditional conflict domain.
3. **Non-Admissibility Under Equivalence and Benchmark Contracts**:
   - Deficit under ADR 0010 Equivalence Gates: The continuous placement proposal lacks a proved reconstruction theorem that resolves non-bipartite conflict graphs without admitting false feasible selections or altering optimal tie sets.
   - Absence of Comparative Benchmark Evidence (ADR 0005): Performance adoption requires paired browser-worker benchmark evidence under the full 4-gate protocol demonstrating a statistically significant $\ge 5\%$ practical speedup without tail regressions. No such evidence has been established for continuous placement with a matching decoder.
   - Conservative Architecture Principle: Retaining the proven binary formulation guarantees that every branch-and-bound node evaluated by HiGHS operates on exact integer placement semantics, preventing simplex cycling and ensuring full compatibility with the accepted incumbent gate (`incumbentBlockReason` from `33c423b` / Issue #23).
4. **Preserved Contracts & Downstream Handoff**:
   - Preserves all accepted domain and authority contracts: instance-aware multi-copy placement (ADR 0002 / Issue #31), precise occupancy and rootedness invariants (ADR 0003 / Issue #32), end-to-end certificate semantics (ADR 0004 / Issue #35), telemetry identity (ADR 0005 / Issue #37), provisional MOA authority fences (ADR 0006 / Issue #41), bound-safe numerics (ADR 0007 / Issue #34), stash inventory (ADR 0008 / Issue #42), exact purchase deficit (ADR 0009 / Issue #33), and independent oracle equivalence gates (ADR 0010 / Issue #36).
   - Binary placement remains the fixed invariant for:
     - **[Issue #40: Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40)** (awaiting #38).

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Unblocked from the placement question; inherits binary placement as the fixed invariant for production cutover planning (awaiting #38).
