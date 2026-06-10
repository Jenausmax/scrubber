// TRANS-02 (GREEN, 03-03): ModelManager — скачивание whisper-моделей с SHA256-проверкой.
//
// КОНТРАКТ:
//   - list(): {name, sizeBytes, downloaded} для small/medium/large-v3 (downloaded = existsSync(resolveModel)).
//   - download(name): fetch(manifest URL, {signal}) → stream в userData/models/ggml-<name>.bin.tmp,
//     прогресс по Content-Length → emit MODELS_PROGRESS {name, percent}; по завершении
//     createHash('sha256') == манифест → rename .tmp→final, иначе unlink + reason 'sha_mismatch' (D-10).
//   - download cancel: AbortController.abort() + unlink .tmp → reason 'cancelled'; resume НЕ делается.
//   - сетевая ошибка → 'download_failed'; ENOSPC → 'disk_full'.
//   - delete(name): unlink ggml-<name>.bin; отсутствует → ok (идемпотентно).
//   - silero VAD при первом download основной модели: СНАЧАЛА ensureSilero() (existsSync(resolveVadModel)
//     ? noop : скачать+SHA как обычную запись манифеста), ЗАТЕМ основная модель; silero опционален —
//     его падение логируется и НЕ блокирует основную модель (transcriber передаёт vadModelPath=null).
//   - Никаких throw через границу IPC — всё через Result. LOG_PREFIX '[services/model-manager]'.
//
// Источник: 03-RESEARCH.md §Model Manifest (160-173), §Validation Architecture (TRANS-02);
//   03-PATTERNS.md §model-manager.ts; эталон media-extractor.ts (.tmp→rename, createHash, cancel-map).

import { BrowserWindow } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { Channels, type ModelReason, type Result } from '../../shared/ipc'
import { resolveModel, resolveVadModel } from './whisper-paths'

const LOG_PREFIX = '[services/model-manager]'

/** Имена whitelisted whisper-моделей (selectable пользователем). */
export const SELECTABLE_MODELS = ['small', 'medium', 'large-v3'] as const

const WHISPER_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'
const VAD_BASE = 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/'

export interface ModelManifestEntry {
  /** Имя файла на диске: ggml-<name>.bin. */
  file: string
  /** HTTPS URL (HuggingFace resolve/main/). */
  url: string
  /** Точный размер в байтах. */
  sizeBytes: number
  /** SHA256 содержимого файла (анти-коррупция, D-10). */
  sha256: string
}

export interface ModelInfo {
  name: string
  sizeBytes: number
  downloaded: boolean
}

export interface ModelManager {
  list(): Promise<Result<ModelInfo[]>>
  download(name: string): Promise<Result<{ jobId: string }>>
  cancel(jobId: string): Promise<Result>
  delete(name: string): Promise<Result>
}

/**
 * Манифест моделей (D-10). Значения сверены в 03-01 Task 3 с live HuggingFace
 * LFS-метаданными (X-Linked-Size / X-Linked-ETag) — 03-RESEARCH.md §Model Manifest.
 * URL строится ТОЛЬКО отсюда — никогда из renderer-строки (анти-SSRF, T-3-07).
 */
export const MODEL_MANIFEST: Record<string, ModelManifestEntry> = {
  small: {
    file: 'ggml-small.bin',
    url: `${WHISPER_BASE}ggml-small.bin`,
    sizeBytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
  },
  medium: {
    file: 'ggml-medium.bin',
    url: `${WHISPER_BASE}ggml-medium.bin`,
    sizeBytes: 1_533_763_059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'
  },
  'large-v3': {
    file: 'ggml-large-v3.bin',
    url: `${WHISPER_BASE}ggml-large-v3.bin`,
    sizeBytes: 3_095_033_483,
    sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
  },
  // silero VAD — крошечная (~885 kB), скачивается единообразно перед первой основной моделью.
  silero: {
    file: 'ggml-silero-v5.1.2.bin',
    url: `${VAD_BASE}ggml-silero-v5.1.2.bin`,
    sizeBytes: 885_098,
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf'
  }
}

interface DownloadJob {
  jobId: string
  name: string
  controller: AbortController
  tmpPath: string
}

function mapFetchErr(err: unknown): ModelReason {
  const e = err as { name?: string; code?: string }
  if (e?.name === 'AbortError') return 'cancelled'
  if (e?.code === 'ENOSPC') return 'disk_full'
  return 'download_failed'
}

class ModelManagerService {
  private jobs = new Map<string, DownloadJob>()

