# Stage 3 operations, validator agreement and determinism evidence (workstreams 3.5 and 3.6)

Refs #40. Normative source: ADR 0013 §4D, §5, §6 and §7; `docs/stage3-plan.md` rows 3.5 and 3.6; owner decision 2d as amended (cyclic part data is
unsupported: no refusal, the blueprint throws an internal error, so the matrix has no cyclic rows) and decision 5b (integrality tolerance 1e-7).

Branch `impl/stage2-correctness-cutover`. All paths are under `frontend/`.

## New test files

| File | What it proves |
| :--- | :--- |
| `tests/runtime/operationsMatrix.harness.ts` | The rig: the **real** worker runtime (`createWorkerRuntime`) with the real solve, the real Explore and MOA floor drivers and the pinned native build. The only seams are ones a worker has anyway: the data load, the epoch clock, and the native solve of the shared pinned instance. A test can wrap that solve to report a native time limit, withhold a proof (a read warning), tamper with the primal (a point the validator rejects), throw a typed failure, or deliver a cancel. |
| `tests/runtime/operationsMatrix.test.ts` | The transition matrix below: 98 tests, all pass (the former `todo` of defect D1 passes since the 2026-10-12 fix; the cyclic-refusal tests left with cyclic handling, 2026-10-12). |
| `tests/solver/relaxedFallback.defect.test.ts` | Minimal reproduction of defect D1 on `solvePrecise`, now its regression test: the control and both D1 cases pass (fixed 2026-10-12); plus the Fast side of the second case on `solveFast` (fixed 2026-10-12). |
| `reference/harness/validatorLedgerBuilds.differential.test.ts` | 3.6a: the two validators agree on every hand-derived ledger build, every rejection code, the strict production configuration and the production-only codes (6 pass). |
| `tests/solver/determinism.test.ts` | 3.6b: the same response on repeated runs (fresh state, warm caches, worker runtime) and across permutations of the second-opinion seeds, on the ledger and on pinned guns (5 pass). |

The new matrix test file is `M` in the tables. A cell named `M: <cause>` is the test `<operation>: <cause>` in that file. Each search operation has
one such test per cause.

## 3.5 Operations transition matrix

