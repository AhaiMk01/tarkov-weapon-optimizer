# Pinned raw-source evidence and independent reader (Stage 1)

Refs #40, ADR 0010 §1/§5, ADR 0013 §1/§3/§4A.

This directory holds the **raw upstream evidence**, an **independent reader** for it, **source
checks**, and **differential checks** of the production JSON adapter and preset extraction against
that reader. (Stage 2 phase 2.2 repaired the preset count loss and the `count ?? 1` defaults that
these checks exposed; the repair is recorded below.) Nothing here is imported by production code, and reference files (everything except
`*.differential.test.ts`) never import production code
(`frontend/reference/independence.test.ts` enforces it).

## Files

| File | Role |
| :--- | :--- |
| `pin_raw_sources.ts` | The only network-touching file. Fetches and pins the raw documents. |
| `raw/manifest.json` | Committed hash manifest. `raw/*.json` (the bytes) are gitignored. |
| `pins.ts` | Loads pinned documents / the normalized snapshot and verifies SHA-256 first. |
| `rawReader.ts` | Independent parser of the raw documents into reference structures. |
| `pinnedWorld.ts` | The reference world built from the pins (English, plus Chinese). |
| `referenceRules.ts` | Documented flea / barter rules, exact over Q (BigInt rationals). Keeps its **own** rational arithmetic on purpose (see below). |
| `sourceChecks.ts` | Reusable source-evidence checks (references, slot ids, counts, weights, snapshot). |
| `pinnedFetchStub.ts` | Serves the pins through `globalThis.fetch`; refuses any other URL. |
| `syntheticDocs.ts` | Hand-built tiny raw documents for unit tests (never evidence). |
| `*.test.ts` | Reader/pin/rule unit tests and the pinned-capture source checks. |
| `adapter.differential.test.ts` | Production `jsonApiAdapter` vs the reference reader. |
| `extractors.differential.test.ts` | Production `dataService` extractors vs the reference reader. |

## Pin and verify

```bash
cd frontend
npx tsx reference/source/pin_raw_sources.ts          # one deliberate act; refuses to overwrite
npx tsx reference/source/pin_raw_sources.ts --force   # only to replace the evidence baseline on purpose
npm run test:reference                                # hash-verifies every pin before reading it
```

* The script fetches, for game mode `regular`, `items`, `items_en`, `barters`, `traders`,
  `traders_en` (everything `fetchAllDataFromJsonApi('en', 'regular')` reads) plus `items_zh` and
  `traders_zh` (so the requested-language -> English -> key chain runs on real data). It saves the
  exact response bytes and writes `raw/manifest.json`: URL, fetch time, HTTP validators, byte length
  and SHA-256 per document, and the relationship note below.
* Formal tests **never fetch**. `pins.ts` fails with a message that names the remedy when a file is
  missing or its hash/length differs from the manifest, or when a document was never pinned. The
  differential tests run the production adapter through a `fetch` stub that serves only pinned files.
* The normalized fixture `frontend/benchmarks/snapshot.json` (SHA-256
  `219443b449f732f3702cd9a706e82646dfe0c2d0741900700d0d10cbd33b235c`) is verified, never regenerated.
  If it is missing, restore the hashed compressed artifact (ADR 0013 §1).

### Pinned capture (2026-10-04, regular mode)

| Document | Bytes | SHA-256 |
| :--- | ---: | :--- |
| `items` | 17,234,509 | `9c003fcf7e1ee587847271fe2dfffad61b7e4652c742ff972393ad1aa638bf78` |
| `items_en` | 1,691,890 | `3815fb498a0aec9ffe01bf67eff8bc540d05a703fbc032872156e9a81ef81cb7` |
| `barters` | 278,394 | `05eb72bfc9cfd8aba1af553ba2bbb977b92459e9dcd2308fc6b69f36bd16dd83` |
| `traders` | 50,675 | `7114bf7175414691692c19dded5a1ae140365516c5e4c5afcde3d4d330779549` |
| `traders_en` | 3,537 | `1d837a5d33dbde4b8860ba49488b3f885af8adbb13c5c52bcecd26637a6568c7` |
| `items_zh` (supplementary) | 1,643,097 | `fdf422ca95c613e149cb0a97095e3b27c20887e728b816409bba9ffd0606cd9f` |
| `traders_zh` (supplementary) | 3,260 | `97ee70d26787648c185228822d7cbca266235a1a5e79b68c2f4db9763bdfe908` |

`raw/manifest.json` is the source of truth; this table only mirrors it.

## Why `referenceRules.ts` does not share `oracle/q.ts`

`referenceRules.ts` implements its own rational arithmetic (`Rational`, `ratAdd`, `ratMul`, `decodeBinary64`) instead
of importing `oracle/q.ts`. That duplication is intended: it is a second, independent implementation of the
flea and barter valuation. The oracle values the same barters through `oracle/q.ts`, and
`bridge/toFixture.offers.test.ts` cross-checks the two on every mapped barter of the pinned capture. Merging them
would turn that cross-check into a comparison of a module with itself. The header comment of `referenceRules.ts`
says the same; do not deduplicate it against the oracle.

