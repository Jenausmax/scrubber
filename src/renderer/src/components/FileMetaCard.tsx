// Stateless карточка с метаданными mp4 + CTA «Извлечь аудио».
// Источник: 02-UI-SPEC.md §Component Inventory / §Layout & Sizing; 02-PATTERNS.md §FileMetaCard.tsx.
// CONTEXT: D-05 (метаданные после выбора + кнопка extract, авто-старт отвергнут).

import type { MediaProbeResult } from '../../../shared/ipc'

interface Props {
  meta: MediaProbeResult
  onExtract: () => void
  onReset: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

export default function FileMetaCard({
  meta,
  onExtract,
  onReset
}: Props): React.JSX.Element {
  return (
    <div className="p-6 rounded-md border border-gray-200 bg-white">
      <h2 className="text-lg font-medium mb-4 text-gray-900">
        Файл готов к извлечению
      </h2>
      <dl className="space-y-2 mb-6">
        <div className="flex justify-between gap-4">
          <dt className="text-sm text-gray-500">Имя файла</dt>
          <dd className="text-base text-gray-900 break-all text-right">
            {meta.name}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-sm text-gray-500">Размер</dt>
          <dd className="text-base text-gray-900 tabular-nums">
            {formatSize(meta.sizeBytes)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-sm text-gray-500">Длительность</dt>
          <dd className="text-base text-gray-900 tabular-nums">
            {formatDuration(meta.durationSec)}
          </dd>
        </div>
      </dl>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onExtract}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Извлечь аудио
        </button>
        <button
          type="button"
          onClick={onReset}
          className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Выбрать другой файл
        </button>
      </div>
    </div>
  )
}
