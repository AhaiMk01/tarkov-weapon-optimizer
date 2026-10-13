# ADR 0005: Trustworthy Solver Telemetry and Comparative Benchmark Gates

## Status
Accepted planning contract (Refs #37), with explicit owner-selected qualified-secondary non-regression coverage from the corrected #40 integration. Reconciled 2026-10-04; no implemented telemetry or performance result is claimed.

## Context
Capability research (Issue #30) and benchmark audits revealed critical gaps in how solver performance is measured, compared, and certified:
1. **Missing Actionable Acceptance Gates**: Reporting summaries without ordered pass/fail rules allowed candidates with certification drops or ambiguous speedups to avoid rejection, while degenerate zero-variance bootstrap runs risked false certification.
2. **Infeasibility & Sweep Coverage Gaps**: Rate regression checks focused solely on physical optimum rates, failing to catch regressions on infeasible cases or explore sweeps.
3. **Timing Opacity & Overlap Concealment**: Benchmarks measured only total caller elapsed time, and clamping residuals to zero masked overlapping timing spans.
4. **Request & Fixture Underspecification**: Hash projections omitted domain inputs (such as stash quantities, weights, and category groups), risking comparing non-identical problems.
5. **Cache & Execution Bias**: Unstructured "warm" flags hid initialization differences, while sequential batching ($A \to A \dots B \to B$) exposed comparisons to thermal throttling and GC drift. Leaked worker processes on watchdog timeouts corrupted subsequent partner runs.
6. **Reconsideration Churn**: Past experiments showed that reducing integer declarations often added unmetered preparation overhead or degraded search speed without improving certification.

The [accepted canonical #37 resolution](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/37#issuecomment-5963491079) controls the primary paired protocol. The owner chose qualified secondary coverage for Fast/provisional-MOA/floor. The further #40 correction replaces the circular immediate no-lo fallback with bracket discovery, makes termination independent of proof and removes cheapest-build tie-sensitive witness-quality comparisons. ADR 0004 and ADR 0006 retain the provisional MOA and inventory/envelope fences; no game-authority or measured performance claim follows.

## Decision

The following planning rules govern telemetry, primary speedup claims, qualified-secondary non-regression and reconsideration:

1. **Strictly Ordered, Exhaustive Statistical Acceptance Protocol**:
   - Direction and estimator: Median paired latency ratio $\text{Ratio} = \text{latency}_{\text{cand}} / \text{latency}_{\text{base}}$ ($< 1.0$ better), using independently verified, both-success on-time pairs.
   - Resampling Unit: Paired blocks across alternating sequence ($A \to B, B \to A$), $N \ge 5$ predeclared alternating pairs per case (no optional stopping). 10,000 BCa bootstrap resamples with pinned Mulberry32 PRNG seed (`seed = 42`), leave-one-paired-block-out jackknife and Type 7 quantile interpolation remain unchanged.
   - Non-Degeneracy Requirement: Sample variance must be strictly positive; zero-variance, undefined acceleration or otherwise invalid/insufficient interval evidence is `INCONCLUSIVE`, never a fabricated point-interval pass.
   - Predeclared Margins: Primary practical speedup $\delta = 0.05$ (CI upper ratio $< 0.95$), P95 tail regression margin $0.05$, and zero success-rate-drop tolerance.
   - **P95 convention**: Type 7 linear interpolation on **all planned attempts**, sorting their latencies and using $h=1+(n-1)0.95$ with interpolation between adjacent order statistics. Failed/uncertified/late attempts are imputed as `req.time_limit_ms + 5000 ms` for the case's declared success predicate, not omitted.
   - Ordered Decision Rules:
     - **Gate 1 (FAIL)**: Any independently rejected published build or violation of the applicable #36 domain/objective/oracle obligations $\implies$ `FAIL`. Exact Precise reductions may not drop valid physical builds; Fast still requires every accepted output to be valid with honest approximate qualification, not a newly invented theorem for every raw Fast model point.
     - **Gate 2 (FAIL)**: Any on-time success rate drop for the declared case goal, P95 tail regression ($> 1.05 \times$ baseline), or valid 95% paired bootstrap CI lower bound $> 1.0 \implies$ `FAIL`. These non-regression protections apply to primary and qualified-secondary cases.
     - **Gate 3 (Primary PASS)**: Zero correctness failures, rate and tail non-regression, $N_{\text{both}} \ge 5$, non-degenerate BCa interval, and 95% CI upper ratio $< 0.95 \implies$ primary `PASS`.
     - **Gate 4 (INCONCLUSIVE)**: All remaining primary outcomes (speedup unproved, insufficient pairs or invalid/degenerate statistical evidence) are `INCONCLUSIVE`; primary BCa rules are not relaxed by secondary coverage.
   - Cross-Case Adoption: Predeclare a **nonempty, candidate-relevant physically certified Precise primary set**. Gate 1/Gate 2 must pass on all cases, every primary must achieve Gate 3, and every required secondary must meet `PASS_NONREGRESSION` below. No primary set, irrelevant primaries or an unevaluable secondary yields `INCONCLUSIVE`, not a vacuous acceptance. Optional Stage 4 performance candidates do not block a proved Stage 3 correctness cutover.
2. **Case-Specific Success Rates & Latency Endpoints**:
   - Denominator: Total planned attempts $N_{\text{planned}}$ for that case and arm.
   - Numerators:
     - Physically certified Precise feasible optimization cases: on-time `status: 'optimal'`, `physical_certificate: 'certified_optimal'`, clean independent validation, `termination: 'optimal'`, and justified finite native/global gap within tolerance. This includes the linear path; status plus validation is insufficient.
     - Physically certified Precise infeasible cases: on-time `certified_infeasible` under #36 equivalence.
     - Explore primary cases: on-time `curve_status === 'complete'` with full independently verified scheduled coverage, or `infeasible` for a predeclared all-infeasible sweep. `completed_sweep_rate` is strictly null with `reason: 'not_an_explore_case'` elsewhere. A secondary-mode sweep cannot become primary merely by completing.
   - Latency ratios: strictly verified both-success on-time pairs (`client_elapsed_ms <= req.time_limit_ms`); late diagnostics never count. Feasible/infeasible primary endpoints are caller-through-runner verification (`time_to_trusted_cert_ms`); Explore uses caller promise-settlement latency, with runner verification reported separately.
   - **Qualified secondary cases (explicit owner choice; never primary)**:
     - Fast/Auto→Fast and provisional-MOA optimization success requires an on-time independently validated `optimal`/`approximate_optimal` build, `termination: 'optimal'`, the truthful placement/MOA qualifications and justified finite native/global gap within tolerance. Merely feasible incumbents are not model-optimum successes.
     - Predeclare **minimum-quality floor cases** requiring on-time `model_proved`, full verified scoped witness, qualified model bracket gap `<= 0.02 MOA`, truthful provisional qualification and outward-or-withheld display under ADR 0004. lo may come from bracket discovery; an analytic formula is not required. Candidates affecting floor search must include at least one such case. A proved bracket bounds hi within .02 of the same model minimum irrespective of cheapest-build tie ordering.
     - Separate **interruption/availability** cases may accept on-time validated `model_witnessed`/`model_proved`, preserving full scope and safe display. They protect witness retention, not minimum-MOA accuracy, and cannot replace the minimum-quality case. Report witnessed-upper-bound rate/latency separately from `model_proof_rate`; never count `model_witnessed` as proved. Remove relative baseline-witness .02 deltas; any additional witness-quality target must be independently fixed and justified before either arm runs, never chosen by the seed's arbitrary cheap tie.
     - Secondary `PASS_NONREGRESSION` requires zero correctness failures, no success-rate drop, P95 `<= 1.05` baseline, at least five both-success on-time pairs with a valid non-degenerate retained BCa interval, and no significant-slowdown CI lower bound `> 1.0`. There is **no 5% primary-speedup requirement** for secondary cases. Failed witness-quality/rate/tail or valid significant-slowdown gates are `FAIL`; insufficient/invalid statistical evidence is `INCONCLUSIVE`.
     - Rates retain planned denominators and P95 retains Type 7 failure imputation. No evaluable secondary success pairs is `INCONCLUSIVE`, never a fake zero-rate pass. Qualified model/witness latency is labeled separately from physically trusted certificate latency.
3. **Exhaustive Canonical Semantic Request Identity & Clean-Tree Provenance**:
   - Pinned by full 64-hex SHA-256 digest of `snapshot.json` (`219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`).
   - Deterministic canonical JSON SHA-256 covers **every resolved semantic input**, not a hardcoded field count: operation, schema/domain/placement/certificate/benchmark versions, model-authority and normalization/formulation versions, weapon/data/mode identity, trader/player/flea/barter/dogtag access, all hard constraints, equipment and axis/objective flags, non-negative weights and reference frame, precision/bounds/proof/time controls, full canonical owned-item multiset and Explore schedule. Defaults remain explicit. Item/category multiset-versus-set rules follow #37/#42; category groups are internally sorted then sorted lexicographically by their **complete ID sequences**, with shorter prefixes first in deterministic code-unit order.
   - Formal runs require a demonstrably clean working tree (`is_dirty: false`). Pin baseline `backup/pre-revert-2.13` @ `a4ab2a5fd189c9451304087641a584d90fc249eb`, per-arm actual worker/wrapper/WASM digests and runtime/toolchain provenance. Historical shipped artifact toolchains may be `unknown_upstream`; the planned proof-bearing rebuild must pin core/wrapper commits, ABI, emsdk/build settings and artifact digests. Schema/authority/normalization changes invalidate identity rather than masquerading as the same case.
4. **Signed Timing Trace Accounting Invariant**:
   - Total caller latency $T_{\text{client\_elapsed}}$ satisfies:
     $$T_{\text{client\_elapsed}} = t_{\text{client\_queue}} + t_{\text{worker\_lifecycle}} + t_{\text{prep}} + t_{\text{lp\_build}} + t_{\text{highs\_wall}} + t_{\text{decode}} + t_{\text{return\_transport}} + t_{\text{unclassified\_residual}}$$
   - Discrepancy $\Delta_{\text{trace}} = T_{\text{client\_elapsed}} - \sum t_k$. If $< -1.0\text{ ms}$, flagged `overlapping_spans` and rejected. Positive $\Delta_{\text{trace}}$ recorded as `unclassified_residual_ms`.
   - `time_to_trusted_cert_ms`: Caller entry through runner-side independent verification of a physically certified optimum/infeasibility proof; null if uncertified. Qualified model-result and witness-only secondary endpoints are separately labeled, not relabeled as trusted physical certificates.
   - Independent runner `harness_verify_ms` recorded separately.
5. **Frozen Data, 5-Element Cache State Vector & Arm-Isolated Watchdog Recovery**:
   - Pinned by dataset SHA-256; live network fallback strictly prohibited.
   - Cache state vector: `[worker, data, wasm, prep, endpoint_pre_state]`.
   - Alternating paired execution: $A \to B, B \to A, A \to B \dots$
   - Runner watchdog deadline: $\text{deadline} + 5000\text{ ms}$ grace. Arm A and Arm B run on separate worker threads. If triggered on Arm A, terminate Arm A worker only; Arm B worker is unaffected.
   - Replay setup: Recreating an arm executes an explicit unmeasured warm-up prefix before the next measured attempt.
6. **Merged ADR 0004 Explore Terminal Matrix & Target Coverage**:
   - Apply the seven-row matrix after the later #41/#42 fences and corrected #40 edge rules, not a stale verbatim quotation:
     - All V ($V=N$) or V+I only ($V>=1, I>=1, U=E=0$) → `complete`.
     - V>=1 with (U>=1 or E>=1) → `partial`.
     - All I ($I=N$) → `infeasible`.
     - Zero V with (U>=1 or E>=1) → `invalid`.
     - Cancellation that actually prevents at least one target: V>=1 → `partial`; zero V → `invalid`. Late cancellation cannot downgrade a finished schedule.
   - Require N>=1. V is an independently verified build; **I requires both `status: 'infeasible'` and `physical_certificate: 'certified_infeasible'`**. Fast/provisional model infeasibility and every missing/unlaunched target are U. Queue expiry or invalid inventory gives invalid/[] with reason. `validateExploreResponse` verifies every target in `sweep_schedule`; rejected returned builds trigger Gate 1, and approximate model proofs cannot supply all-infeasible primary success.
7. **Mathematical Model-Counting & Metric Provenance**:
   - Git source revision: 40-character Git object commit SHA (`git rev-parse HEAD`) + `is_dirty: boolean` + patch SHA-256 if dirty. Pinned by resolved worker bundle SHA-256 and WASM binary SHA-256.
   - Model dimensions counted at statement emission time in `lpBuilder.ts`:
     - `matrix_rows`: Constraints in `Subject To` (excluding bounds and objective).
     - `matrix_cols`: Decision and auxiliary variables with non-zero coefficients.
     - `model_total_variables`: All variables declared in the model (including bound-only).
     - `matrix_nonzeros`: Non-zero coefficients after algebraic cancellation of duplicates.
     - `discrete_variables`: Deduplicated binary and general integer variables.
   - **Historical shipped-artifact limitation**: Issue #30 and the preserved-baseline review found native internals (`presolved_rows/cols/nonzeros`, `native_presolve_time_ms`, `native_mip_nodes`, `native_dual_bound`, `presolved_integer_variables`, `native_relative_gap`) unavailable; those historical samples remain null with `reason: 'unsupported_by_shipped_wasm'`. Do not relabel the old observations or manufacture standalone synthetic-presolve evidence.
   - **Planned native prerequisite, not permanent impossibility**: The correctness cutover must supply a pinned scripted reproducible WASM/glue build and ABI, structured full-precision objective/column primals and trusted status/dual/gap extraction before handle destruction, parsed-model verification including coefficient filtering/options, and removal of the unqualified stock fallback. Record supported telemetry only when actually exposed and evidenced by the rebuilt artifact; remaining unsupported metrics stay honestly null. No rounded pretty-output primal or status-only proof is accepted.
8. **Reconsideration Gate**:
   - Reopening a previously rejected formulation requires: (1) a genuinely new candidate hypothesis, (2) formal domain/objective equivalence covering known counterexamples, (3) end-to-end accounting including preparation and serialization overhead, and (4) preservation of the dense-TED bounded deferral. Integer declaration reductions alone do not qualify as evidence of a speedup.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Test oracles verify equivalence gates prior to comparative speedup benchmarking.
- **Issue #38 (Prepared Boundaries)**: Prepared model boundaries measure preparation, serialization, and decoding overhead under the timing breakdown.
- **Benchmark Suite**: Planned `report.ts`/`harness.ts` migration must enforce ordered primary gates, separately qualified secondary non-regression, complete scheduled coverage, Type 7 P95, timing accounting and alternating paired execution. Acceptance and historical smoke checks are not evidence those changes already ship or that any native proof/speedup was measured.
