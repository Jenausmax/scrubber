// Резолв путей бинарников ffmpeg/ffprobe и chmod-fallback для Linux/macOS.
//
// Источник: 02-RESEARCH.md §Pattern 5, 02-PATTERNS.md §src/main/services/ffmpeg-paths.ts,
// 02-CONTEXT.md D-18 (chmod 0o755 для распакованных бинарников),
// 02-RESEARCH.md §Pitfall #1 (бинарник внутри app.asar не исполняется) +
// §Pitfall #2 (Linux/macOS chmod слетает после unpacked).
//
// КОНТРАКТ:
//   - resolveFfmpeg() / resolveFfprobe() возвращают абсолютный путь, где `app.asar`
//     заменён на `app.asar.unpacked` (иначе child_process.spawn не сможет исполнить
//     бинарник внутри asar — это Pitfall #1).
//   - ensureExecutable(p): на win32 — no-op (NTFS не различает execute-bit).
//     На linux/darwin: если fs.access(p, X_OK) падает — вызываем fs.chmod(p, 0o755).
//     Idempotent. Должен вызываться ровно один раз при app init (D-18).

import { promises as fs, constants as fsc, existsSync } from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'
import { path as ffprobeStatic } from '@ffprobe-installer/ffprobe'

/**
 * Возвращает путь к ffmpeg-бинарнику с правкой `app.asar → app.asar.unpacked`.
 * Throw fail-fast Error, если ffmpeg-static не разрешился (битый install).
 */
export function resolveFfmpeg(): string {
  if (ffmpegStatic == null) {
    throw new Error('[services/ffmpeg-paths] ffmpeg-static did not resolve')
  }
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

/**
 * Возвращает путь к ffprobe-бинарнику с правкой `app.asar → app.asar.unpacked`.
 */
export function resolveFfprobe(): string {
  if (ffprobeStatic == null) {
    throw new Error('[services/ffmpeg-paths] @ffprobe-installer/ffprobe did not resolve')
  }
  return ffprobeStatic.replace('app.asar', 'app.asar.unpacked')
}

/**
 * 02-05 Gap 2: fail-fast guard `assertBinaryExists`. Если бинарник по resolved-пути
 * физически отсутствует (asarUnpack сломан / install-app-deps не отработал), бросаем
 * понятный Error с упоминанием asarUnpack — иначе spawn падает с misleading
 * 'ffmpeg_failed'. Sync — должно валиться ДО любого spawn в init().
 */
export function assertBinaryExists(p: string, name: string): void {
  if (!existsSync(p)) {
    const msg =
      `[services/ffmpeg-paths] ${name} binary not found at resolved path: ${p}. ` +
      `Check electron-builder asarUnpack config and ensure 'npm run postinstall' ` +
      `(electron-builder install-app-deps) completed successfully.`
    // eslint-disable-next-line no-console
    console.error(msg)
    throw new Error(msg)
  }
}

/**
 * Idempotent chmod-fallback: на Linux/macOS восстанавливает execute-bit, если
 * он слетел при распаковке asar (Pitfall #2). На Windows — no-op.
 */
export async function ensureExecutable(p: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    await fs.access(p, fsc.X_OK)
  } catch {
    await fs.chmod(p, 0o755)
  }
}
