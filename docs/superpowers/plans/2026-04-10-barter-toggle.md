# Barter Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to toggle barter trades as an item source, with barter price = flea value of required input items, displayed with a barter indicator in results.

**Architecture:** Add `bartersFor` to GraphQL queries, convert barters into `OfferInfo` entries with `"barter:"` source prefix, filter them via a new `barterAvailable` flag threaded through the existing config pipeline. No solver/LP changes needed.

**Tech Stack:** TypeScript, React, Ant Design, tarkov.dev GraphQL API, i18next

---

### Task 1: Add `barterAvailable` to SolveParams and API types

**Files:**
- Modify: `frontend/src/solver/types.ts:178` (SolveParams)
- Modify: `frontend/src/api/client.ts:46` (OptimizeRequest)
- Modify: `frontend/src/solver/paretoExplorer.ts:29` (ParetoParams)

- [ ] **Step 1: Add `barterAvailable` to SolveParams**

In `frontend/src/solver/types.ts`, add after line 177 (`fleaAvailable?: boolean;`):

```typescript
  barterAvailable?: boolean;
```

- [ ] **Step 2: Add `barter_available` to OptimizeRequest**

In `frontend/src/api/client.ts`, add after line 46 (`flea_available?: boolean;`):

```typescript
  barter_available?: boolean;
```

- [ ] **Step 3: Add `barterAvailable` to ParetoParams**

In `frontend/src/solver/paretoExplorer.ts`, add after line 29 (`fleaAvailable?: boolean;`):

```typescript
  barterAvailable?: boolean;
```

- [ ] **Step 4: Pass through in paretoExplorer buildBaseParams**

In `frontend/src/solver/paretoExplorer.ts`, add after line 48 (`fleaAvailable: p.fleaAvailable ?? true,`):

```typescript
    barterAvailable: p.barterAvailable ?? false,
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/solver/types.ts frontend/src/api/client.ts frontend/src/solver/paretoExplorer.ts
git commit -m "feat(barter): add barterAvailable to SolveParams, OptimizeRequest, ParetoParams"
```

---

### Task 2: Add `bartersFor` to GraphQL queries and convert to OfferInfo

**Files:**
- Modify: `frontend/src/solver/dataService.ts:144-251` (MODS_QUERY, add bartersFor)
- Modify: `frontend/src/solver/dataService.ts:80-114` (GUNS_QUERY presets block, add bartersFor)
- Modify: `frontend/src/solver/dataService.ts:529-605` (extractModStats, process bartersFor)
- Modify: `frontend/src/solver/dataService.ts:399-464` (extractAllPresets, process bartersFor)

- [ ] **Step 1: Add bartersFor to MODS_QUERY**

In `frontend/src/solver/dataService.ts`, inside the MODS_QUERY string, add after the `buyFor { ... }` block (after line 162, before `accuracyModifier`):

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

- [ ] **Step 2: Add bartersFor to GUNS_QUERY presets block**

In `frontend/src/solver/dataService.ts`, inside the GUNS_QUERY `presets { ... }` block, add after the `buyFor { ... }` block (after line 113, before `}`):

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

- [ ] **Step 3: Add helper function to convert bartersFor to OfferInfo array**

In `frontend/src/solver/dataService.ts`, add before `extractModStats` (before line 529):

