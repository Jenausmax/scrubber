// Тесты transcribe IPC handlers — фокус на CR-02: path-traversal gate для
// TRANSCRIBE_OPEN / REVEAL (канонизация + containment в userData/transcripts).
//
// transcriber мокается — нас интересует только валидация путей до вызова shell.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'node:path'
import * as os from 'node:os'

vi.mock('../services/transcriber', () => ({
  transcriber: {
    startTranscribe: vi.fn(async () => ({ ok: true, data: {} })),
    cancel: vi.fn(async () => ({ ok: true })),
    getCurrentAudioPath: vi.fn(() => null)
  }
}))

// userData в моке electron → tmpdir/scrubber-test/userData (см. tests/setup.ts).
const TRANSCRIPTS_DIR = join(os.tmpdir(), 'scrubber-test', 'userData', 'transcripts')

async function loadHandlers(): Promise<{
  handlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>
  shell: typeof import('electron').shell
}> {
  const electron = await import('electron')
  const handleMock = electron.ipcMain.handle as unknown as ReturnType<typeof vi.fn>
  handleMock.mockClear()
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  handleMock.mockImplementation(
    (ch: string, h: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(ch, h)
    }
  )
  const mod = await import('./transcribe')
  mod.registerTranscribeHandlers()
  return { handlers, shell: electron.shell }
}

beforeEach(() => {
  vi.resetModules()
})

describe('TRANSCRIBE_OPEN / REVEAL path containment (CR-02)', () => {
  it('OPEN: `..`-traversal путь, кончающийся на .md, отклоняется (invalid_argument)', async () => {
    const { handlers, shell } = await loadHandlers()
    const open = handlers.get('transcribe:open')!
    const evil = join(TRANSCRIPTS_DIR, '..', '..', '..', 'Windows', 'System32', 'evil.md')
    const r = (await open({}, evil)) as { ok: boolean; reason?: string }
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_argument')
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('OPEN: легитимный in-bounds transcript .md принимается → shell.openPath вызван', async () => {
    const { handlers, shell } = await loadHandlers()
    const open = handlers.get('transcribe:open')!
    const good = join(TRANSCRIPTS_DIR, 'abc123.transcript.md')
    const r = (await open({}, good)) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith(good)
  })

  it('REVEAL: `..`-traversal путь отклоняется, showItemInFolder не вызван', async () => {
    const { handlers, shell } = await loadHandlers()
    const reveal = handlers.get('transcribe:reveal')!
    const evil = join(TRANSCRIPTS_DIR, '..', 'secret', 'leak.md')
    const r = (await reveal({}, evil)) as { ok: boolean; reason?: string }
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_argument')
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('REVEAL: легитимный in-bounds .md принимается → showItemInFolder вызван', async () => {
    const { handlers, shell } = await loadHandlers()
    const reveal = handlers.get('transcribe:reveal')!
    const good = join(TRANSCRIPTS_DIR, 'deadbeef.transcript.md')
    const r = (await reveal({}, good)) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(shell.showItemInFolder).toHaveBeenCalledWith(good)
  })

  it('OPEN: не-.md расширение отклоняется', async () => {
    const { handlers } = await loadHandlers()
    const open = handlers.get('transcribe:open')!
    const r = (await open({}, join(TRANSCRIPTS_DIR, 'x.txt'))) as { ok: boolean; reason?: string }
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid_argument')
  })

  it('OPEN: не-строка / относительный путь отклоняется', async () => {
    const { handlers } = await loadHandlers()
    const open = handlers.get('transcribe:open')!
    expect(((await open({}, 42)) as { ok: boolean }).ok).toBe(false)
    expect(((await open({}, 'relative/path.md')) as { ok: boolean }).ok).toBe(false)
  })
})
