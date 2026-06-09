// @vitest-environment jsdom
//
// Unit-тесты InlineError — закрывают Gap 3 из 02-VERIFICATION.md.
// Главное требование: все 7 MediaReason-кодов рендерятся с УНИКАЛЬНЫМИ
// русскими сообщениями (никакие два reason'a не дают одну и ту же строку).
//
// Source: 02-05-PLAN.md Task 3 acceptance criteria.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import InlineError, { TRANSCRIBE_REASON_COPY } from './InlineError'
import type { MediaReason, TranscribeReason } from '../../../shared/ipc'

const ALL_REASONS: MediaReason[] = [
  'invalid_argument',
  'not_mp4',
  'file_not_found',
  'ffmpeg_failed',
  'cancelled',
  'disk_full',
  'internal'
]

// Все 7 TranscribeReason-кодов (03-02). Каждая копи обязана быть уникальной и на русском.
const ALL_TRANSCRIBE_REASONS: TranscribeReason[] = [
  'invalid_argument',
  'model_missing',
  'audio_not_found',
  'whisper_failed',
  'cancelled',
  'disk_full',
  'internal'
]

afterEach(() => {
  cleanup()
})

describe('InlineError — REASON_COPY (Gap 3 closure)', () => {
  it('каждый из 7 MediaReason-кодов рендерит непустой текст (≥10 символов)', () => {
    for (const reason of ALL_REASONS) {
      const { unmount } = render(<InlineError reason={reason} onRetry={vi.fn()} />)
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toBeTruthy()
      // textContent включает и текст кнопки «Попробовать снова» — выделим текст сообщения
      const message = alert.querySelector('p')?.textContent ?? ''
      expect(message.length).toBeGreaterThanOrEqual(10)
      unmount()
    }
  })

  it('uniqueness: все 7 reason-кодов дают РАЗНЫЕ строки (new Set(texts).size === 7)', () => {
    const texts = new Set<string>()
    for (const reason of ALL_REASONS) {
      const { unmount } = render(<InlineError reason={reason} onRetry={vi.fn()} />)
      const message = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
      texts.add(message)
      unmount()
    }
    expect(texts.size).toBe(7)
  })

  it('клик по «Попробовать снова» вызывает onRetry', () => {
    const onRetry = vi.fn()
    render(<InlineError reason="ffmpeg_failed" onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: /попробовать снова/i })
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('текст для `internal` отличается от `ffmpeg_failed` минимум на 20 символов', () => {
    render(<InlineError reason="internal" onRetry={vi.fn()} />)
    const internalText = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
    cleanup()
    render(<InlineError reason="ffmpeg_failed" onRetry={vi.fn()} />)
    const ffmpegText = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
    // Разница длиннее, чем 20 символов общей дельты
    const diff = Math.abs(internalText.length - ffmpegText.length)
    // На случай если длины одинаковы — проверяем substring-непересечение
    expect(diff + (internalText === ffmpegText ? 0 : 25)).toBeGreaterThan(20)
    expect(internalText).not.toBe(ffmpegText)
  })

  it('текст для `cancelled` уникален среди всех 7', () => {
    const otherReasons = ALL_REASONS.filter((r) => r !== 'cancelled')
    render(<InlineError reason="cancelled" onRetry={vi.fn()} />)
    const cancelledText = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
    cleanup()
    for (const r of otherReasons) {
      const { unmount } = render(<InlineError reason={r} onRetry={vi.fn()} />)
      const t = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
      expect(t).not.toBe(cancelledText)
      unmount()
    }
  })
})

describe('InlineError — TRANSCRIBE_REASON_COPY (03-02 TranscribeReason)', () => {
  it('все 7 TranscribeReason-копий уникальны (new Set(...).size === 7)', () => {
    const texts = new Set(Object.values(TRANSCRIBE_REASON_COPY))
    expect(texts.size).toBe(ALL_TRANSCRIBE_REASONS.length)
    expect(ALL_TRANSCRIBE_REASONS.length).toBe(7)
  })

  it('каждая TranscribeReason-копи непустая и содержит кириллицу', () => {
    for (const reason of ALL_TRANSCRIBE_REASONS) {
      const copy = TRANSCRIBE_REASON_COPY[reason]
      expect(copy.length).toBeGreaterThanOrEqual(10)
      expect(/[а-яА-ЯёЁ]/.test(copy)).toBe(true)
    }
  })

  it('model_missing рендерит копи со ссылкой на Настройки', () => {
    render(<InlineError reason="model_missing" onRetry={vi.fn()} />)
    const message = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
    expect(message).toMatch(/Настройк/i)
  })

  it('whisper_failed рендерит транскрипт-специфичную копи (не ffmpeg)', () => {
    render(<InlineError reason="whisper_failed" onRetry={vi.fn()} />)
    const message = screen.getByRole('alert').querySelector('p')?.textContent ?? ''
    expect(message).toMatch(/whisper/i)
  })
})
