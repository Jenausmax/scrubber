import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Vitest 2.x для main/preload (Node-окружение).
// Renderer-тесты (React/jsdom) появятся в Phase 4 — добавим second config.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
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
