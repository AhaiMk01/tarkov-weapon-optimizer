# ADR 0011: Rejection of Continuous Placement and Retention of Binary Placement

## Status
Accepted (Refs #39). 2026-10-03.

## Context
Under the authoritative instance-aware physical domain ([ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0003 / Issue #32](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32)), items can occupy multiple distinct physical slots simultaneously, represented by occurrence placement variables $p_{i,s}$. In continuous precise placement proposals, relaxing $p_{i,s}$ to continuous intervals $[0, 1]$ and reconstructing discrete placement via post-solve bipartite matching was hypothesized to reduce integer decision variables. The proposal was previously rejected after simplex degeneracy, and was reconsidered under [Issue #39](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39) against formal mathematical structure and empirical HiGHS solve evidence.

## Decision

We establish five core conclusions permanently governing physical placement variables:

1. **Scope and Placement Invariant**:
   - The repaired **precise** model firmly retains binary decision variables ($p_{i,s} \in \{0, 1\}$) for all physical placement occurrences, with parent-instance/slot identity, capacities, conditional required occupancy, adopted rootedness/no-ancestor-template-repeat policy, quantity accounting and conflict semantics from the accepted placement contracts.
   - Fast-mode approximation and its existing certificate/authority limitations are unchanged. No production cutover, tolerance weakening, return to the rejected dense-TED target, or matching decoder is authorized by this decision.
2. **Structural Obstruction to Gate A (Lifting and Projection Equivalence)**:
   - After fixing integer base, item/count and owner choices, ordinary bipartite matching with integral capacities and required lower capacities can admit integral reconstruction.
   - Additional physical occupancy conflicts invalidate that argument. The naive candidate that retains only pairwise conflict inequalities admits an explicit synthetic declared-domain counterexample:
     - Six optional root slots all accept template $T$; their occupancy-conflict graph consists of two disjoint triangles (3-cliques: slots $\{0, 1, 2\}$ and $\{3, 4, 5\}$).
     - The installed count of $T$ is fixed to integer 3.
     - Placing $1/2$ in every slot satisfies capacities, the count equation ($\sum p = 3$), and all pairwise conflict inequalities ($0.5 + 0.5 = 1.0 \le 1$).
     - Each triangle admits at most one integral occupancy. Hence the maximum integral count is 2, and there is **zero integral reconstruction for the selected multiset of 3 copies**.
   - This proves that continuous placement admits fractional solutions that have no physical integer lifting, violating Gate A.
   - General conflict-aware maximum matching contains Independent Set, which is **NP-hard** in optimization and **NP-complete** in decision. No polynomial-time matching decoder has been proven admissible for this conditional conflict domain.
3. **Adoption Prerequisites Remain Unmet**:
   - Under ADR 0010 (Issue #36):
     - **Gate A**: Every legal physical selected build must lift, and every feasible model point must project to an independently valid physical witness. The naive candidate fails the reverse direction of Gate A.
     - **Gate B**: Must preserve the exact maximum objective value and all maximizing selected-build projections/ties under independent rational reference.
     - **Gate C**: Must preserve emptiness/infeasibility of the physical feasible set.
   - No applicable full reconstruction/equivalence theorem for an amended candidate has been established; thus it cannot be treated as an exact reduction or granted exact physical proof qualification.
   - The old integral-p incumbent check documents a decoder migration requirement, not a mathematical prohibition against integral reconstruction. A hypothetical candidate would require an actual integral matching algorithm with lower capacities and independent validation, never $Primal > 0.5$ decoding.
4. **No Empirical Performance or Implementation-Certification Claim**:
   - Retaining the adopted binary formulation does not require manufacturing a performance PASS. Any future performance-adoption proposal must supply the full paired comparative benchmark contract (ADR 0005 / Issue #37), including semantic request identity, independent baseline/candidate workers, artifact provenance, correct witnesses/certificates, planned denominators, tail/rate gates and nondegenerate BCa evidence.
   - Declaring placements binary does not mean every HiGHS branch-and-bound node has integer placements; LP relaxations at nodes can be fractional. Neither a binary declaration nor an optimal native status proves physical correctness by itself.
5. **Inherited Contracts and Future Reconsideration**:
   - Preserves all accepted contracts: instance-aware quantities (ADR 0002 / Issue #31), precise occupancy/rootedness (ADR 0003 / Issue #32), status/certificates/deadlines (ADR 0004 / Issue #35), provisional MOA authority (ADR 0006 / Issue #41), bound-safe numerics (ADR 0007 / Issue #34), owned inventory (ADR 0008 / Issue #42), exact purchase/reductions (ADR 0009 / Issue #33), and independent oracle equivalence gates (ADR 0010 / Issue #36).
   - Future reconsideration requires genuinely new, linked evidence for a precisely stated candidate: conditional reconstruction/domain theorem; full oracle gates; operation-specific witness and certificate integration; and admissible full comparative evidence. That would be a separate decision, not an automatic reopening authorized here.

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Must use binary precise placement and awaits any other open dependencies (awaiting #38).
