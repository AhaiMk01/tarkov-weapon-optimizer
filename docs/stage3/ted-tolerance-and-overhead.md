# Precise TrueErgo: proof tolerance vs time, and per-node rebuild overhead (measured)

Measurement only, 2026-10-13. Branch `perf/ted-seed-incumbent` at `39aab13` (extended split shortcut on, the production default). No production
behaviour changed: the only `src/` change is an opt-in timing hook (`PreciseContext.timing`, below) that production never sets.

## What the tolerance is

`objectiveTolerance` (`resolveTolerance`, default `DEFAULT_OBJECTIVE_TOLERANCE = 1e-5`) is **absolute**, in the units of the scalarized objective
(the "objective frame", `toOracle` scale 1, offset 0). For the weighted objective (`trueErgo.ts objectiveModel`, `proof.ts exactObjectiveScore`):

    score = (e / 10) fE - r fR - (p / 1000) fP,   fE = 10 x TED (TrueErgo) or 10 x ergonomics,  fR = 1000 x sum of recoil modifiers,  fP = spend (roubles)
          = e x TED - 1000 r x sum(recoil mod) - (p / 1000) x spend

The weights are used as given (not normalized). So one TED point is worth `e` objective units, and a tolerance `tau` means a gap of at most
`tau / e` TED points of the blend (the gap is in the blend: it can equally be `tau / (1000 r)` of recoil-modifier sum or `1000 tau / p` roubles).

| request | e | 1 TED point = | default 1e-5 means | tau for 0.1 / 0.01 / 0.001 TED points |
| --- | ---: | ---: | --- | --- |
| this bench (`bench.ts`: e 1, r 1, p 0.1) | 1 | 1 unit | 1e-5 TED points | 0.1 / 0.01 / 0.001 |
| pure ergonomics, e = 1 (weights 1/0/0) | 1 | 1 unit | 1e-5 TED points | 0.1 / 0.01 / 0.001 |
| pure ergonomics from the UI slider (e = 100) | 100 | 100 units | 1e-7 TED points | 10 / 1 / 0.1 |
| the app's default weights (`App.tsx`: e 33, r 34, p 33) | 33 | 33 units | 3e-7 TED points | 3.3 / 0.33 / 0.033 |

Where the tolerance acts (all in exact rationals): fathoming a spatial node and certifying the search (`search.ts withinTolerance`, `certified`),
agreement of two opinions (`opinionsAgree`: bounds within `tau`), the split-only shortcut (`leadsOnlyToSplit`: bound more than `tau` above the
reference) and the bound-shortfall sanity guard (`max(tau, 1e-9 |bound|)`). It does **not** loosen the native search: `nativeSolveOptions` sets
`mip_abs_gap = min(1e-9, tau / 4)`, so every tolerance measured here runs HiGHS at the same 1e-9 gap, `mip_rel_gap` 0.

> Note (2026-10-27): this no longer holds for Fast TED. A Fast TrueErgo / Prevent Overswing solve without an explicit tolerance runs at
> `0.1 x` its summed weights (`1e-4` for the Tchebycheff solve) with the native gap `tau / 4` uncapped (`fastTedNativeSolveOptions`);
> see `fast-ted-tolerance.md`. Precise, plain Fast and explicit tolerances keep the capped gap described here.

## Method

- 172 pinned guns (snapshot sha256 `219443b4…`), Precise (`solvePrecise`), profiles `trueErgo` and `trueErgoPO` (TrueErgo + Prevent Overswing,
  gear -30%), 60 s per request, request as in `bench.ts` (e 1, r 1, p 0.1, flea, trader level 4, player level 50).
- Measurement 1: `frontend/benchmarks/phase210m2/run-tedmeasure.sh` (12 processes via `run.sh`, labels `tol1e-5`, `tol1e-1`, `tol1e-2`, `tol1e-3`,
  run back to back, `--tolerance <tau> --timing on`). Because e = 1, these tolerances are 0.1, 0.01 and 0.001 TED points (table above).
- Measurement 2: the 20 slowest `trueErgo` guns of the default run plus Saiga-12K, Mk 16, AKS-74U, AUG A3, G28, SKS and MP5 (three short
  names cover two guns each, 30 requests), `trueErgo`, 4 processes, `--timing on --warmup MP5` (one unrecorded solve first, so the WebAssembly
  load is not in a measured request).
