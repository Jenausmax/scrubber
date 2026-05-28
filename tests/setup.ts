// Wave 0 mock-инфраструктура: глобальный мок модуля `electron`, без которого
// юнит-тесты main/preload не запускаются вне Electron-рантайма.
//
// Источник контракта: 01-PLAN.md Task 2 (этот план), 01-VALIDATION.md «Wave 0 Requirements»,
// 01-RESEARCH.md §Validation Architecture / Pattern 3.
//
// Что покрываем:
//   - app.getPath('userData')          → tmpdir per-test, изолированно
//   - safeStorage.encryptString/decryptString — обратимый round-trip (плэйнтекст-обёртка 'enc:')
//   - safeStorage.isEncryptionAvailable / getSelectedStorageBackend — перепривязываются через setBackend()
//   - BrowserWindow — класс, фиксирующий webPreferences в instance.__opts (для snapshot-тестов в Plan 02)
//   - ipcMain, contextBridge, shell — заглушки vi.fn()
//   - utilityProcess — пустая заглушка (понадобится в Phase 2)

import { vi } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'

// Внешнее состояние мока — позволяет тестам переопределять backend без переинициализации.
let currentBackend = 'gnome_libsecret'
let encryptionAvailable = true

/**
 * Тест-хелпер: подменить значение, которое вернёт safeStorage.getSelectedStorageBackend().
 * Используется в Plan 02 secure-backend.test для матрицы gnome_libsecret/kwallet5/kwallet6/basic_text/unknown.
 */
export function setBackend(backend: string): void {
  currentBackend = backend
}

/**
 * Тест-хелпер: подменить значение safeStorage.isEncryptionAvailable().
 * Понадобится для проверки memory-only fallback (D-07).
 */
export function setEncryptionAvailable(available: boolean): void {
  encryptionAvailable = available
}

vi.mock('electron', () => {
  // BrowserWindow — класс, потому что его инстанцируют через new в src/main/window.ts (Plan 02).
  // Сохраняем __opts, чтобы window.test.ts мог снять snapshot webPreferences.
  class MockBrowserWindow {
    public __opts: Record<string, unknown>
    public webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      send: vi.fn()
    }
    constructor(opts: Record<string, unknown> = {}) {
      this.__opts = opts
    }
    loadURL = vi.fn().mockResolvedValue(undefined)
    loadFile = vi.fn().mockResolvedValue(undefined)
    on = vi.fn()
    once = vi.fn()
    show = vi.fn()
    static getAllWindows = vi.fn(() => [] as MockBrowserWindow[])
  }

  return {
    app: {
      getPath: vi.fn((name: string) => path.join(os.tmpdir(), 'scrubber-test', name)),
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn(),
      setAppUserModelId: vi.fn()
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => encryptionAvailable),
      encryptString: vi.fn((s: string) => Buffer.from('enc:' + s)),
      decryptString: vi.fn((b: Buffer | Uint8Array) => {
        const str = Buffer.isBuffer(b) ? b.toString('utf8') : Buffer.from(b).toString('utf8')
        return str.replace(/^enc:/, '')
      }),
      getSelectedStorageBackend: vi.fn(() => currentBackend)
    },
    BrowserWindow: MockBrowserWindow,
    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    },
    contextBridge: {
      exposeInMainWorld: vi.fn()
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined)
    },
    utilityProcess: {
      fork: vi.fn()
    }
  }
})
