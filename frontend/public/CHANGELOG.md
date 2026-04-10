# Changelog

All notable changes to the Tarkov Weapon Mod Optimizer.

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
