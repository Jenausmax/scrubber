// Singleton-сервис: единственный владелец utility-процессов ffmpeg и кеша wav в userData.
//
// Источник: 02-RESEARCH.md §Pattern 3 / §Pattern 6 / §Security Domain,
// 02-PATTERNS.md §src/main/services/media-extractor.ts,
// 02-CONTEXT.md D-09 (cancel SIGTERM + удаление .tmp), D-10 (один job за раз),
// D-11 (hash = sha1(absPath:size:mtimeMs)), D-12 (cache-hit short-circuit),
// D-16 (reason-коды), D-17 (utilityProcess.fork).
//
// КОНТРАКТ:
//   - init(): создаёт <userData>/extracted/, вызывает ensureExecutable(ffmpeg/ffprobe).
//     Idempotent (повторный init — no-op).
//   - probe(absPath): short-lived child_process.spawn(ffprobe), JSON-parse, Result.
//   - startExtract(absPath, durationSec):
//       a) validate isAbsolute (T-02-02-01 mitigation);
//       b) hash = sha1(absPath:size:mtimeMs), cacheDir/<hash>.wav;
//       c) cache-hit (size>0) → resolve без fork (D-12);
//       d) utilityProcess.fork(ffmpeg-runner.cjs), сразу emit progress {percent:0}
//          ДО потребления stdout — гарантирует, что renderer получает jobId
//          ДО любой попытки cancel (D-09);
//       e) на event 'spawn' → postMessage({type:'start', ...});
//       f) на event 'message' type='progress' → webContents.send MEDIA_PROGRESS;
//       g) exit code 0 → rename tmp→final, Result ok;
//          code != 0 + не cancelled → unlink tmp, Result ffmpeg_failed;
//          cancelled → unlink tmp, Result cancelled.
//   - cancel(jobId): не в Map → invalid_argument; иначе cancelled=true + proc.kill() (SIGTERM).
//   - Никаких throw через границу IPC — всё через Result.

import { app, BrowserWindow, utilityProcess } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import {
  Channels,
  type MediaExtractResult,
  type MediaProbeResult,
  type MediaReason,
  type Result
} from '../../shared/ipc'
import { ensureExecutable, resolveFfmpeg, resolveFfprobe } from './ffmpeg-paths'

const LOG_PREFIX = '[services/media-extractor]'

interface JobHandle {
  jobId: string
  proc: Electron.UtilityProcess
  outPath: string
  cancelled: boolean
}

/**
 * Hash для кеш-ключа (D-11). НЕ для безопасности — sha1 здесь не криптогарант,
 * а быстрый дедуп по тройке absPath:size:mtimeMs (см. RESEARCH §Security Domain V6).
 */
function hashFor(absPath: string, size: number, mtimeMs: number): string {
  return createHash('sha1').update(`${absPath}:${size}:${mtimeMs}`).digest('hex')
}

function mapFsErr(err: unknown): MediaReason {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'file_not_found'
  if (code === 'EACCES' || code === 'EPERM') return 'file_not_found'
  if (code === 'ENOSPC') return 'disk_full'
  return 'internal'
}

export class MediaExtractor {
  private jobs = new Map<string, JobHandle>()
  private cacheDir = ''
  private initialised = false

  async init(): Promise<void> {
    if (this.initialised) return
    this.cacheDir = join(app.getPath('userData'), 'extracted')
    await fs.mkdir(this.cacheDir, { recursive: true })
    // D-18: chmod 0o755 для ffmpeg/ffprobe на Linux/macOS (Pitfall #2)
    await ensureExecutable(resolveFfmpeg())
    await ensureExecutable(resolveFfprobe())
    this.initialised = true
  }

