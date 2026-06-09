// Singleton-сервис транскрипции: единственный владелец whisper utility-процессов
// и авто-сохранения transcript.md в userData (TRANS-01/05/06/07, ядро ценности).
//
// Источник: 03-PATTERNS.md §transcriber.ts (36-130) — зеркало media-extractor.ts;
// 03-RESEARCH.md §Architecture Patterns (218-246), §segment + progress parsing (403-418),
// §-oj JSON авторитет (216, 375); 03-CONTEXT.md D-04/D-06/D-12/D-13.
//
// КОНТРАКТ (зеркало MediaExtractor):
//   - init(): mkdir <userData>/models, assertBinaryExists(whisper-cli), ensureExecutable. Idempotent.
//   - startTranscribe(audioPath, {model, language}):
//       a) isAbsolute(audioPath) (path-traversal gate);
//       b) resolveModel(model) + assertModelExists → reason 'model_missing' (Gap 3, D-09);
//       c) ПОВТОРНЫЙ assertBinaryExists(whisper-cli) ПЕРЕД fork → reason 'internal';
//       d) emit progress 0% синхронно ДО подписки (renderer связывает jobId до cancel);
//       e) utilityProcess.fork(whisper-runner.cjs), on('spawn') → postMessage {type:'start', ...};
//       f) on('message'): progress → emitProgress; segment → emitSegment; done → stderrTail+jsonPath;
//       g) on('exit'): cancelled → reason 'cancelled' (D-13: партиал не удаляем);
//          code≠0 → reason 'whisper_failed' + лог stderrTail;
//          code0 → читать <audio>.json (-oj) → segments → buildTranscriptMd → авто-save .md → ok.
//   - cancel(jobId): не в Map → invalid_argument; иначе SIGTERM (proc.kill) → exit резолвит cancelled.
//   - Никаких throw через границу IPC — всё через Result.

import { app, BrowserWindow, utilityProcess } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { cpus } from 'node:os'
import {
  Channels,
  type Result,
  type TranscribeReason,
  type TranscribeStartResult
} from '../../shared/ipc'
import {
  assertBinaryExists,
  assertModelExists,
  ensureExecutable,
  resolveModel,
  resolveVadModel,
  resolveWhisperCli
} from './whisper-paths'
import { buildTranscriptMd, type TranscriptSegment } from './transcript-builder'

const LOG_PREFIX = '[services/transcriber]'

export interface StartTranscribeOpts {
  model: string
  language: string
}

interface JobHandle {
  jobId: string
  proc: Electron.UtilityProcess
  cancelled: boolean
  stderrTail: string
  jsonPath: string | null
}

function mapFsErr(err: unknown): TranscribeReason {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'audio_not_found'
  if (code === 'ENOSPC') return 'disk_full'
  return 'internal'
}

/** Длительность из последнего сегмента (ms) → `ЧЧ:ММ:СС`. */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

/**
 * Читает авторитетный <audio>.json (whisper-cli -oj) → массив сегментов.
 * Формат whisper.cpp: { transcription: [{ offsets: { from, to }, text }, ...] }.
 * from/to — миллисекунды. Нечитаемый/пустой JSON → пустой массив (валидно для тишины).
 */
async function readSegmentsFromJson(
  jsonPath: string
): Promise<{ segments: TranscriptSegment[]; durationMs: number }> {
  let raw: string
  try {
    raw = await fs.readFile(jsonPath, 'utf8')
  } catch {
    return { segments: [], durationMs: 0 }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { segments: [], durationMs: 0 }
  }
  const arr = (parsed as { transcription?: unknown }).transcription
  if (!Array.isArray(arr)) return { segments: [], durationMs: 0 }
  const segments: TranscriptSegment[] = []
  let durationMs = 0
  for (const item of arr) {
    const o = item as { offsets?: { from?: number; to?: number }; text?: string }
    const startMs = typeof o.offsets?.from === 'number' ? o.offsets.from : 0
    const toMs = typeof o.offsets?.to === 'number' ? o.offsets.to : startMs
    const text = typeof o.text === 'string' ? o.text.trim() : ''
    if (toMs > durationMs) durationMs = toMs
    segments.push({ startMs, text })
  }
  return { segments, durationMs }
}

export class Transcriber {
  private jobs = new Map<string, JobHandle>()
  private modelsDir = ''
  private initialised = false

