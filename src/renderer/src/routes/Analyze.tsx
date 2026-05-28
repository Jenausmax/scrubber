// Placeholder-маршрут — LLM-анализ транскрипта приходит в Phase 4.
// Источник: 01-CONTEXT.md D-04, 01-PATTERNS.md §routes/Analyze.tsx.

export default function Analyze(): React.JSX.Element {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-3">Анализ</h1>
      <p className="text-gray-700">
        Доступно в Phase 4 — отправка транскрипта в LLM с настраиваемым системным промптом.
      </p>
    </div>
  )
}
