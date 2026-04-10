# Barter Toggle Design Spec

## Summary

Add a UI toggle to enable barter trades as an item acquisition source. When enabled, the optimizer considers barter trades alongside cash purchases from traders and the flea market. Barter "price" is the sum of flea market values of required input items. Applies to both individual mods and weapon presets.

## Context

The tarkov.dev GraphQL API exposes `bartersFor` on items, but the optimizer currently only fetches `buyFor` (cash purchases). Items acquirable only via barter show as "Not on market" and are effectively excluded from optimization. Users have requested a way to include barter trades.

## Approach: Barter as tagged offer source

Barter trades are converted into `OfferInfo` entries with a `"barter:"` prefix on the source field (e.g. `"barter:peacekeeper"`). They're injected into the existing `offers[]` array alongside cash offers. The existing price filtering, LP building, and solving pipeline all work unchanged. A new `barterAvailable` boolean controls whether barter offers pass through `getAvailablePrice()`.

## Design

### 1. Data Layer — GraphQL Queries

Add `bartersFor` to both GUNS_QUERY (inside `presets { }` block) and MODS_QUERY in `frontend/src/solver/dataService.ts` and `queries.py`:

```graphql
bartersFor {
  trader { name normalizedName }
  level
  requiredItems {
    item { id name avg24hPrice basePrice }
    count
  }
}
```

### 2. Data Processing — Barter to OfferInfo conversion

**Location:** `dataService.ts` — in both the mod extraction path and `extractAllPresets()`.

For each barter trade entry:
1. Compute price: `sum(requiredItem.count * (requiredItem.item.avg24hPrice ?? requiredItem.item.basePrice ?? 0))` for all required items
2. Skip if computed price <= 0
3. Create `OfferInfo`:
   - `price`: computed barter cost
   - `source`: `"barter:{trader.normalizedName}"` (e.g. `"barter:peacekeeper"`)
   - `vendor_name`: trader name
   - `vendor_normalized`: trader normalizedName
   - `trader_level`: barter's `level` field
4. Append to the item's `offers[]` array

After all offers (cash + barter) are collected, sort by price as already done. The lowest-price offer (cash or barter) becomes the item's `price` and `price_source`.

**Python parity:** Apply the same logic in `weapon_optimizer.py` `extract_mod_stats()` and preset extraction.

### 3. Filtering — getAvailablePrice()

**Location:** `dataService.ts` `getAvailablePrice()` (and Python equivalent).

Add a `barterAvailable: boolean` parameter. When iterating offers, skip any offer whose `source` starts with `"barter:"` if `barterAvailable` is false.

Barter offers from traders still respect trader level filtering: a `"barter:peacekeeper"` offer with `trader_level: 3` requires peacekeeper LL3, same as cash offers. Note: barter cost computation always uses `avg24hPrice ?? basePrice` regardless of flea availability — these are reference values for opportunity cost, not a purchase the user makes on flea.

### 4. State & Config

**App.tsx:** Add `barterAvailable` state (default: `false`), persisted to localStorage alongside `fleaAvailable` and `traderLevels`.

**Worker messages:** Pass `barterAvailable` through the existing config path to the solver worker alongside `fleaAvailable`, `traderLevels`, and `playerLevel`.

### 5. UI — Toggle

**Location:** In the `LevelConfig` component area, alongside the existing flea market toggle.

Add a Switch/toggle labeled with i18n key `sidebar.barter_available` ("Barter trades"). Default off.

### 6. UI — Result Display

**Location:** `ItemRow.tsx` `TraderIcon` component.

When `source` starts with `"barter:"`:
1. Extract trader name: `source.replace("barter:", "")`
2. Show the trader's icon (reuse existing `traderIcons` map)
3. Add a visual barter indicator — small swap/exchange icon or "(Barter)" text suffix
4. Tooltip: "Acquired via barter trade from {Trader}"

### 7. Solver / LP Builder

**No changes required.** Barter offers are indistinguishable from cash offers in the LP model — they're just `OfferInfo` entries with a ruble price. The `buy_*` variables, price constraints, and objective function all work as-is.

### 8. i18n

Add keys to `zh.json` first (source of truth), then sync to all 16 locale files:

- `sidebar.barter_available`: "Barter trades" / toggle label
- `item.barter_source`: "Barter from {{trader}}" / tooltip text in results

### 9. Edge Cases

- **Barter items with `avg24hPrice: null`:** Fall back to `basePrice`. If both are null/0, skip that required item's cost contribution (treat as 0). If total barter cost is 0, skip the barter offer entirely.
- **GP coins:** `avg24hPrice` is null (not tradeable on flea). Use `basePrice` (7500 RUB). This is an approximation but acceptable.
- **Multiple barters for same item:** An item can have multiple barter trades (different traders/levels). Each becomes a separate `OfferInfo`. The cheapest available one wins.
- **Preset-only barters:** Some weapon presets are only available via barter. With the toggle on, these become selectable as base configurations.
- **Flea off + barter on:** Valid combination. Barter costs are computed using `avg24hPrice` (as a reference value), even though the user can't access flea. This is the standard community convention — barter cost represents opportunity cost regardless of flea access.

## Non-Goals

- Craft trades (`craftsFor`) — different mechanic, separate feature
- Displaying barter input items in the UI — just show the ruble-equivalent cost
- Separate "barter budget" constraint — barters count toward the same price limit as cash purchases
