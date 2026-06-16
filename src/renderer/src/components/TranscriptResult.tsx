// Stateless карточка результата транскрипции — transcript.md готов и авто-сохранён.
// Источник: 03-PATTERNS.md §Transcribe* компоненты; зеркало ExtractDone.tsx;
// 03-CONTEXT.md D-02 (тумблер таймкодов без re-run), D-04 (авто-save),
// D-05 (Сохранить как, имя формирует main), D-06 (открыть/показать в папке), TRANS-07.
//
// 03-04: добавлены «Сохранить как» (transcribe.saveAs без имени из renderer — имя
// формирует main по audioPath) + тумблер таймкодов (пересборка отображаемого/сохраняемого
// текста из накопленных сегментов БЕЗ повторного запуска whisper, D-02).

import { useMemo, useState } from 'react'
import TimecodeToggle from './TimecodeToggle'
import { buildDisplayText, type DisplaySegment } from '../lib/transcript-display'

interface Props {
  /** Путь авто-сохранённого .md (для открыть/показать). */
  mdPath: string
  /** Полный авто-сохранённый md (frontmatter + H1 + сплошное тело) — префикс берём отсюда. */
  text: string
  /** Накопленные сегменты — источник пересборки тела при переключении таймкодов (D-02). */
  segments: DisplaySegment[]
  /** Стартовое состояние тумблера (из settings-store, D-02 default OFF). */
  timecodesDefault?: boolean
  onOpenFile: () => void
  onRevealInFolder: () => void
  /** «Сохранить как»: md-контент в текущем формате тумблера. Имя файла формирует main. */
  onSaveAs: (md: string) => void
  onReset: () => void
}

/**
 * Префикс md (frontmatter + H1, всё до тела) из авто-сохранённого text.
 * Формат transcript-builder: `frontmatter\n\n# title\n\nbody\n`.
 * Возвращает строку, оканчивающуюся на `\n\n` (готова к конкатенации с телом).
 */
function extractPrefix(text: string): string {
  // Второй разделитель \n\n отделяет H1 от тела.
  const firstSep = text.indexOf('\n\n')
  if (firstSep === -1) return ''
  const secondSep = text.indexOf('\n\n', firstSep + 2)
  if (secondSep === -1) return ''
  return text.slice(0, secondSep + 2)
}

export default function TranscriptResult({
  mdPath,
  text,
  segments,
  timecodesDefault = false,
  onOpenFile,
  onRevealInFolder,
  onSaveAs,
  onReset
}: Props): React.JSX.Element {
  const [timecodes, setTimecodes] = useState(timecodesDefault)

  const prefix = useMemo(() => extractPrefix(text), [text])
  const body = useMemo(() => buildDisplayText(segments, timecodes), [segments, timecodes])
  // Полный md для saveAs в текущем формате тумблера (D-02): префикс из авто-сохранённого
  // md + пересобранное тело. Если префикс не распарсился — fallback на исходный text.
  const md = useMemo(() => (prefix ? `${prefix}${body}\n` : text), [prefix, body, text])

  return (
    <div
      role="status"
      className="p-6 rounded-md border border-green-300 bg-green-50 text-green-900"
    >
      <h2 className="text-lg font-medium mb-2">Транскрипт готов</h2>
      <p className="text-sm mb-3">Файл сохранён в приложении:</p>
      <p className="break-all font-mono text-xs mb-4 text-green-800">{mdPath}</p>

      <div className="mb-3">
        <TimecodeToggle enabled={timecodes} onChange={setTimecodes} />
      </div>

      <pre className="whitespace-pre-wrap break-words bg-white border border-green-200 rounded p-3 text-sm text-gray-900 max-h-96 overflow-auto mb-4">
        {body}
      </pre>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onOpenFile}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Открыть файл
        </button>
        <button
          type="button"
          onClick={(): void => onSaveAs(md)}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Сохранить как
        </button>
        <button
          type="button"
          onClick={onRevealInFolder}
          className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Показать в папке
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Сбросить
        </button>
      </div>
    </div>
  )
}
