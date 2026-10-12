# Stage 3, workstream 3.3: native, parser and numerical evidence

Evidence index for the native and numerical obligations of ADR 0013 section 4B ("pinned native build, full precision and
parser verification"), section 4C (finite domains, bound error) and section 7 ("parser/readback and structured-primal
precision; finite auxiliary and bound-error proof; completed and limit native cases"), under the owner decisions in
`docs/stage2-plan.md`: 4 (native arithmetic noise is a stated assumption), 5 (no claim from a presolved solve), 5a (second
opinion on every certificate) and 5b (integrality 1e-7, primal and dual 1e-9; corrected 2026-10-12: the integrality shift is
two-sided, accepted as a stated assumption).

Branch `impl/stage2-correctness-cutover` at `757bc7d`, pinned HiGHS 1.15.1 (githash `04024d701f79`), pinned capture
`frontend/benchmarks/snapshot.json` (SHA-256 `219443b4…`). Every path below is relative to `frontend/`. Tests that read the
capture skip, with a reason, when it is not restored.

New files of this workstream: `tests/physical/evidence.{readback,primals,filtering,finiteDomains,limits,boundError}.test.ts`
and the shared loader `tests/native/evidence/pinned.ts`. Everything else cited existed before.

## Summary

| # | Obligation | Verdict |
|---|---|---|
| 1 | Emitted LP equals what HiGHS parsed (rows, bounds, objective, integrality, coefficients) on the production count model, certified Precise and Fast, relaxed-first text too, real guns and seeded worlds | PASS |
| 2 | Full-precision primals and dual bound from the native structure, no text round trip | PASS |
| 3 | Small coefficients and very wide price normalization: filtering detected or proof withheld, never silently wrong | PASS (one observation, O1) |
| 4 | Finite auxiliary domains in the count model | PASS |
| 5 | Completed vs limit-stopped native runs | PASS |
| 6 | Bound-error statement (`NATIVE_FRAME.assumptions`, `boundShortfall`, `BOUND_SANITY_RELATIVE`, per-tolerance qualification, defect fixture) | PASS (one observation, O2, recorded as a `todo` test) |
| 7 | Second-opinion paths | PASS (existing tests) |
| 8 | Pinned loader only, no stock HiGHS | PASS (existing tests) |

No production defect was found that makes a published certificate or bound wrong. Two observations for the owner are listed
at the end.

## 1. Parser/readback verification on the pinned build

Obligation (4B): verify emitted versus parsed model on the pinned build, including rows, bounds, objective, integrality and
coefficients; input round-trip text alone is insufficient.

| Test | What it asserts |
|---|---|
| `tests/physical/evidence.readback.test.ts` "item 1, real guns: …" (new) | MP5, both `SR-25` entries of the capture, AK-74N and M4A1, five requests each (weighted, Tchebycheff, MOA and caps, TrueErgo on a weight node, Prevent Overswing on a node). For each: the certified count model's `lp()` and relaxed-first `lpRelaxedEdges()`, and the plain Fast model's `lp()` and `lpRelaxedEdges()`. `compareReadback(parseLpText(text), HiGHS readback)` is bit-exact with no difference and nothing filtered; independent counts (columns, rows, nonzeros, integer columns, objective entries, sense) agree on both sides and every coefficient was compared. Each certified text also passes `assessNativeResult` (qualified: readback equal, every padded row dominating its exact need, presolve off, declared tolerances). Measured: 50 certified + 50 Fast texts, 125,962 rows, 337,330 columns and 900,156 coefficients compared, 24 s. |
| same file, "item 1, seeded worlds: …" (new) | The same four texts on `randomWorld(seed)` and `randomTedWorld(seed)`, seeds 1 to 40 (56 worlds with a certified text; TED worlds on a weight node). |
| same file, "item 1, production path: …" (new) | Production `solvePrecise` on 30 seeded worlds: `telemetry.readbackChecks === telemetry.nativeSolves` (every native solve, second opinions and relaxed-edge tries included, was compared with its text) and `unqualifiedSolves === 0` (62 solves). |
| `tests/physical/countModel.pinned.test.ts` "real guns: HiGHS reads the certified model of M4A1, AK-74N and MP5 back exactly…" | Certified `lp()` of three guns under seven requests (incl. a stash): qualified, zero differences, zero filtered, allowances checked = proof rows. |
| `tests/physical/countModel.pinned.test.ts` "all 172 guns: …" | Every nonempty default domain (153) builds a certified model with nothing withheld and every coefficient strictly inside (1e-9, 1e15). |
| `tests/physical/specializeCount.test.ts` "the certified text is strict and HiGHS reads back exactly what it states: weighted, Tchebycheff, a TED node, with cuts and with continuous slot edges" | Readback of `lp()`, `lpRelaxedEdges()` and `lp([cut])` on a fixture that touches every constructed row family. |
| `tests/physical/specializeFast.test.ts` "real guns: the Fast text … round-trips through the parser and HiGHS" | Fast `lp()` of MP5, M4A1, AK-74N under six requests. |
| `tests/native/readback.test.ts` (15 tests) | The readback API itself: rows, bounds, objective, integrality, coefficients, offsets and fixed rows; filtered coefficients detected; bit-exact comparison by default; 12 seeded random mixed models against the independent parser; HiGHS silently reading `Maximise` as minimization caught; the legacy AK-74 model's `x_-1` caught. |
| `tests/physical/nativeProof.test.ts`, `tests/physical/countModel.proof.test.ts`, `tests/physical/solvePrecise.proof.test.ts` | The per-solve gate: a tampered readback, a missing readback, a read warning, a parsed right-hand side that does not dominate its need, or a text outside the strict subset makes the solve unqualified; an infeasibility verdict from such a solve is not emptiness. |

Verdict: **PASS**.

## 2. Structured full-precision primals

Obligation (4B): structured status, primal objective, full-precision column values and the native MIP dual bound are
exported before the handle is destroyed; pretty text and rounded logs are diagnostics only.

| Test | What it asserts |
|---|---|
| `tests/physical/evidence.primals.test.ts` "item 2, native: …" (new) | A mixed-integer model whose optimum has no short decimal form: column values arrive as a `Float64Array`, the continuous value is the exact double of its bound, the objective is within 4 ulp of the exact value, the MIP dual bound is at least the incumbent and within 1e-9 of it. `toFixed(6)` would move each by more than 1e-7, and the text-read dual bound would fall below the incumbent it bounds. `mipAbsoluteGap` is computed from the two structured values. |
| same file, "item 2, production: Precise certifies at 1e-9 from structured values…" (new) | A part with 0.123456789 ergonomics: certified at tolerance 1e-9, score equal to the exact value within 1e-15; the published bound and score carry digits a six-decimal reading would move past the tolerance (with text values this certificate could not exist); every solve the pipeline consumed had a `Float64Array` and a full-precision dual bound; the published bound is at least the largest structured dual bound. |
| same file, "item 2, production: the pipeline never reads the printed solution…" (new) | A garbled HiGHS log changes nothing (same score, same bounds); replacing only the structured dual bound by its six-decimal reading costs the certificate at 1e-9 and never publishes a bound below the witness. |
| `tests/native/solve.test.ts` "a primal column value is the exact double, not the six-digit pretty-print", "the objective value is the full-precision optimum", "a MIP reports dual bound, relative gap and node count; an LP reports null with a reason" | The native API contract. |
| `tests/physical/lpText.test.ts` "numbers are written with the shortest round-trip digits, never rounded"; `tests/physical/specializeCount.test.ts` "a certified LP never carries a legacy remnant: … no rounded coefficient …" | The emitting side: no `toFixed`, shortest round-trip digits. |

Verdict: **PASS**.

## 3. Small coefficients and very wide price normalization

Obligation (4B): set and document small/large matrix filtering explicitly; detect filtering, apply only proved legal
rescaling, or withhold proof. Stage 3 checks small coefficients and very wide price normalization.

Every point of every sweep below is checked for the dichotomy: **exact** (certified, the true optimum, the bound at least
the true optimum) or **withheld/uncertified** (no certificate; a published bound still at least the true optimum).

| Test | What it asserts (observed outcome) |
|---|---|
| `tests/physical/evidence.filtering.test.ts` "item 3, small coefficients: …" (new) | A recoil modifier swept over 1e-11, 1e-10, `nextDown(1e-9)`, 1e-9, `nextUp(1e-9)`, 2e-9, 1e-8, 1e-7, 1e-6 with the weight scaled so the true optimum is always part `a`, score 1. At or below `small_matrix_value` (1e-9) the bound is withheld (null), the request is not certified, and the reason names the adjusted/different model; the model's a-priori `matrixFilterRisk` flag is set. Strictly above 1e-9 the request certifies the exact optimum with no unqualified solve. Observed: withheld for the first four values, exact for the rest. |
| same file, "item 3, very wide Tchebycheff price normalization …" (new) | Nadir price 1e4 to 1e30. Up to 1e14 the price axis is read through an exact power-of-two scale and the true optimum (closed-form oracle score) is certified; from 1e16 the model withholds its proof at construction (no legal scale up to 2^40), the bound travels as null, and the reason is reported. |
| same file, "item 3, very wide price range in the matrix …" (new) | A part priced 1e6, 1e9, 1e12, 1e14 and `nextDown(1e15)`: the cheaper part is always the verified build; 1e6 and 1e9 certify exactly; 1e12, 1e14 and just below 1e15 end uncertified with a valid bound. At 1e12 one solve's dual bound sat 3.0e-9 below the exact score of its own build (about 3e-8 relative, far above decision 4's 1e-15 noise); the shortfall guard withheld that bound. |
| same file, "item 3, at large_matrix_value …" (new) | A coefficient of 1e15 or 1e16 is flagged by `matrixFilterRisk`, HiGHS refuses the read, and `solvePrecise` rejects with a typed `ModelReadError` (see O1). |
| `tests/native/readback.test.ts` "a coefficient below small_matrix_value is dropped by default and the readback comparison detects it", "… survives when small_matrix_value is lowered explicitly …", "filtering also changes the solve …", "a bound at or above infinite_bound …", "a coefficient at or above large_matrix_value fails the read with a typed error …" | Filter behavior of the pinned build, explicit options (`DEFAULT_HIGHS_OPTIONS` pins 1e-9, 1e15, 1e20). |
| `tests/physical/countModel.proof.test.ts` and `tests/physical/solvePrecise.proof.test.ts`: "a filtered coefficient: …", "a wide Tchebycheff price normalization is rescaled by an exact power of two and certified …", "when no legal power-of-two rescaling exists the proof is withheld …" | End to end on the count model and on the test-only occurrence model. |
| `tests/physical/proof.rows.test.ts` "an axis scale is an exact power of two …"; `tests/physical/specialize.objective.test.ts` "a very wide price normalization …", "an axis no power of two up to 2^40 can bring into range …", "a tiny price weight of a WEIGHTED request is scaled the same way …" | The rescaling rule in isolation. |

