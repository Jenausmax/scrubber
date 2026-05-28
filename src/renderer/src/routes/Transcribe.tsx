// Placeholder-маршрут — реальная транскрипция приходит в Phase 3.
// Источник: 01-CONTEXT.md D-04, 01-PATTERNS.md §routes/Transcribe.tsx.

export default function Transcribe(): React.JSX.Element {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-3">Транскрипция</h1>
      <p className="text-gray-700">
        Доступно в Phase 3 — извлечение аудио из mp4 и локальная транскрипция через whisper.cpp.
      </p>
    </div>
  )
}
