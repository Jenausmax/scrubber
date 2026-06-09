// TRANS-04 (Wave 0 STUB): парсер вывода whisper-cli.
//
// СТАТУС: RED-стаб. Сигнатуры зафиксированы (контракт для тестов whisper-runner-parse.test.ts),
// но тела НЕ реализованы — функции бросают, тесты красные. GREEN — в 03-02 (ядро pipeline):
// SEG-regex по stdout, PROG-regex по stderr (03-RESEARCH.md §segment + progress parsing 403-418).

const NOT_IMPLEMENTED = '[whisper-runner-parse] not implemented yet (Wave 0 stub — GREEN в 03-02)'

/** Один распознанный сегмент транскрипта. */
export interface ParsedSegment {
  startMs: number
  text: string
}

/**
 * stderr-строка whisper-cli → percent (0..99). GREEN в 03-02:
 * PROG = /progress\s*=\s*(\d+)%/ ; Math.min(99, +m[1]).
 */
export function parseProgressLine(_line: string): number | null {
  throw new Error(NOT_IMPLEMENTED)
}

/**
 * stdout-строка whisper-cli → { startMs, text } | null. GREEN в 03-02:
 * SEG = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> .*\]\s+(.*)$/.
 */
export function parseSegmentLine(_line: string): ParsedSegment | null {
  throw new Error(NOT_IMPLEMENTED)
}