Verdict: **PASS**. Filtering is never silent: below the small filter it is detected by the readback and withheld; above the
large filter the read fails loudly.

## 4. Finite auxiliary domains

Obligation (4C): give every auxiliary with nonzero error a finite proved range; no unproved free auxiliary range.

| Test | What it asserts |
|---|---|
| `tests/physical/evidence.finiteDomains.test.ts` "item 4, all 153 nonempty pinned guns: …" (new) | Every column of the certified model (and of its relaxed-first text) of every nonempty pinned gun has finite lower and upper bounds, lower at most upper, and magnitude below HiGHS's `infinite_bound` (1e20) so the read cannot turn it infinite. 242,504 columns, 7 s. |
| same file, "item 4, MP5, both SR-25s, AK-74N and M4A1 under requests that add every auxiliary family …" (new) | Tchebycheff deviations (`tch_t`), caps and MOA (`acc_total`), TED node with gear, second clamp and penalty line (`gear_ergo`, `eff_ergo`, `ted`, `c2_*`, `weight`), price and recoil axes: 20 models, 67,496 columns, all finite. |
| same file, "item 4, 60 plain and 60 TED seeded worlds …" (new) | The same on seeded worlds, at the root and on a TED node. |
| `tests/physical/specializeCount.test.ts` "a certified LP never carries a legacy remnant: … every auxiliary column is finite" | Fixture check. |
| `tests/physical/specializeFast.ted.test.ts` "every auxiliary column of a TED node has a finite domain that encloses its values, and the line cannot leave the TED range" | Enclosure, not only finiteness, on a TED node. |
| `tests/physical/lpText.test.ts` "the writer refuses an empty, duplicated or undeclared row and an infinite or empty domain" | The writer cannot emit an infinite domain. |

