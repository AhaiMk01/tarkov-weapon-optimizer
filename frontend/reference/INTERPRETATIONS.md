# Interpretation choices of the Stage 1 reference

Refs #40, ADR 0010, ADR 0013 section 3.

The ADRs fix most of the reference semantics, but not every detail the oracle has to decide. Each
choice below fills a point where the ADRs are silent or ambiguous. They are **choices of the
reference, not upstream truth**: a different reading would change expectations, so each one is listed
with where it lives, where production differs, and which ledger cases exercise it.

How this file is used:

* The ledger cites these by number ("interpretation 10", in case `prerequisites` and `notes`), and so do
  comments in `oracle/`. **Numbers are stable: never renumber; append a new number for a new choice.**
* "Production" describes `frontend/src/solver` as it is now (the Stage 2 starting point). "Same" means the
  reading agrees on the pinned data; it is not a claim of a proof. Differences are expected to be settled
  in Stage 2 or reported by the Stage 3 comparison, never absorbed by editing an expectation.
* A ledger case that relies on one of these says so in its `notes`. A choice without a ledger case says so
  below and is pinned by an oracle unit test instead.

| # | Choice | Ledger cases |
| ---: | :--- | :--- |
| 1 | Barter offers are bought in whole lots | `F09-barter-lot-is-bought-whole` |
| 2 | A stored price <= 0 is not an offer; a barter whose positive total rounds to 0 is legal | F05, F09 (3 cases) |
| 3 | Decimals decode as exact binary64 values | F04, F09, F11, F12, F14 |
| 4 | With several positive-COI barrels the maximum COI applies | none (oracle unit test) |
| 5 | Category matching spans the whole category chain | F04 (2 cases) |
| 6 | The overswing percent scale runs 3 to 7 kg | F12 (nonzero-iff only) |
| 7 | Magazine and sighting minimums take the maximum over receiver and items | F04 (3 cases) |
| 8 | `min_ergonomics` uses the pre-gear first clamp | F04 (3 cases) |
| 9 | Tchebycheff without an ideal point is an input error | none (ledger input-error test) |
| 10 | Trader level <= 0 disables a trader, a missing trader defaults to 4, the flea gate is per offer | F02, F05 |
| 11 | Slot conflicts include the blocker's own slot | none (oracle unit test; 0 occurrences on the pinned data) |
| 12 | Duplicate includes add nothing; negative weights resolve to 0 | F04, F11 |
| 13 | A preset with conflicting parts is a legal base, with stripping | F06 |
| 14 | A slot conflict against a required slot bans the blocker | F01 |
| 15 | Bridge: naked receiver offers, preset ammunition, camora ammunition | bridge tests |
| 16 | The objective's ergonomics axis is the first-clamp ergonomics, or TED when `use_true_ergo` | F11, F12 |

## 1. Barter lots: offers are bought in whole lots

* **Rule.** An offer is a lot. A trader or flea offer is a lot of one unit at its stored price. A barter is a
  lot of `offeredCount` units at its rounded lot price `floor(total + 1/2)`. A lot is bought whole: one unit out
  of a lot of n costs the whole lot. The cost of covering a paid deficit `d_i` is the exact minimum, over
  nonnegative integer lot counts across all legal offers of the item, of `sum(lots x lotPrice)` subject to
  `sum(lots x units) >= d_i`; surplus units are unused. The base is exactly one unit, so it costs the cheapest
  legal lot price (not the cheapest price per unit). The cover is an exact DP over units (`cheapestCover` in
  `oracle/acquisition.ts`).
  * Provenance: paid occurrences, in code-unit `instanceId` order, take the units of the chosen lots in offer
    index order; the first unit taken from a lot is charged the lot price and the rest of that lot ride on it
    (charge 0), so per-occurrence charges add up to `modSpend`. Cost ties between lot mixes keep the earlier
    offer in list order at every DP step.
  * An earlier version of the oracle priced a unit at `lotPrice / offeredCount`. That charged a fractional
    share of a lot no player can buy, and it understated the cost of any deficit that does not fill the lot.
