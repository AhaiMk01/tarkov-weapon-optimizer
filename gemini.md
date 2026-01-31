# Gemini Instructions

This file provides specific guidance for the Gemini CLI agent when working on this project.

## Coding Standards

### Localization (i18n)
- **NEVER hardcode user-facing strings.** 
- All strings must be placed in the appropriate language JSON file in the `locales/` directory.
- Use the `t()` function from `i18n.py` to retrieve translated strings in the application.
- Example: 
  - Correct: `st.write(t("app.title"))`
  - Incorrect: `st.write("Tarkov Weapon Mod Optimizer")`
- When adding new features, always add the corresponding keys to `en.json`, `ru.json`, and `zh.json`.

### Python Style
- Adhere to the existing project structure and modularity (e.g., keep solver logic in `weapon_optimizer.py` and UI logic in `app.py`).
- Use typing hints where appropriate to maintain code clarity.