Verdict: **PASS**.

## 5. Completed and limit-stopped native runs

Obligation (4B, 7): completed and limited native cases; a limit stop is never a certificate and is reported with its reason.

| Test | What it asserts |
|---|---|
| `tests/physical/evidence.limits.test.ts` "item 5, native: …" (new) | On the pinned build: `mip_max_nodes = 0` stops with `SolutionLimit` (code 16), an infinite dual bound and no primal; `time_limit` stops with `TimeLimit` (13); `mip_max_improving_sols = 1` stops with `SolutionLimit` and keeps a valid bound; the same model without limits is `Optimal`. |
| same file, "item 5, Precise on a fixture: …" (new) | Production Precise, relaxed-first and integer edges: the completed run certifies (`certified_optimal`, termination `optimal`, `completed`); `nativeStop: { mip_max_improving_sols: 1 }`, a forced node limit and a forced time limit each end with no certificate, status not `optimal`, the stop's reason (`Native solution limit reached` / `Time limit reached`), termination `limit`, `completed` false, and any published bound at least the completed optimum. |
| same file, "item 5, Precise on real pinned guns (MP5, SR-25): …" (new) | The same matrix on two real guns. On MP5 HiGHS proves the first improving solution optimal at the root, so every solve reports `Optimal` even with `mip_max_improving_sols = 1`: that run completed and its certificate is legitimate (same optimum); the test checks the native statuses before deciding which rule applies. |
| same file, "item 5, Fast: …" (new) | Fast is never certified even when completed; a time or solution limit is reported with its reason, termination `limit`, `optimal` false. |
| `tests/native/solve.test.ts` "time limit: status 13 (TimeLimit) …", "mip_max_improving_sols=1 stops with SolutionLimit (not Optimal) …" | Native contract. |
| `tests/physical/nativeSolve.test.ts` "a limit stop is not an infeasibility verdict …", "a confirmation that times out … leaves the verdict unresolved, never infeasible", "no time left …" | The presolve/confirmation policy on limits. |
| `tests/physical/solvePrecise.test.ts` "a node limit keeps the verified incumbent, reports the factual reason and leaves the unproved bound unknown; zero nodes is incomplete", "a deadline that has passed starts nothing …" | Spatial node limit and deadline. |

