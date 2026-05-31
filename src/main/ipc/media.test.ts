// Тесты media IPC handlers — defence-in-depth валидация + делегирование в mediaExtractor.
// Источник: 02-PLAN-02 Task 3 acceptance criteria.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { setDialogResult } from '../../../tests/setup'

// Подменим mediaExtractor моками
vi.mock('../services/media-extractor', () => ({
  mediaExtractor: {
    init: vi.fn(async () => undefined),
    probe: vi.fn(async () => ({
      ok: true,
      data: { durationSec: 12.5, sizeBytes: 1024, name: 'test.mp4' }
    })),
    startExtract: vi.fn(async () => ({
      ok: true,
      data: { jobId: '11111111-2222-3333-4444-555555555555', audioPath: '/cache/test.wav' }
    })),
    cancel: vi.fn(() => ({ ok: true }))
  }
}))

const INPUT_DIR = join(os.tmpdir(), 'scrubber-test', 'media-ipc')
let realMp4 = ''

beforeEach(async () => {
  vi.resetModules()
  await fs.mkdir(INPUT_DIR, { recursive: true })
  realMp4 = join(INPUT_DIR, 'video.mp4')
  await fs.writeFile(realMp4, 'fake-mp4-bytes')
})

async function loadHandlers(): Promise<{
  registerMediaHandlers: () => void
  handlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>
  mediaExtractor: typeof import('../services/media-extractor').mediaExtractor
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
  const mod = await import('./media')
  const extractorMod = await import('../services/media-extractor')
  return {
    registerMediaHandlers: mod.registerMediaHandlers,
    handlers,
    mediaExtractor: extractorMod.mediaExtractor
  }
}

describe('registerMediaHandlers', () => {
  it('регистрирует ровно 4 канала: PICK_FILE/PROBE/EXTRACT/CANCEL', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    expect(handlers.size).toBe(4)
    expect(handlers.has('media:pickFile')).toBe(true)
    expect(handlers.has('media:probe')).toBe(true)
    expect(handlers.has('media:extractAudio')).toBe(true)
    expect(handlers.has('media:cancel')).toBe(true)
  })

  it('НЕ регистрирует MEDIA_PROGRESS (event-канал, шлёт mediaExtractor)', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    expect(handlers.has('media:progress')).toBe(false)
  })
})

describe('media:pickFile', () => {
  it('canceled=false + filePaths[0] → ok:true с path', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    setDialogResult({ canceled: false, filePaths: ['C:\\videos\\test.mp4'] })
    const electron = await import('electron')
    const win = new electron.BrowserWindow()
    const result = await handlers.get('media:pickFile')!({ sender: win.webContents })
    expect(result).toEqual({ ok: true, data: { path: 'C:\\videos\\test.mp4' } })
  })

  it('canceled=true → ok:true, data:null', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    setDialogResult({ canceled: true, filePaths: [] })
    const electron = await import('electron')
    const win = new electron.BrowserWindow()
    const result = await handlers.get('media:pickFile')!({ sender: win.webContents })
    expect(result).toEqual({ ok: true, data: null })
  })

  it('передаёт фильтр {name:MP4, extensions:[mp4]} в showOpenDialog', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    setDialogResult({ canceled: true, filePaths: [] })
    const electron = await import('electron')
    const showSpy = electron.dialog.showOpenDialog as unknown as ReturnType<typeof vi.fn>
    showSpy.mockClear()
    const win = new electron.BrowserWindow()
    await handlers.get('media:pickFile')!({ sender: win.webContents })
    expect(showSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: 'MP4', extensions: ['mp4'] }]
      })
    )
  })
})

