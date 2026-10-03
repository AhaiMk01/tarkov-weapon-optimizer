# ADR 0002: Authoritative Physical-Build and Acquisition Domain Contract

## Status
Accepted (Refs #31). Amended 2026-10-02.

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
