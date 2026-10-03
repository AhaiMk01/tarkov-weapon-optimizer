# ADR 0008: Owned-Item Stash Inventory Schema and Free-Acquisition Contract

## Status
Accepted (Refs #42). 2026-10-03.

## Context
Under the authoritative physical-build and acquisition domain settled in [ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31), weapon mod optimization accounts for personal stash inventory and containing presets alongside trader and flea purchases. A concrete contract was required to define how owned items are represented, validated, and integrated into API requests, Web Worker message boundaries, caching keys, response manifests, and solver linear program acquisition constraints.

## Decision

We establish five core principles governing owned stash inventory and free acquisition:

1. **Schema Representation, Multiset Counting & Entry Validation**:
   - Stash inventory is represented in optimization requests as an optional array of item ID strings (`owned_items?: string[]`), where element multiplicity represents quantity:
     $$N_{\text{owned}}(i) = \sum_{x \in \text{owned\_items}} \mathbf{1}_{x == i} \quad \in \mathbb{Z}_{\ge 0}$$
   - Omitted `owned_items` and empty array `[]` both resolve consistently to zero stock ($N_{\text{owned}}(i) = 0$). Inventory is persistent input state and is never mutated across requests or Explore points.
   - **Worker Entry Validation**: Validated immediately upon arrival in the Web Worker dispatch handler before hashing, caching, or model generation:
     - `Array.isArray(req.owned_items)`, length $\le 10{,}000$, and every element is a non-empty string.
     - *Operation-Specific Failure Propagation (ADR 0004)*:
       - `optimize` (including actual Gunsmith optimization): Returns `status: 'incomplete'`, `physical_certificate: 'none'`, `lower_bound: null`, `upper_bound: null`, `reason: 'Invalid owned_items format'`.
       - `explore`: Returns `curve_status: 'invalid'`, `points: []`, `reason: 'Invalid owned_items format'`.
       - `computeMOAFloor`: Returns `status: 'unresolved'`, `floor: null`, `proved_lower_bound: null`, `reason: 'Invalid owned_items format'`.
       - Internal ideal-endpoint solves: Halts dispatch immediately, no caching.
       - `getGunsmithTasks` is metadata retrieval, not optimization; its response remains unchanged and does not take `owned_items`.
2. **Full Telemetry Identity vs. Scoped Acquisition Projection**:
   - **Preservation of Full Canonical Request Identity (ADR 0005 / Issue #37)**: The canonical request SHA-256 hash (`canonicalRequestHash`) is evaluated over the full validated request input with `owned_items` canonically sorted, preserving duplicate multiplicity and unvisited/incompatible strings.
   - **Internal Scoped Acquisition Projection**: The solver internally projects owned stock onto reachable mods for the selected weapon ($N_{\text{owned}}^{\text{scoped}}(i)$). Any internal prepared-model reuse or cache equivalence belongs strictly to Issue #38.
3. **Public/Internal API and Consumer Migration Contract**:
   - `OptimizeRequest` exposes optional `owned_items?: string[]`, inherited by `ExploreRequest`. Actual Gunsmith optimization forwards `owned_items` in its `optimize` request.
   - Preserves full validated array across Web Worker postMessage boundary, mapped to `SolveParams.ownedItems`.
   - `computeMOAFloor` payload carries `owned_items` from the caller's request, using the same validated stock for witness and cap trials.
   - All consumers migrate together in the later cutover; no legacy alias or implicit unlimited-owned fallback.
4. **Reachability Sequence & Scope Boundaries**:
   - BFS reachability traversal must discover all reachable slots and candidates across the **authoritative unpruned physical compatibility domain** before market filtering, ensuring owned-but-unbuyable parts are discovered.
   - Market availability filtering is applied *after* factoring in owned stock ($N_{\text{owned}}(i) > 0$) and accessible preset supply ($q_{b,i} > 0$).
   - Stash inventory applies strictly to weapon mod attachments; owning a weapon receiver ID does not grant a free base gun.
   - Owning a mod does not override user bans, forced inclusions, physical slot capacity, conflicts, or required occupancy.
   - The legacy `purchasable: false => FiR/owned with price 0` heuristic in `frontend/src/api/client.ts:78` is eliminated in the cutover.
5. **Normative Deficit Equality, Zero Spend & Deterministic Provenance**:
   - **Normative Purchase Deficit Equality**: Total free supply combines personal stash $N_{\text{owned}}(i)$ and selected containing preset supply $\sum_b q_{b,i} \cdot base_b$.
     $$\mathbf{buy_i = \max\left(0, \text{installed}_i - N_{\text{owned}}(i) - \sum_{b} q_{b,i} \cdot base_b\right)}$$
     where $\text{installed}_i = \sum_s p_{i,s}$ in the physical instance domain.
     Governs out-of-pocket spend, objective price axes ($fP$), and price reconstruction across all objective weights (including $p = 0$).
   - Exact MIP integer formulation, epigraph tightness under zero price weight, and integer variable reductions are delegated to **Issue #33**.
   - **Zero Out-of-Pocket Spend**: Owned copies contribute $buy_i = 0$, consuming ₽0 of `max_price` budget and adding ₽0 to the price objective axis ($fP$).
   - **Hard Inventory Caps on Standalone-Inaccessible Items**: If item $i$ is not purchasable standalone under active market settings:
     $$\mathbf{\sum_s p_{i,s} \le \sum_b q_{b,i} \cdot base_b + N_{\text{owned}}(i)}$$
   - **Deterministic Per-Occurrence Output Provenance**: For an item $i$ installed $K$ times, ordered by `instanceId` code-unit order:
     1. Up to $\min(K, q_{b,i} \cdot base_b)$ instances assigned `source: 'preset'`, `price: 0`.
     2. Up to $\min(K - \text{preset\_allocated}, N_{\text{owned}}(i))$ instances assigned `source: 'owned'`, `price: 0`.
     3. Remaining $buy_i$ instances assigned the actual selected offer source key and unit acquisition cost.
     The sum of prices across all selected instances strictly equals the exact out-of-pocket mod expenditure $\sum_i \text{price}_i \cdot buy_i$.

## Consequences & Downstream Handoff

- **Issue #33 ([Choose exact purchase and row-reduction contracts](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/33))**: Unblocked to formulate purchase integer variables, epigraph tightness under zero price weight, preset offset, and containing preset selection against this free-first acquisition contract.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: Settling Issue #42 removes its native blocker from Issue #36 (which remains blocked by #33).
