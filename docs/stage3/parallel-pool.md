# Parallel native solves for Precise: the solve pool (measured)

Owner-approved production change (2026-10-13), branch `perf/ted-seed-incumbent`, base `1ed02a3` (release PR #43 tip, the split-only shortcut and the
tolerance/overhead measurement). Goal: the same answers (status, certificate, score, published bounds and the same returned build) with lower wall
time on the slow TrueErgo guns, where HiGHS's own run is 95 to 97% of a request and second opinions about 38% (`ted-tolerance-and-overhead.md`).

**Result.** With the default pool of 3 lanes the 55 latency requests below take 35% less wall time (551.5 s -> 358.9 s, median of two repeats;
TrueErgo -40%, TrueErgo + Prevent Overswing -29%, plain -32%); all 172 pinned guns TrueErgo take 40% less summed request time (685.5 s -> 414.0 s,
p90 13.8 s -> 8.1 s, max 25.1 s -> 16.1 s); and every answer is identical to pool size 1: 172 of 172 (status, certificate, score, published bounds,
node count, native solves, second opinions and a hash of the returned build), and 55 of 55 in each of the 8 latency runs.

## Design as built

### The pool (`frontend/src/solver/native/pool.ts`, `poolWorker.ts`, `poolProtocol.ts`)

- N lanes, each a worker holding its own instance of the pinned HiGHS build, loaded by the unchanged `loadHighs`: the same `highs.js` / `highs.wasm`,
  the SHA-256 check before any of their code runs, the ABI validation and the known-answer solve. Browser: a dedicated module Worker nested in the
  solver worker (`new Worker(new URL('./poolWorker.ts', import.meta.url), { type: 'module' })`; Vite emits it as `dist/assets/poolWorker-*.js`, and
  the solver worker passes its configured base URL so the pool worker fetches `highs.js` / `highs.wasm` from the same place). Node (tests,
  benchmarks): a `worker_threads` worker on the same file.
- **Every lane is a worker; size 1 is no pool.** With N >= 2 every Precise solve runs in a pool worker and the solver worker only orchestrates, so
  its event loop stays free: a lane's result is dispatched (and the lane handed its next job) while another lane is still solving, and an
  out-of-band cancel is observed at once. An in-thread lane would block that loop for the length of its solve and serialize the dispatch. Pool
  size 1 is exactly today's path (the in-thread shared instance, no worker, no early solve). Deviation from the brief's "N extra instances": a pool
  of N is N workers; the in-thread instance is still loaded by whatever else uses it (Fast), and a Precise-only session never loads it.
- Default size `min(max(1, hardwareConcurrency - 1), 3)` in a browser; 1 in Node, whose callers (tests, benchmarks) hook the in-thread instance and
  opt in with `configureNativePool({ size })` (bench `--pool <n>`).
