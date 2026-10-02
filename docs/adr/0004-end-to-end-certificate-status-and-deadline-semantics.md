# ADR 0004: End-to-End Certificate, Status and Deadline Semantics

## Status
Proposed (Refs #35).

## Context
The solver serves diverse consumers: direct solve, worker messages, Optimize UI, Explore, Gunsmith, MOA-floor search, and automated benchmark classification. Audits revealed critical semantic inconsistencies:
1. **Model Qualification Gaps**: Fast mode reported `optimal` without qualifying that it ran on an approximate model without physical placement variables.
2. **Silent Search Bound Corruption**: MOA-floor binary search advanced its lower bound (`lo = mid`) on timeouts and unresolved statuses, treating a time limit as proof of infeasibility.
3. **Multi-Step Deadline Runaway**: Model prep and data fetching consumed time before HiGHS started, ideal-point endpoints divided deadlines inconsistently, and Explore dropped `time_limit_ms` entirely.
4. **Explore Curve Incompleteness**: Partial sweeps with missing points were marked complete simply because `points.length > 0`.

## Decision

We establish five core principles governing status, metadata, deadlines, and consumers:

1. **Status Definitions & Fast Qualification**:
   - `optimal`:
     - *Precise*: Exact placement model (`precision_resolved: 'precise'`), verified physical build (`validateBuild` errors = 0), and certified optimality ($	ext{gap} \le 	ext{tolerance}$, $	ext{termination} === 	ext{'optimal'}$).
     - *Fast*: Optimal under relaxed binary assumptions, qualified by `model_qualification: 'approximate'` and `precision_resolved: 'fast'`.
   - `feasible`: Verified physical build exists, but optimality is not mathematically proven (e.g. limit reached with an incumbent).
   - `incomplete`: Search stopped without a verified build (e.g. limit reached before first incumbent, or validation failure).
   - `infeasible`: Proved mathematical or physical impossibility (e.g. empty root required slot or MIP returned `Infeasible` on precise model). Timeouts and errors are never infeasible.
   - `error`: Unhandled exception or WASM crash.
2. **Truthful Proof Metadata**:
   - Response carries `precision_request`, `precision_resolved`, and `model_qualification`.
   - When no incumbent exists (`status: 'incomplete'`), `lower_bound: -Infinity` (never fabricate 0), `absolute_gap: Infinity`, and `termination: 'limit'`. Primal objectives from interrupted MIPs are never used as upper bounds.
3. **Single Request Deadline Clock & Cancellation**:
   - Worker establishes $	ext{deadline} = 	ext{now} + 	ext{time\_limit\_ms}$ upon request receipt.
   - Every sub-operation receives strictly $	ext{remaining\_seconds} = \max(0.001, (	ext{deadline} - 	ext{now}) / 1000)$.
   - Cooperative cancellation checks `isCancelled` between solves/nodes and returns the best verified incumbent and bound. Hard cancellation via `worker.terminate()` is available for immediate UI aborts.
4. **Explore Curve Completeness**:
   - `ExploreResponse` carries `curve_status: 'complete' | 'partial' | 'invalid'`.
   - `complete` requires all $N$ requested points to yield verified builds within deadline.
5. **Strict Infeasibility Gating for Iterative Search**:
   - In MOA-floor and iterative bounds, lower bounds advance if and only if sub-solves return proved `infeasible`. Unresolved outcomes halt the search and report unproved intervals.
   - Gunsmith tasks require `status: 'optimal'` or `'feasible'` with zero validation errors.
   - Benchmark certification requires `status === 'optimal'`, `precision_resolved === 'precise'`, clean validation, and $	ext{gap} \le 	ext{tolerance}$.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Update test oracles and benchmarks to assert `classifySample` with precision qualification and gap checks.
- **Issue #37 (Telemetry & Benchmarks)**: Ensure worker telemetry records request deadlines, stage timings, and curve completion states.
- **Worker & Client Migration**: Update `solver.worker.ts`, `paretoExplorer.ts`, and `client.ts` to propagate deadlines and return `curve_status` and `model_qualification`.
