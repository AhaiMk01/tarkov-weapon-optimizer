# ADR 0002: Authoritative Physical-Build and Acquisition Domain Contract

## Status
Accepted (Refs #31). Accepted 2026-10-02.

## Context
The frontend solver's optimization models and independent validation oracle (`validateBuild`) must preserve the authoritative physical and economic reality of Escape from Tarkov. Audits of `compatibilityMap.ts` and `lpBuilder.ts` revealed four critical domain defects:
1. **Raw Slot Collisions**: `compatibilityMap.ts` keyed slots by raw ID, overwriting candidate lists on duplicate keys.
2. **Preset Monopolies on Owned Parts**: `lpBuilder.ts:712–716` forced purchasing expensive presets when a component was unpurchasable standalone, causing valid naked+owned builds to become falsely infeasible.
3. **Single-Copy Restriction vs. Physical Multi-Copy Reality**: The solver clamped item presence to binary $x_i \in \{0, 1\}$, rendering legitimate multi-copy builds (such as dual URX long panels for +6 ergonomics, dual pistol grips on PKP/PKM with PT-2 stock, or duplicate flashlights) mathematically impossible.
4. **Silent Omission of Required Slots & Invented Bases**: Empty required slots were skipped (`lpBuilder.ts:746`), and zero-cost fallback bases were fabricated when no legal base was purchasable (`lpBuilder.ts:255–281`).

## Decision

We establish the authoritative physical and acquisition domain contract across eight principles:

1. **Global Slot Identity**: Raw upstream 24-character hexadecimal MongoDB ObjectIds (`slot.id`) are treated as globally unique across all items in the dataset. `buildCompatibilityMap` asserts uniqueness and raises an immediate error upon collision.
2. **Independent Base Selection & Stripping**: Exactly one base is chosen (naked receiver or one purchasable preset). If a preset is chosen, included parts are acquired at ₽0 marginal cost; unused preset parts are stripped at ₽0 with no penalty. An accessible preset containing part $i$ never forces purchasing that preset if part $i$ can be legally supplied via owned inventory or standalone purchase.
3. **Strict Out-of-Pocket Cash Spend**: The hard budget constraint $\sum \text{price} \le \text{max\_price}$ applies strictly to actual rubles spent to traders or flea market. Owned/FiR parts consume ₽0 of the cash budget.
4. **Authoritative Multi-Copy Domain**: Physical weapon platforms allow identical item IDs across distinct physical slots. Each physical slot holds at most one item ($\sum_{i} p_{i,s} \le 1$); duplicate item IDs across distinct slots are permitted ($p_{i, s_1} = 1$ and $p_{i, s_2} = 1$ when $s_1 \ne s_2$). Statistics sum across occupied placement variables ($\sum_s p_{i,s} \cdot \text{stat}_i$). Purchase variables track integer quantities $\text{buy}_i \in \{0, 1, 2, \dots\}$.
5. **Strict Infeasibility & Zero Invented Data**: If any reachable required slot cannot be filled by an accessible legal part, the problem is strictly `infeasible` (emit `req_s: 0 >= 1`). If a weapon has no accessible base, the problem is strictly `infeasible` (emit `base_choice: 0 >= 1`). Zero-cost fallback bases and silent constraint omission are prohibited.
6. **Stash Quantity Representation**: Stash inventory quantities are represented as multiset element multiplicity in `owned_items: string[]` (e.g. `['kac_panel', 'kac_panel']` represents 2 owned physical copies).
7. **Greedy Free-First Offsetting**: Available free copies (from stash or containing preset) offset installed copies:
   $$\text{buy}_i = \max\left(0, \sum_{s} p_{i,s} - N_{\text{free}}(i)\right)$$
   Cash expenditure is charged strictly for the net unowned deficit.
8. **Hard Inventory Cap on Unpurchasable Items**: When an item cannot be purchased standalone, total installed copies cannot exceed available free inventory:
   $$\sum_{s} p_{i,s} \le N_{\text{owned}}(i) + \sum_{b \text{ contains } i} \text{base}_b$$

## Consequences

- **Sound Formulation**: Formulations and validators share an identical, truthful physical contract.
- **Tarkov Fidelity**: Legitimate multi-copy builds (dual URX panels, dual grips, multi-light configurations) are physically and mathematically admissible.
- **Zero False Feasibility**: Inaccessible weapons or incomplete builds missing required components return `status: 'infeasible'`.
- **Implementation Scope**: Multi-copy placement and `owned_items` quantity tracking are formally recognized as required domain capabilities for implementation under Decision Map #28.
