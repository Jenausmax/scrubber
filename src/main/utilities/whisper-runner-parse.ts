// TRANS-04 (GREEN в 03-02): парсер вывода whisper-cli.
//
// Зеркало src/main/services/progress-parser.ts (Phase 2): чистые функции парсинга
// одной строки. Используются И inline в whisper-runner.ts (через дублирование —
// utility-bundle не импортирует из main-графа, см. ffmpeg-runner.ts §КОНТРАКТ),
// И в whisper-runner-parse.test.ts (отдельное покрытие без spawn).
//
// Источник: 03-RESEARCH.md §Progress Parsing (197-216), §segment + progress parsing (403-418):
//   - stderr `progress =  35%` → percent (cap 99, чтобы 100% приходило только на 'done');
//   - stdout `[hh:mm:ss.mmm --> hh:mm:ss.mmm]  текст` → { startMs, text }.

/** Один распознанный сегмент транскрипта. */
export interface ParsedSegment {
  startMs: number
  text: string
}

/** PROG-regex: percent из stderr whisper-cli (`progress = N%`). */
const PROG_REGEX = /progress\s*=\s*(\d+)%/

/**
 * SEG-regex: stdout-сегмент `[hh:mm:ss.mmm --> hh:mm:ss.mmm]  текст`.
 * Захватывает hh/mm/ss/mmm начала и текст (после `]` + пробелов).
 */
const SEG_REGEX = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> .*\]\s+(.*)$/

/**
 * stderr-строка whisper-cli → percent (0..99) | null.
 * Кэпим на 99 — финальные 100% сигналятся отдельным 'done'-сообщением (как ffmpeg-runner).
 */
export function parseProgressLine(line: string): number | null {
  const m = PROG_REGEX.exec(line)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  return Math.min(99, n)
}

/**
 * stdout-строка whisper-cli → { startMs, text } | null.
 * startMs = (hh*3600 + mm*60 + ss) * 1000 + mmm. Нерелевантные строки → null (TRANS-04).
 */
export function parseSegmentLine(line: string): ParsedSegment | null {
  const m = SEG_REGEX.exec(line)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  const ss = Number(m[3])
  const mmm = Number(m[4])
  const startMs = ((hh * 3600 + mm * 60 + ss) * 1000) + mmm
  const text = m[5]
  return { startMs, text }
}
