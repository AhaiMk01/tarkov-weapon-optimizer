# ADR 0005: Trustworthy Solver Telemetry and Comparative Benchmark Gates

## Status
Proposed (Refs #37). Canonical Resolution v6 2026-10-02.

## Context
Capability research (Issue #30) and benchmark audits revealed critical gaps in how solver performance is measured, compared, and certified:
1. **Missing Actionable Acceptance Gates**: Reporting summaries without ordered pass/fail rules allowed candidates with certification drops or ambiguous speedups to avoid rejection, while degenerate zero-variance bootstrap runs risked false certification.
2. **Infeasibility & Sweep Coverage Gaps**: Rate regression checks focused solely on physical optimum rates, failing to catch regressions on infeasible cases or explore sweeps.
3. **Timing Opacity & Overlap Concealment**: Benchmarks measured only total caller elapsed time, and clamping residuals to zero masked overlapping timing spans.
4. **Request & Fixture Underspecification**: Hash projections omitted domain inputs (such as stash quantities, weights, and category groups), risking comparing non-identical problems.
5. **Cache & Execution Bias**: Unstructured "warm" flags hid initialization differences, while sequential batching ($A \to A \dots B \to B$) exposed comparisons to thermal throttling and GC drift. Leaked worker processes on watchdog timeouts corrupted subsequent partner runs.
6. **Reconsideration Churn**: Past experiments showed that reducing integer declarations often added unmetered preparation overhead or degraded search speed without improving certification.

## Decision

We establish six core principles governing telemetry, benchmarking, and reconsideration:

1. **Strictly Ordered, Exhaustive Statistical Acceptance Protocol**:
   - Direction: Paired latency ratio $\text{Ratio} = \text{latency}_{\text{cand}} / \text{latency}_{\text{base}}$ ($< 1.0$ better).
   - Resampling Unit: Paired blocks across alternating sequence ($A \to B, B \to A$), $N \ge 5$ alternating pairs per case (no optional stopping). 10,000 BCa bootstrap resamples with pinned Mulberry32 PRNG seed (`seed = 42`) and leave-one-paired-block-out jackknife.
   - Non-Degeneracy Requirement: Sample variance must be strictly positive; zero-variance or undefined acceleration intervals are strictly routed to Gate 4 (`INCONCLUSIVE`).
   - Predeclared Margins: Practical speedup $\delta = 0.05$ (ratio $< 0.95$), P95 tail regression margin $0.05$, zero rate drop tolerance.
   - Ordered Decision Rules:
     - **Gate 1 (FAIL)**: Any physical validation error (`validateBuild` errors > 0), domain drop, or Issue #36 oracle violation $\implies$ `FAIL`.
     - **Gate 2 (FAIL)**: Any primary on-time success rate drop (physical optimum, proved infeasibility, or sweep completion), P95 tail regression ($> 1.05 \times$ baseline), or 95% bootstrap CI lower bound $> 1.0 \implies$ `FAIL`.
     - **Gate 3 (PASS)**: Zero correctness failures, rate and tail non-regression hold, $N_{\text{both}} \ge 5$, non-degenerate bootstrap CI, and 95% bootstrap CI upper bound $< 0.95 \implies$ `PASS`.
     - **Gate 4 (INCONCLUSIVE)**: All other outcomes (speedup unproven, zero variance, or CI spans across 1.0) $\implies$ `INCONCLUSIVE`.
   - Cross-Case Adoption: Experiment is accepted iff Gate 1 and Gate 2 pass on all $K$ cases and Gate 3 passes on every declared primary benchmark case.
2. **Case-Specific Success Rates & Latency Endpoints**:
   - Denominator: Total planned attempts $N_{\text{planned}}$ for that case and arm.
   - Numerators:
     - Feasible optimization cases: `physical_optimum_rate` (on-time `certified_optimal`).
     - Infeasible cases: `proved_infeasible_rate` (on-time `certified_infeasible` under #36 equivalence).
     - Explore cases: `completed_sweep_rate` (on-time `curve_status === 'complete'`); strictly `null` with reason for non-Explore cases.
   - Latency ratio endpoint: strictly on-time both-success pairs ($\text{client\_elapsed\_ms} \le \text{deadline}$). Late diagnostic certificates excluded.
3. **Exhaustive Canonical Semantic Request Identity & Clean-Tree Provenance**:
   - Pinned by full 64-hex SHA-256 digest of `snapshot.json` (`219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`).
   - Pinned by deterministic canonical JSON SHA-256 hash exhaustively covering all 37 input fields: `operation`, contract versions (ADR-0002, ADR-0003, ADR-0004, ADR-0005), `weapon_id`, `game_mode`, `player_level`, canonicalized `trader_levels`, flea/barter flags, `max_price`, hard physical limits, `equip_ergo_modifier`, TrueErgo/overswing/Tchebycheff flags, objective weights $(e, r, p)$ and reference points $(z, nad)$, canonicalized multiset `owned_items` (preserving multiplicity), `include_items`, `exclude_items`, category groups, precision mode, tolerances, and Explore sweep parameters. Every resolved input is serialized in canonical order.
   - Formal runs require a demonstrably clean working tree (`is_dirty: false`). Per-arm resolved artifact hashes recorded.
4. **Signed Timing Trace Accounting Invariant**:
   - Total caller latency $T_{\text{client\_elapsed}}$ satisfies:
     $$T_{\text{client\_elapsed}} = t_{\text{client\_queue}} + t_{\text{worker\_lifecycle}} + t_{\text{prep}} + t_{\text{lp\_build}} + t_{\text{highs\_wall}} + t_{\text{decode}} + t_{\text{return\_transport}} + t_{\text{unclassified\_residual}}$$
   - Discrepancy $\Delta_{\text{trace}} = T_{\text{client\_elapsed}} - \sum t_k$. If $< -1.0\text{ ms}$, flagged `overlapping_spans` and rejected. Positive $\Delta_{\text{trace}}$ recorded as `unclassified_residual_ms`.
   - `time_to_trusted_cert_ms`: Caller entry through runner-side independent validation (`validateBuild` errors = 0); `null` if uncertified.
   - Independent runner `harness_verify_ms` recorded separately.
5. **Frozen Data, 5-Element Cache State Vector & Arm-Isolated Watchdog Recovery**:
   - Pinned by dataset SHA-256; live network fallback strictly prohibited.
   - Cache state vector: `[worker, data, wasm, prep, endpoint_pre_state]`.
   - Alternating paired execution: $A \to B, B \to A, A \to B \dots$
   - Runner watchdog deadline: $\text{deadline} + 5000\text{ ms}$ grace. Arm A and Arm B run on separate worker threads. If triggered on Arm A, terminate Arm A worker only; Arm B worker is unaffected.
   - Replay setup: Recreating an arm executes an explicit unmeasured warm-up prefix before the next measured attempt.
6. **Verbatim ADR 0004 Explore Terminal Matrix & Target Coverage**:
   - Normative 7-row terminal matrix from ADR 0004 (#35) preserved verbatim:
     - All $V$ ($V=N$) or verified + proved-infeasible ($V \ge 1, I \ge 1, U=0, E=0$) $\to \text{'complete'}$.
     - $V \ge 1$ with unresolved/error ($U \ge 1$ or $E \ge 1$) $\to \text{'partial'}$.
     - All proved infeasible ($I=N$) $\to \text{'infeasible'}$.
     - Zero verified with unresolved/error $\to \text{'invalid'}$.
     - Cancelled with $V \ge 1 \to \text{'partial'}$; cancelled with $V=0 \to \text{'invalid'}$.
   - Scheduled target coverage: `validateExploreResponse` verifies every declared scheduled target in `sweep_schedule` has a qualified $V$ (validated optimal or feasible build) or $I$ (certified infeasibility proof). Missing targets evaluate as $U$, preventing completed coverage. Physical validation failures on returned points trigger Gate 1 FAIL.
7. **Mathematical Model-Counting & Metric Provenance**:
   - Git source revision: 40-character Git object commit SHA (`git rev-parse HEAD`) + `is_dirty: boolean` + patch SHA-256 if dirty. Pinned by resolved worker bundle SHA-256 and WASM binary SHA-256.
   - Model dimensions counted at statement emission time in `lpBuilder.ts`:
     - `matrix_rows`: Constraints in `Subject To` (excluding bounds and objective).
     - `matrix_cols`: Decision and auxiliary variables with non-zero coefficients.
     - `model_total_variables`: All variables declared in the model (including bound-only).
     - `matrix_nonzeros`: Non-zero coefficients after algebraic cancellation of duplicates.
     - `discrete_variables`: Deduplicated binary and general integer variables.
   - Native internals (`presolved_rows`, `native_presolve_time_ms`, `native_mip_nodes`, `native_dual_bound`, `presolved_integer_variables`, `native_relative_gap`) explicitly recorded as `null` with `reason: 'unsupported_by_shipped_wasm'`. Standalone synthetic presolve runs prohibited.
8. **Reconsideration Gate**:
   - Reopening a previously rejected formulation requires: (1) a genuinely new candidate hypothesis, (2) formal domain/objective equivalence covering known counterexamples, (3) end-to-end accounting including preparation and serialization overhead, and (4) preservation of the dense-TED bounded deferral. Integer declaration reductions alone do not qualify as evidence of a speedup.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Test oracles verify equivalence gates prior to comparative speedup benchmarking.
- **Issue #38 (Prepared Boundaries)**: Prepared model boundaries measure preparation, serialization, and decoding overhead under the timing breakdown.
- **Benchmark Suite**: `report.ts` and `harness.ts` enforce the ordered 4-gate statistical acceptance protocol, timing trace invariant, and alternating paired execution.
