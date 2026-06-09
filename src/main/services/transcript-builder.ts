// TRANS-07 / D-01 / D-02 / D-03 (Wave 0 STUB): сборка transcript.md.
//
// СТАТУС: RED-стаб. Сигнатура buildTranscriptMd зафиксирована (контракт для теста),
// тело НЕ реализовано — бросает, тесты красные. GREEN — в 03-02/03-04:
// YAML-frontmatter + H1 (D-03) + сплошной текст (D-01) / тумблер таймкодов из сегментов (D-02).
//
// Источник: 03-CONTEXT.md D-01/D-02/D-03.

const NOT_IMPLEMENTED = '[transcript-builder] not implemented yet (Wave 0 stub — GREEN в 03-02/04)'

export interface TranscriptSegment {
  startMs: number
  text: string
}

export interface TranscriptMeta {
  /** Имя/путь исходного mp4. */
  source: string
  /** Использованная whisper-модель. */
  model: string
  language: string
  /** Длительность (напр. 00:00:05). */
  duration: string
  /** Дата (ISO). */
  date: string
}

export interface BuildTranscriptInput {
  meta: TranscriptMeta
  segments: TranscriptSegment[]
  /** D-02: тумблер таймкодов (по умолчанию false → сплошной текст). */
  timestamps: boolean
}

/**
 * Собирает .md: YAML-frontmatter + H1 + тело. timestamps:false → сплошной текст (D-01);
 * timestamps:true → пересборка с [ЧЧ:ММ:СС] из сегментов без re-run whisper (D-02).
 */
export function buildTranscriptMd(_input: BuildTranscriptInput): string {
  throw new Error(NOT_IMPLEMENTED)
}
