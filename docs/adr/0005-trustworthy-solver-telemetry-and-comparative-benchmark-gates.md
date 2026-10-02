# ADR 0005: Trustworthy Solver Telemetry and Comparative Benchmark Gates

## Status
Proposed (Refs #37).

## Context
Capability research (Issue #30) and benchmark audits revealed critical gaps in how solver performance is measured and compared:
1. **Unavailable Native Internals**: Shipped `highs-js` exports only basic primal outputs; native presolve dimensions, MIP nodes, and dual bounds are unavailable. Conflating emitted model variables with native presolved state led to false claims of performance improvements.
2. **Timing Opacity**: Benchmarks measured only total caller elapsed time, conflating queue latency, data lookup, string serialization, and solver branch-and-bound.
3. **Cache & Execution Bias**: Unstructured "warm" flags hid initialization differences, while sequential batching ($A \to A \dots B \to B$) exposed comparisons to thermal throttling and GC drift. Leaked worker processes on watchdog timeouts corrupted subsequent partner runs.
4. **Reconsideration Churn**: Past experiments showed that reducing integer declarations often added unmetered preparation overhead or degraded search speed without improving certification.

## Decision

We establish six core principles governing telemetry, benchmarking, and reconsideration:

1. **Available-First Metric Provenance**:
   - Emitted dimensions (`rows`, `columns`, `nonzeros`, `integer_variables`) are counted directly from the generated CPLEX model (`provenance: 'emitted_lp'`).
   - Native internals (`presolved_rows`, `native_presolve_time_ms`, `native_mip_nodes`, `native_dual_bound`) are explicitly labeled `UNAVAILABLE` (`null`, `reason: 'unsupported_by_shipped_wasm'`). Standalone synthetic presolve runs are prohibited.
   - Spatial search state (nonlinear nodes, proved secant bounds) is categorized under `provenance: 'spatial_search'`, strictly distinct from native MIP nodes.
2. **Decomposed Observable Request Timing**:
   - Decomposes wall-clock latency into: `queue_latency_ms`, `prep_time_ms`, `lp_build_ms`, `highs_wall_ms` (observable JS duration), and `decode_ms`.
   - `time_to_trusted_cert_ms` measures entry to physical certification (clean validation and certified gap); null if uncertified.
   - Independent runner `harness_verify_ms` is recorded separately.
3. **Frozen Comparable Identity**:
   - Inputs pinned by dataset hash (`snapshot.json` SHA-256: `219443b449f732f3`) and deterministic request parameter hash.
   - Build environment pinned by git commit, worker bundle SHA-256, and WASM binary SHA-256. Comparisons across differing physical domain versions are labeled diagnostic.
4. **5-Element Cache State Vector & Alternating Paired Protocol**:
   - Cache state is declared as: `[worker, data, wasm, prep, endpoint]`.
   - Repetitions alternate execution order ($A \to B, B \to A, A \to B$) to cancel temporal drift.
   - Watchdog timeout triggers immediate worker termination and recreation before launching the partner arm.
   - Paired speedup ratios are computed strictly over both-success runs, reporting all-attempt completion and failure rates side-by-side.
5. **Acceptance Predicates**:
   - Governed by ADR 0004 (#35) and Issue #36 equivalence gates.
   - Incomplete spatial searches (`lower_bound: null` or `upper_bound: null`) strictly evaluate $\text{gap} = \infty$.
   - Explore curve completion requires `curve_status === 'complete'`, never `points.length > 0`.
6. **Reconsideration Gate**:
   - Reopening a previously rejected formulation requires: (1) a genuinely new candidate hypothesis, (2) formal domain/objective equivalence covering known counterexamples, (3) end-to-end accounting including preparation and serialization overhead, and (4) preservation of the dense-TED bounded deferral. Integer declaration reductions alone do not qualify as evidence of a speedup.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Test oracles verify equivalence gates prior to comparative speedup benchmarking.
- **Issue #38 (Prepared Boundaries)**: Prepared model boundaries measure preparation, serialization, and decoding overhead under the timing breakdown.
- **Benchmark Suite**: `report.ts` and `harness.ts` enforce the nullable bounds gap check, curve status validation, and alternating paired execution.
