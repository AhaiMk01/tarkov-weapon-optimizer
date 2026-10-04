# ADR 0010: Independent Physical-Oracle and Equivalence Proof Gates

## Status
Accepted planning decision (Refs #36). Reconciled 2026-10-04; enumeration, production validator repairs, universal theorem and native/comparative evidence are not implemented by this record.

## Context
During the frontend solver audit, existing verification entrypoints passed cleanly despite targeted counterexamples exhibiting severe mathematical bugs (e.g. single-item satisfaction of multiple required slots, inverted Big-M rows, phantom spend under zero price weight, and missing fallbacks in zero-intrinsic MOA). Tests passed because they were written against the solver's internal compatibility maps and LP abstractions rather than raw physical reality. Furthermore, mathematical reductions require formal equivalence gates to guarantee that no valid physical builds or optimizing ties are lost.

## Decision

We establish six core principles governing physical verification, behavioral regression, reduction equivalence, and authority hierarchies:

1. **Independent Physical Oracle Contract & Qualified Status Rules**:
   - Enumerate the finite rooted domain from an independent test-side reader of unpruned raw snapshot/source documents, not production `ItemLookup` extraction, compatibility/pruning maps, LP rows or decoded selections. An independently constructed reference lookup is acceptable; sharing production normalization/scoring is not independence.
   - Pin `snapshot.json` SHA-256 `219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c` and preserved source `backup/pre-revert-2.13` @ `a4ab2a5fd189c9451304087641a584d90fc249eb`. The snapshot comes through `fetchAllData`: record which adapter transformations are trusted and independently check source cardinalities/references, preset counts, fractional weights, synthesized flea/barter offers and translations. This is the adopted software domain, not universal game truth.
   - Evaluates exact physical equations directly in exact rational arithmetic over $\mathbb{Q}$.
   - Determines:
     (a) Complete set of feasible physical builds $\mathcal{F}_{\text{physical}} = \{B_1, \dots, B_K\}$;
     (b) True maximum physical score evaluated in exact rational arithmetic: $S^* = \max_{B \in \mathcal{F}} \text{score}_{\mathbb{Q}}(B)$;
     (c) Exact set of optimal tie builds $\mathcal{T}^* = \{B \in \mathcal{F} \mid \text{score}_{\mathbb{Q}}(B) == S^*\}$;
     (d) Proved Physical Infeasibility if $\mathcal{F}_{\text{physical}} == \emptyset$.
   - **Qualified Status and Terminal Bound Inheritance (under ADR 0004 / ADR 0006)**:
     - Completed Precise Mode Proof (MOA-independent): `status: 'optimal'`, `model_qualification: 'exact'`, `precision_resolved: 'precise'`, `physical_certificate: 'certified_optimal'`.
     - Completed Fast Mode Proof (MOA-independent): `status: 'optimal'`, `model_qualification: 'approximate'`, `precision_resolved: 'fast'`, `physical_certificate: 'approximate_optimal'`.
     - Completed Precise Mode Proof (MOA-dependent under ADR 0006): `status: 'optimal'`, `model_qualification: 'exact'`, `moa_qualification: 'provisional_model'`, `physical_certificate: 'approximate_optimal'`.
     - Completed Fast Mode Proof (MOA-dependent under ADR 0006): `status: 'optimal'`, `model_qualification: 'approximate'`, `moa_qualification: 'provisional_model'`, `physical_certificate: 'approximate_optimal'`.
     - Proved Infeasible on Precise Model (MOA-independent): `status: 'infeasible'`, `physical_certificate: 'certified_infeasible'`.
     - Proved Infeasible on Fast Model (MOA-independent): `status: 'incomplete'`, `reason: 'Approximate model infeasible'`, `physical_certificate: 'none'`; no physical infeasibility claim.
     - Proved Infeasible on Precise Model (MOA-dependent under ADR 0006): `status: 'incomplete'`, `reason: 'Provisional MOA model infeasible'`, `physical_certificate: 'none'`, with internal `model_infeasible` retained.
     - Proved Infeasible on Fast MOA-dependent Model: `status: 'incomplete'`, `reason: 'Fast provisional MOA model infeasible'`, both approximate/provisional qualifications retained and no physical certificate.
     - MOA-independent responses transport `moa_qualification: null`. Termination independently describes search completion: every completed executed-model search, including Fast or provisional emptiness, uses `optimal`; unfinished/unstarted search uses `limit`. Failed proof qualification or validation alone never changes a completed search to `limit`. Status/certificate/qualifications/reason retain all authority fences. Later #41/#42 shapes and the further #40 completion amendment override conflicting older fields.
     - Deadline / cancellation after already-proved optimum: **Must preserve already-proved optimum status**; late cancel/deadline never downgrades.
     - Late deadline/cancellation never downgrades any completed qualified proof, including qualified model infeasibility; it does not promote Fast/provisional authority.
     - Interruption, withheld proof without interruption, or rejected final decode with a prior independently verified incumbent: `status: 'feasible'`, `physical_certificate: 'feasible'`, justified incumbent lower bound and global upper bound. Without a verified incumbent: `status: 'incomplete'`, no build/certificate, `lower_bound: null`, justified upper bound or `null`.
     - Global upper bounds include live **and tolerance-fathomed** frontier bounds in the same corrected objective frame. Unknown/nonfinite/unproved bounds stay `null`, never inferred from primal objectives. A rejected final decode cannot replace a valid prior witness; diagnostics follow the capstone precedence without concealing validation failure. Native failures use the typed #35 operation error envelope, not fabricated builds.
     - Every returned build must pass independent validation (`validateBuild` errors = 0).
2. **Normative Objective Equations & Exact Rational Encoding ($\mathbb{Q}$)**:
   - With coordinates $fE = \text{ergo/TED} \times 10$, $fR = \text{summed recoil mod} \times 1000$, $fP = \text{RUB spend}$, and resolved non-negative weights $e, r, p$:
     - **Linear Weighted Sum**:
       $$\mathbf{\text{score}_{\mathbb{Q}} = \left(\frac{e}{10}\right) fE_{\mathbb{Q}} - r \cdot fR_{\mathbb{Q}} - \left(\frac{p}{1000}\right) fP_{\mathbb{Q}}}$$
       *(For binary64 weights $e=0.4,r=0.6,p=0$, A with $fE=600,fR=-100$ and B with $fE=500,fR=-300$ have rounded scores 84 and 200, not exactly those rational scores. All-zero weights give zero for every build.)*
     - **Augmented Tchebycheff**:
       Let $sum = e + r + p$ (or $1$ if $e+r+p == 0$).
       $$c_e = \frac{e}{sum \cdot \max(zE - nadE, 1)}, \quad c_r = \frac{r}{sum \cdot \max(nadR - zR, 1)}, \quad c_p = \frac{p}{sum \cdot \max(nadP - zP, 1)}$$
       Active deviations: $d_e = c_e (zE - fE_{\mathbb{Q}})$, $d_r = c_r (fR_{\mathbb{Q}} - zR)$, $d_p = c_p (fP_{\mathbb{Q}} - zP)$ (only for axes with positive weight).
       $$\mathbf{\text{score}_{\mathbb{Q}} = 0.01 \cdot (c_e fE_{\mathbb{Q}} - c_r fR_{\mathbb{Q}} - c_p fP_{\mathbb{Q}}) - \max_{a \in \text{active}} d_a}$$
       preserving negative deviations without an outer zero clamp.
       If no axis is active, `maxDeviation = 0` and the score is zero; resolved weights remain nonnegative while active deviations may be signed.
   - Resolve defaults independently, then decode finite binary64 leaves (source/request weights, COIs, modifiers and prices) by exact integer ratios (e.g. $0.35 = 3152519739159347/9007199254740992$). Constants are declared rationals: `ERGO_SCALE=10`, `SCALE=1000`, augmentation $1/100$, $K=1000000/29089$. For legal nonnegative barter totals, integer rounding is $\lfloor total+1/2\rfloor$. Store scores/ties as integer ratios; runtime feasibility/reporting tolerances and outward bound allowances are separate, not membership in an exact tie set.
   - Exact physical ties are defined strictly by equality in $\mathbb{Q}$: $\text{score}_{\mathbb{Q}}(B_1) == \text{score}_{\mathbb{Q}}(B_2)$.
   - **Gate B Exact Invariance**: Exact reductions must preserve mathematical objective and exact rational tie set: $\pi_{\text{sel}}(\mathcal{T}_{\mathbb{Q}}^*(\mathcal{M}_{\text{reduced}})) \equiv \pi_{\text{sel}}(\mathcal{T}_{\mathbb{Q}}^*(\mathcal{M}_{\text{baseline}}))$.
3. **Canonical Selection Projection vs. Rooted Occurrence Witnesses**:
   - **Canonical Selection Projection**: $\mathbf{\pi_{\text{sel}}(B) = (base^*, \text{multiset of installed item IDs with counts})}$.
   - **Gate A (Selection Projection Equivalence)**:
     $$\mathbf{\pi_{\text{sel}}(\mathcal{F}(\mathcal{M}_{\text{reduced}})) \equiv \pi_{\text{sel}}(\mathcal{F}(\mathcal{M}_{\text{baseline}}))}$$
     Surjective many-to-one projection accommodating unperturbed expense surrogates at $p=0$ and interchangeable legal physical slot assignments without requiring bijective LP variable equality.
   - **Rooted Occurrence Witness Invariant**: Any returned physical build must be accompanied by a valid, rooted physical instance tree manifest ($p_{i,s}$) with unique instance IDs, verified by `validateBuild` to have zero conflicts, full parent connectivity, and exact capacity compliance.
   - Continuous Placement Reconsideration (Issue #39) requires exact bipartite/network matching reconstruction theorem proving that every decoded placement is physically legal, conflict-free, and rooted.
   - Gate C preserves emptiness: $\mathcal F_{\text{model}}=\emptyset \iff \mathcal F_{\text{physical}}=\emptyset$. On each exhaustive precise fixture, Gate A compares complete projected feasible sets, Gate B compares exact maximum and **all** maximizing projections (enumerate model optima, e.g. with no-good cuts), and Gate C compares emptiness. Enumeration proves only that fixture; universal correctness/reduction equivalence additionally requires a mathematical lifting/projection proof over the entire declared domain.
   - Fast requires every **published accepted witness** to reconstruct into the physical feasible set with truthful approximate qualification. No universal $\mathcal F_{\text{fast}}\subseteq\mathcal F_{\text{physical}}$ theorem is imposed on raw Fast points; failed reconstruction is unverified/incomplete unless an earlier verified witness can be retained.
4. **Canonical 14-Family Behavioral Regression Ledger**:
   Every solver repair, numerical update, or model reduction must pass all 14 canonical physical scenario families evaluated against the independent physical oracle:
   1. *Slot Occupancy & Conflicts Family*: Pairwise item conflicts, self-conflicts on duplicate copies, and slot-occupancy conflicts (`conflicting_slot_ids`). Part equips in clear alternative slot when first slot is blocked.
   2. *Exhaustive Empty-Required Routes Family*: Root required empty $\implies$ certified `infeasible`; mod-owned required empty $\implies$ parent forced off ($x_{\text{parent}} = 0$) while alternative attachment paths survive; allowed candidates unreachable by market or parent deactivation $\implies$ certified `infeasible` if root.
   3. *Rootedness & Acyclicity Family*: Deep tree deactivation ($Root \to Parent \to Child \to Grandchild$); unselected parent strictly prunes all descendants. Self-referential and ancestor-repetition loops ($A \notin \text{Ancestors}(s)$) strictly pruned.
   4. *Includes & Constraints Family*: Forced inclusions (`include_items`), categorical includes (`include_categories`), impossible/conflicting includes (certified `infeasible`), and includes exceeding total physical slot capacity.
   5. *Base Accessibility Family*: Naked receiver locked by trader level but containing preset accessible $\implies$ solves with preset base at real spend; all bases locked $\implies$ certified `infeasible`.
   6. *Preset Stripping & Multi-Copy Supply Family*: Retains included preset parts at ₽0 marginal cost up to $q_{b,i}$; strips unwanted parts at ₽0 penalty; exact out-of-pocket mod spend added to base preset cost.
   7. *Stash Inventory Monotonicity Family*: Adding owned items satisfies: (a) fixed-build spend non-increase $\text{spend}(B \mid N+\Delta) \le \text{spend}(B \mid N)$; (b) feasible-set expansion $\mathcal{F}(N) \subseteq \mathcal{F}(N+\Delta)$; (c) optimal score non-decrease $S^*(N+\Delta) \ge S^*(N)$.
   8. *MOA Numerics & Boundary Fallbacks Family*: Constant-only MOA exceeding cap with optional vs required barrels; zero-intrinsic receivers with modular barrels; worst-case negative suppressors ($-5\%$); nonpositive/missing COI barrels fallback to intrinsic COI.
   9. *One Item / Two Required Slots Family*: Two required slots accept only item $T$. Item $T$ is **standalone-inaccessible ($buy_T = 0$ enforced)**, 0 preset copies, and stash contains exactly 1 copy ($N_{\text{owned}}(T) = 1$) $\implies$ certified `infeasible` on precise model; fast mode approximation cannot claim exact `optimal`.
   10. *Disconnected Cycles & Self-Loops Family*: Floating recursive loops without weapon connection strictly unselected ($x_A = 0, x_B = 0$).
   11. *Ergonomics Clamping Family*: Every raw/effective clamp regime and boundary, including wholly below zero/above 100, saturation/floor/full disjunction, identity and zero equipment factors, and factors below/above one.
   12. *TrueErgo (TED) & Overswing Family*: W below/at/above 3 kg; singleton/narrow hard intervals; concave penalty above 3 kg; full outward-safe secant arithmetic. A $10^{-9}$ shift is a default only if it dominates computed node error, not universal safety. Include coefficient/mapping/parser errors; overswing nonzero iff TED < 0.
   13. *Zero Price Weight ($p=0$) & Multiple Presets Family*: Minimal deficit $d_i$ evaluated; zero phantom spend; unperturbed epigraph projection holds without objective penalties.
   14. *Multi-Copy Instance Tracking Family*: Distinct instance IDs in manifest, quantity-aware purchase deficits, fractional source weights (such as $0.0155\text{ kg} = 15.5\text{ g}$ mount).
   The full ledger additionally includes magazine/sighting/recoil-cap boundaries; category-group inclusion and independent slot/conditional-required checks; all-zero weighted/Tchebycheff weights, signed active deviations, inactive axes, normalization floors and exact ties; identity/zero equipment factor and every raw/effective clamp boundary; mixed preset/owned/paid stock, stripping **and retention**, unavailable-item caps and zero price without legal offer. Each case records prerequisites, raw source/request, feasible-set/tie expectations, failure route and proof evidence. Well-separated completed-optimum fixtures use gaps > $10^{-4}$, but retain tiny positive-gap/near-cap fixtures with pinned runtime tolerance; justified reported intervals must contain the independent optimum in the same frame.
5. **Independent Raw Data Input & `validateBuild` Cutover Contract**:
   - The Physical Oracle and test harness parse raw Tarkov.dev JSON documents independently of the legacy adapter in `dataService.ts`:
     - Preserving multi-copy preset supply $q_{b,i}$ as integer arrays/counts (not flattened sets).
     - Preserving exact fractional weights (`0.0155 kg`).
     - Using exact barter ingredient requirements with `avg24hPrice ?? basePrice ?? 0`.
     - Using normative $\text{MOA\_K} = 100 / 2.9089$.
   - Stage 1 builds a separate test-side reference validator from raw source and independent equations; expected legacy extraction mismatches do not block Stage 2 repairs. Stage 3 upgrades production `validateBuild` to reproduce **every reference accept and reject**, including rooted instance bijection, template/self/slot conflicts, categories, required occupancy, acquisition/quantity caps, exact spend, clamp/TED and provisional MOA formulas. Production validation and tests calling `solve`/production maps are not themselves oracle evidence.
   - Qualified proof requires a pinned reproducible WASM/glue build with core/wrapper/toolchain versions and digests; structured full-precision primal objective/columns, native status/dual/gap/telemetry extracted before handle destruction; and parsed-model equivalence/readback for the pinned parser. Explicit matrix thresholds alone do not prove coefficient survival. Verify emitted coefficients/domains/scaling, finite proof-relevant auxiliary ranges and the complete operation-level outward error DAG; otherwise withhold proof. No rounded pretty-text primals or unqualified stock-package fallback.
6. **Full Comparative Benchmark Contract & Separation of Concerns**:
   - **Correctness Repairs (Bug Fixes)**: Evaluated against the Independent Physical Oracle across the 14 Regression Families. Must achieve 100% physical correctness; **never** required to demonstrate a 5% speedup.
   - **Exact Reductions (Optimizations)**: Evaluated against the Correct Versioned Baseline Model. Must satisfy Gates A, B, C, and achieve Gate 3 on the full 4-gate comparative benchmark harness.
   - **Primary 4-Gate Comparative Benchmark Summary (ADR 0005 / Issue #37)**:
     - Gate 1 (Hard Fail): Any physical validation failure (`validateBuild` errors > 0) or oracle violation $\implies$ `FAIL`.
     - Gate 2 (Hard Fail): Any primary on-time success rate drop, tail regression ($P95 > 1.05 \times$), or bootstrap 95% BCa CI lower bound $> 1.0 \implies$ `FAIL`.
     - Gate 3 (Pass): Zero correctness failures, rate/tail non-regression, $N_{\text{both}} \ge 5$, and bootstrap 95% BCa CI non-degenerate with upper bound strictly $< 0.95$ ($\ge 5\%$ practical speedup) $\implies$ `PASS`.
     - Gate 4 (Inconclusive): All other primary outcomes (speedup unproven, zero variance, or CI spans across 1.0) $\implies$ `INCONCLUSIVE` (candidate not adopted).

   - The selected secondary policy covers validated Fast/provisional-MOA `approximate_optimal` with justified native/global gaps. Floor minimum-quality cases require on-time `model_proved`, full witness, truthful provisional scope, outward/withheld display and qualified bracket gap <= .02; discovered lo is sufficient, no analytic-lo formula is required. Candidate-affected floor search requires such a predeclared proved-bracket case. Separate interruption/availability cases may accept validated `model_witnessed`/`model_proved` and cannot substitute for minimum-quality evidence. Do not compare arbitrary initial cheapest-build tie MOAs or apply baseline-witness .02 quality deltas; any optional witness target must be fixed independently before runs. Require zero goal-rate drop, Type 7 P95 <= 1.05, at least five matched successes, valid nondegenerate paired CI and no significant-slowdown lower bound > 1. Secondary PASS_NONREGRESSION needs no 5% speedup; missing/invalid evidence is INCONCLUSIVE. Secondary cases cannot be primary speedup evidence.
   - Primary cases remain physically certified precise #37 cases, with a nonempty candidate-relevant primary set mandatory. P95 is Type 7 over planned attempts, failures imputed deadline + 5000 ms; planned denominators and paired interval procedures remain binding. Correct expected negative-case rejections are not correctness failures. Optional Stage 4 gates never block a proved Stage 3 correctness cutover.

## Consequences & Downstream Handoff

- **Issue #39 ([Reconsider continuous precise placement against matching and performance evidence](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/39))**: Settled conservatively in ADR 0011; this oracle contract remains an unimplemented proof/evidence gate for the correctness cutover and any future candidate.

## Operation Integration

- Canonical authorities: [#36](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/36#issuecomment-5974832944), [#34 numerical proof](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/34#issuecomment-5970763741), [#41](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/41#issuecomment-5966142296), [#42](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/42#issuecomment-5971674033), and [#40 review](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5977261158).
- Explore I means `status: infeasible` plus `certified_infeasible`; Fast/provisional model impossibility and unlaunched targets are U. Require N >= 1; late cancellation cannot downgrade a finished schedule. Queue-expired Explore returns invalid/[] and floor unresolved/null.
- Floor default is 30000 ms. Missing analytic lo starts **lower-bracket discovery**, not witnessed-only return. Qualified Precise model infeasibility can establish lo even when it was null; then run bisection. Unresolved/unqualified trials halt and retain the last verified upper bound. No analytic bound or universal completion guarantee is invented. ADR0013 section6 controls.

### Owner-decided reference interpretations (2026-10-04)

The Stage 1 reference makes several interpretation choices where the ADRs are silent. They are numbered and append-only in `frontend/reference/INTERPRETATIONS.md`, which also records where production differs and which ledger cases exercise each one. The owner decided all of them on 2026-10-04; three decisions are substantive:

1. **Category matching spans the whole category chain.** A category id matches an item anywhere in its own-then-ancestors chain, for `exclude_categories` and for every `include_categories` group. Production matches only an item's own category.
2. **Loaded (camora) ammunition is excluded from the physical domain.** Loaded ammunition is out of scope (decision map #28). In the reference fixture a slot whose allowlist holds only ammunition templates is removed, not emptied, so a revolver cylinder stays an installable required magazine; a slot that mixes ammunition with other candidates is refused; preset ammunition stays inert supply. Production, which models only `mods`-typed items, already agrees.
3. **The Tchebycheff payoff table is an input, checked by exact admissibility.** The three single-axis payoff solves have unique ideal coordinates but possibly tied optima, so the nadir is not unique and a Tchebycheff optimum can change with the tie a solver returned. The oracle keeps taking the ideal point as an input, enumerates every admissible table (one tied optimal build per axis, chosen jointly) and checks a reported table exactly in Q. Gate B comparisons are made under that same table.

Production must adopt chain category matching and payoff-table reporting (the table used, carried in the result's `ideal_point`) in Stage 2. The remaining choices are accepted as documented in `INTERPRETATIONS.md`.
