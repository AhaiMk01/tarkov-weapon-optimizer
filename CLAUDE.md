# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tarkov Weapon Mod Optimizer finds mathematically optimal weapon builds for Escape from Tarkov using constraint optimization. It models slot compatibility, item conflicts, and multi-objective tradeoffs (ergonomics, recoil, price) as a **linear program with integrality-like structure**, solved in the browser via **HiGHS**.

The project has **two parallel implementations**:
1. **Streamlit app** (root-level Python) — OR-Tools **CP-SAT** solver, distributable as PyInstaller executable
2. **React frontend** (`frontend/`) — **HiGHS WASM** running client-side in a Web Worker (no backend), deployed to GitHub Pages

## Development Commands

### Streamlit App (Python)
```bash
pixi run start                    # Launches on localhost:8501
# Or: streamlit run app.py
# Or: pip install -r requirements.txt && streamlit run app.py
```

### React Frontend
```bash
npm install --prefix frontend     # Install dependencies
npm run dev --prefix frontend     # Vite dev server with HMR
npm run build --prefix frontend   # Production build (tsc + vite) → frontend/dist/
npm run lint --prefix frontend    # ESLint
npm run preview --prefix frontend # Preview production build
```

### Verification Tests
```bash
cd frontend && npx tsx test_multi_weapon_verification.ts   # buildLP + HiGHS on real weapons (writes temporary .lp files)
cd frontend && npx tsx test_recoil_maximizer.ts             # recoil-weighted solve via same `solve()` path as the app
```

### PyInstaller Executable
```bash
# See tarkov-optimizer.spec or .github/workflows/build.yml for full command
# Entry point: launcher.py → bundles app.py, weapon_optimizer.py, queries.py, i18n.py, locales/
```

## Architecture

### React Frontend (Active Development)

The frontend runs entirely in the browser with no backend:

**Data Flow:**
```
UI Component → api/client.ts → Web Worker (solver.worker.ts) → solver.ts → HiGHS WASM
                                     ↕
                              dataService.ts → Tarkov.dev GraphQL API (via fetch)
                                     ↕
                              IndexedDB (browser cache)
```

**Solver Pipeline (`frontend/src/solver/`):**
1. `dataService.ts` — Fetches guns/mods from Tarkov.dev GraphQL API, builds `ItemLookup`, caches in IndexedDB
2. `compatibilityMap.ts` — BFS traversal from weapon to discover all reachable mods and slot relationships
3. `lpBuilder.ts` — Builds a **CPLEX LP format** string (`buildLP`): binary-style decisions as a continuous LP with constraints matching the CP-SAT model (scaled ergo/recoil/price coefficients; auxiliary objective variable for long lines HiGHS parses poorly)
4. `solver.ts` — Loads **HiGHS** (`highs` npm package / WASM), runs `highs.solve(lpString)`, reads column primals for `x_*`, `base_*`, `buy_*`, assembles `OptimizeResponse` and final stats
5. `solver.worker.ts` — Web Worker wrapper; handles `loadData`, `optimize`, `explore`, `getInfo`, `getWeaponMods`, `getGunsmithTasks`, `getStatus` messages
6. `paretoExplorer.ts` — Sweeps one objective axis (price / recoil / ergo ignored) to approximate Pareto frontier points; each point is a full `solve()` call

**API Client (`api/client.ts`):** All `getInfo`, `optimize`, `explore`, etc. communicate via `postMessage` to the Web Worker — not HTTP. Signatures stay stable so UI code does not depend on transport.

**HiGHS WASM assets:** `solver.ts` passes `locateFile` so `*.wasm` loads from the site origin (`/`). For very large LPs, a **custom WASM build** with higher initial memory may be used; see `frontend/vendor/highs/README.md` (upstream highs-js with increased `INITIAL_MEMORY` / stack).

**UI Stack:**
- React 19 + TypeScript + Vite
- Ant Design 6 (theming via ConfigProvider, light/dark/auto modes)
- recharts for Pareto frontier visualization
- `TernaryPlot.tsx` — Barycentric coordinate widget for 3-way weight adjustment (ergo/recoil/price)
- i18next for 16 languages, translations in `frontend/public/locales/*.json`

**Key Frontend Directories:**
- `components/optimize/` — Single build optimization panel and results
- `components/explore/` — Pareto frontier exploration UI
- `components/gunsmith/` — Gunsmith task optimization
- `components/common/` — Shared UI: WeaponSelector, LevelConfig, ModFilter, TernaryPlot, StatsCards, BuildManifest
- `layouts/` — Responsive layout wrapper

