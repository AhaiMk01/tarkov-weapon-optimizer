# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A weapon modification optimizer for Escape from Tarkov using constraint programming (Google OR-Tools CP-SAT) to find optimal mod configurations. Fetches weapon/mod data from Tarkov.dev GraphQL API.

## Development Commands

### Running the Application

**Backend (FastAPI on port 8000):**
```bash
npm run dev:backend
# or: python -m uvicorn backend.app.main:app --reload
```

**Frontend (Vite on port 5173):**
```bash
npm run dev:frontend
# or: npm run dev --prefix frontend
```

**Install all dependencies:**
```bash
npm run install:all
```

### Frontend Commands
```bash
npm run build        # TypeScript check + Vite build
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Testing
```bash
python backend/test_service.py  # Run backend tests
```

## Architecture

### Backend (FastAPI + OR-Tools)

**Entry point:** `backend/app/main.py`

**Key modules:**
- `services/optimizer.py` - Core optimization logic with two-phase approach
- `services/queries.py` - GraphQL queries for Tarkov.dev API
- `models/schemas.py` - Pydantic request/response models

**Two-Phase Optimization:**

1. **BFS Compatibility Mapping** (`optimizer.py:414-462`)
   - Breadth-first search from base weapon to discover all reachable mods
   - Returns `compatibility_map` with:
     - `reachable_items`: All accessible mods
     - `slot_items`: Maps slot_id → list of compatible item_ids
     - `item_to_slots`: Maps item_id → slots it owns
     - `slot_owner`: Maps slot_id → parent item_id

2. **CP-SAT Constraint Solving** (`optimizer.py:560-1101`)
   - Creates boolean variables for each reachable mod
   - Constraints: mutex, dependency, conflicts, required slots, vital slots
   - Objective function: weighted ergo/recoil/price scoring

**Data Structures:**
- `item_lookup`: `item_id → {type, data, slots, stats, conflicting_items}`
- Stats normalized during extraction for API inconsistencies

**Stat Calculation:**
- Ergonomics: additive (base + sum of mod bonuses), soft-capped at [0, 100]
- Recoil: multiplicative (base × (1 + sum of mod modifiers))

**Caching:**
- File-based cache in `.cache/` directory
- 1 hour TTL, versioned (CACHE_VERSION=7)
- Supports language (`lang`) and game mode (`regular`/`pve`) caching

### Frontend (React 19 + TypeScript + Vite)

**Structure:**
- `src/api/client.ts` - Axios API client with TypeScript interfaces
- `src/i18n.ts` - i18next configuration with 16 language support
- `src/App.tsx` - Main application component
- `src/components/` - Reusable components

**State Management:** React hooks (no Redux)

**Styling:** TailwindCSS 4 with `@tailwindcss/postcss`

**i18n:** i18next-http-backend loads translations from `/locales/{{lng}}.json`

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/info` | List all weapons |
| GET | `/api/info/{weapon_id}/mods` | Get compatible mods |
| POST | `/api/optimize` | Run single optimization |
| POST | `/api/explore` | Explore Pareto frontier |
| GET | `/api/gunsmith/tasks` | Get gunsmith tasks |

**Query params:** `lang` (14+ languages), `game_mode` (`regular`|`pve`)

## API Integration

**Endpoint:** `https://api.tarkov.dev/graphql`

**Key queries** (`queries.py`):
- `GUNS_QUERY`: Fetches all guns with slots, presets, base stats
- `MODS_QUERY`: Fetches all mods with slots, properties, prices

**Game modes:** `regular`, `pve`
**Languages:** `en`, `ru`, `zh`, `es`, `de`, `fr`, `it`, `ja`, `ko`, `pl`, `pt`, `tr`, `cs`, `hu`, `ro`, `sk`

## Optimization Weights

**Objective function** (`optimizer.py:956-974`):
- Scale factor: 1000× for decimal precision
- Ergo: capped at 100 (soft cap), weighted by `ergo_weight`
- Recoil: negative weight by `recoil_weight` (minimize)
- Price: negative weight by `price_weight` (minimize)
- Parsimony penalty: 100 points per item

**Example profiles:**
- Lowest recoil: `ergo_weight=0.001, recoil_weight=100.0`
- Highest ergonomics: `ergo_weight=2.0, recoil_weight=0.5`
- Budget build: Add `max_price` constraint + `price_weight=0.5`
