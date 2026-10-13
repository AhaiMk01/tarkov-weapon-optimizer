# Sweet Spot: payoff table timing and two changes (measured)

Branch `perf/ted-seed-incumbent`, base `13c0966` (the native solve pool). Working tree, uncommitted. Goal: a faster Sweet Spot request with the
same answers.

**Result.** Concurrent endpoints are in production. They give the same answers (344 of 344 requests identical to the sequential code) and save
about 30% of the payoff table on plain Sweet Spot (about 10% of the whole plain request). On Sweet Spot with TrueErgo they save nothing measurable.
The second change, skipping the weight search on endpoints without ergonomics weight, was tried and not adopted (owner decision): it changes
answers on most TrueErgo guns and would save at most about 4%. Its code was removed.

## What Sweet Spot runs

A Sweet Spot request (`use_tchebycheff`) needs a payoff table (ideal and nadir point) before its own solve.

1. `computePayoff` (`src/solver/solver.ts`) runs three endpoint solves with weights (100, 0, 0), (0, 100, 0) and (0, 0, 100). Each must end
   `optimal`, or the request stops with that endpoint's reason.
2. The ideal and nadir come from the three builds' axes: `zE = max fE`, `nadE = min fE`, and the same for recoil and price.
3. The final solve uses the augmented Tchebycheff objective with that table.

One `timeLimitMs` (60 s here) covers the endpoints and the final solve. With TrueErgo every solve, endpoints included, runs the spatial search over
weight. The worker caches a table only when all three endpoints are certified Precise optima; a cache hit skips step 1.

## How it was measured

- `benchmarks/phase210m2/bench.ts`, profiles `sweetPlain` (default request weights e 1, r 1, p 0.1, flea, trader level 4, player level 50, Precise)
  and `sweetTrueErgo` (the same with TrueErgo). They go through the public `solveRequest`, so the real `computePayoff` runs with no endpoint cache:
  every request computes a cold table.
- Each line records total ms, the three endpoint ms, the table ms and the final ms (`PayoffReport.timing`, telemetry only), the endpoint records,
  status, certificate, score, published bounds, ideal point, and a hash of the returned build (preset and placements).
- 172 pinned guns x 2 profiles, `--pool 3`, 60 s per request, `--warmup MP5`, 5 processes (15 solve threads on 16, as in
  `parallel-pool.md`). Tables by `benchmarks/phase210m2/sweetspot-summarize.ts`. Raw lines: `benchmarks/phase210m2/results/sweetspot/`
  (gitignored).
- Machine noise is large. The first baseline run (`base`) was slower than its repeat (`base2`, same code) by 24% on TrueErgo and 43% on plain,
  because other work ran on the machine during it. The tables below use `base2` and two runs of the final code (`final`, `final2`). `base` is kept
  for the answer check only.

## Baseline (sequential endpoints, run `base2`)

| profile | optimal | infeasible | other | total s | median s | p90 s | max s | endpoint 1 s | endpoint 2 s | endpoint 3 s | table s | final s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sweetPlain | 147 | 19 | 6 | 111.4 | 0.31 | 1.54 | 5.60 | 20.9 | 14.4 | 9.2 | 47.5 | 62.1 |
| sweetTrueErgo | 145 | 19 | 8 | 1403.1 | 1.86 | 23.23 | 60.07 | 282.9 | 36.1 | 20.7 | 342.8 | 693.0 |

Endpoint 1 is ergonomics (100, 0, 0), 2 recoil, 3 price. Table and final sums cover the requests whose table was computed; a request whose table
failed counts only in the total.

- Plain: the table is 43% of the request time.
- TrueErgo: the table is 24%, and 83% of the table is the ergonomics endpoint (a TrueErgo search with ergonomics weight 100). The final solve is half
  of all time.
- "Other" are 8 TrueErgo requests at the 60 s limit (an endpoint or the final search) and 6 plain requests whose table stops at once with
  "Required proof prerequisite unavailable" (Mk 16 x2, Mk 17 x2, AKMSN, X-17).

