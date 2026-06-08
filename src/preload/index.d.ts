// Глобальное расширение Window — TypeScript видит `window.scrubber` в renderer-проекте
// (tsconfig.web.json уже включает этот файл).
//
// Источник: 01-CONTEXT.md D-08, 01-PATTERNS.md §Preload.
//
// 02-05 Gap 1: ScrubberApi top-level содержит `getPathForFile(file: File): string`
// (Electron 32+ webUtils-bridge, см. src/preload/index.ts).

import type { ScrubberApi } from '../shared/ipc'

declare global {
  interface Window {
    scrubber: ScrubberApi
  }
}

export {}