- Feature detection and fallback: no `Worker` in the context, a worker that reports a load error, one that fires an error event before it is ready
  (the desktop app's embedded Chromium cannot start nested workers at all and does exactly this), or one that does not load within 30 s makes the
  pool unavailable, and Precise runs on the in-thread instance (size 1). Never another HiGHS. If a running pool later loses every worker and cannot
  reload one, the request continues on the in-thread instance.
- Scheduling: each solve is a job with a priority (0 = the pipeline waits for it, 1 = a speculative second opinion, 2 + r = a prefetch for the r-th
  upcoming node); FIFO within a priority. A priority-0 job that finds no idle lane preempts the least urgent running prefetch (its worker is
  terminated and replaced, the prefetch requeued). An abandoned job is dropped from the queue or, when running, its worker is terminated and
  replaced (spawn and load: about 130 ms for a Node worker under tsx, about 50 ms for a nested worker in Chrome).
- Crashes: a worker that crashes is replaced and its job retried once; a second crash is `PoolWorkerCrashError` (a `SolverError`), which Precise
  treats as an INCONCLUSIVE solve and moves on to the next seed, like HiGHS's `SolveError` (owner 2026-10-12: retry seeds, never throw). Typed errors
  of a solve (`ModelReadError`, `HighsOptionError`, a `SolverError` from a trap inside the worker) cross the boundary as the same classes, so the
  existing typed-error rules apply unchanged.
- Workers are created once (on the first Precise request) and reused by every later request.

### Early solves (`frontend/src/solver/physical/speculativeSolves.ts`, wiring in `solvePrecise.ts`, hint in `search.ts`)

The pipeline (search, opinions, settlement, the split-only shortcut, relaxed-first fallback, cuts) is unchanged and still makes its solves one after
the other. Every solve it makes goes through `RequestSolves.solve`, which hands over the answer of an early solve of exactly that text with exactly
those options (every option and structured-result request except the time allowance), or starts the solve now. Early solves:

1. **Speculative second opinions** (`PRECISE_SPECULATION = 'always'`): when a node text's first opinion starts, the seed its second opinion would use
   starts too, on another lane. If the first is inconclusive the early solve becomes the next first opinion (exactly as sequentially); if it leads
   only to a split (decision F1') or needs no confirmation, the early solve is abandoned unread. The third seed starts only on a disagreement, as
   before. MOA floor queries never speculate.
2. **Prefetched nodes** (`prefetchNodes`, default `lanes - 2`): before the search evaluates a node it calls `lookahead(current, upcoming)` with the
   live nodes in the order it would take them; Precise builds the next upcoming node's model and starts its first solve (seed 0 of its relaxed-edge
   text). Early solves of nodes no longer live are abandoned; a node's leftovers when its evaluation ends; everything at the end of the request.

**Interrupts.** While the pipeline waits for a pool solve it polls the guard every 20 ms. A cancel terminates every in-flight solve of the request at
once (the in-thread path only notices it after the running solve finishes) and the waiting call yields an unresolved opinion with `Cancelled by
user`; the pipeline then reports it exactly as before (ADR 0013 section 6 precedence, stage guards and macrotask yields unchanged). The deadline is
enforced by the native time limit as before; a backstop terminates the solves 1 s past the deadline.

**Choice of the speculation rule.** Measured on 6 slow TrueErgo guns (`results/parpool-tune`, one request at a time, seconds summed): pool 1 93.7;
pool 2 80.9; pool 3 67.2 ('always', prefetch 1); pool 3 without prefetch 79.9; pool 3 speculating only where the shortcut cannot apply
('unsplittable') 72.9; pool 4 (prefetch 2) 66.0; pool 3 without preemption 66.6. 'unsplittable' wastes no CPU but loses the latency of every
inexact node that is not split (the leaves of the tree), so 'always' is the default. Over the 55 latency requests at pool 3, 665 early solves were
started, 489 used and 176 abandoned (26% extra CPU, no latency cost); the 722 solves read are the same with and without the pool.

**Parallel children.** Not built as a separate mechanism: prefetching the upcoming nodes is the deterministic form of it. A child's first solve does
not depend on the incumbent, so it can run early; its evaluation (shortcut test, fathoming, ordering) still happens in the sequential order with the
incumbent the sequential search hands it.

## Determinism argument

1. Every solve the pipeline reads is a solve the sequential pipeline makes, with the same text and options: an early answer is looked up by the exact
   text and every option except `time_limit`, and nothing else is ever read from an early solve.
2. A HiGHS solve's answer depends only on the text, the options and `random_seed` (a fresh handle per solve, `threads: 1`, every instance the same
   pinned build): checked directly (`tests/native/pool.test.ts`: a lane returns the in-thread answer field for field, readback included) and end to
   end (below). Only the time allowance differs (an early solve had more time, never less); a solve that finishes within it does not depend on it,
   and one that reaches it is a time-limit stop, which is timing dependent with or without a pool.
3. Therefore the sequence of opinions, `settleOpinions`, every node evaluation, the order the search commits them in, the incumbent, the bounds, the
   node count and the returned build are those of the sequential run, whatever order the lanes finish in. Settlement is untouched, so
   `docs/proofs/count-model.md` is unchanged (Theorem S and Propositions F1/F1' hold as written; its `file:line` citations into `solvePrecise.ts`
   are now offset by the inserted lines).