describe('media:probe — defence-in-depth валидация', () => {
  it('non-string → invalid_argument', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:probe')!({}, 42)
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('relative path → invalid_argument', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:probe')!({}, 'relative/file.mp4')
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('absolute .txt → not_mp4', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const absent = process.platform === 'win32' ? 'C:\\x\\file.txt' : '/x/file.txt'
    const r = await handlers.get('media:probe')!({}, absent)
    expect(r).toEqual({ ok: false, reason: 'not_mp4' })
  })

  it('.MP4 (uppercase) — валидно (case-insensitive)', async () => {
    const { registerMediaHandlers, handlers, mediaExtractor } = await loadHandlers()
    registerMediaHandlers()
    const upper = realMp4.replace(/\.mp4$/, '.MP4')
    await fs.rename(realMp4, upper)
    const r = await handlers.get('media:probe')!({}, upper)
    expect(r).toEqual({
      ok: true,
      data: { durationSec: 12.5, sizeBytes: 1024, name: 'test.mp4' }
    })
    expect(mediaExtractor.probe).toHaveBeenCalledWith(upper)
  })

  it('несуществующий .mp4 → file_not_found', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const absent = process.platform === 'win32' ? 'C:\\nope-x.mp4' : '/nope-x.mp4'
    const r = await handlers.get('media:probe')!({}, absent)
    expect(r).toEqual({ ok: false, reason: 'file_not_found' })
  })

  it('валидный mp4 → делегирует mediaExtractor.probe', async () => {
    const { registerMediaHandlers, handlers, mediaExtractor } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:probe')!({}, realMp4)
    expect(mediaExtractor.probe).toHaveBeenCalledWith(realMp4)
    expect(r).toEqual({
      ok: true,
      data: { durationSec: 12.5, sizeBytes: 1024, name: 'test.mp4' }
    })
  })
})

describe('media:extractAudio — defence-in-depth + probe-then-extract', () => {
  it('relative path → invalid_argument (defence-in-depth)', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:extractAudio')!({}, 'relative.mp4')
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('absolute .txt → not_mp4 (defence-in-depth)', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const p = process.platform === 'win32' ? 'C:\\abs\\file.txt' : '/abs/file.txt'
    const r = await handlers.get('media:extractAudio')!({}, p)
    expect(r).toEqual({ ok: false, reason: 'not_mp4' })
  })

  it('валидный mp4 → probe + startExtract(path, durationSec)', async () => {
    const { registerMediaHandlers, handlers, mediaExtractor } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:extractAudio')!({}, realMp4)
    expect(mediaExtractor.probe).toHaveBeenCalledWith(realMp4)
    expect(mediaExtractor.startExtract).toHaveBeenCalledWith(realMp4, 12.5)
    expect(r).toEqual({
      ok: true,
      data: { jobId: '11111111-2222-3333-4444-555555555555', audioPath: '/cache/test.wav' }
    })
  })

  it('probe fail → возвращает reason probe-а, без startExtract', async () => {
    const { registerMediaHandlers, handlers, mediaExtractor } = await loadHandlers()
    ;(mediaExtractor.startExtract as ReturnType<typeof vi.fn>).mockClear()
    ;(mediaExtractor.probe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: 'ffmpeg_failed'
    })
    registerMediaHandlers()
    const r = await handlers.get('media:extractAudio')!({}, realMp4)
    expect(r).toEqual({ ok: false, reason: 'ffmpeg_failed' })
    expect(mediaExtractor.startExtract).not.toHaveBeenCalled()
  })
})

describe('media:cancel — UUID validation', () => {
  it('non-string → invalid_argument', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:cancel')!({}, 123)
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('строка не-UUID → invalid_argument', async () => {
    const { registerMediaHandlers, handlers } = await loadHandlers()
    registerMediaHandlers()
    const r = await handlers.get('media:cancel')!({}, 'not-a-uuid')
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('валидный UUID → делегирует mediaExtractor.cancel', async () => {
    const { registerMediaHandlers, handlers, mediaExtractor } = await loadHandlers()
    registerMediaHandlers()
    const jobId = '11111111-2222-3333-4444-555555555555'
    const r = await handlers.get('media:cancel')!({}, jobId)
    expect(mediaExtractor.cancel).toHaveBeenCalledWith(jobId)
    expect(r).toEqual({ ok: true })
  })
})

describe('media — нет сырых строковых литералов media:* в impl', () => {
  it('media.ts использует только Channels.MEDIA_* константы', async () => {
    const src = await fs.readFile(
      join(process.cwd(), 'src/main/ipc/media.ts'),
      'utf8'
    )
    // Исключим строку с импортом Channels и комментарии — но проще проверить отсутствие
    // одиночных литералов 'media:foo' в строках кода.
    // Поиск: строка содержит 'media:' внутри одинарных или двойных кавычек.
    // ВАЖНО: импорт Channels — типы, а не литералы 'media:'.
    const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('//'))
    const code = codeLines.join('\n')
    expect(code).not.toMatch(/['"]media:/)
  })
})