```typescript
/** Convert bartersFor entries into OfferInfo with "barter:" source prefix. */
function extractBarterOffers(bartersFor: unknown[]): OfferInfo[] {
  const offers: OfferInfo[] = [];
  for (const barter of bartersFor) {
    if (typeof barter !== 'object' || !barter) continue;
    const b = barter as Record<string, unknown>;
    const trader = b.trader as Record<string, string> | undefined;
    if (!trader) continue;
    const level = typeof b.level === 'number' ? b.level : 1;
    const requiredItems = (b.requiredItems ?? []) as Array<{
      item?: { avg24hPrice?: number | null; basePrice?: number | null };
      count?: number;
    }>;
    let totalCost = 0;
    for (const ri of requiredItems) {
      const count = ri.count ?? 1;
      const price = ri.item?.avg24hPrice ?? ri.item?.basePrice ?? 0;
      totalCost += count * price;
    }
    if (totalCost <= 0) continue;
    offers.push({
      price: Math.round(totalCost),
      source: `barter:${trader.normalizedName ?? trader.name ?? 'unknown'}`,
      vendor_name: trader.name ?? '',
      vendor_normalized: trader.normalizedName ?? '',
      trader_level: level,
    });
  }
  return offers;
}
```

- [ ] **Step 4: Use extractBarterOffers in extractModStats**

In `frontend/src/solver/dataService.ts` `extractModStats()`, after the `buyFor` offer loop (after line 568, `offers.sort((a, b) => a.price - b.price);`), insert before the sort:

Replace:
```typescript
  offers.sort((a, b) => a.price - b.price);
```

With:
```typescript
  const bartersFor = mod.bartersFor ?? [];
  if (Array.isArray(bartersFor)) {
    offers.push(...extractBarterOffers(bartersFor));
  }
  offers.sort((a, b) => a.price - b.price);
```

- [ ] **Step 5: Use extractBarterOffers in extractAllPresets**

In `frontend/src/solver/dataService.ts` `extractAllPresets()`, after the `buyFor` offer loop (after line 440, `offers.sort((a, b) => a.price - b.price);`), insert before the sort:

Replace:
```typescript
    offers.sort((a, b) => a.price - b.price);
```

With:
```typescript
    const bartersFor = preset.bartersFor ?? [];
    if (Array.isArray(bartersFor)) {
      offers.push(...extractBarterOffers(bartersFor));
    }
    offers.sort((a, b) => a.price - b.price);
```

- [ ] **Step 6: Update hasValidPrice to recognize barter-only items**

In `frontend/src/solver/dataService.ts` `hasValidPrice()`, add a barter check after the buyFor check (after line 356, before the avg24hPrice fallback):

```typescript
  const bartersFor = item.bartersFor ?? [];
  if (Array.isArray(bartersFor) && bartersFor.length > 0) return true;
```

This ensures barter-only items (no buyFor, no reference price) are included in the item lookup.

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build --prefix frontend`
Expected: No TypeScript errors. (Barter offers are now in the data but not yet filtered — default behavior unchanged since `barterAvailable` defaults to false and filtering isn't added yet.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/solver/dataService.ts
git commit -m "feat(barter): add bartersFor to GraphQL queries and convert to OfferInfo"
```

---

### Task 3: Filter barter offers in getAvailablePrice

**Files:**
- Modify: `frontend/src/solver/dataService.ts:635-697` (getAvailablePrice)

- [ ] **Step 1: Add barterAvailable parameter to getAvailablePrice**

In `frontend/src/solver/dataService.ts`, change the `getAvailablePrice` signature from:

```typescript
export function getAvailablePrice(
  stats: {
    purchasable?: boolean;
    offers?: OfferInfo[];
    price?: number;
    price_source?: string;
    min_level_flea?: number;
  },
  traderLevels: TraderLevels = DEFAULT_TRADER_LEVELS,
  fleaAvailable = true,
  playerLevel: number | null = null,
): [number, string | null, boolean, string | null] {
```

To:

```typescript
export function getAvailablePrice(
  stats: {
    purchasable?: boolean;
    offers?: OfferInfo[];
    price?: number;
    price_source?: string;
    min_level_flea?: number;
  },
  traderLevels: TraderLevels = DEFAULT_TRADER_LEVELS,
  fleaAvailable = true,
  playerLevel: number | null = null,
  barterAvailable = false,
): [number, string | null, boolean, string | null] {
```

- [ ] **Step 2: Add barter filtering in the offer loop**

