# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tarkov Weapon Mod Optimizer is a FastAPI + React application that uses **constraint programming** (Google OR-Tools CP-SAT solver) to find mathematically optimal weapon builds for Escape from Tarkov. The system models complex slot compatibility, item conflicts, and multi-objective optimization (ergonomics, recoil, price).

## Development Commands

### Installation

```bash
# Install all dependencies (backend + frontend)
npm run install:all

# Or manually:
pip install -r backend/requirements.txt
npm install --prefix frontend
```

### Running the Application

**Development (with backend hot-reload):**
```bash
npm run build:frontend && npm run dev:backend
# Access http://localhost:8000
# After frontend changes: npm run build:frontend (then refresh browser)
```

**Production Deployment:**
```bash
npm start
# or: npm run build && npm run serve
```

### Building & Linting

```bash
# Build frontend for production
npm run build:frontend
# Output: frontend/dist/

# Frontend linting (ESLint)
npm run lint --prefix frontend
```

### Testing

```bash
# Backend tests
python backend/test_service.py
```

Note: Frontend has no unit tests currently. Backend uses FastAPI's automatic OpenAPI validation.

## Architecture

**Backend**: FastAPI server (`backend/`)
- Constraint programming optimization engine (CP-SAT solver)
- GraphQL client for Tarkov.dev API
- Multi-level caching (GraphQL responses + processed data)
- Lazy loading of language/game-mode specific data

**Frontend**: React 19 + TypeScript (`frontend/`)
- Vite build tool, Tailwind CSS 4 styling
- Monolithic state management in App.tsx
- Interactive ternary plot for weight adjustment (barycentric coordinates)
- 16-language support via i18next

**Legacy**: Original Streamlit app (`legacy/`) - deprecated, not maintained

## Key Architectural Concepts

### Backend: Two-Phase Optimization

**Phase 1: BFS Compatibility Mapping** (`optimizer.py:414-462`)
- Breadth-first search from base weapon to discover all reachable mods
- Returns `compatibility_map` with:
  - `reachable_items`: All accessible mods
  - `slot_items`: Maps slot_id → list of compatible item_ids
  - `item_to_slots`: Maps item_id → slots it owns
  - `slot_owner`: Maps slot_id → parent item_id

**Phase 2: CP-SAT Constraint Solving** (`optimizer.py:560-1101`)

The CP-SAT solver models weapon modding as an integer linear program:

**Decision Variables:**
- `x[item_id]`: Binary (1 = item selected, 0 = not selected)
- `buy[item_id]`: Binary (1 = must purchase separately, 0 = included in preset)
- `placed_in[item_id][slot_id]`: For multi-slot items, which slot it occupies

**Constraints:**
1. **Slot System**: Each slot holds max 1 item, items only go in compatible slots
2. **Connectivity**: Items must be reachable through weapon's slot hierarchy (parent items required for child items)
3. **Conflicts**: Items with `conflictingItems` cannot be selected together
4. **Base Selection**: Exactly one base (naked gun or preset) required
5. **Availability**: Items filtered by trader levels, flea market, player level
6. **Physical Limits**: Price, ergonomics, recoil, magazine capacity, sighting range, weight

**Objective Function (Maximize):**
```
(ergo_weight × ergonomics_capped) + (-recoil_weight × recoil) + (-price_weight × price) - (parsimony_penalty × num_items)
```

Where:
- Scale factor: 1000× for decimal precision in CP-SAT
- Ergonomics: soft-capped at [0, 100]
- Recoil: negative weight (minimize)
- Price: negative weight (minimize)
- Parsimony penalty: 100 points per item (encourages simpler builds)

**Example Weight Profiles:**
```python
# Lowest recoil build
ergo_weight=0.001, recoil_weight=100.0

# Highest ergonomics build
ergo_weight=2.0, recoil_weight=0.5

# Budget build
max_price=500000, price_weight=0.5
```