4. Telemetry: `nativeSolves`, `secondOpinions` and the other counters count solves read, so they are equal too; early solves are reported apart
   (`telemetry.pool`: lanes, started, used, abandoned, direct).

## Measurements

Machine: Windows 11, 8 cores / 16 threads, otherwise idle; Node 26.7, tsx 4.23; 60 s per request; requests as in `bench.ts` (e 1, r 1, p 0.1, flea,
trader level 4, player level 50); `--warmup MP5`. Raw lines under `frontend/benchmarks/phase210m2/results/parpool-*` (gitignored); tables by
`benchmarks/phase210m2/parpool-summarize.ts`.

### (a) Latency, one request at a time, pool size 1 / 2 / 3 / 4

`results/parpool-latency`: the 20 slowest TrueErgo and the 20 slowest TrueErgo + Prevent Overswing guns of the `tol1e-5` run
(`ted-tolerance-and-overhead.md`), 5 medium guns of each profile and 5 plain controls (`jobs.txt`); sizes run 1, 2, 3, 4 then 4, 3, 2, 1; seconds are
the median of the two repeats (`summary.md`). Every request gave the same answer in all 8 runs.

| request | p1 | p2 | p3 | p4 | p2/p1 | p3/p1 | p4/p1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ADAR 2-15 (TrueErgo) | 16.61 | 13.82 | 10.46 | 10.67 | 0.83 | 0.63 | 0.64 |
| AKMN | 18.56 | 13.62 | 9.12 | 9.75 | 0.73 | 0.49 | 0.53 |
| AKMS | 17.29 | 13.83 | 11.68 | 12.27 | 0.80 | 0.68 | 0.71 |
| AK-102 | 15.28 | 12.33 | 11.20 | 10.98 | 0.81 | 0.73 | 0.72 |
| AK-101 | 15.54 | 12.00 | 9.15 | 9.87 | 0.77 | 0.59 | 0.64 |
| AK-105 | 15.05 | 12.05 | 8.74 | 9.46 | 0.80 | 0.58 | 0.63 |
| M16A2 | 15.91 | 12.41 | 9.41 | 9.99 | 0.78 | 0.59 | 0.63 |
| M16A1 | 18.52 | 13.91 | 11.55 | 11.87 | 0.75 | 0.62 | 0.64 |
| PP-19-01 | 12.11 | 8.98 | 8.28 | 8.52 | 0.74 | 0.68 | 0.70 |
| AK-74N | 10.91 | 9.04 | 6.51 | 6.85 | 0.83 | 0.60 | 0.63 |
| AK-104 | 15.56 | 11.74 | 8.73 | 9.11 | 0.75 | 0.56 | 0.59 |
| AKS-74N | 15.49 | 10.19 | 6.80 | 7.29 | 0.66 | 0.44 | 0.47 |
| AKM | 13.08 | 8.01 | 6.87 | 6.94 | 0.61 | 0.53 | 0.53 |
| VPO-136 | 11.44 | 6.93 | 5.85 | 6.90 | 0.61 | 0.51 | 0.60 |
| MPX | 13.89 | 8.43 | 7.60 | 9.26 | 0.61 | 0.55 | 0.67 |
| Saiga-9 | 10.55 | 7.68 | 6.52 | 5.93 | 0.73 | 0.62 | 0.56 |
| HK 416A5 | 10.76 | 6.80 | 6.54 | 6.01 | 0.63 | 0.61 | 0.56 |
| AKS-74UN | 10.39 | 5.69 | 6.40 | 5.89 | 0.55 | 0.62 | 0.57 |
| Model 1 | 15.21 | 9.00 | 9.75 | 7.93 | 0.59 | 0.64 | 0.52 |
| AKS-74 | 10.32 | 7.91 | 5.70 | 5.61 | 0.77 | 0.55 | 0.54 |
| Saiga-12K (medium) | 2.86 | 2.40 | 2.09 | 2.15 | 0.84 | 0.73 | 0.75 |
| AK-545 Short (medium) | 3.09 | 2.34 | 2.19 | 2.23 | 0.76 | 0.71 | 0.72 |
| M700 (medium) | 2.41 | 1.65 | 1.60 | 1.56 | 0.68 | 0.66 | 0.65 |
| Vector 9x19 (medium) | 2.83 | 2.13 | 2.05 | 1.96 | 0.75 | 0.73 | 0.69 |
| OP-SKS (medium) | 1.63 | 1.20 | 1.17 | 1.11 | 0.73 | 0.71 | 0.68 |
| AK-74N (TrueErgo + PO) | 17.14 | 13.64 | 11.45 | 12.29 | 0.80 | 0.67 | 0.72 |
| AK-101 | 15.67 | 12.76 | 13.07 | 13.72 | 0.81 | 0.83 | 0.88 |
| AKS-74N | 14.60 | 10.67 | 11.14 | 12.08 | 0.73 | 0.76 | 0.83 |
| AK-74M | 14.88 | 11.05 | 10.24 | 11.31 | 0.74 | 0.69 | 0.76 |
| ADAR 2-15 | 15.27 | 9.80 | 8.43 | 10.77 | 0.64 | 0.55 | 0.70 |
| AKMN | 12.85 | 9.85 | 8.48 | 10.67 | 0.77 | 0.66 | 0.83 |
| Model 1 | 14.63 | 11.02 | 9.18 | 11.25 | 0.75 | 0.63 | 0.77 |
| M4A1 | 10.23 | 8.14 | 7.06 | 7.39 | 0.80 | 0.69 | 0.72 |
| TX-15 DML | 12.28 | 9.76 | 8.14 | 9.89 | 0.80 | 0.66 | 0.81 |
| AK-104 | 12.01 | 9.01 | 9.47 | 10.35 | 0.75 | 0.79 | 0.86 |
| AKMSN | 12.09 | 9.04 | 10.25 | 12.27 | 0.75 | 0.85 | 1.01 |
| AKS-74 | 10.72 | 8.34 | 9.23 | 9.60 | 0.78 | 0.86 | 0.90 |
| PP-19-01 | 10.19 | 8.53 | 7.58 | 8.68 | 0.84 | 0.74 | 0.85 |
| VPO-136 | 9.60 | 7.07 | 6.16 | 7.00 | 0.74 | 0.64 | 0.73 |
| AK-103 | 9.77 | 7.82 | 7.46 | 9.34 | 0.80 | 0.76 | 0.96 |
| AKS-74UN | 9.11 | 7.03 | 6.75 | 8.91 | 0.77 | 0.74 | 0.98 |
| M16A1 | 11.61 | 8.72 | 7.45 | 9.15 | 0.75 | 0.64 | 0.79 |
| Mk 16 | 9.11 | 7.04 | 6.22 | 6.60 | 0.77 | 0.68 | 0.72 |
| M16A2 | 8.75 | 7.06 | 5.50 | 6.37 | 0.81 | 0.63 | 0.73 |
| HK 416A5 | 8.69 | 6.87 | 6.59 | 5.52 | 0.79 | 0.76 | 0.64 |
| UZI PRO SMG (medium) | 3.89 | 2.80 | 3.23 | 2.58 | 0.72 | 0.83 | 0.66 |
| Saiga-12K (medium) | 2.41 | 2.06 | 2.25 | 1.91 | 0.85 | 0.93 | 0.79 |
| RPD (medium) | 3.26 | 2.56 | 2.35 | 2.02 | 0.79 | 0.72 | 0.62 |
| AK-12 (medium) | 1.75 | 1.61 | 1.24 | 1.15 | 0.92 | 0.71 | 0.66 |
| AS VAL (medium) | 1.33 | 1.12 | 1.11 | 0.94 | 0.84 | 0.83 | 0.70 |
| M4A1 (plain) | 1.58 | 0.93 | 0.98 | 0.97 | 0.59 | 0.62 | 0.61 |
| AKMS (plain) | 0.24 | 0.19 | 0.21 | 0.20 | 0.81 | 0.88 | 0.85 |
| MP5 (plain) | 0.04 | 0.03 | 0.03 | 0.03 | 0.83 | 0.76 | 0.70 |
| AK-74N (plain) | 1.40 | 0.92 | 0.96 | 0.92 | 0.66 | 0.68 | 0.66 |
| ADAR 2-15 (plain) | 1.07 | 0.73 | 0.76 | 0.74 | 0.69 | 0.71 | 0.70 |
| **TrueErgo total (25)** | 295.3 | 214.1 | 176.0 | 180.1 | 0.73 | 0.60 | 0.61 |
| **TrueErgo + PO total (25)** | 251.9 | 193.3 | 180.0 | 201.8 | 0.77 | 0.71 | 0.80 |
| **plain total (5)** | 4.3 | 2.8 | 2.9 | 2.9 | 0.65 | 0.68 | 0.66 |
| **all 55** | 551.5 | 410.2 | 358.9 | 384.7 | 0.74 | 0.65 | 0.70 |

