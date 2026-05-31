// Stateless progress-карточка во время извлечения аудио.
// Источник: 02-UI-SPEC.md §Component Inventory / §Accessibility (role="progressbar");
//          02-PATTERNS.md §ExtractProgress.tsx.
// CONTEXT: D-08 (progress events), D-09 (Cancel-кнопка), D-10 (один активный job).

interface Props {
  filename: string
  percent: number
  etaSec: number | null
  onCancel: () => void
  cancelDisabled?: boolean
}

export default function ExtractProgress({
  filename,
  percent,
  etaSec,
  onCancel,
  cancelDisabled = false
}: Props): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div className="p-6 rounded-md border border-gray-200 bg-white">
      <h2 className="text-lg font-medium mb-2 text-gray-900">Извлекаем аудио…</h2>
      <p className="text-sm text-gray-500 break-all mb-4">{filename}</p>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс извлечения аудио"
        className="mb-2"
      >
        <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-2 rounded-full bg-blue-600 transition-[width] duration-200"
            style={{ width: `${clamped}%` }}
          />
        </div>
      </div>
      <p className="text-sm text-gray-700 tabular-nums mb-4">
        {clamped}% · ~{etaSec ?? '?'} сек
      </p>
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
