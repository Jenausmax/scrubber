// Stateless карточка результата транскрипции — transcript.md готов и авто-сохранён.
// Источник: 03-PATTERNS.md §Transcribe* компоненты (340-345); зеркало ExtractDone.tsx;
// 03-CONTEXT.md D-04 (авто-save), D-06 (открыть/показать в папке), TRANS-07.
//
// Кнопка «Сохранить как» здесь НАМЕРЕННО отсутствует — handler TRANSCRIBE_SAVE_AS
// реализуется в 03-04. Чтобы не было скрытой нерабочей кнопки, в 03-02 её нет.

interface Props {
  mdPath: string
  text: string
  onOpenFile: () => void
  onRevealInFolder: () => void
  onReset: () => void
}

export default function TranscriptResult({
  mdPath,
  text,
  onOpenFile,
  onRevealInFolder,
  onReset
}: Props): React.JSX.Element {
  return (
    <div
      role="status"
      className="p-6 rounded-md border border-green-300 bg-green-50 text-green-900"
    >
      <h2 className="text-lg font-medium mb-2">Транскрипт готов</h2>
      <p className="text-sm mb-3">Файл сохранён в приложении:</p>
      <p className="break-all font-mono text-xs mb-4 text-green-800">{mdPath}</p>

      <pre className="whitespace-pre-wrap break-words bg-white border border-green-200 rounded p-3 text-sm text-gray-900 max-h-96 overflow-auto mb-4">
        {text}
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
