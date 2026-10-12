# Stage 3 plan: prove the unreduced cutover

Refs #40. Normative source: ADR 0013 §2 (Stage 3 row) and §7, ADR 0010 §3, and the owner decisions in
`docs/stage2-plan.md` (2b–2e, 4, 5, 5a, 5b, the performance policy). Branch `impl/stage2-correctness-cutover`
(Stage 2 tip `4da0767`). **Private:** Stage 3 proves or withholds the corrected baseline; it merges, pushes, releases and
deploys nothing. Adoption (merge to master, version, release) is a separate owner decision after the verdict.

## What Stage 3 must deliver (ADR 0013 §7)

1. Finite-fixture Gates A/B/C on **production Precise**, plus a domain-wide lifting/projection proof.
2. The Fast contract: every published Fast witness validates; every qualification is truthful.
3. Native, parser and numerical evidence.
4. Operation regressions (deadline, cancel, queue, withheld, invalid, validation; floor; Explore).
5. Full ledger agreement between the reference and production validators.
6. Expanded type checking and deterministic behavioural regressions.
7. MOA floor measurement at the default 30 s budget and at most 14 threshold solves.
8. Actual browser smoke: Optimize, Explore, Gunsmith, manifest and export, nullable status, floor. Docs and changelog
   follow the smoke.

The result is a verdict: **adopt** the corrected baseline, or **withhold** it with the failing obligations named.

## Starting point (what Stage 2 already gives)

- The ledger harness runs production end to end on every case, both modes, with a ratchet baseline. Every case passes
  except the owner-approved scope: 5 cyclic cases out of scope (amended 2d: not run, every dimension `n/a`) and 7 cases
  certified → feasible at the 1e-9 runtime tolerance (5b).
- `reference/harness/validator.differential.test.ts` compares the two validators on the ledger.
- **Gap:** the formal Gates A/B/C (`reference/harness/lpGates.differential.ts`) still build the **occurrence model**
  (`tests/physical/occurrence/specializeOccurrence.ts`), which left production in Phase 2.10. Production Precise is the
  certified count model (`specializeCount.ts`). The gates must be retargeted; their header also still names the retired
  npm `highs` package.
- The count model's exactness argument exists as research (`docs/research/acyclic-fast-exactness.md` §3–5, 9), written
  for Fast; it is not yet a proof of the certified Precise model with all its rows.
- Runtime, floor and Explore have unit tests from Phase 2.7; nothing has been measured in a browser since Phase 2.8b.

## Workstreams

