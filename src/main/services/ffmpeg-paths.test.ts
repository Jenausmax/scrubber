// Тесты ffmpeg-paths: правка app.asar→app.asar.unpacked + ensureExecutable matrix.
//
// Источник: 02-PLAN-02 Task 1 behavior, 02-RESEARCH.md §Pattern 5 / §Pitfall #2.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')
function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}
function restorePlatform(): void {
  if (PLATFORM_DESCRIPTOR) Object.defineProperty(process, 'platform', PLATFORM_DESCRIPTOR)
}

beforeEach(() => {
  restorePlatform()
  vi.resetModules()
  vi.doUnmock('ffmpeg-static')
  vi.doUnmock('@ffprobe-installer/ffprobe')
  vi.doUnmock('node:fs')
})

describe('resolveFfmpeg / resolveFfprobe', () => {
  it('resolveFfmpeg: заменяет app.asar на app.asar.unpacked', async () => {
    vi.doMock('ffmpeg-static', () => ({
      default: '/some/path/app.asar/node_modules/ffmpeg-static/ffmpeg'
    }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({
      path: '/some/path/app.asar/node_modules/@ffprobe-installer/ffprobe/bin/ffprobe'
    }))
    const { resolveFfmpeg } = await import('./ffmpeg-paths')
    expect(resolveFfmpeg()).toBe(
      '/some/path/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
    )
  })

  it('resolveFfprobe: заменяет app.asar на app.asar.unpacked', async () => {
    vi.doMock('ffmpeg-static', () => ({
      default: '/some/path/app.asar/node_modules/ffmpeg-static/ffmpeg'
    }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({
      path: '/some/path/app.asar/node_modules/@ffprobe-installer/ffprobe/bin/ffprobe'
    }))
    const { resolveFfprobe } = await import('./ffmpeg-paths')
    expect(resolveFfprobe()).toBe(
      '/some/path/app.asar.unpacked/node_modules/@ffprobe-installer/ffprobe/bin/ffprobe'
    )
  })

  it('resolveFfmpeg: throw fail-fast если ffmpeg-static === null', async () => {
    vi.doMock('ffmpeg-static', () => ({ default: null }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({ path: '/x/ffprobe' }))
    const { resolveFfmpeg } = await import('./ffmpeg-paths')
    expect(() => resolveFfmpeg()).toThrow(/ffmpeg-static/)
  })
})

describe('ensureExecutable', () => {
  it('win32: НЕ вызывает fs.chmod (no-op)', async () => {
    stubPlatform('win32')
    const chmodSpy = vi.fn().mockResolvedValue(undefined)
    const accessSpy = vi.fn().mockResolvedValue(undefined)
    vi.doMock('node:fs', () => ({
      promises: { chmod: chmodSpy, access: accessSpy },
      constants: { X_OK: 1 }
    }))
    vi.doMock('ffmpeg-static', () => ({ default: '/x/ffmpeg' }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({ path: '/x/ffprobe' }))
    const { ensureExecutable } = await import('./ffmpeg-paths')
    await ensureExecutable('/some/binary')
    expect(chmodSpy).not.toHaveBeenCalled()
    expect(accessSpy).not.toHaveBeenCalled()
  })

  it('linux + access REJECT: вызывает fs.chmod(p, 0o755)', async () => {
    stubPlatform('linux')
    const chmodSpy = vi.fn().mockResolvedValue(undefined)
    const accessSpy = vi.fn().mockRejectedValue(new Error('EACCES'))
    vi.doMock('node:fs', () => ({
      promises: { chmod: chmodSpy, access: accessSpy },
      constants: { X_OK: 1 }
    }))
    vi.doMock('ffmpeg-static', () => ({ default: '/x/ffmpeg' }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({ path: '/x/ffprobe' }))
    const { ensureExecutable } = await import('./ffmpeg-paths')
    await ensureExecutable('/some/binary')
    expect(accessSpy).toHaveBeenCalledWith('/some/binary', 1)
    expect(chmodSpy).toHaveBeenCalledWith('/some/binary', 0o755)
  })

  it('linux + access OK: fs.chmod НЕ вызывается', async () => {
    stubPlatform('linux')
    const chmodSpy = vi.fn().mockResolvedValue(undefined)
    const accessSpy = vi.fn().mockResolvedValue(undefined)
    vi.doMock('node:fs', () => ({
      promises: { chmod: chmodSpy, access: accessSpy },
      constants: { X_OK: 1 }
    }))
    vi.doMock('ffmpeg-static', () => ({ default: '/x/ffmpeg' }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({ path: '/x/ffprobe' }))
    const { ensureExecutable } = await import('./ffmpeg-paths')
    await ensureExecutable('/some/binary')
    expect(accessSpy).toHaveBeenCalledWith('/some/binary', 1)
    expect(chmodSpy).not.toHaveBeenCalled()
  })

  it('darwin + access REJECT: вызывает fs.chmod', async () => {
    stubPlatform('darwin')
    const chmodSpy = vi.fn().mockResolvedValue(undefined)
    const accessSpy = vi.fn().mockRejectedValue(new Error('EACCES'))
    vi.doMock('node:fs', () => ({
      promises: { chmod: chmodSpy, access: accessSpy },
      constants: { X_OK: 1 }
    }))
    vi.doMock('ffmpeg-static', () => ({ default: '/x/ffmpeg' }))
    vi.doMock('@ffprobe-installer/ffprobe', () => ({ path: '/x/ffprobe' }))
    const { ensureExecutable } = await import('./ffmpeg-paths')
    await ensureExecutable('/some/binary')
    expect(chmodSpy).toHaveBeenCalledWith('/some/binary', 0o755)
  })
})