In the `for (const offer of offers)` loop inside `getAvailablePrice`, add at the top of the loop body (after line 670, `const source = offer.source;`):

```typescript
    // Skip barter offers when barter toggle is off
    if (!barterAvailable && source.startsWith('barter:')) continue;
```

- [ ] **Step 3: Handle purchasable flag for barter-only items**

Currently, items with no `buyFor` but with barters have `purchasable: false` if their barter offers are the only offers and `buyFor` was empty. After Task 2, `purchasable` is set based on `offers.length > 0` which now includes barter offers. But we also need to handle the early return in `getAvailablePrice` — if `purchasable === false`, it returns `[0, 'not_purchasable', false, null]` immediately.

The `purchasable` flag in `extractModStats` is set at line 570: `const purchasable = offers.length > 0;`. After Task 2, this will be `true` for barter-only items since barter offers are in the array. This is correct — no change needed here. The `getAvailablePrice` filter loop will skip barter offers when `barterAvailable` is false, returning `[0, null, false, null]` naturally.

However, the `reference_price_rub` line at 589 (`reference_price_rub: !purchasable ? referencePriceRub : undefined`) will no longer set a reference price for items that only have barter offers but are now `purchasable: true`. This is fine — these items have a real price via barter.

No additional code change needed for this step. This is a verification step.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build --prefix frontend`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/solver/dataService.ts
git commit -m "feat(barter): filter barter offers via barterAvailable flag in getAvailablePrice"
```

---

### Task 4: Thread barterAvailable through solver pipeline

**Files:**
- Modify: `frontend/src/solver/lpBuilder.ts:95-100,140-145` (getAvailablePrice calls)
- Modify: `frontend/src/solver/solver.ts:143-156` (getAvailablePrice calls in result building)
- Modify: `frontend/src/solver/solver.worker.ts:130-152,160-189` (pass barter_available from request)

- [ ] **Step 1: Thread in lpBuilder.ts preset filtering**

In `frontend/src/solver/lpBuilder.ts`, change lines 95-100 from:

```typescript
    const [pPrice, , pAvail] = getAvailablePrice(
      preset,
      params.traderLevels ?? undefined,
      params.fleaAvailable ?? true,
      params.playerLevel ?? null,
    );
```

To:

```typescript
    const [pPrice, , pAvail] = getAvailablePrice(
      preset,
      params.traderLevels ?? undefined,
      params.fleaAvailable ?? true,
      params.playerLevel ?? null,
      params.barterAvailable ?? false,
    );
```

- [ ] **Step 2: Thread in lpBuilder.ts item filtering**

In `frontend/src/solver/lpBuilder.ts`, change lines 140-145 from:

```typescript
      [price, source, canBuyAtSettings] = getAvailablePrice(
        stats,
        params.traderLevels ?? undefined,
        params.fleaAvailable ?? true,
        params.playerLevel ?? null,
      );
```

To:

```typescript
      [price, source, canBuyAtSettings] = getAvailablePrice(
        stats,
        params.traderLevels ?? undefined,
        params.fleaAvailable ?? true,
        params.playerLevel ?? null,
        params.barterAvailable ?? false,
      );
```

- [ ] **Step 3: Thread in solver.ts result price computation**

In `frontend/src/solver/solver.ts`, at line 145-146, change:

```typescript
    const traderLevels = params.traderLevels ?? undefined;
    const fleaAvailable = params.fleaAvailable ?? true;
    const playerLevel = params.playerLevel ?? null;
```

To:

```typescript
    const traderLevels = params.traderLevels ?? undefined;
    const fleaAvailable = params.fleaAvailable ?? true;
    const playerLevel = params.playerLevel ?? null;
    const barterAvailable = params.barterAvailable ?? false;
```

Then update the two `getAvailablePrice` calls in solver.ts:

At line 155 (mod buy price), change:

```typescript
          const [price] = getAvailablePrice(entry.stats, traderLevels, fleaAvailable, playerLevel);
```

To:

```typescript
          const [price] = getAvailablePrice(entry.stats, traderLevels, fleaAvailable, playerLevel, barterAvailable);
```

At line 170 (preset price), change:

```typescript
        const [filteredPrice, src, , purchaseLabel] = getAvailablePrice(preset, traderLevels, fleaAvailable, playerLevel);
```

To:

```typescript
        const [filteredPrice, src, , purchaseLabel] = getAvailablePrice(preset, traderLevels, fleaAvailable, playerLevel, barterAvailable);
```

- [ ] **Step 4: Thread in solver.worker.ts optimize handler**

In `frontend/src/solver/solver.worker.ts`, at line 149 (`fleaAvailable: req.flea_available ?? true,`), add after:

```typescript
            barterAvailable: req.barter_available ?? false,
```

- [ ] **Step 5: Thread in solver.worker.ts explore handler**

In `frontend/src/solver/solver.worker.ts`, at line 186 (`fleaAvailable: req.flea_available ?? true,`), add after:

```typescript
            barterAvailable: req.barter_available ?? false,
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build --prefix frontend`
Expected: No TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/solver/lpBuilder.ts frontend/src/solver/solver.ts frontend/src/solver/solver.worker.ts
git commit -m "feat(barter): thread barterAvailable through solver pipeline"
```

---

### Task 5: Add UI state and toggle

**Files:**
- Modify: `frontend/src/App.tsx:80-104` (readStoredLevelConfig)
- Modify: `frontend/src/App.tsx:219` (state declaration)
- Modify: `frontend/src/App.tsx:254-259` (localStorage persistence)
- Modify: `frontend/src/App.tsx:397-401,435-438,476-479` (pass to optimize/explore/gunsmith)
- Modify: `frontend/src/App.tsx:580-588` (commonPanelProps)
- Modify: `frontend/src/App.tsx:673` (GunsmithPanel props)
- Modify: `frontend/src/components/common/LevelConfig.tsx` (add Switch)
- Modify: `frontend/src/components/optimize/OptimizePanel.tsx:49-54,106-113` (prop threading)
- Modify: `frontend/src/components/explore/ExplorePanel.tsx:41,106` (prop threading)
- Modify: `frontend/src/components/gunsmith/GunsmithPanel.tsx` (prop threading)

- [ ] **Step 1: Add barterAvailable to readStoredLevelConfig**

In `frontend/src/App.tsx`, change the `readStoredLevelConfig` function.

Change the return type (line 80):

```typescript
function readStoredLevelConfig(): { playerLevel: number; fleaAvailable: boolean; barterAvailable: boolean; traderLevels: TraderLevels } {
```

Change the fallback (line 81):

```typescript
  const fallback = { playerLevel: 60, fleaAvailable: true, barterAvailable: false, traderLevels: { ...DEFAULT_TRADER_LEVELS } }
```

In the parsed object type (around line 87), add:

```typescript
      barterAvailable?: unknown
```

Before the return (after line 103), add:

```typescript
    const barterAvailable = typeof o.barterAvailable === 'boolean' ? o.barterAvailable : fallback.barterAvailable
```

Change the return (line 104):

```typescript
    return { playerLevel, fleaAvailable, barterAvailable, traderLevels }
```

- [ ] **Step 2: Add state and persistence**

In `frontend/src/App.tsx`, after line 219 (`const [fleaAvailable, setFleaAvailable] = ...`), add:

```typescript
  const [barterAvailable, setBarterAvailable] = useState(initialLevelConfig.barterAvailable)
```

Change the localStorage persistence (line 257):

```typescript
      JSON.stringify({ playerLevel, fleaAvailable, barterAvailable, traderLevels }),
```

Update the useEffect dependency array (line 259):

```typescript
  }, [playerLevel, fleaAvailable, barterAvailable, traderLevels])
