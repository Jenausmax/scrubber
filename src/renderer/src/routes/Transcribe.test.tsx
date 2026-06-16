// @vitest-environment jsdom
//
// Transcribe FSM tests — drop-валидация + state-переходы.
// Источник: 02-PLAN-03 Task 3 behavior; 02-UI-SPEC.md §State Map;
//          02-RESEARCH.md §Wave 0 Gaps (RTL+jsdom).
// Не используем глобальный electron-mock (tests/setup.ts) — вместо этого мокаем
// window.scrubber целиком, потому что Transcribe вызывает window.scrubber.media.*,
// а не ipcRenderer напрямую.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Transcribe from './Transcribe'
import type {
  MediaProgressEvent,
  ScrubberApi
} from '../../../shared/ipc'

type ProgressCb = (e: MediaProgressEvent) => void

interface MediaMock {
  pickFile: ReturnType<typeof vi.fn>
  probe: ReturnType<typeof vi.fn>
  extractAudio: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  onProgress: ReturnType<typeof vi.fn>
  // Из onProgress.mockImplementation — последний зарегистрированный callback
  __getLastCb: () => ProgressCb | null
}

interface TranscribeMock {
  start: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  openFile: ReturnType<typeof vi.fn>
  revealInFolder: ReturnType<typeof vi.fn>
  onProgress: ReturnType<typeof vi.fn>
  onSegment: ReturnType<typeof vi.fn>
}

let transcribeMock: TranscribeMock

function installScrubberMock(): MediaMock {
  let lastCb: ProgressCb | null = null
  const media: MediaMock = {
    pickFile: vi.fn(),
    probe: vi.fn(),
    extractAudio: vi.fn(),
    cancel: vi.fn().mockResolvedValue({ ok: true }),
    onProgress: vi.fn((cb: ProgressCb) => {
      lastCb = cb
      return (): void => {
        lastCb = null
      }
    }),
    __getLastCb: () => lastCb
  }
  transcribeMock = {
    start: vi.fn(),
    cancel: vi.fn().mockResolvedValue({ ok: true }),
    openFile: vi.fn().mockResolvedValue({ ok: true }),
    revealInFolder: vi.fn().mockResolvedValue({ ok: true }),
    onProgress: vi.fn(() => (): void => {}),
    onSegment: vi.fn(() => (): void => {})
  }
  const scrubber: Partial<ScrubberApi> = {
    // Phase 3 (03-03): Transcribe загружает настройки + список моделей на mount.
    // По умолчанию выбранная модель medium СКАЧАНА → кнопка активна.
    settings: {
      saveApiKey: vi.fn().mockResolvedValue({ ok: true }),
      hasApiKey: vi.fn().mockResolvedValue({ ok: true, data: false }),
      clearApiKey: vi.fn().mockResolvedValue({ ok: true }),
      getSecureBackend: vi.fn().mockResolvedValue({ ok: true, data: 'dpapi' }),
      getPreferences: vi.fn().mockResolvedValue({
        ok: true,
        data: { selectedModel: 'medium', selectedLanguage: 'ru', timecodesEnabled: false }
      }),
      setPreference: vi.fn().mockResolvedValue({ ok: true })
    },
    models: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { name: 'small', sizeBytes: 487_601_967, downloaded: false },
          { name: 'medium', sizeBytes: 1_533_763_059, downloaded: true },
          { name: 'large-v3', sizeBytes: 3_095_033_483, downloaded: false }
        ]
      }),
      download: vi.fn().mockResolvedValue({ ok: true, data: { jobId: 'm1' } }),
      cancel: vi.fn().mockResolvedValue({ ok: true }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      onProgress: vi.fn(() => (): void => {})
    },
    media: {
      pickFile: media.pickFile,
      probe: media.probe,
      extractAudio: media.extractAudio,
      cancel: media.cancel,
      onProgress: media.onProgress
    },
    transcribe: {
      start: transcribeMock.start,
      cancel: transcribeMock.cancel,
      // saveAs — заглушка в контракте; в 03-02 из UI не вызывается.
      saveAs: vi.fn().mockResolvedValue({ ok: true, data: null }),
      openFile: transcribeMock.openFile,
      revealInFolder: transcribeMock.revealInFolder,
      onProgress: transcribeMock.onProgress,
      onSegment: transcribeMock.onSegment
    },
    // 02-05 Gap 1: DropZone теперь читает путь через window.scrubber.getPathForFile.
    // В тестах берём path из File.__path, который ставит mp4File/txtFile.
    getPathForFile: (file: File): string => {
      const p = (file as File & { __path?: string }).__path
      return typeof p === 'string' ? p : ''
    }
  }
  Object.defineProperty(window, 'scrubber', {
    value: scrubber,
    configurable: true,
    writable: true
  })
  return media
}

