// Renderer-side пересборка отображаемого текста транскрипта из накопленных сегментов
// (D-02): тумблер таймкодов переключает формат БЕЗ повторного запуска whisper.
//
// Это renderer-зеркало body-логики src/main/services/transcript-builder.ts
// (timestamps:false → сплошной текст; timestamps:true → построчно [ЧЧ:ММ:СС] text),
// но БЕЗ frontmatter/H1 — только тело для показа в окне и для saveAs-контента.
//
// Контракт: чистая функция, без импортов electron/IPC.

export interface DisplaySegment {
  startMs: number
  text: string
}

/** startMs → `ЧЧ:ММ:СС`. */
function formatTimecode(startMs: number): string {
  const totalSec = Math.floor(startMs / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

/**
 * Собирает тело транскрипта из сегментов (D-02, без re-run):
 *   timecodes:false → сплошной текст (тексты через пробел, пустые отброшены);
 *   timecodes:true  → построчно `[ЧЧ:ММ:СС] text`.
 * Пустой массив → пустая строка.
 */
export function buildDisplayText(segments: DisplaySegment[], timecodes: boolean): string {
  if (timecodes) {
    return segments.map((s) => `[${formatTimecode(s.startMs)}] ${s.text}`.trim()).join('\n')
  }
  return segments
    .map((s) => s.text.trim())
    .filter((t) => t.length > 0)
    .join(' ')
}