Per repeat (all 55): pool 1 560.1 / 542.8 s, pool 2 431.9 / 388.6, pool 3 366.7 / 351.2, pool 4 395.5 / 373.9. Reading: pool 3 is the best
setting. A fourth lane only adds CPU: its extra prefetch runs beside the other solves and slows them, which costs the Prevent Overswing guns (more
nodes the search later fathoms) part of their gain. The slowest request falls from 18.6 s to 11.7 s (TrueErgo) and from 17.1 s to 13.1 s (PO); the
slow PO AK guns gain least, because their many split-only nodes leave little to overlap but the prefetch.

### (b) All 172 guns, TrueErgo: answers identical to pool size 1

`results/parpool-all`: `run.sh` with `--pool 1` over 12 processes, then `--pool 3` over 5 processes (15 solve threads on 16).

| run | cert. optimal | cert. infeasible | other | summed request s | median s | p90 s | max s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pool 1, 12 processes | 153 | 19 | 0 | 685.5 | 0.54 | 13.8 | 25.1 |
| pool 3, 5 processes | 153 | 19 | 0 | 414.0 | 0.40 | 8.1 | 16.1 |

`parpool-summarize.ts equal`: **172 of 172 identical** (kind, status, certificate, score, published bounds, nodes, native solves, second opinions,
SHA-256 of the returned build). The pool 3 run is also identical, on every field the older run recorded (status, certificate, score, bounds, nodes,
native solves, second opinions, build statistics), to the `tol1e-5` run of `ted-tolerance-and-overhead.md`, made on `39aab13` before this change.

