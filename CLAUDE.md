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
cd frontend && npm run test:unit           # tests/**/*.test.ts (node:test): physical model, native build, runtime, UI helpers, pinned-capture tests
cd frontend && npm run test:reference      # independent reference: exact-rational oracle, ledger, differential harness + ratchet (frontend/reference/README.md)
cd frontend && for c in app node reference tests benchmarks; do npx tsc --noEmit -p tsconfig.$c.json; done   # root tsconfig.json has files: []
```

Pinned-capture tests skip unless `frontend/benchmarks/snapshot.json` (SHA-256 `219443b4...`, ADR 0013 section 1) is restored from its hashed artifact; it is never regenerated. `reference/harness/baseline.json` is a ratchet: a passing case must keep passing. Every test and benchmark solves through the pinned native loader (`src/solver/native/`); the npm `highs` package is not a dependency.

`frontend/reference/` is the independent oracle used to verify the solver (ADR 0010/0013). It must never import production code (enforced by `reference/independence.test.ts`; only `*.differential.test.ts` may, as the system under test). Its pinned raw JSON API documents under `reference/source/raw/` are gitignored; only `raw/manifest.json` is committed.

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
                              dataService.ts → tarkov.dev JSON API (via fetch)
                                     ↕
                              IndexedDB (browser cache)
```

**Solver Pipeline (`frontend/src/solver/`):**
1. `dataService.ts` — Fetches guns/mods from tarkov.dev (JSON API via `jsonApiAdapter.ts`, GraphQL as fallback), builds `ItemLookup`, caches in IndexedDB
2. `compatibilityMap.ts` — BFS traversal from weapon to discover all reachable mods and slot relationships
3. `physical/` — the model (ADR 0013): `preparePhysicalWeapon` builds the per-gun blueprint (templates, slots, occurrences), `prepareSubproblemDomain` applies the request (acquisition, filters, stash) as immutable masks, then one of two count models over candidate slot edges is written as LP text and solved on the pinned build:
   - **Precise** (`solvePrecise.ts`, `specializeCount.ts`): every row through the proof layer, presolve off, a second solve with another seed before any certificate (a third seed on disagreement); answers are certified (`certified_optimal` / `certified_infeasible`).
   - **Fast** (`solveFast.ts`, `specializeFast.ts`): the same domain in plain doubles, one copy per part unless `allowRepeatedParts`; always `approximate`.
   - TrueErgo / Prevent Overswing run a spatial search over total weight (secant bounds of the weight penalty) on whichever model runs; neither upgrades Fast to Precise.
   - Nothing is published unless the exact validator (`physical/validate.ts`) accepts the build; statuses and reasons come from `physical/outcome.ts`.
   - Precondition: the part graph reachable from the receiver is acyclic; a cyclic gun is refused in every mode as unsupported data.
4. `precisionMode.ts` — Auto: Precise for every plain request; for TrueErgo / Prevent Overswing, Precise up to 3,000 candidate edges (`AUTO_PRECISE_MAX_TED_EDGES`), Fast above.
5. `solver.ts` — `solve` / `computeIdealPoint`: runs Precise or Fast and assembles the `OptimizeResponse` (instances, placements, provenance, exact stats, the Tchebycheff payoff table). `trueErgo.ts` holds the shared TED formulas.
6. `solver.worker.ts` → `workerRuntime.ts` — request guards (epoch deadline, out-of-band cancel), stash validation, caches; Explore (`paretoExplorer.ts` schedule + `exploreSweep.ts` classification) and the MOA floor (`moaFloor.ts`)

**API Client (`api/client.ts`):** All `getInfo`, `optimize`, `explore`, etc. communicate via `postMessage` to the Web Worker — not HTTP. Signatures stay stable so UI code does not depend on transport.

**HiGHS WASM assets:** a pinned, reproducible HiGHS 1.15.1 build (`frontend/vendor/highs/README.md`); `public/highs.js` and `highs.wasm` are served from the site origin (`setHighsBaseUrl`) and SHA-checked by `src/solver/native/loadHighs.ts` against the committed manifest. There is no stock fallback.

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

**Constraints:** Slot capacity, connectivity (child requires a selected parent along the slot graph), conflict exclusion, exactly one accessible naked gun or preset base (never a free receiver), availability (trader levels, flea market, player level, barters), preset and owned supply, and limits on price, ergonomics, vertical recoil, recoil sum, mag capacity, sighting range, weight, MOA.

**Objective:** Weighted combination (or augmented Tchebycheff) of ergonomics or TED, recoil modifier contribution, and price. The web model (`frontend/src/solver/physical/`) is the reference; the Python CP-SAT model is not kept in parity.

## Data Source

