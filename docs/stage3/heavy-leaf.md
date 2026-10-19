# The heavy leaf: an a-priori cap bound for the TrueErgo weight search (measured, in production)

Owner decision (2026-10-18), amending G1 ("Only checked bounds"). Branch `AhaiMk01/opt_sweet_spot`, base `5eabb11` (v3.2.1).

**Result.** Sweet Spot with TrueErgo takes 26% less total time on the 172 pinned guns (1153 s to 852 s, mean of two runs per side). The
ergonomics payoff endpoint takes 68% less (318 s to 101 s). Two requests that hit the 60 s limit now certify (AK-74M, AK-103). Every other
answer is identical. Plain TrueErgo Optimize and Prevent Overswing do not use the bound and do not change.

## The problem

With TrueErgo, every solve runs a branch and bound over total weight (`search.ts`). Each node `[lo, hi]` solves the count model with a secant
of the weight penalty `q(W) = max(0, 100 - 300 / W)`, and its settled bound decides whether the node can be dropped. On the ergonomics endpoint
of the payoff table (weights 100, 0, 0) the heaviest interval left after the first splits, for example AK-74M `[4.16, 14.59]` kg, is 89 to 99%
of the endpoint's time on the slow Precise guns. Its bound ends up 4 to 18% below the incumbent, so it is dropped in the end. HiGHS finds that
leaf's optimum in 0.1 to 0.6 s and spends the rest, 87 to 99% of the leaf, proving it, twice (the second opinion). These numbers are from the
study that preceded this change (2026-10-18, production settings, before the prototype); the tables below are this change's own runs.

## The bound

When the score is exactly `e x TED` (weighted objective, TrueErgo, recoil and price weight 0, no Tchebycheff), the leaf needs no solve:

- `TED = eff - q(W)`, and effective ergonomics is clamped at 100 twice, so `eff <= 100`;
- `q` is nondecreasing, so every build with `W >= lo` has `TED <= 100 - q(lo)`;
- so every build in `[lo, hi]` scores at most `e (100 - q(lo))`.

For AK-74M's heavy leaf that is `100 (100 - q(4.16)) = 7212`, below the incumbent. `aprioriScoreBound` (`frontend/src/solver/physical/proof.ts`)
computes it in exact rationals through the same `exactObjectiveScore` that scores builds. Every node of the search takes the smaller of its
inherited bound and this one (`SearchOptions.aprioriBound`, `search.ts`), so a node it proves hopeless is fathomed with no native solve and no
second opinion. Its bound joins the published upper bound like any fathomed node's. Precise and Fast both pass it. Telemetry counts the nodes it
fathoms (`aprioriFathomedNodes`).

Where it applies: the ergonomics endpoint of every TrueErgo Sweet Spot or Explore payoff table, and any Optimize with recoil and price weight 0,
with or without Prevent Overswing (which only adds `TED >= 0`). Where it does not: the Sweet Spot final solve (Tchebycheff), the default
Optimize weights (1, 1, 0.1), and TrueErgo off.

Why it is sound without a second opinion: `docs/proofs/count-model.md` section 16 (Proposition A). The bound uses no solve, no LP text and no
floating point, only the oracle's own TED definition and exact arithmetic. A node prefetched or speculatively solved early is only ever a
node still live after this fathoming (the search fathoms before it calls `lookahead`).

## How it was measured

- `frontend/benchmarks/phase210m2/bench.ts`, profiles `sweetTrueErgo` (through `solveRequest`, so the real payoff table runs cold every request),
  `trueErgo` and `trueErgoPO` (`solvePrecise` with weights 1, 1, 0.1; Prevent Overswing at gear -30%). All 172 pinned guns, `--pool 3`, 60 s
  per request, `--warmup MP5`, 5 processes, as in `sweet-spot.md`.
- Base: a detached worktree of `5eabb11`. Feature: this branch. Runs interleaved `base1, feat1, base2, feat2`, about 6 minutes each, on a
  machine with no other heavy work. Tables by `benchmarks/phase210m2/sweetspot-summarize.ts`. Raw lines are not committed.

## Results