### Streamlit App (Python, Root Level)

- `app.py` — Streamlit UI, sidebar config, tabs (optimize/explore/gunsmith)
- `weapon_optimizer.py` — Core CP-SAT solver: BFS compatibility mapping + OR-Tools MIP model
- `queries.py` — GraphQL queries for guns and mods from Tarkov.dev API
- `i18n.py` — Python i18n module
- `launcher.py` — PyInstaller entry point with browser auto-open
- `locales/` — Translation JSON files (16 languages)

### Solver Model (Both Implementations)

**Decision Variables:** Binary selections for items and base/preset (`x[item]`, `base[...]` in the LP; purchase tracking via `buy_*` columns where applicable).

**Constraints:** Slot capacity, connectivity (child requires a selected parent along the slot graph), conflict exclusion, exactly one naked gun or preset base, availability (trader levels, flea market, player level), and limits on price, ergonomics, vertical recoil, recoil sum, mag capacity, sighting range, weight.

**Objective:** Weighted combination of ergonomics, recoil modifier contribution, and price. Coefficients are **scaled** in `lpBuilder.ts` (`ERGO_SCALE`, `SCALE`) for numeric stability; see comments there for the exact linear form.

## Data Source

All weapon/mod data from **Tarkov.dev GraphQL API** (`https://api.tarkov.dev/graphql`).
- Game modes: `regular`, `pve`
- Languages: en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk

## CI/CD

- `.github/workflows/build.yml` — PyInstaller builds (Windows/Linux/macOS) on `v*` tags, creates GitHub Release
- `.github/workflows/deploy.yml` — GitHub Pages deployment from `frontend-only-ghpages` branch

## Internationalization

16 languages supported. Translation files:
- React: `frontend/public/locales/{lang}.json`
- Streamlit: `locales/{lang}.json`

When adding translations, add keys to `zh.json` first (source of truth), then sync to all 16 locale files.

## Versioning & Release Workflow

**Versioning strategy:** Semantic versioning (`vMAJOR.MINOR.PATCH`).
- **MAJOR** — architectural changes (e.g. Python→Web, solver engine swap)
- **MINOR** — new user-facing features (new constraints, UI panels, integrations)
- **PATCH** — bug fixes, solver accuracy fixes, styling tweaks

**Current version:** defined in `frontend/package.json` `"version"` field and `frontend/index.html` `<title>` tag.

**Release checklist** (when user says "update changelog, commit, bump version, and push"):
1. Update `CHANGELOG.md` at repo root — add entries under `[vX.Y.Z] — YYYY-MM-DD`
2. Copy `CHANGELOG.md` → `frontend/public/CHANGELOG.md` (served to the changelog modal)
3. Bump `"version"` in `frontend/package.json`
4. Update `<title>` in `frontend/index.html` to include version
5. Run i18n sync: programmatically find missing keys in `en.json` vs all other locale files, patch missing keys with English fallbacks
6. Stage all changed files, commit with message: `feat: vX.Y.Z — <summary>`
7. Create git tag: `git tag vX.Y.Z`
8. Push commit and tag: `git push && git push --tags`

**Changelog format** (Keep a Changelog style):
```
## [vX.Y.Z] — YYYY-MM-DD
### Added / Changed / Fixed / Removed
- Description of change
```

Only include web app (v2.0.0+) history in the changelog. Pre-web-app Python versions are not tracked.

## Common Pitfalls

- **HiGHS WASM memory / failures**: Large models can exhaust default WASM memory; use the custom build documented under `frontend/vendor/highs/`. On solve exceptions, `solver.ts` sets a **corrupted** flag and re-instantiates HiGHS on the next call.
- **Recoil is a modifier, not absolute**: The model optimizes summed **recoil modifiers**; displayed vertical/horizontal recoil are `naked_recoil * (1 + totalRecoilMod)`. Hard caps on final vertical recoil must be converted when building constraints.
- **Preset handling**: Preset-contained items avoid double-counting purchase price; base cost comes from the selected preset / naked base in the LP.
- **LP vs CP-SAT parity**: Frontend LP is ported to align with `weapon_optimizer.py`; when changing constraints or objective, update both or re-run `test_multi_weapon_verification.ts` against known weapons.
- **Hardcoded colors**: Use antd theme tokens (`token.colorPrimary`, etc.) for dark/light mode compatibility.
- **Worker state**: The Web Worker caches data per `lang:gameMode` key — changing language/mode triggers a fresh data load.
- **`backend/` directory is empty/legacy** — actual backend logic is in root-level Python files, not in `backend/app/`.