All weapon/mod data comes from **tarkov.dev**, via the **JSON API** (`https://json.tarkov.dev`).
- Game modes: `regular`, `pve`
- Languages: en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk

**The GraphQL API (`https://api.tarkov.dev/graphql`) is down** — it has returned
`422 {"errors":["GraphQL server unavailable. Try again later."]}` for every request since
2026-07-21 (upstream issue [the-hideout/tarkov-api#474](https://github.com/the-hideout/tarkov-api/issues/474),
still open with no ETA). tarkov.dev's own site does not use GraphQL either; it reads the JSON API
(see their `src/modules/api-request.mjs`).

`frontend/src/solver/jsonApiAdapter.ts` reshapes JSON API documents into the exact shape the old
GraphQL queries returned, so every extractor in `dataService.ts` is unchanged. `fetchAllData` tries
the JSON API first and falls back to GraphQL. Things the adapter has to reconcile:
- Names/short names/slot names/category names are **translation keys**; real strings live in a
  sibling `<path>_<lang>` document (resolution order: requested lang → English → the key).
- `buyFor` does not exist — trader offers come from `buyFromTrader`, and the flea offer is
  synthesized the same way tarkov-api's items datasource does (skipped for `noFlea` items or when
  `lastLowPrice` is absent; priced `avg24hPrice || lastLowPrice`; `source: 'fleaMarket'`).
- `bartersFor` does not exist — barters are a separate document, indexed by the item they offer;
  GraphQL's `level` is `minTraderLevel`.
- `bsgCategory` does not exist — `categories[0]` is the item's own category and the array is
  exactly its parent chain. `handbookCategories` are IDs into a sibling document.
- Presets, `defaultPreset`, `containsItems[].item` and `conflictingItems[]` are **IDs**, and get
  dereferenced/rewrapped into the objects the extractors expect.
- GraphQL's `imageLink` is a deprecated alias for `inspectImageLink` (not `gridImageLink`).

**The Python/Streamlit app still queries GraphQL and is therefore non-functional** until either
the upstream API returns or `queries.py` gets the same treatment.

## CI/CD

- `.github/workflows/deploy.yml` — GitHub Pages. The `build` job runs on every PR to `master` (the only PR check: `npm ci` + `npm run build`, which includes `tsc`); the `deploy` job runs only on push to `master`, or a manual dispatch on `master`. (The `frontend-only-ghpages` branch is abandoned; deploys moved to `master` in 09cdbd9.)
- `.github/workflows/docker.yml` — **runs on every `v*` tag push**: builds the multi-arch frontend image and publishes it to `ghcr.io/<owner>/tarkov-optimizer-frontend` (semver + `sha-` tags). So step 8 of the release checklist publishes an image. A manual dispatch from a branch publishes `<branch>` and `sha-` tags only.
- `.github/workflows/build.yml` — PyInstaller executables + GitHub Release. **Manual dispatch only**: its `v*` tag trigger is commented out while executable builds are paused, and its actions are still on the pre-Node-24 versions.
- `.github/dependabot.yml` — monthly PRs for GitHub Actions versions.

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

## Pre-Commit Checklist

- Run `npm run build --prefix frontend` (`tsc -b` over every tsconfig, including tests, reference and benchmarks) and fix all TypeScript errors before committing.
- Sync i18n: ensure all locale files in `frontend/public/locales/` have the same keys as `zh.json`. Fill missing keys with English fallbacks.

## Common Pitfalls

- **HiGHS failures**: a native failure is a typed `SolverError`, never a result; `discardNativeHighs()` drops the shared instance so the next call re-instantiates. HiGHS presolve has produced false answers (`tests/physical/solverDefects/`), so physical solves run with presolve off.
- **Recoil is a modifier, not absolute**: The model optimizes summed **recoil modifiers**; displayed vertical/horizontal recoil are `naked_recoil * (1 + totalRecoilMod)`. Hard caps on final vertical recoil must be converted when building constraints.
- **Preset handling**: Preset counts are explicit (`{itemId, count}`, no default of 1); preset-supplied and owned copies cost nothing extra, and provenance is per occurrence.
- **Model changes**: run `npm run test:reference`; the differential harness compares production with the independent oracle on every ledger case.
- **Hardcoded colors**: Use antd theme tokens (`token.colorPrimary`, etc.) for dark/light mode compatibility.
- **Worker state**: The Web Worker caches data per `lang:gameMode` key — changing language/mode triggers a fresh data load.
- **`backend/` directory is empty/legacy** — actual backend logic is in root-level Python files, not in `backend/app/`.

## Agent skills

### Issue tracker

GitHub Issues on `AhaiMk01/tarkov-weapon-optimizer`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
