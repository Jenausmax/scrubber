// TRANS-07 / D-01 / D-02 / D-03 (GREEN в 03-02): сборка transcript.md.
//
// Чистая функция (без импортов electron/main-графа) — собирает итоговый .md из
// распознанных сегментов и метаданных. GREEN-реализация ядра ценности:
//   - D-03: YAML-frontmatter (source/model/language/duration/date) + H1 (имя файла);
//   - D-01: тело по умолчанию — сплошной текст (сегменты склеены через пробел, без таймкодов);
//   - D-02: тумблер timestamps:true пересобирает тело с `[ЧЧ:ММ:СС]` из ТЕХ ЖЕ сегментов
//           БЕЗ повторного запуска whisper (startMs уже сохранён в сегментах).
//
// Источник: 03-CONTEXT.md D-01/D-02/D-03, 03-PLAN-02 Task 1 behavior.

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

/** basename из source-пути (кросс-платформенно: / и \). */
function basename(source: string): string {
  const norm = source.replace(/\\/g, '/')
  const last = norm.slice(norm.lastIndexOf('/') + 1)
  return last.length > 0 ? last : source
}

/** startMs → `ЧЧ:ММ:СС` (D-02). */
function formatTimecode(startMs: number): string {
  const totalSec = Math.floor(startMs / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

/** Экранирование значения для YAML-скаляра (двойные кавычки при спецсимволах). */
function yamlValue(v: string): string {
  if (/[:#"\n]/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return v
}

/**
 * Собирает .md: YAML-frontmatter + H1 + тело.
 *   timestamps:false → сплошной текст: тексты сегментов через пробел в один абзац (D-01);
 *   timestamps:true  → построчно `[ЧЧ:ММ:СС] text` из сохранённых сегментов (D-02, без re-run).
 *   пустой массив сегментов → валидный md с пустым телом (частичный/тишина).
 */
export function buildTranscriptMd(input: BuildTranscriptInput): string {
  const { meta, segments, timestamps } = input

  const frontmatter = [
    '---',
    `source: ${yamlValue(meta.source)}`,
    `model: ${yamlValue(meta.model)}`,
    `language: ${yamlValue(meta.language)}`,
    `duration: ${yamlValue(meta.duration)}`,
    `date: ${yamlValue(meta.date)}`,
    '---'
  ].join('\n')

  const title = `# ${basename(meta.source)}`

  let body: string
  if (timestamps) {
    // D-02: каждая строка `[ЧЧ:ММ:СС] text`.
    body = segments
      .map((s) => `[${formatTimecode(s.startMs)}] ${s.text}`.trim())
      .join('\n')
  } else {
    // D-01: сплошной текст — тексты сегментов склеены через пробел.
    body = segments
      .map((s) => s.text.trim())
      .filter((t) => t.length > 0)
      .join(' ')
  }

  // frontmatter \n\n title \n\n body \n (body может быть пустым — валидный md).
  return `${frontmatter}\n\n${title}\n\n${body}\n`
}
