# ADR 0005: Trustworthy Solver Telemetry and Comparative Benchmark Gates

## Status
Proposed (Refs #37). Canonical Resolution v2 2026-10-02.

## Context
Capability research (Issue #30) and benchmark audits revealed critical gaps in how solver performance is measured, compared, and certified:
1. **Unavailable Native Internals**: Shipped `highs-js` exports only basic primal outputs; native presolve dimensions, MIP nodes, and dual bounds are unavailable. Conflating emitted model variables with native presolved state led to false claims of performance improvements.
2. **Timing Opacity & Initialization Gaps**: Benchmarks measured only total caller elapsed time, conflating queue latency, worker/WASM bootstrap, data acquisition, string serialization, and solver branch-and-bound.
3. **Missing Statistical Decision Gates**: Benchmark runs lacked predeclared pass/fail criteria, risking over-interpreting noisy speedups while ignoring completion/certification regressions.
4. **Cache & Execution Bias**: Unstructured "warm" flags hid initialization differences, while sequential batching ($A \to A \dots B \to B$) exposed comparisons to thermal throttling and GC drift. Leaked worker processes on watchdog timeouts corrupted subsequent partner runs.
5. **Reconsideration Churn**: Past experiments showed that reducing integer declarations often added unmetered preparation overhead or degraded search speed without improving certification.

## Decision

We establish six core principles governing telemetry, benchmarking, and reconsideration:

1. **Statistical Pass/Fail/Inconclusive Acceptance Protocol**:
   - Direction: Paired latency ratio $\text{Ratio} = \text{latency}_{\text{cand}} / \text{latency}_{\text{base}}$ ($< 1.0$ better).
   - Resampling Unit: Paired blocks across alternating sequence ($A \to B, B \to A$). $N \ge 5$ alternating pairs per case; optional stopping is prohibited.
   - Predeclared Margins: Minimum practical speedup margin $\delta = 0.05$ (at least 5% faster, ratio $< 0.95$); zero tolerance for certification or completion rate drops.
   - Decision Rules:
     - **PASS**: $\text{cert\_rate}_{\text{cand}} \ge \text{cert\_rate}_{\text{base}}$, $\text{completed\_sweep\_rate}_{\text{cand}} \ge \text{completed\_sweep\_rate}_{\text{base}}$, clean validation under Issue #36 equivalence, and 95% bootstrap CI upper bound $< 0.95$.
     - **FAIL**: Any rate regression, or 95% bootstrap CI lower bound $> 1.0$.
     - **INCONCLUSIVE**: Rates match, but 95% bootstrap CI spans across 1.0 (unproven practical speedup).
2. **Versioned Canonical Semantic Request Identity**:
   - Pinned by deterministic canonical JSON SHA-256 hash covering: `weapon_id`, `game_mode`, `player_level`, canonicalized `trader_levels`, flea/barter flags, `max_price`, hard physical limits, `equip_ergo_modifier`, TrueErgo/overswing/Tchebycheff flags, objective weights and reference points $(z, nad)$, canonicalized multiset `owned_items` (preserving multiplicity), `include_items`, `exclude_items`, category groups, precision mode, and Explore sweep parameters.
3. **Decomposed Observable Request Timing**:
   - Decomposes wall-clock latency into non-overlapping observable spans:
     `client_queue_ms`, `wasm_init_ms`, `data_acquire_ms`, `prep_ms`, `lp_build_ms`, `highs_wall_ms` (observable JS wrapper duration per sub-solve), `decode_ms`, `return_transport_ms`, and `client_elapsed_ms`.
   - `time_to_trusted_cert_ms`: Elapsed time from caller entry through worker solve and runner-side independent validation (`validateBuild` errors = 0); `null` if uncertified.
   - Independent runner `harness_verify_ms` is recorded separately.
4. **Frozen Data, 5-Element Cache State Vector & Watchdog Isolation**:
   - Pinned by dataset SHA-256 (`snapshot.json`: `219443b449f732f3`). Live network fallback is strictly prohibited.
   - Cache state declared explicitly: `[worker, data, wasm, prep, endpoint]`.
   - Alternating paired execution: $A \to B, B \to A, A \to B \dots$
   - Runner watchdog deadline: $\text{deadline} + 5000\text{ ms}$ grace. If triggered, hard terminate and recreate worker immediately before launching partner arm. Late certificates recorded as valid diagnostic evidence, but count as missed on-time deadlines.
5. **Metric Provenance & Emission-Time Model Counting**:
   - Git source revision: 40-character Git object commit SHA + `is_dirty: boolean` + patch SHA-256 if dirty. Pinned by resolved worker bundle SHA-256 and WASM binary SHA-256.
   - Model dimensions counted at statement emission time in `lpBuilder.ts` (`rows`, `columns`, `nonzeros`, `integer_variables`), eliminating reparsing overhead on the solve path.
   - Native internals (`presolved_rows`, `native_presolve_time_ms`, `native_mip_nodes`, `native_dual_bound`) explicitly recorded as `null` with `reason: 'unsupported_by_shipped_wasm'`. Standalone synthetic presolve runs are prohibited.
6. **Reconsideration Gate**:
   - Reopening a previously rejected formulation requires: (1) a genuinely new candidate hypothesis, (2) formal domain/objective equivalence covering known counterexamples, (3) end-to-end accounting including preparation and serialization overhead, and (4) preservation of the dense-TED bounded deferral. Integer declaration reductions alone do not qualify as evidence of a speedup.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Test oracles verify equivalence gates prior to comparative speedup benchmarking.
- **Issue #38 (Prepared Boundaries)**: Prepared model boundaries measure preparation, serialization, and decoding overhead under the timing breakdown.
- **Benchmark Suite**: `report.ts` and `harness.ts` enforce the statistical acceptance gate, nullable bounds gap check, curve status validation, and alternating paired execution.
