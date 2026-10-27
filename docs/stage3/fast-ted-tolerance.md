# Fast TrueErgo / Prevent Overswing: default tolerance and native gap (decided)

Owner decision 2026-10-27, branch `perf/fast-ted-native-gap` (PR #51). Code: `resolveFastTolerance`, `FAST_TED_TOLERANCE_PER_WEIGHT`,
`FAST_TED_TCHEBYCHEFF_TOLERANCE` (`frontend/src/solver/physical/solveFast.ts`) and `fastTedNativeSolveOptions`
(`frontend/src/solver/physical/nativeSolve.ts`); tests `frontend/tests/physical/fastTolerance.test.ts` and
`frontend/tests/solver/fastTedTolerance.test.ts`.

## The rule

A Fast solve that reads TED (TrueErgo or Prevent Overswing) and sets no valid `objectiveTolerance` (`isRequestedTolerance`: finite and
non-negative) gets:

- the final Sweet Spot (Tchebycheff) solve: `1e-4` (its objective is normalized, about 0.06, so a weight-scaled tolerance would accept almost any build);
- every other solve, the payoff-table endpoints included: `0.1 x (e + r + p)`, the weights the objective reads (`trueErgo.ts objectiveWeights`:
  defaults 1 / 1 / 0, negatives 0), never below the shared `1e-5`. At the ergonomics endpoint (100 / 0 / 0) that is 10, i.e. 0.1 TED points;
- the native MIP gap `tolerance / 4` without the 1e-9 cap of `nativeSolveOptions`. Fast proves nothing (every answer is `approximate`), so the
  cap bought proof work no Fast result can use.

Unchanged: plain (non-TED) Fast, Precise, and every request with a valid explicit tolerance keep `resolveTolerance` and the capped gap. Explore
sets the shared default explicitly on every target (`exploreSweep.ts paramsOfTarget`): its 1e-4 tie-break and 0.01 step weights would fall
inside 0.1 per unit of weight. Every response reports the tolerance its solve used (`optimization.tolerance`), the pre-model envelopes included.

## Measurements

Pinned snapshot `219443b4…`, bench request (e 1, r 1, p 0.1; flea; trader level 4), Fast, 60 s per request, 172 guns, 14 processes, against the
shared default:

| profile | before | after | builds below the old score / above |
| --- | --- | --- | --- |
| Sweet Spot TrueErgo | 1684 s, 19 timeouts | 734 s, 3 timeouts (each with a build) | 8 (at most 3.1e-5 of the normalized objective; worst AKS-74UN -1 ergo / +13k roubles) / 0 |
| TrueErgo | 223 s | 154 s | 1 (M1A, 0.012) / 0 |
| plain, Sweet Spot plain | rule unchanged | rule unchanged | - |

- Ergonomics endpoint alone, 12 slowest guns, 120 s cap: 681 s -> 30 s, every gun at most 3.9 s; AKS-74N found a better build (the base timed out).
- Payoff tables (ideal / nadir) were equal in all 161 comparable Sweet Spot requests.
- Tchebycheff tolerance options: 1e-3 (427 s, 15 builds below, up to 176k roubles dearer), 1e-4 (chosen), 1e-5 (1151 s, 12 timeouts).
- A looser plain Fast gained nothing (30 s -> 32 s, 11 builds 0.047 below, +467 roubles), which is why plain requests keep the shared default.
