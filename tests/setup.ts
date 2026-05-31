// Wave 0 mock-инфраструктура: глобальный мок модуля `electron`, без которого
// юнит-тесты main/preload не запускаются вне Electron-рантайма.
//
// Источник контракта: 01-PLAN.md Task 2 (Phase 1), 01-VALIDATION.md «Wave 0 Requirements»,
// 01-RESEARCH.md §Validation Architecture / Pattern 3, 02-PATTERNS.md §tests/setup.ts.
//
// Что покрываем:
//   - app.getPath('userData')          → tmpdir per-test, изолированно
//   - safeStorage.encryptString/decryptString — обратимый round-trip (плэйнтекст-обёртка 'enc:')
//   - safeStorage.isEncryptionAvailable / getSelectedStorageBackend — перепривязываются через setBackend()
//   - BrowserWindow — класс, фиксирующий webPreferences в instance.__opts; static fromWebContents
//     возвращает new MockBrowserWindow() (нужно для ipcMain.handle(MEDIA_PICK_FILE) — Plan 02).
//   - ipcMain, contextBridge, shell — заглушки vi.fn()
//   - dialog.showOpenDialog — vi.fn возвращает { canceled: true, filePaths: [] } по умолчанию;
//     setDialogResult(...) подменяет результат (Phase 2 Plan 01).
//   - utilityProcess.fork — фабрика, возвращающая EventEmitter-подобный объект с
//     postMessage/kill/on + __emit(evt, ...args) для симуляции жизненного цикла
//     ffmpeg-runner (Phase 2 Plan 02).

import { vi } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'

// Внешнее состояние мока — позволяет тестам переопределять backend без переинициализации.
let currentBackend = 'gnome_libsecret'
let encryptionAvailable = true
let dialogResult: { canceled: boolean; filePaths: string[] } = {
  canceled: true,
  filePaths: []
}

/**
 * Тест-хелпер: подменить значение, которое вернёт safeStorage.getSelectedStorageBackend().
 * Используется в secure-backend.test для матрицы gnome_libsecret/kwallet5/kwallet6/basic_text/unknown.
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

/**
 * Тест-хелпер: подменить результат dialog.showOpenDialog (Phase 2 Plan 01 — media.pickFile тесты).
 * Дефолт: canceled=true, filePaths=[]. Plan 02 media.test.ts использует для happy-path.
 */
export function setDialogResult(result: { canceled: boolean; filePaths: string[] }): void {
  dialogResult = result
}

vi.mock('electron', () => {
  // BrowserWindow — класс, потому что его инстанцируют через new в src/main/window.ts.
  // Сохраняем __opts, чтобы window.test.ts мог снять snapshot webPreferences.
  // Static fromWebContents нужен handler'у MEDIA_PICK_FILE — он берёт окно из event.sender.
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
    static fromWebContents = vi.fn(() => new MockBrowserWindow())
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
    dialog: {
      showOpenDialog: vi.fn(async () => dialogResult)
    },
    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    },
    contextBridge: {
      exposeInMainWorld: vi.fn()
    },
    ipcRenderer: {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn()
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined)
    },
    utilityProcess: {
      // Фабрика — каждый вызов возвращает свежий EventEmitter-подобный объект.
      // Тесты Plan 02 используют __emit('message'|'exit'|'spawn'|'error', ...args)
      // для симуляции жизненного цикла ffmpeg-runner без реальной spawn.
      fork: vi.fn(() => {
        const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
        return {
          postMessage: vi.fn(),
          kill: vi.fn(),
          on: vi.fn((evt: string, cb: (...args: unknown[]) => void) => {
            const arr = listeners.get(evt) ?? []
            arr.push(cb)
            listeners.set(evt, arr)
          }),
          __emit: (evt: string, ...args: unknown[]): void => {
            for (const cb of listeners.get(evt) ?? []) cb(...args)
          }
        }
      })
    }
  }
})