**Stat Calculation:**
- **Ergonomics**: Additive (base + sum of mod bonuses), soft-capped at [0, 100]
- **Recoil**: Multiplicative (base × (1 + sum of mod modifiers))

**Critical Implementation Details:**
- Integer scaling (SCALE=1000) required for decimal coefficients in CP-SAT
- Preset items have cost=0 if preset is selected (prevents double-counting)
- Items >100M roubles only available through presets
- 30-second solver timeout for web requests
- Compatibility maps built via BFS traversal of slot hierarchy

**Pareto Frontier Exploration** (`explore_pareto`):
- Generates trade-off curves (e.g., Recoil vs Price while minimizing hidden dimension)
- Three modes: ignore="price", "recoil", or "ergo"
- Deduplicates overlapping solutions, filters to Pareto-optimal frontier

### Backend: Data Flow

```
POST /api/optimize
  ↓
get_state(lang, game_mode) → Load/cache data
  ↓
build_compatibility_map(weapon_id) → BFS slot traversal
  ↓
optimize_weapon() → Build CP-SAT model, solve
  ↓
OptimizeResponse (selected items, stats, status)
```

**Data Structures:**
- `item_lookup`: `item_id → {type, data, slots, stats, conflicting_items}`
- Stats normalized during extraction for API inconsistencies

**Caching Strategy:**
1. **GraphQL Response Cache**: 1-hour TTL, MD5-hashed query keys
2. **Processed Data Cache**: Serialized `item_lookup` (expensive to build)
3. **In-Memory Compatibility Maps**: Built on-demand per weapon session

**State Management:**
- Global `AppState.data` dict: `(lang, game_mode) -> {guns, mods, item_lookup, compat_maps}`
- English/regular mode loaded on startup, others lazy-loaded
- Cache version (CACHE_VERSION=7) invalidates on breaking changes
- Cache location: `.cache/` directory

### Frontend: Component Architecture

**Monolithic Design:**
- `App.tsx` (116KB): All business logic, state, API calls
- Hundreds of state variables managed via `useState`
- Helper render functions for different UI sections
- Consider refactoring to Context API or custom hooks if adding major features

**Key Components:**
- `TernaryPlot.tsx`: Interactive 3-axis weight adjustment using barycentric coordinates
- `ItemRow.tsx`: Reusable mod/equipment display with stats grid
- `ErrorFallback.tsx`: Error boundary fallback UI

**State Management:** React hooks (no Redux)

**State Persistence:**
- Theme (dark/light/system) → localStorage
- Compact mode toggle → localStorage
- Language preference → i18next localStorage

**Styling:** TailwindCSS 4 with `@tailwindcss/postcss`

**API Client** (`frontend/src/api/client.ts`):
- Axios instance with relative paths (same origin)
- 6 endpoints: getInfo, getWeaponMods, optimize, explore, getGunsmithTasks, getStatus

### Internationalization

**Supported Languages (16):**
en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk

