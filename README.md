# Tarkov Weapon Mod Optimizer (Web Version) 🔫

[English](README.md) | [中文](README_ZH.md)

An advanced, **client-side** weapon build optimizer for Escape from Tarkov. This tool runs entirely in your browser using **WebAssembly (WASM)** and the **HiGHS Solver** to find the mathematically optimal set of modifications for any weapon based on your priorities and constraints.

> **Zero Backend Required**: All logic, including the heavy optimization math, runs locally on your machine via WASM.

![Project Overview](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![React](https://img.shields.io/badge/React-18%2B-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue.svg)
![Vite](https://img.shields.io/badge/Vite-5.0%2B-purple.svg)
![WASM](https://img.shields.io/badge/WASM-Powered-orange.svg)

## 🚀 Key Features

- **🚀 Instant Optimization**: Runs directly in your browser with no server latency.
- **🧠 Advanced Solver**: Uses the **HiGHS** linear programming solver compiled to WebAssembly for industrial-grade optimization.
- **🎯 Optimal Build Finder**: Balances **Ergonomics**, **Recoil**, and **Price** based on your custom weights.
- **📊 Pareto Frontier Exploration**: Visualizes the trade-off curve (e.g., Ergo vs Recoil) to help you make informed decisions.
- **💡 Smart Rounding**: Implements a robust "Greedy Rounding" algorithm to ensure valid, conflict-free, and integer-optimal loadouts from the fractional LP relaxation.
- **🛡️ Hard Constraints**:
    - Budget Limit (₽)
    - Minimum Ergonomics
    - Maximum Vertical Recoil
    - Minimum Magazine Capacity
    - Minimum Sighting Range
    - Maximum Weight (kg)
- **🛒 Smart Filters**:
    - PMC Level & Trader Loyalty settings.
    - Flea Market toggle.
- **🌍 Multi-language**: Fully localized in **English**, **Русский**, and **中文**.

## 🛠️ Tech Stack

- **Frontend**: [React](https://react.dev/) + [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Solver**: [HiGHS](https://highs.dev/) (via WebAssembly)
    - *Strategy*: Linear Programming Relaxation + Perturbation + Greedy Rounding
- **Data**: [Tarkov.dev API](https://tarkov.dev/api/) (GraphQL)
- **Styling**: [TailwindCSS](https://tailwindcss.com/)

## 📥 Installation & Running

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) (usually comes with Node.js)

### Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/AhaiMk01/tarkov-weapon-optimizer.git
   cd tarkov-weapon-optimizer
   ```

2. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

3. **Install dependencies**:
   ```bash
   npm install
   ```
   *Note: This will verify the `highs` WASM package is correctly installed.*

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Open in Browser**:
   Visit `http://localhost:5173` (or the URL shown in your terminal).

## 🐳 Deploy with Docker (Self-Hosting)

Pre-built multi-arch images (`linux/amd64`, `linux/arm64`) are published to GitHub Container Registry on every release tag — suitable for home servers, VPSes, and Raspberry Pi.

> The container is a pure static web server (`nginx:alpine`, ~30 MB). All optimization runs client-side in the visitor's browser via WASM — no backend, no database, no env vars needed.

### Quick Start (Pre-built Image)

```bash
docker run -d \
  --name tarkov-optimizer \
  --restart unless-stopped \
  -p 8080:80 \
  ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
```

Then open `http://<your-host>:8080`.

Change `8080` to any host port; the container always listens on `80` internally. Pin a specific version by replacing `:latest` with e.g. `:2.4.2`.

### Build from Source

If you'd rather build the image locally (e.g. from a fork):

```bash
cd frontend
docker build -t tarkov-optimizer .
docker run --rm -d -p 8080:80 --name tarkov-optimizer tarkov-optimizer
```

### Behind a Reverse Proxy

The app is a single-page application served with an SPA fallback, so any deep-linked URL (e.g. `/explore`) returns `index.html`. Proxy the container's port as you would any static site — no WebSockets, no sticky sessions needed.

### Stop / Update

```bash
docker stop tarkov-optimizer && docker rm tarkov-optimizer
docker pull ghcr.io/ahaimk01/tarkov-optimizer-frontend:latest
# then re-run the "Quick Start" command
```

## 🧪 Verification & Testing

This project includes a rigorous verification suite to ensure the stability and correctness of the WASM solver.

- **Run Verification Script**:
  ```bash
  npx tsx test_multi_weapon_verification.ts
  ```
  This script tests the optimizer against complex real-world weapons (e.g., AK-74, M4A1) to ensure it generates valid, integer-optimal loadouts without crashing.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📜 License

This project is for educational and personal use. All data is provided by [Tarkov.dev](https://tarkov.dev/).
