// Тесты MediaExtractor — happy/cancel/ffmpeg_failed/cache-hit/invalid + initial-progress order.
// Источник: 02-PLAN-02 Task 2 acceptance criteria, 02-RESEARCH.md §Pattern 3.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'

const USER_DATA = join(os.tmpdir(), 'scrubber-test', 'userData')
const EXTRACTED = join(USER_DATA, 'extracted')

// Stub ffmpeg-paths — статичные пути, без реальной zoom-resolve логики.
vi.mock('./ffmpeg-paths', () => ({
  resolveFfmpeg: vi.fn(() => '/fake/ffmpeg'),
  resolveFfprobe: vi.fn(() => '/fake/ffprobe'),
  ensureExecutable: vi.fn(async () => undefined)
}))

interface ForkMock {
  postMessage: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  __emit: (evt: string, ...args: unknown[]) => void
}

async function freshExtractor(): Promise<typeof import('./media-extractor').mediaExtractor> {
  const mod = await import('./media-extractor')
  await mod.mediaExtractor.init()
  return mod.mediaExtractor
}

const TEST_MP4 = process.platform === 'win32' ? 'C:\\fixtures\\test.mp4' : '/fixtures/test.mp4'

async function createFakeMp4(): Promise<void> {
  // Чтобы fs.stat(absPath) не падал в startExtract: создаём фейк-файл во временной директории
  // и подменяем TEST_MP4 на него.
}

let realInputPath: string

beforeEach(async () => {
  await fs.rm(USER_DATA, { recursive: true, force: true })
  vi.resetModules()
  // Cоздать input-файл для startExtract (нужен fs.stat).
  const inputDir = join(os.tmpdir(), 'scrubber-test', 'input')
  await fs.mkdir(inputDir, { recursive: true })
  realInputPath = join(inputDir, 'sample.mp4')
  await fs.writeFile(realInputPath, 'fake-mp4-bytes')
  void createFakeMp4
  void TEST_MP4
})

/** Дать промисам/микротаскам прокрутиться, чтобы async-startExtract дошёл до fork.
 *  Используем setTimeout(0) — позволяет реальным I/O (fs.stat/mkdir) завершиться. */
async function flushAsync(ms = 50): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms))
}

afterEach(async () => {
  await fs.rm(USER_DATA, { recursive: true, force: true })
})

function getForkMock(electron: typeof import('electron')): ReturnType<typeof vi.fn> {
  return electron.utilityProcess.fork as unknown as ReturnType<typeof vi.fn>
}

describe('MediaExtractor.init', () => {
  it('создаёт <userData>/extracted/ и вызывает ensureExecutable дважды', async () => {
    const { ensureExecutable } = await import('./ffmpeg-paths')
    const extractor = await freshExtractor()
    void extractor
    await expect(fs.stat(EXTRACTED)).resolves.toBeTruthy()
    expect(ensureExecutable).toHaveBeenCalledTimes(2)
    expect(ensureExecutable).toHaveBeenNthCalledWith(1, '/fake/ffmpeg')
    expect(ensureExecutable).toHaveBeenNthCalledWith(2, '/fake/ffprobe')
  })

  it('идемпотентен (повторный init — без повторного chmod)', async () => {
    const { ensureExecutable } = await import('./ffmpeg-paths')
    const extractor = await freshExtractor()
    // freshExtractor уже вызвал init → 2 вызова.
    ;(ensureExecutable as unknown as ReturnType<typeof vi.fn>).mockClear()
    await extractor.init()
    expect(ensureExecutable).not.toHaveBeenCalled()
  })
})

describe('MediaExtractor.startExtract — happy path', () => {
  it('forkает ffmpeg-runner и резолвит {ok:true,audioPath} на exit 0', async () => {
    const extractor = await freshExtractor()
    const electron = await import('electron')
    const onProgress = vi.fn()

    const p = extractor.startExtract(realInputPath, 10, onProgress)

    await flushAsync()

    const forkMock = getForkMock(electron)
    expect(forkMock).toHaveBeenCalled()

    // Initial progress emitted с percent:0, etaSec:null до spawn
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 0, etaSec: null })
    )

    const procMock = forkMock.mock.results[forkMock.mock.results.length - 1].value as ForkMock
    procMock.__emit('spawn')
    expect(procMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start',
        ffmpegPath: '/fake/ffmpeg',
        inputPath: realInputPath,
        durationSec: 10
      })
    )

    procMock.__emit('message', { type: 'progress', percent: 50, etaSec: 5 })
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 50, etaSec: 5 })
    )

    // Подготовим .tmp файл, чтобы rename сработал
    const args = procMock.postMessage.mock.calls[0][0] as { outputPath: string }
    await fs.writeFile(args.outputPath, 'fake-wav-bytes')

    procMock.__emit('exit', 0)
    const result = await p
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data!.audioPath).toMatch(/\.wav$/)
      expect(result.data!.audioPath).not.toMatch(/\.tmp$/)
    }
  })

  it('mock-call-order: initial onProgress(percent:0) идёт ПЕРЕД emit(spawn)+postMessage(start)', async () => {
    const extractor = await freshExtractor()
    const electron = await import('electron')
    const events: string[] = []
    const onProgress = vi.fn((e: { percent: number }) => {
      events.push(`onProgress:${e.percent}`)
    })

    const p = extractor.startExtract(realInputPath, 10, onProgress)
    await flushAsync()

    const forkMock = getForkMock(electron)
    const procMock = forkMock.mock.results[forkMock.mock.results.length - 1].value as ForkMock
    events.push('beforeSpawnEmit')

    // initial progress(0) должен быть до beforeSpawnEmit
    expect(events[0]).toBe('onProgress:0')
    expect(events.indexOf('onProgress:0')).toBeLessThan(events.indexOf('beforeSpawnEmit'))
    // postMessage('start') ещё не звонили — он вызывается на event 'spawn'
    expect(procMock.postMessage).not.toHaveBeenCalled()

    procMock.__emit('spawn')
    expect(procMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'start' })
    )

    // Завершить promise чтобы тест не висел
    const args = procMock.postMessage.mock.calls[0][0] as { outputPath: string }
    await fs.writeFile(args.outputPath, 'fake-wav-bytes')
    procMock.__emit('exit', 0)
    await p
  })
})

