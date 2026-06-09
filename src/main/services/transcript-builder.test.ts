// TRANS-07 / D-01 / D-02 / D-03 (RED-стаб, Wave 0): сборка transcript.md.
//   - D-03: YAML-frontmatter (source/model/language/duration/date) + H1 (имя файла) + тело;
//   - D-01: тело по умолчанию — сплошной текст (сегменты склеены без таймкодов);
//   - D-02: тумблер таймкодов пересобирает тело из сохранённых сегментов БЕЗ re-run whisper
//           (формат `[ЧЧ:ММ:СС]` в начале сегмента).
//
// GREEN придёт в 03-02/03-04: src/main/services/transcript-builder.ts.
// Этот файл RED: модуль ещё не существует → динамический import падает.
//
// Источник: 03-CONTEXT.md D-01/D-02/D-03, 03-PLAN-01 Task 2 behavior.

import { describe, it, expect } from 'vitest'

async function loadBuilder(): Promise<typeof import('./transcript-builder')> {
  return import('./transcript-builder')
}

const SEGMENTS = [
  { startMs: 0, text: 'Привет' },
  { startMs: 3000, text: 'мир' }
]

const META = {
  source: 'video.mp4',
  model: 'large-v3',
  language: 'ru',
  duration: '00:00:05',
  date: '2026-06-09'
}

describe('transcript-builder (TRANS-07/D-01/D-02/D-03, RED — реализация в 03-02/04)', () => {
  it('D-03: содержит YAML-frontmatter с source/model/language/duration/date + H1', async () => {
    const { buildTranscriptMd } = await loadBuilder()
    const md = buildTranscriptMd({ meta: META, segments: SEGMENTS, timestamps: false })
    expect(md).toMatch(/^---/)
    expect(md).toContain('source: video.mp4')
    expect(md).toContain('model: large-v3')
    expect(md).toMatch(/^# /m)
  })

  it('D-01: тело по умолчанию — сплошной текст без таймкодов', async () => {
    const { buildTranscriptMd } = await loadBuilder()
    const md = buildTranscriptMd({ meta: META, segments: SEGMENTS, timestamps: false })
    expect(md).toContain('Привет мир')
    expect(md).not.toMatch(/\[\d{2}:\d{2}:\d{2}\]/)
  })

  it('D-02: тумблер timestamps:true пересобирает тело с [ЧЧ:ММ:СС] без re-run', async () => {
    const { buildTranscriptMd } = await loadBuilder()
    const md = buildTranscriptMd({ meta: META, segments: SEGMENTS, timestamps: true })
    expect(md).toMatch(/\[00:00:00\]/)
    expect(md).toMatch(/\[00:00:03\]/)
  })
})
