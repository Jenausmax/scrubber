import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ESM-сборка main и preload (D-13 Phase 1, Pitfall #3): пакет electron-store@11 — ESM-only.
// "type": "module" в package.json + format: 'es' гарантируют, что main компилируется в ESM
// и dynamic import('electron-store') работает.
//
// Phase 2 Plan 01 (02-CONTEXT.md D-17, 02-RESEARCH.md §Pitfall #5):
// utility-script ffmpeg-runner должен собираться отдельным CJS-bundle рядом с index.js,
// потому что ESM-вход для utilityProcess.fork нестабилен.
//
// Подход (а) «массив outputs в main.build.rollupOptions» отвергнут: electron-vite
// явно бросает «The electron vite main config does not support multiple outputs».
// Принят подход (б): отдельный esbuild-вызов через npm script `build:utilities`,
// который бандлит src/main/utilities/ffmpeg-runner.ts в out/main/ffmpeg-runner.cjs.
// `npm run build` запускает `build:utilities` после `electron-vite build` — оба
// артефакта оказываются рядом в `out/main/` и electron-builder упакует их вместе.
// См. package.json scripts.build / scripts.build:utilities + 02-01-SUMMARY.md.
export default defineConfig({
  main: {
    build: {
      // emptyOutDir:false — иначе `electron-vite dev` очищает out/main при старте и
      // удаляет ffmpeg-runner.cjs/whisper-runner.cjs (их собирает отдельный esbuild-шаг
      // build:utilities через predev-хук). Без этого utilityProcess.fork падает в dev —
      // извлечение аудио/транскрипция возвращают ffmpeg_failed («повреждён/кодек»).
      emptyOutDir: false,
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
