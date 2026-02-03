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
uv sync
npm install --prefix frontend
```

### Running the Application

**Development (with backend hot-reload):**
```bash
npm run build:frontend && npm run dev:backend
# Access http://localhost:15000
# After frontend changes: npm run build:frontend (then refresh browser)
```

**Production Deployment:**
```bash
# Start Redis first
docker compose up -d

# Start backend with systemd
sudo systemctl start tarkov-optimizer

# Or manually
npm start
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
uv run python backend/test_service.py
```

## Architecture

**Backend**: FastAPI server (`backend/`)
- Constraint programming optimization engine (CP-SAT solver)
- GraphQL client for Tarkov.dev API
- Pydantic Settings for configuration (`config.py`)
- Redis caching with memory fallback (`state.py`)
- Modular API routes (`api/` directory)

**Frontend**: React 19 + TypeScript (`frontend/`)
- Vite build tool
- Ant Design 5 component library with theme switching (light/dark/auto)
- Interactive ternary plot for weight adjustment (barycentric coordinates)
- 16-language support via i18next

**Package Management**:
- Backend: uv + pyproject.toml
- Frontend: npm + package.json

## Key Architectural Concepts

### Backend: Modular Structure

```
backend/app/
├── main.py          # FastAPI app lifecycle, static files
├── config.py        # Pydantic Settings (env-based config)
├── state.py         # State management, Redis caching
├── api/
│   ├── __init__.py  # Router registration
│   ├── info.py      # GET /api/info, /api/info/{id}/mods
│   ├── optimize.py  # POST /api/optimize
│   ├── explore.py   # POST /api/explore
│   ├── gunsmith.py  # GET /api/gunsmith/tasks
│   └── status.py    # GET /api/status
├── models/
│   └── schemas.py   # Pydantic request/response models
└── services/
    └── optimizer.py # CP-SAT solver, data processing
```

### Backend: Two-Phase Optimization

**Phase 1: BFS Compatibility Mapping** (`optimizer.py`)
- Breadth-first search from base weapon to discover all reachable mods
- Returns `compatibility_map` with:
  - `reachable_items`: All accessible mods
  - `slot_items`: Maps slot_id → list of compatible item_ids
  - `item_to_slots`: Maps item_id → slots it owns
  - `slot_owner`: Maps slot_id → parent item_id

**Phase 2: CP-SAT Constraint Solving** (`optimizer.py`)

The CP-SAT solver models weapon modding as an integer linear program:

**Decision Variables:**
- `x[item_id]`: Binary (1 = item selected, 0 = not selected)
- `buy[item_id]`: Binary (1 = must purchase separately, 0 = included in preset)
- `placed_in[item_id][slot_id]`: For multi-slot items, which slot it occupies

**Constraints:**
1. **Slot System**: Each slot holds max 1 item, items only go in compatible slots
2. **Connectivity**: Items must be reachable through weapon's slot hierarchy
3. **Conflicts**: Items with `conflictingItems` cannot be selected together
4. **Base Selection**: Exactly one base (naked gun or preset) required
5. **Availability**: Items filtered by trader levels, flea market, player level
6. **Physical Limits**: Price, ergonomics, recoil, magazine capacity, sighting range, weight

**Objective Function (Maximize):**
```
(ergo_weight × ergonomics_capped) + (-recoil_weight × recoil) + (-price_weight × price) - (parsimony_penalty × num_items)
```

### Backend: Configuration

Environment-based configuration via Pydantic Settings (`config.py`):

```bash
# .env file
API_HOST=0.0.0.0
API_PORT=15000
CORS_ORIGINS=*
CACHE_DIR=.cache
CACHE_TTL=3600
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=
LOG_LEVEL=INFO
```

### Backend: Caching Strategy

1. **Redis Cache** (primary): TTL-based caching for API responses
2. **Memory Fallback**: Automatic fallback when Redis unavailable
3. **File Cache**: `.cache/` directory for GraphQL responses
4. **In-Memory Maps**: Compatibility maps built on-demand per weapon

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
OptimizeResponse (selected items, stats, status, solve_time_ms)
```

### Frontend: Component Architecture

**Ant Design Based:**
- `App.tsx`: Main layout with ConfigProvider for theming
- Uses antd components: Layout, Card, Select, Slider, Table, Tag, etc.
- Theme switching: light/dark/auto with localStorage persistence

**Key Components:**
- `TernaryPlot.tsx`: Interactive 3-axis weight adjustment using barycentric coordinates
- `ItemRow.tsx`: Reusable mod/equipment display with stats grid
- `ErrorFallback.tsx`: Error boundary fallback UI

**State Management:** React hooks (no Redux)

**State Persistence:**
- Theme (dark/light/system) → localStorage
- Compact mode toggle → localStorage
- Language preference → i18next localStorage

