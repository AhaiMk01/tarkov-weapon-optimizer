import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/tarkov-weapon-optimizer/' : '/',
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(Date.now().toString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  worker: {
    format: 'es',
  },
})
