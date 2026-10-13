# Stage 3 verdict

Refs #40. Branch `impl/stage2-correctness-cutover`, checked at `b7a6f92`. Local only: nothing is pushed, merged or released.

**Verdict: ADOPT** the corrected baseline (Stage 2 plus the Stage 3 fixes) as the solver of record. Every ADR 0013 §7 obligation passes on its
stated scope, under the assumptions listed below. Publishing it (post to #40, push, PR, release) needs the owner's go-ahead.

## Final checks at `b7a6f92`

- `tsc --noEmit` clean on all five configs (app, node, reference, tests, benchmarks).
- `npm run lint` clean. `npm run build` ok; `dist/` ships the pinned `highs.js`, `highs.wasm` and manifest.
- `npm run test:unit`: 1,052 tests, 1,050 pass, 0 fail, 2 skipped (opt-in scale runs).
- `npm run test:reference`: 745 of 745 pass.
- Ledger baseline: every acyclic case passes, except 7 `precise.outcomeContract` cells that report feasible instead of certified at the 1e-9
  runtime tolerance (decision 5b, owner-approved; each still returns the exact optimum). The 5 cyclic cases are out of scope (decision 2d).

## Obligations (ADR 0013 §7)

| # | Obligation | Evidence | Result |
| :--- | :--- | :--- | :--- |
| 1 | Gates A/B/C on production Precise | `reference/harness/countGates*` (`a3bca8b`, updated `242b936`, `a19041c`). 144 acyclic ledger cases and 2,171 seeded worlds: same feasible builds, same maximum, every tied maximizer reached, empty together. Only differences are the known 1e-7 precision cells | PASS |
| 1b | Domain-wide lifting/projection proof | `docs/proofs/count-model.md` (Theorems E and S, Revision 1). Independent review `docs/proofs/count-model.review.md`: no counterexample; its gaps fixed in code or text (`4d283a6`) | PASS |
| 2 | Fast contract: every published witness validates, every label is truthful | `tests/physical/fastContract*`, `benchmarks/stage3-fast/summary.md` (`4f4a094`). Ledger, worlds, 172 guns in 4 profiles: no invalid build, no certificate claimed. Fast matched the certified optimum on all 153 guns that have one | PASS |
| 3 | Native, parser and numerical evidence | `docs/stage3/native-evidence.md` (`ac40381` and later rows). Readback of 100 production LP texts, full-precision values, filtering and wide-price sweeps, finite domains, limit stops, bound error, second opinion, pinned loader only | PASS |
| 4 | Operations: deadline, cancel, queue, withheld, invalid, validation | `docs/stage3/operations-evidence.md`, `tests/runtime/operationsMatrix*` (`f6acab1`). Every operation × cause cell passes. D1 (lost witness on a guard stop) fixed in Precise (`242b936`) and Fast (`a19041c`) | PASS |
| 5 | Reference vs production validator agreement | `reference/harness/validator*` and `validatorLedgerBuilds.differential.test.ts`. Every ledger build and every rejection code, including production's publishing settings: 0 disagreements | PASS |
| 6 | Expanded type checking; deterministic regressions | Five checked tsconfigs (Phase 2.9). `tests/solver/determinism.test.ts`: identical responses on fresh and warm runtimes. Reordering the seeds only costs the two 1e-9 certificates decision 5b accepts; production's order is fixed | PASS |
| 7 | MOA floor measurement at 30 s, ≤ 14 solves | `docs/stage3/floor-measurement.md`, `benchmarks/stage3-floor/` (`e820943`, after-fix numbers `4d283a6`). 13 frozen cases plus 4 addendum: every proved floor in 6–9 trials and under 5.6 s; every witness validates. F1 (Prevent Overswing floors stopped after 2 trials) and F2 (stop label) fixed | DONE (characterization) |
| 8 | Browser smoke | `docs/stage3/browser-smoke.md` (`f67d26e`, `b7a6f92`). Dev server and production build: Optimize (Auto, Precise, Fast), Explore, Gunsmith, copy, EFTForge link, floor, Advanced menu, cancel with nullable status, English. 11 of 11 pass | PASS |

## Fixes made during Stage 3

| Commit | Fix | Decided by |
| :--- | :--- | :--- |
| `6a91104` | Native solve qualifies only at integrality exactly 1e-7 | owner (O2) |
| `242b936` | SolveError retries other seeds instead of throwing; integer Infeasible needs the relaxation to agree; Precise D1 | owner |
| `a19041c` | All cyclic-graph handling removed; one internal blueprint guard; Fast D1 | owner |
| `4d283a6` | Split-only nodes skip the second opinion (F1); real floor stop label (F2); only checked bounds are published (G1); a found point blocks infeasibility (G2); read-through scaling asserted | owner |
| `b7a6f92` | Explore coverage and approximate-result wording | smoke notes |

Production measurement after all fixes (172 pinned guns, 60 s): plain 153 certified optimal and 19 certified infeasible; TrueErgo the same.
Scores and solve counts are unchanged from Phase 2.10.

## Assumptions the certificates rest on

From `docs/proofs/count-model.md` §9:

- **A0:** the gun is in the declared domain: acyclic reachable part graph, no slot-id collision, well-formed presets, under the occurrence limit.
- **A-DATA:** production's data matches the oracle's domain (checked by the bridge and the ledger, not proved).
- **A-VAL:** the production validator agrees with the oracle on path-derived builds without claims (checked by 3.6, not proved).
- **A-ARITH, A-PARSE:** exact rationals and the directed rounding helpers behave as specified; the strict LP reader and readback decide model
  equality.
- **Native A1–A4:** a qualified dual bound bounds the parsed model, up to decision 4's arithmetic noise and decision 5b's two-sided 1e-7 shift;
  feasibility tolerances never enter a bound; two agreeing seeds are not wrong the same way; a relaxation settled Infeasible is infeasible. HiGHS's
  own correctness is not proved.

## Open items (not blocking)

- **O1:** a matrix coefficient ≥ 1e15 makes HiGHS refuse the model, and Precise throws `ModelReadError` instead of returning a withheld result.
  Real data peaks at about 2.2e7.
- **Completeness (G3):** certificates can be missed (exact-cap boundary within padding, cuts that break total unimodularity, the 16-rejection
  limit per node, all six seeds inconclusive). These end as uncertified results, never as wrong ones.
- **Floor worst case:** no case came near the 30 s budget; a deadline-spending case was not found and would need a predeclared search.
- **Slow requests:** Precise with TrueErgo takes up to about 55 s on the largest guns. Auto sends those to Fast (rule: plain → Precise; TrueErgo or
  Prevent Overswing → Precise up to 3,000 candidate edges).
- **Cosmetic:** a recharts size warning on the first chart render.

## Pending owner decisions

1. Post this verdict and the ADR amendment (`docs/adr/amendments/2026-10-12-acyclic-precondition.md`) to #40.
2. Push `impl/stage2-correctness-cutover` (35 commits since `690edb8`, plus the earlier Stage 2 history).
3. Release shape: CLAUDE.md treats a solver engine change as a MAJOR version (v3.0.0); whether to open a PR to master.

A changelog draft is in `docs/stage3/changelog-draft.md`. It goes into `CHANGELOG.md` only as part of the release.