## Reader rules (`rawReader.ts`)

* `containsItems[].count` must be a finite nonnegative integer. **Absent, null, fractional, negative,
  non-numeric or overflowing counts are `SourceError`s; there is no `?? 1` default** (ADR 0013 §4A).
  Repeated entries stay separate; `expandComponents` sums them when a caller asks.
* Barter ingredient and offered counts must be finite nonnegative numbers. They are **not** integers
  in the source (377 of 1128 ingredient entries are fractional, e.g. `155.1`), so integrality is not a
  barter rule.
* Weights keep the raw number and the exact JSON source token (`{ value, text }`, via
  `JSON.parse` source-text access, so Node >= 21). `String(value) === text` proves the decimal
  survives binary64.
* Slot definitions keep all four filter lists (`allowedItems`, `allowedCategories`, `excludedItems`,
  `excludedCategories`); the adapter keeps only the first.
* A category `parent` of `""` is the root sentinel (observed on `54009119af1c881c07000029`); the reader
  records it (`parentWasEmptyString`) instead of reporting a dangling id.
* Unresolved references are not thrown by the reader. `findUnresolvedReferences` reports them
  explicitly (ADR 0013 §3: an input/evidence failure, never infeasibility).

## Findings on the pinned capture

* **Preset count loss (repaired in Stage 2 phase 2.2).** Before the repair the adapter preserved counts
  but `dataService.extractAllPresets` discarded them: **56** (preset, item) quantities wrong in
  **52 of 399** presets, **626** units missing: 35 weapon-mod entries (41 units; rails, flashlights)
  and 21 ammo entries (585 units, e.g. 60 rounds in a magazine). Every mismatch was exactly a raw
  `count > 1` entry read as one copy; nothing else diverged. Raw `containsItems`: 6112 entries, all
  integer counts, 381 with count > 1 (56 of them in gun presets). Now `extractAllPresets` returns
  `{ itemId, count }[]` (repeated entries summed) and the differential test passes with **0 mismatches**
  on all 399 presets, including all 56 multi-copy entries.
* **Receiver as a component.** Every one of the 399 gun presets lists its own receiver exactly once with
  count 1 in `containsItems`. Production carries that entry as `receiver_id` (base identity) and keeps it
  out of the supplied stock, so it can never be mistaken for an installable part (the old structural
  weight bound counted the receiver twice for this reason). The differential test compares the stock
  without the receiver and checks the receiver separately.
* **`count ?? 1` is gone.** It was never exercised on the pinned bytes (0 absent/null of 6112 entries; 0 of
  1128 barter ingredients), so the repair changes no pinned output. An absent, null or malformed preset
  count (not a finite nonnegative safe integer) and an absent, null, negative or non-finite barter
  ingredient count now throw a `SourceDataError` naming the preset or barter and the item (synthetic
  perturbation tests in `adapter.differential.test.ts`); the reference reader rejects the same inputs.
* **References:** 0 unresolved references across items, presets, default presets, slot filters,
  conflicts, categories, handbook categories, trader offers and barters.
* **Slot ids:** unique within every template (3673 slots, 1329 templates); **0 cross-template
  collisions** in this capture. Issue #29 still stands: the source gives no global guarantee.
* **Slot filters:** `allowedCategories`, `excludedCategories` and `excludedItems` are empty on every
  slot, so the adapter's projection to `allowedItems` loses nothing here.
* **Weights:** 0 absent; every raw token is canonical (round-trips through binary64). The 0.0155 kg
  item is `688b54a11cef2a61d005273b` (ELCAN SpecterDR mounting plate for Trijicon).
* **Self-conflicts:** 3 items list themselves in `conflictingItems` (kept verbatim).
* **Defaults exercised by the adapter** on guns, mods and gun presets: only `accuracyModifier ?? 0` and
  `recoilModifier ?? 0` on the 172 guns (mod-only fields). No other `??` default fires. The one item
  lacking `basePrice` is a helmet preset (`devtac-ronin-ballistic-helmet-olive-default`), outside the
  gun/mod domain.
* **Barters:** 855 total; 173 offer a mod and 134 a preset a gun lists (307 comparable offers); 4 offer
  guns (production ignores `bartersFor` on guns); 29 have `offeredItem.count > 1` (all ammo); 66 carry a
  `taskUnlock` (34 for gun/mod/preset targets).
* **Barter valuation:** production binary64 sums with `Math.round` equal the exact-rational
  `floor(total + 1/2)` reference on all 307 comparable offers (no float edge case occurs here).
* **Snapshot vs raw:** the snapshot has 172 guns, 2314 mods, 399 presets, 4391 preset entries, 56 with
  count > 1 (35 mods), explicit integer counts everywhere, and weights equal to the raw weights. Gun/mod
  id lists and preset quantities agree with the pinned raw capture. This is a consistency observation,
  not provenance.

## Adapter transformations: trusted and not trusted

A transformation is **trusted** only when the reference compares it field by field with nonzero
coverage and **zero mismatches** on the pinned bytes (English and Chinese). Checks are shown for one
language; Chinese produces the same counts.