Operations: **OF** Optimize Fast, **OP** Optimize Precise, **OA** Optimize Auto (resolves Precise for a plain request), **GS** Gunsmith optimize (the
same `optimize` message, carrying the App's Gunsmith request: Precise, weights 1/1/0.5, task constraints, a required part), **EX** Explore, **FL**
MOA floor, **MD** metadata (`loadData`, `getInfo`, `getWeaponMods`, `getGunsmithTasks`, `getStatus`, `clearCache`).

Every M cell asserts the public envelope: status/curve_status, certificate, reason, termination, the resolved qualifiers, and the build/points/witness
with their bounds. Every reason must be in the closed set.

### Causes

| Cause | OF | OP | OA | GS | EX | FL | MD | Earlier evidence (still green) |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :--- |
| Normal completion: `M: normal completion` | PASS | PASS | PASS | PASS | PASS | PASS | PASS¹ | `tests/solver/solve.test.ts`, `tests/runtime/workerOperations.test.ts` (floor and Explore through the runtime), `tests/solver/moaFloor.e2e.test.ts`, `tests/solver/exploreSweep.test.ts` (end to end) |
| Queue expiry: `M: queue expiry` | PASS | PASS | PASS | PASS | PASS | PASS | N/A² | `workerRuntime.test.ts` "a request that expired in the queue…" (per operation); `workerOperations.test.ts` client "…an expired budget" |
| Cancel while queued: `M: cancel while queued` | PASS | PASS | PASS | PASS | PASS | PASS | PASS¹ | `workerRuntime.test.ts` "a request cancelled while queued…" |
| Cancel while running, during preparation: `M: cancel while running, delivered as a task during preparation` | PASS | PASS | PASS | PASS | PASS | PASS | PASS¹ | `workerRuntime.test.ts` "a cancel message bypasses the dispatch chain"; `solveGuard.test.ts` "cancelled before its first stage"; `workerOperations.test.ts` client soft cancel |
| Cancel while running, after a verified build: `M: cancel while running after a verified build` | PASS | PASS | PASS | PASS³ | PASS | PASS | — | `solveGuard.test.ts` "a cancel between spatial nodes…"; `searchGuard.test.ts`; `workerOperations.test.ts` floor/Explore cancel across a yield; `exploreSweep.test.ts` rules 6/7 and the end-to-end cancel; `moaFloor.test.ts` "a macrotask yield separates trials…" |
| Invalid `owned_items`: `M: invalid owned_items` | PASS | PASS | PASS | PASS | PASS | PASS | PASS¹ | `workerRuntime.test.ts` (7 invalid shapes, 10000 valid); `solve.test.ts`; `moaFloor.test.ts`; `moaFloor.e2e.test.ts`; client test |
| Deadline before the model (after dispatch): `M: deadline before the model` | PASS | PASS | PASS | PASS | PASS | PASS | PASS¹ | `solve.test.ts` "a deadline that has passed…"; `solveGuard.test.ts`; `exploreSweep.test.ts` "targets never launched because of the deadline…"; `moaFloor.test.ts` "unresolved: a seed that is stopped…" |
| Deadline during the solve, before a verified build: `M: deadline during the solve before any verified build` | PASS | PASS | PASS | PASS | PASS | PASS | N/A | `tests/physical/solveOutcome.test.ts` native limits (Precise and Fast); `moaFloor.native.test.ts` "an incomplete Precise result is a stop…" |
| Deadline during the solve, after a verified build: `M: deadline during the search after a verified build` | PASS | PASS | PASS | PASS³ | PASS | PASS | N/A | `solveGuard.test.ts` (expired between nodes); `moaFloor.test.ts` "the deadline between trials…"; `exploreSweep.test.ts` |
| Deadline during the second opinion: `M: deadline during the second opinion` | N/A⁴ | PASS | PASS | PASS | PASS | PASS⁵ | N/A | `tests/physical/solvePrecise.secondOpinion.test.ts` (timeout, unqualified, infeasibility needs both verdicts) |
| Withheld bound: `M: withheld bound` | N/A⁶ | PASS | PASS | PASS | PASS | PASS | N/A | `solveOutcome.test.ts` "parsed model differs…"; `countModel.proof.test.ts`; `moaFloor.native.test.ts` |
| Independent validation failure: `M: independent validation failure` | PASS | PASS | PASS | PASS | PASS | PASS | N/A | `solveOutcome.test.ts` (both models); `exploreSweep.test.ts` "a published status without the build is not one"; `moaFloor.test.ts` |
| Invalid Explore schedule | N/A | N/A | N/A | N/A | PASS | N/A | N/A | `exploreSweep.test.ts` "an empty or invalid schedule…"; `workerOperations.test.ts` "an unsweepable Explore request…"; `exploreSweep.snapshots.test.ts`; M precedence (below) |
| Typed native failure | PASS | PASS | PASS | PASS | PASS (E row) | PASS | N/A | M "precedence — a typed native failure…"; `solveGuard.test.ts`; `workerRuntime.test.ts`; `floorFailure.test.ts`; `workerOperations.test.ts` |

¹ M "metadata operations complete normally and ignore a stash, a stamped deadline long past, and a cancel (queued or running)". A metadata operation
reads no stash and no deadline (ADR §4D). A cancel of one is ignored and it completes normally. `workerRuntime.test.ts` "metadata operations take no
stash and no deadline" also covers this.
² A metadata operation has no deadline, so it never expires in the queue (asserted with a stamped deadline 1e9 ms in the past).
³ Gunsmith never sends TrueErgo, so its search has one node and no macrotask yield before that node completes. A cancel or deadline that arrives then
does not downgrade the certified optimum (asserted). After a witness, the stop reaches Gunsmith through the second-opinion row.
⁴ Fast runs no second opinion. M asserts that no Fast native call sets a seed and that the response is unchanged.
⁵ A floor witness spends no second opinion (first-witness policy). The second opinion confirms a trial **emptiness**. Cut short, the trial raises no
`lo`: `model_witnessed`, `Time limit reached`, `proved_lower_bound: null`.
⁶ Fast has no proof to withhold: it never reads a bound back and never carries a physical upper bound. M asserts `approximate_optimal` with
`upper_bound: null` under the same read warning.

Observed envelopes (all asserted in M):

- **Optimize family.** A stop with no witness is `incomplete`/`none` with a null objective and a null LB. A stop with a witness is
  `feasible`/`feasible` with the build and its LB. Termination is `limit` whenever the search is unfinished. A validation failure after a completed
  search is `optimal`. A withheld proof is `feasible` with termination `optimal`, `upper_bound: null` and `absolute_gap: null`. A deadline during the
  second opinion keeps the first opinion's qualified UB. A request that reached the model reports its resolved model; a pre-model stop (stash, queue,
  cancel while queued) reports null resolved fields, nodes 0 and `limit`.