**API Client** (`frontend/src/api/client.ts`):
- Axios instance with relative paths (same origin)
- Endpoints: getInfo, getWeaponMods, optimize, explore, getGunsmithTasks, getStatus

### Internationalization

**Supported Languages (16):**
en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk

**Setup:**
- i18next for business text (sidebar, results, etc.)
- antd ConfigProvider for component locales (DatePicker, Pagination, etc.)

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
- `backend/app/main.py`: FastAPI app lifecycle, static files
- `backend/app/config.py`: Pydantic Settings configuration
- `backend/app/state.py`: State management, Redis caching
- `backend/app/api/`: Modular API routes (5 files)
- `backend/app/services/optimizer.py`: CP-SAT solver logic, data processing
- `backend/app/models/schemas.py`: Pydantic request/response models

### Frontend
- `frontend/src/App.tsx`: Main application component (antd layout)
- `frontend/src/api/client.ts`: API client with Axios
- `frontend/src/components/TernaryPlot.tsx`: Interactive weight visualization
- `frontend/src/components/ItemRow.tsx`: Mod/item display component
- `frontend/src/i18n.ts`: i18next configuration
- `frontend/public/locales/`: Translation JSON files

### Configuration
- `pyproject.toml` (root): uv package configuration
- `package.json` (root): npm scripts for dev/build
- `.env.example`: Environment variable template
- `docker-compose.yml`: Redis service configuration
- `deploy/`: Deployment scripts and systemd service

## Deployment

### systemd Service

```bash
# Install and enable
sudo cp deploy/tarkov-optimizer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tarkov-optimizer
sudo systemctl start tarkov-optimizer

# Check status
sudo systemctl status tarkov-optimizer
```

### Redis (via Docker Compose)

```bash
# Start Redis
docker compose up -d

# Check status
docker compose ps
```

### Deploy Scripts

```bash
# Full deployment
./deploy/deploy.sh install

# Start/stop/restart
./deploy/start.sh
./deploy/stop.sh
./deploy/deploy.sh restart
```

## Development Guidelines

### Backend Development

**Adding New Constraints:**
1. Add Pydantic field to `OptimizeRequest` in `schemas.py`
2. Update constraint building logic in `optimizer.py`
3. Add feasibility check if needed
4. Test with various weapons and edge cases

**Adding API Endpoints:**
1. Create new file in `api/` directory
2. Define router with `APIRouter()`
3. Import and include router in `api/__init__.py`
4. Use `get_state(lang, game_mode)` for data access

**Configuration Changes:**
1. Add field to `Settings` class in `config.py`
2. Add default value to `.env.example`
3. Access via `get_settings()` function

### Frontend Development

**Adding UI Features:**
- Use antd components for consistency
- Access theme tokens via `const { token } = theme.useToken()`
- Add i18n keys to `frontend/public/locales/zh.json` and sync to all locales

**Styling:**
- Use antd theme tokens (token.colorPrimary, token.colorBgContainer, etc.)
- Avoid hardcoded colors for theme compatibility
- Inline styles with token references for dynamic theming

**Adding Translations:**
1. Add key to `frontend/public/locales/zh.json` (source of truth)
2. Synchronize to all 16 language files
3. Use in component: `t('namespace.key', '中文回退文本')`

**Translation Files:**
- `zh.json` is the reference file (~100 keys)
- All 16 files share identical structure
- Languages: en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk

## Common Pitfalls

### Backend
- **Forgetting integer scaling**: CP-SAT requires integer coefficients
- **Cache invalidation**: Bump `CACHE_VERSION` when changing data processing
- **Preset handling**: Items in presets have cost=0 to prevent double-counting
- **Redis unavailable**: Code must handle fallback to memory cache

### Frontend
- **Hardcoded colors**: Use antd theme tokens for dark/light mode compatibility
- **Missing translations**: Add to zh.json first, then sync to all 16 locale files
- **Type safety**: Ensure API client types match backend Pydantic models
- **Environment variables**: Must be prefixed with `VITE_`

## Performance Considerations

- **Backend**: CP-SAT typically solves in <1 second, 30-second timeout for safety
- **Frontend**: Memoization (`useMemo`) prevents unnecessary re-computations
- **Caching**: Redis for fast API response caching
- **Lazy Loading**: Languages loaded on-demand

## Data Source

All weapon/mod data fetched from **Tarkov.dev GraphQL API** (https://api.tarkov.dev/graphql).

**Game modes:** `regular`, `pve`
**Languages:** `en`, `ru`, `zh`, `es`, `de`, `fr`, `it`, `ja`, `ko`, `pl`, `pt`, `tr`, `cs`, `hu`, `ro`, `sk`