  /**
   * Короткоживущий ffprobe → JSON-метаданные mp4.
   * Source: RESEARCH §Pattern 6 (spawn из main допустим для коротких процессов).
   */
  async probe(absPath: string): Promise<Result<MediaProbeResult>> {
    if (!isAbsolute(absPath)) {
      return { ok: false, reason: 'invalid_argument' }
    }
    try {
      // Проверяем файл сначала — иначе ffprobe-error будет менее точным
      const stat = await fs.stat(absPath)
      const sizeBytes = stat.size
      const probePath = resolveFfprobe()
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        absPath
      ]
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(probePath, args, { windowsHide: true })
        let buf = ''
        let errBuf = ''
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (c: string) => {
          buf += c
        })
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (c: string) => {
          errBuf = (errBuf + c).slice(-2000)
        })
        child.on('error', (err) => reject(err))
        child.on('exit', (code) => {
          if (code === 0) resolve(buf)
          else reject(new Error(`ffprobe exit ${code}: ${errBuf}`))
        })
      })
      const parsed = JSON.parse(stdout) as {
        format?: { duration?: string; size?: string }
      }
      const durationSec = Number(parsed.format?.duration ?? '0')
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        return { ok: false, reason: 'ffmpeg_failed' }
      }
      return {
        ok: true,
        data: {
          durationSec,
          sizeBytes,
          name: basename(absPath)
        }
      }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} probe failed for ${absPath}:`, err)
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
        return { ok: false, reason: 'file_not_found' }
      }
      return { ok: false, reason: 'ffmpeg_failed' }
    }
  }

  /**
   * Старт ffmpeg-job. Renderer получает прогресс через webContents.send MEDIA_PROGRESS.
   * onProgress — опциональный callback для unit-тестов (заменяет webContents.send).
   */
  async startExtract(
    absPath: string,
    durationSec: number,
    onProgress?: (e: { jobId: string; percent: number; etaSec: number | null }) => void
  ): Promise<Result<MediaExtractResult>> {
    // T-02-02-01 mitigation: path traversal — gate isAbsolute
    if (!isAbsolute(absPath)) {
      return { ok: false, reason: 'invalid_argument' }
    }
    let stat
    try {
      stat = await fs.stat(absPath)
    } catch (err: unknown) {
      return { ok: false, reason: mapFsErr(err) }
    }
    const hash = hashFor(absPath, stat.size, stat.mtimeMs)
    const finalPath = join(this.cacheDir, `${hash}.wav`)
    const tmpPath = `${finalPath}.tmp`

    // D-12: cache-hit short-circuit
    try {
      const finalStat = await fs.stat(finalPath)
      if (finalStat.size > 0) {
        const jobId = randomUUID()
        return { ok: true, data: { jobId, audioPath: finalPath } }
      }
    } catch {
      // нет файла → продолжаем fork
    }

    const jobId = randomUUID()
    const ffmpegPath = resolveFfmpeg()
    // utility-script бандлится esbuild'ом в out/main/ffmpeg-runner.cjs (см. package.json scripts.build:utilities)
    const scriptPath = join(__dirname, 'ffmpeg-runner.cjs')

    const proc = utilityProcess.fork(scriptPath, [], {
      serviceName: 'scrubber-ffmpeg',
      stdio: 'pipe'
    })

    // СРАЗУ синхронно (ДО подписки и ДО первого ffmpeg-фрейма) — emit initial progress 0%
    // с jobId, чтобы renderer связал jobId с UI ДО любой попытки cancel (D-09).
    const emitProgress = (percent: number, etaSec: number | null): void => {
      const payload = { jobId, percent, etaSec }
      if (onProgress) {
        onProgress(payload)
      } else {
        const win = BrowserWindow.getAllWindows()[0]
        win?.webContents.send(Channels.MEDIA_PROGRESS, payload)
      }
    }
    emitProgress(0, null)

    return new Promise<Result<MediaExtractResult>>((resolve) => {
      const handle: JobHandle = { jobId, proc, outPath: finalPath, cancelled: false }
      this.jobs.set(jobId, handle)

      proc.on('spawn', () => {
        proc.postMessage({
          type: 'start',
          ffmpegPath,
          inputPath: absPath,
          outputPath: tmpPath,
          durationSec
        })
      })

      proc.on('message', (msg: { type?: string; percent?: number; etaSec?: number | null }) => {
        if (msg && msg.type === 'progress') {
          const percent = typeof msg.percent === 'number' ? msg.percent : 0
          const etaSec = typeof msg.etaSec === 'number' ? msg.etaSec : null
          emitProgress(percent, etaSec)
        }
      })

      proc.on('exit', (code: number | null) => {
        const h = this.jobs.get(jobId)
        this.jobs.delete(jobId)
        if (h?.cancelled) {
          fs.unlink(tmpPath).catch(() => {})
          resolve({ ok: false, reason: 'cancelled' })
          return
        }
        if (code !== 0) {
          fs.unlink(tmpPath).catch(() => {})
          // eslint-disable-next-line no-console
          console.error(`${LOG_PREFIX} ffmpeg exit code ${code} for jobId ${jobId}`)
          resolve({ ok: false, reason: 'ffmpeg_failed' })
          return
        }
        fs.rename(tmpPath, finalPath).then(
          () => resolve({ ok: true, data: { jobId, audioPath: finalPath } }),
          (err) => {
            // eslint-disable-next-line no-console
            console.error(`${LOG_PREFIX} rename tmp→final failed:`, err)
            resolve({ ok: false, reason: mapFsErr(err) })
          }
        )
      })
    })
  }

  cancel(jobId: string): Result {
    const h = this.jobs.get(jobId)
    if (!h) return { ok: false, reason: 'invalid_argument' }
    h.cancelled = true
    h.proc.kill() // SIGTERM (D-09)
    return { ok: true }
  }
}

/** Singleton: единственный владелец utility-процессов ffmpeg и кеша wav в userData. */
export const mediaExtractor = new MediaExtractor()
