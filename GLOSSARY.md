# GLOSSARY

Canonical terminology for the Tarkov Weapon Mod Optimizer domain model.

### Physical Slot
A physical attachment point in a concrete weapon build, uniquely identified as an instance-qualified tuple `(parentInstanceId, templateSlotId)`. Each physical slot instance holds at most one installed item at any given time. Distinct from template-level `slot.id`, which defines slot attributes on an item template.

### Multi-Copy Placement
The physical installation of multiple identical item IDs into distinct physical slots on the same weapon (e.g. dual AK-74 bakelite pistol grips on a PKP/PKM with PT-2 stock, dual KAC URX rail panels, or multiple identical flashlights). Statistics are additive across all occupied placement instances.

### Branch Acyclicity (Explicit Domain Restriction)
An explicit domain boundary stating that an item template cannot appear more than once along any single directed parent-to-child path from weapon root to leaf ($A \notin \text{Ancestors}(s)$). Prunes recursive compatibility loops during tree expansion, mathematically bounding the instance universe to a finite size while preserving independent multi-copy placements on parallel branches.

### Instance-Coupled Occupancy
The LP constraint coupling child slot occupancy directly to its parent instance variable: $\sum_{v \in \text{Allowed}(s)} x_v \le x_u$ for optional slots, and $\sum_{v \in \text{Allowed}(s)} x_v = x_u$ for required mod slots, where variables in $\text{Allowed}(s)$ carry occurrence-specific instance identity $v = (i, s)$.

### Slot-Occupancy Conflict
A physical interference constraint (`conflicting_slot_ids`) where installing an item blocks the physical occupancy of every physical slot instance $s_{\text{target}}$ on the weapon matching that template slot ID ($x_u + \text{occupancy}(s_{\text{target}}) \le 1$), as opposed to a global pairwise item ban that would falsely forbid using the item in other non-conflicting slots.

### Instance Tree Manifest
A build export and validation structure (`slot_pairs`) where each connection explicitly identifies `{ parentInstanceId, slotId, childInstanceId, itemId }`. Maintains a strict 1-to-1 bijection where each selected `ItemDetail` record carries a unique `instanceId` referenced exactly once as a manifest `childInstanceId`.

### Physical Certificate
The explicit level of authoritative proof provided by a solve response:
- `certified_optimal`: Solved on the precise placement model with certified optimality (gap $\le$ tolerance), clean physical validation, and conditional on the domain/objective equivalence gates established in Issue #36. Strictly fenced from claiming certification on requests whose feasibility depends on unverified MOA constraints.
- `approximate_optimal`: Optimal under relaxed binary model assumptions, or optimal on the precise placement model under unverified provisional physics (such as requests with active `max_moa` constraints). A merely feasible incumbent is never promoted to this status.
- `feasible`: A verified physical build exists, but optimality is unproven in either model (e.g. time/node limit reached with an incumbent).
- `certified_infeasible`: Mathematically or physically impossible within the domain, certified strictly on the precise model and conditional on Issue #36 domain equivalence.
- `none`: No verified physical build exists.

### Independent Physical Oracle
A brute-force combinatorial tree enumerator evaluating exact physical non-linear equations directly on unpruned raw `ItemLookup` data, completely decoupled from `buildLP`, `compatibilityMap`, or continuous relaxations, establishing ground-truth physical feasibility, optimal scores, and proved infeasibility for benchmark/oracle suites.

### Behavioral Regression Matrix
The canonical 14-scenario physical edge-case suite (covering empty required routes, disconnected cycles, one item / two required slots, inaccessible base fallback, zero price weight phantom spend, MOA boundaries, etc.) required to accept any solver modification.

### Model Reduction Equivalence Gates
The 4-gate verification requirement for mathematical formulation reductions: Gate A (Bijective Feasibility), Gate B (Optimum & Ties Invariance), Gate C (Infeasibility Equivalence), and Gate D (Statistical Comparative Benchmarks).