Warm cache (`basewarm`, 6 guns, the second request reuses the table through an `EndpointCache`): the warm request costs about the final solve; the
answer was the same in all 14 requests. Worker replacement after the cold request makes some warm requests slower than the cold one (MP5 TrueErgo
1.16 s cold, 2.22 s warm): replaced pool workers start with cold WebAssembly code.

| gun | profile | cold s | table s | warm s |
| --- | --- | ---: | ---: | ---: |
| OP-SKS | sweetPlain | 0.73 | 0.38 | 0.24 |
| OP-SKS | sweetTrueErgo | 4.96 | 1.27 | 2.97 |
| M700 | sweetPlain | 2.56 | 1.20 | 0.84 |
| M700 | sweetTrueErgo | 7.02 | 2.03 | 4.61 |
| AK-12 | sweetPlain | 0.40 | 0.16 | 0.23 |
| AK-12 | sweetTrueErgo | 23.12 | 18.30 | 7.55 |
| SR-25 | sweetTrueErgo | 5.58 | 2.41 | 3.71 |

## Change 1: concurrent endpoints (in production)

`computePayoff` checks the guard once, starts the three endpoints together and waits for all of them. Option `PayoffOptions.concurrent`
(`configurePayoff`), default on; bench flag `--payoff-concurrent on|off`.

Why the answer is the same:

- The endpoints are independent `solveDetailed` calls. Each native solve depends only on its LP text and options (fresh handle, `threads: 1`,
  fixed seed; `parallel-pool.md`), so the order the endpoints run in, or which lane runs a solve, does not change any solve that finishes within
  its time allowance.
- The outcomes are read in weight order. The error reported is the one of the first failing endpoint, as the sequential loop reports it, even
  when a later endpoint fails first in time. A thrown error stays a thrown error.
- Once an endpoint has failed, the later endpoints are stopped through their own guard (`abortableGuard`); their answers could never be reported.
- Shared state checked: the pool queue and its priorities serve several `RequestSolves` at once (each request's early solves and abandonment are
  per request); `acquireNativePool` shares one promise; the blueprint and structure memos are synchronous; the guard, the deadline and the macrotask
  yields are shared and read-only; there is no progress reporting in this path; the endpoint cache is written after the table, as before.
- One fix was needed: the in-thread HiGHS instance (pool size 1, Fast, or the browser fallback). Two concurrent calls could interleave at the
  `await` in `NativeHighs.solveStructured`: one call traps and discards the instance, the other then ran on the discarded one. The call now
  re-checks the instance in the same synchronous step as the native call (`native.ts`).
- Yields: one macrotask yield after the table instead of one after each endpoint. The cancel is still seen at once: on a pool the waiting
  calls poll the guard every 20 ms; the endpoint searches yield before each node.

## Change 2: no weight search on endpoints without ergonomics weight (tried, not adopted)

Tried: with TrueErgo and Prevent Overswing off, run the recoil and price endpoints (ergonomics weight 0) as plain solves without the weight search,
and read their ergonomics axis as `10 x TED` of the returned build from the validator's exact statistics. The optimum and certificate are the same
(TED has coefficient exactly 0 in the objective and is in no constraint). Not adopted (owner, 2026-10-13), and the code was removed, because:

- the table is computed from **a** maximizer of each endpoint, and the recoil and price endpoints are often tied (parts that change neither recoil
  nor price but change ergonomics or weight). The plain solve returned another maximizer than the weight search: the nadir (`nadE`, `nadP`, `nadR`)
  and so the Sweet Spot answer moved on **107 of 172** TrueErgo guns (for example M4A1 `nadE` -197.4 -> 78.5, score -0.05858 -> -0.06491;
  SR-25 `nadE` -214.2 -> -519.5);
- on **4** guns (Mk 16 x2, Mk 17, X-17) the failure reason changed: the plain recoil endpoint stops at once on "Required proof prerequisite
  unavailable" where the TrueErgo endpoint ran to the 60 s limit;
- the gain is small: endpoints 2 and 3 are 57 s of 1403 s TrueErgo request time in `base2` (**at most about 4%**).

Plain Sweet Spot was not affected (the skip only applied to TrueErgo). Raw lines: run `after` (concurrent + skip) under `results/sweetspot/`.

## After (concurrent endpoints)

