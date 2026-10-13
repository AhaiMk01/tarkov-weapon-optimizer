# Split-only shortcut with a witness (decision F1 extended, measured)

Owner-approved trial (2026-10-13), amending owner decision F1 (2026-10-12). Branch `perf/ted-seed-incumbent`, base `bd076ed`. The working tree makes
the extension production's default; whether it stays is the owner's call on this measurement.

## The rule

Decision F1 let a node skip its second opinion when the first opinion was a qualified Optimal of an inexact node with NO verified build, a
split point, and a bound that would not fathom the node. Almost every TrueErgo node finds a verified build (the relaxed-edge optimum is
integral), so F1 fired on 0 TrueErgo nodes and 47 Prevent Overswing nodes, while second opinions took about half of TrueErgo time
(`ted-seed.md`).

Extended rule (`leadsOnlyToSplit`, mode `'witness'`, production default `PRECISE_SPLIT_SHORTCUT`):

- the first opinion is a qualified Optimal of an inexact node with an interval, no rejected point and a split point `p`;
- the interval can be split at `p` (a node at the resolution limit needs a settled verdict);
- its proved bound `U` exceeds `R + tolerance`, where `R` is the best exact score among the incumbent, the opinion's own verified build and any
  other build the evaluation hands the search (a build kept from the relaxed try). The search adds those builds to the incumbent before it
  decides, so this is the "clearly above after the node's own build became the incumbent" test; with no incumbent and no build it holds.

Then the node is returned as `split` carrying its verified build as a witness (it may become the incumbent); its single-solve bound is not
published or used (G1), and the children inherit the node's settled-or-unknown bound. Everything else (a bound within the tolerance of the
reference, an unproved bound, an exact node, an Infeasible verdict, a limit stop, a rejected point, an unsplittable interval) takes the full
decision-5a rule. MOA floor queries (`stopAtFirstWitness`, `nativeStop`) keep the 2026-10-12 rule, so their first-witness policy and stop
reasons are unchanged. Proof: `docs/proofs/count-model.md` Proposition F1' (a wrong first bound that is too high only causes a split; one that is
too low either still causes a split or falls within the tolerance and triggers the full second opinion).

Code: `frontend/src/solver/physical/solvePrecise.ts` (`leadsOnlyToSplit`, `splitOnly`, `PRECISE_SPLIT_SHORTCUT`, `PreciseContext.splitShortcut`,
telemetry `splitWitnessNodes`), comments in `search.ts`; bench option `--split-shortcut on|off`; tests
`frontend/tests/physical/solvePrecise.splitWitness.test.ts` (and one updated line in `solvePrecise.splitOnly.test.ts`).

## Measurement

172 pinned guns, Precise, 60 s per request, profiles `plain`, `trueErgo`, `trueErgoPO` (TrueErgo with Prevent Overswing, gear -30%), 12
processes, `frontend/benchmarks/phase210m2/run.sh`, labels run back to back on the same machine: `splitOff` (`--split-shortcut off`, the
2026-10-12 rule) then `splitOn` (`--split-shortcut on`). Results: `frontend/benchmarks/phase210m2/results/split{Off,On}-*.jsonl`, tables in
`results/summary-splitext.md`.

| profile | run | cert. optimal | cert. infeasible | other | total s | median s | max s | nodes | native solves | 2nd opinions | 2nd-opinion s | split-only nodes | with a build |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | off | 153 | 19 | 0 | 108.5 | 0.11 | 5.8 | 153 | 310 | 153 | 50.7 | 0 | 0 |
| plain | on | 153 | 19 | 0 | 103.3 | 0.10 | 5.1 | 153 | 310 | 153 | 49.3 | 0 | 0 |
| trueErgo | off | 153 | 19 | 0 | 1079.4 | 0.76 | 49.9 | 730 | 1474 | 730 | 527.8 | 0 | 0 |
| trueErgo | on | 153 | 19 | 0 | 868.8 | 0.63 | 35.9 | 730 | 1230 | 486 | 339.1 | 244 | 244 |
| trueErgoPO | off | 143 | 29 | 0 | 965.1 | 0.59 | 45.1 | 748 | 1463 | 701 | 469.8 | 47 | 0 |
| trueErgoPO | on | 143 | 29 | 0 | 802.6 | 0.48 | 31.0 | 762 | 1278 | 502 | 294.6 | 260 | 213 |