| Trusted transformation | Checks | Evidence |
| :--- | ---: | :--- |
| guns/mods split by `types`, document order, no duplicates | 3 | `adapter.differential.test.ts` |
| translation: names, short names, slot/category/handbook/trader/flea names | 19,528 | requested -> English -> key, plus a synthetic fallback test on perturbed docs |
| ID dereferencing: presets, default preset, `containsItems[].item`, `conflictingItems`, slot `allowedItems`, slot ids, `nameId`, `required` | 21,996 | compared to raw ids |
| preset `containsItems` ids and validated counts passed through (no default) | 399 | all gun presets |
| `bsgCategory` chain rebuilt from `categories[0]` | 2,486 | also `findCategoryChainMismatches` = 0 |
| `buyFromTrader` -> `buyFor` (source, vendor, price, priceRUB, minTraderLevel, buyLimit) | 18,691 | trader ids all resolve |
| synthesized flea offer (rule, price, vendor descriptor) | 12,313 | against `referenceFleaOffer` |
| `bartersFor` by offered item, `level = minTraderLevel`, ingredient ids/counts/prices | 5,462 | compared to raw barters |
| weights, prices, modifiers, other `properties` | 39,426 | exact equality |

Each comparison is shown to be able to fail: deliberately corrupted adapter output is flagged for every
transformation.

| NOT trusted / unproved | Why |
| :--- | :--- |
| `containsItems[].count ?? 1` | **Repaired.** The unproved default (ADR 0013 §4A) was removed; an absent/null/malformed count is a `SourceDataError`. |
| barter `req.count ?? 1` | **Repaired.** Same default removed; an absent/null count is a `SourceDataError`, fractional counts stay valid. |
| slot `filters` projected to `allowedItems` | Drops three source fields; nothing lost in this capture, but no source contract promises that. |
| barter `offeredItem.count` | Ignored. The reference buys a barter in whole lots (`INTERPRETATIONS.md` choice 1): a lot of n units costs its rounded total once, so a deficit of one unit costs the whole lot and a deficit above n needs another lot. Production prices every unit at the full lot price, which over-charges any deficit of two or more units from such a lot. Matters only for ammunition here (29 barters). |
| barter `taskUnlock` | Ignored; 34 gun/mod/preset barters are task-gated yet treated as available. |
| flea `avg24hPrice \|\| lastLowPrice` | Zero `avg24hPrice` never occurs, so the data cannot tell `\|\|` from `??`; only the reference unit test pins the rule. |
| display-only fields (`iconLink`, image links) | Not compared. |
| downstream `extractAllPresets` | **Repaired.** Keeps counts (repeated entries summed, receiver carried as `receiver_id`). |

## The two Stage 1 `todo` tests are repaired (Stage 2 phase 2.2)

Stage 1 shipped two `todo` tests, each with a companion test that pinned the defect. Both are now real
tests, the companions were deleted, and the suite has no `todo`:

* `extractors.differential.test.ts` -- "production extractAllPresets preserves reference preset
  quantities" passes: zero mismatches over all 399 presets. Controls show it can fail: a tampered count is
  flagged, and a count-collapsed output (the pre-repair shape) is flagged for exactly the 56 multi-copy
  entries. Further tests pin the multi-copy population (56 entries, 52 presets, 35 mods) and the
  receiver-as-identity rule.
* `adapter.differential.test.ts` -- "the adapter rejects an absent/null/malformed preset count as a source
  error naming the preset and the item" passes, with absent, null, fractional, negative, string, boolean,
  unsafe-integer and overflowing (`1e999`) variants, and the barter ingredient count rule (absent, null,
  negative and string rejected; fractional accepted; a barter for an item the adapter never converts does
  not block loading).

## Known limits

* **No raw provenance for the normalized snapshot.** `snapshot.json` came through `fetchAllData` at an
  earlier time; no raw upstream capture of it exists. The pin was fetched later, and the live JSON API
  changes continuously. The manifest says so (`NOT byte-linked`). Differential checks run the production
  adapter on the *pin*, so they bound the adapter's behavior, not the snapshot's production history.
  Checks that touch the snapshot use only fields it retains, and cross-capture agreement is reported,
  not claimed as provenance.
* **Rules are re-encoded, not upstream truth.** The flea synthesis and barter valuation come from the
  documented rules (CLAUDE.md, ADR 0010); the reference verifies the adapter implements them, not that
  tarkov-api does.
* Only `regular` mode, English plus Chinese, is pinned. `pve` and `pvp-season` are not covered.
* **`dataService.ts` is imported dynamically** in `extractors.differential.test.ts` through a non-literal
  specifier. `tsconfig.reference.json` has no DOM lib, and `dataService.ts` needs IndexedDB types and a
  typed `Response.json()`, so a static import would break `tsc -b` for the reference project. The slice
  of the production surface used is declared locally. `jsonApiAdapter.ts` is imported statically.
* The slot-id, reference and count findings describe this capture. A re-pin must re-run the checks;
  several assertions pin exact observed numbers on purpose so a change is flagged, not absorbed.