All 172 guns, same settings:

| profile | run | optimal | infeasible | other | total s | median s | p90 s | max s | endpoint 1 s | endpoint 2 s | endpoint 3 s | table s | final s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sweetPlain | base2 | 147 | 19 | 6 | 111.4 | 0.31 | 1.54 | 5.60 | 20.9 | 14.4 | 9.2 | 47.5 | 62.1 |
| sweetPlain | final | 147 | 19 | 6 | 90.0 | 0.21 | 1.30 | 5.01 | 21.8 | 24.0 | 21.8 | 28.5 | 60.0 |
| sweetPlain | final2 | 147 | 19 | 6 | 99.5 | 0.24 | 1.45 | 6.67 | 24.5 | 26.7 | 24.5 | 31.5 | 66.3 |
| sweetTrueErgo | base2 | 145 | 19 | 8 | 1403.1 | 1.86 | 23.23 | 60.07 | 282.9 | 36.1 | 20.7 | 342.8 | 693.0 |
| sweetTrueErgo | final | 145 | 19 | 8 | 1345.3 | 1.69 | 23.73 | 60.10 | 298.9 | 69.1 | 62.3 | 303.3 | 677.0 |
| sweetTrueErgo | final2 | 145 | 19 | 8 | 1421.1 | 1.76 | 24.17 | 60.20 | 331.1 | 77.6 | 68.9 | 335.6 | 719.5 |

With concurrent endpoints each endpoint takes longer (they share the lanes), and the table takes as long as the slowest endpoint.

- Plain: table 47.5 s -> 28.5 / 31.5 s (-37%), total 111.4 -> 90.0 / 99.5 s (-15%).
- TrueErgo: table 342.8 -> 303.3 / 335.6 s, total 1403.1 -> 1345.3 / 1421.1 s: within the noise. The ergonomics endpoint is most of the table, and
  on a pool it already uses all three lanes (speculative second opinions and prefetched nodes), so the other two endpoints have no idle lane to
  run on.

Single-request latency (one process, one request at a time, which is what a browser tab does), the 10 TrueErgo and 8 plain requests with the
largest table in `base2`, sequential vs concurrent, median of two repeats each (`results/sweetspot/lat*`):

| request | off s | on s | on/off | off table s | on table s |
| --- | ---: | ---: | ---: | ---: | ---: |
| AK-101 (TrueErgo) | 37.36 | 37.15 | 0.99 | 26.44 | 26.24 |
| AUG A3 (TrueErgo) | 20.49 | 20.82 | 1.02 | 18.19 | 18.49 |
| AUG A3, second id (TrueErgo) | 16.30 | 16.62 | 1.02 | 14.15 | 14.48 |
| AK-12 (TrueErgo) | 20.94 | 21.25 | 1.01 | 15.78 | 15.90 |
| AK-74M (TrueErgo) | 30.08 | 30.64 | 1.02 | 14.85 | 14.94 |
| RFB (TrueErgo) | 11.63 | 11.97 | 1.03 | 9.57 | 9.88 |
| AKMN (TrueErgo) | 19.08 | 19.01 | 1.00 | 8.75 | 8.49 |
| AK-545 (TrueErgo) | 12.05 | 12.26 | 1.02 | 8.94 | 9.00 |
| Saiga-9 (TrueErgo) | 10.23 | 10.58 | 1.03 | 7.93 | 8.25 |
| AK-545 Short (TrueErgo) | 11.23 | 11.20 | 1.00 | 8.48 | 8.40 |
| M4A1 (plain) | 2.81 | 2.39 | 0.85 | 1.26 | 0.86 |
| ADAR 2-15 (plain) | 3.10 | 2.65 | 0.85 | 1.30 | 0.85 |
| TX-15 DML (plain) | 4.60 | 3.86 | 0.84 | 1.26 | 0.79 |
| M16A2 (plain) | 2.34 | 2.10 | 0.90 | 1.10 | 0.82 |
| M16A1 (plain) | 2.30 | 2.07 | 0.90 | 1.02 | 0.77 |
| Model 1 (plain) | 3.91 | 3.83 | 0.98 | 1.00 | 0.79 |
| AKMN (plain) | 1.25 | 1.05 | 0.84 | 0.68 | 0.50 |
| AK-74N (plain) | 1.16 | 0.91 | 0.78 | 0.70 | 0.46 |
| **TrueErgo total (10)** | 189.4 | 191.5 | 1.01 | 133.1 | 134.1 |
| **plain total (8)** | 21.5 | 18.9 | 0.88 | 8.3 | 5.8 |

