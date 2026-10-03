# ADR 0006: Weapon MOA Semantics and Evidence Gates

## Status
Proposed (Refs #41). Canonical Resolution v3 2026-10-03.

## Context
Upstream research (Issue #29) identified a fundamental implementation discrepancy between third-party API code and the consumer optimizer:
1. **Upstream Preset Code**: Initializes weapon `CenterOfImpact` and adds part COI ($\text{COI}_{\text{base}} + \sum \text{COI}_{\text{parts}}$), omitting component accuracy modifiers.
2. **Consumer Optimizer & EFTForge**: Installed barrel COI overrides the receiver base COI ($\text{effectiveCOI} = \text{barrelCOI} > 0 ? \text{barrelCOI} : \text{weaponCOI}$), and sums component accuracy modifiers.
3. Neither expression was independently documented as authoritative game behavior. A physical proof gate was required before formulating bound-safe Big-M numerics.

## Decision

We establish five core principles governing weapon MOA authority, certification fencing, and mathematical formulation:

1. **Game Client Observation as Sole Authority & Certificate Fence**:
   - In-game weapon inspection measurements and decompiled client ballistics (`EFT.Ballistics` / `Weapon`) are the sole authoritative ground truth.
   - **Certificate Fence**: Requests with active `max_moa` constraints (or MOA-floor search / Gunsmith tasks with MOA caps) operate under the provisional consumer model: they receive `model_qualification: 'exact'` (if placement is precise) but their physical certificate is strictly fenced as `physical_certificate: 'approximate_optimal'`. They are forbidden from claiming `certified_optimal` or `certified_infeasible` until the calibration gate in Section 3 is satisfied.
   - Requests without MOA constraints are completely unfenced and may achieve `certified_optimal`.
2. **Empirical Evidence & Baseline Replacement Discrimination**:
   - Tested against the stock Colt M4A1 in-game:
     - Base receiver: $\text{COI} = 0.01$
     - Default 14.5\" barrel: $\text{COI} = 0.053$, $\text{acc} = 0\%$
     - Additive hypothesis predicts: $(0.01 + 0.053) \times 34.377 = 2.17\text{ MOA}$.
     - Replacement hypothesis predicts: $0.053 \times 34.377 = 1.82\text{ MOA}$.
   - The in-game weapon inspection screen and Official Tarkov Wiki display exactly **$1.82\text{ MOA}$**, providing strong discriminating evidence supporting the **Barrel Replacement model** over additive COI for this baseline configuration.
   - A single zero-modifier sample does not prove universal platform truth or modifier scaling.
3. **Four-Quadrant Calibration Evidence Gate Across Formula Families**:
   - Predeclared candidate formula families:
     - Family 1 (Linear Subtractive - Provisional): $\text{effectiveCOI} \times (1 - \sum A_i / 100) \times K$
     - Family 2 (Divisor): $\text{effectiveCOI} / (1 + \sum A_i / 100) \times K$
     - Family 3 (Multiplicative Compound): $\text{effectiveCOI} \times \prod (1 - A_i / 100) \times K$
   - Full physical certification across all platforms requires recording in-game inspection values across the high-divergence 4-quadrant test matrix:
     - Q1: Zero-mod barrel replacement (M4A1 14.5\" barrel $\to$ 1.82 MOA)
     - Q2: Cumulative positive modifiers (M4A1 $+16\%$ cumulative accuracy $\to$ Linear 0.87 MOA vs Divisor 0.89 MOA)
     - Q3: Cancelling positive/negative modifiers (Mosin Rifle $+5\%/-5\%$ mods $\to$ Linear 1.31 MOA vs Divisor 1.18 MOA)
     - Q4: Fixed-barrel fallback (AK-74N intrinsic COI fallback $\to$ 1.96 MOA unmodified, 2.02 MOA with PBS-4)
   - Certified if and only if predictions match verified in-game inspection values with divergence exceeding display rounding, or first-party client decompilation validates the AST.
4. **Physical Arc Geometry vs. Software Comparison Envelope**:
   - Circular arc: $S = 10000\text{ cm} \times \frac{\pi}{180 \times 60} = 2.908882086657216\text{ cm}$.
   - Tangent displacement: $D = 10000\text{ cm} \times \tan(\frac{\pi}{180 \times 60}) = 2.908882168703159\text{ cm}$.
   - $\text{MOA\_K} = 100 / 2.9089 \approx 34.377256007$ is adopted as a normative decimal model convention; $[34.3, 34.3775]$ is a historical software comparison envelope, not an established physical uncertainty bound. Durability baseline is fixed at 100% full condition.
5. **Normative In-Game MOA Formula**:
   $$\text{MOA} = \text{effectiveCOI} \times \left(1 - \frac{\sum_{i} \text{accuracy\_modifier}_i}{100}\right) \times \frac{100}{2.9089}$$
   where $\text{effectiveCOI} = \text{barrelCOI} > 0 \ ?\ \text{barrelCOI} : \text{weapon.center\_of\_impact}$.

## Consequences & Downstream Contracts

- **Issue #34 (Bound-Safe Numerics)**: Formulates signed Big-M bounds, precision lattices, and outward ceiling rounding proofs ($\text{display\_floor} \ge \text{hi}$) against this exact calibrated consumer model without assuming integer/2-decimal accuracy modifiers.
- **Issue #36 (Oracles & Validation)**: Validates physical MOA calculations in `validateBuild` and benchmark oracles using this formula, conditional on the 4-quadrant calibration gate and certificate fence.
- **Issue #35 (Certificate Semantics)**: MOA floor search and witness builds use this normative formula under declared scope, with physical certificates strictly fenced.
