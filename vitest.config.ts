import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Vitest 2.x. Main/preload — Node-окружение; renderer — jsdom через per-file
// `// @vitest-environment jsdom` директиву в шапке *.test.tsx файлов (Phase 2 Plan 03).
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    reporters: ['default']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