- Raw lines: `frontend/benchmarks/phase210m2/results/tedmeasure/tol*.jsonl` and `results/tedmeasure-overhead/overhead-*.jsonl` (gitignored);
  tables by `benchmarks/phase210m2/tedmeasure-summarize.ts` (`results/tedmeasure/summary-tolerance.md`, `results/tedmeasure-overhead/summary-overhead.md`).
- The timing hook does not change results: the `tol1e-5` run (timing on) matches the earlier `splitOn` run (timing off, same code,
  `split-shortcut.md`) in status, certificate, score, published bounds, nodes, native solves and second opinions on all 344 requests. Wall time on
  this machine is noisy by about 10% (`tol1e-5` was 9% faster in total than `splitOn`); solve and node counts are the reliable measure.

## Measurement 1: tolerance vs time

| profile | tolerance (= TED points here) | cert. optimal | cert. infeasible | other | total s | median s | p90 s | max s | nodes | native solves | 2nd opinions | 3rd | 2nd-opinion s | split-only nodes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| trueErgo | 1e-5 (default) | 153 | 19 | 0 | 786.9 | 0.65 | 16.4 | 28.0 | 730 | 1230 | 486 | 1 | 302.6 | 244 |
| trueErgo | 1e-3 | 153 | 19 | 0 | 752.9 | 0.57 | 14.8 | 28.2 | 708 | 1196 | 475 | 1 | 290.1 | 233 |
| trueErgo | 1e-2 | 153 | 19 | 0 | 693.1 | 0.50 | 13.9 | 26.9 | 670 | 1137 | 456 | 1 | 270.7 | 214 |
| trueErgo | 1e-1 | 153 | 19 | 0 | 674.4 | 0.54 | 12.0 | 30.4 | 610 | 1043 | 426 | 0 | 266.0 | 184 |
| trueErgoPO | 1e-5 (default) | 143 | 29 | 0 | 705.5 | 0.46 | 14.5 | 27.5 | 762 | 1278 | 502 | 1 | 266.5 | 260 |
| trueErgoPO | 1e-3 | 143 | 29 | 0 | 707.6 | 0.46 | 14.4 | 27.4 | 752 | 1263 | 497 | 1 | 268.1 | 255 |
| trueErgoPO | 1e-2 | 143 | 29 | 0 | 658.7 | 0.42 | 13.7 | 27.8 | 720 | 1214 | 481 | 1 | 248.6 | 239 |
| trueErgoPO | 1e-1 | 143 | 29 | 0 | 611.1 | 0.47 | 13.3 | 27.3 | 650 | 1108 | 446 | 0 | 230.5 | 204 |

Native-solve reductions against the default: trueErgo -2.8% / -7.6% / -15.2% at 1e-3 / 1e-2 / 1e-1, Prevent Overswing -1.2% / -5.0% / -13.3%.
Paired per-gun time ratio loose/default over the guns above 1 s (76 trueErgo, 71 PO): median 0.98 / 0.96 / 0.99 (trueErgo) and 1.01 / 0.96 / 0.93
(PO); p10 0.82 / 0.68 / 0.60 and 0.89 / 0.75 / 0.60.

**Distance from the default-tolerance score: zero everywhere.** Every certified score at every looser tolerance equals the default score
exactly, and the published build has the same statistics (TED, ergonomics, recoil modifier sum, spend, weight) on all 153 trueErgo and 143 PO
certified guns at 1e-3, 1e-2 and 1e-1 (max |d| = 0 objective units = 0 TED points; distribution: all zero). No status or certificate changed. The
search finds the optimum early; a looser tolerance only stops it sooner from proving it.

10 slowest guns, seconds / nodes / native solves / second opinions, ordered by the default time:

