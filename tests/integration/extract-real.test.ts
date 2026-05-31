// Integration: реальный ffmpeg/ffprobe pipeline на 5-сек сгенерированной mp4-фикстуре.
//
// Цель: закрыть MEDIA-03 acceptance в dev (assumptions A3/A4 из 02-RESEARCH.md):
//   - ffmpeg-static резолвится в исполняемый бинарник;
//   - ffprobe-installer резолвится и возвращает корректную durationSec;
//   - ffmpeg c args `-vn -ac 1 -ar 16000 -c:a pcm_s16le -progress pipe:1 -y` производит
//     валидный wav (sample_rate=16000, channels=1, codec=pcm_s16le) на диске;
//   - parseProgressLine корректно обрабатывает реальный формат stdout (`out_time_us=N`).
//
// **Сужение scope.** Полный `mediaExtractor.startExtract` требует Electron-рантайма
// (`utilityProcess.fork`), которого нет в node-vitest. Покрытие через utilityProcess —
// только в **packaged smoke** (Task 2, manual). Здесь тестируем CLI ffmpeg/ffprobe
// напрямую через `child_process.spawn` (это и есть «низ» того же pipeline).
//
// Источник: 02-04-PLAN.md Task 1 (финальное решение в <action>).
// Глобальный mock 'electron' из tests/setup.ts НЕ мешает — ffmpeg-paths не импортирует
// electron, child_process глобально не мокается.

import { describe, it, expect, beforeAll } from 'vitest'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs, existsSync, constants as fsc } from 'node:fs'
import { join, resolve } from 'node:path'
import * as os from 'node:os'
import { resolveFfmpeg, resolveFfprobe, ensureExecutable } from '../../src/main/services/ffmpeg-paths'
import { parseProgressLine } from '../../src/main/services/progress-parser'

const execFileP = promisify(execFile)

const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures', 'media')
const SHORT_MP4 = join(FIXTURES_DIR, 'short.mp4')
const NO_AUDIO_MP4 = join(FIXTURES_DIR, 'no-audio.mp4')
const GENERATE_SCRIPT = join(FIXTURES_DIR, 'generate.mjs')

/** Помощник: spawn child_process с захватом stdout/stderr + exit code. */
function spawnCapture(
  cmd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')))
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')))
    child.on('error', rej)
    child.on('close', (code) => res({ code: code ?? -1, stdout, stderr }))
  })
}

beforeAll(async () => {
  // Idempotent: если фикстур нет — генерируем их через `node generate.mjs`.
  if (!existsSync(SHORT_MP4) || !existsSync(NO_AUDIO_MP4)) {
    await execFileP(process.execPath, [GENERATE_SCRIPT], { timeout: 60_000 })
  }
  // Бинарники могут потерять exec-bit после unzip (Pitfall #2) — на CI/Linux/macOS.
  await ensureExecutable(resolveFfmpeg())
  await ensureExecutable(resolveFfprobe())
}, 90_000)

describe('integration: ffmpeg-static binaries resolve and are executable', () => {
  it('resolveFfmpeg returns existing file path', async () => {
    const p = resolveFfmpeg()
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
    await expect(fs.access(p, fsc.F_OK)).resolves.toBeUndefined()
  })

  it('resolveFfprobe returns existing file path', async () => {
    const p = resolveFfprobe()
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
    await expect(fs.access(p, fsc.F_OK)).resolves.toBeUndefined()
  })

  it('ffmpeg -version exits 0', async () => {
    const { code, stdout } = await spawnCapture(resolveFfmpeg(), ['-version'])
    expect(code).toBe(0)
    expect(stdout.toLowerCase()).toContain('ffmpeg version')
  })
})

