// Stateless progress-карточка во время транскрипции whisper (TRANS-04, D-11).
// Источник: ExtractProgress.tsx (role="progressbar" + aria + clamp + Cancel) — эталон;
// 03-CONTEXT.md D-11 (живой стриминг сегментов + %-бар), D-13 (cancel).
//
// Отличие от ExtractProgress: ниже %-бара — область живого стриминга сегментов,
// которая растёт по мере прихода onSegment-событий (D-11). Каждый сегмент — строка
// распознанного текста; область скроллится, новые сегменты внизу.

interface Segment {
  startMs: number
  text: string
}

interface Props {
  percent: number
  segments: Segment[]
  onCancel: () => void
  cancelDisabled?: boolean
}

export default function TranscribeProgress({
  percent,
  segments,
  onCancel,
  cancelDisabled = false
}: Props): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className="p-6 rounded-md border border-blue-200 bg-blue-50 text-blue-900">
      <h2 className="text-lg font-medium mb-2">Распознаём речь…</h2>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс распознавания речи"
        className="mb-2"
      >
        <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden">
          <div
            className="h-2 rounded-full bg-blue-600 transition-[width] duration-200"
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
      <p className="text-sm tabular-nums mb-4">{clamped}%</p>

      {/* D-11: живой стриминг распознанных сегментов по мере готовности. */}
      {segments.length > 0 && (
        <div
          aria-label="Распознанные сегменты"
          className="bg-white border border-blue-200 rounded p-3 text-sm text-gray-900 max-h-64 overflow-auto mb-4 space-y-1"
        >
          {segments.map((s, i) => (
            <p key={i} className="break-words whitespace-pre-wrap">
              {s.text}
            </p>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={cancelDisabled}
        className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Отменить
      </button>
    </div>
  )
}
