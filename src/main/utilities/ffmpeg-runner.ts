// CJS utility entrypoint для utilityProcess.fork — Phase 2 Plan 01 skeleton.
// Plan 02 заменит на реальный runner с child_process.spawn(ffmpeg) + парсингом
// out_time_us= → progress events (см. 02-RESEARCH.md §Pattern 3 / §Pattern 4).
//
// КОНТРАКТ Plan 01 (skeleton-only):
//   - Файл должен компилироваться TypeScript'ом и собираться electron-vite в CJS-формат
//     (out/main/ffmpeg-runner.cjs) — это доказательство, что pipeline сборки видит файл.
//   - НИКАКИХ ESM `import` на верхнем уровне — рассматривается как CJS-модуль
//     (Pitfall #5 02-RESEARCH.md: ESM-вход для utilityProcess.fork нестабилен).
//   - НИКАКИХ импортов из `electron` / `src/main/*` — utility изолирован от main-графа
//     (он будет fork-нут как отдельный Node-процесс, electron-API недоступны).
//   - process.parentPort?.on?.('message', ...) — entry для IPC main↔utility (Plan 02 заполнит).
//
// Аналог: src/preload/index.ts — единственный другой файл, собираемый в CJS-формат
// (см. electron.vite.config.ts §preload.build.rollupOptions.output).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _cp = require('node:child_process')
void _cp // подавить unused — Plan 02 заменит на реальный spawn

// process.parentPort экспонируется только когда модуль запущен через utilityProcess.fork.
// Optional chaining защищает от dev-импорта (vitest / TS-проверка).
;(process as NodeJS.Process & { parentPort?: { on: (e: string, cb: () => void) => void } })
  .parentPort?.on?.('message', () => {
    /* Plan 02: handle { type: 'start' | 'cancel', ... } */
  })