- **Explore.**
  - Entry stops are `invalid` with `[]` points, no schedule and no rows.
  - A stop during the sweep leaves unlaunched targets as U with the factual reason. The curve is `partial` with V >= 1 (rules 3 and 6) and `invalid`
    with V = 0 (rules 5 and 7).
  - A withheld proof gives V rows with a `feasible` certificate, so the curve is `complete` (discrete coverage, no certificate anywhere).
  - Rejected builds are never points.
- **Floor.** No witness is `unresolved` with null floor, display floor and bound. A retained seed witness is `model_witnessed` with the factual reason
  and `proved_lower_bound: null`. Every response carries `provisional_model`.

### Precedence (ADR §6), every pair that can co-occur

| Pair | Winner | OF | OP | OA | GS | EX | FL | Tests |
| :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :--- |
| invalid stash + queue expiry + cancel queued | invalid stash | PASS | PASS | PASS | PASS | PASS | PASS | M: invalid owned_items; `workerRuntime.test.ts` |
| cancel queued + queue expiry | cancel | PASS | PASS | PASS | PASS | PASS | PASS | M: cancel while queued; `workerRuntime.test.ts` |
| Explore: invalid stash + invalid schedule; queue expiry + invalid schedule; invalid schedule + passed deadline | stash; queue; schedule | | | | | PASS | | M "Explore precedence at entry…" |
| validation failure + deadline | validation | PASS | PASS | PASS | PASS | PASS⁸ | PASS | M "precedence — an observed validation failure…"; `tests/physical/outcome.test.ts` precedence 2; `solveOutcome.test.ts` (Fast); `moaFloor.test.ts` "a stop reason is reconciled with the guard" |
| validation failure + cancel | validation | PASS | PASS | PASS | PASS | PASS⁸ | PASS | M (same test); `searchGuard.test.ts` "a pure interrupt reported by a node loses to a coincident cancel, a validation failure does not" |
| withheld proof + deadline | prerequisite, witness kept | N/A | PASS (D1 fixed) | PASS (D1 fixed) | PASS (D1 fixed) | PASS (D1 fixed) | PASS (D1 fixed) | M "D1 (fixed)…"; `relaxedFallback.defect.test.ts`; the classifier: `outcome.test.ts` precedence 3, `moaFloor.test.ts` reconcile |
| cancel + deadline (pure interrupts) | cancel | PASS | PASS | PASS | PASS | PASS | PASS | M "precedence — pure simultaneous interrupts…"; `outcome.test.ts` precedence 4; `solveGuard.test.ts`; `searchGuard.test.ts`; `runtimeGuard.guardStop` |
| deadline + node limit + native solution limit | cancel, deadline, node limit, solution limit | — | PASS | PASS | — | — | PASS | `outcome.test.ts` precedence 4; `searchGuard.test.ts` "simultaneous interrupts…"; `solveOutcome.test.ts` node cap; `moaFloor.test.ts` / `moaFloor.native.test.ts` solution limit |
| completed proof + late cancel and deadline | proof, never downgraded | PASS | PASS | PASS | PASS | PASS | PASS | M "precedence — a completed qualified proof…" (Optimize family, flags raised in the last native call), M "Explore and MOA floor: precedence — a completed schedule and a completed bracket proof survive…"; `solveGuard.test.ts`; `searchGuard.test.ts`; `exploreSweep.test.ts` completed-schedule precedence; `moaFloor.test.ts` "a completed bracket proof survives…" |
| typed native failure + deadline | the failure (not rewritten) | PASS | PASS | PASS | PASS | PASS (E row) | PASS (snapshot, then the error) | M "precedence — a typed native failure is never rewritten…"; `exploreSweep.test.ts` "a failure that surfaces while a cancel is pending is an unresolved target" (cancel + failure in Explore is U by design) |