| profile | run | optimal | infeasible | other | total s | median s | p90 s | max s | endpoint 1 s | endpoint 2 s | endpoint 3 s | table s | final s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sweetTrueErgo | base1 | 160 | 2 | 10 | 1138.3 | 1.28 | 14.54 | 60.17 | 312.8 | 56.5 | 51.7 | 319.8 | 455.2 |
| sweetTrueErgo | base2 | 160 | 2 | 10 | 1168.3 | 1.30 | 14.78 | 60.08 | 324.4 | 60.1 | 54.2 | 332.4 | 472.4 |
| sweetTrueErgo | feat1 | 162 | 2 | 8 | 859.6 | 1.37 | 9.83 | 60.09 | 102.5 | 67.8 | 62.9 | 111.5 | 504.3 |
| sweetTrueErgo | feat2 | 162 | 2 | 8 | 844.2 | 1.31 | 9.04 | 60.12 | 99.2 | 65.0 | 59.6 | 107.4 | 493.8 |
| trueErgo | base1 | 170 | 2 | 0 | 178.3 | 0.23 | 2.58 | 13.44 | | | | | |
| trueErgo | base2 | 170 | 2 | 0 | 184.4 | 0.26 | 2.69 | 12.47 | | | | | |
| trueErgo | feat1 | 170 | 2 | 0 | 194.3 | 0.26 | 3.51 | 13.12 | | | | | |
| trueErgo | feat2 | 170 | 2 | 0 | 189.5 | 0.26 | 2.87 | 13.09 | | | | | |
| trueErgoPO | base1 | 159 | 13 | 0 | 223.8 | 0.25 | 4.80 | 8.77 | | | | | |
| trueErgoPO | base2 | 159 | 13 | 0 | 229.4 | 0.26 | 4.68 | 8.89 | | | | | |
| trueErgoPO | feat1 | 159 | 13 | 0 | 243.9 | 0.30 | 5.18 | 10.55 | | | | | |
| trueErgoPO | feat2 | 159 | 13 | 0 | 235.5 | 0.29 | 5.44 | 9.23 | | | | | |

Table and final sums cover requests whose table was computed. A request whose table failed counts only in the total.

- Sweet Spot TrueErgo: total -26% (1153 -> 852 s), p90 -36% (14.7 -> 9.4 s). The median request does not move (per-request feat/base median
  1.00 to 1.04 over the 94 requests above 1 s): the gain sits in the guns whose ergonomics endpoint was slow.
- The ergonomics endpoint: 318 -> 101 s. Largest per gun (base2 -> feat2): Saiga-12K FA RL 52.5 -> 0.9 s, AUG A3 42.0 -> 1.8 s, AK-101 41.8 ->
  1.7 s, AKS-74N 28.4 -> 1.9 s, RFB 15.8 -> 0.3 s, AK-12 14.5 -> 0.9 s.
- Endpoints 2 and 3 read about 7 s more each and the final solve about 35 s more. AK-74M and AK-103, which now have a table, account for
  2.3 s, 2.4 s and 10 s of that. The rest is not explained by this measurement (each endpoint and final solve is the same code on both sides).
- Timeouts at 60 s: 10 -> 8 Sweet Spot TrueErgo requests. AK-74M and AK-103 had their payoff table time out and now certify. The 8 left are
  M4A1 and M16A2 (final solve 57 to 58 s), Mk 16 x2, Mk 17 and X-17 (an endpoint at the limit, as before), and MP9 and Mk 17 (stop at once on
  "Required proof prerequisite unavailable", as before).
- Plain TrueErgo and Prevent Overswing: the bound is off there (0 nodes fathomed a priori in all 688 feature lines). Feature runs read 3 to 9%
  slower in total, and the run-to-run spread of the same code is 2 to 4% (base2/base1 per-request median 1.04 and 1.02; feat2/base2 1.05 and
  1.01). The only new code on that path is a closure call per created node that returns `null` at once, so this is noise or run order (each
  feature run follows a base run), not a measured cost.

**The ergonomics endpoint alone, Fast and Precise.** The four guns Auto sends to Fast for TrueErgo (AK-74M, AK-101, AK-103, AKS-74N; over 3,000
candidate edges), weights (100, 0, 0) with TrueErgo, one request at a time in one process, pool 3, 60 s, base then feature (one run each):

