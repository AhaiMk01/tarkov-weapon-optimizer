import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages and the static nginx image cannot send headers, so the policy rides in a meta tag.
// Production only: the dev server needs inline scripts for HMR.
function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1]));
        if (inline.length !== 1 || /\btype\s*=/i.test(inline[0][1])) {
          throw new Error(
            `CSP: expected exactly one classic inline <script> in index.html, found ${inline.length}. ` +
              'Hash each inline script in contentSecurityPolicy() (vite.config.ts) or move it to a file.',
          );
        }
        // The HTML parser turns CRLF and lone CR into LF before the browser hashes the script, so hash that text.
        const hash = createHash('sha256').update(inline[0][2].replace(/\r\n?/g, '\n')).digest('base64');
        const policy = [
          "default-src 'self'",
          // The solver workers compile WebAssembly and import the HiGHS glue from a blob URL. Current browsers
          // judge a worker by its own response, but one that applies the page policy to workers needs both sources.
          `script-src 'self' 'sha256-${hash}' 'wasm-unsafe-eval' blob:`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "connect-src 'self' https://json.tarkov.dev https://api.tarkov.dev",
          "worker-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ');
        return html.replace(/<head[^>]*>/i, (head) => `${head}
    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/tarkov-weapon-optimizer/' : '/',
  plugins: [react(), contentSecurityPolicy()],
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
