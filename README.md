# Tarkov Weapon Mod Optimizer

[English](README.md) | [中文](README_ZH.md)

An advanced weapon build optimizer for Escape from Tarkov. This tool uses **constraint programming** (via Google OR-Tools CP-SAT solver) to find the mathematically optimal set of modifications for any weapon based on your priorities and constraints.

![Project Overview](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![React](https://img.shields.io/badge/React-19.2-61dafb.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

## Architecture

This project uses a modern **FastAPI + React/TypeScript** architecture:

- **Backend** (`backend/`): FastAPI server handling data fetching and optimization
- **Frontend** (`frontend/`): React 19 + TypeScript + Vite + TailwindCSS web UI
- **Legacy** (`legacy/`): Original Streamlit application (deprecated)

## Key Features

- **Optimal Build Finder**: Uses weighted objective function to balance **Ergonomics**, **Recoil**, and **Price**
- **Pareto Frontier Exploration**: Visualize trade-off curves between stats (Recoil vs Price, etc.)
- **Hard Constraints**: Set budget, minimum ergonomics, maximum recoil, magazine capacity, sighting range, weight
- **Smart Availability Filters**: Filter by PMC level, flea market access, trader loyalty levels (LL1-LL4)
- **Gunsmith Tasks**: Complete list of in-game gunsmith missions with optimized solutions
- **Multi-language Support**: 14 languages (English, Russian, Chinese, Spanish, German, French, etc.)
- **Exporting**: Save builds as JSON or Markdown for sharing

## Tech Stack

- **Backend**: FastAPI, Google OR-Tools (CP-SAT), Pydantic, Loguru
- **Frontend**: React 19, TypeScript, Vite, TailwindCSS 4, i18next, Recharts
- **Data Source**: Tarkov.dev GraphQL API

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- npm or pip

### Installation

**Using npm (recommended):**
```bash
npm run install:all
```

**Manual installation:**

Backend:
```bash
pip install -r backend/requirements.txt
```

Frontend:
```bash
npm install --prefix frontend
```

### Running the Application

1. **Start the Backend:**
   ```bash
   npm run dev:backend
   ```
   API available at `http://localhost:8000`

2. **Start the Frontend:**
   ```bash
   npm run dev:frontend
   ```
   Web UI available at `http://localhost:5173`

### Alternative: Pixi

If you have [pixi](https://pixi.sh/) installed:
```bash
pixi run dev:backend  # Start backend
pixi run dev:frontend # Start frontend (separate terminal)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/info` | GET | List all available weapons |
| `/api/info/{weapon_id}/mods` | GET | Get compatible mods for a weapon |
| `/api/optimize` | POST | Run single optimization |
| `/api/explore` | POST | Explore Pareto frontier |
| `/api/gunsmith/tasks` | GET | Get all gunsmith tasks |

## Project Structure

```
tarkov-weapon-optimizer/
├── backend/
│   ├── app/
│   │   ├── api/          # API routes
│   │   ├── core/         # Core utilities
│   │   ├── models/       # Pydantic schemas
│   │   ├── services/     # Optimizer and data services
│   │   └── main.py       # FastAPI application
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── i18n/         # Internationalization
│   │   ├── pages/        # Page components
│   │   ├── services/     # API client
│   │   └── types/        # TypeScript types
│   └── package.json
├── legacy/               # Original Streamlit app (deprecated)
├── tasks.json            # Gunsmith task definitions
└── package.json          # Root scripts
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is for educational and personal use. All data is provided by [Tarkov.dev](https://tarkov.dev/).