/** Прогнать FSM до состояния `done` (extract успешен) — общий префикс transcribe-тестов. */
async function driveToDone(mock: MediaMock): Promise<void> {
  mock.probe.mockResolvedValue({
    ok: true,
    data: { durationSec: 60, sizeBytes: 1_000_000, name: 'test.mp4' }
  })
  mock.extractAudio.mockResolvedValue({
    ok: true,
    data: { jobId: 'j1', audioPath: 'C:\\extracted\\abc.wav' }
  })
  render(<Transcribe />)
  dropFiles(
    screen.getByRole('region', { name: /зона перетаскивания/i }),
    [mp4File('test.mp4', 'C:\\test.mp4')]
  )
  await waitFor(() => screen.getByText('Файл готов к извлечению'))
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Извлечь аудио' }))
  await waitFor(() => screen.getByText('Аудио извлечено'))
}

function mp4File(name: string, path: string): File {
  const f = new File([new Uint8Array([0, 0, 0, 0])], name, { type: 'video/mp4' })
  // 02-05 Gap 1: храним path в __path, getPathForFile-мок читает его оттуда
  // (раньше DropZone читал File.path напрямую — теперь только через preload-bridge).
  Object.defineProperty(f, '__path', { value: path, configurable: true })
  return f
}

function txtFile(name: string, path: string): File {
  const f = new File(['hello'], name, { type: 'text/plain' })
  Object.defineProperty(f, '__path', { value: path, configurable: true })
  return f
}

function dropFiles(zone: Element, files: File[]): void {
  const dataTransfer = {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: ['Files']
  } as unknown as DataTransfer
  fireEvent.drop(zone, { dataTransfer })
}

let mock: MediaMock