* **ADR silence.** ADR 0009 section 3 states the barter valuation (`Math.round` of the ingredient sum) and ADR
  0008 principle 5 states preset-first, owned-next, purchased-remainder allocation. Neither says how many units
  a purchase delivers (`offeredCount`) nor what a unit costs when a lot delivers more than one.
* **Production.** The JSON adapter and `dataService.ts` ignore `offeredItem.count`: every unit is priced at the
  full lot price. It agrees with the reference for a deficit of one unit and over-charges any deficit of two or
  more units drawn from a lot of several. On the pinned capture only 29 barters have `offeredItem.count > 1`, all
  of them ammunition; no mod-typed item is sold in lots.
* **Exercised by.** `F09-barter-lot-is-bought-whole` (mixed cover with a single cash offer, surplus unit, a cap
  that only the whole-lot reading enforces); `oracle/acquisition.test.ts` (lot of 30, 31 units, mixed lot
  sizes, exhaustive check on 300 instances, base cost); `bridge/toFixture.offers.test.ts` (the real 5-round
  12/70 RIP barter).

## 2. A stored price <= 0 is not an offer; a positive barter total that rounds to 0 is legal

* **Rule.** A trader or flea offer whose stored price is <= 0 is not an offer. The item is then
  standalone-inaccessible unless it has another legal offer, so its installed copies are capped by preset supply
  plus owned stock. A barter needs an exact total > 0 to exist; a positive total that rounds half up to 0 is a
  legal offer at 0 RUB and keeps its vendor provenance; a zero (or negative) total is not an offer.
* **ADR silence.** ADR 0009 section 3 says a zero stored price is not free acquisition and that genuinely
  accessible zero-cost offers keep their provenance, but does not say which stored values count as an offer
  (negative prices, a total that rounds to zero).
* **Production.** Same for stored prices (`price <= 0` skipped) and for barters (`totalCost <= 0` skipped,
  then `Math.round`). One difference: for presets production sets `purchasable = lowestPrice > 0`, so a preset
  whose cheapest offer rounds to 0 is not purchasable there, while the oracle accepts it as a base.
* **Exercised by.** `F05-stored-zero-price-receiver-is-not-an-offer`, `F09-zero-stored-price-is-not-an-offer`,
  `F09-zero-cost-barter-is-a-legal-offer`.

## 3. Decimals decode as exact binary64 values

* **Rule.** Every finite numeric leaf (weights, ergonomics, recoil, accuracy and COI values, prices, barter
  ingredient counts and prices, request caps, the gear factor, ideal-point coordinates) denotes the exact
  rational value of its binary64 double. `0.2` is `3602879701896397 / 2^54`, not `1/5`; the 0.0155 kg mount is
  `1116892707587883 / 2^56`. Sums, caps and ties are exact in Q; nothing is re-parsed from decimals or rounded
  before a comparison.
* **ADR silence.** ADR 0010 section 2 gives the rule for "source/request weights, COIs, modifiers and prices"
  with the `0.35` example. It does not say what a decimal-looking cap or barter count means, nor that a decimal
  cap such as 0.031 is taken as its double, so the reference applies the rule to every leaf.
* **Production.** Computes in binary64 and formats LP coefficients through decimal strings (`toFixed(6)` is one
  of the defects ADR 0013 section 4C repairs). The two readings differ only at exact boundaries.
* **Exercised by.** `F11-decimal-weight-breaks-a-decimal-tie`, `F11-decimal-weights-adr-0010-example`,
  `F14-fractional-weight-0155`, `F09-fractional-barter-count-is-decoded-exactly`, the `near_cap` cases of F04,
  `F12-near-cap-weight-one-ulp-over-cap`; `oracle/q.test.ts`.