Every request gave the same answer in all four runs.

## Identical answers

Fields compared per request: status, certificate, reason, score, published bounds, ideal point, endpoint records, build hash.

| comparison | identical | differences |
| --- | ---: | ---: |
| `base2` (sequential) vs `final2` (concurrent) | 344 | 0 |
| `final` vs `final2` | 344 | 0 |
| `base` vs `base2` (same sequential code) | 337 | 7 |
| `base` vs `final` / `final2` | 337 | 7 |
| `base` vs `conconly` (concurrent, TrueErgo only) | 167 of 172 | 5 |

Every difference is a request that hit the 60 s limit in the slow `base` run and finished in the other run: M4A1, Model 1, ADAR 2-15, AKS-74U,
AKMN and AK-105 TrueErgo went from `feasible` (time limit) to `certified_optimal` with the same score and the same build; AK-101 TrueErgo went from
`incomplete` (table timed out) to `certified_optimal`. A time-limit stop depends on timing with or without the change.

## Tests

- `frontend/tests/solver/sweetSpot.test.ts` (new): sequential vs concurrent bit for bit, also with the endpoints finishing in reverse order, in
  both models, under TrueErgo, Prevent Overswing and on an empty request; error precedence (a later endpoint
  failing first does not win; a factual stop of endpoint 1 wins over a thrown error of endpoint 3; emptiness); later endpoints stopped after a
  failure; a cancel during the endpoints; real pool workers: a cancel 0.8 s into AKMS Sweet Spot TrueErgo is seen within about 20 ms and the pool
  serves the next request.
- `frontend/tests/runtime/solveGuard.test.ts`: the yield-count test now pins the sequential mode, and a new test covers the concurrent mode.
- `frontend/tests/native/lifecycle.test.ts`: two concurrent in-thread calls, the first traps; the second runs on a fresh instance (fails without the
  `native.ts` fix).
- `frontend/tests/solver/determinism.test.ts`: pinned Sweet Spot requests (MP5 plain, MP5 and SR-25 TrueErgo, MP5 TrueErgo + Prevent Overswing),
  pool 1 and 3, sequential and concurrent: bit for bit.

## Open items

- The payoff table depends on which maximizer an endpoint returns (the skip trial above showed how much). A lexicographic tie-break per endpoint (for example,
  among builds with the best recoil, the best ergonomics, then the lowest price) would make the nadir well defined. It changes answers and costs
  extra solves; not done.
- Where TrueErgo Sweet Spot time goes: the ergonomics endpoint (283 s) and the final solve (693 s) of 1403 s. Concurrency cannot help there. The
  ergonomics endpoint is the same request as a TrueErgo Optimize with weights (100, 0, 0); the Precise TrueErgo speedups apply to it unchanged.
- Six plain and up to four TrueErgo requests stop on "Required proof prerequisite unavailable" in an endpoint (a withheld objective coefficient).
  Not investigated here.
- The warm request is sometimes slower than the cold one because pool workers replaced at the end of the cold request start with cold
  WebAssembly code.

## Code

- `frontend/src/solver/solver.ts`: `PayoffOptions`, `configurePayoff`, `solveEndpoint` (with a test seam), `abortableGuard`, concurrent
  `computePayoff`, `PayoffReport.timing`.
- `frontend/src/solver/native/native.ts`: re-check the instance after the `await` in `solveStructured` and `readbackModel`.
- `frontend/benchmarks/phase210m2/bench.ts`: profiles `sweetPlain`, `sweetTrueErgo`, flags `--warm`, `--payoff-concurrent`;
  `frontend/benchmarks/phase210m2/sweetspot-summarize.ts` (new).
- `docs/proofs/count-model.md` section 14 (concurrent endpoints).