### Memory (WebAssembly heap per HiGHS instance)

`benchmarks/phase210m2/parpool-memory.ts`, one fresh process per row, one TrueErgo request. "Lane heaps" is the peak wasm memory each lane slot reported
(wasm memory never shrinks; a replaced worker starts again at 64 MiB); peak RSS is the whole Node process (each worker thread also carries a V8
isolate and the tsx loader, which a browser worker does not).

| gun | pool | s | lane heaps (MiB) | wasm total (MiB) | peak RSS (MiB) | workers replaced |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| M4A1 | 1 | 5.15 | 64 (in-thread) | 64 | 316 | 0 |
| M4A1 | 2 | 3.55 | 64, 64 | 128 | 431 | 0 |
| M4A1 | 3 | 3.43 | 64, 64, 64 | 192 | 508 | 1 |
| M4A1 | 4 | 3.30 | 64, 64, 64, 64 | 256 | 567 | 1 |
| AKMS | 1 | 16.45 | 191 (in-thread) | 191 | 346 | 0 |
| AKMS | 2 | 13.12 | 191, 133 | 324 | 517 | 5 |
| AKMS | 3 | 11.19 | 133, 133, 191 | 457 | 615 | 5 |
| AKMS | 4 | 10.99 | 133, 133, 191, 64 | 521 | 656 | 5 |

