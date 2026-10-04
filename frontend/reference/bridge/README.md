# Raw-source to oracle bridge (Stage 1)

Refs #40, ADR 0010 section 1 and 5, ADR 0013 section 3 and 4A.

The bridge maps the independent raw reader's world (`reference/source`) into the oracle's JSON fixture schema
(`reference/oracle`), so the exact-rational oracle can enumerate real-data micro-domains. It imports only
`../oracle/index` and `../source/*`; `reference/independence.test.ts` enforces that nothing here (or anywhere in
`reference/`, outside `*.differential.test.ts`) imports production code.

## Files

| File | Role |
| :--- | :--- |
| `toFixture.ts` | `fixtureForWeapon(world, weaponId, options?) -> { fixture, provenance }` and `BridgeError`. |
| `slice.ts` | `sliceFixture(fixture, { keepItemIds, keepPresetIds? }) -> { fixture, provenance }` and `SliceError`. |
| `completeness.report.ts` | Runnable script (not a test): which real weapons the oracle can enumerate exhaustively. |
| `toFixture.test.ts` | Receiver, items, exact weights, slot structure. |
| `toFixture.offers.test.ts` | Trader, flea and barter offers, checked against the reference reader's own barter valuation. |
| `toFixture.presets.test.ts` | Count-bearing preset supply, supply-only items, preset offers. |
| `toFixture.provenance.test.ts` | Recorded defaults, JSON round trip, language independence, defensive source checks. |
| `toFixture.allGuns.test.ts` | Every gun of the pinned capture passes `checkFixture`; no barter is dropped, fractional-count ones included. |
| `slice.test.ts` | Slicing semantics on hand-built fixtures plus one real SV-98 slice. |
| `realCases.test.ts` | Four real-data oracle cases with hand-derived expectations. |

```bash
cd frontend
npx tsx --test reference/bridge/*.test.ts
npx tsx reference/bridge/completeness.report.ts [--maxNodes N] [--maxTrees N] [--json]   # about a minute
```

## `fixtureForWeapon`

Builds the oracle `ReferenceFixture` for one weapon's full reachable closure:

* **Items**: breadth-first over every slot `allowedItems`, starting at the receiver's slots. Each reachable template is
  one `ReferenceItem`, sorted by id in UTF-16 code-unit order.
* **Receiver**: one `ReferenceWeapon`.
* **Presets**: every id in the gun's `properties.presets`, as a `ReferencePreset` with the raw `containsItems` entries
  verbatim (`{itemId, count}`, one per raw entry; the oracle sums repeats).
* **Supply-only items**: preset components outside the installable closure (in practice ammunition) cannot be installed
  in any slot, but `checkFixture` requires every component to be a known item. They join `fixture.items` as inert
  templates (no slot allows them) and are listed in `provenance.supplyOnlyItemIds`. The receiver component is not an item.
* **Weights and every other number** pass through as the raw binary64 leaf. The oracle decodes it exactly, so `0.0155`
  is `1116892707587883 / 2^56`, not `31/2000`. The reader's JSON token is checked (`Number(token) === value`).

Options (`FixtureOptions`):

| Option | Default | Meaning |
| :--- | :--- | :--- |
| `weaponOfferKinds` | `['trader']` | Offer kinds attached to the naked receiver. Mods and presets always get trader, flea and barter. |

### Field mapping

| Oracle field | Raw source | Unit / rule |
| :--- | :--- | :--- |
| item `categories` | `categories` | Own category first, then ancestors; proven against the category tree (root parent `""`). |
| item / receiver `weightKg` | `weight` | kg, raw binary64, token-checked. |
| item `ergonomics` | top-level `ergonomicsModifier` | Points. Must equal `properties.ergonomics` or the bridge throws. |
| receiver `ergonomics` | `properties.ergonomics` | Points; same cross-check against `ergonomicsModifier`. |
| item `recoilModifier` | `properties.recoilModifier` | **Fraction** (-0.05 is -5%). The top-level `recoilModifier` is the same number in percent; the bridge proves `top / 100 ~ fraction` (relative 1e-12) and passes the raw fraction leaf through with no arithmetic. |
| item `accuracyModifier` | top-level `accuracyModifier` | **Percent points**. Proven against `properties.accuracyModifier` (fraction) at relative 1e-9; the raw percent leaf is passed through. |
| item `centerOfImpact` | `properties.centerOfImpact` | Barrels only. |
| item `magazineCapacity` | `properties.capacity` | Rounds. |
| item / receiver `sightingRange` | `properties.sightingRange` | Metres. |
| receiver `recoilVertical/Horizontal`, `centerOfImpact` | `properties.*` | Game units. |
| slot | `id`, `required`, `filters.allowedItems` | Verbatim. |
| `conflictingItemIds` | `conflictingItems` | Verbatim, **including self-listings** (3 items conflict with themselves). |
| `conflictingSlotIds` | `conflictingSlotIds` | Verbatim. |

