# Tarkov Weapon Mod Optimizer (web version)

[English](README.md) | [中文](README_ZH.md) | [Español](README_ES.md)

A client-side weapon build optimizer for Escape from Tarkov. It runs entirely in your browser, using WebAssembly and the HiGHS solver to find the mathematically optimal set of modifications for a weapon given your priorities and constraints.

There is no backend. Everything, including the heavy optimization math, runs locally via WASM.

![Project Overview](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-19%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-6%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## Features

### Mathematical Optimization Engine
- **Multi-Objective Solver**: Balances ergonomics, vertical recoil, and price using [HiGHS](https://highs.dev/) (a high-performance mixed-integer linear programming solver compiled to WebAssembly) running inside dedicated Web Workers.
- **Sweet Spot Mode (Augmented Tchebycheff Scalarization)**: Solves for balanced, non-convex Pareto configurations relative to the weapon's 3D Ideal Point ($z^*_E, z^*_R, z^*_P$). Discovers optimal sweet-spot builds located in non-convex trade-off indentations that linear weighted sums mathematically skip.
- **EvoErgo (Weight-Adjusted Ergonomics) Mode**: Optimizes weight-adjusted ergonomics and true quadratic EvoErgoDelta ($\text{EED} = (100 - 0.015 \cdot (100 - E)^2) - 15 \cdot W$) via a tangent $k$-sweep solver, matching real in-game ADS speed and overswing physics.
- **Conflict Resolution & Feasibility**: Resolves complex weapon slot trees, mutual exclusions, parent requirements, and nested multi-slot dependencies using LP relaxation, perturbation, and greedy integer rounding.

### Hard Constraints & Modding Controls
- **Prevent Overswing Constraint**: Enforces $W \le \text{Threshold}(E_{\text{eff}}) \iff \text{EED} \ge 0$ via exact tangent cutting planes, guaranteeing zero sight overswing when snapping to ADS.
- **Equipment Ergo Penalty ($b$) Input**: Configures a $-40\%$ to $0\%$ penalty to model the impact of equipped body armor, helmets, and backpacks on effective ergonomics.
- **Stat Bounds**: Set hard limits on maximum vertical recoil, minimum ergonomics, maximum weight (kg), and budget (₽).
- **Weapon Ballistics & MOA Limits**: Set maximum dispersion (MOA) using exact in-game BSG formulas ($K \approx 34.3$) and barrel replacement rules.
- **Functional Requirements**: Enforce minimum magazine capacity, minimum sighting range, and specific caliber configurations.
- **Trader & Market Filters**: Filter parts by PMC level, trader loyalty levels (LL1–LL4), and toggle Flea Market availability.
- **Preset Retention & Part Locking**: Retain base preset components with one click, lock preferred mods (e.g. favorite optic or muzzle device), or blacklist unwanted parts.

### Analysis, Exploration & Usability
- **AUGMECON2 Accelerated 2D Pareto Exploration**: Fast Augmented $\epsilon$-Constraint exploration with slack bypass across Ergo vs. Recoil, Ergo vs. Price, and Recoil vs. Price curves.
- **Live EED & EvoErgo Metrics**: Color-coded stat cards (+green / -red) providing instant feedback on overswing and weight efficiency.
- **Interactive Guide & Methodology Modal**: Built-in mathematical reference with KaTeX rendering for Tarkov weapon mechanics, recoil formulas, and optimization algorithms.
- **100% Client-Side & Offline Ready**: Zero server latency or tracking; all calculations execute locally in the browser.
- **16 Languages Supported**: cs, de, en, es, fr, hu, it, ja, ko, pl, pt, ro, ru, sk, tr, zh.

## Tech stack

- **Frontend**: [React](https://react.dev/) 19, [Vite](https://vitejs.dev/) 6, [TypeScript](https://www.typescriptlang.org/)
- **UI & Visualization**: [Ant Design](https://ant.design/) v6, [Recharts](https://recharts.org/), [KaTeX](https://katex.org/)
- **Optimization Solver**: [HiGHS](https://highs.dev/) via WebAssembly (MILP / LP Relaxation / Augmented Tchebycheff / AUGMECON2 / Cutting Planes)
- **Data Source**: [Tarkov.dev JSON API](https://json.tarkov.dev/endpoints)
## Installation

You need [Node.js](https://nodejs.org/) v18 or higher and [npm](https://www.npmjs.com/), which usually ships with it.

1. Clone the repository:
   ```bash
   git clone https://github.com/AhaiMk01/tarkov-weapon-optimizer.git
   cd tarkov-weapon-optimizer
   ```

2. Move into the frontend directory:
   ```bash
   cd frontend
   ```

3. Install dependencies:
   ```bash
   npm install
   ```
   This also verifies that the `highs` WASM package installed correctly.

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open `http://localhost:5173`, or whichever URL the terminal prints.

## Deploy with Docker (self-hosting)

Every release tag publishes pre-built multi-arch images (`linux/amd64`, `linux/arm64`) to the GitHub Container Registry, so they run on home servers, VPSes, and Raspberry Pi.

The container is just a static web server (`nginx:alpine`, roughly 30 MB). All optimization happens client-side in the visitor's browser via WASM, so you do not need a backend, a database, or any environment variables.

### Quick start (pre-built image)

```bash
docker run -d \
  --name tarkov-optimizer \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
```

Then open `http://<your-host>:8080`.

You can change `8080` to any host port; the container always listens on `80` internally. To pin a version, replace `:latest` with something like `:2.4.2`.

### Build from source

If you would rather build the image yourself, for example from a fork:

```bash
cd frontend
docker build -t tarkov-optimizer .
docker run --rm -d -p 8080:80 --name tarkov-optimizer tarkov-optimizer
```

### Behind a reverse proxy

The app is a single-page application with an SPA fallback, so a deep-linked URL such as `/explore` returns `index.html`. Proxy the container's port the way you would any static site. It does not use WebSockets and does not need sticky sessions.

### Stop or update

```bash
docker stop tarkov-optimizer && docker rm tarkov-optimizer
docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
# then re-run the "Quick Start" command
```

## Verification

The repository includes a verification script that runs the WASM solver against real weapons:

```bash
npx tsx test_multi_weapon_verification.ts
```

It optimizes complex builds such as the AK-74 and M4A1, and checks that the result is a valid, integer-optimal loadout rather than a crash.

## Contributing

Pull requests are welcome.

## License

This project is for educational and personal use. All data comes from [Tarkov.dev](https://tarkov.dev/).
