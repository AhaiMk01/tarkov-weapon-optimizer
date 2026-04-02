# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tarkov Weapon Mod Optimizer finds mathematically optimal weapon builds for Escape from Tarkov using constraint programming. It models slot compatibility, item conflicts, and multi-objective optimization (ergonomics, recoil, price) as a Mixed Integer Program.

The project has **two parallel implementations**:
1. **Streamlit app** (root-level Python) — OR-Tools CP-SAT solver, distributable as PyInstaller executable
2. **React frontend** (`frontend/`) — Z3 WASM solver running client-side in a Web Worker, no backend needed, deployed to GitHub Pages

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
cd frontend && npx tsx test_multi_weapon_verification.ts   # Solver correctness against real weapons
cd frontend && npx tsx test_recoil_maximizer.ts            # Recoil optimization tests
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
UI Component → api/client.ts → Web Worker (solver.worker.ts) → Z3 WASM solver
                                     ↕
                              dataService.ts → Tarkov.dev GraphQL API (via fetch)
                                     ↕
                              IndexedDB (browser cache)
```

**Solver Pipeline (`frontend/src/solver/`):**
1. `dataService.ts` — Fetches guns/mods from Tarkov.dev GraphQL API, builds `ItemLookup`, caches in IndexedDB
2. `compatibilityMap.ts` — BFS traversal from weapon to discover all reachable mods and slot relationships
3. `z3Solver.ts` — Builds Z3 Boolean/Int/Real constraints directly (slot mutex, connectivity, conflicts, objective), calls `opt.check()`, decodes model back to items
4. `solver.ts` — Thin facade that delegates to `z3Solver.ts`
5. `solver.worker.ts` — Web Worker wrapper; handles `optimize`, `explore`, `getInfo`, `getWeaponMods`, `getGunsmithTasks` messages; uses `async-mutex` for serialized access
6. `paretoExplorer.ts` — Sweeps one stat axis to generate Pareto frontier points

**API Client (`api/client.ts`):** All `getInfo`, `optimize`, `explore` etc. functions communicate via `postMessage` to the Web Worker instead of HTTP — function signatures are kept identical so UI code doesn't care about the transport.

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

**Decision Variables:** Binary `x[item]` (selected), `base[preset]` (which base/preset selected)

**Constraints:** Slot capacity (max 1 per slot), connectivity (child item requires at least one parent selected), conflict exclusion (`conflictingItems` → mutual implication `x_A ⇒ ¬x_B`), base selection (exactly one naked gun or preset), availability (trader levels, flea market, player level), physical limits (price, ergo, recoil, mag capacity, sighting range, weight)

**Objective:** `maximize (ergo_weight * ergo) + (-100 * recoil_weight * recoil_mod) + (-0.01 * price_weight * price)`

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

## Common Pitfalls

- **Z3 WASM threading**: Z3 internal parallelism is disabled (`parallel.enable=false`) to avoid pthread crashes in browsers. The `z3-solver` package is excluded from Vite's `optimizeDeps` to prevent bundling issues.
- **COOP/COEP headers**: Vite dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` — required for Z3 WASM's SharedArrayBuffer support.
- **Z3 rational output**: Z3 returns rationals as S-expressions (e.g., `(/ 1 2)`, `(- (/ 3 4))`). The `parseZ3Num` helper in `z3Solver.ts` handles recursive parsing — don't use `parseFloat` directly on Z3 model output.
- **Solver concurrency**: Both the Z3 context (`z3Mutex`) and the worker (`workerMutex`) use `async-mutex` to serialize solve calls — Z3 WASM is not reentrant.
- **Recoil is a modifier, not absolute**: Z3 optimizes `totalRecoilMod` (a sum of percentage modifiers). Final recoil = `naked_recoil * (1 + totalRecoilMod)`. Constraints on `maxRecoilV` must be converted: `reqMod = (limit / baseV) - 1`.
- **Preset handling**: Items in presets have cost=0 to avoid double-counting purchase price. Base price comes from the preset variable selection.
- **Hardcoded colors**: Use antd theme tokens (`token.colorPrimary`, etc.) for dark/light mode compatibility.
- **Worker state**: The Web Worker caches data per `lang:gameMode` key — changing language/mode triggers a fresh data load.
- **`backend/` directory is empty/legacy** — actual backend logic is in root-level Python files, not in `backend/app/`.