### Three-Tier Verification Hierarchy
The explicit authority ordering: Tier 1 (Brute-Force Physical Oracle & Independent `validateBuild`), Tier 2 (Frontend JS / HiGHS Implementation), Tier 3 (Differential Python / CP-SAT cross-checks on reconciled sub-problems).

### Model-Relative MOA Floor
MOA-floor search outcomes evaluated strictly within the provisional software model (`model_proved`, `model_witnessed`, `unresolved`, `model_infeasible`). Inherits full ADR 0004 safeguards: requires a verified instance witness, a finite mathematically justified lower bound $\text{lo}$, non-null bisection gate, and $\text{hi} - \text{lo} \le 0.02\text{ MOA}$ for `model_proved`. Model infeasibility must never advance an authoritative physical lower bound.

### Model Qualification
The explicit classification of solver baseline: `exact` (solved on the exact placement model with physical instance variables) versus `approximate` (solved on the relaxed binary fast model). Fast mode reports `optimal` or `feasible` with `model_qualification: 'approximate'`, while mathematical optimality certification requires `exact` and `precision_resolved: 'precise'`.

### Strict Infeasibility Gating
The search invariant requiring that an infeasible bound (e.g. lower bound `lo` in MOA-floor binary search) advances if and only if a sub-solve returns certified `status: 'infeasible'` on the precise model under Issue #36 domain equivalence. Unresolved outcomes (timeouts, limits, errors, or Fast-model infeasibility) must never advance an infeasible bound.

### Single Request Deadline Clock
A unified request-level deadline clock normalized across browser contexts using global monotonic epoch milliseconds ($\text{epoch} = \text{performance.timeOrigin} + \text{performance.now}()$, defaulting to 60,000 ms if omitted). Enforces strict $\text{remaining\_ms} \le 0$ guards before every stage and after cancellation yields, propagates remaining time to sub-operations, bypasses the dispatch chain for out-of-band cancellation, and yields to the event loop between sub-solves.

### Objective Axes & Shared Scaling
The linear objective coordinate system defined in `lpBuilder.ts` and `trueErgo.ts`:
- `ERGO_SCALE = 10` ($fE = \text{ergonomics/TED} \times 10$)
- `SCALE = 1000` ($fR = \text{summed recoil modifier} \times 1000$)
- $fP = \text{objective purchase cost in rubles}$
- Augmented Tchebycheff: $\text{score} = 0.01 \cdot (c_e fE - c_r fR - c_p fP) - \text{maxDeviation}$, where $\text{maxDeviation} = \max_{a \in \text{active}} d_a$ (or 0 if empty), without outer zero clamp, preserving directional bonuses and handling all-zero weights without NaN.
All objective values, bounds, and tolerances are expressed strictly in these shared units.

### Global Spatial Upper Bound
The objective upper bound across the entire spatial branch-and-bound search tree, aggregated as $\max(\text{incumbent.objective}, \max_{k \in \text{OpenNodes}} \text{node}_k.\text{upper\_bound})$, yielding $+\infty$ if any open region is unbounded. Never replaced by the bound of a single closed node.

### Witness Build
A complete physical weapon build record backing an achieved MOA value (`hi`), carrying an instance-qualified attachment manifest, occurrence-aware `ItemDetail[]`, and configuration scope for independent verification. Bisection requires a finite, mathematically justified lower bound $\text{lo}$ before proceeding.

### Outward Ceiling Rounding
The outward-safe floor function `outwardSafeCeil(hi, decimals)` evaluated on the precision-dependent safe representation domain ($\text{MAX\_SAFE\_WITNESS}(\text{decimals}) = (\text{Number.MAX\_SAFE\_INTEGER} - 10) / 10^{\text{decimals}}$ for $\text{decimals} \in \{1, 2, 3, 4\}$). Enforces strict integer precision validation, postcondition $\text{display\_floor} \ge hi$, and withholds rounding (returning `null`) on unsupported representation states or overflow, preserving raw witness $hi$. Paired with an outward UI submission contract requiring outward ceiling snapping on offset grids ($origin + \lceil \frac{hi - origin}{\Delta} \rceil \Delta$) and pre-submission guards.