| trueErgo | 1e-5 | 1e-3 | 1e-2 | 1e-1 |
| --- | --- | --- | --- | --- |
| ADAR 2-15 | 28.0 / 10 / 16 / 6 | 21.3 / 8 / 13 / 5 | 16.7 / 6 / 10 / 4 | 11.4 / 4 / 7 / 3 |
| AKMN | 27.0 / 10 / 16 / 6 | 28.2 / 10 / 16 / 6 | 26.9 / 10 / 16 / 6 | 30.4 / 10 / 16 / 6 |
| AKMS | 24.8 / 14 / 22 / 8 | 26.5 / 14 / 22 / 8 | 24.7 / 14 / 22 / 8 | 20.6 / 10 / 16 / 6 |
| AK-102 | 23.9 / 10 / 16 / 6 | 23.4 / 10 / 16 / 6 | 21.5 / 10 / 16 / 6 | 15.9 / 6 / 10 / 4 |
| AK-101 | 23.4 / 8 / 13 / 5 | 24.0 / 8 / 13 / 5 | 22.4 / 8 / 13 / 5 | 23.5 / 8 / 13 / 5 |
| AK-105 | 23.0 / 8 / 13 / 5 | 24.3 / 8 / 13 / 5 | 22.6 / 8 / 13 / 5 | 24.9 / 8 / 13 / 5 |
| M16A2 | 22.9 / 10 / 16 / 6 | 20.2 / 8 / 13 / 5 | 13.9 / 6 / 10 / 4 | 10.1 / 4 / 7 / 3 |
| M16A1 | 22.3 / 10 / 16 / 6 | 17.6 / 8 / 13 / 5 | 14.8 / 6 / 10 / 4 | 9.0 / 4 / 7 / 3 |
| PP-19-01 | 21.1 / 10 / 16 / 6 | 13.3 / 8 / 13 / 5 | 9.4 / 6 / 10 / 4 | 5.7 / 4 / 7 / 3 |
| AK-74N | 21.0 / 8 / 13 / 5 | 19.0 / 8 / 13 / 5 | 19.5 / 8 / 13 / 5 | 20.2 / 8 / 13 / 5 |

| trueErgoPO | 1e-5 | 1e-3 | 1e-2 | 1e-1 |
| --- | --- | --- | --- | --- |
| AK-74N | 27.5 / 12 / 19 / 7 | 27.4 / 12 / 19 / 7 | 27.8 / 12 / 19 / 7 | 27.3 / 10 / 16 / 6 |
| AK-101 | 23.8 / 12 / 19 / 7 | 23.8 / 12 / 19 / 7 | 21.5 / 12 / 19 / 7 | 16.6 / 8 / 13 / 5 |
| AKS-74N | 23.0 / 10 / 16 / 6 | 23.8 / 10 / 16 / 6 | 22.5 / 10 / 16 / 6 | 20.0 / 8 / 13 / 5 |
| AK-74M | 21.1 / 10 / 16 / 6 | 22.8 / 10 / 16 / 6 | 20.8 / 10 / 16 / 6 | 19.8 / 8 / 13 / 5 |
| ADAR 2-15 | 20.2 / 8 / 13 / 5 | 21.6 / 8 / 13 / 5 | 20.6 / 8 / 13 / 5 | 17.3 / 6 / 10 / 4 |
| AKMN | 20.1 / 10 / 16 / 6 | 20.8 / 10 / 16 / 6 | 19.8 / 10 / 16 / 6 | 20.5 / 10 / 16 / 6 |
| Model 1 | 19.3 / 10 / 16 / 6 | 19.0 / 10 / 16 / 6 | 18.8 / 10 / 16 / 6 | 16.1 / 8 / 13 / 5 |
| M4A1 | 18.8 / 8 / 13 / 5 | 16.9 / 8 / 13 / 5 | 17.8 / 8 / 13 / 5 | 13.3 / 6 / 10 / 4 |
| TX-15 DML | 18.6 / 8 / 13 / 5 | 19.0 / 8 / 13 / 5 | 17.0 / 8 / 13 / 5 | 16.6 / 8 / 13 / 5 |
| AK-104 | 18.4 / 8 / 15 / 5 | 19.6 / 8 / 15 / 5 | 18.1 / 8 / 15 / 5 | 16.4 / 8 / 14 / 5 |