beforeEach(() => {
  mock = installScrubberMock()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Transcribe FSM', () => {
  it('rejects multi-drop with invalid_argument copy', () => {
    render(<Transcribe />)
    const zone = screen.getByRole('region', {
      name: /зона перетаскивания/i
    })
    dropFiles(zone, [
      mp4File('a.mp4', 'C:\\a.mp4'),
      mp4File('b.mp4', 'C:\\b.mp4')
    ])
    expect(
      screen.getByText(/Можно перетащить только один mp4-файл/i)
    ).toBeTruthy()
  })

  it('rejects non-mp4 drop with not_mp4 copy', () => {
    render(<Transcribe />)
    const zone = screen.getByRole('region', {
      name: /зона перетаскивания/i
    })
    dropFiles(zone, [txtFile('readme.txt', 'C:\\readme.txt')])
    expect(
      screen.getByText(/Поддерживается только формат .mp4/i)
    ).toBeTruthy()
  })

  it('accepts valid mp4 drop and shows file meta card', async () => {
    mock.probe.mockResolvedValue({
      ok: true,
      data: { durationSec: 60, sizeBytes: 5 * 1024 * 1024, name: 'test.mp4' }
    })
    render(<Transcribe />)
    const zone = screen.getByRole('region', {
      name: /зона перетаскивания/i
    })
    dropFiles(zone, [mp4File('test.mp4', 'C:\\test.mp4')])
    await waitFor(() => {
      expect(screen.getByText('Файл готов к извлечению')).toBeTruthy()
    })
    expect(mock.probe).toHaveBeenCalledWith('C:\\test.mp4')
  })

  it('starts extraction on button click', async () => {
    mock.probe.mockResolvedValue({
      ok: true,
      data: { durationSec: 60, sizeBytes: 1_000_000, name: 'test.mp4' }
    })
    // extractAudio — никогда не резолвим, чтобы остаться в state=extracting
    mock.extractAudio.mockReturnValue(new Promise(() => {}))
    render(<Transcribe />)
    const zone = screen.getByRole('region', {
      name: /зона перетаскивания/i
    })
    dropFiles(zone, [mp4File('test.mp4', 'C:\\test.mp4')])
    await waitFor(() => screen.getByText('Файл готов к извлечению'))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Извлечь аудио' }))

    expect(screen.getByText(/Извлекаем аудио/i)).toBeTruthy()
    expect(mock.extractAudio).toHaveBeenCalledWith('C:\\test.mp4')
  })

  it('updates progress on event', async () => {
    mock.probe.mockResolvedValue({
      ok: true,
      data: { durationSec: 60, sizeBytes: 1_000_000, name: 'test.mp4' }
    })
    mock.extractAudio.mockReturnValue(new Promise(() => {}))
    render(<Transcribe />)
    dropFiles(
      screen.getByRole('region', { name: /зона перетаскивания/i }),
      [mp4File('test.mp4', 'C:\\test.mp4')]
    )
    await waitFor(() => screen.getByText('Файл готов к извлечению'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Извлечь аудио' }))

    // Эмитим progress event через сохранённый callback
    const cb = mock.__getLastCb()
    expect(cb).not.toBeNull()
    act(() => {
      cb?.({ jobId: 'job-1', percent: 50, etaSec: 5 })
    })
    expect(screen.getByText(/50%/)).toBeTruthy()
  })

  it('shows ffmpeg_failed error copy on extract failure', async () => {
    mock.probe.mockResolvedValue({
      ok: true,
      data: { durationSec: 60, sizeBytes: 1_000_000, name: 'test.mp4' }
    })
    mock.extractAudio.mockResolvedValue({ ok: false, reason: 'ffmpeg_failed' })
    render(<Transcribe />)
    dropFiles(
      screen.getByRole('region', { name: /зона перетаскивания/i }),
      [mp4File('test.mp4', 'C:\\test.mp4')]
    )
    await waitFor(() => screen.getByText('Файл готов к извлечению'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Извлечь аудио' }))

    await waitFor(() => {
      expect(screen.getByText(/Не удалось извлечь аудио/i)).toBeTruthy()
    })
  })

  it('routes pickFile result through dialog button', async () => {
    mock.pickFile.mockResolvedValue({
      ok: true,
      data: { path: 'C:\\picked.mp4' }
    })
    mock.probe.mockResolvedValue({
      ok: true,
      data: { durationSec: 30, sizeBytes: 2_000_000, name: 'picked.mp4' }
    })
    render(<Transcribe />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Выбрать mp4-файл' }))

    await waitFor(() => {
      expect(screen.getByText('Файл готов к извлечению')).toBeTruthy()
    })
    expect(mock.pickFile).toHaveBeenCalled()
    expect(mock.probe).toHaveBeenCalledWith('C:\\picked.mp4')
  })

  it('shows done card with audio path on success', async () => {
    mock.probe.mockResolvedValue({
      ok: true,
      data: { durationSec: 60, sizeBytes: 1_000_000, name: 'test.mp4' }
    })
    mock.extractAudio.mockResolvedValue({
      ok: true,
      data: { jobId: 'j1', audioPath: 'C:\\extracted\\abc.wav' }
    })
    render(<Transcribe />)
    dropFiles(
      screen.getByRole('region', { name: /зона перетаскивания/i }),
      [mp4File('test.mp4', 'C:\\test.mp4')]
    )
    await waitFor(() => screen.getByText('Файл готов к извлечению'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Извлечь аудио' }))

    await waitFor(() => {
      expect(screen.getByText('Аудио извлечено')).toBeTruthy()
    })
    expect(screen.getByText(/abc\.wav/)).toBeTruthy()
  })
})

describe('Transcribe FSM — транскрипция (03-02 ядро ценности)', () => {
  it('после extract-done показывает кнопку «Транскрибировать»', async () => {
    await driveToDone(mock)
    expect(screen.getByRole('button', { name: 'Транскрибировать' })).toBeTruthy()
  })

  it('клик «Транскрибировать» вызывает scrubber.transcribe.start с medium/ru', async () => {
    // start не резолвим → остаёмся в transcribing
    transcribeMock.start.mockReturnValue(new Promise(() => {}))
    await driveToDone(mock)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Транскрибировать' }))
    expect(transcribeMock.start).toHaveBeenCalledWith('C:\\extracted\\abc.wav', {
      model: 'medium',
      language: 'ru'
    })
    expect(screen.getByText(/Распознаём речь/i)).toBeTruthy()
  })

  it('по resolve transcript-done рендерит TranscriptResult с текстом и кнопками', async () => {
    transcribeMock.start.mockResolvedValue({
      ok: true,
      data: {
        jobId: 't1',
        mdPath: 'C:\\transcripts\\abc.transcript.md',
        text: '---\nsource: test.mp4\n---\n\n# test.mp4\n\nПривет мир',
        segments: [{ startMs: 0, text: 'Привет мир' }]
      }
    })
    await driveToDone(mock)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Транскрибировать' }))
    await waitFor(() => expect(screen.getByText('Транскрипт готов')).toBeTruthy())
    expect(screen.getByText(/Привет мир/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Открыть файл' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Показать в папке' })).toBeTruthy()
  })

  it('«Открыть файл» вызывает transcribe.openFile с mdPath', async () => {
    transcribeMock.start.mockResolvedValue({
      ok: true,
      data: {
        jobId: 't1',
        mdPath: 'C:\\transcripts\\abc.transcript.md',
        text: 'текст',
        segments: []
      }
    })
    await driveToDone(mock)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Транскрибировать' }))
    await waitFor(() => screen.getByText('Транскрипт готов'))
    await user.click(screen.getByRole('button', { name: 'Открыть файл' }))
    expect(transcribeMock.openFile).toHaveBeenCalledWith('C:\\transcripts\\abc.transcript.md')
  })

  it('whisper_failed → InlineError с транскрипт-копи', async () => {
    transcribeMock.start.mockResolvedValue({ ok: false, reason: 'whisper_failed' })
    await driveToDone(mock)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Транскрибировать' }))
    await waitFor(() => {
      expect(screen.getByText(/whisper завершился с ошибкой/i)).toBeTruthy()
    })
  })

  it('model_missing → InlineError со ссылкой на Настройки', async () => {
    transcribeMock.start.mockResolvedValue({ ok: false, reason: 'model_missing' })
    await driveToDone(mock)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Транскрибировать' }))
    await waitFor(() => {
      expect(screen.getByText(/Настройк/i)).toBeTruthy()
    })
  })

  it('выбранная модель не скачана → кнопка заблокирована + отсылка в Настройки (D-09)', async () => {
    // medium НЕ скачана → modelAvailable=false → кнопка disabled.
    ;(window.scrubber.models.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [
        { name: 'small', sizeBytes: 487_601_967, downloaded: false },
        { name: 'medium', sizeBytes: 1_533_763_059, downloaded: false },
        { name: 'large-v3', sizeBytes: 3_095_033_483, downloaded: false }
      ]
    })
    await driveToDone(mock)
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: 'Транскрибировать' }) as HTMLButtonElement
      expect(btn.disabled).toBe(true)
    })
    expect(screen.getByText(/Настройки → Модели/i)).toBeTruthy()
    // start не должен вызываться при заблокированной кнопке
    expect(transcribeMock.start).not.toHaveBeenCalled()
  })
})
