import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(Date.now().toString()),
  },
  worker: {
    format: 'es',
  },
})
