# Interpretation choices of the Stage 1 reference

Refs #40, ADR 0010, ADR 0013 section 3.

The ADRs fix most of the reference semantics, but not every detail the oracle has to decide. Each
choice below fills a point where the ADRs are silent or ambiguous. They are **choices of the
reference, not upstream truth**: a different reading would change expectations, so each one is listed
with where it lives, where production differs, and which ledger cases exercise it.

## Decision log

The owner decided every choice below on 2026-10-04 (this file's numbers are stable). Evidence is the pinned capture of that date
unless stated.

| # | Decision | Date | Evidence |
| ---: | :--- | :--- | :--- |
| 1 | Accepted. Reference rule; production differs only on ammunition lots | 2026-10-04 | 29 pinned barters have `offeredItem.count > 1`, all ammunition; no mod is sold in lots |
| 2 | Accepted. No occurrence in the pinned data; Stage 2 adopts the reference rule | 2026-10-04 | 0 offers with a stored price <= 0 and 0 barters totalling <= 0, over 4904 distinct offers (`bridge/toFixture.allGuns.test.ts`) |
| 3 | Accepted. Normative per ADR 0010 section 2; production differs only at exact boundaries, repaired by Stage 2 numerics | 2026-10-04 | ADR 0010 section 2 example (0.35); F04, F09, F11, F12, F14 cases |
| 4 | Accepted. No occurrence in the pinned data; Stage 2 adopts the reference rule | 2026-10-04 | 0 guns can install two positive-COI items in one tree (structural bound <= 1, `bridge/toFixture.allGuns.test.ts`) |
| 5 | **Keep** category matching over the whole chain; production adopts it in Stage 2 | 2026-10-04 | 3 mod categories are both an item's own category and an ancestor of another mod's (`magazine`, `special-scope`, `cylinder-magazine`); the UI offers only the finest category used on a weapon; all 19 Gunsmith task groups (`frontend/public/tasks.json`) name categories that are some mod's own category (`bridge/categoryEvidence.test.ts`) |
| 6 | Accepted. Matches production | 2026-10-04 | `SWAY_START_KG` 3 and `SWAY_FULL_KG` 7 in `trueErgo.ts`; F12 asserts nonzero-iff only |
| 7 | Accepted. No occurrence in the pinned data; Stage 2 adopts the reference rule | 2026-10-04 | No receiver carries a magazine capacity (`bridge/toFixture.allGuns.test.ts`) |
| 8 | Accepted. Matches production | 2026-10-04 | `ergo_min` reads the first-clamp variable in `lpBuilder.ts`; F04 cases |
| 9 | **Decided.** The payoff table is an input, checked for admissibility (see 17) | 2026-10-04 | Single-axis payoff ties make the nadir non-unique; F11-payoff-table-admissibility-tied-endpoints |
| 10 | Accepted. Matches production; level-0 offers do not occur | 2026-10-04 | 0 offers with level <= 0 (`bridge/toFixture.allGuns.test.ts`) |
| 11 | Accepted. No occurrence in the pinned data; Stage 2 adopts the reference rule | 2026-10-04 | 0 own-slot conflicts: 9 of 5442 items list slot ids, none is allowed by a slot it blocks |
| 12 | Accepted. Matches production | 2026-10-04 | `trueErgo.ts` resolves weights with `Math.max(0, ...)`; F04, F11 cases |
| 13 | Accepted. Follows from the ADR rules, not a free choice | 2026-10-04 | ADR 0002 (stripping at no penalty); F06 case |
| 14 | Accepted. Follows from the ADR rules, not a free choice | 2026-10-04 | ADR 0003 (required occupancy and slot conflicts); F01 case |
| 15 | **Decided.** Naked receiver trader-only matches production; preset ammunition stays supply-only; camora ammunition is excluded from the build domain | 2026-10-04 | Decision map #28 (loaded ammunition is out of scope); 5 guns, 28 slot records, 39 templates (`bridge/toFixture.ammo.test.ts`) |
| 16 | Accepted. Matches production | 2026-10-04 | `capped_ergo` (the first clamp) unless `use_true_ergo` selects `ted_axis`; F11, F12 cases |
| 17 | **New.** Payoff-table admissibility rule | 2026-10-04 | `oracle/payoff.test.ts`; F11-payoff-table-admissibility-tied-endpoints |

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
| 9 | Tchebycheff without an ideal point is an input error (the payoff table is an input: see 17) | none (ledger input-error test) |
| 10 | Trader level <= 0 disables a trader, a missing trader defaults to 4, the flea gate is per offer | F02, F05 |
| 11 | Slot conflicts include the blocker's own slot | none (oracle unit test; 0 occurrences on the pinned data) |
| 12 | Duplicate includes add nothing; negative weights resolve to 0 | F04, F11 |
| 13 | A preset with conflicting parts is a legal base, with stripping | F06 |
| 14 | A slot conflict against a required slot bans the blocker | F01 |
| 15 | Bridge: naked receiver offers, preset ammunition, camora ammunition (excluded) | bridge tests |
| 16 | The objective's ergonomics axis is the first-clamp ergonomics, or TED when `use_true_ergo` | F11, F12 |
| 17 | The Tchebycheff payoff table is an input, checked for exact admissibility | `F11-payoff-table-admissibility-tied-endpoints` |

## 1. Barter lots: offers are bought in whole lots

* **Status.** Decided (owner, 2026-10-04): the reference rule; production differs only on ammunition lots.
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
  sizes, exhaustive check on 300 instances, base cost); `bridge/toFixture.offers.test.ts` (the real 20-round
  7.62x39 PS gzh barter, a supply-only preset item).

