# ADR 0004: End-to-End Certificate, Status and Deadline Semantics

## Status
Accepted (Refs #35). Closed 2026-10-02.

## Context
The solver serves diverse consumers: direct solve, worker messages, Optimize UI, Explore, Gunsmith, MOA-floor search, and automated benchmark classification. Audits and review findings revealed key semantic requirements:
1. **Source Objective Scaling & Directional Deviations**: `ERGO_SCALE = 10` and `SCALE = 1000` define $fE$ and $fR$. Augmented Tchebycheff scoring in `trueErgo.ts` subtracts directional deviations without an outer zero-clamp, providing directional bonuses when exceeding ideal targets rather than absolute penalties, with `sum = e + r + p || 1` preventing NaN on all-zero weights.
2. **Domain Equivalence Prerequisites on Infeasibility & Optimality**: Physical certification of optimality and infeasibility requires request-level optimality, exact placement, clean validation, AND preservation of the authoritative domain under Issue #36 equivalence gates.
3. **Cross-Context Clock Skew & Pre-Stage Guards**: Web Window and Web Worker have different `performance.timeOrigin` baselines, requiring normalization to monotonic epoch time, out-of-band cancel dispatch, and strict $\text{remaining\_ms} \le 0$ guards before every stage and after cancellation yields.
4. **MOA Lower Bounds & Instance Witnesses**: Initial lower bound must be certified or remain unproved; bisection must not start with $\text{lo} = \text{null}$; witness builds must carry full instance manifests; and outward rounding proofs are delegated to Issue #34.
5. **Consumer Invariants**: Gunsmith, benchmark nullable gap handling, and Explore curve terminal states must follow explicit, unambiguous transition rules.

## Decision

We establish eight core principles governing status, metadata, deadlines, and consumers:

1. **Cross-Context Monotonic Clocks & Cancellation Routing**:
   - Timestamps are normalized via $\text{epoch\_now} = \text{performance.timeOrigin} + \text{performance.now}()$.
   - Client stamps $\text{client\_epoch\_deadline} = \text{epoch\_now}_{\text{client}} + (\text{time\_limit\_ms} \mathbin{??} 60000)$.
   - Worker checks $\text{remaining\_ms} = \text{client\_epoch\_deadline} - \text{epoch\_now}_{\text{worker}}$ at dispatch; if $\le 0$, immediately returns `incomplete` (`Queue timeout before dispatch`).
   - Strict Expiry Guards: Before starting every sub-operation and after the event-loop yield, if $\text{remaining\_ms} \le 0$, the stage is not launched and the solver halts immediately, preserving any verified incumbent as `feasible` or proof as `optimal`. Only when $\text{remaining\_ms} > 0$ strictly is the native allowance clamped: $\max(0.001, \text{remaining\_ms} / 1000)$.
   - Out-of-band cancellation: Worker message listener handles cancel messages out-of-band (bypassing `dispatchChain`), and worker yields to the event loop (`setTimeout(resolve, 0)`) between sub-solves.
   - Hard cancellation: Client calls `worker.terminate()`, immediately settles pending promises with `CancellationError`, and recreates the worker. Verified build snapshots published prior to termination survive.
2. **Objective Function, Scaling & Shared Units**:
   - $fE = \text{ergo} \times 10$, $fR = \text{recoilMod} \times 1000$, $fP = \text{price}$.
   - Weighted score: $\frac{e}{10} fE - r fR - \frac{p}{1000} fP$.
   - Augmented Tchebycheff score: normalized coordinates against fixed ideal and nadir reference points subtracting directional deviations without outer zero-clamp:
     $$\text{sum} = (e + r + p) \mathbin{\Vert} 1$$
     $$c_e = \frac{e}{\text{sum} \cdot \max(z_E - nad_E, 1)}, \quad c_r = \frac{r}{\text{sum} \cdot \max(nad_R - z_R, 1)}, \quad c_p = \frac{p}{\text{sum} \cdot \max(nad_P - z_P, 1)}$$
     $$\text{maxDeviation} = \begin{cases} \max_{a \in \text{ActiveAxes}} d_a & \text{if } \text{ActiveAxes is non-empty} \\ 0 & \text{if } \text{ActiveAxes is empty} \end{cases}$$
     $$\text{score} = 0.01 \cdot (c_e fE - c_r fR - c_p fP) - \text{maxDeviation}$$
   - Bounds, values, and tolerances are expressed strictly in these shared units.
3. **Physical Certification Prerequisites & Infeasibility Gates**:
   - `physical_certificate: 'certified_optimal'` and `'certified_infeasible'` require:
     1. Request-level optimality/infeasibility: spatial tree certified.
     2. Exact placement (`precision_resolved: 'precise'`).
     3. Clean validation (`validateBuild` errors = 0 for optimal).
     4. Domain & objective equivalence: conditional on satisfying Issue #36 equivalence gates.
   - Fast mode yields `model_qualification: 'approximate'` and `physical_certificate: 'approximate_optimal'`. Fast infeasibility proves only model infeasibility and cannot prove domain impossibility.
4. **Unified Proof State & Interruption Transition Matrix**:
   - Verified incumbent + timeout/cancel/node-limit $\to \text{status: 'feasible'}, \text{termination: 'limit'}$.
   - No verified incumbent + timeout/cancel/queue-timeout $\to \text{status: 'incomplete'}, \text{lower\_bound: null}, \text{termination: 'limit'}$.
   - Certified optimal build + late cancel $\to \text{status: 'optimal'}, \text{termination: 'optimal'}$.
   - Validation failure $\to \text{status: 'incomplete'}, \text{reason: 'Independent build validation failed'}$.
   - Runtime crash $\to \text{status: 'error'}$, worker posts error envelope, client rejects with typed `SolverError`.
5. **Global Spatial Bound Provenance & JSON Transport Representation**:
   - $\text{global\_upper\_bound} = \max(\text{incumbent.objective}, \max_{k \in \text{OpenNodes}} \text{node}_k.\text{upper\_bound})$. Open unbounded nodes yield $+\infty$.
   - JSON transport represents $-\infty$ as `lower_bound: null` and $+\infty$ as `upper_bound: null`. Finite zero is `0.0`. Primal objectives from interrupted MIPs are never published as upper bounds.
6. **Explore Curve Terminal State Matrix**:
   - All verified ($V=N$) or verified + proved-infeasible ($V \ge 1, I \ge 1, U=0, E=0$) $\to \text{'complete'}$.
   - $V \ge 1$ with unresolved/error ($U \ge 1$ or $E \ge 1$) $\to \text{'partial'}$.
   - All proved infeasible ($I=N$) $\to \text{'infeasible'}$.
   - Zero verified with unresolved/error $\to \text{'invalid'}$.
   - Cancelled with $V \ge 1 \to \text{'partial'}$; cancelled with $V=0 \to \text{'invalid'}$.
7. **MOA Witness Tracking & Outward Rounding Contract**:
   - Initial seed solve preserves any verified build witness as achievable `hi` even if interrupted.
   - If no finite, mathematically justified $\text{lo}$ exists after obtaining witness $\text{hi}$, bisection does not start; returns `status: 'witnessed'`, `floor: hi`, `proved_lower_bound: null`.
   - When a finite $\text{lo}$ exists, binary search advances $\text{lo} = \text{mid}$ if and only if sub-solve returns proved `infeasible` on the precise model (under Issue #36 equivalence).
   - `proved` requires $\text{hi} - \text{lo} \le 0.02$ AND proved $\text{lo}$; otherwise `witnessed`.
   - UI display requires an outward-safe cap (`display_floor`), with the exact numerical rounding contract and proof delegated to Issue #34.
   - Witness build carries full instance manifest and configuration scope.
8. **Complete Shared Response Types & Consumer Migration**:
   - `OptimizeResponse`, `ExploreResponse`, and `MOAFloorResponse` fully specified in TypeScript.
   - Gunsmith, benchmark nullable gap handling, and UI consumers migrated per contract.

## Consequences & Downstream Contracts

- **Issue #34 (Numerical Authority)**: Formulate the exact conservative outward rounding rule/proof for MOA floors.
- **Issue #36 (Oracles & Validation)**: Establish the domain and objective equivalence proof gates required for physical certification and physical infeasibility.
- **Issue #37 (Telemetry & Benchmarks)**: Ensure worker telemetry records epoch timestamps, queue latency, and stage timings.