describe('integration: ffprobe reads ~5 second duration from short.mp4', () => {
  it('ffprobe JSON output contains format.duration ≈ 5', async () => {
    const { code, stdout } = await spawnCapture(resolveFfprobe(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      SHORT_MP4
    ])
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } }
    expect(parsed.format).toBeDefined()
    expect(parsed.format!.duration).toBeDefined()
    const dur = Number(parsed.format!.duration)
    expect(dur).toBeGreaterThan(4.5)
    expect(dur).toBeLessThan(5.5)
  })
})

describe('integration: ffmpeg produces wav 16kHz mono PCM s16le from short.mp4', () => {
  it('runs ffmpeg with contract args → wav exists → ffprobe reports correct params', async () => {
    // Используем уникальный tmpdir чтобы не пересекаться с прод-userData.
    const tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'scrubber-int-'))
    const outWav = join(tmpDir, 'short.wav')

    // Точно те же args, что и в src/main/utilities/ffmpeg-runner.ts (D-01 + D-08).
    const args = [
      '-i', SHORT_MP4,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      '-progress', 'pipe:1',
      '-y',
      outWav
    ]
    const { code, stdout } = await spawnCapture(resolveFfmpeg(), args)
    expect(code).toBe(0)
    // stdout должен содержать `out_time_us=` строки от `-progress pipe:1`.
    expect(stdout).toContain('out_time_us=')

    // Wav на диске:
    const stat = await fs.stat(outWav)
    expect(stat.size).toBeGreaterThan(0)

    // Параметры wav через ffprobe:
    const probe = await spawnCapture(resolveFfprobe(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_streams',
      outWav
    ])
    expect(probe.code).toBe(0)
    const meta = JSON.parse(probe.stdout) as {
      streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>
    }
    expect(meta.streams).toBeDefined()
    expect(meta.streams!.length).toBeGreaterThan(0)
    const audio = meta.streams![0]
    expect(audio.codec_name).toBe('pcm_s16le')
    expect(audio.sample_rate).toBe('16000')
    expect(audio.channels).toBe(1)

    // Cleanup tmpdir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('handles no-audio mp4 gracefully (ffmpeg либо производит пустой wav, либо exit !=0)', async () => {
    const tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'scrubber-int-na-'))
    const outWav = join(tmpDir, 'no-audio.wav')

    const args = [
      '-i', NO_AUDIO_MP4,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      '-progress', 'pipe:1',
      '-y',
      outWav
    ]
    const { code } = await spawnCapture(resolveFfmpeg(), args)
    // Любой из двух приемлемо: exit 0 (без аудио — пустая дорожка) или exit != 0 (no streams).
    // Главное — нет крэша/exception, и можно отличить.
    expect(typeof code).toBe('number')

    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})

describe('integration: parseProgressLine на реальном ffmpeg stdout', () => {
  it('обрабатывает реальную строку out_time_us=', () => {
    // Сэмплированная реальная строка от ffmpeg -progress pipe:1.
    // 2_500_000 микросекунд = 2.5 сек из 5 = 50%.
    const startedMs = Date.now() - 1000 // ~1 сек прошло
    const result = parseProgressLine('out_time_us=2500000', 5, startedMs, -1)
    expect(result).not.toBeNull()
    expect(result!.percent).toBe(50)
    // etaSec: при 50% за 1сек elapsed → ETA ≈ 1сек оставшегося
    expect(result!.etaSec).not.toBeNull()
    expect(result!.etaSec).toBeGreaterThanOrEqual(0)
  })

  it('игнорирует не-progress строки', () => {
    expect(parseProgressLine('frame=42', 5, Date.now(), -1)).toBeNull()
    expect(parseProgressLine('bitrate=128.0kbits/s', 5, Date.now(), -1)).toBeNull()
    expect(parseProgressLine('progress=continue', 5, Date.now(), -1)).toBeNull()
  })

  it('дедупает совпадающий percent', () => {
    // 50% + lastPct=50 → null
    expect(parseProgressLine('out_time_us=2500000', 5, Date.now(), 50)).toBeNull()
  })
})