## 2. A stored price <= 0 is not an offer; a positive barter total that rounds to 0 is legal

* **Status.** Decided (owner, 2026-10-04): no occurrence in the pinned data (0 offers with price <= 0); Stage 2 adopts the reference rule.
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

* **Status.** Decided (owner, 2026-10-04): normative per ADR 0010 section 2; production differs only at exact boundaries, repaired by Stage 2 numerics.
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

* **Status.** Decided (owner, 2026-10-04): no occurrence in the pinned data (0 guns can install two positive-COI items in one tree); Stage 2 adopts the reference rule.
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

* **Status.** Decided (owner, 2026-10-04): keep chain matching; production adopts it in Stage 2.
* **Evidence.**
  * On the pinned capture only 3 mod categories are both some mod's own category and an ancestor of another mod's own category:
    `magazine` (219 own members, 224 on the chain: the 5 cylinder magazines), `special-scope` (9 own, 16 on the chain) and
    `cylinder-magazine` (4 own, 5 on the chain).
  * The UI only offers the finest category used on a weapon.
  * All 19 Gunsmith task category groups (`frontend/public/tasks.json`) name categories that are some mod's own category, so leaf and
    chain matching agree on them. Precisely: the one group that names `magazine` selects the same items under both rules on its task
    weapon, because no Gunsmith weapon reaches a cylinder magazine; over the whole catalogue the two rules do differ on `magazine`.
    Observation tests: `bridge/categoryEvidence.test.ts`.
* **Rule.** A category id matches an item when it occurs anywhere in the item's category chain (own category
  first, then its ancestors). This applies to `exclude_categories` and to every group of `include_categories`.
* **ADR silence.** ADR 0010 section 4 and ADR 0013 section 3 name category includes/exclusions and group
  structure but never define "an item is in a category".
* **Production.** Matches only the item's own category (`category_id = bsgCategory.id`, compared by equality in
  `lpBuilder.ts` and `validateBuild.ts`), so an ancestor category never matches. The UI offers leaf
  categories, which hides the difference. Stage 2 must switch both comparisons to chain matching.
* **Exercised by.** `F04-exclude-category-ancestor-chain` (a subcategory item banned through its parent), `F04-include-category`
  (own category); `oracle/validate.test.ts` (an include group satisfied only through the ancestor chain, and the finest category agreeing).
  No new ledger case was needed: the exclusion case already shows a subcategory item matched through a parent.

## 6. The overswing percent scale runs 3 kg to 7 kg

