# ADR 0011: Rejection of Continuous Placement and Retention of Binary Placement

## Status
Proposed (Refs #39). Canonical Resolution 2026-10-03.

## Context
Under the authoritative instance-aware physical domain ([ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0003 / Issue #32](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32)), items can occupy multiple distinct physical slots simultaneously, represented by occurrence placement variables $p_{i,s}$. In continuous precise placement proposals, relaxing $p_{i,s}$ to continuous intervals $[0, 1]$ and reconstructing discrete placement via post-solve bipartite matching was hypothesized to reduce integer decision variables. The proposal was previously rejected after simplex degeneracy, and was reconsidered under [Issue #39](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39) against formal mathematical structure and empirical HiGHS solve evidence.

## Decision

We establish four core conclusions permanently governing physical placement variables:

1. **Definitive Decision: Retain Binary Placement Variables**:
   - The precise placement model firmly **retains binary decision variables** ($p_{i,s} \in \{0, 1\}$) for all physical placement occurrences.
   - Continuous placement relaxation ($p_{i,s} \in [0, 1]$) with post-solve matching reconstruction is **decisively rejected**.
2. **Mathematical Grounds: Loss of Total Unimodularity & NP-Completeness**:
   - Total Unimodularity (TU) is required for a continuous linear relaxation to guarantee integral vertices without branching.
   - While unconstrained bipartite matching is TU, the physical weapon model incorporates:
     (a) Cross-slot physical occupancy conflicts (`conflicting_slot_ids`);
     (b) Parent-instance coupling inequalities ($p_{i,s} \le x_{\text{owner}(s)}$);
     (c) Conditional required mod-slot occupancy ($\sum p_{i,s} = x_{\text{owner}}$);
     (d) Branch acyclicity poset constraints ($A \notin \text{Ancestors}(s)$);
     (e) Multi-copy purchase offsetting ($buy_i \ge \sum_s p_{i,s} - N_{\text{owned}} - q_{\text{preset}}$).
   - Evaluating the determinant of the constraint submatrix on standard odd conflict cycles yields $\mathbf{\det = 2 \notin \{0, 1, -1\}}$. The continuous LP relaxation possesses fractional extreme vertices ($p = 0.5$). The Birkhoff-von Neumann / König-Egerváry integral matching theorem is mathematically inapplicable.
   - Finding a maximum conflict-free matching on a general conflict graph is equivalent to **Independent Set**, which is **NP-complete**. No polynomial-time network flow or matching decoder can guarantee finding a conflict-free, physically rooted placement when physical conflicts exist.
3. **Empirical HiGHS Prototype Evidence (Frozen Snapshot `219443b4...`)**:
   An isolated prototype directly comparing binary placement (Arm A) to continuous placement (Arm B) in HiGHS demonstrated:
   - **Colt M4A1 (263 $p_{i,s}$ variables)**:
     - Arm A (Binary Placement): Solved to certified Optimal in **23.5 seconds** ($obj = 29{,}094.48$).
     - Arm B (Continuous Placement): **TIMED OUT at 30 seconds** with an inferior incumbent ($obj = 24{,}064.56$, a deficit of $5{,}029.92$ points).
   - **MP-133 Shotgun (15 $p_{i,s}$ variables)**:
     - Arm A (Binary Placement): Optimal in **55.8 ms**.
     - Arm B (Continuous Placement): Optimal in **87.8 ms** (Binary is **36% faster**).
   - **Simplex Degeneracy**: Declaring $p_{i,s}$ as binary enables HiGHS to apply integer presolve, variable probing, and binary clique cuts derived from the conflict graph. Relaxing $p_{i,s}$ to continuous deprives the solver of these cuts, resulting in severe simplex degeneracy, cycling, and slower branch-and-bound convergence.
4. **Non-Admissibility Under Equivalence & Incumbent Contracts**:
   - Fails Gate B of ADR 0010 (Issue #36): alters optimal values and drops optimal builds on dense weapons.
   - Violates the incumbent gate (`incumbentBlockReason` from `33c423b` / Issue #23): fractional $p$ solution vectors are blocked from becoming valid incumbents or certified proofs.

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Unblocked from the placement question; inherits binary placement as the fixed invariant for production cutover planning (awaiting #38).