- **Certificates, scores and published bounds identical** in all 516 paired runs (every status, certificate, score and `bounds` triple equal).
- The deterministic counts: TrueErgo second opinions 730 -> 486 (-33%) and native solves 1,474 -> 1,230 (-17%) with the same 730 nodes;
  fewer solves on 102 guns, more on none. Prevent Overswing second opinions 701 -> 502 (-28%), native solves 1,463 -> 1,278 (-13%); fewer
  solves on 85 guns, more on 3, nodes +14 on 5 guns. Plain requests have no spatial search and are unchanged (same solves).
- Wall time: TrueErgo -19.5% total (median per-gun ratio on/off 0.84 over the 80 guns above 1 s), Prevent Overswing -17% (0.87), max
  49.9 -> 35.9 s and 45.1 -> 31.0 s. Wall time on this machine is noisy by about 10%: the `splitOff` run repeats the code and the exact counts of
  `tedseedOff` (`ted-seed.md`) and was 8-12% slower than it. Against `tedseedOff` the gain is 962 -> 869 s TrueErgo and 862 -> 803 s Prevent
  Overswing; the solve counts are the reliable measure.
- Why only a third of the second opinions go: a node is split only while its bound is more than the tolerance above the incumbent, so the leaves
  of the search tree (closed by an exact or within-tolerance settled verdict) still need the full rule, and a binary tree has about as many
  leaves as internal nodes.
- The cost side: a child of a shortcut node inherits the parent's settled-or-unknown bound instead of the parent's confirmed bound, so a later
  incumbent cannot fathom it before it is evaluated. That added nodes on 5 Prevent Overswing guns (RPD 7 -> 11 nodes, 12 -> 17 solves,
  1.5 -> 6.8 s; M1A 9 -> 13, 12.6 -> 17.3 s; RSASS, AKMS, AKMSN +2 nodes each, the last two still with fewer second opinions).

10 slowest guns (larger of the two times), seconds / native solves / second opinions:

| TrueErgo | off | on | splits with a build |
| --- | --- | --- | ---: |
| AKMS | 49.9 / 28 / 14 | 33.8 / 22 / 8 | 6 |
| AKMN | 47.5 / 20 / 10 | 35.9 / 16 / 6 | 4 |
| ADAR 2-15 | 43.9 / 20 / 10 | 25.1 / 16 / 6 | 4 |
| AK-104 | 36.1 / 17 / 8 | 28.5 / 14 / 5 | 3 |
| M16A2 | 35.6 / 20 / 10 | 26.6 / 16 / 6 | 4 |
| AK-105 | 33.5 / 16 / 8 | 26.3 / 13 / 5 | 3 |
| AK-102 | 26.8 / 20 / 10 | 29.7 / 16 / 6 | 4 |
| AK-101 | 29.4 / 16 / 8 | 27.1 / 13 / 5 | 3 |
| MPX | 29.0 / 21 / 10 | 19.6 / 17 / 6 | 4 |
| AKS-74N | 27.3 / 16 / 8 | 28.0 / 13 / 5 | 3 |

| Prevent Overswing | off | on | splits with a build |
| --- | --- | --- | ---: |
| AK-74N | 45.1 / 23 / 11 | 29.2 / 19 / 7 | 4 |
| AK-74M | 38.1 / 19 / 9 | 31.0 / 16 / 6 | 3 |
| AKS-74N | 34.1 / 19 / 9 | 26.4 / 16 / 6 | 3 |
| AKMN | 31.6 / 19 / 9 | 23.2 / 16 / 6 | 3 |
| ADAR 2-15 | 31.3 / 16 / 8 | 30.0 / 13 / 5 | 3 |
| PP-19-01 | 28.8 / 20 / 9 | 15.6 / 17 / 6 | 3 |
| AK-104 | 28.6 / 18 / 8 | 22.0 / 15 / 5 | 3 |
| AK-101 | 27.4 / 23 / 11 | 28.6 / 19 / 7 | 4 |
| AK-103 | 27.6 / 15 / 7 | 16.5 / 13 / 5 | 2 |
| VPO-136 | 27.4 / 16 / 8 | 15.0 / 13 / 5 | 3 |

The slowest guns keep their node counts; each saves 2 to 6 second opinions.