Only items whose raw `types` include `mods` carry mod modifiers. Ammunition reached through revolver camora slots has
no top-level modifiers (its `properties.recoilModifier` is the ammunition's own recoil number, e.g. 115), so its
ergonomics, recoil and accuracy are recorded defaults (0), never the unrelated property. A non-`mods` item that does
carry a top-level modifier is rejected: no rule maps it.

### Offers

* **Trader offers** (`buyFromTrader`): `{ kind: 'trader', trader, level: minTraderLevel, price: priceRUB }`.
  **Currency**: `priceRUB` is used whatever the offer currency (a USD offer of 20 is stored by the source as
  `priceRUB: 3461`; `price` is ignored). A missing `priceRUB` or a loyalty level that is not an integer >= 1 is a `BridgeError`.
* **Trader identifiers**: the raw trader `normalizedName` (`prapor`, `skier`, `peacekeeper`, `mechanic`, `jaeger`, `ref`).
  This is exactly the key space of production `trader_levels` (`TraderLevels` is "keyed by normalizedName" and
  `canonicalizeTraderLevels` trims and lower-cases keys), so a Stage 3 request mapping needs no translation. A trader
  whose `normalizedName` is not already trimmed lower case is a `BridgeError`.
* **Flea offer**: `referenceFleaOffer` from the reader (skipped for `noFlea` or an absent/zero `lastLowPrice`; price
  `avg24hPrice || lastLowPrice`), with `minPlayerLevel = minLevelForFlea` (the player-level gate). Example: the SIG
  Bravo4 scope has `avg24hPrice` 43091 and `lastLowPrice` 27900, so the offer is `{ price: 43091, minPlayerLevel: 25 }`.
* **Barters** (`bartersFor` is not in the raw data; barters are indexed by `offeredItem`): `{ kind: 'barter', trader,
  level: minTraderLevel, requirements, offeredCount, requiresDogtag? }`. Each requirement keeps `itemId`, `count` and the
  ingredient's raw `avg24hPrice` / `basePrice` (an absent value is omitted; the oracle values `avg24hPrice ?? basePrice ?? 0`).
  Counts pass through verbatim, fractional ones included (see "Fractional barter ingredient counts"). `offeredCount`
  must be a positive integer (else `BridgeError`); it is the lot size, and the oracle buys a barter in whole lots
  (`../INTERPRETATIONS.md` choice 1: one unit costs the whole lot, never a fractional share). `requiresDogtag` is true when an ingredient's
  `normalizedName` contains `dogtag` (language independent; production tests the translated name, which only works in
  English). The mapped lots were checked against `referenceBarterOffer` for several guns, and the dogtag flag against the
  English-name rule over all 855 barters.
* **Task gating** (`taskUnlock`) is ignored by the adopted domain: a gated offer is mapped as available and counted in
  `provenance.taskGated` (1121 trader offers and 514 barters over the 172 gun closures, counted per gun).
* **Naked receiver**: trader offers only by default. The gun template's flea price and barters price its factory
  configuration, not a bare receiver, and production's base model likewise lets the naked receiver be bought from
  traders only. Use `weaponOfferKinds` to opt in. 18 of the 172 guns have a naked trader offer; the rest are reachable
  only through a preset base, which is exactly the ADR 0010 family 5 situation.

### Defaults applied (omitted in the fixture, recorded in `provenance.defaults`)

A missing optional stat is **omitted** so the oracle applies its documented schema default; each application is
recorded as `{ scope, field, value, ids }`. Over the whole pinned capture (counts are item records summed over guns):

| Scope.field | Default | Applies to |
| :--- | ---: | :--- |
| `weapon.magazineCapacity` | 0 | all 172 guns (gun templates have no `capacity`) |
| `item.centerOfImpact` | 0 | 45530 records (every non-barrel) |
| `item.magazineCapacity` | 0 | 44819 records (every non-magazine) |
| `item.sightingRange` | 0 | 34333 records (every non-sight) |
| `item.ergonomics`, `item.recoilModifier`, `item.accuracyModifier` | 0 | 61 records each (ammunition) |

No weight, receiver ergonomics, receiver recoil or flea gate is missing in the pinned capture, so none is recorded;
if a future capture lacks one it is recorded, never invented. Structural emptiness (no slots, no offers, no conflicts)
is not a default: those arrays are always written.

### Defensive checks (a `BridgeError`, never an empty fixture)

Unknown or non-gun weapon id; a slot allowlist that reaches the receiver itself; a non-empty slot `allowedCategories`, `excludedItems` or `excludedCategories` (the
oracle schema only models `allowedItems`, so the filter is refused instead of dropped); any unresolved reference (slot
allowlist, preset, preset component, trader, barter ingredient); a weight token that does not decode to the stored
value; disagreement between a top-level modifier and its `properties` twin, or presence in only one of them; a gun with
a non-zero `accuracyModifier` or `recoilModifier` (the receiver has no such field); a category list that is not the
own-then-ancestors chain; a preset whose `baseItem` names another gun, whose type is not `preset`, or that contains a
gun other than its receiver; a trader offer without `priceRUB` or with a bad loyalty level; a barter with a bad
`offeredCount`; a non-canonical trader key.

### Fractional barter ingredient counts

377 of the 1128 ingredient entries of the pinned barters are fractional (7.52, 25.02, 155.1; every one a Ref barter, each
the only fractional entry of its barter). The oracle accepts any finite nonnegative requirement count
(`checkOffers` in `oracle/domain.ts`), decodes it with `fromBinary64` and values the lot as the exact rational
`sum(count x unit value)`, rounded `floor(total + 1/2)`. The bridge therefore maps every barter verbatim and drops none:
88 distinct fractional-count barters over the 172 gun closures (45 in the M4A1 closure: 42 for mods, 3 for presets), and
all 172 fixtures pass `checkFixture`. There is no omission option and no `provenance.omitted` any more.

The decimal and the double differ, so exactness matters: `Fraction(25.02)` is `7042503917300613 / 2^48`, slightly below
25.02, and the PMAG D-60 Ref barter (25.02 x gp-coin at 7500) totals `187650 - 225 / 2^46`, lot 187650. On the pinned data
the exact lot never differs from naive double arithmetic (checked over all 855 barters), so the discriminating boundary
cases live in `oracle/acquisition.test.ts` (155.1 x 5 is `775.5 - 2^-45` exactly and rounds to 775, while doubles give
775.5 and `Math.round` 776). `barter_available` is off by default in requests, and the real cases below use none.

## `sliceFixture`

Turns a mapped fixture into a derived micro-domain small enough to enumerate exhaustively.

* A dropped item is **absent**: it leaves `fixture.items` and every slot allowlist, preset component list and conflict list.
  Weapons are always kept (naming one in `keepItemIds` is a `SliceError`, as is any unknown item or preset id).
* **Required slots stay required.** A required slot that loses every candidate makes its owner uninstallable (conditional
  emptiness) or, on the receiver, makes the domain empty. Both are listed in `provenance.emptiedRequiredSlots`.
* `keepPresetIds` defaults to all presets; `[]` drops every preset. A kept preset keeps its receiver component and the
  counts of kept items; removed component entries are recorded.
* Conflict entries naming an absent item are vacuous and pruned (recorded); a kept item's self-listing is never pruned.
* Offers, weights, stats and slot ids are untouched. Kept items that no kept allowlist reaches any more are reported in
  `provenance.unreachableKeptItemIds` (a mistake catcher, not an error).
* `provenance` records exactly what was removed: item ids, preset ids, allowlist entries, preset components and conflict
  entries, plus `claim: 'derived micro-domain, not the full weapon'`. The fixture description starts with
  `Derived micro-domain (slice) of:`. The input fixture is never mutated and shares no mutable structure with the result.

Limits: a slice cannot add structure (slots, items, offers), so it cannot create a domain the real data does not contain;
it can only remove. The micro-domain must be chosen so a conflict-free build exists: real data has conflicts between
parts that look compatible (for instance the ADAR 2-15 wooden handguard conflicts with the 10.3 inch barrel), so a
convenient preset's own parts are the safe skeleton. Checking `emptiedRequiredSlots` and running the oracle once is the cheap guard.

## Real-data cases (`realCases.test.ts`)

Every expectation is derived by hand from the raw documents or from Python `fractions.Fraction` over the raw binary64
values, with the derivation in the comment above it.

* **(a) 0.0155 kg plate.** M4A1 with the mods of its default factory preset (required chain) plus the ELCAN SpecterDR scope
  and its mounting plate. Exact weights: 154851769587507137/2^56, 200968629771781017/2^56 and 50521380619842225/2^54 for
  none / scope / scope + plate. The plate adds exactly `Fraction(0.0155)`. The full build exceeds the binary64 of 2.8045
  by exactly 2^-54 kg, so `max_weight: 2.8045` rejects it while decimal arithmetic would accept it.
* **(b) count-2 preset component.** SV-98 preset 629766c1 supplies 2 CNC keymod 2-inch rails; the handguard has three rail
  slots. With the preset as the only accessible base, spend is 111746 for 0, 1 or 2 rails and 111746 + 1322 = 113068 for
  3 rails (a budget of 113067 excludes the third rail). Flea price (99999) and the flea level gate (player level 20)
  move the base price only. A third copy that is *capped* (rail with no legal offer while the preset stays accessible)
  does not occur in the pinned data for any count-2 preset with three hosts (only count-3 presets separate the two), so
  that branch stays covered by the oracle's own acquisition tests.
* **(c) self-conflicting item.** `ar-15-lead-star-arms-ravage-stock` lists itself among 55 conflicts, has no offer and is
  noFlea, so two copies are made legal to hold with `owned_items`. The M4A1 closure seats it in one slot only, and no
  real gun of the capture can seat two copies of any of the three self-conflicting items (exhaustive DP in the test), so
  the cap is vacuous on real structure. The hybrid gives the real buffer tube a second slot allowing the real item:
  S x 2 is rejected with `SELF_CONFLICT_COPY_CAP` (3 accepted builds, 2 projections), and the control with the self entry
  removed accepts it (4 builds, 3 projections).
* **(d) locked naked receiver.** AK-74N: naked receiver mechanic L2 28934, preset 5841474424597759ba49be91 prapor L2 44791 or flea 43913
  (gate 25). With `trader_levels: { mechanic: 0 }` the only base is the preset; all 32 builds cost exactly 44791 (every part
  is preset supply), or 43913 once the player level reaches 25. A 40000 cap is met only through the naked receiver
  (cheapest build 28934 + 2592 + 1090 + 1088 = 33704); with the trader locked the domain is proved empty.

## Completeness report (`completeness.report.ts`)

Run with the oracle's own default caps (5,000,000 nodes, 500,000 trees); about a minute. Numbers for the pinned capture:

* 172 guns; closures hold 0 to 589 items (median 267) and 0 to 498 template slots (median 123); no closure has a template cycle.
* **Full closure**: enumeration completes for **37 of 172** guns (36 within the oracle's 500,000 build cap once every
  preset base is counted). The largest completed one has 268,380 rooted trees (Lebedev PL-15); 135 guns do not complete.
  Exact DP tree counts of the others run up to about 1e39 (FN SCAR-L).
* **Preset-derived slices** (the mods of one real factory preset, valid by construction): **397 of 399** complete (median 32
  trees, max 466,560); every gun with presets (164 of 172) has at least one. The two that hit a cap are
  `sig-mpx-9x19-submachine-gun` preset 707265736574000000000069 and `fn-scar-h-762x51-assault-rifle` preset
  707265736574000000000015 (about 1e6 trees each). The 8 guns with no preset are signal-cartridge entries with no slots.
* The DP agrees with the enumerator on every completed enumeration.

So real full-weapon exhaustive checks exist only for pistols and small rifles; everything else is a preset-derived or
hand-picked slice, which is what the cases above use.

## Findings

* **Fractional barter ingredient counts** (above) are mapped and valued exactly; the earlier omission workaround is gone.
* **Self-blocking slot ids**: the oracle's `SLOT_CONFLICT` rule also blocks the slot an item itself occupies, so an item listing
  its own host slot id in `conflictingSlotIds` could never be installed there. The pinned capture has none: only 9 of 5442
  items list slot ids (32 entries, 18 of them match no template slot), 2 are mods, and none is allowed by a slot it blocks
  (observational test in `toFixture.allGuns.test.ts`).
* **Camora ammunition**: 28 slots on 5 revolver magazines allow ammunition (39 templates); the full closure includes
  them as installable items (`provenance.nonModItemIds`) although production only models `mods`-typed items. Slice them
  away (or keep them out of `keepItemIds`) when comparing with production.
* **Real conflicts bite**: S (the self-conflicting stock) conflicts with 55 stock templates, and ADAR wooden handguard
  conflicts with the 10.3 inch barrel; an arbitrary required-slot skeleton is often empty.
* **Production dogtag flag is language dependent** (translated name regex); the bridge uses the slug.
* **Presets** list the receiver itself as a component and carry ammunition (up to 60 rounds); neither is an installable item.
