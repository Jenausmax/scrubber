// Резолв путей whisper-cli-бинарника и whisper/VAD-моделей + guards.
//
// Источник: 03-PATTERNS.md §whisper-paths.ts (202-221), 03-RESEARCH.md §Validation Architecture,
// CLAUDE.md (whisper-cli sidecar в resources/whisper/<platform-arch>/, модели в userData/models/),
// зеркало src/main/services/ffmpeg-paths.ts (assertBinaryExists / ensureExecutable дословно).
//
// КОНТРАКТ:
//   - resolveWhisperCli() — абсолютный путь к whisper-cli(.exe) в resources/whisper/<platform-arch>/.
//     В packaged: app.getAppPath()/resources/... с правкой app.asar → app.asar.unpacked (Pitfall #1).
//     В dev: тот же путь относительно repo-root (app.getAppPath() == repo root).
//   - resolveModel(name) / resolveVadModel() — пути в userData/models/ (модели скачиваются, НЕ бандлятся).
//   - assertBinaryExists / ensureExecutable — дословно из ffmpeg-paths.ts.
//   - assertModelExists — fail-fast с маркером для reason 'model_missing' (TRANS, D-09).

import { promises as fs, constants as fsc, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Подкаталог resources по платформе+архитектуре: win32-x64 / linux-x64 / darwin-arm64 ... */
function platformArchDir(): string {
  return `${process.platform}-${process.arch}`
}

/** Имя CLI-бинарника: whisper-cli.exe на Windows, whisper-cli на остальных. */
function whisperCliBinaryName(): string {
  return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

/**
 * Абсолютный путь к whisper-cli с правкой `app.asar → app.asar.unpacked` (Pitfall #1).
 * resources/whisper/<platform-arch>/whisper-cli(.exe).
 */
export function resolveWhisperCli(): string {
  const p = join(
    app.getAppPath(),
    'resources',
    'whisper',
    platformArchDir(),
    whisperCliBinaryName()
  )
  return p.replace('app.asar', 'app.asar.unpacked')
}

/**
 * Путь к ggml-модели в userData/models/ggml-<name>.bin.
 * Модели скачиваются по запросу (large-v3 ~3 ГБ), НЕ бандлятся (CLAUDE.md).
 */
export function resolveModel(name: string): string {
  return join(app.getPath('userData'), 'models', `ggml-${name}.bin`)
}

/**
 * Путь к silero VAD-модели в userData/models/ggml-silero-v5.1.2.bin
 * (885 kB, скачивается единообразно с whisper-моделями — 03-RESEARCH.md §Model Manifest).
 */
export function resolveVadModel(): string {
  return join(app.getPath('userData'), 'models', 'ggml-silero-v5.1.2.bin')
}

/**
 * Fail-fast guard: если whisper-cli по resolved-пути физически отсутствует
 * (asarUnpack сломан / бинарник не закоммичен), бросаем понятный Error с упоминанием
 * asarUnpack — иначе spawn падает с misleading 'whisper_failed'. Дословно ffmpeg-paths.ts:47-57.
 */
export function assertBinaryExists(p: string, name: string): void {
  if (!existsSync(p)) {
    const msg =
      `[services/whisper-paths] ${name} binary not found at resolved path: ${p}. ` +
      `Check electron-builder asarUnpack config and ensure resources/whisper/<platform-arch>/ ` +
      `contains the whisper-cli binary + all required DLLs (Pitfall #1).`
    // eslint-disable-next-line no-console
    console.error(msg)
    throw new Error(msg)
  }
}

/**
 * Fail-fast guard для модели: если ggml-модель отсутствует — бросаем Error с маркером
 * `model_missing`, чтобы transcribe-handler смапил его в reason 'model_missing' (D-09).
 */
export function assertModelExists(p: string): void {
  if (!existsSync(p)) {
    throw new Error(`model_missing: whisper model not found at resolved path: ${p}`)
  }
}

/**
 * Idempotent chmod-fallback: на Linux/macOS восстанавливает execute-bit, если он
 * слетел при распаковке asar (Pitfall #2). На Windows — no-op. Дословно ffmpeg-paths.ts:63-69.
 */
export async function ensureExecutable(p: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    await fs.access(p, fsc.X_OK)
  } catch {
    await fs.chmod(p, 0o755)
  }
}
