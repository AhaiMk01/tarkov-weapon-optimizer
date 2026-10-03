# ADR 0006: Weapon MOA Semantics and Evidence Gates

## Status
Proposed (Refs #41). Canonical Resolution v6 2026-10-03.

## Context
Upstream research (Issue #29) identified a fundamental implementation discrepancy between third-party API code and the consumer optimizer:
1. **Upstream Preset Code**: Initializes weapon `CenterOfImpact` and adds part COI ($\text{COI}_{\text{base}} + \sum \text{COI}_{\text{parts}}$), omitting component accuracy modifiers.
2. **Consumer Optimizer & EFTForge**: Installed barrel COI overrides the receiver base COI ($\text{effectiveCOI} = \text{barrelCOI} > 0 ? \text{barrelCOI} : \text{weaponCOI}$), and sums component accuracy modifiers.
3. Neither expression was independently documented as authoritative game behavior. A physical proof gate was required before formulating bound-safe Big-M numerics.

## Decision

We establish five core principles governing weapon MOA authority, certification fencing, and mathematical formulation:

1. **Game Client Observation as Sole Authority & Proof-State Certificate Fence**:
   - In-game weapon inspection measurements and decompiled client ballistics (`EFT.Ballistics` / `Weapon`) are the sole authoritative ground truth.
   - **Certificate Fence for MOA-Dependent Solves**:
     - *Optimal on Precise Model*: Receives `status: 'optimal'`, `model_qualification: 'exact'`, `moa_qualification: 'provisional_model'`, and **`physical_certificate: 'approximate_optimal'`**. Fenced from claiming `certified_optimal`.
     - *Optimal on Fast Model*: Receives `status: 'optimal'`, `model_qualification: 'approximate'`, `moa_qualification: 'provisional_model'`, and `physical_certificate: 'approximate_optimal'`.
     - *Feasible Incumbent (Limit Reached)*: Receives `status: 'feasible'`, `model_qualification: (precision_resolved === 'precise' ? 'exact' : 'approximate')`, `moa_qualification: 'provisional_model'`, and **`physical_certificate: 'feasible'`**. A merely feasible incumbent is never promoted to `approximate_optimal`.
     - *Limit with No Incumbent*: Receives `status: 'incomplete'`, `lower_bound: null`, and `physical_certificate: 'none'`.
     - *Model Infeasible*: Receives `status: 'incomplete'`, `reason: 'Provisional MOA model infeasible'`, and `physical_certificate: 'none'`. Fenced from claiming `certified_infeasible`.
     - *Validation Failure*: Receives `status: 'incomplete'`, `physical_certificate: 'none'`.
   - **Model-Relative MOA-Floor Outcomes**:
     `computeMOAFloor` outcomes under the provisional model are strictly model-relative (`model_proved`, `model_witnessed`, `unresolved`, `model_infeasible`). Inherits full ADR 0004 safeguards: requires a verified instance witness, a finite mathematically justified lower bound $\text{lo}$, non-null bisection gate, and $\text{hi} - \text{lo} \le 0.02\text{ MOA}$ for `model_proved`. Model infeasibility must never advance an authoritative physical lower bound.
   - Requests without MOA constraints are completely unfenced and may achieve `certified_optimal`.
2. **Empirical Evidence & Baseline Replacement Discrimination**:
   - Tested against the stock Colt M4A1 in-game:
     - Base receiver: $\text{COI} = 0.01$
     - Default 14.5\" barrel: $\text{COI} = 0.053$, $\text{acc} = 0\%$
     - Additive hypothesis predicts: $(0.01 + 0.053) \times 34.377 = 2.17\text{ MOA}$.
     - Replacement hypothesis predicts: $0.053 \times 34.377 = 1.82\text{ MOA}$.
   - The in-game weapon inspection screen and Official Tarkov Wiki display exactly **$1.82\text{ MOA}$**, providing strong discriminating evidence supporting the **Barrel Replacement model** over additive COI for this baseline configuration.
   - A single zero-modifier sample does not prove universal platform truth or modifier scaling.
3. **Four-Quadrant Calibration Matrix Across Formula Families**:
   - Predeclared candidate formula families:
     - Family 1 (Linear Subtractive - Provisional): $\text{effectiveCOI} \times (1 - \sum A_i / 100) \times K$
     - Family 2 (Divisor): $\text{effectiveCOI} / (1 + \sum A_i / 100) \times K$
     - Family 3 (Multiplicative Compound): $\text{effectiveCOI} \times \prod (1 - A_i / 100) \times K$
   - Calibration setups:
     - Q1 (M4A1 14.5\" barrel): Replacement predicts $1.82199 \implies \mathbf{1.82\text{ MOA}}$ vs Additive $2.1658 \implies \mathbf{2.17\text{ MOA}}$.
     - Q2 (M4A1 $+16\%$ cumulative acc): Linear predicts $0.8663 \implies \mathbf{0.87\text{ MOA}}$ vs Divisor $0.8891 \implies \mathbf{0.89\text{ MOA}}$ vs Multiplicative $0.8750 \implies \mathbf{0.87\text{ MOA}}$.
     - Q3 (Mosin Rifle $+5\%/-5\%$ mods): Linear and Divisor both predict $1.3063 \implies \mathbf{1.31\text{ MOA}}$ vs Multiplicative $1.3031 \implies \mathbf{1.30\text{ MOA}}$.
     - Q4 (AK-74N fixed-barrel fallback): Unmodified $1.96\text{ MOA}$; with PBS-4 ($-3\%$) $2.02\text{ MOA}$.
   - *Display-Bin Mapping Rule & Provisional Formatting*: In-game rounding is defined strictly as an unverified provisional half-up convention pending client attestation. Two formulas are observationally separated iff their prediction intervals map to disjoint rounding bins. On 2-decimal displays, Linear ($0.866$) and Multiplicative ($0.875$) both map to $0.87$. Matching a display bin provides consistency evidence, but universal physical certification requires first-party client decompilation.
4. **Physical Arc Geometry vs. Software Comparison Envelope**:
   - Circular arc: $S = 10000\text{ cm} \times \frac{\pi}{180 \times 60} = 2.908882086657216\text{ cm}$.
   - Tangent displacement: $D = 10000\text{ cm} \times \tan(\frac{\pi}{180 \times 60}) = 2.908882168703159\text{ cm}$.
   - $\text{MOA\_K} = 100 / 2.9089 \approx 34.377256007$ is adopted as a normative decimal model convention; $[34.3, 34.3775]$ is an arbitrary software comparison envelope. Durability baseline is fixed at 100% full condition.
5. **Pinned Fixture Scope & Normative In-Game MOA Formula**:
   - The provisional software model is strictly scoped to the pinned fixture digest `219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`, with game client build correspondence explicitly labeled `unattested`.
   - Formula:
     $$\text{MOA} = \text{effectiveCOI} \times \left(1 - \frac{\sum_{i} \text{accuracy\_modifier}_i}{100}\right) \times \frac{100}{2.9089}$$
     where $\text{effectiveCOI} = \text{barrelCOI} > 0 \ ?\ \text{barrelCOI} : \text{weapon.center\_of\_impact}$.

## Consequences & Downstream Contracts

- **Issue #34 (Bound-Safe Numerics)**: Formulates signed Big-M bounds, precision lattices, and outward ceiling rounding proofs ($\text{display\_floor} \ge \text{hi}$) against this exact calibrated consumer model without assuming integer/2-decimal accuracy modifiers.
- **Issue #36 (Oracles & Validation)**: Validates physical MOA calculations in `validateBuild` and benchmark oracles using this formula, conditional on the 4-quadrant calibration gate and certificate fence.
- **Issue #35 (Certificate Semantics)**: MOA floor search and witness builds use this normative formula under declared scope, with physical certificates strictly fenced.
