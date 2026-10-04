# ADR 0006: Weapon MOA Semantics and Evidence Gates

## Status
Accepted provisional software-model authority/evidence planning contract (Refs #41). Reconciled 2026-10-04; game calibration, native proof and production implementation remain unperformed prerequisites, not accepted evidence.

## Context
Upstream research (Issue #29) identified a fundamental implementation discrepancy between third-party API code and the consumer optimizer:
1. **Upstream Preset Code**: Initializes weapon `CenterOfImpact` and adds part COI ($\text{COI}_{\text{base}} + \sum \text{COI}_{\text{parts}}$), omitting component accuracy modifiers.
2. **Consumer Optimizer & EFTForge**: Installed barrel COI overrides the receiver base COI ($\text{effectiveCOI} = \text{barrelCOI} > 0 ? \text{barrelCOI} : \text{weaponCOI}$), and sums component accuracy modifiers.
3. Neither expression is established as universal authoritative game behavior. The accepted replacement/linear model unblocks numerical formulation only within a pinned provisional software scope; stronger game-faithful claims require branch-scoped first-party execution evidence or discriminating empirical evidence.

The [accepted canonical #41 resolution](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/41#issuecomment-5966142296) supersedes prior proposals and controls this record. The [#34 numerical contract](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/34#issuecomment-5970763741), [#36 oracle/equivalence contract](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36#issuecomment-5974832944) and merged ADR 0004 retain their independent proof obligations; [#42 operation envelopes](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42#issuecomment-5971674033) take precedence over older response shapes. The [post-acceptance #40 review](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5977261158) corrects stale acceptance/authority prose without turning the provisional model into game proof.

## Decision

We establish five core principles governing weapon MOA authority, certification fencing, and mathematical formulation:

1. **Accepted Provisional Model, Branch-Scoped Authority & Proof-State Fence**:
   - Choose replacement/linear accuracy with $K=100/2.9089$ as the normative **provisional software model**, not a verified universal game formula. Numerical representation uncertainty is distinct from unknown game-model error.
   - Future game-faithful MOA claims require a relevant attested client execution path **or** discriminating empirical evidence, including display/input/nuisance uncertainty, for the specific evidenced build/mode/platform/condition branch. Neither route grants universal coverage; all unevidenced branches remain provisional. Client observation/decompilation is not declared the sole route to evidence.
   - **Certificate Fence for MOA-Dependent Solves**:
     - *Qualified Optimal on Precise Model*: With independently verified witness and justified finite native/global gap within tolerance, receives `status: 'optimal'`, `optimization.termination: 'optimal'`, `precision_resolved: 'precise'`, `model_qualification: 'exact'`, `moa_qualification: 'provisional_model'`, and **`physical_certificate: 'approximate_optimal'`**. Fenced from claiming `certified_optimal`.
     - *Qualified Optimal on Fast Model*: With independently verified witness and justified native/global proof, receives `status: 'optimal'`, `optimization.termination: 'optimal'`, `precision_resolved: 'fast'`, `model_qualification: 'approximate'`, `moa_qualification: 'provisional_model'`, and `physical_certificate: 'approximate_optimal'`.
     - *Required Proof Not Completed, Verified Incumbent*: Receives `status: 'feasible'`, `model_qualification: (precision_resolved === 'precise' ? 'exact' : 'approximate')`, `moa_qualification: 'provisional_model'`, and **`physical_certificate: 'feasible'`**. Search termination is `optimal` if execution completed, otherwise `limit`; failed proof qualification/validation alone does not change it. Retain the earlier witness and never promote it to `approximate_optimal`.
     - *Required Proof Not Completed, No Verified Incumbent*: Receives `status: 'incomplete'`, `lower_bound: null`, and `physical_certificate: 'none'`; termination independently records completed (`optimal`) versus unfinished/unstarted (`limit`) search. A failed reconstruction needs no clock event.
     - *Completed Model Infeasible*: Precise provisional-MOA uses `status: 'incomplete'`, `reason: 'Provisional MOA model infeasible'`, `optimization.termination: 'optimal'` and `physical_certificate: 'none'`; combined Fast+MOA also uses termination `optimal`, with `Fast provisional MOA model infeasible` and both approximate-placement/provisional-MOA qualifications. Completed search is not physical proof. Neither can claim `certified_infeasible`, count as Explore I or advance an authoritative physical floor.
     - *Validation Failure*: Use `reason: 'Independent build validation failed'`; retain any earlier verified incumbent/proof under ADR 0004 rather than unconditionally dropping it. No rejected candidate is published. Completed qualified model proof is never downgraded by a late interruption; native exceptions remain typed #35 error envelopes, not fabricated builds.
   - **Model-Relative MOA-Floor Outcomes**:
     `computeMOAFloor` outcomes are `model_proved`, `model_witnessed`, `unresolved`, `model_infeasible`. `model_proved` requires a full verified instance witness hi, a finite mathematically justified model lo and `hi - lo <= 0.02 MOA`. `model_witnessed` requires a verified achievable hi but not bracket proof; unresolved/no witness has null floor, display, lower-bound and witness. `model_infeasible` requires qualified precise seed-model infeasibility, not a Fast no-solution result.
     - Inherit the complete ADR 0004 deadline, native/numerical/model-equivalence and witness safeguards; default is 30,000 ms and full acquisition/feasibility scope is forwarded to all seed/trial solves.
     - The further #40 owner correction supersedes immediate no-lo return: **discover a lower bracket**, then bisect under ADR 0004. No analytic formula is required. Resolve floor queries Precise with a constant-zero weighted objective (all three weights zero), no payoff or extra display/price solve. ADR 0004 controls explicit stopping: native `mip_max_improving_sols = 1` per floor MIP sub-solve, and the enclosing query returns its first independently validated exact-feasible full witness. Raw relaxed candidates are insufficient; completion/solution-limit diagnostics remain distinct. Witness price and selection stability are not promised. Qualified whole-query infeasible cap trials establish lo even when absent; zero/negative internal caps are constraints. Unresolved/unqualified trials halt and retain an upper-bound witness under the one shared 30-second budget.
     - Model-relative lo never advances an authoritative physical lower bound. Cancellation/limits retain the last verified witness and never downgrade completed bracket proof. Outward display/submission safety remains a numerical requirement, not a game-physics claim.
   - **MOA-independent requests** have no max_moa, floor search or Gunsmith MOA cap: `moa_qualification: null`. They may achieve `certified_optimal` or `certified_infeasible` only with all exact-domain/native/numerical proof prerequisites. Fast still retains its independent approximate-placement fence and `Approximate model infeasible` reason; independence from MOA does not erase other fences.
2. **Empirical Evidence & Baseline Replacement Discrimination**:
   - Historical source/Wiki baseline corroboration for the stock Colt M4A1:
     - Base receiver: $\text{COI} = 0.01$.
     - Default 14.5\" barrel: $\text{COI} = 0.053$, $\text{acc} = 0\%$.
     - Additive hypothesis predicts $(0.01+0.053)\times K=2.165767128\ldots\text{ MOA}$ (provisional display 2.17).
     - Replacement hypothesis predicts $0.053\times K=1.821994568\ldots\text{ MOA}$ (provisional display 1.82).
   - The canonical record reports Wiki corroboration of **1.82 MOA**, supporting replacement for this baseline rather than additive COI. This is scoped corroboration, not an attested measurement/client execution path for the whole fixture or new evidence gathered during reconciliation.
   - A single zero-modifier sample does not prove modifier scaling, display rounding, other condition branches or universal platform truth.
3. **Four-Quadrant Calibration Matrix Across Formula Families**:
   - Predeclared candidate formula families:
     - Family 1 (Linear Subtractive - Provisional): $\text{effectiveCOI} \times (1 - \sum A_i / 100) \times K$
     - Family 2 (Divisor): $\text{effectiveCOI} / (1 + \sum A_i / 100) \times K$
     - Family 3 (Multiplicative Compound): $\text{effectiveCOI} \times \prod (1 - A_i / 100) \times K$
   - Calibration setups:
     - Q1 (M4A1 14.5\" barrel): Replacement predicts $1.82199 \implies \mathbf{1.82\text{ MOA}}$ vs Additive $2.1658 \implies \mathbf{2.17\text{ MOA}}$.
     - Q2 (M4A1 $+16\%$ cumulative acc): Linear predicts $0.866306851\ldots \implies \mathbf{0.87\text{ MOA}}$, Divisor $0.889066966\ldots \implies \mathbf{0.89\text{ MOA}}$, and Compound $0.874995754\ldots \implies \mathbf{0.87\text{ MOA}}$. Do not bin the rounded illustration 0.8750 as if it were the full prediction.
     - Q3 (Mosin Rifle $+5\%/-5\%$ mods): Linear and Divisor both predict $1.3063 \implies \mathbf{1.31\text{ MOA}}$ vs Multiplicative $1.3031 \implies \mathbf{1.30\text{ MOA}}$.
     - Q4 (AK-74N fixed-barrel fallback): Unmodified $1.96\text{ MOA}$; with PBS-4 ($-3\%$) $2.02\text{ MOA}$.
   - *Display-Bin Mapping Rule & Provisional Formatting*: Half-up bins $[x-0.005,x+0.005)$ are an **unverified provisional display convention**, not established in-game rounding. Prediction intervals discriminate only when mapped bins are disjoint after uncertainty; half-even/truncation can change tie cases. Q2 Linear and Compound both map to 0.87 (Compound is only about $4.25\times10^{-6}$ below the 0.875 boundary); Q3 separates Compound from Linear/Divisor only under the applicable display rule and cannot separate Linear from Divisor. Matching bins is consistency evidence, not exact algebraic proof. Stronger claims remain strictly branch-scoped through either attested client execution or discriminating empirical evidence.
4. **Physical Arc Geometry vs. Software Comparison Envelope**:
   - Circular arc: $S = 10000\text{ cm} \times \frac{\pi}{180 \times 60} = 2.908882086657216\text{ cm}$.
   - Tangent displacement: $D = 10000\text{ cm} \times \tan(\frac{\pi}{180 \times 60}) = 2.908882168703159\text{ cm}$.
   - $\text{MOA\_K} = 100 / 2.9089 \approx 34.377256007$ is adopted as a normative decimal model convention; $[34.3, 34.3775]$ is an arbitrary software comparison envelope. Durability baseline is fixed at 100% full condition.
5. **Pinned Fixture Scope & Normative Provisional Formula**:
   - The software model is scoped to pinned fixture SHA-256 `219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`, with `game_build_correspondence: 'unattested'` and `moa_contract_scope: 'calibrated_consumer_baseline'`. That scope name is not evidence that game calibration was performed. Record schema/authority/normalization versions in provenance.
   - Formula:
     $$\text{MOA} = \text{effectiveCOI} \times \left(1 - \frac{\sum_{i} \text{accuracy\_modifier}_i}{100}\right) \times \frac{100}{2.9089}$$
     where $\text{effectiveCOI} = \text{barrelCOI} > 0 \ ?\ \text{barrelCOI} : \text{weapon.center\_of\_impact}$.

## Consequences & Downstream Contracts

- **Issue #34 (Bound-Safe Numerics)**: Formulate occurrence-counted signed Big-M, complete operation-level error enclosures, parser verification and outward display/submission safety against this provisional model without assuming integer/2-decimal accuracy. Replacement rows still apply when intrinsic COI is zero; missing/nonpositive barrel COI uses the intrinsic fallback.
- **Issue #36 (Oracles & Validation)**: Verify fidelity to the declared provisional model independently; exact oracle/model agreement does not lift the MOA physical-proof fence. Qualified native proof additionally requires the planned pinned WASM/glue/ABI rebuild, structured full-precision primals/status/dual/gap, parsed-model equivalence and no unqualified stock fallback.
- **Issue #35 / ADR 0004 (Certificate Semantics)**: Use the merged status, qualification, deadline, Explore and model-floor contracts. Gunsmith MOA caps can report provisional-model compliance, not verified game-physical compliance absent relevant scoped evidence.
- **Evidence boundary**: The canonical acceptance reports seven throwaway floor-state specification smoke checks. No game measurement, client decompilation, production optimizer/native proof or performance benchmark was performed there or in this reconciliation. Acceptance settles the provisional-model decision; future stronger evidence remains a prerequisite, not an unresolved choice of formula for this cutover.