Slowest 10 at 0.1 TED points: trueErgo AKMN 30.4, AK-105 24.9, AK-101 23.5, AKS-74N 22.1, AK-104 22.0, AKMS 20.6, AK-74N 20.2, AKM 18.4,
AKS-74 17.8, VPO-136 16.6; PO AK-74N 27.3, AKMN 20.5, AKS-74N 20.0, AK-74M 19.8, ADAR 2-15 17.3, VPO-136 16.7, AK-101 16.6, TX-15 DML 16.6,
AKS-74 16.5, AK-104 16.4.

Reading: a gun whose last nodes close with bounds a few hundredths of a point above the incumbent (ADAR 2-15, the M16s, PP-19-01) halves at
0.01 to 0.1 points. The AK family keeps the same nodes even at 0.1 points: their leaves are closed by exact nodes or bounds far below the
incumbent, so the tolerance never binds and the worst case (about 30 s) does not move.

## Measurement 2: where a request's wall time goes

Stages (disjoint; `PreciseTiming` plus `SearchTelemetry.readbackMs`): **specialize** = `specializeCount` per node (count model, proof record,
integer LP text); **lpText** = relaxed-edge text and cut texts; **parse** = HiGHS reading the text (options, MEMFS write, `Highs_readModel`);
**marshal** = the rest of the native call outside the run (column/row names, the readback copy of the parsed model, solution copy, handle
release); **run** = `Highs_run`; **readback** = verifying the parsed model against the text (`assessNativeResult`); **judge** = decode, independent
validation, exact scoring and bound check; **other** = everything else (search bookkeeping, blueprint/domain/validator preparation, yields).
"2nd-opinion share" is the time inside second and third opinions (overlaps the stage columns).

30 requests (20 slowest + medium), `trueErgo`, 4 processes, warm:

| gun | wall s | nodes | solves | specialize | lpText | parse | marshal | run | readback | judge | other | 2nd-opinion share | est. reuse saving |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AKMN | 22.18 | 10 | 16 | 0.4% | 0.0% | 0.9% | 0.3% | 96.8% | 1.2% | 0.1% | 0.2% | 37.8% | 2.7% |
| M16A1 | 21.65 | 10 | 16 | 0.5% | 0.0% | 1.1% | 0.4% | 96.0% | 1.5% | 0.1% | 0.4% | 34.5% | 3.3% |
| AKMS | 20.69 | 14 | 22 | 0.4% | 0.1% | 1.0% | 0.4% | 96.2% | 1.4% | 0.1% | 0.4% | 34.2% | 3.1% |
| ADAR 2-15 | 20.18 | 10 | 16 | 0.4% | 0.0% | 1.1% | 0.4% | 95.8% | 1.5% | 0.1% | 0.6% | 33.6% | 3.3% |
| AK-102 | 19.00 | 10 | 16 | 0.4% | 0.0% | 0.9% | 0.3% | 96.7% | 1.1% | 0.1% | 0.3% | 51.4% | 2.7% |
| AK-101 | 18.57 | 8 | 13 | 0.4% | 0.0% | 0.8% | 0.3% | 97.0% | 1.1% | 0.1% | 0.2% | 33.8% | 2.4% |
| AK-105 | 18.52 | 8 | 13 | 0.3% | 0.0% | 0.7% | 0.3% | 97.1% | 1.1% | 0.1% | 0.4% | 39.7% | 2.2% |
| M16A2 | 18.12 | 10 | 16 | 0.6% | 0.1% | 1.2% | 0.5% | 95.4% | 1.7% | 0.1% | 0.5% | 35.4% | 3.7% |
| AK-104 | 17.14 | 8 | 14 | 0.4% | 0.0% | 0.8% | 0.3% | 96.8% | 1.2% | 0.1% | 0.4% | 47.5% | 2.5% |
| AKS-74N | 15.55 | 8 | 13 | 0.4% | 0.0% | 1.0% | 0.4% | 96.3% | 1.4% | 0.1% | 0.4% | 32.8% | 2.9% |
| PP-19-01 | 15.19 | 10 | 16 | 0.4% | 0.1% | 0.7% | 0.3% | 97.0% | 1.0% | 0.1% | 0.5% | 43.8% | 2.2% |
| MPX | 14.10 | 10 | 17 | 0.3% | 0.0% | 0.6% | 0.2% | 97.3% | 0.9% | 0.1% | 0.5% | 36.0% | 1.9% |
| AK-74N | 13.75 | 8 | 13 | 0.5% | 0.1% | 1.1% | 0.4% | 95.5% | 1.7% | 0.1% | 0.6% | 42.3% | 3.5% |
| AKM | 13.30 | 8 | 13 | 0.4% | 0.0% | 1.0% | 0.3% | 96.2% | 1.3% | 0.1% | 0.7% | 38.1% | 2.8% |
| Model 1 | 13.21 | 8 | 13 | 0.5% | 0.1% | 1.2% | 0.4% | 95.4% | 1.6% | 0.1% | 0.6% | 34.2% | 3.5% |
| AKS-74 | 13.17 | 8 | 13 | 0.5% | 0.1% | 1.0% | 0.4% | 96.2% | 1.4% | 0.1% | 0.3% | 35.5% | 3.1% |
| VPO-136 | 12.02 | 8 | 13 | 0.4% | 0.1% | 1.1% | 0.4% | 95.8% | 1.6% | 0.1% | 0.5% | 36.9% | 3.3% |
| Saiga-9 | 11.78 | 8 | 14 | 0.2% | 0.0% | 0.7% | 0.3% | 97.4% | 0.9% | 0.1% | 0.4% | 33.9% | 2.0% |
| HK 416A5 | 11.45 | 6 | 10 | 0.3% | 0.0% | 0.6% | 0.2% | 97.6% | 0.8% | 0.1% | 0.4% | 30.4% | 1.8% |
| AKS-74UN | 10.50 | 8 | 13 | 0.5% | 0.0% | 0.9% | 0.3% | 96.2% | 1.3% | 0.1% | 0.7% | 45.3% | 2.8% |
| HK 416A5 (2nd) | 8.70 | 6 | 10 | 0.3% | 0.0% | 0.8% | 0.3% | 96.7% | 1.2% | 0.1% | 0.5% | 37.8% | 2.4% |
| Mk 16 | 6.28 | 6 | 10 | 0.5% | 0.0% | 1.0% | 0.4% | 96.3% | 1.3% | 0.1% | 0.4% | 27.6% | 2.8% |
| Saiga-12K | 3.49 | 6 | 11 | 1.1% | 0.1% | 2.2% | 0.8% | 90.3% | 3.0% | 0.3% | 2.2% | 44.7% | 6.5% |
| AKS-74U | 3.25 | 2 | 4 | 0.3% | 0.0% | 0.7% | 0.3% | 97.3% | 0.9% | 0.1% | 0.3% | 37.5% | 1.6% |
| Mk 16 (2nd) | 3.03 | 8 | 13 | 1.4% | 0.1% | 2.8% | 1.2% | 88.5% | 3.7% | 0.3% | 2.0% | 57.3% | 8.5% |
| AUG A3 | 2.82 | 6 | 10 | 0.7% | 0.0% | 1.4% | 0.5% | 93.4% | 2.0% | 0.2% | 1.7% | 40.4% | 4.1% |
| G28 | 1.78 | 6 | 10 | 1.0% | 0.1% | 2.3% | 0.7% | 90.1% | 3.2% | 0.3% | 2.3% | 43.6% | 6.5% |
| MP5 | 1.36 | 8 | 13 | 1.6% | 0.1% | 3.6% | 1.3% | 83.2% | 4.5% | 0.5% | 5.1% | 44.1% | 10.3% |
| AUG A3 (2nd) | 1.35 | 4 | 7 | 0.9% | 0.1% | 2.0% | 0.6% | 91.1% | 3.2% | 0.3% | 1.8% | 38.1% | 5.7% |
| SKS | 0.58 | 3 | 5 | 2.8% | 0.1% | 4.0% | 1.4% | 79.7% | 5.5% | 0.7% | 5.9% | 28.1% | 10.7% |
| **all 30** | 352.7 | 233 | 383 | 1.5 s (0.4%) | 0.2 s (0.0%) | 3.5 s (1.0%) | 1.3 s (0.4%) | 339.1 s (96.2%) | 4.8 s (1.4%) | 0.4 s (0.1%) | 1.8 s (0.5%) | 38.0% | 2.9% |

