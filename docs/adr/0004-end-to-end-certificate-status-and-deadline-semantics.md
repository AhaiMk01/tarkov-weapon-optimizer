# ADR 0004: End-to-End Certificate, Status and Deadline Semantics

## Status
Proposed (Refs #35). Canonical Amendment 2026-10-02.

## Context
The solver serves diverse consumers: direct solve, worker messages, Optimize UI, Explore, Gunsmith, MOA-floor search, and automated benchmark classification. Audits revealed critical semantic inconsistencies:
1. **Model Qualification Gaps**: Fast mode reported `optimal` without qualifying that it ran on an approximate model without physical placement variables.
2. **Silent Search Bound Corruption**: MOA-floor binary search advanced its lower bound (`lo = mid`) on timeouts and unresolved statuses, treating a time limit as proof of infeasibility. Furthermore, standard display rounding could round down below the witnessed achievable MOA.
3. **Queueing & Multi-Step Deadline Runaway**: Model prep and data fetching consumed time before HiGHS started, requests queued behind synchronous solves received unmetered extra time, and synchronous WASM execution prevented cooperative cancellation delivery.
4. **Interruption Contradictions**: Expirations during spatial search were unconditionally marked `incomplete` even when an incumbent was verified, or marked `feasible` when no incumbent existed.
5. **Explore Sweep Ambiguity**: Undefined aggregate statuses existed for sweeps containing proved-infeasible points or errors.

## Decision

We establish six core principles governing status, metadata, deadlines, and consumers:

1. **Status Definitions & Fast Qualification**:
   - `optimal`:
     - *Precise*: Exact placement model (`precision_resolved: 'precise'`), verified physical build (`validateBuild` errors = 0), and certified optimality ($\text{gap} \le \text{tolerance}$, $\text{termination} === \text{'optimal'}$).
     - *Fast*: Optimal under relaxed binary assumptions, qualified by `model_qualification: 'approximate'` and `precision_resolved: 'fast'`.
   - `feasible`: Verified physical build exists, but optimality is unproven (e.g. limit reached with an incumbent).
   - `incomplete`: Search stopped without a verified build (e.g. limit reached before first incumbent, or validation failure).
   - `infeasible`: Proved mathematical or physical impossibility (e.g. empty root required slot or MIP returned `Infeasible` on precise model). Timeouts and errors are never infeasible.
   - `error`: Unhandled exception or WASM crash.
2. **Interruption Transitions & Truthful Metadata**:
   - Proof state and verified incumbent existence strictly govern terminal outcomes:
     - Verified incumbent + timeout/cancel/node-limit $\to \text{status: 'feasible'}, \text{termination: 'limit'}$.
     - No verified incumbent + timeout/cancel $\to \text{status: 'incomplete'}, \text{lower\_bound: null}, \text{termination: 'limit'}$.
     - Certified optimal build + late cancel $\to \text{status: 'optimal'}, \text{termination: 'optimal'}$ (already-established proofs are never downgraded).
   - JSON transport represents $-\infty$ as `lower_bound: null` and $+\infty$ as `upper_bound: null` (finite zero is `0.0`). Primal objectives from interrupted MIPs are never used as upper bounds.
3. **Queue-Aware Deadline Ownership & Cancellation**:
   - Client API stamps $\text{deadline\_ms} = \text{created\_at} + \text{time\_limit\_ms}$.
   - Worker checks $\text{remaining\_at\_dispatch} = \text{deadline\_ms} - \text{now}$. If $\le 0$, immediately returns `incomplete` (`Queue timeout before dispatch`).
   - Every sub-operation receives $\max(0.001, (\text{deadline\_ms} - \text{now}) / 1000)$.
   - Cooperative cancellation: Worker yields to the event loop (`setTimeout(resolve, 0)`) between sub-solves to process cancel messages.
   - Hard cancellation: Client calls `worker.terminate()`, immediately settles pending promises with `CancellationError`, and spawns a fresh worker instance.
4. **Global Spatial Bound Provenance**:
   - $\text{global\_upper\_bound} = \max(\text{incumbent.objective}, \max_{k \in \text{OpenNodes}} \text{node}_k.\text{upper\_bound})$.
   - Open unbounded nodes yield $+\infty$. Absolute gap is $\max(0, \text{upper} - \text{lower})$.
5. **Explore Curve Terminal State Matrix**:
   - $N$ requested points produce an aggregate `curve_status`:
     - All verified ($V=N$) or mix of verified and proved-infeasible ($V \ge 1, I \ge 1, U=0, E=0$) $\to \text{'complete'}$.
     - $V \ge 1$ with unresolved/error ($U \ge 1$ or $E \ge 1$) $\to \text{'partial'}$.
     - All proved infeasible ($I=N$) $\to \text{'infeasible'}$.
     - Zero verified with unresolved/error $\to \text{'invalid'}$.
     - Cancelled with $V \ge 1 \to \text{'partial'}$; cancelled with $V=0 \to \text{'invalid'}$.
6. **MOA Witness & Outward Ceiling Rounding**:
   - `hi` must be backed by a verified build witness. Seed failure reports `floor: null`, `status: 'unresolved'`.
   - Binary search advances `lo = mid` if and only if sub-solve returns proved `infeasible`. Unresolved outcomes halt search.
   - Display floor uses outward ceiling rounding ($\lceil \text{hi} \times 1000 \rceil / 1000$) to guarantee physical feasibility on UI sliders.
   - Response shape: `{ status, floor, display_floor, proved_lower_bound, witness }`.

## Consequences & Downstream Contracts

- **Issue #36 (Oracles & Validation)**: Update test oracles to assert `classifySample` with precision qualification, gap tolerance, and ceiling-rounded MOA bounds.
- **Issue #37 (Telemetry & Benchmarks)**: Ensure worker telemetry records request deadlines, queue latency, and stage timings.
- **Client & Worker Migration**: Update `solver.worker.ts`, `paretoExplorer.ts`, `client.ts`, and `App.tsx` per the contract.