## 4. With several positive-COI barrels, the maximum COI applies

* **Rule.** The effective center of impact is the largest COI > 0 among the installed items; with none (no
  barrel, or only zero or negative COIs) it is the receiver's intrinsic COI.
* **ADR silence.** ADR 0006 states `effectiveCOI = barrelCOI > 0 ? barrelCOI : weaponCOI` for "the" barrel and
  says nothing about two installed items with a positive COI. The maximum matches one replacement row per
  installed barrel, where every row must hold and the worst one binds.
* **Production.** `validateBuild.ts` reads the first installed barrel (`barrels[0]`); `lpBuilder.ts` emits one
  replacement row per barrel (`moa_lim_<b>`), so every installed barrel's row binds. MOA itself is a provisional
  model (ADR 0006).
* **Exercised by.** No ledger case (it needs two barrel slots); `oracle/stats.test.ts`.

## 5. Category matching spans the whole category chain

* **Rule.** A category id matches an item when it occurs anywhere in the item's category chain (own category
  first, then its ancestors). This applies to `exclude_categories` and to every group of `include_categories`.
* **ADR silence.** ADR 0010 section 4 and ADR 0013 section 3 name category includes/exclusions and group
  structure but never define "an item is in a category".
* **Production.** Matches only the item's own category (`category_id = bsgCategory.id`, compared by equality in
  `lpBuilder.ts` and `validateBuild.ts`), so an ancestor category never matches. The UI offers leaf
  categories, which hides the difference.
* **Exercised by.** `F04-exclude-category-ancestor-chain`, `F04-include-category`.

## 6. The overswing percent scale runs 3 kg to 7 kg

* **Rule.** Overswing strength is `clamp((W (1 - E/100) - 3) / (7 - 3), 0, 1) x 100`, with E the gear-adjusted
  effective ergonomics. The only normative statement is that it is nonzero exactly when TED < 0 (ADR 0013
  section 3, family 12); the 7 kg full-strength point is taken from production `SWAY_FULL_KG`.
* **ADR silence.** No ADR defines the percent scale.
* **Production.** Same formula (`trueErgo.ts`, `SWAY_START_KG = 3`, `SWAY_FULL_KG = 7`).
* **Exercised by.** `F12-overswing-without-prevention` asserts only the nonzero-iff relation, as does the
  every-accepted-build invariant in `ledger/ledger.test.ts`; the scale itself is pinned by
  `oracle/stats.test.ts`. Stage 3 must not turn the percent values into ledger expectations.

## 7. Magazine and sighting minimums take the maximum over receiver and items

* **Rule.** `min_mag_capacity` compares the largest magazine capacity among the receiver and the installed
  items (not a sum); `min_sighting_range` compares the largest sighting range the same way.
* **ADR silence.** ADR 0013 section 3 (family 4) names "magazine/sighting boundaries" without an aggregation rule.
* **Production.** Sighting: the base gun and the items, effectively the maximum. Magazine: `mag_cap` requires an
  installed item with enough capacity and does not consult the receiver, which makes no difference on the pinned
  data (gun templates carry no capacity).
* **Exercised by.** `F04-magazine-boundary`, `F04-magazine-capacity-is-max-not-sum`, `F04-sighting-boundary`.

## 8. `min_ergonomics` uses the pre-gear first clamp

* **Rule.** The hard cap `min_ergonomics` is tested against the displayed ergonomics
  `clamp(raw, 0, 100)` (the first clamp), not against the gear-adjusted effective ergonomics.
* **ADR silence.** ADR 0007 section 5 defines both clamps but does not say which one a hard cap reads.
* **Production.** Same: `ergo_min` reads `capped_ergo`, the first-clamp variable, before the gear factor.
* **Exercised by.** `F04-min-ergonomics-compares-the-pre-gear-value`, `F04-min-ergonomics-cap-boundary`,
  `F04-near-cap-min-ergonomics-gap-2e-20`.