Note: HiGHS reports a native node limit as `SolutionLimit`, so its public reason is `Native solution limit reached`.
Production never sets a node limit (`nativeStop` admits only `mip_max_improving_sols`).

Verdict: **PASS**.

## 6. Bound-error statement

Obligation (4C, decisions 4 and 5b): native UB correction only for a qualified bound with proved frame error; what is
assumed is stated; the noise is measured and an implausible shortfall withholds the bound; tolerances are qualified.

| Test | What it asserts |
|---|---|
| `tests/physical/evidence.boundError.test.ts` "item 6, the stated frame: …" (new) | `NATIVE_FRAME` holds primal 1e-9, dual 1e-9, integrality 1e-7, small 1e-9, large 1e15; `BOUND_SANITY_RELATIVE` is 1e-9; `NATIVE_FRAME.assumptions` states that no allowance is added (decision 4), names `boundShortfall` and `BOUND_SANITY_RELATIVE`, states the two-sided integrality shift ("EITHER direction"), that a lowered bound no build exposes is "not detected", cites F04-near-cap-min-ergonomics-gap-2e-20, and states the second opinion. `nativeSolveOptions(tau)` gives integrality 1e-7 and feasibility 1e-9 for every tau from 0 to 1, native gap at most min(1e-9, tau/4). |
| same file, "item 6, per-tolerance qualification on the certified count model: …" (new) | Each tolerance against its own declared value on a count model with constructed rows: production frame, integrality 1e-7 and 1e-8, primal 1e-10 qualify; integrality 2e-7 and 1e-6, primal 1e-8 (the integrality value is not a feasibility allowance), dual 1e-8 and 1e-7, a changed `small_matrix_value` or `large_matrix_value` do not, each with the tolerance/threshold reason, while the readback itself stays equal. |
| same file, "item 6, the shortfall guard at its limit …" (new) | Production Precise with every dual bound lowered by 0.8 and 1.5 times `max(tolerance, 1e-9 x max(1, |bound|))`, in three regimes (bound 25 at tolerance 1e-9: absolute floor 2.5e-8; bound 2,500: relative 2.5e-6; tolerance 1e-5 dominating). Inside: the shortfall is measured in `boundShortfall`, the bound is kept, no solve is unqualified, and the request certifies, which is the accepted residual assumption made concrete; the transported upper bound still never shows below the witness. Outside: the verified witness is kept, the bound is withheld (null), not certified, the reason is reported and the shortfall equals the injected one. |
| same file, "item 6, two-sided integrality shift, upward side: …" (new) | A bound raised by 1e-7 costs the certificate at tolerance 1e-9 (status `feasible`, gap between 1e-9 and 2e-7, bound at least the witness) and keeps it at 1e-5. |
| same file, "item 6, the defect fixture count_presolve_off_wrong_optimal.lp under the production frame: …" (new) | On `tests/physical/solverDefects/count_presolve_off_wrong_optimal.lp`, every production seed (0, 11, 29) at the production options returns the true optimum 100 with a dual bound at least 100; the solve is qualified and its bound evidence encloses the truth. Diagnostic: at integrality 1e-9 the default seed still returns the wrong `Optimal` 93.6 with dual bound 93.6, and the gate calls that solve qualified (O2). A spy on `solvePrecise` at tolerances 1e-9, 1e-5 and 1e-2 (TrueErgo) shows every native solve ran at integrality exactly 1e-7. |
| same file, "item 6, the matrix thresholds production declares are the ones HiGHS holds on every solve" (new) | `effectiveOptions` of a production solve carry `small_matrix_value` 1e-9 and `large_matrix_value` 1e15. |
| same file, "item 6, defence in depth …" (new, `todo`) | Records O2 as an expected-to-fail test: a solve at integrality 1e-9 is currently qualified. |
| `tests/physical/countModel.proof.test.ts` and `tests/physical/solvePrecise.proof.test.ts` "a bound that falls far below a build verified in its own node is withheld as a wrong bound; a few ulps of solver noise only count in boundShortfall" | The guard end to end (1e-13 kept, 1 withheld). |
| `tests/physical/solvePrecise.proof.test.ts` "the reported bounds enclose the exact optimum: lower is a downward enclosure of the verified score, upper at least it, and the gap is the exact gap" | LB/UB enclosure (4C). |
| `tests/physical/proof.rows.test.ts` "a node bound is the qualified native bound plus the frame error, exactly: unqualified, missing or non-finite evidence is unknown, never a finite guess" | UB = qualified native bound + proved frame error, exact. |
| `tests/physical/nativeProof.test.ts` "a solve without a readback, with a read warning, with loosened native tolerances or with a withheld model proof is unqualified, each for its own reason", "a solve with presolve ON is a witness at most …" | Decision 5 and the tolerance check (primal). |
| `tests/physical/solverDefects.test.ts` "the COUNT model node [1.5, 3] of TED world 2105 (count_presolve_off_wrong_optimal.lp): …" | The defect fixture: pinned to the true build it scores 100; at 1e-7 every production seed is right. |