### Signed-Accuracy Big-M Bound
The exact Big-M row $\frac{c_b}{100} A(x) - M_b x_b \ge c_b - L - M_b$ (where $c_b = \text{coi}_b \cdot K, L = \text{maxMOA}$) with $M_b = \max(0, \text{MOA}_b^{\max} - L)$ and $\text{MOA}_b^{\max} = c_b (1 - A_{\min} / 100)$, paired with nonconstant fallback row $\frac{c_{\text{base}}}{100} A(x) + M_{\text{fb}} \sum_{b} x_b \ge c_{\text{base}} - L$ (and unconditional $\frac{c_{\text{base}}}{100} A(x) \ge c_{\text{base}} - L$ when no positive replacement barrels exist). $A_{\min} = \sum_{s \in \text{Slots}} \min(0, \min_{i \in \text{Allowed}(s)} \text{acc}_i)$ is derived by summing worst-case negative accuracy modifiers across reachable physical slot instances as a conservative lower bound.

### Ergonomics Clamp Specialization
The dynamic specialization of raw ergonomics clamping based on unclipped structural bounds $[rawLo, rawHi]$:
- $rawHi \le 0$: $t = 0$ (0 binary vars, 0 Big-M rows).
- $rawLo \ge 1000$: $t = 1000$ (0 binary vars, 0 Big-M rows).
- $rawLo \ge 0 \land rawHi \le 1000$: $t - r = 0$ (0 binary vars, 0 Big-M rows).
- $0 \le rawLo \le 1000 < rawHi$: Upper saturation clamp with $t \le r$, $t \ge r - (rawHi - 1000)z$, $t \ge 1000 - (1000 - rawLo)(1 - z)$ (1 binary var, 3 rows).
- $rawLo < 0 \le rawHi \le 1000$: Lower floor clamp with $t \ge r$, $t \le r + (-rawLo)z$, $t \le rawHi(1 - z)$ (1 binary var, 3 rows).
- $rawLo < 0 \land rawHi > 1000$: Full 3-regime piecewise clamp with $M = \max(|rawLo|, |rawHi|, 1000) + 1000$ (3 binary vars, 8 Big-M rows).

### Second-Clamp Elimination
The mathematical reduction establishing that when equipment ergonomics modifiers are non-positive ($factor = \max(0, 1 + \text{equipErgoModifier}) \le 1.0$), the product $factor \cdot \text{capped\_ergo}$ is strictly bounded in $[0, 1000]$. The second clamp is 100% mathematically redundant and replaced by a direct linear equality (`effective_ergo - gear_ergo = 0`), eliminating 3 binary variables and 8 Big-M rows.

### 3 kg Root Split Invariant
The search tree invariant requiring any initial weight interval spanning $W = 3\text{ kg}$ to be split at the root node into $[W_{\min}, 3]$ (where weight penalty $q(W) \equiv 0$) and $[3, W_{\max}]$ (where $q(W)$ is strictly concave), with node weight intervals $[W_1, W_2]$ enforced as hard LP bounds on `total_weight`. Guarantees that interval secants are valid under-estimators of $q(W)$ and valid upper bounds on TED.

### Outward Boundary Safety Pad & Objective Upper Bound Correction
An algorithmic row construction error bound $\delta_{\text{computed}}(k)$ derived through the complete expression DAG (incorporating the three-operation $\gamma_3$ bound for $\text{MOA}^{\max} = c_b(1 - A_{\min}/100)$ and directly accommodating fractional inputs like 15.5 g mounts without integer rounding) and dynamically gated against outward continuous allowances ($\epsilon_{\text{row}}(k) \ge \delta_{\text{computed}}(k)$). Paired with node-specific downward secant shifts ($s_{\text{outward}}(W) = \tilde{s}(W) - \Delta_{\text{secant\_node}}$) and linear/scalarized objective error corrections over absolute variable domains $B_j = \max(|lower_j|, |upper_j|)$ with outward rounding $\mathbf{UB_{\text{valid}} = \text{nextUp}(UB_{\text{native}} + \Delta_{\text{obj}})}$, mathematically proving that the represented LP is a strict outer relaxation of the physical model and that its dual bound is a strict upper bound on the true physical objective.

