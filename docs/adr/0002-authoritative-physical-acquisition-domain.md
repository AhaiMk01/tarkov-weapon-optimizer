# ADR 0002: Authoritative Physical-Build and Acquisition Domain Contract

## Status
Accepted planning decision (Refs #31). Reconciled 2026-10-04; not an implemented solver repair or game-authority proof.

## Context
The frontend solver's optimization models and independent validation oracle (`validateBuild`) must preserve the authoritative physical and economic reality of Escape from Tarkov. Audits of `compatibilityMap.ts`, `lpBuilder.ts`, and upstream data extraction revealed critical domain defects:
1. **Template vs. Physical Slot Identity**: `compatibilityMap.ts` keyed slots by raw template ID, overwriting candidate lists on duplicate keys and failing to distinguish distinct physical child slots on identical parent instances.
2. **Preset Monopolies & Flat Content Extraction**: `lpBuilder.ts:712–716` forced purchasing expensive presets when a component was unpurchasable standalone, causing valid naked+owned builds to become falsely infeasible. Furthermore, preset extraction flattened contents to a `Set<string>`, discarding multi-copy quantities $q_{b,i}$.
3. **Single-Copy Restriction vs. Physical Multi-Copy Reality**: The solver clamped item presence to binary $x_i \in \{0, 1\}$, rendering legitimate multi-copy builds (such as dual URX long panels for +6 ergonomics, dual pistol grips on PKP/PKM with PT-2 stock, or duplicate flashlights) mathematically impossible.
4. **Incorrect Infeasibility & Invented Data**: Empty required slots on child mods were conflated with global infeasibility, while empty slots were silently omitted (`lpBuilder.ts:746`) and zero-cost fallback bases were fabricated (`lpBuilder.ts:255–281`).

## Decision

We establish the authoritative physical and acquisition domain contract across nine principles:

1. **Template Slot Identity vs. Physical Slot Identity**:
   - Upstream raw 24-character hexadecimal MongoDB ObjectIds (`slot.id`) are template-level identifiers. `buildCompatibilityMap` asserts that distinct item templates do not share a `slot.id` as a checked input requirement.
   - Physical slot identity is instance-qualified: each physical slot instance is identified by `(parentInstanceId, templateSlotId)`.
   - Each installed parent instance activates its own independent physical child slots with independent capacity constraints ($\le 1$). Every installed mod instance must trace an unbroken physical instance path to the weapon root.
2. **Multi-Copy Preset Quantities ($q_{b,i}$)**:
   - Factory presets supply integer quantities $q_{b,i} \in \mathbb{Z}_{\ge 0}$ of component $i$. Upstream data extraction and preparation must preserve `containsItems[].count`.
   - Repair `extractAllPresets` and request `count` in its GraphQL fallback. The JSON adapter must preserve explicit raw finite nonnegative integer `containsItems[].count`; remove its unproved `contained.count ?? 1` default. Missing/null/malformed raw counts are source/input errors unless a pinned source-schema contract explicitly establishes a default (none is adopted here). Repeated entries sum their counts. One pushed ID per entry, default-filled normalized counts without raw provenance, or a `Set` cannot establish original quantities. Carry the count-bearing representation through `PresetInfo.items`, LP supply, reconstruction, details/manifest and `structuralBounds.ts`; migrate `test_json_api_adapter` and independent raw-count checks.
   - Free inventory supplied by presets is $\sum_b q_{b,i} \cdot \text{base}_b$.
   - Base selection is independent ($\sum \text{base}_b = 1$). If a preset is chosen, its components are supplied at ₽0 marginal cost; unused preset parts are stripped at ₽0 with no penalty. An accessible preset containing component $i$ never forces purchasing that preset if component $i$ can be legally supplied via owned inventory or standalone purchase.
3. **Out-of-Pocket Expenditure & Market Accessibility**:
   - The hard budget constraint $\sum \text{cost} \le \text{max\_price}$ strictly counts out-of-pocket acquisition spend: direct currency spend (trader cash and flea market) plus the established RUB-equivalent valuation of required barter items when barters are enabled.
   - Owned and Found-in-Raid (FiR) parts consume ₽0 of the cash budget and contribute ₽0 to price objective penalties.
4. **Authoritative Multi-Copy Domain**:
   - Physical weapon platforms allow identical item IDs across distinct physical slots.
   - Each physical slot instance holds at most one item ($\sum_i p_{i,s} \le 1$).
   - Duplicate placements across distinct slots are permitted ($p_{i, s_1} = 1$ and $p_{i, s_2} = 1$ when $s_1 \ne s_2$).
   - Statistics sum across all occupied placement variables ($\sum_s p_{i,s} \cdot \text{stat}_i$).
   - Purchase variables track integer quantities $\text{buy}_i \in \{0, 1, 2, \dots\}$.
   - `validateBuild` verifies that each physical slot instance is occupied at most once.
5. **Conditional Required Occupancy & Proved Infeasibility**:
   - *Weapon-Root Required Slot*: Mandatory for the weapon (occupancy = 1). If any root required slot has zero accessible candidates under the request settings, the problem is proved physically `infeasible` (emit `req_s: 0 >= 1`).
   - *Mod-Owned Required Slot*: Required conditional on that specific parent instance being selected (occupancy = $x_{\text{owner\_instance}}$). If a mod-owned required slot has zero accessible candidates, that mod instance is forced off ($x_{\text{owner\_instance}} = 0$). Alternative parent/attachment paths remain valid.
   - *Proved Infeasibility*: Only proved mathematical or physical impossibility returns `status: 'infeasible'`. Malformed inputs, unproved source data, and exhausted time limits return errors or `incomplete`. Zero-cost fallback bases and silent omission of required slots are prohibited.
6. **Stash Quantity Representation**:
   - Stash inventory quantities are represented as element multiplicity in multiset array `owned_items: string[]` ($N_{\text{owned}}(i)$).
7. **Greedy Free-First Offsetting**:
   $$\text{buy}_i = \max\left(0, \sum_{s} p_{i,s} - N_{\text{owned}}(i) - \sum_{b} q_{b,i} \cdot \text{base}_b\right)$$
   Cash/barter expenditure is charged strictly for $\text{buy}_i \cdot \text{price}_i$.
8. **Hard Inventory Cap on Inaccessible Items**:
   - When an item cannot be acquired standalone under the request's market settings, total installed copies across all physical slots cannot exceed available free inventory:
     $$\sum_{s} p_{i,s} \le N_{\text{owned}}(i) + \sum_{b} q_{b,i} \cdot \text{base}_b$$
9. **Superseded Legacy Assumptions**:
   - The single-copy model ($x_i \in \{0, 1\}$ and $\sum_s p_{i,s} = x_i \le 1$) is superseded.
   - The legacy $\text{buy}_i = x_i$ purchase rule is superseded.
   - Flat preset extraction (`Set<string>`) is superseded.
   - Global template slot ID mapping is superseded.
   - Global infeasibility for empty mod-owned slots is superseded.

## Consequences & Downstream Contracts

- **Issue #32**: Formulate instance-aware slot occupancy and parent-instance rootedness.
- **Issue #33**: Formulate integer purchase quantities $\text{buy}_i$ and multi-copy preset offsetting $q_{b,i}$.
- **Issue #36**: Update `validateBuild` and benchmark oracles to verify physical slot instance uniqueness and multi-copy stat summation.
- **Issue #42**: Define `owned_items?: string[]` API schema, validation, and solver integration follow-up.

## Authority and Reconciliation

- The [canonical #31 resolution](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/31#issuecomment-5945998692), [#32 occurrence contract](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/32#issuecomment-5955673941), and [post-acceptance #40 review](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5977261158) control over stale extraction claims. The adopted finite software domain is not a universal assertion of game-engine behavior.
- Empty-root impossibility is a physical infeasibility claim only after exact-domain/native/numerical proof gates. Fast and provisional-MOA model impossibility retain qualified internal proof but return `incomplete`, not a physical certificate. `termination` is independent search completion: every completed model search (including Fast emptiness) uses `optimal`; unfinished/unstarted search uses `limit`. Withheld proof or failed validation does not rewrite a completed search to `limit`; status, certificate, qualifications and factual reason describe its authority. Invalid inventory starts no search.
- Market accessibility is request-specific (trader levels, player level, flea/barter enablement and filters). Owned stock is explicit validated mod inventory, not inferred from FiR labels or a missing/large price. No accessible base means an impossible base-choice row, never a fabricated free receiver.