⁸ The Explore target keeps `Independent build validation failed` on its row. The aggregate `reason` is the cause that stopped the schedule (the
deadline or the cancel); the per-target rows are authoritative (ADR §5). This is by design (`exploreSweep.ts` `buildResponse`), recorded here as
observation O1.

### Full floor and Explore classification

| Case | Tests |
| :--- | :--- |
| V = optimal or feasible verified witness; a published status without the build is U | `exploreSweep.test.ts` "V is an independently valid optimal OR feasible witness…"; M withheld (feasible V) |
| I = infeasible + certified_infeasible, Precise MOA-independent; Fast and provisional-MOA emptiness are U | `exploreSweep.test.ts` "I is status infeasible AND certified_infeasible…", end-to-end "I = N…"; M "Explore I = N through the runtime" and "Fast and provisional-MOA emptiness are U, never I" (real pipeline) |
| E = runtime error, the sweep goes on | `exploreSweep.test.ts` "a runtime error is a row (E)…"; M typed native failure: one real sweep with V, E and I rows (`partial`) |
| The seven curve rules and completed-schedule precedence | `exploreSweep.test.ts` "curve_status: the seven rules", rules 6/7, completed-schedule precedence, "every classification of a finished schedule…"; M covers rules 1, 3, 4, 5, 6 and 7 through the runtime. Rule 2 (V >= 1, I >= 1, V + I = N) is proved at driver level only (no small real sweep produces it without E). |
| Floor discovery (d = max(1, \|hi\|/2), doubling), qualified emptiness sets lo, bisection, hi only to achieved values | `moaFloor.test.ts` "discovery doubles d…", "the production search replays the ADR 0013 section 9 checker…"; `moaFloor.e2e.test.ts` "the trace shows the seed, then discovery probes below hi, then bisection…" |
| At most 14 threshold trials, the seed is not a trial | `moaFloor.test.ts` "at most 14 threshold trials…", "the documented ADR observations: hi 1.25 in 10 trials…" |
| model_proved | `moaFloor.e2e.test.ts` end to end; `moaFloor.test.ts` "model_proved needs a full witness and a bracket within 0.02"; `workerOperations.test.ts`; M normal completion (FL) |
| model_witnessed | `moaFloor.test.ts` (trial cap, immediate stop, contradiction, no progress); M cancel/deadline after the seed, second opinion, withheld |
| unresolved | `moaFloor.test.ts` "unresolved: a seed that is stopped, cancelled, out of time, or unqualified…"; M deadline before the model, validation failure, entry envelopes |
| model_infeasible | `moaFloor.test.ts` "model_infeasible: only a QUALIFIED seed emptiness…"; `moaFloor.e2e.test.ts`; M "MOA floor through the runtime: a qualified seed emptiness is model_infeasible…" |
| Zero and negative caps, display floor, native first-witness stop | `moaFloor.test.ts`, `moaFloor.e2e.test.ts`, `moaFloor.native.test.ts` |

### Defect D1 (production; FIXED 2026-10-12, Stage 3 follow-up)