| # | Workstream | Deliverable | Depends on |
| :--- | :--- | :--- | :--- |
| 3.1 | Gates on production Precise | Retarget `lpGates` to `specializeCount` (certified mode, MOA rows, relaxed-first off and on). Gate A: every oracle feasible projection is model-feasible when pinned, and decoded projections under several objective directions are oracle-feasible and validator-accepted. Gate B: equal exact maximum, and EVERY oracle maximizer projection attainable at the maximum (pinning is the complete equivalent method of §7). Gate C: empty together. TED cases on singleton weight nodes, as today. All ledger fixtures in scope plus seeded worlds; the 5 cyclic cases and cyclic seeded worlds are out of scope (amended 2d), with no refusal check. The occurrence-model gates stay as a cross-check | Stage 2 |
| 3.2 | Domain-wide proof | `docs/proofs/count-model.md`: the lifting/projection proof for certified Precise on the declared domain (acyclic reachable part graph): Lemma 1, slot capacity, parent activation, required slots, rootedness, template and self conflicts, quantities and acquisition (presets, barters, stash, supply caps, deficit surrogate), domain filters, MOA larger-COI rows, the TED secant bounds, outward rounding of every row. States its assumptions (decisions 4 and 5b). Reviewed adversarially by a second, independent agent; findings resolved or recorded | 3.1 informs it |
| 3.3 | Native and numerical evidence | One evidence test file per item: readback of rows, bounds, objective, integrality and coefficients; structured-primal precision; small coefficients and very wide price normalization (filtering detected or withheld); finite auxiliary domains; completed and limit-stopped native runs; the bound-error statement under decisions 4/5b; the second-opinion paths (agree, tie-break, unsettled, timeout). Mostly existing tests, gathered and gap-filled | Stage 2 |
| 3.4 | Fast contract | Every published Fast witness validated in the physical domain on the ledger, seeded worlds and all 172 pinned guns (plain, TrueErgo, single copy and repeats); every Fast outcome carries `approximate` and never a certificate | Stage 2 |
| 3.5 | Operations | Transition matrix test: deadline, cancel (queued and running), queue expiry, withheld bound, invalid stash, invalid schedule, validation failure, in every operation (Optimize, Gunsmith, Explore, floor, metadata); ADR §6 precedence asserted for each pair. Full floor and Explore classification cases | Stage 2 |
| 3.6 | Validator agreement and regressions | Confirm the reference-versus-production validator agreement covers every ledger rejection code; deterministic regressions (same request → same build and status across runs and seeds where a certificate is issued) | Stage 2 |
| 3.7 | MOA floor measurement | Predeclared real-weapon cases, frozen identities (snapshot SHA, toolchain manifest, request JSON, cache state): large platforms (M4A1, AK-74N, AKM, NL545 DI) and smaller controls (MP5, SR-25, M870, a pistol), plus a hard infeasible/no-witness case and a nonlinear rejected-candidate case. Report per §7: native stop options, denominators, seed time, every discovery/bisection call with stop code, trial count, latency, status rates, achieved hi and bracket gap, stop causes, validation. Characterizes usability only; any policy change is a separate owner decision | 3.5 |
| 3.8 | Browser smoke | On the dev server and on the production build (`vite preview`): Optimize (Fast, Precise, Auto; plain and TrueErgo), Explore, Gunsmith, manifest and EFTForge export, nullable status displays, floor, cancel, Advanced menu, two locales. Screenshots and console logs attached to the report | 3.1–3.7 green |
| 3.9 | Verdict and docs | `docs/stage3-verdict.md`: each §7 obligation with its evidence link and PASS / FAIL / WITHHELD; then CHANGELOG draft entry and MethodologyModal/doc text updated after the smoke | all |

## Order and parallelism

- First wave in parallel (disjoint files): **3.1** (reference harness), **3.3** (tests/native, tests/physical evidence),
  **3.4** (tests/research or benchmarks), **3.5 + 3.6** (tests/runtime, tests/solver).
- **3.2** starts with 3.1 and finishes after it; the adversarial review is a separate agent that has not written the proof.
- **3.7** after 3.5; it runs long, sharded across cores with progress files.
- **3.8** by the orchestrator in the built-in browser, after everything else is green.
- **3.9** last.

Each workstream is a subagent with disjoint files, verified and committed locally by the orchestrator (tsc on every
config, unit, reference, build, lint, baseline unchanged unless an owner-approved cell).

## Rules carried over

- The Stage 1 oracle and ledger expectations are never edited to make production pass. A real discrepancy is a Stage 2
  bug: fix it in production with a regression test, or record it for the owner.
- Presolve stays off; integrality 1e-7, primal/dual 1e-9; the second opinion stays on for every certificate.
- No push, PR, #40 post or release without explicit owner approval. Lab SSH hosts are never used.

## Open owner questions (not blocking the first wave)

1. **Decided (owner, 2026-10-12):** the ADR amendment (`docs/adr/amendments/2026-10-12-acyclic-precondition.md`) is
   posted to #40 together with the Stage 3 verdict and the push of Stages 2 and 3, so every commit it cites resolves.
   Until then the repo draft is the working authority; 3.2's proof cites it and may amend it.
2. After an **adopt** verdict: the release shape (a MAJOR version per CLAUDE.md's rule for solver changes, e.g. v3.0.0,
   and whether to open a PR to master) is decided then, not now.
