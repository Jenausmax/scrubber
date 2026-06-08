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
  const scrubber: Partial<ScrubberApi> = {
    media: {
      pickFile: media.pickFile,
      probe: media.probe,
      extractAudio: media.extractAudio,
      cancel: media.cancel,
      onProgress: media.onProgress
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