**Where.** In `src/solver/physical/solvePrecise.ts` `evaluate`, the relaxed-edge first try of a Precise node judges its answer exactly. When the
relaxed optimum is integral and the validator accepts its build, the build is **verified**, even if the solve is not qualified (a read warning) or
stopped at a native time limit. `judge` then returns it as `none({ candidate })`. `evaluate` falls back to the integer model, yields and reads the
guard. On a stop it returns `interrupted(model, stop)`. Only a rejected relaxed point (`relaxedRejection`) is carried across that stop. The verified
candidate and the observed proof-prerequisite failure are dropped.

**Effect.** The request is `incomplete`/`none` with `Time limit reached`. ADR §6 requires `feasible`/`feasible`, because a verified current witness
exists. It also requires `Required proof prerequisite unavailable`, because an observed proof-prerequisite failure outranks a coincident interrupt. The
same loss happens in an Explore step (U instead of V) and in a floor seed (`unresolved` instead of `model_witnessed`). Nothing false is published
(the answer is conservative), but a verified witness and the factual cause are lost.

**Reproduction.** `tests/solver/relaxedFallback.defect.test.ts` uses one slot holding `a` or `b` and the pinned solve. Every answer carries a read
warning, and the clock passes the deadline during call 0, the relaxed solve:

- the control passes: with time left, the same tampering yields the build `b` as feasible;
- before the fix, the first D1 case got `incomplete` / `Time limit reached` after one native call;
- before the fix, the second D1 case showed the same loss for a relaxed solve that stopped at `TimeLimit` with a primal.

Through the runtime: M "D1 (fixed)" (OP, OA, GS, EX, FL).

