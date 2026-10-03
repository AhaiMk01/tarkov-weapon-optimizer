# ADR 0006: Weapon MOA Semantics and Evidence Gates

## Status
Proposed (Refs #41).

## Context
Upstream research (Issue #29) identified a fundamental implementation discrepancy between third-party API code and the consumer optimizer:
1. **Upstream Preset Code**: Initializes weapon `CenterOfImpact` and adds part COI ($\text{COI}_{\text{base}} + \sum \text{COI}_{\text{parts}}$), omitting component accuracy modifiers.
2. **Consumer Optimizer & EFTForge**: Installed barrel COI overrides the receiver base COI ($\text{effectiveCOI} = \text{barrelCOI} > 0 ? \text{barrelCOI} : \text{weaponCOI}$), and sums component accuracy modifiers.
3. Neither expression was independently documented as authoritative game behavior. A physical proof gate was required before formulating bound-safe Big-M numerics.

## Decision

We establish four core principles governing weapon MOA authority and mathematical formulation:

1. **Game Client Observation as Sole Authority**:
   - In-game weapon inspection measurements and decompiled client ballistics (`EFT.Ballistics` / `Weapon`) are the sole authoritative ground truth. Neither API preset code nor consumer convention may be declared game-exact without empirical verification.
2. **Empirical Verification of Barrel Replacement Model**:
   - Tested against the stock Colt M4A1 in-game:
     - Base receiver: $\text{COI} = 0.01$
     - Default 14.5\" barrel: $\text{COI} = 0.053$, $\text{acc} = 0\%$
     - Additive hypothesis predicts: $(0.01 + 0.053) \times (100 / 2.9089) = 2.17\text{ MOA}$.
     - Replacement hypothesis predicts: $0.053 \times (100 / 2.9089) = 1.82\text{ MOA}$.
   - The in-game weapon inspection screen and Official Tarkov Wiki display exactly **$1.82\text{ MOA}$**, definitively confirming the **Barrel Replacement model** and refuting the additive hypothesis.
3. **Physical Conversion Constant $\text{MOA\_K}$**:
   - We retire the truncated constant $34.3$, adopting the exact physical radian-to-arcminute conversion factor for 100 meters:
     $$\text{MOA\_K} = \frac{100}{2.9089} \approx \mathbf{34.377256248\dots}$$
   - Weapon and barrel durability is fixed at **100% full durability** baseline.
4. **Normative In-Game MOA Formula**:
   $$\text{MOA} = \text{effectiveCOI} \times \left(1 - \frac{\sum_{i} \text{accuracy\_modifier}_i}{100}\right) \times \frac{100}{2.9089}$$
   where $\text{effectiveCOI} = \text{barrelCOI} > 0 ? \text{barrelCOI} : \text{weapon.center\_of\_impact}$.

## Consequences & Downstream Contracts

- **Issue #34 (Bound-Safe Numerics)**: Formulates signed Big-M bounds, precision lattices, and outward ceiling rounding proofs ($\text{display\_floor} \ge \text{hi}$) against this exact physical formula.
- **Issue #36 (Oracles & Validation)**: Validates physical MOA calculations in `validateBuild` and benchmark oracles using this formula.
- **Issue #35 (Certificate Semantics)**: MOA floor search and witness builds use this normative formula.
