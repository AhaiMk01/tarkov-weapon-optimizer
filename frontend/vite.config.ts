import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  define: {
    __BUILD_TIME__: JSON.stringify(Date.now().toString()),
    global: 'globalThis',
  },
  optimizeDeps: {
    exclude: ['z3-solver'],
  },
  worker: {
    format: 'es',
  },
})
