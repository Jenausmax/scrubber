// Детект и нормализация backend safeStorage (D-06, D-07, Pitfall #4, Pitfall #5).
//
// Источник: 01-RESEARCH.md §Pattern 3 (нижний блок).
//
// КОНТРАКТ:
//   - init() вызывается ТОЛЬКО после app.whenReady() (Pitfall #5).
//   - getSelectedStorageBackend() — Linux-only API, защищено process.platform guard'ом.
//   - На non-linux нормализуем: darwin → 'keychain', win32 → 'dpapi'.
//   - На linux: gnome_libsecret → 'libsecret', kwallet/kwallet5/kwallet6 → 'kwallet',
//     basic_text → 'basic_text', прочее → 'unavailable'.
//   - isEncryptionAvailable() === false на любой ОС → 'unavailable'.

import { safeStorage } from 'electron'
import type { SecureBackend } from '../../shared/ipc'

export class SecureBackendService {
  private value: SecureBackend = 'unavailable'

  init(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      this.value = 'unavailable'
      return
    }

    if (process.platform === 'darwin') {
      this.value = 'keychain'
      return
    }

    if (process.platform === 'win32') {
      this.value = 'dpapi'
      return
    }

    if (process.platform === 'linux') {
      const raw = safeStorage.getSelectedStorageBackend()
      switch (raw) {
        case 'gnome_libsecret':
          this.value = 'libsecret'
          return
        case 'kwallet':
        case 'kwallet5':
        case 'kwallet6':
          this.value = 'kwallet'
          return
        case 'basic_text':
          this.value = 'basic_text'
          return
        default:
          this.value = 'unavailable'
          return
      }
    }

    // FreeBSD / прочее — не поддерживаем как «secure», деградируем явно.
    this.value = 'unavailable'
  }

  backend(): SecureBackend {
    return this.value
  }
}

/** Singleton — единственный потребитель safeStorage в main процессе. */
export const secureBackend = new SecureBackendService()
