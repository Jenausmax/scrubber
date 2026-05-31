// Тест preload bridge — D-08, D-09, D-11, D-14 + Phase 2 Plan 01 (media namespace).
// Покрываем: allow-list (settings + media), fail-loud при contextIsolated=false,
// корректный mapping channel→ipcRenderer.invoke для settings и media,
// подписку MEDIA_PROGRESS + unsubscribe (D-14 onProgress контракт).
//
// Источник: 01-RESEARCH.md §Pattern 2, 02-PATTERNS.md §src/preload/index.test.ts.

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

  it('экспонирует namespaces settings и media (allow-list), settings содержит 4 функции', async () => {
    const electron = await import('electron')
    const spy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    spy.mockClear()

    await import('./index')

    const bridge = spy.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(bridge).sort()).toEqual(['media', 'settings'])

    const settings = bridge.settings as Record<string, unknown>
    expect(Object.keys(settings).sort()).toEqual(
      ['clearApiKey', 'getSecureBackend', 'hasApiKey', 'saveApiKey'].sort()
    )
    for (const fn of Object.values(settings)) {
      expect(typeof fn).toBe('function')
    }
    restoreContextIsolated()
  })

  it('media namespace содержит ровно 5 функций (pickFile/probe/extractAudio/cancel/onProgress)', async () => {
    const electron = await import('electron')
    const spy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    spy.mockClear()

    await import('./index')

    const bridge = spy.mock.calls[0][1] as Record<string, unknown>
    const media = bridge.media as Record<string, unknown>
    expect(Object.keys(media).sort()).toEqual(
      ['cancel', 'extractAudio', 'onProgress', 'pickFile', 'probe'].sort()
    )
    for (const fn of Object.values(media)) {
      expect(typeof fn).toBe('function')
    }
    restoreContextIsolated()
  })

  it('НЕ содержит запрещённых namespaces (transcribe/llm/api/electron/ipcRenderer)', async () => {
    const electron = await import('electron')
    const spy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
    spy.mockClear()

    await import('./index')

    const bridge = spy.mock.calls[0][1] as Record<string, unknown>
    for (const forbidden of ['transcribe', 'llm', 'api', 'electron', 'ipcRenderer']) {
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

  describe('media bridge', () => {
    it('pickFile вызывает ipcRenderer.invoke(MEDIA_PICK_FILE) без аргументов', async () => {
      const electron = await import('electron')
      const bridgeSpy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
      bridgeSpy.mockClear()
      await import('./index')

      const bridge = bridgeSpy.mock.calls[0][1] as {
        media: { pickFile: () => Promise<unknown> }
      }
      const invokeSpy = electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>
      invokeSpy.mockClear()
      invokeSpy.mockResolvedValue({ ok: true })

      await bridge.media.pickFile()
      expect(invokeSpy).toHaveBeenCalledWith(Channels.MEDIA_PICK_FILE)
      restoreContextIsolated()
    })

    it('probe(path) пробрасывает path в invoke(MEDIA_PROBE, path)', async () => {
      const electron = await import('electron')
      const bridgeSpy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
      bridgeSpy.mockClear()
      await import('./index')

      const bridge = bridgeSpy.mock.calls[0][1] as {
        media: { probe: (p: string) => Promise<unknown> }
      }
      const invokeSpy = electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>
      invokeSpy.mockClear()
      invokeSpy.mockResolvedValue({ ok: true })

      await bridge.media.probe('/tmp/x.mp4')
      expect(invokeSpy).toHaveBeenCalledWith(Channels.MEDIA_PROBE, '/tmp/x.mp4')
      restoreContextIsolated()
    })

    it('extractAudio(path) пробрасывает path в invoke(MEDIA_EXTRACT, path)', async () => {
      const electron = await import('electron')
      const bridgeSpy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
      bridgeSpy.mockClear()
      await import('./index')

      const bridge = bridgeSpy.mock.calls[0][1] as {
        media: { extractAudio: (p: string) => Promise<unknown> }
      }
      const invokeSpy = electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>
      invokeSpy.mockClear()
      invokeSpy.mockResolvedValue({ ok: true })

      await bridge.media.extractAudio('/tmp/x.mp4')
      expect(invokeSpy).toHaveBeenCalledWith(Channels.MEDIA_EXTRACT, '/tmp/x.mp4')
      restoreContextIsolated()
    })

    it('cancel(jobId) пробрасывает jobId в invoke(MEDIA_CANCEL, jobId)', async () => {
      const electron = await import('electron')
      const bridgeSpy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
      bridgeSpy.mockClear()
      await import('./index')

      const bridge = bridgeSpy.mock.calls[0][1] as {
        media: { cancel: (id: string) => Promise<unknown> }
      }
      const invokeSpy = electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>
      invokeSpy.mockClear()
      invokeSpy.mockResolvedValue({ ok: true })

      await bridge.media.cancel('job-123')
      expect(invokeSpy).toHaveBeenCalledWith(Channels.MEDIA_CANCEL, 'job-123')
      restoreContextIsolated()
    })

    it('onProgress регистрирует listener на MEDIA_PROGRESS и возвращает unsubscribe', async () => {
      const electron = await import('electron')
      const bridgeSpy = electron.contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>
      bridgeSpy.mockClear()
      await import('./index')

      const bridge = bridgeSpy.mock.calls[0][1] as {
        media: { onProgress: (cb: (e: unknown) => void) => () => void }
      }
      const onSpy = electron.ipcRenderer.on as ReturnType<typeof vi.fn>
      const removeSpy = electron.ipcRenderer.removeListener as ReturnType<typeof vi.fn>
      onSpy.mockClear()
      removeSpy.mockClear()

      const cb = vi.fn()
      const unsubscribe = bridge.media.onProgress(cb)

      expect(onSpy).toHaveBeenCalledTimes(1)
      expect(onSpy.mock.calls[0][0]).toBe(Channels.MEDIA_PROGRESS)
      const registeredListener = onSpy.mock.calls[0][1] as (...args: unknown[]) => void
      expect(typeof registeredListener).toBe('function')

      expect(typeof unsubscribe).toBe('function')
      unsubscribe()

      expect(removeSpy).toHaveBeenCalledTimes(1)
      expect(removeSpy.mock.calls[0][0]).toBe(Channels.MEDIA_PROGRESS)
      // Тот же listener, что был зарегистрирован — иначе утечка handler'ов.
      expect(removeSpy.mock.calls[0][1]).toBe(registeredListener)
      restoreContextIsolated()
    })
  })

  it('fail-loud: если process.contextIsolated === false, import выбрасывает Error (D-14)', async () => {
    setContextIsolated(false)
    await expect(import('./index')).rejects.toThrow(/contextIsolation/i)
    restoreContextIsolated()
  })
})
