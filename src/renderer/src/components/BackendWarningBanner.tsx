// Жёлтый warning-баннер — деградация secret-storage на Linux без keyring.
// Источник: 01-CONTEXT.md D-07 (warning, не error, не блокирует UI),
// 01-PATTERNS.md §BackendWarningBanner.
// Threat: T-03 (информирование пользователя про незащищённое хранение).

import type { SecureBackend } from '../../../shared/ipc'

interface Props {
  backend: SecureBackend | null
}

export default function BackendWarningBanner({ backend }: Props): React.JSX.Element | null {
  // Состояние загрузки — баннер ещё рано рисовать.
  if (backend === null) {
    return null
  }

  // Безопасные backend'ы — баннер не нужен.
  if (backend !== 'basic_text' && backend !== 'unavailable') {
    return null
  }

  return (
    <div
      role="alert"
      className="bg-yellow-100 border border-yellow-400 text-yellow-900 px-4 py-3 text-sm"
    >
      <strong className="font-semibold">Внимание:</strong>{' '}
      Системное защищённое хранилище недоступно. API-ключ не сохранится между запусками
      приложения. На Linux установите <code>gnome-keyring</code> или <code>kwallet</code>,
      затем перезапустите приложение.
    </div>
  )
}
