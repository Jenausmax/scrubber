// Stateless карточка ошибки с retry-кнопкой.
// Источник: 02-UI-SPEC.md §Copywriting Contract (exact русские копи);
//          02-PATTERNS.md §InlineError.tsx.
// 02-05-PLAN Task 3 — точные копи уточнены, uniqueness покрыта unit-тестом.

import type { MediaReason } from '../../../shared/ipc'

interface Props {
  reason: MediaReason
  onRetry: () => void
}

// Точные копи из UI-SPEC §Copywriting Contract.
// 02-05 Gap 3: каждая из 7 строк уникальна (uniqueness покрыт unit-тестом
// в InlineError.test.tsx — `new Set(texts).size === 7`).
// Текст для `internal` явно упоминает ffmpeg-бинарник — помощь пользователю,
// если повторится Gap 2 (распакованный бинарник отсутствует в packaged build).
const REASON_COPY: Record<MediaReason, string> = {
  invalid_argument: 'Можно перетащить только один mp4-файл за раз.',
  not_mp4: 'Поддерживается только формат .mp4. Выберите другой файл.',
  file_not_found: 'Файл не найден. Возможно, он был перемещён или удалён.',
  ffmpeg_failed:
    'Не удалось извлечь аудио: файл повреждён или содержит неподдерживаемый кодек.',
  cancelled: 'Извлечение отменено пользователем.',
  disk_full:
    'Недостаточно места на диске для сохранения аудио. Освободите место и попробуйте снова.',
  internal:
    'Внутренняя ошибка приложения. Проверьте установку: бинарник ffmpeg может быть не распакован. Перезапустите приложение.'
}

export default function InlineError({
  reason,
  onRetry
}: Props): React.JSX.Element {
  const text = REASON_COPY[reason] ?? REASON_COPY.internal
  return (
    <div
      role="alert"
      className="p-6 rounded-md border border-red-200 bg-red-50 text-red-900"
    >
      <p className="text-sm mb-4">{text}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Попробовать снова
      </button>
    </div>
  )
}
