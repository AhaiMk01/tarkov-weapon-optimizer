import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('recharts')) return 'vendor-charts';
            if (id.includes('lucide-react')) return 'vendor-ui';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            if (id.includes('i18next')) return 'vendor-i18n';
          }
        },
      },
    },
  },
})
