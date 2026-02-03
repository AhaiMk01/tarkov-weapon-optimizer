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
- **Frontend** (`frontend/`): React 19 + TypeScript + Vite + Ant Design 5 web UI

## Key Features

- **Optimal Build Finder**: Uses weighted objective function to balance **Ergonomics**, **Recoil**, and **Price**
- **Pareto Frontier Exploration**: Visualize trade-off curves between stats (Recoil vs Price, etc.)
- **Hard Constraints**: Set budget, minimum ergonomics, maximum recoil, magazine capacity, sighting range, weight
- **Smart Availability Filters**: Filter by PMC level, flea market access, trader loyalty levels (LL1-LL4)
- **Gunsmith Tasks**: Complete list of in-game gunsmith missions with optimized solutions
- **Multi-language Support**: 16 languages (English, Russian, Chinese, Spanish, German, French, Italian, Japanese, Korean, Polish, Portuguese, Turkish, Czech, Hungarian, Romanian, Slovak)
- **Exporting**: Save builds as JSON or Markdown for sharing

## Tech Stack

- **Backend**: FastAPI, Google OR-Tools (CP-SAT), Pydantic, Loguru
- **Frontend**: React 19, TypeScript, Vite, Ant Design 5, i18next, Recharts
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

**Development (recommended):**
```bash
npm run build:frontend && npm run dev:backend
```
Access at `http://localhost:15000`

After frontend changes, run `npm run build:frontend` and refresh the browser.

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
│   │   ├── api/          # API routes (info, optimize, explore, gunsmith, status)
│   │   ├── models/       # Pydantic schemas
│   │   ├── services/     # CP-SAT optimizer
│   │   ├── config.py     # Pydantic Settings
│   │   ├── state.py      # State management, Redis caching
│   │   └── main.py       # FastAPI application
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/   # React components (common, explore, gunsmith, optimize)
│   │   ├── layouts/      # Layout components
│   │   ├── api/          # API client
│   │   └── App.tsx       # Main application
│   ├── public/locales/   # 16 language translation files
│   └── package.json
├── deploy/               # Deployment scripts and systemd service
└── package.json          # Root scripts
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is for educational and personal use. All data is provided by [Tarkov.dev](https://tarkov.dev/).