**Setup:**
- i18next with HTTP backend loading from `frontend/public/locales/{{lng}}.json`
- Auto-detection: localStorage → navigator language → fallback 'en'
- Usage: `const { t } = useTranslation()` → `t('key', 'fallback')`

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/info` | List all weapons |
| GET | `/api/info/{weapon_id}/mods` | Get compatible mods |
| POST | `/api/optimize` | Run single optimization |
| POST | `/api/explore` | Explore Pareto frontier |
| GET | `/api/gunsmith/tasks` | Get gunsmith tasks |
| GET | `/api/status` | Last data update timestamp |

**Query params:** `lang` (16 languages), `game_mode` (`regular`|`pve`)

## Important File Locations

### Backend
- `backend/app/main.py`: FastAPI app, routes, state management, caching
- `backend/app/services/optimizer.py`: CP-SAT solver logic, Pareto frontier, data processing
- `backend/app/services/queries.py`: GraphQL queries for Tarkov.dev API
- `backend/app/models/schemas.py`: Pydantic request/response models
- `backend/requirements.txt`: Python dependencies

### Frontend
- `frontend/src/App.tsx`: Main application component (all UI logic)
- `frontend/src/api/client.ts`: API client with Axios
- `frontend/src/components/TernaryPlot.tsx`: Interactive weight visualization
- `frontend/src/i18n.ts`: i18next configuration
- `frontend/public/locales/`: Translation JSON files
- `frontend/package.json`: Node dependencies and scripts

### Configuration
- `package.json` (root): npm scripts for dev/build
- `pixi.toml`: Pixi configuration (outdated, references legacy app)
- `tasks.json`: Gunsmith task definitions (loaded by backend)

## Development Guidelines

### Backend Development

**Adding New Constraints:**
1. Add Pydantic field to `OptimizeRequest` in `schemas.py`
2. Update constraint building logic in `optimizer.py` (lines 600-980)
3. Add feasibility check if needed (lines 497-564)
4. Test with various weapons and edge cases

**Modifying Optimization Logic:**
- Solver configuration: lines 984-987 in `optimizer.py`
- Objective function: lines 962-981
- Be careful with integer scaling (SCALE constants)
- Test infeasible scenarios (no valid solution exists)

**Adding API Endpoints:**
1. Define Pydantic models in `schemas.py`
2. Add route in `main.py` with `@app.get/post` decorator
3. Use `get_state(lang, game_mode)` dependency for data access
4. Handle errors with HTTPException

**GraphQL Schema Changes:**
- Update queries in `queries.py` (GUNS_QUERY, MODS_QUERY)
- Increment `CACHE_VERSION` to invalidate old caches
- Update `build_item_lookup` processing logic

### Frontend Development

**Adding UI Features:**
- State in `App.tsx` (useState, useMemo for computed values)
- Extract helper render functions for clarity
- Use Tailwind CSS classes for styling
- Add i18n keys to `frontend/public/locales/en.json` (then translate)

**API Integration:**
- Add method to `client.ts` with proper TypeScript types
- Call from App.tsx with try-catch error handling
- Update loading/error states appropriately

**Styling Conventions:**
- Theme: zinc color palette, orange-500 accents
- Dark mode: zinc-950 backgrounds, zinc-200 text
- Icons: Lucide React library
- Responsive: mobile-first, `md:` breakpoint for desktop

**Adding Translations:**
1. Add key to `frontend/public/locales/en.json`
2. Copy to other language files (use same English value if not translated)
3. Use in component: `t('namespace.key', 'Fallback Text')`

## Common Pitfalls

### Backend
- **Forgetting integer scaling**: CP-SAT requires integer coefficients, use SCALE constants for decimals
- **Cache invalidation**: Bump `CACHE_VERSION` when changing data processing logic
- **Preset handling**: Items in presets have cost=0 to prevent double-counting
- **Conflict resolution**: Items conflicting with base weapon excluded during compatibility map building (line 446)

### Frontend
- **Missing translations**: Always add to all locale files or provide fallback
- **State bloat**: App.tsx is already large (116KB), consider refactoring before adding major features
- **Type safety**: Ensure API client types match backend Pydantic models
- **Environment variables**: Must be prefixed with `VITE_` to be exposed to frontend

## Performance Considerations

- **Backend**: CP-SAT typically solves in <1 second, 30-second timeout for safety
- **Frontend**: Memoization (`useMemo`) prevents unnecessary re-computations
- **Caching**: 1-hour TTL for Tarkov.dev API to avoid rate limiting
- **Lazy Loading**: Languages loaded on-demand, not all at startup

## Data Source

All weapon/mod data fetched from **Tarkov.dev GraphQL API** (https://api.tarkov.dev/graphql). Do not hardcode game data - always fetch from API to ensure accuracy.

**Game modes:** `regular`, `pve`
**Languages:** `en`, `ru`, `zh`, `es`, `de`, `fr`, `it`, `ja`, `ko`, `pl`, `pt`, `tr`, `cs`, `hu`, `ro`, `sk`
