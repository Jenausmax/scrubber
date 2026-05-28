// D-14: snapshot webPreferences (sandbox/contextIsolation/nodeIntegration/webSecurity).
// + setWindowOpenHandler возвращает { action: 'deny' } и зовёт shell.openExternal.
//
// Источник: 01-RESEARCH.md §Pattern 1, 01-CONTEXT.md D-14.

import { describe, it, expect, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

describe('createWindow()', () => {
  it('фиксирует безопасные webPreferences (D-14)', async () => {
    const { createWindow } = await import('./window')
    const win = createWindow() as unknown as { __opts: { webPreferences: Record<string, unknown> } }
    const wp = win.__opts.webPreferences
    expect(wp.sandbox).toBe(true)
    expect(wp.contextIsolation).toBe(true)
    expect(wp.nodeIntegration).toBe(false)
    expect(wp.webSecurity).toBe(true)
    expect(wp.allowRunningInsecureContent).toBe(false)
  })

  it('регистрирует setWindowOpenHandler, который возвращает { action: "deny" } и открывает URL во внешнем браузере', async () => {
    const { shell } = await import('electron')
    const { createWindow } = await import('./window')
    const win = createWindow()
    const setHandler = (win as unknown as { webContents: { setWindowOpenHandler: ReturnType<typeof vi.fn> } })
      .webContents.setWindowOpenHandler
    expect(setHandler).toHaveBeenCalledTimes(1)
    const handler = setHandler.mock.calls[0][0] as (details: { url: string }) => { action: string }
    const result = handler({ url: 'https://example.com/' })
    expect(result).toEqual({ action: 'deny' })
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/')
  })

  it('возвращает объект окна с __opts (снапшот моков)', async () => {
    const { createWindow } = await import('./window')
    const win = createWindow() as unknown as { __opts: unknown }
    expect(win).toBeDefined()
    expect(win.__opts).toBeDefined()
  })
})
