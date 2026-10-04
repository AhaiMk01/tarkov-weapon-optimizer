# Ledger-to-production differential harness

Stage 2, phase 2.1 (refs #40). The Stage 1 reference is the truth; this harness measures how far today's production
solver is from it, case by case, and holds the line with a ratchet baseline while Stage 2 closes the gap.

For every case of the 14-family ledger (`../ledger`) it maps the reference fixture and request to production's inputs,
runs production's `solve()` end to end (HiGHS, in Node), maps the returned build back and grades it against the oracle.

| File | Role |
| :--- | :--- |
| `toProduction.differential.ts` | Pure mapping fixture/request -> `ItemLookup`, compatibility map, `SolveParams`; detects unsupported features |
| `compare.differential.ts` | Decodes a response into a `ReferenceBuild`, grades the four dimensions, runs production, probes the Node HiGHS loader |
| `scoreboard.ts` | Pure bookkeeping: grade shape, `baseline.json` format, ratchet comparison, printed summary |
| `ledger.differential.test.ts` | Runs every ledger case and enforces the ratchet against `baseline.json` |
| `toProduction.differential.test.ts`, `compare.differential.test.ts`, `scoreboard.test.ts` | Tests of the three modules above (production is only touched by a few end-to-end smoke cases) |
| `baseline.json` | The committed scoreboard: one line per case |

`*.differential.ts` files may import production code and nothing outside them may import them (see
`../independenceScan.ts`), so the oracle can never reach production through a helper. `scoreboard.ts` is not a
differential file on purpose: it is pure data handling and imports no production code.

## The four dimensions

Each is `pass`, `fail` or `n/a`, with a reason string. Precise is the primary grading (`preciseMode: true`). The Fast
column (`preciseMode: false`) is recorded and ratcheted too, on three dimensions: Fast optimizes an approximate model, so
exact optimality is not required of it (ADR 0013 section 6) and `scoreOptimal` is `n/a` there.

| Dimension | Passes when |
| :--- | :--- |
| `buildValid` | The build production returned, mapped back to a `ReferenceBuild`, is accepted by `validateReference` (rooted placements, slot capacity, allowed items, required slots, conflicts, includes and excludes, supply caps, base access, every request cap). For an empty case it passes when production returns no build. A response that cannot be decoded faithfully (no `selected_preset`, `selected_items` and `slot_pairs` that disagree, a slot with no placed owner) fails with the reason; the unplaceable part is kept as a placement under an unresolved parent so the validator rejects it by code. |
| `scoreOptimal` | The oracle's exact score (exact rationals, `scoreBuild`) of that valid build equals `expected.maxScore` and the build's projection key is in `expected.maximizers`. Exception: a `tiny_positive_gap` case whose gap is below its runtime tolerance (`resolvableAtTolerance: false`) also accepts a build within `runtimeTolerance.absolute` of the optimum, since a solver held to that tolerance cannot tell the two apart. `n/a` for empty cases (no optimum) and for Fast. |
| `emptiness` | Production reports infeasibility exactly when `expected.empty`. Nonempty: production returned an `optimal` or `feasible` build (`infeasible` is a false emptiness, `incomplete`/`error` is no verdict, both fail). Empty: status `infeasible`, or `incomplete` carrying the admitted empty reason of ADR 0013 section 6 (provisional-MOA and Fast emptiness are published that way). |
| `outcomeContract` | The response carries the admitted public outcome of ADR 0013 section 6 for the mode: `status`, `physical_certificate`, `model_qualification`, `moa_qualification` (an explicit `null` when MOA-independent, absent is a miss), `precision_resolved` (the requested mode), `reason` and `optimization.termination`. `reason` is a closed set: the admitted reason when one is required, otherwise none at all (so today's `"No valid configuration found"` fails). The failure key lists the fields that are missing and the ones that are wrong, so the progress of phase 2.6 is visible. |

A case with an unsupported feature (below) is a recorded failure on every applicable dimension with the reason
`unsupported: ...`; it is not run. Nothing is ever passed by loosening a comparison.

Stage 2 is complete when every Precise cell passes. The Fast column is the secondary signal. One known open question:
production resolves a Fast request on a TrueErgo or Prevent Overswing case to Precise (`solve` forces `preciseMode`), so
the Fast `outcomeContract` cells of those cases cannot pass while `precision_resolved` must equal the requested mode.

## Mapping and unsupported features

The `ItemLookup` is built directly from the fixture, in the units production stores (kg, ergonomics points, recoil
modifier as a fraction, accuracy in percent points), with offers written as `extractModStats` / `extractAllPresets` would
write them (positive prices only, barters as a float sum rounded with `Math.round`, offers sorted by price). The production
extractors are not exercised here; `../source/*.differential.test.ts` compares them with the reference reader. Notably
`extractGunStats` drops the receiver's flea offers while the reference keeps them, a difference this harness bypasses.

Everything in the request reaches `SolveParams` unchanged (caps, includes/excludes, weights, TrueErgo, Prevent
Overswing, gear factor, Tchebycheff with its ideal point, trader levels, flea, barter and dogtag flags, player level);
absent fields stay absent so production applies its own defaults. `objectiveTolerance` is the case's runtime tolerance
(`runtimeTolerance.absolute`, 1e-9; set in `outcomeFor`) and the deadline is 20 s per call.

That tolerance exposes a production defect today: `solveDetailed` floors it at 1e-7 and every proved bound is the
native objective plus `DUAL_MARGIN` (1e-7), so the gap is always a hair above the floor and a nonlinear (TrueErgo or
overswing) case can never certify. Four cases (`F12-ted-weight-regimes`, `F12-ted-uses-gear-adjusted-ergonomics`,
`F12-max-weight-singleton-interval`, `F14-negative-weight-ted`) return the exact optimum with `status: feasible` and
`termination: limit`; with the default tolerance (1e-5) they return `optimal`. Their `buildValid`, `scoreOptimal` and
`emptiness` still pass. Removing the margin (phase 2.3 native bound) or the floor (phase 2.5) is what clears them.

A feature production's inputs cannot carry is returned in `unsupported`, never dropped. Each detector lives in
`detectUnsupported`; remove it in the same change that teaches production the feature.

| Feature id | Meaning | Cases when the baseline was created |
| :--- | :--- | ---: |
| `owned_items` | `request.owned_items`: production has no stash input | 15 |
| `barter_offered_count_gt_1` | a barter lot delivering several units (`OfferInfo` has no lot size) | 1 |
| `category_chain_ancestor_match` | a category filter that matches an item only through an ancestor (only the own `category_id` exists) | 1 |
| `flea_player_level_on_base` | a player-level flea gate on a receiver or preset (only mods carry `min_level_flea`) | 0 |
| `flea_offers_distinct_player_levels` | one mod with flea offers at different levels (`min_level_flea` is one number) | 0 |
| `weapon_magazine_capacity` | a receiver magazine capacity under a magazine minimum (`GunStats` has no capacity) | 0 |
| `non_canonical_trader_name` | a trader name that production would trim or lowercase into another key | 0 |
| `ambiguous_preset_id` | a preset id equal to its receiver id or to the naked-base marker `naked` | 0 |

A receiver's `conflictingItemIds` is carried onto the listed mods as a conflict with the receiver (production has no
receiver conflict list; the compatibility map skips a mod that lists the receiver, which is the exclusion the oracle's
symmetrized pair gives).

## Ratchet workflow

`baseline.json` records, per case, the verdict of every dimension in both modes and the unsupported feature ids (no
reasons, no timings, so diffs show only real changes). `ledger.differential.test.ts` fails when:

* a dimension that passed in the baseline does not pass now: a **regression**. Fix production (or the mapping), do not
  touch the baseline. An intended regression is recorded by editing `baseline.json` by hand, where it shows in review;
* a dimension passes now that did not in the baseline: an **improvement**. The test fails until the baseline is updated,
  so every gain is recorded in the same commit and can never be lost silently afterwards;
* anything else differs (a case added or removed, `fail` becoming `n/a`, the unsupported features of a case changed).

```bash
cd frontend
npx tsx --test reference/harness/ledger.differential.test.ts                          # check
UPDATE_HARNESS_BASELINE=1 npx tsx --test reference/harness/ledger.differential.test.ts # rewrite baseline.json
```

The update refuses to write while there are regressions, so it cannot launder one. The test prints a summary (pass counts
per family and dimension, the dominant failure reasons, the production outcomes, the unsupported features) as `ℹ` lines.
The whole run takes about a second after the one-off HiGHS load.

## Production's HiGHS loader in Node

`frontend/src/solver/solver.ts` (`loadHiGHS`) is what the harness runs. In Node (no `window`, no `WorkerGlobalScope`) it:

1. looks for `public/highs.js` and `public/highs.wasm` under **`process.cwd()`**; if both exist it evaluates the JS with
   `new Function` and instantiates the custom WASM build checked in there (identical to `vendor/highs/`, built from
   `lovasoa/highs-js` with more initial memory; not pinned or reproducible);
2. **silently falls back to the stock `highs` npm package** when either file is missing (for example when the process is
   not started in `frontend/`) or when anything in step 1 throws (`catch { }` with no log). The solve then runs on a
   different WASM build (the vendored README says the stock package cannot solve the large LPs the custom memory settings exist for) and nothing in the response says so.

This is the known ADR 0013 section 4B defect (unpinned binary, silent stock fallback, no native evidence) that phase 2.3
removes with the pinned reproducible build and a loader that fails loudly. Until then the harness sets the working
directory to `frontend/` itself (`process.chdir`) and `probeNodeLoader` reports which branch the file check selects
(`custom` or `stock-fallback`, plus the SHA-256 of `public/highs.wasm`). The probe mirrors only the file check: an
exception while evaluating the custom build would still fall back unseen. The test prints the probe result.

## Maintaining the harness in later phases

* Response shape: `decodeBuild` already accepts both `slot_pairs: [slotId, itemId][]` (today) and `Placement[]`
  (ADR 0013 section 5); reading instance ids from `selected_items` is the follow-up when phase 2.6 lands.
* Count-bearing presets (phase 2.2, done): `presetInfo` emits `{ itemId, count }` components exactly as
  `extractAllPresets` does (repeated entries summed, a zero count kept as a component that supplies nothing, the
  receiver's own entry carried as `receiver_id`), and the `preset_component_count_gt_1` detector is gone. The three
  cases that carry a count above one (`F06-preset-count-gt-one-two-copies`, `F06-base-cost-once-extra-copy-paid`,
  `F14-source-quantities-repeated-entries-and-zero-count`) now run for real. The two F06 cases still fail
  `scoreOptimal` because the optimum installs more than one copy and production installs at most one copy of a
  template until the physical model (phase 2.4); F14 still fails `buildValid` because production's free-of-charge
  stand-in for unpurchasable parts installs a part (`c`) that the preset supplies zero copies of (also phase 2.4).
* `owned_items` (phase 2.7): add the field to `mapRequest` and delete its detector.
* Every removed detector turns its cases from `unsupported` failures into real runs; the ratchet then demands the baseline
  update that records whatever they now score.
