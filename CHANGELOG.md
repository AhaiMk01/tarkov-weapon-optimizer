# Changelog

All notable changes to the Tarkov Weapon Mod Optimizer.

## [v2.5.2] — 2026-04-18

### Fixed
- **Exact MOA floor now correctly reports the true minimum** for weapons like M16A1/ADAR where accuracy-boosting mods exist deep in the slot graph. Previously the floor-finder used linear cap-tightening (0.005 per step, 12 iterations) which stalled well above the true minimum on weapons where the seed solve starts far from the floor. Switched to binary search between `[0, seed]`, converging in ~log₂ iterations — M16A1 now reports 2.34 instead of 3.0.
- **Max MOA constraint is now correctly enforced when the LP skips all COI-barrel mods**. Previously, for weapons where the barrel slot is optional and replacement barrels carry a `centerOfImpact`, the big-M constraints only bound *when* a COI-barrel was installed. If the LP chose to skip every COI-barrel (using the intrinsic COI instead), the constraint became vacuous and the user's cap could be silently violated. Added a fallback constraint using the weapon's intrinsic COI, guarded by the sum of barrel indicator variables so it only binds when no COI-barrel is installed.

## [v2.5.1] — 2026-04-18

### Fixed
- **Docker image no longer restart-loops on IPv6-enabled hosts**: nginx now listens on both IPv4 (`listen 80`) and IPv6 (`listen [::]:80`), and the container's HEALTHCHECK probes `127.0.0.1` instead of `localhost` to avoid IPv6 resolution ambiguity. Previously, on Docker daemons with IPv6 enabled, the healthcheck could resolve `localhost` to `::1`, fail against the v4-only nginx, mark the container unhealthy, and trigger a restart loop.
- Removed unused `constraints.reset` key from 14 non-en/zh locale files.

## [v2.5.0] — 2026-04-18

### Added
- **Max MOA constraint now honors replaceable barrels**: For weapons like the VPO-215 and M700, swapping to a different barrel correctly changes the displayed MOA and the hard-constraint limit uses the installed barrel's `centerOfImpact` (not the weapon's intrinsic one). LP uses an exact big-M per-barrel formulation.
- **Exact slider floor toggle** (new "精确下限" / "Exact slider floor" row under Max MOA): when on, the slider's minimum is computed by actually solving for the lowest achievable MOA (respects slot reachability, conflicts, and barrel-specific compatibility). When off, the minimum is a theoretical per-category estimate that may not be reachable in practice. Toggle state persists to localStorage.

### Fixed
- Slider range no longer includes the weapon's intrinsic `centerOfImpact` for weapons with a required replaceable-barrel slot — the intrinsic value is never reachable in those cases.
- Displayed final MOA now correctly reflects the installed barrel's COI instead of always using the weapon's intrinsic value.

## [v2.4.3] — 2026-04-17

### Added
- **Docker self-hosting support**: Multi-architecture (`linux/amd64`, `linux/arm64`) Docker images are now built and published to GitHub Container Registry on every release tag. Pull with `docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest` — see README for the full quick-start recipe.
- Dockerfile and nginx config in `frontend/` support SPA fallback routing, correct WASM MIME handling, and tiered caching (immutable for hashed assets and `.wasm`, no-cache for locales and CHANGELOG).

## [v2.4.2] — 2026-04-12

### Fixed
- Language selector flags now render as SVG images (via `flag-icons`) instead of Unicode emoji, fixing broken display on Windows Chrome.
- Ternary plot (triangle weight picker) click and drag now works correctly in Chrome — dot no longer follows cursor on hover, only responds to click/drag.
- Fixed broken JSON syntax in 14 locale files (missing commas in constraints section).

## [v2.4.1] — 2026-04-12

### Added
- Mod categories now use **handbook categories** from the Tarkov.dev API, showing proper pluralized names (e.g. "Suppressors", "Magazines") instead of raw BSG category paths.
- Build result items display full handbook hierarchy path (e.g. "Weapon parts & mods > Functional mods > Suppressors") with leaf name shown in compact mode.

### Changed
- ModFilter category dropdown now uses antd built-in search filtering with inline +/- buttons per option.

### Fixed
- Fixed "Exclude dogtag barters" checkbox having no effect — the `barterExcludeDogtags` parameter was not passed to `getAvailablePrice` during LP construction.

## [v2.4.0] — 2026-04-11

### Added
- New **Table View** mode for results, providing a high-density spreadsheet layout for power users.
- Persistent view state (Detailed/Compact/Table) saved to local storage.
- Interactive Lock/Ban buttons directly inside the result table.
- New i18n keys for stats labels, units, and tooltips across the app.

### Changed
- Refactored mobile item cards for improved readability and vertical alignment.
- Updated accuracy (Acc) tag colors to Orange to distinguish them from Recoil (Green).
- Global footer now uses bullet separators and flex-wrapping to prevent layout orphans.