A lane costs what the in-thread instance costs (64 MiB at start, up to about 190 MiB on the largest guns), and the pool multiplies that by the lanes:
about 0.2 to 0.6 GiB of wasm memory at the default size. Replacing a worker releases its heap. A browser tab with the default pool and an
in-thread instance loaded by Fast can hold four instances.

## Tests

- `frontend/tests/native/pool.test.ts` (real `worker_threads` workers and fake workers): a lane answers exactly what the in-thread instance answers,
  readback included, with solves running at once; typed errors keep their class; an abandoned running solve's worker is replaced and the pool keeps
  solving; crash, retry once, `PoolWorkerCrashError` on the second crash; a load error or an early error event makes the pool unavailable (the
  fallback); priorities and preemption; Node's default size is 1.
- `frontend/tests/physical/solvePrecise.pool.test.ts`: pool size 1 is the direct path; on fake lanes finishing in a seeded random order, under four
  settings (2 to 4 lanes, every speculation rule, prefetch 0 to 3), every scripted decision-5a solver (a lying first, second or third seed, three
  disagreeing seeds, a timed-out second opinion, infeasibility with and without one, inconclusive seeds, a limit-stopped first opinion) in both edge
  modes, and 60 seeded TrueErgo / Prevent Overswing worlds (119 spatial nodes), give the sequential answer exactly with nothing left in flight; a
  cancel and the deadline backstop terminate the in-flight solves and report the right reason; a typed failure travels as in-thread; a double
  worker crash is an inconclusive solve; with real pool workers, a cancel 1.5 s into AKMS TrueErgo is observed within about 40 ms and the pool
  serves the next request.
- `frontend/tests/solver/determinism.test.ts`: pool sizes 1 and 3 give the same response bit for bit on every in-scope ledger case (Precise) and, through
  the worker runtime, on MP5 / SR-25 / M4A1 / AKMS TrueErgo, M4A1 Prevent Overswing and the plain and Sweet Spot pinned requests.

## Browser caveats

- Nested dedicated workers are required: Chrome 69+, Firefox, Safari 15.5+. Checked in Chrome 155 (Playwright) on the production build: a module
  worker's nested `poolWorker-*.js` loaded the pinned build (SHA-256 `e035d2aa...`, 51 ms) and solved. The desktop app's embedded browser pane does
  not start nested workers (even a trivial classic one fires a bare error event): that is the fallback path (pool unavailable, Precise in-thread as
  before), covered by a test.
- Memory: see above. Pool size follows `hardwareConcurrency` only; there is no memory-based sizing.
- Wasted CPU: about a quarter of the early solves are abandoned unread; on a laptop on battery that is extra energy for lower latency.
- Latency was measured in Node, not in a browser. The worker code is the same; a browser worker starts faster than a Node worker under tsx.

## Left out

- Second-seed prefetch for upcoming nodes and a fourth default lane: the fourth lane did not pay (above).
- Memory-aware pool sizing and a user setting for the pool size.
- Interrupting a running HiGHS solve without terminating its worker: the pinned build exports no interrupt callback, and a respawn is cheap.

## Code

`frontend/src/solver/native/pool.ts`, `poolWorker.ts`, `poolProtocol.ts` (new); `loadHighs.ts` / `index.ts` (`getHighsBaseUrl`);
`frontend/src/solver/physical/speculativeSolves.ts` (new); `solvePrecise.ts` (`PreciseContext.lanes`, `speculation`, `prefetchNodes`,
`PRECISE_SPECULATION`, `telemetry.pool`, an inconclusive opinion on `PoolWorkerCrashError`, interrupted opinions); `search.ts`
(`SearchOptions.lookahead`); bench `--pool`, `--speculation`, `--prefetch`, `--preempt`, `--jobs`, `buildSha`; `benchmarks/phase210m2/parpool-memory.ts`,
`parpool-summarize.ts` (new).