Verdict: **PASS** for the obligation as decided by the owner. O2 is a defence-in-depth gap, not a live defect.

## 7. Second-opinion paths

Obligation (decision 5a): a second seed on every certificate-bearing verdict; a third on disagreement; certificate needs two
agreeing solves; a timeout or unqualified solve withholds; infeasibility needs two verdicts and no verified build.

| Path | Test (`tests/physical/solvePrecise.secondOpinion.test.ts` unless noted) |
|---|---|
| Agree | "agreement: two Infeasible verdicts, or two Optimal bounds within the tolerance; never a solve that proved nothing"; "the same lie on the third seed only: the first two agree, no third solve is spent"; `tests/physical/countModel.pinned.test.ts` "guns the occurrence model can still prove: …" (`disagreements === 0` on real guns) |
| Disagree, third seed settles (certified) | "a wrong Optimal on the first seed (the defect mode): the second seed disagrees, the third breaks the tie, and the certified optimum is the true one"; "settling: two agreeing solves settle a node, with the largest qualified bound of ALL the solves …" |
| Disagree, unsettled | "three solves that all disagree: no certificate (two agreeing solves are needed), the best verified build and the largest bound are kept" (status `feasible`, termination `optimal`, `unsettledDisagreements` 1) |
| Timeout / unqualified second solve withholds | "a second opinion that times out or is not qualified withholds the certificate; the verified build stays, with the factual reason"; pure: "settling: no two agreeing solves, a timeout, an unqualified solve or Infeasible verdicts against a verified build withhold the certificate" |
| Infeasible needs two verdicts and no verified build | "an infeasibility needs both verdicts: a timed-out second opinion leaves the request incomplete; a qualified Optimal with no valid build is outvoted by a third Infeasible"; pure settle test ("a verified build refutes the Infeasible verdicts", "an infeasibility needs both verdicts"); `tests/physical/countModel.proof.test.ts` "an infeasibility verdict from a solve whose parsed model differs from the text is not emptiness; with an honest solver the request is proved empty" (`secondOpinions === 1`) |
| Every solve counted | `tests/physical/solvePrecise.test.ts` "a plain request is one native solve and its second opinion (decision 5a) …" |

