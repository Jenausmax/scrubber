// Тумблер таймкодов (D-02). По умолчанию ВЫКЛ. Переключение пересобирает
// отображаемый текст из НАКОПЛЕННЫХ сегментов БЕЗ повторного запуска whisper —
// сама пересборка делается в родителе (TranscriptResult) через buildDisplayText.
//
// Stateless: получает текущее состояние `enabled` и `onChange`. IPC здесь нет.

interface Props {
  enabled: boolean
  onChange: (next: boolean) => void
}

export default function TimecodeToggle({ enabled, onChange }: Props): React.JSX.Element {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e): void => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500"
      />
      Таймкоды
    </label>
  )
}