| gun | Fast base | Fast feature | Precise base | Precise feature |
| --- | --- | --- | --- | --- |
| AK-74M | 60.0 s, time limit, 4 nodes | 1.8 s, `approximate_optimal`, 7 nodes | 44.1 s, certified, 8 nodes | 2.4 s, certified, 7 nodes |
| AK-101 | 60.0 s, time limit, 4 nodes | 0.7 s, `approximate_optimal`, 5 nodes | 26.8 s, certified, 6 nodes | 0.7 s, certified, 5 nodes |
| AK-103 | 60.0 s, time limit, 4 nodes | 1.1 s, `approximate_optimal`, 7 nodes | 60.0 s, time limit, 8 nodes | 1.5 s, certified, 7 nodes |
| AKS-74N | 60.0 s, time limit, 4 nodes | 1.0 s, `approximate_optimal`, 7 nodes | 18.1 s, certified, 8 nodes | 0.9 s, certified, 7 nodes |

Each feature run fathomed exactly one node a priori, the heavy leaf. Fast's four timeouts were stuck in that leaf (4 nodes in 60 s). In the
feature, Fast returns the same score and build as its own base incumbent on AK-74M, AK-101 and AK-103, and a better one on AKS-74N (8866.8 ->
8935.7, the Precise optimum). Precise returns the same score, published bounds and build where the base certified, and certifies AK-103,
which timed out.

## What limits the remaining time

Sweet Spot TrueErgo is now 852 s: about 107 s of payoff tables, about 494 s of final Tchebycheff solves (M4A1 and M16A2 at 57 to 58 s
each included) and 240 s for the four requests whose table still runs to 60 s (Mk 16 x2, Mk 17, X-17). The final solve is the limiter. The bound does not apply to it: the Tchebycheff score has a max over deviations, and the recoil and price axes
enter with nonzero weight. Its heavy intervals still need settled bounds. The ergonomics endpoint left is 101 s, spread over many guns (the
largest single endpoint is AK-74N at 3 to 4 s), each a short chain of light nodes that genuinely need solving.

## Answer check

Fields compared per request: status, certificate, reason, score, published bounds, ideal point, endpoint records, build hash.

| comparison | identical | differences |
| --- | ---: | ---: |
| `base1` vs `base2` | 516 | 0 |
| `feat1` vs `feat2` | 516 | 0 |
| `base1` vs `feat1`, `base2` vs `feat2`, `base1` vs `feat2`, `base2` vs `feat1` | 514 | 2 |

The 2 differences are the same in every pair: AK-74M and AK-103 Sweet Spot TrueErgo, `incomplete` (time limit, no table) in base and
`certified_optimal` in the feature. No published upper bound moved on any other request, including the 160 base optima. A fathomed node's
bound enters the upper bound, and the a-priori bound replaces a settled one there, but the joined maximum was set elsewhere on every gun.

## Tests

- `frontend/tests/physical/aprioriBound.test.ts`: the bound against the independent oracle. On every in-scope ledger fixture made heavy
  (receiver +2.5 kg, each part `3 w + 1` kg, receiver ergonomics +60), ergonomics weights 1, 100 and 0.3, with and without Prevent Overswing, the
  bound of an interval starting at or below each build's weight is at least the build's oracle score (3,657 builds, 510 of them meet it
  exactly). Precise on the same fixtures returns the oracle optimum with a published upper bound at least the optimum, fathoms nodes a priori,
  and fathoms none with a recoil weight. The bound is `null` with a recoil or price weight, under Tchebycheff and with TrueErgo off.
- `frontend/tests/physical/search.test.ts`: a hopeless interval is never evaluated, never handed to `lookahead`, and the incumbent and certificate
  are kept; a stopped search publishes the a-priori bound of a node it never evaluated.
- No pinned determinism or telemetry test changed: they compare runs with each other or use weights the bound does not apply to.

## Code

- `frontend/src/solver/physical/proof.ts`: `aprioriScoreBound`.
- `frontend/src/solver/physical/search.ts`: `SearchOptions.aprioriBound`, `SearchResult.aprioriFathomed`.
- `frontend/src/solver/physical/solvePrecise.ts`, `solveFast.ts`: pass the bound; telemetry `aprioriFathomedNodes`.
- `docs/proofs/count-model.md` section 16.
