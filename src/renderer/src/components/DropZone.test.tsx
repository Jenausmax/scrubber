// @vitest-environment jsdom
//
// Unit-тесты DropZone — закрывают Gap 1 из 02-VERIFICATION.md.
// Сценарии: happy drop, non-mp4, multi-drop, empty path (regression: пустой
// результат webUtils.getPathForFile → onError('internal'), не onPick('')).
//
// Source: 02-05-PLAN.md Task 1 acceptance criteria.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import DropZone from './DropZone'
import type { ScrubberApi } from '../../../shared/ipc'

function makeFile(name: string, type = 'video/mp4'): File {
  return new File([new Uint8Array([0, 0, 0, 0])], name, { type })
}

function dropFiles(zone: Element, files: File[]): void {
  const dataTransfer = {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: ['Files']
  } as unknown as DataTransfer
  fireEvent.drop(zone, { dataTransfer })
}

const HAPPY_PATH = 'C:\\Users\\test\\video.mp4'

let getPathForFile: ReturnType<typeof vi.fn>

beforeEach(() => {
  getPathForFile = vi.fn().mockReturnValue(HAPPY_PATH)
  const scrubber: Partial<ScrubberApi> = {
    getPathForFile: getPathForFile as unknown as (f: File) => string
  }
  Object.defineProperty(window, 'scrubber', {
    value: scrubber,
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DropZone — handleDrop (Electron 32+ webUtils.getPathForFile)', () => {
  it('happy: одиночный .mp4 — onPick получает путь от window.scrubber.getPathForFile', () => {
    const onPick = vi.fn()
    const onError = vi.fn()
    render(<DropZone onPick={onPick} onError={onError} onPickClick={vi.fn()} />)
    const zone = screen.getByRole('region', { name: /зона перетаскивания/i })
    dropFiles(zone, [makeFile('clip.mp4')])
    expect(getPathForFile).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(HAPPY_PATH)
    expect(onError).not.toHaveBeenCalled()
  })

  it('non-mp4: onError("not_mp4"), onPick не вызывается, getPathForFile не вызывается', () => {
    const onPick = vi.fn()
    const onError = vi.fn()
    render(<DropZone onPick={onPick} onError={onError} onPickClick={vi.fn()} />)
    const zone = screen.getByRole('region', { name: /зона перетаскивания/i })
    dropFiles(zone, [makeFile('readme.txt', 'text/plain')])
    expect(onError).toHaveBeenCalledWith('not_mp4')
    expect(onPick).not.toHaveBeenCalled()
    expect(getPathForFile).not.toHaveBeenCalled()
  })

  it('multi-drop: >1 файлов → onError("invalid_argument")', () => {
    const onPick = vi.fn()
    const onError = vi.fn()
    render(<DropZone onPick={onPick} onError={onError} onPickClick={vi.fn()} />)
    const zone = screen.getByRole('region', { name: /зона перетаскивания/i })
    dropFiles(zone, [makeFile('a.mp4'), makeFile('b.mp4')])
    expect(onError).toHaveBeenCalledWith('invalid_argument')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('empty-path: getPathForFile вернул "" → onError("internal"), onPick НЕ вызывается', () => {
    // Regression Gap 1: если webUtils.getPathForFile возвращает пустую строку
    // (например, файл не имеет на диске реального path), мы не должны звать onPick('').
    getPathForFile.mockReturnValue('')
    const onPick = vi.fn()
    const onError = vi.fn()
    render(<DropZone onPick={onPick} onError={onError} onPickClick={vi.fn()} />)
    const zone = screen.getByRole('region', { name: /зона перетаскивания/i })
    dropFiles(zone, [makeFile('clip.mp4')])
    expect(getPathForFile).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith('internal')
    expect(onPick).not.toHaveBeenCalled()
  })
})