The lying solvers replay the defect mode (a wrong `Optimal` with a matching wrong dual bound) on chosen seeds while staying
qualified, so only the second opinion can catch them. Verdict: **PASS** (no new test needed).

## 8. Pinned loader only

| Test | What it asserts |
|---|---|
| `tests/native/artifacts.test.ts` "production src/ never imports node built-ins statically in the native surface, and nothing (src, tests, benchmarks) loads another HiGHS" | No `highs` npm import, `require` or `node_modules/highs` anywhere in src, tests or benchmarks; no stock fallback text; `package.json` lists no `highs`. |
| `tests/native/artifacts.test.ts` "solver.ts reaches HiGHS only through the native surface …", "the build is the documented one: …", "the artifact bytes are the ones the manifest hashed", "public/ … and vendor/highs/ hold byte-identical artifacts and manifest" | One path in, the pinned bytes, the declared version and flags. |
| `tests/native/loader.test.ts` "ABI failure: …" (4 tests), "wrong artifact hashes are refused before the glue runs …", "a stock or foreign build cannot pass …", "a missing artifact directory is a typed load error, not a silent fallback", "the option table matches the build …" | The loader refuses anything but the pinned build. |

Verdict: **PASS**.

## Observations for the owner

- **O1, large coefficients fail loudly rather than withholding.** A matrix coefficient at or above `large_matrix_value`
  (1e15) makes HiGHS refuse the read; `solvePrecise` then rejects with a typed `ModelReadError` instead of returning a
  result with the proof withheld. The model's `matrixFilterRisk` flags it beforehand. This is loud, never silently wrong, and
  no real price comes close (the largest price in the capture is 21,693,600, about 2.2e7, and the largest coefficient of the 153 default certified models is 844,077). Reproduction:
  `evidence.filtering.test.ts` "item 3, at large_matrix_value …" (a part priced 1e15). Not fixed (out of scope); decide
  whether a flagged model should withhold up front.
- **O2, the integrality gate accepts a stricter value.** `assessNativeResult` qualifies any `mip_feasibility_tolerance` at
  or below 1e-7. At 1e-9 the defect fixture returns the wrong `Optimal` 93.6 with dual bound 93.6, and the gate calls that
  solve qualified. Production is not exposed: `nativeSolveOptions` pins 1e-7 for every request, `nativeStop` admits only
  `mip_max_improving_sols`, and the spy test shows every production solve at exactly 1e-7; the second opinion is a further
  safeguard. Recorded as the `todo` test "item 6, defence in depth …"; decide whether the gate should require exactly 1e-7.
- **Measured, within the guard:** with a part priced 1e12 a native dual bound fell 3.0e-9 below the exact score of its own
  build (about 3e-8 relative), more than the 1e-15 to 5e-12 noise recorded under decision 4. The guard withheld it. A
  shortfall of that size that no verified build exposes would go undetected, as `NATIVE_FRAME.assumptions` states; real
  prices stay below 2.2e7, inside the range (up to 1e9) where every swept case certified exactly.

## Verification

Run in `frontend/` on 2026-10-12, worktree at `757bc7d` plus the uncommitted Stage 3 first-wave files:

- `npx tsc --noEmit -p tsconfig.{app,node,reference,tests,benchmarks}.json`: clean on all five.
- `npm run test:unit`: 1,051 tests, 1,047 pass, 0 fail, 2 skipped, 2 todo (O2 here, and one of workstream 3.5), 60 s. The
  23 new evidence tests all pass (real-gun readback 24 s, all-gun finite-domain scan 7 s, the rest under 3 s each).
- `npm run lint`: clean.
