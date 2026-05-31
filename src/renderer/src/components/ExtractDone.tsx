// Stateless карточка успеха — аудио извлечено.
// Источник: 02-UI-SPEC.md §Component Inventory; 02-PATTERNS.md §ExtractDone.tsx.
// CONTEXT: D-12 (cache-hit отдельным заголовком).
//
// GAP (документировано в 02-03-SUMMARY): UI-SPEC требует кнопку «Открыть папку»
// (open-in-folder), но Phase 2 backend не предоставляет `shell.showItemInFolder`.
// В Plan 03 кнопка заменена на «Скопировать путь» (renderer-only, navigator.clipboard).
// Будущий план должен добавить namespace `shell.showItemInFolder(path)` и вернуть
// исходный label «Открыть папку».

interface Props {
  audioPath: string
  cacheHit: boolean
  onCopyPath: () => void
  onReset: () => void
  copied?: boolean
}

export default function ExtractDone({
  audioPath,
  cacheHit,
  onCopyPath,
  onReset,
  copied = false
}: Props): React.JSX.Element {
  const title = cacheHit ? 'Аудио уже извлечено' : 'Аудио извлечено'
  return (
    <div
      role="status"
      className="p-6 rounded-md border border-green-300 bg-green-50 text-green-900"
    >
      <h2 className="text-lg font-medium mb-2">{title}</h2>
      <p className="text-sm mb-3">Файл сохранён в кеше приложения</p>
      <p className="break-all font-mono text-sm mb-4 text-green-800">
        {audioPath}
      </p>
      {copied && (
        <p className="text-sm text-green-700 mb-3">Путь скопирован</p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCopyPath}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Скопировать путь
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
