# Incumbent seeding of the Precise weight search (measured, not adopted)

Owner-approved experiment (2026-10-13), branch `perf/ted-seed-incumbent`. Idea credited to EFTForge (AGPL-3.0); implemented from a
description only, no code read.

## What was built

- `frontend/src/solver/physical/tedSeed.ts`: before the spatial search, solve the ordinary count model of the request with TED stated against
  `max(0, t(W))`, `t` the tangent of `q(W) = max(0, 100 - 300 / W)` at an anchor weight (slope `300 / W0^2`, 0 at or below 3 kg). That objective
  minorizes the exact one and touches it at the anchor, so re-anchoring at the found build's weight is a minorize-maximize step (the exact score
  never drops). Schedule: plain objective, re-anchored until the slope repeats (at most 4 steps), then anchors 4, 5, 7, 10 kg not already
  covered; at most 6 solves and 15% of the remaining time; cancel/deadline checked with a macrotask yield before every solve.
- Witness-only: the seed model (`specializeFast` option `witnessPenalty`) is never certified (no proof record); seed solves get no second
  opinion and their dual bounds and infeasibility verdicts are discarded. Each point goes through `decodeFast`, the independent validator and
  the same exact scoring as node candidates (`verifiedCandidate`); the best one becomes `SearchOptions.initialIncumbent`. Soundness:
  Proposition W in `docs/proofs/count-model.md` (Theorem S unaffected).
- `PreciseContext.tedSeed` / `PRECISE_TED_SEED`, telemetry `summary.telemetry.seed` (`seedSolves`, `seedMs`, `seedCandidates`, `seedAnchors`,
  `seedScore`, `seedStop`, `seedWasFinal`), `bench.ts --seed on|off`, tests `frontend/tests/physical/tedSeed.test.ts`.

## Result (172 pinned guns, 60 s, 12 processes; full tables in `frontend/benchmarks/phase210m2/results/summary-tedseed.md`)

| profile | run | runs | cert. optimal | cert. infeasible | other | total s | median s | max s | nodes | search solves | seed solves | 2nd opinions | seed s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | s3fix2 (existing) | 172 | 153 | 19 | 0 | 138.8 | 0.1 | 8.5 | 153 | 310 | 0 | 153 | 0.0 |
| plain | tedseedOff | 172 | 153 | 19 | 0 | 100.4 | 0.1 | 5.2 | 153 | 310 | 0 | 153 | 0.0 |
| plain | tedseedOn | 172 | 153 | 19 | 0 | 127.0 | 0.1 | 8.6 | 153 | 310 | 0 | 153 | 0.0 |
| trueErgo | s3fix2 (existing) | 172 | 153 | 19 | 0 | 1154.5 | 0.8 | 53.8 | 730 | 1474 | 0 | 730 | 0.0 |
| trueErgo | tedseedOff | 172 | 153 | 19 | 0 | 962.1 | 0.7 | 42.9 | 730 | 1474 | 0 | 730 | 0.0 |
| trueErgo | tedseedOn | 172 | 153 | 19 | 0 | 1476.6 | 1.0 | 56.9 | 730 | 1474 | 688 | 730 | 379.9 |
| trueErgoPO | poAfter (existing) | 172 | 143 | 29 | 0 | 847.2 | 0.6 | 37.5 | 748 | 1463 | 0 | 701 | 0.0 |
| trueErgoPO | tedseedOff | 172 | 143 | 29 | 0 | 862.4 | 0.6 | 37.5 | 748 | 1463 | 0 | 701 | 0.0 |
| trueErgoPO | tedseedOn | 172 | 143 | 29 | 0 | 1248.1 | 0.9 | 55.5 | 748 | 1463 | 690 | 701 | 304.6 |

- Certificates and scores identical in all 516 paired runs.
- The seed was the final certified optimum in 104 of 121 seeded TrueErgo and 92 of 121 Prevent Overswing requests, yet nodes, search solves and
  second opinions are identical on every gun: no node was saved. A node is split while its settled bound exceeds the optimum by more than the
  tolerance, so the node count is set by the secant bounds, and the unseeded best-first search already holds the optimum before any node
  could be fathomed by it. An exact optimal seed saves nothing, so the Fast-TED seed alternative cannot either and was not run.
- Cost: TrueErgo 962 s -> 1,477 s, Prevent Overswing 862 s -> 1,248 s (the slowest guns each pay the full 9 s budget).

**Decision (owner, 2026-10-13): dropped.** The seeding code was measured on branch `perf/ted-seed-incumbent` and removed before commit; only this record is kept. The file and option names above describe the measured prototype, not current code.

## Where the time actually goes

Second opinions are 49% of TrueErgo wall time (474 of 962 s) and 48% with Prevent Overswing (414 of 862 s). Almost every TED node finds a
verified build (the relaxed-edge optimum is integral), so decision F1's split-only shortcut, which requires "no verified build", fired on 0
TrueErgo nodes and 47 Prevent Overswing nodes. A node whose first opinion bound is more than the tolerance above both the incumbent and its own
build is split whatever the second opinion says; letting such a node split without a second opinion (keeping its build as a witness) would
remove most second opinions on internal nodes. That is a change to owner decision F1 and needs the owner.
