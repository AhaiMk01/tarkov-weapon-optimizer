# Ledger-to-production differential harness

Stage 2, phase 2.1 (refs #40). The Stage 1 reference is the truth; this harness measures how far today's production
solver is from it, case by case, and holds the line with a ratchet baseline while Stage 2 closes the gap.

For every case of the 14-family ledger (`../ledger`) it maps the reference fixture and request to production's inputs,
runs production's `solve()` end to end (HiGHS, in Node), maps the returned build back and grades it against the oracle.

| File | Role |
| :--- | :--- |
| `toProduction.differential.ts` | Pure mapping fixture/request -> `ItemLookup`, compatibility map, `SolveParams`; detects unsupported features |
| `compare.differential.ts` | Decodes a response into a `ReferenceBuild`, grades the four dimensions, runs production, reports the native HiGHS identity |
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
write them (positive prices only, barters priced by production's own `barterLotPrice`, the exact total of the decoded binary64 leaves
rounded half up, offers sorted by price). The production
extractors are not exercised here; `../source/*.differential.test.ts` compares them with the reference reader. Notably
`extractGunStats` drops the receiver's flea offers while the reference keeps them, a difference this harness bypasses.

Everything in the request reaches `SolveParams` unchanged (caps, includes/excludes, weights, TrueErgo, Prevent
Overswing, gear factor, Tchebycheff with its ideal point, trader levels, flea, barter and dogtag flags, player level);
absent fields stay absent so production applies its own defaults. `objectiveTolerance` is the case's runtime tolerance
(`runtimeTolerance.absolute`, 1e-9; set in `outcomeFor`) and the deadline is 20 s per call.

That tolerance exposed a production defect: the pre-cutover `solveDetailed` floored it at 1e-7 and added a nominal 1e-7 margin to every
proved bound, so a nonlinear (TrueErgo or overswing) case could never certify (four cases returned the exact optimum with
`status: feasible` and `termination: limit`). Phase 2.4b-3b honours the requested tolerance as it is (no floor, no margin; the native MIP gap is
at most a quarter of it), and those four cases return `optimal` at 1e-9.

A feature production's inputs cannot carry is returned in `unsupported`, never dropped. Each detector lives in
`detectUnsupported`; remove it in the same change that teaches production the feature.

| Feature id | Meaning | Cases when the baseline was created |
| :--- | :--- | ---: |
| `flea_player_level_on_base` | a player-level flea gate on a receiver or preset (only mods carry `min_level_flea`) | 0 |
| `flea_offers_distinct_player_levels` | one mod with flea offers at different levels (`min_level_flea` is one number) | 0 |
| `weapon_magazine_capacity` | a receiver magazine capacity under a magazine minimum (`GunStats` has no capacity) | 0 |
| `non_canonical_trader_name` | a trader name that production would trim or lowercase into another key | 0 |
| `ambiguous_preset_id` | a preset id equal to its receiver id or to the naked-base marker `naked` | 0 |

The detectors `owned_items` (15 cases), `barter_offered_count_gt_1` (1 case) and `category_chain_ancestor_match` (1 case) are gone.
Phase 2.4b-1 gave production's inputs `SolveParams.ownedItems` (the stash multiset, mapped as a copy; null reads as omitted) and
`OfferInfo.lot_size` (the units one barter delivers; an absent `offeredCount` is one unit, as in the oracle); phase 2.4b-3b removed the chain
detector because the Precise model matches the whole category chain and the mapping now writes the nested `data.bsgCategory` chain production
carries (`category_id` stays the own category, which is all the Fast model reads). No ledger case is unsupported any more.

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

## Production's native HiGHS

`solve()` runs on the pinned native HiGHS build (`src/solver/native`, phase 2.3): the loader hash-checks `public/highs.js` and
`public/highs.wasm` against the committed manifest before any of their code runs, validates the ABI, and throws a typed error on any mismatch.
There is no stock fallback and no dependence on the working directory. `probeNativeLoader` loads it and reports what it is (HiGHS version,
githash, glue and wasm SHA-256), and the ledger test prints that identity with the scoreboard.

## Maintaining the harness in later phases

* Response shape (phase 2.4b-3b, done): `decodeBuild` reads the `Placement[]` that production publishes in `slot_pairs`, and checks `selected_items`
  against it instance by instance (every record's `instanceId` is the `childInstanceId` of one placement of the same template, no placement
  without a record). The legacy `[slotId, itemId][]` pair is still decoded for hand-built responses.
* Count-bearing presets (phase 2.2, done): `presetInfo` emits `{ itemId, count }` components exactly as
  `extractAllPresets` does (repeated entries summed, a zero count kept as a component that supplies nothing, the
  receiver's own entry carried as `receiver_id`), and the `preset_component_count_gt_1` detector is gone. The three
  cases that carry a count above one (`F06-preset-count-gt-one-two-copies`, `F06-base-cost-once-extra-copy-paid`,
  `F14-source-quantities-repeated-entries-and-zero-count`) now run for real. The two F06 cases still fail
  `scoreOptimal` because the optimum installs more than one copy and production installs at most one copy of a
  template until the physical model (phase 2.4); F14 still fails `buildValid` because production's free-of-charge
  stand-in for unpurchasable parts installs a part (`c`) that the preset supplies zero copies of (also phase 2.4).
* `owned_items` and barter lot sizes (phase 2.4b-1, done): `mapRequest` writes `ownedItems`, `barterOffer` writes `lot_size`,
  both detectors are gone, and `blueprint.differential` compares each template's legal offer lot sizes with the oracle.
* Every removed detector turns its cases from `unsupported` failures into real runs; the ratchet then demands the baseline
  update that records whatever they now score.
* Exact barter rounding and the proof frame (phase 2.5, done): the mapper prices a barter with `barterLotPrice` (`src/solver/physical/barterPrice.ts`,
  the function `dataService.ts`'s extractor calls), so the `exactBarterPrices` override of the LP gates, the 1 RUB tolerance of the blueprint test
  and the price patching of the validator differential are gone: the `F09-fractional-barter-count-is-decoded-exactly` price agrees with the oracle
  (775, not 776) and `validator.differential.test.ts` requires zero mismatches. The ledger test also requires every case the oracle has an optimum
  for to come back `optimal` (certified) on Precise at its case tolerance (1e-9): the proved allowances (exact construction errors, `proof.ts`) are
  orders of magnitude below it, and the certificate is decided on the exact gap, so an objective of 9e6 (`F05-expensive-legal-offer-is-used`, one ulp
  1.9e-9) still certifies.