```

- [ ] **Step 3: Pass barterAvailable to optimize/explore/gunsmith handlers**

In `handleOptimize` (around line 399), add after `flea_available: fleaAvailable,`:

```typescript
        barter_available: barterAvailable,
```

In `handleExplore` (around line 437), add after `flea_available: fleaAvailable,`:

```typescript
        barter_available: barterAvailable,
```

In `handleGunsmithOptimize` (around line 478), add after `flea_available: fleaAvailable,`:

```typescript
        barter_available: barterAvailable,
```

- [ ] **Step 4: Add to commonPanelProps**

In `frontend/src/App.tsx` commonPanelProps (around line 582), add after `onFleaChange: setFleaAvailable,`:

```typescript
    barterAvailable,
    onBarterChange: setBarterAvailable,
```

- [ ] **Step 5: Add to GunsmithPanel props**

In `frontend/src/App.tsx` GunsmithPanel usage (around line 673), add after `onFleaChange={setFleaAvailable}`:

```typescript
              barterAvailable={barterAvailable}
              onBarterChange={setBarterAvailable}
```

- [ ] **Step 6: Update LevelConfig component**

In `frontend/src/components/common/LevelConfig.tsx`, add to the interface (after line 9):

```typescript
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
```

Add to the destructured props (after line 19, `onFleaChange,`):

```typescript
  barterAvailable,
  onBarterChange,
```

Add the barter toggle in the JSX, after the flea market switch div (after line 35):

```tsx
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('sidebar.barter_available')}</Text>
              <Switch checked={barterAvailable} onChange={onBarterChange} />
            </div>
```

- [ ] **Step 7: Thread through OptimizePanel**

In `frontend/src/components/optimize/OptimizePanel.tsx`, add to the interface (after line 49, `fleaAvailable: boolean`):

```typescript
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
```

Add to the LevelConfig usage (after line 108, `onFleaChange={props.onFleaChange}`):

```typescript
        barterAvailable={props.barterAvailable}
        onBarterChange={props.onBarterChange}
```

- [ ] **Step 8: Thread through ExplorePanel**

In `frontend/src/components/explore/ExplorePanel.tsx`, add to the interface (after `fleaAvailable: boolean`):

```typescript
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
```

Add to the LevelConfig usage (after `onFleaChange={props.onFleaChange}`):

```typescript
        barterAvailable={props.barterAvailable}
        onBarterChange={props.onBarterChange}
```

- [ ] **Step 9: Thread through GunsmithPanel**

In `frontend/src/components/gunsmith/GunsmithPanel.tsx`, add to the interface (after `fleaAvailable: boolean`):

```typescript
  barterAvailable: boolean
  onBarterChange: (v: boolean) => void
```

Add to the LevelConfig usage (after `onFleaChange={props.onFleaChange}`):

```typescript
        barterAvailable={props.barterAvailable}
        onBarterChange={props.onBarterChange}
```

- [ ] **Step 10: Verify the build compiles**

Run: `npm run build --prefix frontend`
Expected: No TypeScript errors.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/common/LevelConfig.tsx frontend/src/components/optimize/OptimizePanel.tsx frontend/src/components/explore/ExplorePanel.tsx frontend/src/components/gunsmith/GunsmithPanel.tsx
git commit -m "feat(barter): add barterAvailable UI toggle and thread through panels"
```

---

### Task 6: Display barter source in ItemRow

**Files:**
- Modify: `frontend/src/components/ItemRow.tsx:28-58` (TraderIcon component)

- [ ] **Step 1: Handle barter source in TraderIcon**

In `frontend/src/components/ItemRow.tsx`, in the `TraderIcon` component, add barter handling after the `not_purchasable` check (after line 41, before `const key = source.toLowerCase()...`):

