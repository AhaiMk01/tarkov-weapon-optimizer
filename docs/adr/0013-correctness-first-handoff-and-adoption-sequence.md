# ADR 0013: Correctness-First Handoff and Adoption Sequence

## Status
Accepted (Refs #40). Closed 2026-10-04 as an executable implementation plan, not as implementation or production authorization.

Canonical text: [issue comment 5976976705](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/40#issuecomment-5976976705). It supersedes the revised proposal in comment 5976882470 and the earlier proposal in comment 5976708799.

The parent decision map is closed as completed planning: [issue comment 5976982435](https://github.com/AhaiMk01/tarkov-weapon-optimizer/issues/28#issuecomment-5976982435). All fourteen native child decisions are closed. That closure does not complete the oracle, native proof surface, solver repair, browser smoke, or any comparative measurement.

## Context
The accepted domain, certificate, benchmark, MOA, numeric, inventory, purchase, oracle, binary-placement, and preparation comments remain normative in full. This ADR records only the cutover order and the qualifications the parent added when accepting it.

Implementation starts only after separate authorization, on an isolated branch from the preserved source baseline this review read. It is not a checkout, merge, or deploy onto reverted `master`. This acceptance does not create that branch and does not authorize a source change, commit, tag, release, push, or deployment.

## Decision

### 1. Four stages

Private commits on the future implementation branch may be incomplete. No intermediate public contract is adopted. There are no shims, legacy aliases, or fake fallbacks. A failed correctness candidate is withheld and is not rolled back onto the known-invalid legacy model.

| Stage | Adoptable result |
| :--- | :--- |
| 1. Independent oracle, raw-source checks, and the 14-family case ledger, including required rejection of invalid fixtures | The independent reference only. The legacy production `validateBuild` is not required to accept multi-copy, rooted, or numerical cases before it is repaired. Upgrading that production validator is Stage 2 |
| 2. One private correctness cutover: model, adopted numerics, native evidence, deadline and cancellation, response metadata, decoder, worker, client, UI, benchmarks, and the minimal preparation seam | Nothing public |
| 3. Proof of that whole unreduced cutover, including numerical, TED, and MOA families and browser smoke | The cutover, or nothing |
| 4. Optional equivalent reductions against the proved Stage 3 baseline | Only a candidate inside the already settled reduction space that passes Gates A–C and the full comparative contract. Otherwise the Stage 3 baseline stays |

Stage 1's reference does not call `buildCompatibilityMap`, `buildLP`, HiGHS, the production decoder, or production pricing and scoring helpers. The 14 families are a case ledger of subcases, not 14 files. "Zero validation errors" applies to builds claimed valid. A correctly rejected invalid fixture is a pass.

Stage 2 includes the full adopted numeric contract, not a later public stage and not a gamma-3 summary alone: barrel replacement versus intrinsic fallback, signed accuracy and Big-M bounds, every raw and effective clamp regime, arithmetic-DAG coefficient, row, and parser allowances, valid hard secant intervals and singletons, objective and global-bound corrections, exact source and constant semantics, finite outward display, the final submitted request grid, and round-trip-safe finite coefficients. Already-correct scoring, interval, and bound behavior stays unless a case shows it is wrong.

`extractAllPresets` already keeps repeated preset item ids and is preserved. The defects to repair are the later `Set` consumers, the decoder that places each item id once, the FiR objective stand-in, and the unproved `buy_i = x_i` alias.

Parent coupling survives as a concept: child occupancy stays tied to the parent instance, using occurrence and parent-instance identities and the proved presence and count relationships. The current `conn_p` and single-owner `conn` rows identify that concept. They are not copied unchanged when alternative parents or repeated instances make their indices wrong.

The shipped HiGHS solution is `Status`, `ObjectiveValue`, `Columns`, and `Rows`. A qualified `certified_optimal` certificate and a certified endpoint cache wait until the integrated native surface returns the fields they use. A diagnostic log is not a proof, and a time-limit primal is not an upper bound. A justified analytic node bound from the accepted numerical and search contract is also a valid upper-bound source. The request-wide upper bound is the maximum of the verified incumbent and every live justified frontier bound in the same objective frame. An unknown frontier bound stays unknown. A finite sibling does not hide it. Lower bounds come from independently verified incumbents and outward-safe scoring.

A rejected decode is not an incumbent and does not erase an earlier verified witness or a completed qualified proof. Native typed errors stay distinct from a normal solve result.

Endpoint reuse extends the existing ideal-point key and permits only the already authorized preference changes, under the preparation and tightened-tolerance rules. The session physical key does not depend on a request-clipped weight cap. A mismatched or foreign preparation is rejected or rebuilt. Changed deadlines, limits, authority, numerical controls, or domains do not gain reuse permission. No solution or full-response cache is added.

Endpoint weights `[100,0,0]`, `[0,100,0]`, and `[0,0,100]` produce `10*fE`, `-100*fR`, and `-0.1*fP`. Sub-millisecond assembly figures are targets, not gates. Domain identity is the full preparation ledger, including stable occurrence masks.

### 2. Status and certificates

Deadline and cancellation do not always produce a feasible build. `approximate_optimal` is only a qualified model optimum: Fast, or precise and MOA-dependent. A feasible MOA-dependent incumbent stays `feasible` with `provisional_model`. Proved provisional-model infeasibility is public `incomplete` / `none`, and its internal model proof is retained. Fast and MOA-dependent requests keep both qualifiers.

A completed qualified optimum or infeasibility stays proved after a late deadline or cancellation. No verified incumbent is `incomplete` / `none`, with a null lower bound and a finite upper bound only when one is proved. Hard client termination and native runtime failure use their operation error and snapshot contracts.

MOA-floor (`model_proved`, `model_witnessed`, `unresolved`, `model_infeasible`) and the seven-row Explore contract are separate outcomes. Explore does not cache another point's solution or certificate. Invalid `owned_items` does not run HiGHS. Metadata fetches, including `getGunsmithTasks`, stay unchanged.

Provisional MOA correctness is the adopted software model on the pinned snapshot. It is not attested game-engine truth.

### 3. Comparative non-adoption

Issue #37 remains normative in full. A BCa interval of `[1.01, 1.03]` is Gate 2 `FAIL`. An upper bound of exactly `0.95` is not Gate 3 `PASS`. A zero-variance apparent speedup is `INCONCLUSIVE`. `FAIL` or `INCONCLUSIVE` leaves the last validated correct baseline intact. There is no automatic production rollback.

Stage 4 does not reopen unrelated search, cache, or engine work. The dense-TED 60-second target stays deferred. Python or CP-SAT output remains differential evidence only.

## Consequences

- Planning for this map is complete. Implementation proofs remain outstanding.
- Deferred future numerical and memory tradeoffs, unsupported-data or weapon exceptions, and new evidence-driven adoption questions stay deferred. They are not blockers to the selected handoff and are not silently solved.
- Docs and changelog for the implementation change only after the browser smoke proof.
