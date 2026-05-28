// Тест preload bridge — D-08, D-09, D-11, D-14.
// Покрываем: allow-list (только settings, 4 функции), fail-loud при contextIsolated=false,
// корректный mapping channel→ipcRenderer.invoke, отсутствие лишних namespaces.
//
// Источник: 01-RESEARCH.md §Pattern 2 (preload), §Anti-Patterns, 01-CONTEXT.md D-08/D-14.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Channels } from '../shared/ipc'

const PROCESS_CTX_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'contextIsolated')

function setContextIsolated(value: boolean): void {
  Object.defineProperty(process, 'contextIsolated', {
    value,
    configurable: true,
    writable: true
  })
}

function restoreContextIsolated(): void {
  if (PROCESS_CTX_DESCRIPTOR) {
    Object.defineProperty(process, 'contextIsolated', PROCESS_CTX_DESCRIPTOR)
  } else {
    delete (process as unknown as Record<string, unknown>).contextIsolated
  }
}

beforeEach(() => {
  vi.resetModules()
  setContextIsolated(true)
})

describe('preload/index — contextBridge bridge', () => {
  it('вызывает contextBridge.exposeInMainWorld РОВНО один раз с ключом "scrubber"', async () => {
    const electron = await import('electron')
    const spy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    spy.mockClear()

    await import('./index')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toBe('scrubber')
    restoreContextIsolated()
  })

  it('экспонирует ТОЛЬКО namespace settings с четырьмя функциями', async () => {
    const electron = await import('electron')
    const spy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    spy.mockClear()

    await import('./index')

    const bridge = spy.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(bridge)).toEqual(['settings'])

    const settings = bridge.settings as Record<string, unknown>
    expect(Object.keys(settings).sort()).toEqual(
      ['clearApiKey', 'getSecureBackend', 'hasApiKey', 'saveApiKey'].sort()
    )
    for (const fn of Object.values(settings)) {
      expect(typeof fn).toBe('function')
    }
    restoreContextIsolated()
  })

  it('НЕ содержит запрещённых namespaces (media/transcribe/llm/api/electron/ipcRenderer)', async () => {
    const electron = await import('electron')
    const spy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    spy.mockClear()

    await import('./index')

    const bridge = spy.mock.calls[0][1] as Record<string, unknown>
    for (const forbidden of ['media', 'transcribe', 'llm', 'api', 'electron', 'ipcRenderer']) {
      expect(bridge[forbidden]).toBeUndefined()
    }
    restoreContextIsolated()
  })

  it('settings.* проксирует в ipcRenderer.invoke с правильными каналами и аргументами', async () => {
    const electron = await import('electron')
    const bridgeSpy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    bridgeSpy.mockClear()

    await import('./index')

    const bridge = bridgeSpy.mock.calls[0][1] as {
      settings: {
        saveApiKey: (k: string) => Promise<unknown>
        hasApiKey: () => Promise<unknown>
        clearApiKey: () => Promise<unknown>
        getSecureBackend: () => Promise<unknown>
      }
    }

    const invokeSpy = electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>
    invokeSpy.mockClear()
    invokeSpy.mockResolvedValue({ ok: true })

    await bridge.settings.saveApiKey('sk-x')
    expect(invokeSpy).toHaveBeenCalledWith(Channels.SETTINGS_SAVE_API_KEY, 'sk-x')

    invokeSpy.mockClear()
    await bridge.settings.hasApiKey()
    expect(invokeSpy).toHaveBeenCalledWith(Channels.SETTINGS_HAS_API_KEY)

    invokeSpy.mockClear()
    await bridge.settings.clearApiKey()
    expect(invokeSpy).toHaveBeenCalledWith(Channels.SETTINGS_CLEAR_API_KEY)

    invokeSpy.mockClear()
    await bridge.settings.getSecureBackend()
    expect(invokeSpy).toHaveBeenCalledWith(Channels.SETTINGS_GET_SECURE_BACKEND)

    restoreContextIsolated()
  })

  it('fail-loud: если process.contextIsolated === false, import выбрасывает Error (D-14)', async () => {
    setContextIsolated(false)
    await expect(import('./index')).rejects.toThrow(/contextIsolation/i)
    restoreContextIsolated()
  })
})
