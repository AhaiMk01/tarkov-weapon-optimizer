# ADR 0004: End-to-End Certificate, Status and Deadline Semantics

## Status
Proposed (Refs #35). Canonical Resolution 2026-10-02.

## Context
The solver serves diverse consumers: direct solve, worker messages, Optimize UI, Explore, Gunsmith, MOA-floor search, and automated benchmark classification. Audits and review findings revealed key semantic requirements:
1. **Cross-Context Clock Skew**: Web Window and Web Worker have different `performance.timeOrigin` baselines, requiring normalization to monotonic epoch time to prevent unmetered time runaway.
2. **Out-of-Band Cancellation**: Cancellation messages cannot wait in serialized worker dispatch chains; they must be handled immediately and delivered via explicit event-loop yielding.
3. **Model Optimality vs. Physical Certificate**: An optimal solution to an approximate fast model is an optimum only of that model; mathematical optimality certification over the physical weapon platform requires the precise model.
4. **Interruption Transitions**: Unproved valid incumbents must remain `feasible`, while already-certified proofs must never be downgraded by late cancellations or limits.
5. **Explore Sweeps & MOA Witnessing**: Aggregation must unambiguously evaluate all terminal point compositions, and MOA floor search must prioritize witness preservation over interruption causes while delegating numerical rounding proofs to Issue #34.

## Decision

We establish seven core principles governing status, metadata, deadlines, and consumers:

1. **Cross-Context Monotonic Clocks & Cancellation Routing**:
   - Timestamps are normalized via $\text{epoch\_now} = \text{performance.timeOrigin} + \text{performance.now}()$.
   - Client stamps $\text{client\_epoch\_deadline} = \text{epoch\_now}_{\text{client}} + \text{time\_limit\_ms}$.
   - Worker checks $\text{remaining\_ms} = \text{client\_epoch\_deadline} - \text{epoch\_now}_{\text{worker}}$ at dispatch; if $\le 0$, immediately returns `incomplete` (`Queue timeout before dispatch`).
   - Cooperative cancellation: Worker message listener handles cancel messages out-of-band (bypassing `dispatchChain`), and worker yields to the event loop (`setTimeout(resolve, 0)`) between sub-solves.
   - Hard cancellation: Client calls `worker.terminate()`, immediately settles pending promises with `CancellationError`, and recreates the worker. Verified build snapshots published prior to termination survive.
2. **Separation of Model Optimality from Physical Certification**:
   - `physical_certificate`:
     - `'certified_optimal'`: Exact model (`precision_resolved: 'precise'`), verified physical build, certified optimality (gap $\le$ tolerance).
     - `'approximate_optimal'`: Approximate model (`precision_resolved: 'fast'`), verified physical build, optimal under fast assumptions.
     - `'feasible'`: Verified physical build exists, optimality unproven in either model.
     - `'certified_infeasible'`: Certified physical impossibility strictly on the precise model.
     - `'none'`: No verified physical build exists.
   - Fast infeasibility proves only that the approximate model is infeasible; it cannot certify physical domain impossibility.
3. **Unified Proof State & Interruption Transition Matrix**:
   - Verified incumbent + timeout/cancel/node-limit $\to \text{status: 'feasible'}, \text{termination: 'limit'}$.
   - No verified incumbent + timeout/cancel/queue-timeout $\to \text{status: 'incomplete'}, \text{lower\_bound: null}, \text{termination: 'limit'}$.
   - Certified optimal build + late cancel $\to \text{status: 'optimal'}, \text{termination: 'optimal'}$.
   - Validation failure $\to \text{status: 'incomplete'}, \text{reason: 'Independent build validation failed'}$.
   - Runtime crash $\to \text{status: 'error'}$, worker posts error envelope, client rejects with typed `SolverError`.
4. **Global Spatial Bound Provenance & JSON Transport Representation**:
   - $\text{global\_upper\_bound} = \max(\text{incumbent.objective}, \max_{k \in \text{OpenNodes}} \text{node}_k.\text{upper\_bound})$. Open unbounded nodes yield $+\infty$.
   - JSON transport represents $-\infty$ as `lower_bound: null` and $+\infty$ as `upper_bound: null`. Finite zero is `0.0`. Primal objectives from interrupted MIPs are never published as upper bounds.
5. **Explore Curve Terminal State Matrix**:
   - All verified ($V=N$) or verified + proved-infeasible ($V \ge 1, I \ge 1, U=0, E=0$) $\to \text{'complete'}$.
   - $V \ge 1$ with unresolved/error ($U \ge 1$ or $E \ge 1$) $\to \text{'partial'}$.
   - All proved infeasible ($I=N$) $\to \text{'infeasible'}$.
   - Zero verified with unresolved/error $\to \text{'invalid'}$.
   - Cancelled with $V \ge 1 \to \text{'partial'}$; cancelled with $V=0 \to \text{'invalid'}$.
6. **MOA Witness Tracking & Outward Rounding Contract**:
   - Initial seed solve preserves any verified build witness as achievable `hi` even if interrupted.
   - Binary search advances $\text{lo} = \text{mid}$ if and only if sub-solve returns proved `infeasible` on the precise model. Unresolved sub-solves halt search without advancing $\text{lo}$.
   - UI display requires an outward-safe cap (`display_floor`), with the exact numerical rounding contract and proof delegated to Issue #34.
7. **Complete Shared Response Types**:
   - `OptimizeResponse`, `ExploreResponse`, and `MOAFloorResponse` fully specified in TypeScript, establishing unambiguous contracts for direct and worker callers.

## Consequences & Downstream Contracts

- **Issue #34 (Numerical Authority)**: Formulate the exact conservative outward rounding rule/proof for MOA floors.
- **Issue #36 (Oracles & Validation)**: Update test oracles to assert `classifySample` with `physical_certificate` and gap tolerance.
- **Issue #37 (Telemetry & Benchmarks)**: Ensure worker telemetry records epoch timestamps, queue latency, and stage timings.
