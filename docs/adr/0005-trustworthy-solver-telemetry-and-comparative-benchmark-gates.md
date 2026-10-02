# ADR 0005: Trustworthy Solver Telemetry and Comparative Benchmark Gates

## Status
Proposed (Refs #37). Canonical Resolution v3 2026-10-02.

## Context
Capability research (Issue #30) and benchmark audits revealed critical gaps in how solver performance is measured, compared, and certified:
1. **Missing Actionable Acceptance Gates**: Reporting summaries without ordered pass/fail rules allowed candidates with certification drops or ambiguous speedups to avoid rejection.
2. **Timing Opacity & Initialization Gaps**: Benchmarks measured only total caller elapsed time, conflating queue latency, worker/WASM bootstrap, data acquisition, string serialization, and solver branch-and-bound without a formal trace accounting invariant.
3. **Request & Fixture Underspecification**: Hash projections omitted domain inputs (such as stash quantities and category groups), risking comparing non-identical problems.
4. **Cache & Execution Bias**: Unstructured "warm" flags hid initialization differences, while sequential batching ($A \to A \dots B \to B$) exposed comparisons to thermal throttling and GC drift. Leaked worker processes on watchdog timeouts corrupted subsequent partner runs.
5. **Reconsideration Churn**: Past experiments showed that reducing integer declarations often added unmetered preparation overhead or degraded search speed without improving certification.

## Decision

We establish six core principles governing telemetry, benchmarking, and reconsideration:

1. **Strictly Ordered, Exhaustive Statistical Acceptance Protocol**:
   - Direction: Paired latency ratio $\text{Ratio} = \text{latency}_{\text{cand}} / \text{latency}_{\text{base}}$ ($< 1.0$ better).
   - Resampling Unit: Paired blocks across alternating sequence ($A \to B, B \to A$), $N \ge 5$ alternating pairs per case (no optional stopping). 10,000 BCa bootstrap resamples with pinned seed (percentile fallback on zero variance).
   - Predeclared Margins: Practical speedup $\delta = 0.05$ (ratio $< 0.95$), tail regression margin $0.05$, zero rate drop tolerance.
   - Ordered Decision Rules:
     - **Gate 1 (FAIL)**: Any validation error or Issue #36 oracle/domain failure $\implies$ `FAIL`.
     - **Gate 2 (FAIL)**: Any certification/completion rate drop, tail regression ($> 1.05 \times$ baseline), or 95% bootstrap CI lower bound $> 1.0 \implies$ `FAIL`.
     - **Gate 3 (PASS)**: Zero correctness failures, rate and tail non-regression hold, $N_{\text{both}} \ge 5$, and 95% bootstrap CI upper bound $< 0.95 \implies$ `PASS`.
     - **Gate 4 (INCONCLUSIVE)**: All other outcomes (speedup unproven or CI spans across 1.0) $\implies$ `INCONCLUSIVE`.
2. **Versioned Canonical Semantic Request Identity**:
   - Pinned by full 64-hex SHA-256 digest of `snapshot.json` (`219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`).
   - Pinned by deterministic canonical JSON SHA-256 hash covering: `weapon_id`, `game_mode`, `player_level`, canonicalized `trader_levels`, flea/barter flags, `max_price`, hard physical limits, `equip_ergo_modifier`, TrueErgo/overswing/Tchebycheff flags, objective weights and reference points $(z, nad)$, canonicalized multiset `owned_items` (preserving multiplicity), `include_items`, `exclude_items`, category groups, precision mode, and Explore sweep parameters.
3. **Disjoint Timing Trace Accounting Invariant**:
   - Total caller latency $T_{\text{client\_elapsed}}$ satisfies:
     $$T_{\text{client\_elapsed}} = t_{\text{client\_queue}} + t_{\text{worker\_lifecycle}} + t_{\text{prep}} + t_{\text{lp\_build}} + t_{\text{highs\_wall}} + t_{\text{decode}} + t_{\text{return\_transport}} + t_{\text{unclassified\_residual}}$$
   - `time_to_trusted_cert_ms`: Caller entry through runner-side independent validation (`validateBuild` errors = 0); `null` if uncertified.
   - Independent runner `harness_verify_ms` recorded separately.
4. **Frozen Data, 5-Element Cache State Vector & Watchdog Isolation**:
   - Pinned by dataset SHA-256; live network fallback strictly prohibited.
   - Cache state vector: `[worker, data, wasm, prep, endpoint]`.
   - Alternating paired execution: $A \to B, B \to A, A \to B \dots$
   - Runner watchdog deadline: $\text{deadline} + 5000\text{ ms}$ grace. If triggered, hard terminate and recreate worker, restoring declared state before partner arm. Late certificates recorded as valid diagnostic evidence, but count as missed on-time deadlines.
5. **Metric Provenance & Emission-Time Model Counting**:
   - Git source revision: 40-character Git object commit SHA (`git rev-parse HEAD`) + `is_dirty: boolean` + patch SHA-256 if dirty. Pinned by resolved worker bundle SHA-256 and WASM binary SHA-256.
   - Model dimensions counted at statement emission time in `lpBuilder.ts`:
     - `matrix_rows`: Constraints in `Subject To` (excluding bounds and objective).
     - `matrix_cols`: Decision and auxiliary variables with non-zero coefficients.
     - `matrix_nonzeros`: Non-zero coefficients after algebraic cancellation of duplicates.
     - `discrete_variables`: Deduplicated binary and general integer variables.
   - Native internals (`presolved_rows`, `native_presolve_time_ms`, `native_mip_nodes`, `native_dual_bound`, `presolved_integer_variables`, `native_relative_gap`) explicitly recorded as `null` with `reason: 'unsupported_by_shipped_wasm'`. Standalone synthetic presolve runs prohibited.
6. **Reconsideration Gate**:
   - Reopening a previously rejected formulation requires: (1) a genuinely new candidate hypothesis, (2) formal domain/objective equivalence covering known counterexamples, (3) end-to-end accounting including preparation and serialization overhead, and (4) preservation of the dense-TED bounded deferral. Integer declaration reductions alone do not qualify as evidence of a speedup.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Test oracles verify equivalence gates prior to comparative speedup benchmarking.
- **Issue #38 (Prepared Boundaries)**: Prepared model boundaries measure preparation, serialization, and decoding overhead under the timing breakdown.
- **Benchmark Suite**: `report.ts` and `harness.ts` enforce the ordered 4-gate statistical acceptance protocol, timing trace invariant, and alternating paired execution.
