# Tarkov Weapon Optimizer Frontend

React 19 + TypeScript + Vite + Ant Design 5 web UI for the Tarkov Weapon Mod Optimizer.

## Tech Stack

- **React 19** with TypeScript
- **Vite** for fast development and building
- **Ant Design 5** component library with theme switching (light/dark/auto)
- **i18next** for internationalization (16 languages)
- **Recharts** for data visualization
- **Axios** for API communication

## Development

```bash
# Install dependencies
npm install

# Development (builds to dist/, served by backend)
npm run build

# Linting
npm run lint
```

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── common/       # Shared components (EmptyState, WeaponSelector, etc.)
│   │   ├── explore/      # Pareto frontier exploration
│   │   ├── gunsmith/     # Gunsmith task optimization
│   │   └── optimize/     # Single build optimization
│   ├── layouts/          # Responsive layout components
│   ├── api/              # API client (Axios)
│   ├── App.tsx           # Main application
│   └── i18n.ts           # i18next configuration
├── public/
│   ├── locales/          # 16 language translation files (zh.json is source)
│   └── traders/          # Trader images
└── package.json
```

## Internationalization

16 supported languages: en, ru, zh, es, de, fr, it, ja, ko, pl, pt, tr, cs, hu, ro, sk

Translation workflow:
1. Add new keys to `public/locales/zh.json` (source of truth)
2. Synchronize to all other language files
3. Use in components: `t('key', 'fallback')`