## 9. Tchebycheff without an ideal point is an input error

* **Rule.** `use_tchebycheff: true` with no `ideal_point` is a `ReferenceInputError` (`MISSING_IDEAL_POINT`), an
  input failure and never emptiness. The reference has no solver to derive an ideal point, so the caller supplies it.
* **ADR silence.** The ADRs define the Tchebycheff score for a given ideal point and do not say what a request
  without one means.
* **Production.** `solver.ts` computes the ideal point itself when it is absent, while `lpBuilder.ts` treats a
  missing ideal point as "not Tchebycheff" and falls back to the weighted objective.
* **Exercised by.** No ledger case; the input-error test in `ledger/ledger.test.ts` asserts the code.

## 10. Trader levels, defaults and the flea gate

* **Rule.** A trader offer or barter is legal when the unlocked level of its trader is at least the offer's
  level. A level <= 0 (`TRADER_DISABLED`) disables the trader entirely, barters included, even for a hypothetical
  level-0 offer. A trader missing from `trader_levels` is unlocked to level 4. The flea gate belongs to each
  flea offer (`minPlayerLevel`): it is legal when `flea_available` is not false and the player level is unset or
  at least the gate.
* **ADR silence.** ADR 0002 says market accessibility depends on trader levels, player level and flea/barter
  enablement, without the default level, the meaning of 0 or where the flea gate lives.
* **Production.** Same default (`traderLevels[vendor] ?? 4`) and a disabled trader because every offer needs
  level >= 1 (a level-0 offer would stay legal there). The flea gate is a per-item field
  (`min_level_flea`) applied to the item's flea offer; on the pinned data every flea offer carries its item's gate.
* **Exercised by.** `F02-missing-trader-defaults-to-level-four`,
  `F02-unavailable-by-trader-level-flea-level-and-disabled-trader`,
  `F02-flea-off-and-barter-off-leave-only-cash-offers`, `F05-inaccessible-naked-accessible-preset`,
  `F05-cheapest-legal-offer-is-selected`; `oracle/acquisition.test.ts`.

## 11. Slot conflicts include the blocker's own slot

* **Rule.** An installed item's `conflictingSlotIds` blocks every occupied physical slot whose template slot id
  is listed, including the slot the blocker itself occupies. An item listing its own host slot id can therefore
  never be installed there.
* **ADR silence.** ADR 0003 section 4 says a slot conflict blocks every physical occurrence of the listed slot
  on the weapon; it does not exempt or include the blocker's own slot.
* **Production.** The legacy `validateBuild.ts` also counts the blocker's own slot (`occupied.has(slot)`). The
  repaired LP is a Stage 2 deliverable.
* **Pinned data.** Moot: 0 occurrences. Only 9 of 5442 items list slot ids, 2 of them mods, and none is allowed
  by a slot it blocks (observational test in `bridge/toFixture.allGuns.test.ts`).
* **Exercised by.** No ledger case; `oracle/validate.test.ts`.

## 12. Duplicate includes add nothing; negative weights resolve to 0

* **Rule.** Listing the same template more than once in `include_items` still requires it at least once (set
  semantics; it never requires two copies). A negative request weight (`ergo_weight`, `recoil_weight`,
  `price_weight`) resolves to 0, so a negative weight never rewards a worse value. Resolved weights are
  therefore always nonnegative.
* **ADR silence.** ADR 0003 section 4 says an include enforces "at least one" installed copy but not how a repeated
  entry counts. ADR 0013 section 3 (family 11) says resolved weights are nonnegative but not how a negative request
  weight resolves.
* **Production.** Same meaning: a repeated `include_items` entry re-emits the same `x = 1` row, and `trueErgo.ts`
  resolves each weight with `Math.max(0, ...)`.
* **Exercised by.** `F04-include-duplicates-add-nothing`, `F11-negative-request-weight-resolves-to-zero`.

