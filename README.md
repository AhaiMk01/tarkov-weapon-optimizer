# Tarkov Weapon Mod Optimizer 🔫

An advanced weapon build optimizer for Escape from Tarkov. This tool uses **constraint programming** (via Google OR-Tools CP-SAT solver) to find the mathematically optimal set of modifications for any weapon based on your priorities and constraints.

![Project Overview](https://img.shields.io/badge/Tarkov-Optimizer-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)
![Streamlit](https://img.shields.io/badge/Streamlit-1.30%2B-red.svg)

## 🚀 Key Features

- **Optimal Build Finder**: Uses a weighted objective function to balance **Ergonomics**, **Recoil**, and **Price**.
- **Pareto Frontier Exploration**: Visualize the trade-off curves between different stats (e.g., Recoil vs. Price) to understand what is achievable before optimizing.
- **Hard Constraints**: Set strict requirements for:
    - Budget Limit (₽)
    - Minimum Ergonomics
    - Maximum Vertical Recoil
    - Minimum Magazine Capacity
    - Minimum Sighting Range
    - Maximum Weight (kg)
- **Smart Availability Filters**:
    - Filter by PMC level.
    - Toggle Flea Market access.
    - Set individual Trader Loyalty Levels (LL1-LL4).
- **Presets Support**: Handles weapon presets (bundles) and identifies the cheapest way to build your weapon.
- **Multi-language Support**: Fully localized in **English**, **Русский**, and **中文**.
- **Exporting**: Save your builds as JSON for data analysis or Markdown for sharing on Discord/Forums.

## 🛠️ Tech Stack

- **Frontend**: [Streamlit](https://streamlit.io/)
- **Solver**: [Google OR-Tools (CP-SAT)](https://developers.google.com/optimization)
- **Data Source**: [Tarkov.dev GraphQL API](https://tarkov.dev/api/)
- **Visuals**: Plotly, Altair, and Pandas

## 📥 Installation

### Using Pixi (Recommended)
If you have [pixi](https://pixi.sh/) installed:
```bash
pixi run start
```

### Using pip
1. Clone the repository.
2. Install dependencies:
```bash
pip install -r requirements.txt
```
3. Run the application:
```bash
streamlit run app.py
```

## 📖 How it Works

1. **Select a Weapon**: Choose from the list of available weapons in the sidebar.
2. **Configure Access**: Set your PMC level and trader levels to ensure the optimizer only suggests items you can actually buy.
3. **Set Constraints**: Use the **Hard Constraints** sidebar to set your budget or performance requirements.
4. **Choose Weights**: In the **Optimize Build** tab, use the triangular weight selector to prioritize Ergo, Recoil, or Price.
5. **Optimize**: Click **Optimize Build** to run the solver. In seconds, you'll have the best possible configuration.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📜 License

This project is for educational and personal use. All data is provided by [Tarkov.dev](https://tarkov.dev/).
