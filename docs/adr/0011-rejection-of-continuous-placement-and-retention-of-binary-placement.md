# ADR 0011: Rejection of Continuous Placement and Retention of Binary Placement

## Status
Accepted planning decision (Refs #39). Reconciled 2026-10-04; binary retention is conservative, not implementation certification.

## Context
Under the authoritative instance-aware domain ([ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31) and [ADR 0003 / Issue #32](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32)), physical occurrences use placement variables $p_{i,s}$. Relaxing them to $[0,1]$ with post-solve matching was hypothesized to reduce integer decisions. Issue #39 reconsidered that stated candidate against mathematical reconstruction and comparative evidence gates; unsupported earlier degeneracy/timing narratives are not premises.

## Decision

We retain the adopted binary formulation and reject this stated continuous candidate; this does not rule out every stronger continuous formulation or separately proved restricted subclass.

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
   - This is a selected-multiset lifting failure for the stated naive relaxation in a synthetic declared domain, not a claim that a pinned real weapon contains this graph. Non-TU or a fractional vertex alone does not establish projection failure for a particular right-hand side; some fractional points have valid equal-selection integral reconstructions.
   - General conflict-aware matching contains Independent Set through mutually disjoint matching edges with arbitrary conflicts between edges (optimization NP-hard; corresponding decision NP-complete). This does not prove polynomial reconstruction impossible for a separately proved restricted subclass or replace analysis of the actual conditional domain.
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
   - Binary declarations guarantee neither freedom from simplex cycling nor numerical safety. Unsupported M4A1/MP-133 timings, HITL claims, physically certified optima and causal timing explanations are not accepted evidence. A time-limited inferior incumbent is not proof of differing exact optima or lost ties.
5. **Inherited Contracts and Future Reconsideration**:
   - Preserves all accepted contracts: instance-aware quantities (ADR 0002 / Issue #31), precise occupancy/rootedness (ADR 0003 / Issue #32), status/certificates/deadlines (ADR 0004 / Issue #35), provisional MOA authority (ADR 0006 / Issue #41), bound-safe numerics (ADR 0007 / Issue #34), owned inventory (ADR 0008 / Issue #42), exact purchase/reductions (ADR 0009 / Issue #33), and independent oracle equivalence gates (ADR 0010 / Issue #36).
   - Future reconsideration requires genuinely new, linked evidence for a precisely stated candidate: conditional reconstruction/domain theorem; full oracle gates; operation-specific witness and certificate integration; and admissible full comparative evidence. That would be a separate decision, not an automatic reopening authorized here.

## Consequences & Downstream Handoff

- **Issue #40 ([Select the correctness-first handoff and adoption sequence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40))**: Uses binary precise placement in the complete correctness cutover. #38/#39 decisions are settled; executable correctness/native evidence remains outstanding.

## Canonical Authority

[Canonical #39](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39#issuecomment-5975761508) controls. Its synthetic review checks are mathematical contract evidence only, not a native/browser benchmark, implemented oracle or universal reconstruction theorem. Future reconsideration needs a precisely stated candidate, full declared-domain lifting/projection theorem, independent oracle Gates A–C and qualified consumer/native/comparative evidence.
