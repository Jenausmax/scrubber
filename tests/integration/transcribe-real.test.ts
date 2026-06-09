// TRANS-01 (gated integration): реальный whisper-cli транскрибирует короткий WAV офлайн.
//
// Gating (зеркало extract-real.test.ts): кейс реального прогона выполняется ТОЛЬКО когда
// одновременно присутствуют (a) whisper-cli бинарник в resources/whisper/<platform-arch>/,
// (b) ggml-модель (small или medium — НЕ бандлятся, кладёт человек/03-03), (c) WAV-фикстура.
// Если чего-то нет — кейс skip (а не fail на отсутствии модели).
//
// Полный pipeline через utilityProcess.fork требует Electron-рантайма; здесь — прямой
// вызов whisper-cli через child_process на короткой WAV-фикстуре + чтение -oj JSON.
//
// КАЧЕСТВО русского (отсутствие галлюцинаций на тишине) проверяется человеком на
// human-verify чекпоинте 03-02 (TRANS-03 manual UAT) — автоматически WER не оцениваем.
//
// Источник: 03-RESEARCH.md §Validation Architecture (TRANS-01), extract-real.test.ts (эталон gating).

import { describe, it, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as os from 'node:os'
import { buildTranscribeArgs } from '../../src/main/utilities/whisper-args'
import { buildExtractArgs } from '../../src/main/utilities/ffmpeg-args'
import { resolveFfmpeg } from '../../src/main/services/ffmpeg-paths'

const WHISPER_DIR = resolve(
  __dirname,
  '..',
  '..',
  'resources',
  'whisper',
  `${process.platform}-${process.arch}`
)
const WHISPER_CLI = join(
  WHISPER_DIR,
  process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
)
const HAS_WHISPER = existsSync(WHISPER_CLI)

// Модели НЕ бандлятся (CLAUDE.md). Человек кладёт ggml-small.bin/ggml-medium.bin
// рядом с бинарником ИЛИ задаёт SCRUBBER_TEST_MODEL; в node-vitest userData мокается на tmp.
const MODEL_CANDIDATES = [
  process.env.SCRUBBER_TEST_MODEL,
  join(WHISPER_DIR, 'ggml-small.bin'),
  join(WHISPER_DIR, 'ggml-medium.bin')
].filter((p): p is string => typeof p === 'string' && p.length > 0)
const MODEL_PATH = MODEL_CANDIDATES.find((p) => existsSync(p))
const HAS_MODEL = typeof MODEL_PATH === 'string'

// WAV-фикстура: извлекаем из tests/fixtures/media/short.mp4 (Phase 2 фикстура) в tmp.
const FIXTURES_DIR = resolve(__dirname, '..', 'fixtures', 'media')
const SHORT_MP4 = join(FIXTURES_DIR, 'short.mp4')
const TMP_WAV = join(os.tmpdir(), 'scrubber-test-transcribe', 'fixture-16k.wav')

const CAN_RUN_REAL = HAS_WHISPER && HAS_MODEL

/** spawn с захватом exit code + stderr. */
function spawnCapture(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString('utf8')))
    child.on('error', rej)
    child.on('close', (code) => res({ code: code ?? -1, stderr }))
  })
}

beforeAll(async () => {
  if (!CAN_RUN_REAL) return
  await fs.mkdir(join(os.tmpdir(), 'scrubber-test-transcribe'), { recursive: true })
  if (!existsSync(TMP_WAV) && existsSync(SHORT_MP4)) {
    await spawnCapture(resolveFfmpeg(), buildExtractArgs(SHORT_MP4, TMP_WAV))
  }
}, 90_000)

describe('transcribe-real (TRANS-01, gated)', () => {
  // Контрактный кейс: всегда выполняется — args корректны независимо от бинарника/модели.
  it('buildTranscribeArgs даёт -l ru + -f <wav> для реального вызова', () => {
    const args = buildTranscribeArgs({
      modelPath: join(WHISPER_DIR, 'ggml-small.bin'),
      audioPath: TMP_WAV,
      language: 'ru',
      vadModelPath: null,
      threads: 4
    })
    expect(args).toContain('-l')
    expect(args).toContain('ru')
    expect(args).toContain('-f')
  })

  // Реальный whisper-прогон: skip пока нет бинарника+модели (GREEN при наличии — человек
  // кладёт модель на чекпоинте). Проверяем: exit 0, -oj JSON создан, transcription существует.
  it.skipIf(!CAN_RUN_REAL)(
    'whisper-cli офлайн прогоняет WAV → exit 0 + валидный -oj JSON',
    async () => {
      expect(existsSync(TMP_WAV)).toBe(true)
      const args = buildTranscribeArgs({
        modelPath: MODEL_PATH as string,
        audioPath: TMP_WAV,
        language: 'ru',
        vadModelPath: null,
        threads: 4
      })
      const { code, stderr } = await spawnCapture(WHISPER_CLI, args)
      expect(code, `whisper-cli stderr:\n${stderr}`).toBe(0)
      const jsonPath = `${TMP_WAV}.json`
      expect(existsSync(jsonPath)).toBe(true)
      const parsed = JSON.parse(await fs.readFile(jsonPath, 'utf8')) as {
        transcription?: unknown
      }
      expect(Array.isArray(parsed.transcription)).toBe(true)
    },
    120_000
  )
})
