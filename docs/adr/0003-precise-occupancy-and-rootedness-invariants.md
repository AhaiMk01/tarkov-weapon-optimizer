# ADR 0003: Precise Occupancy and Rootedness Invariants

## Status
Accepted (Refs #32). Closed 2026-10-02.

## Context
Following the authoritative physical and acquisition domain contract settled in ADR 0002 (#31), unrolling physical slots into an instance tree introduces key formulation requirements:
1. **Cycle Hazards & Finite Bounding**: While template-level cycles are absent in EFT game data, recursive item definitions (e.g. risers on risers or synthetic cycle tests) could cause tree unrolling to expand infinitely.
2. **Template Conflicts with Multi-Copy Parts**: A naive copy-sum constraint $\sum_{u \in A} x_u + \sum_{v \in B} x_v \le 1$ incorrectly penalizes legitimate duplicate copies of $A$ when $B$ is absent (e.g. $A+A$ is rejected).
3. **Occurrence-Specific Identity & Slot Conflicts**: Variables must be occurrence-specific $v = (i, s)$ to prevent satisfying multiple required slots with a single variable. Furthermore, slot conflicts (`conflicting_slot_ids`) must constrain target slot occupancy rather than creating false global item bans.
4. **Instance-Bound Result Contract**: Client response shapes carry `selected_items: ItemDetail[]`, requiring unique `instanceId` keys on each detail record to establish a 1-to-1 bijection with manifest `childInstanceId`s.

## Decision

We establish the canonical precise placement, occupancy, conflict, and manifest contract across five principles:

1. **Variables & Occurrence-Specific Ownership**:
   - Binary $x_v \in \{0, 1\}$ for each occurrence-specific candidate $v = (i, s)$.
   - Each physical slot instance is qualified as $s = (u, \text{templateSlotId})$, where $u$ is the unique parent instance ID ($u = \text{weapon\_0}$ for root slots, or $u = v_{\text{parent}}$ for mod child slots).
   - The set $\text{Allowed}(s)$ contains occurrence-specific instance IDs $v = (i, s)$. Each candidate variable has exactly one immutable parent slot and cannot satisfy multiple slot constraints.
2. **Finite Instance Universe & Branch Acyclicity (Explicit Domain Restriction)**:
   - *No-Ancestor-Template-Repetition*: An item template $A$ cannot appear more than once along any single directed path from weapon root to leaf ($A \notin \text{Ancestors}(s)$).
   - Formally adopted as an explicit domain restriction to mathematically guarantee a finite instance universe without arbitrary depth cutoffs ($D_{\max}$).
   - Multi-copy placement on independent parallel branches remains unrestricted.
3. **Parent-Instance Activation & Required Occupancy Invariants**:
   - *Slot Mutex*: $\sum_{v \in \text{Allowed}(s)} x_v \le 1 \quad \forall s$.
   - *Optional Mod Slot Activation*: $\sum_{v \in \text{Allowed}(s)} x_v \le x_u \quad \forall s = (u, \text{slot})$.
   - *Root Optional Slot*: $\sum_{v \in \text{Allowed}(s)} x_v \le 1$.
   - *Root Required Slot*: $\sum_{v \in \text{Allowed}(s)} x_v = 1$ (mandatory; empty set emits $0 = 1 \implies \text{proved infeasible}$).
   - *Mod-Owned Required Slot*: $\sum_{v \in \text{Allowed}(s)} x_v = x_u \quad \forall s = (u, \text{slot})$. If $\text{Allowed}(s) = \emptyset$, simplifies to $0 = x_u$, forcing $x_u = 0$ via impossible-owner deactivation without declaring false global infeasibility.
4. **Template Conflicts, Slot Conflicts, and User Locks**:
   - *Template Mutual Exclusion*: For conflicting template pairs $(A, B)$ ($A \ne B$, symmetrized), mutual exclusion is enforced via presence indicators:
     $$y_A + y_B \le 1$$
     $$x_u \le y_A \quad \forall u \in \text{Instances}(A), \quad x_v \le y_B \quad \forall v \in \text{Instances}(B)$$
     $$y_A \le \sum_{u \in \text{Instances}(A)} x_u, \quad y_B \le \sum_{v \in \text{Instances}(B)} x_v$$
     (or pairwise instance exclusions $x_u + x_v \le 1$). Permits valid duplicate builds such as $A+A$ and $B+B$.
   - *Self-Conflicts*: If $A \in \text{conflicts}(A)$, $\sum_{u \in \text{Instances}(A)} x_u \le 1$.
   - *Slot Conflicts*: When instance $u$ is installed, for each raw slot template ID $t \in \text{conflicting\_slot\_ids}(u)$, it blocks every physical occurrence of that slot on the weapon:
     $$x_u + \text{occupancy}(s_{\text{target}}) \le 1 \quad \forall s_{\text{target}} \in \text{PhysicalSlots}(t)$$
   - *Include/Exclude*: Exclude fixes $x_u = 0$; include enforces $\sum_{u \in \text{Instances}(inc)} x_u \ge 1$.
5. **Statistics, Accounting & Instance-Bound Result Contracts**:
   - Reconstructed statistics (ergo, recoil, weight, accuracy) sum over installed occurrences ($x_v = 1$) exactly once.
   - `selected_items: ItemDetail[]` carries occurrence-aware item detail records, each with a required, unique-per-build `instanceId: string` (retaining `id: string` as template ID).
   - `slot_pairs: { parentInstanceId: string, slotId: string, childInstanceId: string, itemId: string }[]` explicitly records parent-instance to child-instance attachment links.
   - Strict 1-to-1 bijection: each selected `ItemDetail` record occurs exactly once as a manifest `childInstanceId`, with matching `itemId === id`.
   - Derived multiset `selected_item_ids: string[]` is provided for shopping lists and stash-offset projections.
   - `validateBuild` verifies slot capacity $\le 1$, parent-instance rootedness, 1-to-1 instance bijection, and stats summation.

## Consequences & Downstream Contracts

- **Issue #33 (Purchase & Reductions)**: Formulate integer $\text{buy}_i$ variables and exact deficits against total installed instances $\sum_{s} p_{i,s}$.
- **Issue #36 (Oracles & Validation)**: Update `validateBuild` and test oracles to verify instance-level slot uniqueness, 1-to-1 instanceId bijection, and occurrence-aware item details.
- **Issue #38 (Prepared Boundaries)**: Prepared compatibility trees use instance-qualified slots with branch acyclicity caching.
