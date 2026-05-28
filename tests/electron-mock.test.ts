// Wave 0 contract test: убеждается, что setupFiles мокает модуль `electron`
// со всеми API, которые понадобятся Plan 02..04.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app, safeStorage, BrowserWindow, ipcMain, contextBridge, shell } from 'electron'
import { setBackend } from './setup'

describe('electron mock — Wave 0 contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('импорт electron возвращает объект, а не выбрасывает Cannot find module', () => {
    expect(app).toBeDefined()
    expect(safeStorage).toBeDefined()
    expect(BrowserWindow).toBeDefined()
    expect(ipcMain).toBeDefined()
    expect(contextBridge).toBeDefined()
    expect(shell).toBeDefined()
  })

  it('safeStorage round-trip: encryptString(x) → decryptString = x', () => {
    const plaintext = 'my-secret-api-key'
    const cipher = safeStorage.encryptString(plaintext)
    expect(Buffer.isBuffer(cipher) || cipher instanceof Uint8Array).toBe(true)
    const decoded = safeStorage.decryptString(cipher as Buffer)
    expect(decoded).toBe(plaintext)
  })

  it('safeStorage.getSelectedStorageBackend перепривязывается через setBackend()', () => {
    // дефолт
    expect(safeStorage.getSelectedStorageBackend()).toBe('gnome_libsecret')
    // подмена per-test
    setBackend('basic_text')
    expect(safeStorage.getSelectedStorageBackend()).toBe('basic_text')
    setBackend('kwallet6')
    expect(safeStorage.getSelectedStorageBackend()).toBe('kwallet6')
    // вернуть дефолт, чтобы не утечь в другие тесты
    setBackend('gnome_libsecret')
  })

  it('app.getPath("userData") возвращает временный путь', () => {
    const p = app.getPath('userData')
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
    expect(p).toMatch(/scrubber-test/)
  })

  it('safeStorage.isEncryptionAvailable() === true по умолчанию', () => {
    expect(safeStorage.isEncryptionAvailable()).toBe(true)
  })

  it('BrowserWindow — это конструктор, фиксирующий webPreferences в instance.__opts', () => {
    const win = new BrowserWindow({
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    // у мока класс сохраняет переданные опции — это потребуется в window.test.ts (Plan 02)
    expect((win as unknown as { __opts: { webPreferences: { sandbox: boolean } } }).__opts.webPreferences.sandbox).toBe(true)
  })
})