```typescript
  if (source.startsWith('barter:')) {
    const traderKey = source.replace('barter:', '').toLowerCase().replace(/\s+/g, '')
    const trader = traderIcons[traderKey]
    const traderName = trader?.name || source.replace('barter:', '')
    if (compact) {
      return <Text type="secondary" style={{ minWidth: 80 }} title={`Barter from ${traderName}`}>{traderName} (B)</Text>
    }
    if (trader?.icon) {
      return (
        <div style={{ position: 'relative', display: 'inline-block' }} title={`Barter from ${traderName}`}>
          <img
            src={trader.icon}
            alt={traderName}
            style={{ width: 64, height: 64, borderRadius: 4, objectFit: 'cover' }}
          />
          <span style={{
            position: 'absolute', bottom: 0, right: 0,
            background: '#faad14', color: '#000', fontSize: 10, fontWeight: 700,
            borderRadius: '4px 0 4px 0', padding: '1px 4px', lineHeight: 1.2,
          }}>B</span>
        </div>
      )
    }
    return <Text type="secondary" title={`Barter from ${traderName}`}>{traderName} (Barter)</Text>
  }
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build --prefix frontend`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ItemRow.tsx
git commit -m "feat(barter): display barter source indicator in ItemRow TraderIcon"
```

---

### Task 7: Add i18n keys

**Files:**
- Modify: `frontend/public/locales/zh.json`
- Modify: all 16 locale files in `frontend/public/locales/`

- [ ] **Step 1: Add keys to zh.json (source of truth)**

In `frontend/public/locales/zh.json`, add in the `sidebar` section (after the `flea_market_access` entry):

```json
    "barter_available": "以物换物",
```

- [ ] **Step 2: Add keys to en.json**

In `frontend/public/locales/en.json`, add in the `sidebar` section (after the `flea_market_access` entry):

```json
    "barter_available": "Barter Trades",
```

- [ ] **Step 3: Sync to remaining 14 locale files**

For each remaining locale file (`ru.json`, `es.json`, `de.json`, `fr.json`, `it.json`, `ja.json`, `ko.json`, `pl.json`, `pt.json`, `tr.json`, `cs.json`, `hu.json`, `ro.json`, `sk.json`), add the `sidebar.barter_available` key with the English fallback `"Barter Trades"` if a proper translation is not available.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build --prefix frontend`
Expected: No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/public/locales/
git commit -m "feat(barter): add i18n keys for barter toggle in all 16 locales"
```

---

### Task 8: Manual verification

- [ ] **Step 1: Run the dev server**

Run: `npm run dev --prefix frontend`

Open the app in browser.

- [ ] **Step 2: Verify default behavior unchanged**

1. Select any weapon (e.g. M4A1), run optimize with default settings
2. Confirm results look normal — no barter items appear
3. Check the LevelConfig panel — confirm "Barter Trades" toggle is visible and OFF

- [ ] **Step 3: Verify barter toggle works**

1. Toggle "Barter Trades" ON
2. Run optimize again on the same weapon
3. Compare results — some items may now show barter sources (trader icon with "B" badge)
4. Check that barter items have a price in the results (not 0)

- [ ] **Step 4: Verify barter + flea off**

1. Toggle flea market OFF, keep barter ON
2. Run optimize — should still find builds using trader cash + barter offers

- [ ] **Step 5: Verify persistence**

1. With barter ON, refresh the page
2. Confirm the toggle is still ON after reload

- [ ] **Step 6: Run verification tests**

Run: `cd frontend && npx tsx test_multi_weapon_verification.ts`
Expected: Tests pass (these test the LP solver path; default barterAvailable=false means behavior unchanged).

- [ ] **Step 7: Run production build**

Run: `npm run build --prefix frontend`
Expected: Clean build with no errors.

- [ ] **Step 8: Commit any fixes if needed**

If any issues were found and fixed during verification, commit them:

```bash
git add -A
git commit -m "fix(barter): address issues found during manual verification"
```