### Fixed
- Fixed missing `useTranslation` import in manifest components.
- Removed nested scrollbars in result containers to restore clean native browser scrolling.
- Locked price/trader columns in table mode to prevent horizontal layout shift.
- Translated ~25 untranslated UI keys (table headers, tooltips, lock/ban labels, barter labels) across all 14 non-English locales.
- Translated `ui.on`/`ui.off` toggles for all locales (was showing English "On"/"Off").
- Added missing `trader` section to 14 locale files.
- Fixed ternary plot vertex label showing preset name ("纯后坐") instead of axis label ("后坐").
- Fixed zh.json explore constraint labels still in English (limit_price, limit_recoil, limit_ergo).
- Removed unused imports (Tooltip, Switch, Select) causing TypeScript build failures.

## [v2.3.1] — 2026-04-10

### Fixed
- Fixed bug where tags would overlap horizontally with UI items when displayed in single-column on extremely small screens
- Safely drop to single-column earlier on narrow displays to prevent component squishing

## [v2.3.0] — 2026-04-10

### Added
- MOA stat card in optimize and gunsmith results — computed from weapon center of impact + mod accuracy modifiers
- Max MOA (Spread) hard constraint with weapon-specific slider range (best/base/worst marks)
- Accuracy (Acc) and sighting range tags on item rows alongside ergo/recoil
- Lock/ban buttons on result items to quickly require or exclude mods in next optimization
- Card-based item layout in detailed mode with 64x64 item icon, trader portrait, weight tag, price tag
- Retained items section moved into preset card as collapsible
- Category path shown under item name (e.g. "Gear mod > Magazine")
- "Hard Constraints" as a separate collapsible panel

### Changed
- Renamed "Level Config" to "Market & Trader Access"
- "Using Preset" label now shows "Naked Receiver" for naked gun builds
- Compact mode renders as slim single-line rows with horizontal lock/ban buttons

## [v2.2.1] — 2026-04-10

### Added
- Item tooltips with hi-res image, category path, weight, and capacity
- Preset tooltips with large weapon image
- Accuracy (MOA) and sighting range shown as inline tags on item rows
- Weight column in item rows
- Category path shown under item name (e.g. "Gear mod > Magazine")
- Lock/ban buttons on result items to quickly require or exclude mods in next build
- Two-column item grid layout on non-mobile screens
- Column divider line between item grid columns

### Changed
- Redesigned preset card — compact row layout with trader icon
- Use transparent-background images (image512px) instead of dark-bg icons
- Disabled light themes and auto mode — dark-only for now (item images need dark backgrounds)
- Default theme set to Dark OneDark

### Fixed
- Preset-retained items no longer show misleading trader source and price

## [v2.2.0] — 2026-04-10

### Added
- Barter trade support — toggle "Barter Trades" in Level Config to include barter-only items in optimization
- Barter cost calculated as flea market value of required trade-in items
- Barter source indicator — gold "B" badge on trader icons for barter-sourced items
- Barter requirement tooltip — hover to see trade-in items, counts, and flea prices
- Barter support for weapon presets (preset-only barters now selectable)

### Changed
- Preset-retained items no longer show a misleading trader source and price — they display "—" since they're included with the preset
- Version tag in header now shows full version (v2.2.0) instead of just "v2"

### Fixed
- Weapon search now accepts spaces (merged from community PR #5)

## [v2.1.2] — 2026-04-07

### Fixed
- Min magazine capacity defaults to Off instead of 30
- Switching weapons resets min magazine capacity to Off

## [v2.1.1] — 2026-04-07

### Changed
- Min magazine capacity: merged toggle switch into slider with "Off" tick at 0
- Synced missing i18n keys across all 16 locale files
- Added i18n sync step to release workflow in CLAUDE.md

## [v2.1.0] — 2026-04-07

### Added
- Min magazine capacity constraint with ticked slider showing valid capacities per weapon
- EFTForge export button for each Pareto frontier result in Explore tab
- Axis labels and uniform tick spacing on Explore scatter chart
- Optional budget limit for the ignored variable in Explore (e.g. cap price while exploring Ergo vs Recoil)
- Changelog modal accessible from footer

### Changed
- EFTForge buttons now open builds directly via URL parameter (`?build=<code>`) instead of clipboard
- Explore tradeoff labels from "Ignore X" to "X optional"
- Version management with semantic versioning (v2.1.0)

## [v2.0.0] — 2026-04-06

### Added
- **Web app** — full browser-based solver using HiGHS WASM, deployed to GitHub Pages (no backend required)
- EFTForge integration — export optimized builds with one click
- Solver precision mode (fast / precise / auto)
- Weight presets (pure recoil, pure ergo, balanced, budget, performance, recoil focus, ergo focus)
- Ternary plot for 3-way weight adjustment with slider toggle
- Dark / light / AMOLED theme support
- PvP / PvE game mode toggle
- 16 language support (en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk)

### Changed
- Solver ported from Python OR-Tools CP-SAT to HiGHS WASM LP (runs entirely in browser)
- Migrated to React 19 + Ant Design v6
- UI overhaul across all tabs

### Fixed
- Naked gun pricing (price=0 bug)
- LP builder numerical stability and FiR mod availability
- Solver buy-variable price accounting
- HiGHS WASM memory and gzip streaming corruption
- Trader icons and favicon path resolution