**Fix (2026-10-12).** `solvePrecise.ts` `evaluateNative` keeps the relaxed first opinion (`kept`) when it holds a verified build or a reason that is
not a pure interrupt. On a guard stop before the integer re-solve it returns `unconfirmed(model, kept)` with `finished: false` (a rejected relaxed
point still takes precedence as a validation failure); the classifier then applies the section 6 precedence. When no stop occurs the integer model is
solved as before and its evaluation is merged with `kept` (`withKept`): the better verified build is the node's candidate (offered to the search as an
incumbent), and an observed proof-prerequisite failure replaces a coincident interrupt reason. Results: both D1 cases and the runtime matrix row pass
without a `todo` mark (OP, OA, GS: `feasible` / `Required proof prerequisite unavailable` with the build; EX: the first target is V and the curve
partial; FL: `model_witnessed`). The second case keeps its factual `Time limit reached` (the relaxed solve's own native stop) with the build.

**Fast side of the second case (fixed 2026-10-12).** `solveFast.ts` `tryRelaxedEdges` treated every non-`Optimal` relaxed answer as fractional, so a
relaxed-edge solve that stopped at its native time limit with an integral primal the validator accepts lost that witness (the request was
`incomplete` / `Time limit reached`). It now judges such a primal exactly as the integer model's own limit stop is judged: a verified build is the node's
witness with the stop's reason (`feasible` / `feasible` / `Time limit reached`, `approximate`); a limit stop with no primal, a fractional edge or no
verified build still falls back to the integer model. Tests: M "D1 (fixed), second case" now includes OF; `relaxedFallback.defect.test.ts` "Fast: a
relaxed-edge solve stopped at a native time limit…" (fails before the fix, passes after).

### Other observations

- **O1.** In Explore the aggregate reason is the stop cause, while the per-target row keeps the validation reason (footnote 8). This is by design.
- **O2.** See 3.6b below: at the 1e-9 runtime tolerance, certificate issuance depends on the order of the second-opinion seeds (decision 5b).
- **O3.** (Resolved 2026-10-12.) Fast's relaxed-edge try used to discard any non-`Optimal` relaxed answer without judging it, so a native time limit in
  the first Fast solve yielded `incomplete` rather than `feasible`; see "Fast side of the second case" above.

## 3.6a Validator agreement on the ledger

`reference/harness/validator.differential.test.ts` (Stage 2) compares the two validators on every ledger case:

- 149 of 149 cases are compared and 0 are skipped;
- 992 builds the oracle enumerates;
- 18,562 build mutations and 36,053 request variants;
- the hand-derived rejections against their expected codes.

`validatorLedgerBuilds.differential.test.ts` adds four checks:

1. **Every hand-derived ledger build** is judged by **both** validators under the case request, with the full comparator (verdict, code set, exact
   statistics, per-occurrence sources): 160 rejections, 9 accepts, 113 statistic checks, 7 provenance checks and 3 near-cap checks. No disagreement.
   The reference reports exactly the ledger's codes on every rejection.
2. **The configuration production publishes with** (`requirePathInstanceIds: true`, as `solvePrecise` and `solveFast` prepare the validator). 1,284
   ledger builds (hand-derived and enumerated) keep the reference verdict. The production-only `INSTANCE_ID_NOT_PATH_DERIVED` appears on exactly the 5
   builds whose child ids are not `parent/slot:item`. The Stage 2 differential ran only the permissive configuration.
3. **Rejection-code coverage** (table below). Every reference code is exercised by a compared ledger build, except the three input-shape codes no
   ledger build can carry. 3b exercises those on every case: `BASE_UNKNOWN_PRESET` on 149 cases, `UNKNOWN_ITEM` and `UNKNOWN_SLOT` on 147 each (two
   cases have no part to rename), with full agreement. They are also among the mutation operators of the Stage 2 test.
4. **Production-only codes.** `CLAIMED_SPEND_MISMATCH` is checked by the Stage 2 test (b) and `INSTANCE_ID_NOT_PATH_DERIVED` by check 2.
   `CLAIMED_ACQUISITION_MISMATCH` is new: an exact claimed provenance is accepted and a short one is reported, on every ledger accept with a part. The
   shared verdict is unchanged.

| Reference code | Hand-derived rejections (cases) | Ledger cases carrying it | Enumerated builds |
| :--- | :-: | :--- | :-: |
| BASE_UNKNOWN_PRESET | 0 | none (3b: 149 cases) | 0 |
| BASE_WRONG_WEAPON | 1 (1) | F05-no-legal-base-preset-of-another-weapon | 0 |
| BASE_INACCESSIBLE | 7 (6) | F05-inaccessible-naked-accessible-preset, F05-no-legal-base-owned-receiver-grants-nothing, F05-no-legal-base-preset-of-another-weapon, F05-stored-zero-price-receiver-is-not-an-offer, F06-stripping-and-retention-exact-tie, F13-reduction-counterexample-preset-offset | 0 |
| DUPLICATE_INSTANCE_ID | 1 (1) | F14-repeated-instance-identity | 0 |
| UNKNOWN_ITEM | 0 | none (3b: 147 cases) | 0 |
| UNKNOWN_PARENT_INSTANCE | 3 (2) | F03-descendant-removal-chain, F03-indexed-orphan-removal | 0 |
| UNROOTED_PLACEMENT | 3 (2) | F03-descendant-removal-chain, F10-no-disconnected-assembly | 0 |
| UNKNOWN_SLOT | 0 | none (3b: 147 cases) | 0 |
| ITEM_NOT_ALLOWED_IN_SLOT | 1 (1) | F10-no-disconnected-assembly | 0 |
| SLOT_CAPACITY_EXCEEDED | 1 (1) | F14-repeated-instance-identity | 0 |
| ANCESTOR_TEMPLATE_REPETITION | 5 (4) | F03-ancestor-loop-with-sibling-repetition, F03-memoization-context-ancestor, F03-memoization-context-required-slot, F03-self-loop | 0 |
| MISSING_REQUIRED_SLOT | 21 (15) | F01-slot-conflict-against-a-required-slot-bans-the-blocker, F02-conditional-required-slot-excluded-candidate-owner-off, F02-conditional-required-slot-unavailable-candidate-owner-off, F02-conditional-required-slot-with-surviving-candidate, F02-empty-root-required-slot-excluded, F02-empty-root-required-slot-unavailable-candidate, F02-root-required-slot-satisfied-only-via-alternative, F03-fixed-point-removal, F03-memoization-context-required-slot, F06-required-slot-filled-only-through-preset-supply, F08-required-barrel-slot-fallback-via-missing-coi, F09-one-item-two-required-slots-insufficient-stock, F10-conditional-owner-deactivation, F10-cycle-behind-deactivated-owner, F10-retained-alternate-rooted-path | 0 |
| TEMPLATE_CONFLICT | 8 (5) | F01-copies-legal-when-partner-absent, F01-template-conflict-across-branches, F01-template-pair-exclusion, F04-impossible-include-conflicting-pair, F06-preset-with-conflicting-parts-forces-stripping | 14 |
| SELF_CONFLICT_COPY_CAP | 2 (1) | F01-self-copy-cap | 4 |
| SLOT_CONFLICT | 5 (4) | F01-legal-alternative-placement, F01-slot-conflict-against-a-required-slot-bans-the-blocker, F01-slot-conflict-blocks-every-physical-occurrence, F01-slot-conflict-blocks-host-rail | 9 |
| EXCLUDED_ITEM | 8 (8) | F02-conditional-required-slot-excluded-candidate-owner-off, F02-conditional-required-slot-with-surviving-candidate, F02-empty-root-required-slot-excluded, F03-fixed-point-removal, F03-indexed-orphan-removal, F04-exclude-item, F04-impossible-include-excluded, F06-forced-stripping-by-exclusion | 0 |
| EXCLUDED_CATEGORY | 3 (2) | F04-exclude-category-ancestor-chain, F04-exclude-category-direct | 0 |
| MISSING_INCLUDE_ITEM | 8 (6) | F04-impossible-include-conflicting-pair, F04-impossible-include-excluded, F04-impossible-include-unreachable-item, F04-include-exceeds-capacity, F04-include-fills-capacity-exactly, F04-include-item | 43 |
| MISSING_INCLUDE_CATEGORY_GROUP | 6 (3) | F04-category-group-structure, F04-impossible-include-unmatched-category, F04-include-category | 16 |
| QUANTITY_CAP_EXCEEDED | 26 (16) | F02-barter-on-dogtag-excluded, F02-conditional-required-slot-unavailable-candidate-owner-off, F02-empty-root-required-slot-unavailable-candidate, F02-flea-off-and-barter-off-leave-only-cash-offers, F02-missing-trader-defaults-to-level-four, F02-unavailable-by-trader-level-flea-level-and-disabled-trader, F05-preset-only-item-no-invented-price, F06-preset-supply-when-no-other-source, F06-required-slot-filled-only-through-preset-supply, F09-one-item-two-required-slots-insufficient-stock, F09-required-copies-preset-plus-owned-supply, F09-standalone-inaccessible-cap-is-exact, F09-zero-cost-barter-is-a-legal-offer, F09-zero-stored-price-is-not-an-offer, F13-reduction-counterexample-owned-stock-below-capacity, F14-source-quantities-repeated-entries-and-zero-count | 184 |
| MAX_PRICE_EXCEEDED | 9 (8) | F04-max-price-cap-boundary, F04-near-cap-price-gap-one-1024th, F05-expensive-legal-offer-exceeds-cap, F09-barter-lot-is-bought-whole, F13-budget-deficit-cap-equals-spend, F13-budget-deficit-cap-one-below, F13-reduction-counterexample-multi-copy-capacity, F13-reduction-counterexample-owned-offset | 45 |
| MIN_ERGONOMICS_NOT_MET | 4 (3) | F04-min-ergonomics-cap-boundary, F04-min-ergonomics-compares-the-pre-gear-value, F04-near-cap-min-ergonomics-gap-2e-20 | 5 |
| MAX_RECOIL_V_EXCEEDED | 5 (3) | F04-recoil-cap-zero-naked-recoil-is-not-dropped, F04-recoil-final-cap-vertical, F04-recoil-final-caps-combined | 5 |
| MAX_RECOIL_SUM_EXCEEDED | 3 (2) | F04-recoil-final-cap-sum, F04-recoil-final-caps-combined | 3 |
| MIN_MAGAZINE_NOT_MET | 3 (2) | F04-magazine-boundary, F04-magazine-capacity-is-max-not-sum | 6 |
| MIN_SIGHTING_NOT_MET | 2 (1) | F04-sighting-boundary | 2 |
| MAX_WEIGHT_EXCEEDED | 6 (5) | F04-max-weight-cap-boundary, F12-max-weight-singleton-interval, F12-near-cap-weight-one-ulp-over-cap, F14-fractional-weight-0155, F14-negative-weight-meets-weight-cap | 7 |
| MAX_MOA_EXCEEDED | 15 (9) | F08-constant-moa-exceeds-cap, F08-high-divergence-linear-model, F08-missing-and-nonpositive-coi-fall-back, F08-negative-suppressor, F08-optional-barrel-fallback, F08-required-barrel-slot-fallback-via-missing-coi, F08-signed-accuracy, F08-zero-intrinsic-coi-cap-zero, F08-zero-intrinsic-coi-receiver | 17 |
| OVERSWING_PREVENTED | 6 (4) | F12-prevent-overswing-boundary, F12-prevent-overswing-narrow-interval, F12-prevent-overswing-singleton-at-three-kg, F12-prevent-overswing-uses-gear-effective-ergonomics | 6 |

Mutation counts per code (Stage 2 test (c)): every one of the 29 reference codes is exercised; the smallest count is SELF_CONFLICT_COPY_CAP x127.

## 3.6b Determinism

`tests/solver/determinism.test.ts`:

| Check | Population | Result |
| :--- | :--- | :--- |
| Repeated runs | Every ledger case, Precise and Fast: a fresh state (a newly mapped lookup), the same lookup again (warm blueprint and model memoization), a second fresh state | All 298 case-mode pairs give a bit-identical response on all three runs: status, certificate, reason, qualifiers, preset, installed multiset, placements, objective, optimization metadata, final stats, ideal point |
| Second-opinion seeds | 127 certified Precise ledger answers, with the seeds `(0, 11, 29)` permuted to `(11, 29, 0)` and `(29, 0, 11)` | Status, certificate and certified score unchanged in 250 of 254 runs. In 10, a tie or a gap below the tolerance picked another maximizer, with the same certified score. In 16, the same parts were placed in another legal tree. Every single maximizer resolvable at the tolerance kept its projection. **4 runs lost the certificate (observation O2):** F01-legal-alternative-placement and F13-reduction-counterexample-multi-copy-capacity, both at the 1e-9 runtime tolerance, under both permutations. Seed 29 returns a bound 1e-7 high (13.0000001 against 13, 2.0000001 against 2). The second opinion keeps the largest qualified bound of all its solves, so the gap exceeds 1e-9 and the answer becomes `feasible` with `Required proof prerequisite unavailable`, with the same build. This is decision 5b's accepted cost: a lost certificate, never a wrong one. Production's fixed seed order certifies both. The test pins exactly these two cases. |
| Pinned guns, repeated runs (worker runtime) | MP5, SR-25, M4A1 plain Precise; MP5 TrueErgo; MP5 Sweet Spot; MP5 Fast. A fresh runtime on a newly built lookup, the same runtime again (warm data, compatibility map, blueprint and endpoint cache), a second fresh runtime | All identical. Sweet Spot: endpoint cache `miss`, then `hit` with the identical response. Results: MP5 452 (11 parts), SR-25 627 (17), M4A1 648.5 (17), MP5 TrueErgo 445.688 (7), all `certified_optimal`; MP5 Fast `approximate_optimal` 452 |
| Pinned guns, seeds | The four Precise requests, under both permutations | Every certificate, status and certified score unchanged. The MP5 TrueErgo build is identical. Plain MP5 (one permutation), SR-25 and M4A1 pick another maximizer with an equal certified score; with price weight 0, these guns have many equal-score parts. |

## Verification

Run in `frontend/` on the worktree tip `757bc7d` plus the uncommitted files of the parallel workstreams; see the final report for the counts.
