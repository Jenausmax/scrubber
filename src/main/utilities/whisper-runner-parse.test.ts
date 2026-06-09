// TRANS-04 (RED-стаб, Wave 0): парсинг whisper-cli вывода.
//   - stdout SEG-regex → { startMs, text } (живые сегменты);
//   - stderr PROG-regex → percent (cap 99).
//
// GREEN придёт в 03-02 (ядро pipeline): функции parseSegmentLine/parseProgressLine
// будут жить в src/main/utilities/whisper-runner-parse.ts (зеркало progress-parser Phase 2).
// Этот файл RED: модуль ещё не существует → динамический import падает → it() красный.
//
// Источник: 03-RESEARCH.md §segment + progress parsing (403-418).

import { describe, it, expect } from 'vitest'

// Динамический import будущего модуля — пока его нет, тест падает (RED, Nyquist готов).
async function loadParser(): Promise<typeof import('./whisper-runner-parse')> {
  return import('./whisper-runner-parse')
}

describe('whisper-runner-parse (TRANS-04, RED — реализация в 03-02)', () => {
  it("stderr 'progress =  35%' → percent 35", async () => {
    const { parseProgressLine } = await loadParser()
    expect(
      parseProgressLine('whisper_print_progress_callback: progress =  35%')
    ).toBe(35)
  })

  it('percent кэпится на 99', async () => {
    const { parseProgressLine } = await loadParser()
    expect(parseProgressLine('progress = 100%')).toBe(99)
  })

  it("stdout '[00:00:00.000 --> 00:00:03.480]  текст' → { startMs:0, text:'текст' }", async () => {
    const { parseSegmentLine } = await loadParser()
    expect(parseSegmentLine('[00:00:00.000 --> 00:00:03.480]  текст')).toEqual({
      startMs: 0,
      text: 'текст'
    })
  })

  it('SEG-regex считает startMs из hh:mm:ss.mmm', async () => {
    const { parseSegmentLine } = await loadParser()
    expect(parseSegmentLine('[00:01:02.500 --> 00:01:05.000]  привет')).toEqual({
      startMs: 62500,
      text: 'привет'
    })
  })

  it('строка без SEG-формата → null', async () => {
    const { parseSegmentLine } = await loadParser()
    expect(parseSegmentLine('whisper: random log line')).toBeNull()
  })
})
