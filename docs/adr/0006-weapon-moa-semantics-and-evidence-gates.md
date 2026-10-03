# ADR 0006: Weapon MOA Semantics and Evidence Gates

## Status
Proposed (Refs #41). Canonical Resolution v2 2026-10-03.

## Context
Upstream research (Issue #29) identified a fundamental implementation discrepancy between third-party API code and the consumer optimizer:
1. **Upstream Preset Code**: Initializes weapon `CenterOfImpact` and adds part COI ($\text{COI}_{\text{base}} + \sum \text{COI}_{\text{parts}}$), omitting component accuracy modifiers.
2. **Consumer Optimizer & EFTForge**: Installed barrel COI overrides the receiver base COI ($\text{effectiveCOI} = \text{barrelCOI} > 0 ? \text{barrelCOI} : \text{weaponCOI}$), and sums component accuracy modifiers.
3. Neither expression was independently documented as authoritative game behavior. A physical proof gate was required before formulating bound-safe Big-M numerics.

## Decision

We establish four core principles governing weapon MOA authority and mathematical formulation:

1. **Game Client Observation as Sole Authority**:
   - In-game weapon inspection measurements and decompiled client ballistics (`EFT.Ballistics` / `Weapon`) are the sole authoritative ground truth. Neither API preset code nor consumer convention may be declared game-exact without empirical verification.
2. **Empirical Evidence & Baseline Replacement Discrimination**:
   - Tested against the stock Colt M4A1 in-game:
     - Base receiver: $\text{COI} = 0.01$
     - Default 14.5\" barrel: $\text{COI} = 0.053$, $\text{acc} = 0\%$
     - Additive hypothesis predicts: $(0.01 + 0.053) \times 34.377 = 2.17\text{ MOA}$.
     - Replacement hypothesis predicts: $0.053 \times 34.377 = 1.82\text{ MOA}$.
   - The in-game weapon inspection screen and Official Tarkov Wiki display exactly **$1.82\text{ MOA}$**, providing strong discriminating evidence supporting the **Barrel Replacement model** over additive COI for this baseline configuration.
   - A single zero-modifier sample does not prove universal platform truth or modifier scaling.
3. **Four-Quadrant Calibration Evidence Gate**:
   - Full physical certification of MOA across all platforms requires recording in-game inspection values across the 4-quadrant test matrix:
     - Q1: Zero-mod barrel replacement (M4A1 14.5\" barrel)
     - Q2: Positive accuracy modifier (16\" Hanson barrel, $\text{COI}=0.03, \text{acc}=+7\%$)
     - Q3: Negative accuracy modifier (suppressors with $-3\%$ or $-5\%$ acc)
     - Q4: Fixed-barrel fallback (receiver intrinsic COI on SKS, AK-74M, Mosin)
   - Certified if and only if predictions match verified in-game inspection values within $\pm 0.01\text{ MOA}$.
4. **Normative Convention & Interim Contract Scope**:
   - Declared scope: `moa_contract_scope: 'calibrated_consumer_baseline'`.
   - Normative formula:
     $$\text{MOA} = \text{effectiveCOI} \times \left(1 - \frac{\sum_{i} \text{accuracy\_modifier}_i}{100}\right) \times \frac{100}{2.9089}$$
     where $\text{effectiveCOI} = \text{barrelCOI} > 0 \ ?\ \text{barrelCOI} : \text{weapon.center\_of\_impact}$.
   - $\text{MOA\_K} = 100 / 2.9089 \approx 34.377256007$ is adopted as a normative decimal model convention; durability is fixed at 100% full condition.

## Consequences & Downstream Contracts

- **Issue #34 (Bound-Safe Numerics)**: Formulates signed Big-M bounds, precision lattices, and outward ceiling rounding proofs ($\text{display\_floor} \ge \text{hi}$) against this exact calibrated consumer model without assuming integer/2-decimal accuracy modifiers.
- **Issue #36 (Oracles & Validation)**: Validates physical MOA calculations in `validateBuild` and benchmark oracles using this formula, conditional on the 4-quadrant calibration gate.
- **Issue #35 (Certificate Semantics)**: MOA floor search and witness builds use this normative formula under declared scope.