  async init(): Promise<void> {
    if (this.initialised) return
    this.modelsDir = join(app.getPath('userData'), 'models')
    await fs.mkdir(this.modelsDir, { recursive: true })
    const cliPath = resolveWhisperCli()
    // Gap 3: fail-fast если asarUnpack сломан/бинарник не распакован — ДО ensureExecutable.
    assertBinaryExists(cliPath, 'whisper-cli')
    await ensureExecutable(cliPath)
    this.initialised = true
  }

  /**
   * Неблокирующий старт whisper-job (TRANS-06: fork, не sync spawn в main).
   * onProgress/onSegment — опциональные callback'и для unit-тестов (заменяют webContents.send).
   */
  async startTranscribe(
    audioPath: string,
    opts: StartTranscribeOpts,
    onProgress?: (e: { jobId: string; percent: number }) => void,
    onSegment?: (e: { jobId: string; startMs: number; text: string }) => void
  ): Promise<Result<TranscribeStartResult>> {
    // Path-traversal gate (T-3-03 mitigation).
    if (!isAbsolute(audioPath)) {
      return { ok: false, reason: 'invalid_argument' }
    }

    const modelPath = resolveModel(opts.model)
    // Gap 3 / D-09: модель отсутствует → reason 'model_missing' (UI отсылает в Settings).
    try {
      assertModelExists(modelPath)
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} model missing:`, err)
      return { ok: false, reason: 'model_missing' }
    }

    const cliPath = resolveWhisperCli()
    // Gap 3: бинарник мог исчезнуть после init() (init-throw проглатывается в index.ts).
    // Проверяем ПЕРЕД fork — иначе spawn-ENOENT воркера дойдёт как exit≠0 → whisper_failed.
    try {
      assertBinaryExists(cliPath, 'whisper-cli')
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} whisper-cli binary missing before fork:`, err)
      return { ok: false, reason: 'internal' }
    }

    // VAD-модель опциональна — если файла нет, транскрибируем без VAD (с предупреждением).
    const vadPath = resolveVadModel()
    let vadModelPath: string | null = null
    try {
      await fs.access(vadPath)
      vadModelPath = vadPath
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`${LOG_PREFIX} VAD model not found at ${vadPath} — transcribing without --vad`)
    }

    const threads = Math.max(1, Math.min(8, cpus().length))
    const jobId = randomUUID()
    const language = opts.language
    const model = opts.model

    // utility-script бандлится esbuild'ом в out/main/whisper-runner.cjs (package.json build:utilities).
    const scriptPath = join(__dirname, 'whisper-runner.cjs')

    const proc = utilityProcess.fork(scriptPath, [], {
      serviceName: 'scrubber-whisper',
      stdio: 'pipe'
    })
    // eslint-disable-next-line no-console
    console.error(
      `${LOG_PREFIX} fork whisper-runner jobId=${jobId} cliPath=${cliPath} modelPath=${modelPath} audioPath=${audioPath} language=${language} vad=${vadModelPath ?? '<none>'}`
    )

    const emitProgress = (percent: number): void => {
      const payload = { jobId, percent }
      if (onProgress) onProgress(payload)
      else BrowserWindow.getAllWindows()[0]?.webContents.send(Channels.TRANSCRIBE_PROGRESS, payload)
    }
    const emitSegment = (startMs: number, text: string): void => {
      const payload = { jobId, startMs, text }
      if (onSegment) onSegment(payload)
      else BrowserWindow.getAllWindows()[0]?.webContents.send(Channels.TRANSCRIBE_SEGMENT, payload)
    }
    // Синхронно ДО подписки — renderer связывает jobId с UI до любого cancel (D-12).
    emitProgress(0)

    return new Promise<Result<TranscribeStartResult>>((resolve) => {
      const handle: JobHandle = { jobId, proc, cancelled: false, stderrTail: '', jsonPath: null }
      this.jobs.set(jobId, handle)
      let settled = false
      const settle = (r: Result<TranscribeStartResult>): void => {
        if (settled) return
        settled = true
        resolve(r)
      }

      // V8-FatalError воркера — НЕ whisper-exit-code; не маскируем под whisper_failed.
      proc.on('error', (type: 'FatalError', location: string): void => {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} utility-process fatal error jobId=${jobId}: ${type} @ ${location}`)
        settle({ ok: false, reason: 'internal' })
      })

      proc.on('spawn', () => {
        proc.postMessage({
          type: 'start',
          cliPath,
          modelPath,
          vadModelPath,
          audioPath,
          language,
          threads
        })
      })

      proc.on(
        'message',
        (msg: {
          type?: string
          percent?: number
          startMs?: number
          text?: string
          stderrTail?: string
          jsonPath?: string
          message?: string
        }) => {
          if (!msg) return
          if (msg.type === 'progress') {
            emitProgress(typeof msg.percent === 'number' ? msg.percent : 0)
            return
          }
          if (msg.type === 'segment') {
            emitSegment(
              typeof msg.startMs === 'number' ? msg.startMs : 0,
              typeof msg.text === 'string' ? msg.text : ''
            )
            return
          }
          if (msg.type === 'done') {
            const h = this.jobs.get(jobId)
            if (h) {
              if (typeof msg.stderrTail === 'string') h.stderrTail = msg.stderrTail
              if (typeof msg.jsonPath === 'string') h.jsonPath = msg.jsonPath
            }
            return
          }
          if (msg.type === 'error') {
            // eslint-disable-next-line no-console
            console.error(`${LOG_PREFIX} worker spawn error jobId=${jobId}: ${msg.message}`)
          }
        }
      )

      proc.on('exit', (code: number | null) => {
        const h = this.jobs.get(jobId)
        this.jobs.delete(jobId)
        // D-13: при cancelled НЕ удаляем накопленное — частичный результат ценен (генерация
        // частичного .md делается в 03-04). Здесь просто settle cancelled.
        if (h?.cancelled) {
          settle({ ok: false, reason: 'cancelled' })
          return
        }
        if (code !== 0) {
          // eslint-disable-next-line no-console
          console.error(
            `${LOG_PREFIX} whisper exit code ${code} jobId=${jobId}\n` +
              `${LOG_PREFIX} whisper stderr tail:\n${h?.stderrTail || '<empty>'}`
          )
          settle({ ok: false, reason: 'whisper_failed' })
          return
        }
        // code 0 → читать -oj JSON → собрать + авто-сохранить transcript.md.
        const jsonPath = h?.jsonPath ?? `${audioPath}.json`
        void this.finishTranscript(jsonPath, audioPath, model, language, jobId)
          .then(settle)
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error(`${LOG_PREFIX} finishTranscript failed jobId=${jobId}:`, err)
            settle({ ok: false, reason: mapFsErr(err) })
          })
      })
    })
  }

  /**
   * Читает авторитетный JSON, собирает .md через transcript-builder и авто-сохраняет
   * в userData/models/../<hash>.transcript.md (.tmp→rename, D-04). Возвращает Result с
   * mdPath/text/segments для немедленного показа в renderer.
   */
  private async finishTranscript(
    jsonPath: string,
    audioPath: string,
    model: string,
    language: string,
    jobId: string
  ): Promise<Result<TranscribeStartResult>> {
    const { segments, durationMs } = await readSegmentsFromJson(jsonPath)
    const source = basename(audioPath)
    const md = buildTranscriptMd({
      meta: {
        source,
        model,
        language,
        duration: formatDuration(durationMs),
        date: new Date().toISOString().slice(0, 10)
      },
      segments,
      timestamps: false
    })

    // Авто-сохранение рядом с аудио в userData (D-04). Имя — детерминированный hash
    // от audioPath, чтобы повторная транскрипция перезаписывала тот же файл.
    const dir = join(app.getPath('userData'), 'transcripts')
    await fs.mkdir(dir, { recursive: true })
    const hash = createHash('sha1').update(audioPath).digest('hex')
    const mdPath = join(dir, `${hash}.transcript.md`)
    const tmpPath = `${mdPath}.tmp`
    await fs.writeFile(tmpPath, md, 'utf8')
    await fs.rename(tmpPath, mdPath)

    // eslint-disable-next-line no-console
    console.error(`${LOG_PREFIX} transcript saved jobId=${jobId} mdPath=${mdPath} segments=${segments.length}`)

    return { ok: true, data: { jobId, mdPath, text: md, segments } }
  }

  /** TRANS-05: SIGTERM в utility-процесс → reason 'cancelled' на exit. */
  async cancel(jobId: string): Promise<Result> {
    const h = this.jobs.get(jobId)
    if (!h) return { ok: false, reason: 'invalid_argument' }
    h.cancelled = true
    h.proc.kill() // SIGTERM (D-13)
    return { ok: true }
  }
}

/** Singleton: единственный владелец whisper utility-процессов и transcript-кеша. */
export const transcriber = new Transcriber()
