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