  async list(): Promise<Result<ModelInfo[]>> {
    try {
      const infos: ModelInfo[] = SELECTABLE_MODELS.map((name) => {
        const entry = MODEL_MANIFEST[name]
        return {
          name,
          sizeBytes: entry.sizeBytes,
          downloaded: existsSync(resolveModel(name))
        }
      })
      return { ok: true, data: infos }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} list failed:`, err)
      return { ok: false, reason: 'internal' }
    }
  }

  /**
   * Скачать одну запись манифеста в targetPath с прогрессом и SHA256-проверкой.
   * Возвращает ok | reason. AbortController — для cancel. emitName — имя в MODELS_PROGRESS.
   */
  private async fetchToFile(
    entry: ModelManifestEntry,
    targetPath: string,
    controller: AbortController,
    emitName: string
  ): Promise<Result> {
    const tmpPath = `${targetPath}.tmp`
    let res: Response
    try {
      res = await fetch(entry.url, { signal: controller.signal })
    } catch (err: unknown) {
      return { ok: false, reason: mapFetchErr(err) }
    }
    if (!res.ok || !res.body) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} fetch ${entry.url} → HTTP ${res.status}`)
      return { ok: false, reason: 'download_failed' }
    }

    const total = Number(res.headers.get('content-length') ?? entry.sizeBytes)
    const hash = createHash('sha256')
    const out = createWriteStream(tmpPath)
    let received = 0
    let lastPercent = -1

    const emitProgress = (percent: number): void => {
      if (percent === lastPercent) return
      lastPercent = percent
      const win = BrowserWindow.getAllWindows()[0]
      win?.webContents.send(Channels.MODELS_PROGRESS, { name: emitName, percent })
    }

    try {
      // res.body — WHATWG ReadableStream (Node 18+/Electron main).
      const reader = (res.body as ReadableStream<Uint8Array>).getReader()
      emitProgress(0)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          hash.update(value)
          received += value.byteLength
          await new Promise<void>((resolve, reject) => {
            out.write(value, (e) => (e ? reject(e) : resolve()))
          })
          if (total > 0) {
            emitProgress(Math.min(99, Math.floor((received / total) * 100)))
          }
        }
      }
      await new Promise<void>((resolve, reject) => out.end((e?: Error) => (e ? reject(e) : resolve())))
    } catch (err: unknown) {
      out.destroy()
      await fs.unlink(tmpPath).catch(() => {})
      const reason = mapFetchErr(err)
      if (reason === 'cancelled') return { ok: false, reason: 'cancelled' }
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} stream ${emitName} failed:`, err)
      return { ok: false, reason }
    }

    // SHA256-сверка ПЕРЕД использованием (D-10, T-3-08). Mismatch → unlink + sha_mismatch.
    const digest = hash.digest('hex')
    if (digest !== entry.sha256) {
      await fs.unlink(tmpPath).catch(() => {})
      // eslint-disable-next-line no-console
      console.error(
        `${LOG_PREFIX} sha mismatch for ${emitName}: expected ${entry.sha256}, got ${digest}`
      )
      return { ok: false, reason: 'sha_mismatch' }
    }

    try {
      await fs.rename(tmpPath, targetPath)
    } catch (err: unknown) {
      await fs.unlink(tmpPath).catch(() => {})
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} rename .tmp→final failed for ${emitName}:`, err)
      const code = (err as NodeJS.ErrnoException).code
      return { ok: false, reason: code === 'ENOSPC' ? 'disk_full' : 'internal' }
    }
    emitProgress(100)
    return { ok: true }
  }

  /**
   * silero VAD опционален: если уже на диске — noop; иначе пробуем скачать.
   * Падение НЕ блокирует основную модель (transcriber передаёт vadModelPath=null).
   */
  private async ensureSilero(controller: AbortController): Promise<void> {
    const vadPath = resolveVadModel()
    if (existsSync(vadPath)) return
    const r = await this.fetchToFile(MODEL_MANIFEST.silero, vadPath, controller, 'silero')
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} silero VAD download failed (non-blocking): ${r.reason}`)
    }
  }

  async download(name: string): Promise<Result<{ jobId: string }>> {
    const entry = MODEL_MANIFEST[name]
    // Запрашиваемое имя должно быть selectable-моделью (не silero, не мусор).
    if (!entry || !SELECTABLE_MODELS.includes(name as (typeof SELECTABLE_MODELS)[number])) {
      return { ok: false, reason: 'invalid_argument' }
    }

    const jobId = randomUUID()
    const controller = new AbortController()
    const targetPath = resolveModel(name)
    const job: DownloadJob = { jobId, name, controller, tmpPath: `${targetPath}.tmp` }
    this.jobs.set(jobId, job)

    try {
      await fs.mkdir(dirname(targetPath), { recursive: true })
      // Сначала обеспечить silero (опционально), затем основную модель.
      await this.ensureSilero(controller)
      const r = await this.fetchToFile(entry, targetPath, controller, name)
      this.jobs.delete(jobId)
      if (!r.ok) return r
      return { ok: true, data: { jobId } }
    } catch (err: unknown) {
      this.jobs.delete(jobId)
      await fs.unlink(job.tmpPath).catch(() => {})
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} download ${name} internal error:`, err)
      return { ok: false, reason: mapFetchErr(err) === 'cancelled' ? 'cancelled' : 'internal' }
    }
  }

  async cancel(jobId: string): Promise<Result> {
    const job = this.jobs.get(jobId)
    if (!job) return { ok: false, reason: 'invalid_argument' }
    job.controller.abort()
    await fs.unlink(job.tmpPath).catch(() => {})
    this.jobs.delete(jobId)
    return { ok: true }
  }

  async delete(name: string): Promise<Result> {
    if (!SELECTABLE_MODELS.includes(name as (typeof SELECTABLE_MODELS)[number])) {
      return { ok: false, reason: 'invalid_argument' }
    }
    try {
      await fs.unlink(resolveModel(name))
      return { ok: true }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      // Идемпотентно: отсутствует → ok.
      if (code === 'ENOENT') return { ok: true }
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} delete ${name} failed:`, err)
      return { ok: false, reason: 'internal' }
    }
  }
}

/** Singleton: единственный владелец download-job'ов и манифеста моделей. */
export const modelManager: ModelManager = new ModelManagerService()