## 13. A preset with conflicting parts is a legal base, with stripping

* **Rule.** A preset's components are supply, not installed parts. Two components that conflict with each other do
  not make the preset illegal as a base: the build installs a subset (the unused preset parts are stripped at 0 RUB,
  ADR 0002) and the conflict constrains only the installed set.
* **ADR silence.** ADR 0002 says unused preset parts are stripped at no penalty; it does not address a preset whose
  own parts conflict.
* **Production.** Not audited here; the Stage 3 comparison decides.
* **Exercised by.** `F06-preset-with-conflicting-parts-forces-stripping`.

## 14. A slot conflict against a required slot bans the blocker

* **Rule.** When an item's `conflictingSlotIds` names a required slot, the blocker can never be installed while that
  slot's owner is present: the slot must be occupied (required occupancy) and the blocker forbids any occupancy of
  it. A build containing the blocker is rejected either as `SLOT_CONFLICT` (slot occupied) or as
  `MISSING_REQUIRED_SLOT` (slot left empty). The two codes stay distinct.
* **ADR silence.** ADR 0003 states required occupancy and slot conflicts separately and does not say what their
  intersection means.
* **Production.** Not audited here. The legacy LP banned items globally for slot conflicts (ADR 0003, context item 3),
  which is a different defect.
* **Exercised by.** `F01-slot-conflict-against-a-required-slot-bans-the-blocker`.

## 15. Bridge: naked receiver offers, preset ammunition and camora ammunition

These are mapping choices of `bridge/toFixture.ts` (see `bridge/README.md`), not oracle rules.

* **Rule.**
  * The naked receiver gets **trader offers only** by default. The gun template's flea price and barters price its
    factory configuration, not a bare receiver; `weaponOfferKinds` opts in. Mods and presets keep trader, flea and
    barter offers.
  * **Preset ammunition is supply-only.** Preset components outside the installable closure (in practice
    ammunition, up to 60 rounds) join the fixture as inert templates that no slot allows, listed in
    `provenance.supplyOnlyItemIds`; they supply nothing installable.
  * **Camora ammunition is installable.** Revolver magazine camora slots allow ammunition, so the full closure
    includes those templates as installable items (`provenance.nonModItemIds`), with every modifier a recorded
    default of 0.
* **ADR silence.** ADR 0010 section 5 requires the oracle to read the raw documents but does not say which offers
  price a bare receiver, nor whether ammunition is part of the physical domain.
* **Production.** The naked receiver is trader-only there too (`extractGunStats` excludes flea offers). Production
  models only `mods`-typed items, so camora ammunition is not installable there; slice it away when comparing.
* **Exercised by.** `bridge/toFixture.offers.test.ts` (naked receiver), `bridge/toFixture.presets.test.ts`
  (supply-only items), `bridge/toFixture.provenance.test.ts` (camora ammunition defaults).

## 16. The objective's ergonomics axis is the first-clamp ergonomics (TED when `use_true_ergo`)

* **Rule.** The ergonomics coordinate of the objective is `fE = ERGO_SCALE x ergo`, where `ergo` is the displayed
  first-clamp ergonomics `clamp(raw, 0, 100)`, or the TED value when `use_true_ergo` is set. The gear factor and the
  second clamp reach the objective only through TED (effective ergonomics inside TED); a non-TED score ignores them.
* **ADR silence.** ADR 0010 section 2 defines `fE = ergo/TED x 10` without saying which ergonomics (raw, first clamp
  or gear-adjusted effective) `ergo` is.
* **Production.** Same: the ergonomics axis is `capped_ergo` (the first clamp) unless `use_true_ergo` selects `ted_axis`
  (`lpBuilder.ts`).
* **Exercised by.** `F11-gear-does-not-change-a-non-ted-score`, `F12-ted-uses-gear-adjusted-ergonomics`.
