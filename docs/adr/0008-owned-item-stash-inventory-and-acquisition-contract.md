# ADR 0008: Owned-Item Stash Inventory Schema and Free-Acquisition Contract

## Status
Accepted planning decision (Refs #42). Reconciled 2026-10-04; no production acquisition or consumer migration is claimed.

## Context
Under the authoritative physical-build and acquisition domain settled in [ADR 0002 / Issue #31](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31), weapon mod optimization accounts for personal stash inventory and containing presets alongside trader and flea purchases. A concrete contract was required to define how owned items are represented, validated, and integrated into API requests, Web Worker message boundaries, caching keys, response manifests, and solver linear program acquisition constraints.

## Decision

We establish five core principles governing owned stash inventory and free acquisition:

1. **Schema Representation, Multiset Counting & Entry Validation**:
   - Stash inventory is represented in optimization requests as an optional array of item ID strings (`owned_items?: string[]`), where element multiplicity represents quantity:
     $$N_{\text{owned}}(i) = \sum_{x \in \text{owned\_items}} \mathbf{1}_{x == i} \quad \in \mathbb{Z}_{\ge 0}$$
   - Omitted `owned_items` and empty array `[]` both resolve consistently to zero stock ($N_{\text{owned}}(i) = 0$). Inventory is persistent input state and is never mutated across requests or Explore points.
   - **Boundary Validation and Snapshotting**: Validate before hashing, acquisition reuse or model generation at worker dispatch and direct/internal entries (or pass the same validated immutable snapshot). Omitted resolves to `[]`; otherwise require `Array.isArray`, length $\le 10{,}000$, and every indexed entry a nonempty string. Sparse/missing entries fail. The cap bounds entries, not bytes/memory; do not invent trimming, ID-syntax or string-length restrictions. Unknown/non-mod/incompatible strings remain valid and retained for identity. Snapshot/count/canonicalize without mutating caller state.
     - *Operation-Specific Failure Propagation (ADR 0004)*:
       - `optimize` (including actual Gunsmith optimization): Returns `status: 'incomplete'`, `physical_certificate: 'none'`, internal `termination: 'limit'`, null proof bounds and no selected build, `reason: 'Invalid owned_items format'`; MOA-independent `moa_qualification` is explicitly `null`.
       - `explore`: Returns `curve_status: 'invalid'`, `points: []`, `reason: 'Invalid owned_items format'`.
       - `computeMOAFloor`: Returns the merged unresolved/no-witness envelope with `status: 'unresolved'`, null floor, proved lower bound and witness fields, `reason: 'Invalid owned_items format'`. No numeric fallback.
       - Internal ideal-endpoint solves: Halts dispatch immediately, no caching.
       - `getGunsmithTasks` is metadata retrieval, not optimization; its response remains unchanged and does not take `owned_items`.
2. **Full Telemetry Identity vs. Scoped Acquisition Projection**:
   - **Preservation of Full Canonical Request Identity (ADR 0005 / Issue #37)**: The canonical request SHA-256 hash (`canonicalRequestHash`) is evaluated over the full validated request input with `owned_items` canonically sorted, preserving duplicate multiplicity and unvisited/incompatible strings.
   - **Internal Scoped Acquisition Projection**: The solver internally projects owned stock onto reachable mods for the selected weapon ($N_{\text{owned}}^{\text{scoped}}(i)$). Any internal prepared-model reuse or cache equivalence belongs strictly to Issue #38.
3. **Public/Internal API and Consumer Migration Contract**:
   - `OptimizeRequest` exposes optional `owned_items?: string[]`, inherited by `ExploreRequest`. Actual Gunsmith optimization forwards `owned_items` in its `optimize` request.
   - Preserves full validated array across Web Worker postMessage boundary, mapped to `SolveParams.ownedItems`.
   - `computeMOAFloor` forwards the full normalized acquisition/feasibility domain, not just weapon/language/mode or stock: trader/player levels, flea/barter controls, item/category filters, budget, structural/bounds settings and all remaining applicable hard constraints/model controls. Its witness, cap trials and internal endpoints use that same immutable stock/domain, with only the authorized MOA trial cap changed.
   - All consumers migrate together in the later cutover; no legacy alias or implicit unlimited-owned fallback.
4. **Reachability Sequence & Scope Boundaries**:
   - BFS reachability traversal must discover all reachable slots and candidates across the **authoritative unpruned physical compatibility domain** before market filtering, ensuring owned-but-unbuyable parts are discovered.
   - A physically reachable candidate passes acquisition availability iff it is buyable standalone under the active settings, supplied by an accessible preset, or owned. This is not an override of any other eligibility rule. Exact selected-base supply and stock caps still limit installed quantities.
   - Stash inventory applies strictly to weapon mod attachments; owning a weapon receiver ID does not grant a free base gun.
   - Owning a mod does not override user bans, forced inclusions, physical slot capacity, conflicts, or required occupancy.
   - The legacy `purchasable: false => FiR/owned with price 0` heuristic in `frontend/src/api/client.ts:78` is eliminated in the cutover.
5. **Normative Deficit Equality, Zero Spend & Deterministic Provenance**:
   - **Normative Purchase Deficit Equality**: Total free supply combines personal stash $N_{\text{owned}}(i)$ and selected containing preset supply $\sum_b q_{b,i} \cdot base_b$.
     $$\mathbf{buy_i = \max\left(0, \text{installed}_i - N_{\text{owned}}(i) - \sum_{b} q_{b,i} \cdot base_b\right)}$$
     where $\text{installed}_i = \sum_s p_{i,s}$ in the physical instance domain.
     Governs out-of-pocket spend, objective price axes ($fP$), and price reconstruction across all objective weights (including $p = 0$).
   - The unperturbed integer expense-surrogate epigraph and exact decoded deficit are specified in **ADR 0009 / Issue #33**; surrogate slack at zero price weight is not actual purchased stock.
   - **Zero Out-of-Pocket Spend**: Owned-supplied occurrences consume ₽0 of `max_price` and the price axis. An item with additional paid occurrences can still have positive exact $buy_i$.
   - **Hard Inventory Caps on Standalone-Inaccessible Items**: If item $i$ is not purchasable standalone under active market settings:
     $$\mathbf{\sum_s p_{i,s} \le \sum_b q_{b,i} \cdot base_b + N_{\text{owned}}(i)}$$
     Enforce exact paid deficit zero when standalone acquisition is inaccessible; retain these rows even for zero-cost or eliminated economic bookkeeping. Remove FiR inference, arbitrary ₽100,000,000 preset-only stand-ins and the legacy presence-only `avail_i` preset monopoly together.
   - **Deterministic Per-Occurrence Output Provenance**: For an item $i$ installed $K$ times, ordered by `instanceId` code-unit order:
     1. Up to $\min(K, q_{b,i} \cdot base_b)$ instances assigned `source: 'preset'`, `price: 0`.
     2. Up to $\min(K - \text{preset\_allocated}, N_{\text{owned}}(i))$ instances assigned `source: 'owned'`, `price: 0`.
     3. Remaining $buy_i$ instances assigned the actual selected offer source key and unit acquisition cost.
     The sum of prices across all selected instances strictly equals the exact out-of-pocket mod expenditure $\sum_i \text{price}_i \cdot buy_i$.

## Consequences & Downstream Handoff

- **Issue #33 ([Choose exact purchase and row-reduction contracts](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/33))**: Its accepted general-surrogate/decoded-deficit decision is recorded in ADR 0009; production/native implementation remains outstanding.
- **Issue #36 ([Define independent physical-oracle and equivalence proof gates](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36))**: The inventory decision is settled; implementation still requires raw-source reference validation and qualified native/model evidence.

## Canonical Precedence

- [Canonical #42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42#issuecomment-5971674033) and [#41 MOA authority](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/41#issuecomment-5966142296) supersede conflicting #35 response shapes. Preserve actual paid cash/barter offer provenance and ingredient quantities, with chosen base expenditure accounted separately.
- Fast presence is not multi-copy stock. Every accepted Fast witness reconstructs and independently validates exact occurrence counts, deficits, caps and budget; failed reconstruction remains unverified/incomplete (or retains an earlier verified witness), never physical infeasibility.
- MOA floors default to 30,000 ms. With no proved analytic lo, **run lower-bracket discovery**, retaining the full inventory/acquisition domain. Qualified Precise model infeasibility at a probe establishes lo; only then bisect. Unresolved/unqualified trials halt and retain a witnessed upper bound, not an invented proof. Missing initial lo never triggers immediate return. ADR0013 section6 is the controlling algorithm.
