// Stateless карточка ошибки с retry-кнопкой.
// Источник: 02-UI-SPEC.md §Copywriting Contract (exact русские копи);
//          02-PATTERNS.md §InlineError.tsx.
// 02-05-PLAN Task 3 — точные копи уточнены, uniqueness покрыта unit-тестом.

import type { MediaReason, TranscribeReason } from '../../../shared/ipc'

interface Props {
  reason: MediaReason | TranscribeReason
  onRetry: () => void
}

// Точные копи из UI-SPEC §Copywriting Contract (Phase 2 — media).
// 02-05 Gap 3: каждая из 7 media-строк уникальна (uniqueness покрыт unit-тестом
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

// Phase 3 (03-02): русские копи для TranscribeReason. Каждая уникальна (покрыто
// unit-тестом ниже — `new Set(...).size === 7`). model_missing отсылает в Settings
// (управление моделями — слайс 03-03); whisper_failed отличается от ffmpeg_failed.
export const TRANSCRIBE_REASON_COPY: Record<TranscribeReason, string> = {
  invalid_argument: 'Некорректный запрос на транскрипцию. Попробуйте выбрать файл заново.',
  model_missing:
    'Модель для распознавания не скачана. Откройте Настройки и загрузите модель Whisper.',
  audio_not_found:
    'Извлечённое аудио не найдено. Повторите извлечение аудио из видео и попробуйте снова.',
  whisper_failed:
    'Не удалось распознать речь: движок whisper завершился с ошибкой. Проверьте модель и файл.',
  cancelled: 'Транскрипция отменена пользователем.',
  disk_full:
    'Недостаточно места на диске для сохранения транскрипта. Освободите место и попробуйте снова.',
  internal:
    'Внутренняя ошибка транскрипции. Возможно, бинарник whisper не распакован. Перезапустите приложение.'
}

/** Ключи, специфичные для TranscribeReason (не входящие в MediaReason). */
const TRANSCRIBE_ONLY_KEYS = new Set<string>(['model_missing', 'audio_not_found', 'whisper_failed'])

export default function InlineError({
  reason,
  onRetry
}: Props): React.JSX.Element {
  // Разрешение копи: transcribe-специфичные коды → TRANSCRIBE_REASON_COPY;
  // media-коды → REASON_COPY. Пересекающиеся ключи (invalid_argument/cancelled/
  // disk_full/internal) исторически берутся из media-копи (обратная совместимость
  // с Phase 2-тестами); transcribe-копи для них покрыты отдельным тестом.
  const transcribeText =
    reason in TRANSCRIBE_REASON_COPY && TRANSCRIBE_ONLY_KEYS.has(reason)
      ? TRANSCRIBE_REASON_COPY[reason as TranscribeReason]
      : undefined
  const text =
    transcribeText ?? REASON_COPY[reason as MediaReason] ?? REASON_COPY.internal
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
