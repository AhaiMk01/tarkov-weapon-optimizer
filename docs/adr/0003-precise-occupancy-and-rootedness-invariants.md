# ADR 0003: Precise Occupancy and Rootedness Invariants

## Status
Proposed (Refs #32). Amended 2026-10-02.

## Context
Following the authoritative physical and acquisition domain contract settled in ADR 0002 (#31), unrolling physical slots into an instance tree introduces key formulation requirements:
1. **Cycle Hazards & Finite Bounding**: While template-level cycles are absent in EFT game data, recursive item definitions (e.g. risers on risers or synthetic cycle tests) could cause tree unrolling to expand infinitely.
2. **Template Conflicts with Multi-Copy Parts**: A naive copy-sum constraint $\sum_{u \in A} x_u + \sum_{v \in B} x_v \le 1$ incorrectly penalizes legitimate duplicate copies of $A$ when $B$ is absent (e.g. $A+A$ is rejected).
3. **Occurrence-Specific Identity & Slot Conflicts**: Variables must be occurrence-specific $v = (i, s)$ to prevent satisfying multiple required slots with a single variable. Furthermore, slot conflicts (`conflicting_slot_ids`) must constrain target slot occupancy rather than creating false global item bans.
4. **Result Representation**: Client response shapes carry `selected_items: ItemDetail[]`, requiring occurrence-aware detail records rather than a flat string array.

## Decision

We establish four precise placement and rootedness invariants:

1. **No-Ancestor-Template-Repetition (Explicit Domain Restriction)**:
   - An item template $A$ cannot appear more than once along any single directed path from weapon root to leaf ($A \notin \text{Ancestors}(s)$).
   - Adopted as an explicit domain boundary to mathematically guarantee a finite instance universe without artificial depth cutoffs.
   - Legitimate multi-copy placements on independent parallel branches (e.g. dual rail panels, dual flashlights) remain unrestricted.
2. **Instance-Coupled Conditional Occupancy**:
   - Each physical slot instance is qualified as $s = (u, \text{templateSlotId})$, and candidate variables carry occurrence-specific identity $v = (i, s)$.
   - *Slot Mutex*: $\sum_{v \in \text{Allowed}(s)} x_v \le 1 \quad \forall s$.
   - *Optional Mod Activation*: $\sum_{v \in \text{Allowed}(s)} x_v \le x_u \quad \forall s = (u, \text{slot})$.
   - *Root Required Slot*: $\sum_{v \in \text{Allowed}(s)} x_v = 1$ (mandatory; empty candidate set proves root infeasibility $0 = 1$).
   - *Mod-Owned Required Slot*: $\sum_{v \in \text{Allowed}(s)} x_v = x_u$ (empty candidate set forces $x_u = 0$, propagating impossible-owner deactivation without false global infeasibility).
3. **Template Presence Conflicts & Slot-Occupancy Binding**:
   - For each conflicting template pair $(A, B)$ ($A \ne B$, symmetrized), mutual exclusion is enforced via presence indicators:
     $$y_A + y_B \le 1$$
     $$x_u \le y_A \quad \forall u \in \text{Instances}(A), \quad x_v \le y_B \quad \forall v \in \text{Instances}(B)$$
     (or pairwise instance exclusions $x_u + x_v \le 1$). This permits valid duplicate builds such as $A+A$ or $B+B$.
   - *Self-Conflicts*: If $A \in \text{conflicts}(A)$, $\sum_{u \in \text{Instances}(A)} x_u \le 1$.
   - *Slot Conflicts*: When instance $u$ is installed, for each raw slot ID $t \in \text{conflicting\_slot\_ids}(u)$, it blocks every physical occurrence of that slot on the weapon:
     $$x_u + \text{occupancy}(s_{\text{target}}) \le 1 \quad \forall s_{\text{target}} \in \text{PhysicalSlots}(t)$$
   - *Include/Exclude*: Exclude fixes all instances to 0; include enforces $\sum_{u \in \text{Instances}(inc)} x_u \ge 1$.
4. **Occurrence-Aware Result Manifest (`selected_items: ItemDetail[]`)**:
   - `selected_items: ItemDetail[]` carries occurrence-aware item detail records representing each installed physical component (preserving multiplicity).
   - Derived multiset item-ID representation (`selected_item_ids: string[]`) is provided for shopping-list and stash-offset projections.
   - `slot_pairs: { parentInstanceId, slotId, childInstanceId, itemId }[]` explicitly records parent-instance to child-instance attachment links for physical assembly and independent validation.

## Consequences & Downstream Contracts

- **Issue #33 (Purchase & Reductions)**: Formulate integer $\text{buy}_i$ variables and exact deficits against total installed instances $\sum_{s} p_{i,s}$.
- **Issue #36 (Oracles & Validation)**: Update `validateBuild` and test oracles to verify instance-level slot uniqueness and occurrence-aware item details.
- **Issue #38 (Prepared Boundaries)**: Prepared compatibility trees use instance-qualified slots with branch acyclicity caching.
