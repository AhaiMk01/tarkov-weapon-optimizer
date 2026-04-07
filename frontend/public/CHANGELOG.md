# Changelog

All notable changes to the Tarkov Weapon Mod Optimizer.

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
