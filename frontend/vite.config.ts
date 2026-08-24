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
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor')) {
              return 'chart-vendor';
            }
            if (id.includes('antd') || id.includes('@ant-design') || id.includes('@rc-component') || id.includes('rc-')) {
              return 'antd-vendor';
            }
            if (id.includes('katex')) {
              return 'katex-vendor';
            }
            if (id.includes('i18next')) {
              return 'i18n-vendor';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-vendor';
            }
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
