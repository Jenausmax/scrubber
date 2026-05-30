import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ESM-сборка main и preload (D-13, Pitfall #3): пакет electron-store@11 — ESM-only.
// "type": "module" в package.json + format: 'es' здесь гарантируют,
// что main компилируется в ESM и dynamic import('electron-store') работает.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: {
          format: 'es'
        }
      }
    }
  },
  preload: {
    // sandbox: true несовместим с ESM preload (Pitfall #9, 01-RESEARCH.md):
    // sandboxed preload грузится как чистый CJS bundle и не поддерживает import/export.
    // Поэтому preload собирается как CommonJS, в отличие от main (которому нужен ESM
    // ради electron-store@11). Расширение .cjs — package.json имеет "type": "module",
    // иначе Node трактует .js как ESM.
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
