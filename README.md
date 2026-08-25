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

### Smart Optimization Modes
- **Balanced "Sweet Spot" Mode**: Finds well-rounded, balanced builds (great ergonomics, low recoil, reasonable price) without over-investing in diminishing returns.
- **EvoErgo (Weight-Adjusted Ergonomics)**: Optimizes ergonomics while accounting for weapon weight, maximizing real in-game aiming speed and weapon handling.
- **Priority Sliders**: Customize weights to prioritize ergonomics, vertical recoil reduction, or budget to fit your playstyle.

### Real Combat Constraints & Modding Controls
- **Prevent Sight Overswing**: Ensures your weapon's weight stays within the threshold for its ergonomics, stopping weapon sway and overswing when snapping to aim (ADS).
- **Body Armor & Gear Penalty**: Set your armor/helmet/backpack ergo penalty (-40% to 0%) so the build stays overswing-free with full gear on.
- **Hard Stat Limits**: Set strict limits for maximum recoil, minimum ergonomics, maximum weight, budget (₽), and maximum dispersion (MOA).
- **Functional Requirements**: Specify minimum magazine capacity, minimum sighting range, and caliber options.
- **Trader & Flea Filters**: Filter parts by your PMC level and trader loyalty levels (LL1–LL4), or exclude Flea Market prices.
- **Keep Preset Parts & Lock Favorites**: Keep your weapon's stock parts with one click, lock preferred attachments (like favorite optics or suppressors), or ban unwanted parts.

### Exploration & Built-in Guide
- **2D Tradeoff Exploration Curve**: Explore smooth trade-off charts (Ergonomics vs. Recoil, Ergonomics vs. Price, Recoil vs. Price) to see what every point of ergo or recoil costs.
- **Compare Weapons on One Chart**: Add extra guns from the same Select Weapon control; their Pareto curves overlay under the same trader and budget rules. Export any point to EFTForge.
- **Instant Stat Indicators**: Color-coded cards show real-time weapon stats, weight efficiency, and overswing status.
- **Built-in Weapon Guide**: In-app guide explaining Tarkov weapon stats, ballistics, overswing mechanics, and optimizer features.
- **100% Client-Side & Private**: Runs entirely in your browser with zero server delay—no account, login, or backend required.
- **16 Languages Supported**: English, Русский, 中文, Español, Deutsch, Français, and 10 more.
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
