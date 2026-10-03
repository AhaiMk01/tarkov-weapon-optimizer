# ADR 0008: Owned-Item Stash Inventory Schema and Free-Acquisition Contract

## Status
Proposed (Refs #42). Canonical Resolution 2026-10-03.

## Context
Under the authoritative physical-build and acquisition domain settled in [ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31), weapon mod optimization accounts for personal stash inventory and containing presets alongside trader and flea purchases. A concrete contract was required to define how owned items are represented, validated, and integrated into API requests, Web Worker message boundaries, caching keys, response manifests, and solver linear program acquisition constraints.

## Decision

We establish four core principles governing owned stash inventory and free acquisition:

1. **Schema Representation & Multiset Counting**:
   - Stash inventory is represented in optimization requests as an optional array of item ID strings (`owned_items?: string[]`), where element multiplicity represents quantity:
     $$N_{\text{owned}}(i) = \sum_{x \in \text{owned\_items}} \mathbf{1}_{x == i} \quad \in \mathbb{Z}_{\ge 0}$$
   - **Permissive Scoped Filtering**: Only item IDs matching reachable weapon mods in the active weapon's compatibility tree contribute to $N_{\text{owned}}(i)$. Any string corresponding to non-weapon items (medkits, keys, barters) or incompatible mods for the selected weapon platform is silently ignored. This permits passing full-stash inventory exports directly across weapon switches without manual pre-filtering.
   - **Validation Rules**: If present, `owned_items` must be an `Array` containing only non-empty strings with length $\le 10{,}000$. Invalid payloads reject with `status: 'incomplete'`, `reason: 'Invalid owned_items format'`.
2. **API & Request Integration Across Interfaces**:
   - `OptimizeRequest` in `frontend/src/api/client.ts` exposes `owned_items?: string[]`, mapped to `SolveParams.ownedItems?: string[]` across the Web Worker postMessage boundary.
   - **Canonical Request Identity & Cache Key Invariant (ADR 0005 / Issue #37)**: The canonical request SHA-256 hash and ideal-point cache key incorporate a normalized representation of reachable owned items (e.g. sorted list of reachable `[itemId, count]` tuples), ensuring cache soundness across distinct stash states.
   - **Output Build Manifest (`ItemDetail` in `OptimizeResponse`)**: Any physical part supplied from stash inventory carries `price: 0` and `source: 'owned'`, accurately distinguishing free stash components in UI shopping lists and stats cards.
3. **Solver Acquisition Contract: Greedy Free-First Offsetting & Zero Spend**:
   - Under multi-copy physical placement (ADR 0002), item $i$ has total installed count $\sum_s p_{i,s}$ (or $x_i$ in fast mode).
   - Free copies come from personal stash $N_{\text{owned}}(i)$ and selected containing presets ($q_{b,i} \cdot base_b$).
   - The solver purchases copies only beyond total free supply:
     $$buy_i \ge \sum_s p_{i,s} - \sum_b q_{b,i} \cdot base_b - N_{\text{owned}}(i), \quad buy_i \ge 0$$
   - **Zero Out-of-Pocket Spend & Zero Objective Penalties**: Owned components contribute $buy_i = 0$, consuming ₽0 of the `max_price` cash budget and adding ₽0 to the price objective axis ($fP$).
4. **Hard Inventory Caps on Standalone-Inaccessible Items**:
   - If an item $i$ cannot be purchased standalone under active market settings (e.g. Find-in-Raid only, locked trader loyalty level, disabled barter, or disabled flea market), extra purchases are forbidden and the solver strictly enforces:
     $$\sum_s p_{i,s} \le \sum_b q_{b,i} \cdot base_b + N_{\text{owned}}(i)$$
   - If $N_{\text{owned}}(i) == 0$ and no selected preset contains it, $\sum_s p_{i,s} \le 0$, correctly forbidding the unpurchasable item. If $N_{\text{owned}}(i) > 0$, the optimizer can utilize up to $N_{\text{owned}}(i)$ copies, but cannot equip more than owned.

## Consequences & Downstream Handoff

- **Issue #33 ([Choose purchase-model formulation and preset offset](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/33))**: Unblocked to formulate purchase integer variables, preset offset, and containing preset selection against this free-first acquisition contract.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Unblocked to validate build purchasing, zero-spend assertions, and inventory caps in independent verification.
