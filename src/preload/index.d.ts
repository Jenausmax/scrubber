// Глобальное расширение Window — TypeScript видит `window.scrubber` в renderer-проекте
// (tsconfig.web.json уже включает этот файл).
//
// Источник: 01-CONTEXT.md D-08, 01-PATTERNS.md §Preload.

import type { ScrubberApi } from '../shared/ipc'

declare global {
  interface Window {
    scrubber: ScrubberApi
  }
}

export {}