Per unit: specialize 6.6 ms per node, parse 9.1 ms, marshal 3.3 ms, readback check 12.6 ms, judge 1.0 ms and run 886 ms per native solve.
The same breakdown over all 172 guns of the Measurement 1 default run (12 processes, no warm-up, so the first gun of each process carries the
WebAssembly load in "marshal"): trueErgo run 94.9%, readback 1.6%, parse 1.2%, specialize 0.6%, marshal 0.6%, judge 0.2%, lpText 0.1%, other
0.9%; Prevent Overswing run 94.5%, readback 1.9%, parse 1.4%, specialize 0.6%, marshal 0.5%, judge 0.2%, lpText 0.1%, other 0.9%.

**Estimated saving from reusing the parsed model** (one HiGHS model per request; nodes and opinions change only column bounds, the objective, the
integrality of the edge columns and appended cut rows): no re-specialization after the first node, no text, no re-parse and no re-marshalling of
the model (solutions are still read), and one readback check per model kind instead of one per solve. That removes at most specialize (minus
one call) + lpText + parse + marshal + readback (minus two checks): **2.9% of the 30 requests' time (10.4 s of 352.7 s; per request 1.6% to
10.7%, median 3.0%)**, 3.7% over all 172 trueErgo requests (29.2 s of 786.9 s, inflated by the cold first gun per process). The large shares
are only on sub-2-second guns (SKS 0.58 s -> about 0.52 s). The estimate is an upper bound: a reused model still needs its bound/objective
changes applied and verified, and it would weaken the proof frame's "verify the parsed model of every solve" rule, which would have to be
re-argued.

## Conclusion and recommendations

1. **Loosening the tolerance buys little and costs nothing measurable in quality.** Up to 0.1 TED points (bench weights) every certified build is
   identical to the default one, but total time falls only 4% / 12% / 14% (trueErgo, 1e-3 / 1e-2 / 1e-1) and 0% / 7% / 13% (Prevent Overswing),
   native solves 3% / 8% / 15%, the median request is unchanged, and the slowest AK requests (about 20 to 30 s) do not move at all. If a looser
   default is wanted for latency, 0.01 TED points is the sensible floor (-8% solves, gains concentrated on ADAR/M16/PP-19-type guns), not a fix
   for the worst case.
2. **Make the tolerance scale-free before changing it.** It is absolute in objective units and the weights are not normalized, so the default
   1e-5 means 1e-5 TED points at e = 1 but 3e-7 TED points at the app's default weights (e = 33) and 1e-7 at the pure-ergo slider (e = 100). A
   tolerance stated in TED points (or relative to the sum of weights, or to the incumbent) would make "0.01 points" mean the same in the app as here;
   at the app's weights the equivalent of this table's 1e-2 is tau = 0.33.
3. **Do not build model reuse for speed.** HiGHS's own run is 95-97% of every request over 2 s; everything the pipeline does around it
   (specialization, text, parse, readback, decode/validate) is about 3% (at most 10% on sub-second guns). The levers are the native solves
   themselves: their number (second opinions are 38% of wall time; the split shortcut already removed a third of them) and their length
   (about 0.9 s per solve on the slowest guns: the relaxed-edge MIP search of each node).
4. The opt-in `PreciseContext.timing` hook and the bench flags (`--tolerance`, `--timing on`, `--warmup <gun>`) can stay for future measurements;
   they are inert unless set.

## Code touched (uncommitted)

- `frontend/src/solver/physical/solvePrecise.ts`: `PreciseContext.timing?: PreciseTiming`, `emptyPreciseTiming()`; when set, the solve function is
  wrapped to sum the native call and its `wallMs.read` / `wallMs.run`, and `modelOf`, the text builders and `judge` add their elapsed time.
  Clock reads only; when unset the code path is the original one.
- `frontend/benchmarks/phase210m2/bench.ts`: `--tolerance`, `--timing on`, `--warmup <gun>`; lines carry `tolerance`, the build's `stats` and
  `timing`.
- `frontend/benchmarks/phase210m2/run-tedmeasure.sh`, `frontend/benchmarks/phase210m2/tedmeasure-summarize.ts` (new).
