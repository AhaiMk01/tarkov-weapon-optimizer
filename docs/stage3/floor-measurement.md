# Stage 3 workstream 3.7: MOA floor measurement

Measurement of the actual Precise MOA floor workflow, as ADR 0013 section 7 asks ("Stage3 must measure the actual Precise floor workflow at the
default 30-second budget and <=14 threshold solves..."), against the floor contract of ADR 0013 section 6 ("MOA floor") and row 3.7 of
`docs/stage3-plan.md`. It characterizes usability only. It changes no budget, policy, gap or production code. Policy ideas are kept apart, in
"Observations for the owner" at the end.

Tables: `frontend/benchmarks/stage3-floor/summary.md`. Scripts, frozen cases and reproductions: `frontend/benchmarks/stage3-floor/`. Raw results
(one JSON line per request, including every query and every native call) are under `frontend/benchmarks/stage3-floor/results/`, which is git-ignored.

## 1. Method

**Production path.** Each request goes through the worker runtime (`createWorkerRuntime` in `src/solver/workerRuntime.ts`) as a `computeMOAFloor`
message. Its epoch deadline is stamped the way the client stamps it: `epochNow() + resolveTimeLimit(time_limit_ms, DEFAULT_FLOOR_TIME_LIMIT_MS)`,
and no `time_limit_ms` is sent, so the default 30 s applies. The runtime then does its own stash validation, guard, data loading
(`ensureDataLoaded`, seeded from the pinned snapshot through `seedDataCache`, which is the production loader), `domainParams` and result posting.
Two seams are used, and both only observe:

- `deps.runMoaFloor` runs `runMoaFloorDetailed`, the function whose `.response` production's `runMoaFloor` returns, on the worker's own `baseParams`
  and guard, with production's `publishSnapshot`. This keeps the trace.
- `deps.query` of that call is the body of production's `preciseFloorQuery`, copied verbatim: guard check, `floorQueryParams`, `solvePrecise` with
  `MOA_FLOOR_NATIVE_STOP` and `stopAtFirstWitness: true`, then `floorQueryResultOf`. The one difference is that the native solve is wrapped by a
  recorder, so the per-query `PreciseResult` telemetry and every native call are captured. `bench.ts` refuses to run if the production lines it
  copies change (it checks them against the source text).

Each native call records the options requested and the options **in effect, read back from HiGHS** (`effectiveOptions`), the model status (stop
code), primal status, objective, dual bound, B&B nodes, model size and wall time. It also records the objective as HiGHS parsed it: the nonzero
cost columns and the offset, taken from the readback the pipeline already requests.

**Validation.** Every witness of every query, and the response witness, is re-validated with the production validator
(`validatePhysicalBuild`, instance paths required). For a query witness the check is: accepted, the validator's exact MOA string equals the
witness's, and MOA <= the trial cap. For the response witness the check is: accepted under its scope cap, floor >= validated MOA, and
display_floor >= floor.

**Cache states.** Each job (one case, one repetition) runs in a fresh node process.

- *Cold* is the first floor request of that process. No HiGHS instance exists yet, no blueprint is memoized and no compatibility map is cached.
  The item lookup was built before the request was sent, as a loaded data set would be (13 to 61 ms).
- *Warm* is the identical request, sent again to the same runtime right after the cold one finished. Floors have no result cache.

**Plan.** 13 primary cases x 3 repetitions x {cold, warm} = **78 planned requests**. Every planned request counts in every rate, including errors,
crashes and missing results; the driver writes a `missing` line for any request a job did not report. The run used 8 shard processes with progress
files (`results/run1/progress-<k>.json`), one job at a time per shard. Machine: AMD Ryzen 7 9850X3D (8 cores, 16 threads), 31 GB RAM, Windows 11,
node v26.7.0. Timings are node timings: browser WASM timings may differ, and 8 concurrent shards on 8 cores add some contention.

**Freezing (disclosure).** `freeze.ts` wrote `cases.json` before any measured run.

1. A first freeze recorded the wrong tsx version string, and used the git tip as the only source identity. The tip had already moved from
   `a19041c` to `74066da`, a test-only commit by another workstream, and could move again during the run.
2. The file was re-frozen before any measured run. The source identity became the `frontend/src` git tree plus a clean `src` working copy, and the
   tsx version was corrected. No case or request changed.
3. One harness smoke run of frozen case C4-M45A1 went to the scratchpad after the freeze and before the measurement. It is not part of the results.

The cases came from the ADR, the plan row and code reading, without any pilot floor run.

**Addendum (post-hoc, declared).** No primary case came near the deadline. N1's premise turned out wrong (section 4, finding N1). So a separate
4-case addendum, `cases-addendum.json` (24 planned requests), was designed afterwards. It was calibrated with production Precise **Optimize**
(`calibrate-addendum.ts`, output in `calibration.json`), never with a floor, and frozen before it ran. It is reported separately and is never mixed
into the primary rates.

## 2. Frozen identities

| identity | value |
|---|---|
| snapshot (`frontend/benchmarks/snapshot.json`) SHA-256 | `219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c` |
| HiGHS manifest (`public/highs-build-manifest.json`) SHA-256 | `e9cf34f8f9b64cf3945b79a82374bc5c12ee7d45aa9cef6338fdb41bdc5067c6` |
| HiGHS declared by the manifest / reported by every native call | 1.15.1, commit `04024d701f79feb8e2f18bc3df0dffc04ef05088` / 1.15.1 (`04024d701f79`) |
| `highs.wasm` / `highs.js` SHA-256 (manifest = on disk) | `e035d2aa6b6426511c4231604a79fc87bf0eeb1675eddf12580e639daecaa2ed` / `52e09bb470bd7eb388df891d1910477b32c24ba5820aceb9df5bade5ef7c6a7e` |
| node / tsx / platform | v26.7.0 / tsx v4.23.15 / win32-x64 |
| `frontend/src` git tree (checked by every job; equal at `a19041c` and `74066da`) | `7921d95056ebf262aa5ef4523edcc55470a6e6e9` |
| git tip during the jobs | `74066da4590d8ccd2f1de1f5aef7a86577fa12b8` (worktree `guns-impl-stage2`, branch `impl/stage2-correctness-cutover`) |
| `cases.json` / `cases-addendum.json` SHA-256 seen by every job | `7ef09f0d4622a02bdaf20bccf3225064fa1a7df00d8775645f21f27b6a59dbc1` / `5f255bffa5754497d360ffe7818e99d3628a7e564bd58e3d73d650c958db4e5a` |
| production policy asserted at run time | 30000 ms default budget, 14 trial cap, 0.02 MOA bracket tolerance, native stop `{ mip_max_improving_sols: 1 }`, Precise |

## 3. Frozen cases

Every request uses the same acquisition domain, written exactly as the UI's `domainRequestOf` writes a floor request: flea on, every trader at
loyalty 4, player level 50, no barters, no `time_limit_ms`. The exact request JSON is in `cases.json`.

| id | weapon | group | extra request fields | predeclared intent |
|---|---|---|---|---|
| L1-M4A1 | M4A1 | large | none | large platform, plain |
| L2-AK74N | AK-74N | large | none | large platform, plain |
| L3-AKM | AKM | large | none | large platform, plain |
| L4-NL545DI | NL545 DI | large | none | large platform, plain |
| C1-MP5 | MP5 | control | none | smaller control |
| C2-SR25 | SR-25 | control | none | smaller control (DMR) |
| C3-M870 | M870 | control | none | smaller control (shotgun) |
| C4-M45A1 | M45A1 | control | none | smaller control (pistol) |
| T1-M4A1-TE-PO | M4A1 | trueErgo | TrueErgo, Prevent Overswing, gear -25% | TrueErgo-flavoured floor on a large platform. The floor drops the TrueErgo objective (constant zero) but keeps TED >= 0 hard, so the spatial weight search runs |
| T2-NL545DI-TE-PO | NL545 DI | trueErgo | TrueErgo, Prevent Overswing, gear -15% | same, second large platform |
| R1-SR25-PO | SR-25 | nonlinear | Prevent Overswing, gear -30% | nonlinear rejected-candidate path |
| N1-SR25-PO-60 | SR-25 | no_witness | Prevent Overswing, gear -60% | difficult infeasible / no-witness candidate |
| N2-AKM-ERGO80-60K | AKM | no_witness | max_price 60000, min_ergonomics 80 | difficult infeasible / no-witness candidate |
| *addendum* X1-M4A1-EDGE | M4A1 | addendum_edge | max_price 100000, min_ergonomics 93 (= certified max under that budget) | edge-feasible: only ergonomics-optimal builds are witnesses |
| *addendum* X2-M4A1-ABOVE | M4A1 | addendum_infeasible | max_price 100000, min_ergonomics 93.05 | infeasible just above the certified max |
| *addendum* X3-AK74N-EDGE | AK-74N | addendum_edge | max_price 60000, min_ergonomics 85.6 (= certified max) | edge-feasible |
| *addendum* X4-AK74N-ABOVE | AK-74N | addendum_infeasible | max_price 60000, min_ergonomics 85.65 | infeasible just above the certified max |

## 4. Results

### Status rates (planned denominator)

| subset | planned | model_proved | model_witnessed | unresolved | model_infeasible | error / missing |
|---|---|---|---|---|---|---|
| primary, all | 78 | 60 (76.9%) | 12 (15.4%) | 0 | 6 (7.7%) | 0 / 0 |
| large (L1 to L4) | 24 | 24 (100%) | 0 | 0 | 0 | 0 |
| controls (C1 to C4) | 24 | 24 (100%) | 0 | 0 | 0 | 0 |
| TrueErgo + Prevent Overswing (T1, T2) | 12 | 12 (100%) | 0 | 0 | 0 | 0 |
| nonlinear (R1) | 6 | 0 | 6 (100%) | 0 | 0 | 0 |
| no-witness candidates (N1, N2) | 12 | 0 | 6 (N1) | 0 | 6 (N2) | 0 |
| addendum, all | 24 | 12 (X1, X3) | 0 | 0 | 12 (X2, X4) | 0 |

Every case gave the same status, trial count, achieved hi, proved lo and witness in all 6 runs: 3 repetitions x cold/warm, in both runs.

### Per case

Medians over the 6 runs; maxima in brackets. "Gap" is the justified bracket hi - lo, defined only when a qualified emptiness proved lo.

| case | status | stop cause | trials (of 14) | end-to-end ms | seed ms | achieved hi | proved lo | gap | native calls |
|---|---|---|---|---|---|---|---|---|---|
| L1-M4A1 | model_proved | proved | 9 | 2336 (2719) | 306 (531) | 0.8134 | 0.7977 | 0.0156 | 19 |
| L2-AK74N | model_proved | proved | 7 | 1144 (1416) | 257 (446) | 1.7831 | 1.7794 | 0.0037 | 13 |
| L3-AKM | model_proved | proved | 7 | 1096 (1260) | 221 (350) | 2.0960 | 2.0859 | 0.0101 | 14 |
| L4-NL545DI | model_proved | proved | 7 | 852 (1269) | 175 (411) | 1.2376 | 1.2235 | 0.0141 | 14 |
| C1-MP5 | model_proved | proved | 9 | 516 (758) | 121 (243) | 6.8755 | 6.8620 | 0.0134 | 19 |
| C2-SR25 | model_proved | proved | 7 | 970 (1199) | 183 (361) | 1.0210 | 1.0057 | 0.0153 | 15 |
| C3-M870 | model_proved | proved | 8 | 629 (824) | 88 (249) | 10.4507 | 10.4338 | 0.0169 | 15 |
| C4-M45A1 | model_proved | proved | 9 | 338 (544) | 71 (225) | 9.9694 | 9.9499 | 0.0195 | 19 |
| T1-M4A1-TE-PO | model_proved | proved | 7 | 2653 (3604) | 299 (523) | 0.8044 | 0.7975 | 0.0069 | 24 |
| T2-NL545DI-TE-PO | model_proved | proved | 7 | 1672 (2137) | 204 (415) | 1.2376 | 1.2235 | 0.0141 | 27 |
| R1-SR25-PO | model_witnessed | query_stopped: Native solution limit reached | 2 | 872 (1159) | 182 (300) | 1.5315 | 0.5315 | 1.0000 | 9 |
| N1-SR25-PO-60 | model_witnessed | query_stopped: Native solution limit reached | 2 | 712 (1096) | 141 (324) | 1.5315 | 0.5315 | 1.0000 | 9 |
| N2-AKM-ERGO80-60K | model_infeasible | model_infeasible (qualified seed emptiness) | 0 | 255 (408) | 253 (404) | none | none | none | 2 |
| X1-M4A1-EDGE | model_proved | proved | 7 | 3132 (4267) | 1120 (1960) | 2.4064 | 2.3876 | 0.0188 | 16 |
| X2-M4A1-ABOVE | model_infeasible | model_infeasible | 0 | 715 (1377) | 713 (1372) | none | none | none | 2 |
| X3-AK74N-EDGE | model_proved | proved | 7 | 2340 (3269) | 1236 (2018) | 1.9595 | 1.9439 | 0.0156 | 16 |
| X4-AK74N-ABOVE | model_infeasible | model_infeasible | 0 | 1233 (1901) | 1232 (1897) | none | none | none | 2 |

A `model_witnessed` result (R1, N1) is the best witnessed MOA with the minimum **not** proved. Its 1.0 MOA bracket is not a completed minimum.

### Latency distribution

End-to-end latency runs from the deadline stamp to the result message.

| subset | n | min | p50 | p90 | p95 | max | n >= 29 s |
|---|---|---|---|---|---|---|---|
| primary, all | 78 | 137 | 828 | 2301 | 2646 | 3604 | 0 |
| primary, cold | 39 | 309 | 1159 | 2633 | 2736 | 3604 | 0 |
| primary, warm | 39 | 137 | 692 | 2076 | 2281 | 2664 | 0 |
| large | 24 | 564 | 1250 | 2371 | 2599 | 2719 | 0 |
| TrueErgo + Prevent Overswing | 12 | 1509 | 2115 | 2868 | 3212 | 3604 | 0 |
| addendum, all | 24 | 537 | 1892 | 3256 | 3760 | 4267 | 0 |

No request used more than 4.3 s of its 30 s. Proved floors used 7 to 9 of the 14 trials. The trial cap and the deadline never ended a search.

### Queries, native calls and stop codes

Primary run: 564 queries and 1,194 native calls. Addendum: 108 queries and 216 native calls.

- Trial queries took 96 ms median and 791 ms at most (primary); the addendum's took 221 ms median and 371 ms at most.
- A qualified-empty bisection probe usually costs 2 native calls: the relaxed-edge text, confirmed by a second opinion on seed 11. A TED request
  needs 4, two per weight interval.
- Native stop codes over all primary calls: Infeasible 1,008, Optimal 156, SolutionLimit 30, nothing thrown. `summary.md` breaks them down per
  step (seed / discovery / bisection) with p50, p90 and max durations.
- The longest single native call was 422 ms (primary; an L1-M4A1 discovery solve that stopped on SolutionLimit) and 1,135 ms (addendum; the
  X1-M4A1-EDGE seed). The seed emptiness proofs of N2, X2 and X4 took one relaxed-text Infeasible plus its seed-11 confirmation, 0.1 to 1.9 s in all.
- Both witness-yielding stops occur. A witness can come from a native `Optimal` (for example C4-M45A1's seed) or from a native `SolutionLimit`
  (for example the X1 and X3 seeds). Both kinds pass the validator.

**Effective zero objective and native stop options.** All 1,410 native calls (primary plus addendum) satisfy every check below. HiGHS read the
values back; they are not only the requested ones.

- `mip_max_improving_sols = 1`.
- `presolve = off`.
- A positive `time_limit` within the remaining request budget (25.9 to 30.0 s).
- `mip_rel_gap 0`, `mip_abs_gap 1e-9`, `mip_feasibility_tolerance 1e-7`; random seeds 0 and 11.
- The parsed objective has exactly one nonzero cost column (`total_obj`) and offset 0.
- Every primal solution has objective value 0: 186 of 186 primary, 24 of 24 addendum.

### Witness validation

The production validator accepted all of them: 144 of 144 query witnesses in the primary run and 24 of 24 in the addendum, each with the exact MOA
equal to the witness value and within the trial cap. All 72 + 12 response witnesses also passed: accepted under their scope cap, floor >=
validated MOA, display_floor >= floor. The smallest TED among the witnesses of Prevent Overswing cases is 5.385, so none is negative.

### Findings

**F1: a Prevent Overswing floor stops after 2 trials with ~29 s unused.** (**Resolved** 2026-10-12 by owner decision F1, "skip the second
solve for splits": see section 7.) Reproduction:
`benchmarks/stage3-floor/repro-ted-second-opinion-solution-limit.ts`. Seen in 12 of 12 runs of R1 and N1.

1. The trial-2 query at cap 1.0315 (bisection between lo 0.5315 and the seed's hi 1.5315) has two weight nodes.
2. The node under 3 kg is settled Infeasible.
3. On the node over 3 kg, the relaxed-text solve with seed 0 returns `Optimal` (objective 0, dual bound 0). Its point is TED-infeasible, which is
   expected inside an inexact weight interval, so the verdict is `optimal` with no candidate and a split point (`solvePrecise.ts`, "a point
   rejected only for overswinging").
4. That verdict goes to the decision-5a second opinion. Under the floor's `mip_max_improving_sols = 1`, the seed-11 solve of the **same text**
   returns `SolutionLimit` with objective 0 = dual bound 0, so the gap is closed.
5. A limit status is never a qualified verdict. The node is unsettled, the spatial search breaks with the stop reason `Native solution limit
   reached`, and the floor query is `stopped`.
6. The floor ends `model_witnessed` with a 1.0 MOA bracket after about 1 s.

The same cap on the same gun without Prevent Overswing (C2-SR25) yields a witness at 1.0210, so the query is not empty. The outcome is sound: no
false claim, and lo was proved. It is permitted by the ADR's "retain the spatial safeguards until a full witness, qualified emptiness or unresolved
stop". It is still a liveness loss, caused by how the scoped native stop interacts with the second opinion. The telemetry counter
`rejectedCandidates` stays 0 here, because an overswinging point is a split point, not a cut. So this path, the nonlinear rejected-candidate path
the ADR asks for, is not visible in that counter. Production is unchanged. Whether F1 is a defect or the intended conservative outcome is for the
owner and the implementer to decide.

**F2 (minor, diagnostic only): every floor witness is labelled `nativeStop: 'solution_limit'`.** (**Resolved** 2026-10-12 by owner decision
F2: see section 7.) Reproduction:
`benchmarks/stage3-floor/repro-native-stop-label.ts`.

- The label also appears when the native solve completed `Optimal`, and its Precise outcome carries the factual reason `Native solution limit
  reached`.
- Cause: `solvePrecise`'s `confirm` returns that reason for **any** first witness under `stopAtFirstWitness`, whatever the native status.
- The `nativeStopOf` comment in `moaFloor.ts` says this applies to TED weight searches only; it applies to every floor query (the reproduction
  reads no TED).
- ADR 0013 section 6 keeps native `Optimal` completion and a native solution-limit stop distinct.
- Impact: the floor trace only. `nativeStop` is never an input of the search, and the floor response carries no reason when the floor is proved.
- The native stop codes above come from the recorder, not from this label.

**N1's premise was wrong.** Prevent Overswing at gear -60% is no infeasibility on an SR-25. Builds under 3 kg carry no weight penalty, so TED >= 0
holds for them trivially, and the seed witness weighs 2.965 kg. R1 (-30%) and N1 (-60%) therefore behave identically. N2's seed emptiness took 0.1
to 0.4 s. **No frozen case, primary or addendum, spent the deadline.** The difficult infeasible / no-witness behaviour that ADR section 7 warns
about ("may spend the remaining deadline") was not observed on these 17 cases. That does not show that it cannot happen. It was not found with the
cases tried.

## 5. Reproduction

From `frontend/`:

```
npx tsx benchmarks/stage3-floor/freeze.ts                       # only to re-freeze (refuses to overwrite cases.json)
bash benchmarks/stage3-floor/run.sh benchmarks/stage3-floor/results/run1 8
npx tsx benchmarks/stage3-floor/calibrate-addendum.ts > benchmarks/stage3-floor/calibration.json   # addendum calibration (Optimize only)
npx tsx benchmarks/stage3-floor/freeze.ts --addendum            # refuses to overwrite cases-addendum.json
bash benchmarks/stage3-floor/run.sh benchmarks/stage3-floor/results/addendum1 8 --cases cases-addendum.json
npx tsx benchmarks/stage3-floor/summarize.ts benchmarks/stage3-floor/results/run1 cases.json            # primary part of summary.md
npx tsx benchmarks/stage3-floor/summarize.ts benchmarks/stage3-floor/results/addendum1 cases-addendum.json  # addendum part
npx tsx benchmarks/stage3-floor/repro-ted-second-opinion-solution-limit.ts                            # F1
npx tsx benchmarks/stage3-floor/repro-native-stop-label.ts                                            # F2
```

`bench.ts` refuses to run under a different snapshot, HiGHS manifest or artifacts, node version, `frontend/src` tree, dirty `src`, policy
constant, or copied production query lines.

## 6. Observations for the owner (not part of the measurement; no policy is changed here)

- **Budget headroom.** On these cases the 30 s budget and the 14-trial cap are far from binding. Proved floors take 0.3 to 4.3 s and 7 to 9
  trials, cold and warm alike (warm saves 0.1 to 1.0 s, mostly HiGHS instantiation and blueprint preparation). These numbers say nothing about the
  worst case: section 4 found no deadline-spending case, and the ADR's warning stands.
- **F1 is the usability issue that matters.** Every Prevent Overswing floor whose bisection crosses a weight node with an overswinging relaxed
  optimum can stop early as `model_witnessed`. On this snapshot that happened for the SR-25 at both gear settings tried, while T1 and T2 (M4A1 and
  NL545 DI with TrueErgo + Prevent Overswing) proved their floors. Possible directions are owner and implementer decisions, each needing its own
  evidence:
  - treat a native `SolutionLimit` whose dual bound equals its constant-zero objective as settling the node's non-emptiness for a floor query;
  - skip the second opinion for an `optimal` verdict that has no candidate and only triggers a split (the split, not a certificate, is what the
    floor needs from it);
  - split on an unsettled node rather than stopping.

  Each touches the decision-5a guard or the scoped native stop, so none should be adopted silently.
- **F2** is a labelling fix: derive `nativeStop` from the native model status, or correct the comment and the trace field's meaning. It has no
  status impact.
- **Nonlinear path visibility.** Telemetry counts decoder and validator rejections (`rejectedCandidates`) but not overswing split points. A
  dedicated counter would make the ADR's "nonlinear rejected-candidate path" measurable directly. Here it was observed only through the native log
  (F1).
- **Finding a deadline-spending case.** If the owner wants a real deadline-spending floor in the regression set, the cases tried here
  (budget-bounded ergonomics at and just above the certified maximum, a near-boundary minimum ergonomics under a budget, aggressive Prevent
  Overswing) were not hard enough on this snapshot. A follow-up could search for one systematically, for example by timing seed emptiness over
  many guns with tight multi-constraint domains. That search would itself need predeclaration.

## 7. F1 and F2 resolved (s3fix2, 2026-10-12)

Owner decisions of 2026-10-12, implemented on `impl/stage2-correctness-cutover` after `dae163a` (uncommitted at the time of the rerun):

- **F1, "skip the second solve for splits".** A first opinion that leads only to a split of the weight range (a qualified `Optimal` of an
  inexact node with no verified build and a split point, whose bound would not fathom the node) is no longer sent to the decision-5a second
  opinion. The node is returned as the search verdict `split`: it is split, its bound is not used, nothing is pruned and nothing is certified
  from it (`leadsOnlyToSplit` / `splitOnly` in `src/solver/physical/solvePrecise.ts`, verdict `split` in `search.ts`; proof:
  `docs/proofs/count-model.md`, Proposition F1). Pruning, optimality, infeasibility and every published bound keep the full rule.
- **F2.** A witness's `nativeStop` is now the HiGHS model status of the solve that produced it (`VerifiedBuild.nativeStatus`): `Optimal` reads
  `optimal`, `SolutionLimit` reads `solution_limit`, anything else `other`. The `nativeStopOf` comment no longer claims TED-only relabelling.
  The first-witness short-circuit's reason is that solve's real stop (`Native solution limit reached` after a native solution limit,
  `Required proof prerequisite unavailable` after a native `Optimal` whose second opinion was not run).

**Reproductions after the change.** `repro-ted-second-opinion-solution-limit.ts` now returns a witness at 1.0210 MOA for the Prevent Overswing
query (cap 1.0315), with native statuses Infeasible, Infeasible (the node under 3 kg, settled), then Optimal (seed 0) twice on the node over
3 kg (seed 0: the node's overswinging relaxed optimum, now a split point; then the first child node's relaxed text, whose verified witness
ends the query), and no seed-11 `SolutionLimit`. `repro-native-stop-label.ts` prints
`nativeStop: 'optimal'` with every native call `Optimal` ("not reproduced").

**Rerun of the frozen cases** (R1, N1, the plain control C2 on the same gun, and the TrueErgo + Prevent Overswing control T1; same 3
repetitions x cold/warm, same frozen requests and policy). `bench.ts` refuses a changed `src`, so the rerun used the declared override
`FLOOR_BENCH_POST_FIX=1`, which records `postFix: true` and the SHA-256 of the uncommitted `src` diff in every result line; the frozen identities
are otherwise checked as before. Results: `frontend/benchmarks/stage3-floor/results/s3fix2/` (git-ignored). The 4 cases ran on 4 shards;
the before column is the primary run of section 4. Every run of a case gave the same status, trials, hi and lo. Every response witness passed
the production validator (accepted, floor >= validated MOA, display floor >= floor).

| case | before: status, stop | before: trials, hi, lo, gap | after: status, stop | after: trials, hi, lo, gap | after: end-to-end ms median (max) | native calls before / after |
|---|---|---|---|---|---|---|
| R1-SR25-PO | model_witnessed, query_stopped (Native solution limit reached) | 2, 1.5315, 0.5315, 1.0000 | **model_proved**, proved | 7, **1.0210**, 1.0057, 0.0153 | 1062 (1284) | 9 / 29 |
| N1-SR25-PO-60 | model_witnessed, query_stopped (Native solution limit reached) | 2, 1.5315, 0.5315, 1.0000 | **model_proved**, proved | 6, **1.0777**, 1.0662, 0.0116 | 4944 (5578) | 9 / 37 |
| C2-SR25 (plain control) | model_proved, proved | 7, 1.0210, 1.0057, 0.0153 | model_proved, proved | 7, 1.0210, 1.0057, 0.0153 | 716 (985) | 15 / 15 |
| T1-M4A1-TE-PO (TrueErgo + PO control) | model_proved, proved | 7, 0.8044, 0.7975, 0.0069 | model_proved, proved | 7, 0.8044, 0.7975, 0.0069 | 2601 (2915) | 24 / 24 |

- R1 now proves the same floor as its plain control C2 (1.0210 MOA, the same witness value): with gear -30% the SR-25's MOA-optimal builds
  do not overswing, so Prevent Overswing does not change the minimum. N1 (gear -60%) proves a higher floor, 1.0777 MOA: Prevent Overswing does
  bind at that gear, which the old 1.0 MOA bracket could not show. Both use 6 to 7 trials and at most 5.6 s of the 30 s budget.
- The controls are unchanged in status, trials, bounds and native call count.
- Witness labels after the change: R1 12 `optimal`; N1 12 `optimal` and 6 `solution_limit` (a native `SolutionLimit` produced those
  witnesses); C2 12 `optimal` (before: 12 `solution_limit`); T1 24 `optimal` (before: 24 `solution_limit`). The labels now agree with the
  recorded native statuses.
- Timings are node timings on the same machine as section 1, with other workloads running at the same time (other agents' processes), so
  the millisecond columns are indicative only.

**Optimize impact of F1** (not a floor measurement; `frontend/benchmarks/phase210m2/bench.ts`, profile `trueErgoPO` = TrueErgo + Prevent
Overswing at gear -30%, 172 pinned guns, 60 s, 12 processes, before = `dae163a` exported, after = the change): certificates identical
(143 certified optimal + 29 certified infeasible in both), scores identical on every gun; 47 split-only nodes on 37 guns replace 47 second
opinions (native solves 1,510 -> 1,463); total wall time 937 s -> 847 s (per-gun ratio median 0.92). Plain and TrueErgo without Prevent
Overswing produce no overswing split points, so F1 does not touch them (0 split-only nodes on 344 runs).

Reproduction of the rerun, from `frontend/`:

```
FLOOR_BENCH_POST_FIX=1 bash benchmarks/stage3-floor/run.sh benchmarks/stage3-floor/results/s3fix2 4 --only R1-SR25-PO,N1-SR25-PO-60,C2-SR25,T1-M4A1-TE-PO
bash benchmarks/phase210m2/run.sh <checkout> benchmarks/phase210m2/results <label> 12 --profiles trueErgoPO
```

