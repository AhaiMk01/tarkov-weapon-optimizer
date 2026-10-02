# ADR 0004: End-to-End Certificate, Status and Deadline Semantics

## Status
Proposed (Refs #35). Canonical Resolution v2 2026-10-02.

## Context
The solver serves diverse consumers: direct solve, worker messages, Optimize UI, Explore, Gunsmith, MOA-floor search, and automated benchmark classification. Audits and review findings revealed key semantic requirements:
1. **Source Objective Scaling**: `ERGO_SCALE = 10` and `SCALE = 1000` define $fE$ and $fR$, while `trueErgo.ts` governs weighted and augmented Tchebycheff objective scoring in shared linear objective units.
2. **Domain Equivalence Prerequisites**: Physical certification requires request-level optimality, exact placement, clean validation, AND preservation of the authoritative domain under Issue #36 equivalence gates.
3. **Cross-Context Clock Skew & Cancellation**: Web Window and Web Worker have different `performance.timeOrigin` baselines, requiring normalization to monotonic epoch time, out-of-band cancel dispatch, and event-loop yielding.
4. **MOA Lower Bounds & Instance Witnesses**: Initial lower bound must be certified or remain unproved, witness builds must carry full instance manifests, and outward rounding proofs are delegated to Issue #34.
5. **Consumer Invariants**: Gunsmith, benchmark nullable gap handling, and Explore curve terminal states must follow explicit, unambiguous transition rules.

## Decision

We establish eight core principles governing status, metadata, deadlines, and consumers:

1. **Cross-Context Monotonic Clocks & Cancellation Routing**:
   - Timestamps are normalized via $\text{epoch\_now} = \text{performance.timeOrigin} + \text{performance.now}()$.
   - Client stamps $\text{client\_epoch\_deadline} = \text{epoch\_now}_{\text{client}} + (\text{time\_limit\_ms} \mathbin{??} 60000)$.
   - Worker checks $\text{remaining\_ms} = \text{client\_epoch\_deadline} - \text{epoch\_now}_{\text{worker}}$ at dispatch; if $\le 0$, immediately returns `incomplete` (`Queue timeout before dispatch`).
   - Cooperative cancellation: Worker message listener handles cancel messages out-of-band (bypassing `dispatchChain`), and worker yields to the event loop (`setTimeout(resolve, 0)`) between sub-solves.
   - Hard cancellation: Client calls `worker.terminate()`, immediately settles pending promises with `CancellationError`, and recreates the worker. Verified build snapshots published prior to termination survive.
2. **Objective Function, Scaling & Shared Units**:
   - $fE = \text{ergo} \times 10$, $fR = \text{recoilMod} \times 1000$, $fP = \text{price}$.
   - Weighted score: $\frac{e}{10} fE - r fR - \frac{p}{1000} fP$.
   - Augmented Tchebycheff score: normalized coordinates against fixed ideal and nadir reference points with augmentation coefficient $0.01$.
   - Bounds, values, and tolerances are expressed strictly in these shared units.
3. **Physical Certification Prerequisites & Model Optimality**:
   - `physical_certificate: 'certified_optimal'` requires:
     1. Request-level optimality: spatial tree certified (global upper bound $\le$ global lower bound + tolerance).
     2. Exact placement (`precision_resolved: 'precise'`).
     3. Clean validation (`validateBuild` errors = 0).
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
   - Binary search advances $\text{lo} = \text{mid}$ if and only if sub-solve returns proved `infeasible` on the precise model. Unresolved sub-solves halt search without advancing $\text{lo}$.
   - `proved` requires $\text{hi} - \text{lo} \le 0.02$ AND proved $\text{lo}$; otherwise `witnessed`.
   - UI display requires an outward-safe cap (`display_floor`), with the exact numerical rounding contract and proof delegated to Issue #34.
   - Witness build carries full instance manifest and configuration scope.
8. **Complete Shared Response Types & Consumer Migration**:
   - `OptimizeResponse`, `ExploreResponse`, and `MOAFloorResponse` fully specified in TypeScript.
   - Gunsmith, benchmark nullable gap handling, and UI consumers migrated per contract.

## Consequences & Downstream Contracts

- **Issue #34 (Numerical Authority)**: Formulate the exact conservative outward rounding rule/proof for MOA floors.
- **Issue #36 (Oracles & Validation)**: Establish the domain and objective equivalence proof gates required for physical certification.
- **Issue #37 (Telemetry & Benchmarks)**: Ensure worker telemetry records epoch timestamps, queue latency, and stage timings.