* **Status.** Decided (owner, 2026-10-04): matches production (`SWAY_START_KG` 3, `SWAY_FULL_KG` 7).
* **Rule.** Overswing strength is `clamp((W (1 - E/100) - 3) / (7 - 3), 0, 1) x 100`, with E the gear-adjusted
  effective ergonomics. The only normative statement is that it is nonzero exactly when TED < 0 (ADR 0013
  section 3, family 12); the 7 kg full-strength point is taken from production `SWAY_FULL_KG`.
* **ADR silence.** No ADR defines the percent scale.
* **Production.** Same formula (`trueErgo.ts`, `SWAY_START_KG = 3`, `SWAY_FULL_KG = 7`).
* **Exercised by.** `F12-overswing-without-prevention` asserts only the nonzero-iff relation, as does the
  every-accepted-build invariant in `ledger/ledger.test.ts`; the scale itself is pinned by
  `oracle/stats.test.ts`. Stage 3 must not turn the percent values into ledger expectations.

## 7. Magazine and sighting minimums take the maximum over receiver and items

* **Status.** Decided (owner, 2026-10-04): no occurrence in the pinned data (no receiver carries a magazine capacity); Stage 2 adopts the reference rule.
* **Rule.** `min_mag_capacity` compares the largest magazine capacity among the receiver and the installed
  items (not a sum); `min_sighting_range` compares the largest sighting range the same way.
* **ADR silence.** ADR 0013 section 3 (family 4) names "magazine/sighting boundaries" without an aggregation rule.
* **Production.** Sighting: the base gun and the items, effectively the maximum. Magazine: `mag_cap` requires an
  installed item with enough capacity and does not consult the receiver, which makes no difference on the pinned
  data (gun templates carry no capacity).
* **Exercised by.** `F04-magazine-boundary`, `F04-magazine-capacity-is-max-not-sum`, `F04-sighting-boundary`.

## 8. `min_ergonomics` uses the pre-gear first clamp

* **Status.** Decided (owner, 2026-10-04): matches production.
* **Rule.** The hard cap `min_ergonomics` is tested against the displayed ergonomics
  `clamp(raw, 0, 100)` (the first clamp), not against the gear-adjusted effective ergonomics.
* **ADR silence.** ADR 0007 section 5 defines both clamps but does not say which one a hard cap reads.
* **Production.** Same: `ergo_min` reads `capped_ergo`, the first-clamp variable, before the gear factor.
* **Exercised by.** `F04-min-ergonomics-compares-the-pre-gear-value`, `F04-min-ergonomics-cap-boundary`,
  `F04-near-cap-min-ergonomics-gap-2e-20`.

## 9. Tchebycheff without an ideal point is an input error

* **Status.** Decided (owner, 2026-10-04): the payoff table is an input, checked for admissibility (see 17).
* **Rule.** `use_tchebycheff: true` with no `ideal_point` is a `ReferenceInputError` (`MISSING_IDEAL_POINT`), an
  input failure and never emptiness. The reference has no solver to derive an ideal point, so the caller supplies it. Which
  ideal points a caller may legitimately supply is choice 17.
* **ADR silence.** The ADRs define the Tchebycheff score for a given ideal point and do not say what a request
  without one means.
* **Production.** `solver.ts` computes the ideal point itself when it is absent, while `lpBuilder.ts` treats a
  missing ideal point as "not Tchebycheff" and falls back to the weighted objective.
* **Exercised by.** No ledger case; the input-error test in `ledger/ledger.test.ts` asserts the code.

## 10. Trader levels, defaults and the flea gate

* **Status.** Decided (owner, 2026-10-04): matches production; level-0 offers do not occur (0 in the pinned data).
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

* **Status.** Decided (owner, 2026-10-04): no occurrence in the pinned data (0 own-slot conflicts); Stage 2 adopts the reference rule.
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

* **Status.** Decided (owner, 2026-10-04): matches production.
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

* **Status.** Decided (owner, 2026-10-04): follows from the ADR rules, not a free choice.
* **Rule.** A preset's components are supply, not installed parts. Two components that conflict with each other do
  not make the preset illegal as a base: the build installs a subset (the unused preset parts are stripped at 0 RUB,
  ADR 0002) and the conflict constrains only the installed set.
* **ADR silence.** ADR 0002 says unused preset parts are stripped at no penalty; it does not address a preset whose
  own parts conflict.