### Exact Purchase Deficit
The normative non-negative integer quantity equality $d_i = \max(0, \text{installed}_i - \text{owned}_i - \text{selectedPresetSupply}_i)$ governing out-of-pocket wallet expenditure, objective price axes ($fP$), price reconstruction, shopping list generation, and independent build validation across all objective weightings. Enforced via an unperturbed epigraph-projection and minimal-surrogate lifting contract ($u_i \ge d_i, u_i \ge 0$) preserving budget monotonicity ($\text{spend}^* \le \text{spend}^{\text{LP}}$), objective score non-decrease ($\text{score}^* \ge \text{score}^{\text{LP}}$), and unperturbed native dual bounds without artificial penalties.

### Purchase Variable Reduction
The exact substitution of $buy_i \equiv x_i$ into budget and objective rows for single-slot, unowned, non-preset mods ($q_{b,i} == 0 \land N_{\text{owned}}(i) == 0 \land \text{max\_installed}_i == 1$), and the complete presolve elimination of $buy_i$ for fully-owned ($N_{\text{owned}} \ge \text{max\_installed}$) items. Standalone-inaccessible items retain hard inventory caps regardless of stored price. Reductions are validated under formal equivalence proof gates (Issue #36).

### Recoil Cap Collapse
The analytical reduction where simultaneous hard vertical and sum recoil caps collapse into a single stricter linear bound $\text{mod} \le \min(\frac{Cap_V}{naked_V} - 1, \frac{Cap_{\text{Sum}}}{naked_V + naked_H} - 1)$ with positive denominator validation, omitting the looser redundant bound. If `recoil_def` is removed, the multi-copy recoil expression is directly inlined into all surviving constraints.

### Bound Provenance
The explicit tracking of bound derivation sources: distinguishing tight physical domain extrema tagged `provenance: 'structural_dag'` (used in search queues and bisection) from padded Big-M formulation constants (restricted strictly to LP constraint coefficients), validated by the standing invalidation conventions (ADR 0001 / Issue #22).

### Curve Status
The classification of a Pareto frontier sweep response (`ExploreResponse`):
- `complete`: All $N$ requested points terminated with certified outcomes (all verified builds, or a proved mix of verified builds and proved-infeasible points).
- `partial`: Usable sweep where at least one point yielded a verified build, but others timed out, errored, or were cancelled.
- `infeasible`: Entire requested range is proved infeasible (all $N$ points proved infeasible on the precise model under Issue #36 equivalence).
- `invalid`: Zero verified builds produced due to timeout, error, or early cancellation.

### Weapon MOA Semantics
The in-game accuracy formula under `moa_contract_scope: 'calibrated_consumer_baseline'`:
$$\text{MOA} = \text{effectiveCOI} \times \left(1 - \frac{\sum_{i} \text{accuracy\_modifier}_i}{100}\right) \times \frac{100}{2.9089}$$
evaluated at 100% full weapon and barrel durability.

### Barrel Replacement COI
The physical accuracy rule where an installed barrel mod's `center_of_impact` replaces the receiver's intrinsic COI, rather than adding to it. Supported on baseline by the M4A1 14.5" barrel discriminator ($0.053 \times 34.377 = 1.82\text{ MOA}$ matching in-game inspection and Official Wiki, vs additive $2.17\text{ MOA}$).

### Display-Bin Mapping Rule
The empirical observation principle where a test case discriminates between formula families if and only if their prediction intervals map to disjoint rounding bins. Half-up rounding $[x - 0.005, x + 0.005)$ is an unverified provisional display convention pending client attestation. On standard 2-decimal displays, Linear ($0.866$) and Multiplicative Compound ($0.875$) both map to the $0.87$ bin; matching a display bin constitutes consistency evidence, while universal physical certification requires first-party client decompilation.

### Four-Quadrant MOA Calibration Gate
The empirical evidence protocol across candidate formula families (Linear Subtractive, Divisor, Multiplicative Compound). Recognizes display rounding limits and requires client decompilation or high-divergence measurements exceeding display rounding intervals.

### Radian-to-MOA Conversion Factor
The normative decimal model convention $\text{MOA\_K} = \frac{100}{2.9089} \approx 34.377256007\dots$, representing the arc in centimeters of 1 Minute of Angle at 100 meters, with $[34.3, 34.3775]$ designated an arbitrary software comparison envelope.

### Statistical Acceptance Protocol
A strictly ordered, exhaustive 4-gate decision protocol evaluating paired execution arms:
- **Gate 1 (Hard Fail)**: Any physical validation failure (`validateBuild` errors > 0) or Issue #36 oracle/domain violation $\implies$ `FAIL`.
- **Gate 2 (Hard Fail)**: Any primary on-time success rate drop (physical optimum, proved infeasibility, or sweep completion), tail regression (candidate P95 $> 1.05 \times$ baseline P95), or 95% bootstrap CI lower bound $> 1.0 \implies$ `FAIL`.
- **Gate 3 (Pass)**: Zero correctness failures, rate and tail non-regression hold, both-success pairs count $N_{\text{both}} \ge 5$, and 95% bootstrap CI is non-degenerate with upper bound strictly $< 0.95$ ($\delta = 0.05$ practical speedup) $\implies$ `PASS`.
- **Gate 4 (Inconclusive)**: All other outcomes (speedup unproven, zero variance, or CI spans across 1.0) $\implies$ `INCONCLUSIVE`.
Cross-case adoption requires Gate 1 and Gate 2 to pass across all cases, and Gate 3 on every declared primary case.

### Case-Specific Success Rates
The primary rate metric evaluated over all planned attempts $N_{\text{planned}}$:
- Feasible optimization cases: `physical_optimum_rate` (on-time `certified_optimal`).
- Infeasible cases: `proved_infeasible_rate` (on-time `certified_infeasible` under #36 equivalence).
- Explore sweep cases: `completed_sweep_rate` (on-time `curve_status === 'complete'`). Typed as `null` with reason for non-Explore cases.

### Disjoint Timing Trace Invariant
The accounting invariant partitioning total caller wall-clock time into non-overlapping spans with a signed discrepancy:
$\Delta_{\text{trace}} = T_{\text{client\_elapsed}} - \sum_{k} t_{\text{phase\_}k}$.
If $\Delta_{\text{trace}} < -1.0\text{ ms}$, the trace is flagged `overlapping_spans` and rejected. Otherwise, positive $\Delta_{\text{trace}} is recorded as `unclassified_residual_ms`.

### Versioned Request Identity
A deterministic canonical JSON SHA-256 hash uniquely identifying every parameter of an optimization or explore request across core problem definition, physical limits, objective weights and reference points, inventory multisets, and algorithm configuration, bound to explicit contract versions (ADR-0002, ADR-0003, ADR-0004, ADR-0005) and the full 64-character SHA-256 digest of `snapshot.json` (`219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`).

### 5-Element Cache State Vector
A structured vector explicitly declaring the caching state of benchmark runs:
`[worker: fresh | reused, data: cold | warm, wasm: cold | warm, prep: cold | warm, endpoint_pre_state: cold | seeded | n/a]`
Replaces ambiguous boolean "warm" flags with reproducible manifest recipes and arm-isolated watchdog recovery.

### Alternating Paired Protocol
A comparative benchmarking protocol where paired arms alternate execution sequence per case ($A \to B, B \to A, A \to B$) with identical budgets, separate isolated worker threads per arm, and runner watchdogs terminating failing workers immediately upon timeout to prevent background execution leakage.

### Emission-Time Model Counters
Direct measurement of model dimensions (`matrix_rows`, `matrix_cols`, `model_total_variables`, `matrix_nonzeros`, `discrete_variables`) incremented at statement emission time within `lpBuilder.ts` (excluding bounds and objective rows), eliminating reparsing overhead on the solve path.

### Emitted vs. Native Metric Provenance
The explicit distinction between dimensions directly countable from the emitted CPLEX model (`provenance: 'emitted_lp'`) and native solver internals (`presolved_rows`, `native_mip_nodes`, `native_dual_bound`, `presolved_integer_variables`, `native_relative_gap`) which are labeled `UNAVAILABLE` (`null`, `reason: 'unsupported_by_shipped_wasm'`) in the shipped WASM wrapper.

### Time-to-Trusted-Certificate
The total elapsed wall-clock latency from public request creation until an independent physical build check validates with zero errors (`validateBuild` errors = 0) and physical optimality is certified (`physical_certificate === 'certified_optimal'`). Distinct from raw solver exit time; evaluates to `null` if uncertified.

### Containing Preset
A pre-assembled weapon configuration sold by traders that includes a receiver and pre-attached components with integer counts $q_{b,i} \in \mathbb{Z}_{\ge 0}$. When selected as the base, included components are acquired at zero marginal cost. A containing preset provides free components but never forces a preset purchase when a component can be legally supplied via standalone purchase or owned stash inventory.

### Preset Stripping
The removal of unused pre-installed components from a purchased preset base at zero liquidation value (₽0 spend, ₽0 resale credit) without penalty.

### Owned Item (Stash Inventory)
A component already in the player's personal inventory (`owned_items?: string[]`), represented as element multiplicity in a multiset array ($N_{\text{owned}}(i)$). Validated at worker entry (array of non-empty strings, length $\le 10{,}000$). The full validated multiset array is preserved in the canonical request telemetry hash. Reachable mods define an internal weapon-scoped acquisition projection. Free copies offset required quantities under normative deficit equality: $buy_i = \max(0, \text{installed}_i - N_{\text{owned}}(i) - \sum_b q_{b,i} base_b)$ with exact MIP formulation delegated to Issue #33. Supplied at zero out-of-pocket cash expenditure (`buy_i = 0`), consuming ₽0 of `max_price` budget and adding ₽0 to the price objective. In the output build manifest, instances are deterministically assigned by code-unit order of `instanceId` (preset first, owned second, purchased remainder). For items that cannot be acquired standalone under active market settings, stash quantity strictly caps the maximum number of copies that can be installed on the weapon: $\sum_s p_{i,s} \le \sum_b q_{b,i} base_b + N_{\text{owned}}(i)$.

### Standalone Market Accessibility
Whether an item can be acquired standalone under the request's specific market configuration (`flea_available`, `barter_available`, `player_level`, `trader_levels`). An enabled barter at an accessible trader level constitutes an accessible standalone acquisition path.

### Out-of-Pocket Expenditure
Actual rubles spent to acquire the base and unowned components, counting direct currency spend (trader cash and flea market) plus the established RUB-equivalent valuation of required barter items when barters are enabled. Evaluates exact deficit purchases ($d_i$), strictly excluding owned and preset-supplied parts from budget consumption. The hard budget constraint `max_price` applies strictly to out-of-pocket expenditure.

### Required Slot
A slot marked as mandatory (`required: true`).
- **Root Required Slot**: Mandatory for the weapon itself (occupancy = 1). If a root required slot has zero accessible candidates, the problem is proved physically infeasible.
- **Mod-Owned Required Slot**: Mandatory **conditional on its parent instance being selected** (occupancy = $x_{\text{owner\_instance}}$). If empty, that parent instance is forced off ($x_{\text{owner\_instance}} = 0$); alternative parent/attachment paths remain valid.

### Proved Infeasibility
A certified determination by the solver that no mathematically or physically feasible build exists within the specified domain. Distinct from malformed input errors, unproved source data, or incomplete runs halted by time/node limits.
