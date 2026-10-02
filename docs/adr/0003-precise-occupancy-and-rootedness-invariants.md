# ADR 0003: Precise Occupancy and Rootedness Invariants

## Status
Accepted (Refs #32).

## Context
Following the authoritative physical and acquisition domain contract settled in ADR 0002 (#31), unrolling physical slots into an instance tree introduces two major formulation challenges:
1. **Cycle Hazards & Tree Bounding**: While template-level cycles are currently absent in EFT game data, recursive item definitions (e.g. risers on risers or synthetic cycle tests) could cause tree unrolling to expand infinitely.
2. **Coupled Occupancy & Slot Conflicts**: Naive global slot-ID constraints incorrectly conflate identical slot names on distinct parent instances (such as two-piece handguards where both receiver and handguard define `mod_handguard`). Furthermore, audit evidence revealed that modeling slot conflicts (`conflicting_slot_ids`) as global item bans resulted in false infeasibility when an item was legal in another non-conflicting slot.

## Decision

We establish four precise placement and rootedness invariants:

1. **Strict Directed Branch Acyclicity (Q1: Option A)**:
   - An item template $A$ cannot appear more than once along any single directed path from weapon root to leaf ($A \notin \text{Ancestors}(s)$).
   - Recursive edges ($A \to \dots \to A$) are pruned during tree unrolling.
   - Legitimate multi-copy placements on parallel branches (e.g. dual rail panels, dual flashlights) remain independent.
   - Mathematically guarantees a strictly finite instance universe without artificial depth caps or build truncation.
2. **Instance-Coupled Conditional Occupancy (Q2: Option A)**:
   - Each physical slot instance is qualified as $s = (u, \text{templateSlotId})$.
   - *Slot Mutex*: $\sum_{v \in \text{Allowed}(s)} x_v \le 1 \quad \forall s$.
   - *Optional Mod Activation*: $\sum_{v \in \text{Allowed}(s)} x_v \le x_u \quad \forall s = (u, \text{slot})$.
   - *Root Required Slot*: $\sum_{v \in \text{Allowed}(s)} x_v = 1$ (mandatory; empty candidate set proves root infeasibility $0 = 1$).
   - *Mod-Owned Required Slot*: $\sum_{v \in \text{Allowed}(s)} x_v = x_u$ (empty candidate set forces $x_u = 0$, propagating impossible-owner deactivation without false global infeasibility).
3. **Symmetrized Template Conflicts & Direct Slot-Occupancy Conflicts (Q3: Option A)**:
   - Template-to-template conflicts in upstream data are symmetrized across all placed instances:
     $$\sum_{u \in \text{Instances}(A)} x_u + \sum_{v \in \text{Instances}(B)} x_v \le 1 \quad \forall (A, B) \text{ where } A \in \text{conflicts}(B) \lor B \in \text{conflicts}(A)$$
   - Slot conflicts (`conflicting_slot_ids`) constrain physical slot occupancy directly:
     $$x_u + \text{occupancy}(s_{\text{target}}) \le 1$$
     avoiding false global bans when the item in another non-conflicting slot remains legal.
   - Exclude items fix $x_u = 0$ for all instances; include items enforce $\sum_{u \in \text{Instances}(inc)} x_u \ge 1$.
4. **Instance Tree Manifest with Multiset Projections (Q4: Option A)**:
   - Build exports preserve the full physical assembly structure:
     `slot_pairs: { parentInstanceId: string, slotId: string, childInstanceId: string, itemId: string }[]`
   - `selected_items: string[]` retains element multiplicity as a multiset array.
   - `validateBuild` verifies that each physical slot instance is occupied at most once, parent instances are rooted, and stats sum across all placed instances.

## Consequences & Downstream Contracts

- **Issue #33 (Purchase & Reductions)**: Formulate integer $\text{buy}_i$ variables and exact deficits against total installed instances $\sum_{s} p_{i,s}$.
- **Issue #36 (Oracles & Validation)**: Update `validateBuild` and test oracles to verify instance-level slot uniqueness and directed branch acyclicity.
- **Issue #38 (Prepared Boundaries)**: Prepared compatibility trees use instance-qualified slots with branch acyclicity caching.