* **Production.** Not audited here; the Stage 3 comparison decides.
* **Exercised by.** `F06-preset-with-conflicting-parts-forces-stripping`.

## 14. A slot conflict against a required slot bans the blocker

* **Status.** Decided (owner, 2026-10-04): follows from the ADR rules, not a free choice.
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

* **Status.** Decided (owner, 2026-10-04): the naked-receiver trader-only rule matches production; preset ammunition stays supply-only; camora (loaded)
  ammunition is excluded from the build domain.
* **Rule.**
  * The naked receiver gets **trader offers only** by default. The gun template's flea price and barters price its
    factory configuration, not a bare receiver; `weaponOfferKinds` opts in. Mods and presets keep trader, flea and
    barter offers.
  * **Preset ammunition is supply-only.** Preset components outside the installable closure (in practice
    ammunition, up to 60 rounds) join the fixture as inert templates that no slot allows, listed in
    `provenance.supplyOnlyItemIds`; they supply nothing installable.
  * **Camora ammunition is excluded.** Loaded ammunition is outside the physical domain (decision map #28: "loaded-ammo/new
    objectives" are out of scope) and production does not model it. Every slot whose allowlist is non-empty and holds only
    ammunition templates (raw `types` include `ammo`: a revolver cylinder chamber, a camora) is **removed** from the mapped
    fixture, together with its allowlist, whether or not it is required. It is not emptied: an emptied required slot would make
    its owner, and the weapon, unbuildable. Ammunition templates reachable only through removed slots leave the closure. A slot
    that mixes ammunition with other candidates is a `BridgeError`, never silently split; a slot with an empty allowlist is kept.
    Removed slots and templates are recorded in `provenance.removedAmmoSlots` and `provenance.removedAmmoItemIds`.
  * Pinned capture: **5 guns, 28 slot records, 39 ammunition templates** (the cylinders of the MTS-255-12: 5 chambers and 17
    templates; Chiappa Rhino 50DS: 6 and 4; Chiappa Rhino 200DS: 6 and 9; Milkor M32A1: 6 and 6; RSh-12: 5 and 3). Each cylinder
    stays a required, installable magazine with no slots.
* **ADR silence.** ADR 0010 section 5 requires the oracle to read the raw documents but does not say which offers
  price a bare receiver, nor whether ammunition is part of the physical domain.
* **Production.** The naked receiver is trader-only there too (`extractGunStats` excludes flea offers). Production
  models only `mods`-typed items, so camora ammunition is not installable there: the reference and production now agree
  without slicing it away.
* **Exercised by.** `bridge/toFixture.offers.test.ts` (naked receiver), `bridge/toFixture.presets.test.ts`
  (supply-only items), `bridge/toFixture.ammo.test.ts` (removed camora slots, mixed slots refused, a required ammunition slot
  removed rather than emptied, real revolvers stay buildable), `bridge/toFixture.provenance.test.ts` (supply-only ammunition defaults).

## 16. The objective's ergonomics axis is the first-clamp ergonomics (TED when `use_true_ergo`)

* **Status.** Decided (owner, 2026-10-04): matches production.
* **Rule.** The ergonomics coordinate of the objective is `fE = ERGO_SCALE x ergo`, where `ergo` is the displayed
  first-clamp ergonomics `clamp(raw, 0, 100)`, or the TED value when `use_true_ergo` is set. The gear factor and the
  second clamp reach the objective only through TED (effective ergonomics inside TED); a non-TED score ignores them.
* **ADR silence.** ADR 0010 section 2 defines `fE = ergo/TED x 10` without saying which ergonomics (raw, first clamp
  or gear-adjusted effective) `ergo` is.
* **Production.** Same: the ergonomics axis is `capped_ergo` (the first clamp) unless `use_true_ergo` selects `ted_axis`
  (`lpBuilder.ts`).
* **Exercised by.** `F11-gear-does-not-change-a-non-ted-score`, `F12-ted-uses-gear-adjusted-ergonomics`.

## 17. The Tchebycheff payoff table is an input, checked for exact admissibility

* **Status.** Decided (owner, 2026-10-04): the oracle keeps taking `ideal_point` as an input and adds an admissibility check, so
  Stage 3 and Stage 4 can verify the table a solver reports and then compare optima under that same table.
* **Rule.**
  * **Where the table comes from.** Production derives the Tchebycheff ideal point from three single-axis payoff solves over the
    request's feasible domain, with weights `[100,0,0]`, `[0,100,0]` and `[0,0,100]` (#38; `computeIdealPoint`,
    `solver.ts`), in the frame of the Tchebycheff score (ADR 0010 section 2): fE = 10 x ergonomics (TED under `use_true_ergo`),
    fR = 1000 x summed recoil modifier, fP = RUB spend. The ideal coordinates are unique: zE = max fE, zR = min fR, zP = min fP.
    Each nadir coordinate is the worst value of its axis over the three endpoint builds (nadE = min fE, nadR = max fR,
    nadP = max fP), and each endpoint build is one of possibly many **tied** optima of its own axis. The nadir is therefore not
    unique, and a Tchebycheff result can change between solver versions or reductions.
  * **`payoffTables(fixture, request, options?)`** (`oracle/payoff.ts`) computes the exact admissible tables for the request's
    feasible domain, using exactly the request's constraints with `use_tchebycheff` off (its weights and `ideal_point` play no part;
    a Tchebycheff request without an ideal point is not an error here). For each axis it returns the exact optimum, the tie set and the
    distinct coordinate vectors `(fE, fR, fP)` of the tied builds. A table is admissible when one tied build per axis can be chosen
    so that zE/nadE are the max/min fE of the three, zR/nadR the min/max fR and zP/nadP the min/max fP; the product of the three vector
    sets is enumerated **jointly**, so one endpoint build's coordinates feed every nadir it touches (a nadR from one tied build with a
    nadP from another is not admissible). The distinct tables are returned sorted, each with a witness (the chosen endpoints).
  * **`checkIdealPoint(fixture, request, idealPoint)`** decodes the reported doubles with `fromBinary64` and compares them in exact Q
    with the admissible tables. Verdicts: `admissible` (with the table and witness); `inadmissible` with code `EMPTY_DOMAIN`
    (no build exists, so no table does: production would fail its endpoint certification), `IDEAL_MISMATCH` (a reported z coordinate is
    not the exact ideal, e.g. a table built from a non-optimal build) or `NADIR_NOT_ATTAINABLE` (the ideal is exact but no tied
    endpoint choice yields that nadir); `unknown` (`admissible: null`) when the enumeration did not complete or the table product
    exceeds its cap. An incomplete search never claims admissibility or inadmissibility. A non-finite reported coordinate is a
    `ReferenceInputError`.
  * **Gate B** compares optima under the same table: Stage 3 and Stage 4 take the table a solver reports, verify it with
    `checkIdealPoint`, then run the oracle with `use_tchebycheff` and that `ideal_point` (the table is an input of the result, because the
    optimum can differ between admissible tables).
  * **Tolerance.** The check is exact. A solver reports doubles, and an exact coordinate such as 1000 x fromBinary64(-0.1) is
    generally not a double, so Stage 3 needs its own documented tolerance handling for reported ideal points; no tolerance variant is
    provided here.
* **ADR silence.** ADR 0010 section 2 defines the score for a given ideal point and ADR 0012 / #38 fix the three-solve normalization, but
  no ADR says what an ideal point is when an axis has several tied optima.
* **Production.** `computeIdealPoint` takes the three endpoints as the solver returns them (each an arbitrary tied optimum) and takes
  min/max over them, so the table depends on which tie it hit. ADR 0013 section 5's result shape carries `ideal_point`; Stage 2 must
  report the table it used so Stage 3 can check it with `checkIdealPoint`.
* **Exercised by.** `F11-payoff-table-admissibility-tied-endpoints` (the ergonomics optimum is tied between two builds of different
  price, so there are exactly two admissible tables, a table from a non-optimal build is rejected, and the Tchebycheff optimum differs
  under the two tables: build m under the first, build a under the second); `oracle/payoff.test.ts` (axis payoffs, joint choice, request
  constraints, TED frame, single build, empty domain, incomplete enumeration, input errors, exact decoding).
