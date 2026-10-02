# GLOSSARY

Canonical terminology for the Tarkov Weapon Mod Optimizer domain model.

### Physical Slot
A physical attachment point in a concrete weapon build, uniquely identified as an instance-qualified tuple `(parentInstanceId, templateSlotId)`. Each physical slot instance holds at most one installed item at any given time. Distinct from template-level `slot.id`, which defines slot attributes on an item template.

### Multi-Copy Placement
The physical installation of multiple identical item IDs into distinct physical slots on the same weapon (e.g. dual AK-74 bakelite pistol grips on a PKP/PKM with PT-2 stock, dual KAC URX rail panels, or multiple identical flashlights). Statistics are additive across all occupied placement instances.

### Branch Acyclicity (Explicit Domain Restriction)
An explicit domain boundary stating that an item template cannot appear more than once along any single directed parent-to-child path from weapon root to leaf ($A \notin \text{Ancestors}(s)$). Prunes recursive compatibility loops during tree expansion, mathematically bounding the instance universe to a finite size while preserving independent multi-copy placements on parallel branches.

### Instance-Coupled Occupancy
The LP constraint coupling child slot occupancy directly to its parent instance variable: $\sum_{v \in \text{Allowed}(s)} x_v \le x_u$ for optional slots, and $\sum_{v \in \text{Allowed}(s)} x_v = x_u$ for required mod slots, where variables in $\text{Allowed}(s)$ carry occurrence-specific instance identity $v = (i, s)$.

### Slot-Occupancy Conflict
A physical interference constraint (`conflicting_slot_ids`) where installing an item blocks the physical occupancy of every physical slot instance $s_{\text{target}}$ on the weapon matching that template slot ID ($x_u + \text{occupancy}(s_{\text{target}}) \le 1$), as opposed to a global pairwise item ban that would falsely forbid using the item in other non-conflicting slots.

### Instance Tree Manifest
A build export and validation structure (`slot_pairs`) where each connection explicitly identifies `{ parentInstanceId, slotId, childInstanceId, itemId }`. Maintains a strict 1-to-1 bijection where each selected `ItemDetail` record carries a unique `instanceId` referenced exactly once as a manifest `childInstanceId`.

### Physical Certificate
The explicit level of authoritative proof provided by a solve response:
- `certified_optimal`: Solved on the precise placement model with certified optimality (gap $\le$ tolerance) and clean physical validation.
- `approximate_optimal`: Optimal under relaxed binary model assumptions, certified only for the approximate model.
- `feasible`: A verified physical build exists, but optimality is unproven in either model.
- `certified_infeasible`: Mathematically or physically impossible within the domain, certified strictly on the precise model.
- `none`: No verified physical build exists.

### Model Qualification
The explicit classification of solver baseline: `exact` (solved on the exact placement model with physical instance variables) versus `approximate` (solved on the relaxed binary fast model). Fast mode can report `optimal` only with `model_qualification: 'approximate'`, while mathematical optimality certification requires `exact` and `precision_resolved: 'precise'`.

### Strict Infeasibility Gating
The search invariant requiring that an infeasible bound (e.g. lower bound `lo` in MOA-floor binary search) advances if and only if a sub-solve returns certified `status: 'infeasible'` on the precise model. Unresolved outcomes (timeouts, limits, errors, or Fast-model infeasibility) must never advance an infeasible bound.

### Single Request Deadline Clock
A unified request-level deadline clock normalized across browser contexts using global monotonic epoch milliseconds ($\text{epoch} = \text{performance.timeOrigin} + \text{performance.now}()$). Enforces queue-aware expiration before worker dispatch, propagates remaining time to sub-operations, bypasses the dispatch chain for out-of-band cancellation, and yields to the event loop between sub-solves.

### Global Spatial Upper Bound
The objective upper bound across the entire spatial branch-and-bound search tree, aggregated as $\max(\text{incumbent.objective}, \max_{k \in \text{OpenNodes}} \text{node}_k.\text{upper\_bound})$, yielding $+\infty$ if any open region is unbounded. Never replaced by the bound of a single closed node.

### MOA Witness & Outward Rounding
An achievable weapon build verified by physical checks that establishes an upper bound on achievable MOA (`hi`). UI slider consumption requires an outward-safe cap (`display_floor`), with the exact numerical rounding contract and proof delegated to Issue #34.

### Curve Status
The classification of a Pareto frontier sweep response (`ExploreResponse`):
- `complete`: All $N$ requested points terminated with certified outcomes (all verified builds, or a proved mix of verified builds and proved-infeasible points).
- `partial`: Usable sweep where at least one point yielded a verified build, but others timed out, errored, or were cancelled.
- `infeasible`: Entire requested range is proved infeasible (all $N$ points proved infeasible on the precise model).
- `invalid`: Zero verified builds produced due to timeout, error, or early cancellation.

### Containing Preset
A pre-assembled weapon configuration sold by traders that includes a receiver and pre-attached components with integer counts $q_{b,i} \in \mathbb{Z}_{\ge 0}$. When selected as the base, included components are acquired at zero marginal cost. A containing preset provides free components but never forces a preset purchase when a component can be legally supplied via standalone purchase or owned stash inventory.

### Preset Stripping
The removal of unused pre-installed components from a purchased preset base at zero liquidation value (₽0 spend, ₽0 resale credit) without penalty.

### Owned Item (Stash Inventory)
A component already in the player's personal inventory (`owned_items`), represented as element multiplicity in a multiset array. Supplied at zero out-of-pocket cash expenditure (`buy_i = 0`), consuming ₽0 of the `max_price` cash budget. For items that cannot be acquired standalone under current market settings, stash quantity strictly caps the maximum number of copies that can be installed on the weapon.

### Standalone Market Accessibility
Whether an item can be acquired standalone under the request's specific market configuration (`flea_available`, `barter_available`, `player_level`, `trader_levels`). An enabled barter at an accessible trader level constitutes an accessible standalone acquisition path.

### Out-of-Pocket Expenditure
Actual rubles spent to acquire the base and unowned components, counting direct currency spend (trader cash and flea market) plus the established RUB-equivalent valuation of required barter items when barters are enabled. The hard budget constraint `max_price` applies strictly to out-of-pocket expenditure.

### Required Slot
A slot marked as mandatory (`required: true`).
- **Root Required Slot**: Mandatory for the weapon itself (occupancy = 1). If a root required slot has zero accessible candidates, the problem is proved physically infeasible.
- **Mod-Owned Required Slot**: Mandatory **conditional on its parent instance being selected** (occupancy = $x_{\text{owner\_instance}}$). If empty, that parent instance is forced off ($x_{\text{owner\_instance}} = 0$); alternative parent/attachment paths remain valid.

### Proved Infeasibility
A certified determination by the solver that no mathematically or physically feasible build exists within the specified domain. Distinct from malformed input errors, unproved source data, or incomplete runs halted by time/node limits.
