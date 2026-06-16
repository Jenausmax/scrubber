// @vitest-environment jsdom
//
// Settings RTL-тесты (Phase 3 Plan 03 Task 2) — раздел «Модели» (TRANS-02, D-09).
//   - список моделей рендерится с размерами/статусом;
//   - «Скачать» вызывает scrubber.models.download и показывает прогресс;
//   - «Удалить» вызывает scrubber.models.delete;
//   - персист selectedModel/timecodesEnabled пишет в settings-store через setPreference.
//
// Мокаем window.scrubber целиком (Settings вызывает settings.* и models.*), как в Transcribe.test.tsx.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Settings from './Settings'
import type { ModelProgressEvent, ScrubberApi } from '../../../shared/ipc'

type ProgressCb = (e: ModelProgressEvent) => void

interface ModelsMock {
  list: ReturnType<typeof vi.fn>
  download: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  onProgress: ReturnType<typeof vi.fn>
  __getLastCb: () => ProgressCb | null
}

interface SettingsNsMock {
  getPreferences: ReturnType<typeof vi.fn>
  setPreference: ReturnType<typeof vi.fn>
}

let modelsMock: ModelsMock
let settingsNsMock: SettingsNsMock

function installScrubberMock(): void {
  let lastCb: ProgressCb | null = null
  modelsMock = {
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
    onProgress: vi.fn((cb: ProgressCb) => {
      lastCb = cb
      return (): void => {
        lastCb = null
      }
    }),
    __getLastCb: () => lastCb
  }
  settingsNsMock = {
    getPreferences: vi.fn().mockResolvedValue({
      ok: true,
      data: { selectedModel: 'medium', selectedLanguage: 'ru', timecodesEnabled: false }
    }),
    setPreference: vi.fn().mockResolvedValue({ ok: true })
  }
  const scrubber: Partial<ScrubberApi> = {
    settings: {
      saveApiKey: vi.fn().mockResolvedValue({ ok: true }),
      hasApiKey: vi.fn().mockResolvedValue({ ok: true, data: false }),
      clearApiKey: vi.fn().mockResolvedValue({ ok: true }),
      getSecureBackend: vi.fn().mockResolvedValue({ ok: true, data: 'dpapi' }),
      getPreferences: settingsNsMock.getPreferences,
      setPreference: settingsNsMock.setPreference
    },
    models: {
      list: modelsMock.list,
      download: modelsMock.download,
      cancel: modelsMock.cancel,
      delete: modelsMock.delete,
      onProgress: modelsMock.onProgress
    }
  }
  Object.defineProperty(window, 'scrubber', {
    value: scrubber,
    configurable: true,
    writable: true
  })
}

beforeEach(() => {
  installScrubberMock()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings — раздел «Модели» (TRANS-02)', () => {
  it('рендерит список моделей с размерами и статусом «скачана/нет»', async () => {
    render(<Settings />)
    // размеры уникальны и встречаются только в списке (large-v3 ~3.1 ГБ)
    await waitFor(() => expect(screen.getByText(/2.9 ГБ/)).toBeTruthy())
    expect(screen.getByText(/487|488|0\.5 ГБ|476 МБ|465 МБ/)).toBeTruthy()
    // статус: medium скачана, small/large-v3 — нет
    expect(screen.getByText('скачана')).toBeTruthy()
    expect(screen.getAllByText('не скачана').length).toBe(2)
    // три кнопки действий: 2 «Скачать» (small/large-v3) + 1 «Удалить» (medium)
    expect(screen.getAllByRole('button', { name: 'Скачать' }).length).toBe(2)
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy()
  })

  it('клик «Скачать» вызывает scrubber.models.download для нескачанной модели', async () => {
    // download висит → остаёмся в downloading
    modelsMock.download.mockReturnValue(new Promise(() => {}))
    render(<Settings />)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Скачать' }).length).toBe(2)
    )
    const user = userEvent.setup()
    // первый «Скачать» — small (порядок списка)
    await user.click(screen.getAllByRole('button', { name: 'Скачать' })[0])
    expect(modelsMock.download).toHaveBeenCalledWith('small')
    expect(screen.getByText(/Скачивание…/)).toBeTruthy()
  })

  it('прогресс скачивания обновляется по событию MODELS_PROGRESS', async () => {
    modelsMock.download.mockReturnValue(new Promise(() => {}))
    render(<Settings />)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Скачать' }).length).toBe(2)
    )
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Скачать' })[0])
    const cb = modelsMock.__getLastCb()
    expect(cb).not.toBeNull()
    act(() => {
      cb?.({ name: 'small', percent: 42 })
    })
    expect(screen.getByText(/42%/)).toBeTruthy()
  })

  it('клик «Удалить» вызывает scrubber.models.delete для скачанной модели', async () => {
    render(<Settings />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(modelsMock.delete).toHaveBeenCalledWith('medium')
  })

  it('изменение выбранной модели персистит через setPreference(selectedModel)', async () => {
    render(<Settings />)
    await waitFor(() => expect(screen.getByText(/2.9 ГБ/)).toBeTruthy())
    const select = screen.getByLabelText('Модель для распознавания')
    fireEvent.change(select, { target: { value: 'large-v3' } })
    await waitFor(() =>
      expect(settingsNsMock.setPreference).toHaveBeenCalledWith('selectedModel', 'large-v3')
    )
  })

  it('переключение таймкодов персистит через setPreference(timecodesEnabled)', async () => {
    render(<Settings />)
    await waitFor(() => expect(screen.getByText(/2.9 ГБ/)).toBeTruthy())
    const checkbox = screen.getByLabelText(/таймкоды/i)
    const user = userEvent.setup()
    await user.click(checkbox)
    await waitFor(() =>
      expect(settingsNsMock.setPreference).toHaveBeenCalledWith('timecodesEnabled', true)
    )
  })
})