describe('MediaExtractor.startExtract — cancel', () => {
  it('cancel(jobId) → cancelled=true → exit любой → Result cancelled', async () => {
    const extractor = await freshExtractor()
    const electron = await import('electron')

    let capturedJobId = ''
    const onProgress = vi.fn((e: { jobId: string }) => {
      if (!capturedJobId) capturedJobId = e.jobId
    })

    const p = extractor.startExtract(realInputPath, 10, onProgress)
    await flushAsync()
    expect(capturedJobId).not.toBe('')
    const forkMock = getForkMock(electron)

    const procMock = forkMock.mock.results[forkMock.mock.results.length - 1].value as ForkMock
    procMock.__emit('spawn')

    const args = procMock.postMessage.mock.calls[0][0] as { outputPath: string }
    await fs.writeFile(args.outputPath, 'partial')

    const cancelResult = extractor.cancel(capturedJobId)
    expect(cancelResult).toEqual({ ok: true })
    expect(procMock.kill).toHaveBeenCalled()

    procMock.__emit('exit', 1)
    const result = await p
    expect(result).toEqual({ ok: false, reason: 'cancelled' })

    // .tmp удалён (unlink — fire-and-forget, дождаться microtask)
    await flushAsync()
    await expect(fs.access(args.outputPath)).rejects.toThrow()
  })

  it('cancel неизвестного jobId → invalid_argument', async () => {
    const extractor = await freshExtractor()
    expect(extractor.cancel('unknown-job-id')).toEqual({
      ok: false,
      reason: 'invalid_argument'
    })
  })
})

describe('MediaExtractor.startExtract — failure modes', () => {
  it('exit code 1 + не cancelled → ffmpeg_failed', async () => {
    const extractor = await freshExtractor()
    const electron = await import('electron')
    const p = extractor.startExtract(realInputPath, 10, () => {})
    await flushAsync()
    const forkMock = getForkMock(electron)
    const procMock = forkMock.mock.results[forkMock.mock.results.length - 1].value as ForkMock
    procMock.__emit('spawn')
    procMock.__emit('exit', 1)
    const r = await p
    expect(r).toEqual({ ok: false, reason: 'ffmpeg_failed' })
  })

  it('relative path → invalid_argument (T-02-02-01 mitigation)', async () => {
    const extractor = await freshExtractor()
    const r = await extractor.startExtract('relative/path.mp4', 5, () => {})
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('не существующий путь → file_not_found', async () => {
    const extractor = await freshExtractor()
    const absent = process.platform === 'win32' ? 'C:\\nonexistent-xyz.mp4' : '/nonexistent-xyz.mp4'
    const r = await extractor.startExtract(absent, 5, () => {})
    expect(r).toEqual({ ok: false, reason: 'file_not_found' })
  })
})

describe('MediaExtractor.startExtract — cache hit (D-12)', () => {
  it('если <hash>.wav уже существует и size>0 — resolve мгновенно БЕЗ fork', async () => {
    const extractor = await freshExtractor()
    const electron = await import('electron')

    // Вычислим hash руками: sha1(absPath:size:mtimeMs)
    const stat = await fs.stat(realInputPath)
    const { createHash } = await import('node:crypto')
    const hash = createHash('sha1')
      .update(`${realInputPath}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex')
    const finalPath = join(EXTRACTED, `${hash}.wav`)
    await fs.writeFile(finalPath, 'pre-existing-wav-bytes')

    const forkMock = getForkMock(electron)
    forkMock.mockClear()

    const r = await extractor.startExtract(realInputPath, 10, () => {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data!.audioPath).toBe(finalPath)
    expect(forkMock).not.toHaveBeenCalled()
  })
})

describe('MediaExtractor.probe', () => {
  it('relative path → invalid_argument', async () => {
    const extractor = await freshExtractor()
    const r = await extractor.probe('relative.mp4')
    expect(r).toEqual({ ok: false, reason: 'invalid_argument' })
  })

  it('несуществующий путь → file_not_found', async () => {
    const extractor = await freshExtractor()
    const absent = process.platform === 'win32' ? 'C:\\nope.mp4' : '/nope.mp4'
    const r = await extractor.probe(absent)
    expect(r).toEqual({ ok: false, reason: 'file_not_found' })
  })
})
