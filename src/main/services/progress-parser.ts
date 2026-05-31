// Парсер строки `key=value` из `ffmpeg -progress pipe:1`.
//
// Источник: 02-RESEARCH.md §Pattern 4, 02-PATTERNS.md §src/main/services/progress-parser.ts,
// 02-CONTEXT.md D-08 (формат прогресс-эвента `{percent, etaSec}`, throttle ≤1/sec).
//
// КОНТРАКТ (testable in isolation — NO side-effects, NO imports of node:* или electron):
//   - Принимает одну сырую строку stdout, durationSec файла, startedMs (Date.now() в начале)
//     и lastPct (внешнее состояние для дедупа — передаётся снаружи, парсер stateless).
//   - Возвращает ParsedProgress (если строка `out_time_us=` и pct ≠ lastPct), иначе null.
//   - Cap на percent = 99 (последний шаг — 100 на event 'exit', не на этом парсере).
//   - Guard divide-by-zero: durationSec <= 0 → null.

export interface ParsedProgress {
  percent: number
  etaSec: number | null
}

/**
 * Парсит одну строку формата `key=value`, фильтрует только `out_time_us=`,
 * вычисляет percent (0..99) и etaSec.
 * Возвращает null если:
 *   - строка не key=value;
 *   - key !== 'out_time_us';
 *   - durationSec <= 0 (divide-by-zero guard);
 *   - value не финитное число;
 *   - вычисленный pct совпал с lastPct (дедуп).
 */
export function parseProgressLine(
  line: string,
  durationSec: number,
  startedMs: number,
  lastPct: number
): ParsedProgress | null {
  const eq = line.indexOf('=')
  if (eq < 0) return null
  const key = line.slice(0, eq)
  if (key !== 'out_time_us') return null
  if (durationSec <= 0) return null
  const us = Number(line.slice(eq + 1))
  if (!Number.isFinite(us)) return null
  const pct = Math.min(99, Math.floor((us / 1_000_000 / durationSec) * 100))
  if (pct === lastPct) return null
  const elapsed = (Date.now() - startedMs) / 1000
  const eta = pct > 0 ? Math.max(0, Math.round((100 / pct - 1) * elapsed)) : null
  return { percent: pct, etaSec: eta }
}
