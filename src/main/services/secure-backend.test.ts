// SHELL-03 / Pitfall #4: матрица backend-детекта safeStorage.
// Покрываем все 6 значений union SecureBackend + linux-guard для getSelectedStorageBackend().
//
// Источник: 01-RESEARCH.md §Pattern 3 (нижний блок) + §Common Pitfalls #4, #5.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setBackend, setEncryptionAvailable } from '../../../tests/setup'

const PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function restorePlatform(): void {
  if (PLATFORM_DESCRIPTOR) {
    Object.defineProperty(process, 'platform', PLATFORM_DESCRIPTOR)
  }
}

beforeEach(() => {
  // Сбрасываем модульное состояние мока перед каждым тестом — Wave 0 setup глобален,
  // но переменные currentBackend / encryptionAvailable живут на всю сессию.
  setBackend('gnome_libsecret')
  setEncryptionAvailable(true)
  restorePlatform()
  vi.resetModules()
})

describe('SecureBackendService', () => {
  it('возвращает "unavailable", если safeStorage.isEncryptionAvailable() === false (любая ОС)', async () => {
    stubPlatform('darwin')
    setEncryptionAvailable(false)
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(secureBackend.backend()).toBe('unavailable')
  })

  it('возвращает "keychain" на darwin при доступном encryption', async () => {
    stubPlatform('darwin')
    setEncryptionAvailable(true)
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(secureBackend.backend()).toBe('keychain')
  })

  it('возвращает "dpapi" на win32 при доступном encryption', async () => {
    stubPlatform('win32')
    setEncryptionAvailable(true)
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(secureBackend.backend()).toBe('dpapi')
  })

  it('linux + gnome_libsecret → "libsecret"', async () => {
    stubPlatform('linux')
    setBackend('gnome_libsecret')
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(secureBackend.backend()).toBe('libsecret')
  })

  it.each([['kwallet'], ['kwallet5'], ['kwallet6']])(
    'linux + %s → "kwallet"',
    async (raw) => {
      stubPlatform('linux')
      setBackend(raw)
      const { secureBackend } = await import('./secure-backend')
      secureBackend.init()
      expect(secureBackend.backend()).toBe('kwallet')
    }
  )

  it('linux + basic_text → "basic_text"', async () => {
    stubPlatform('linux')
    setBackend('basic_text')
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(secureBackend.backend()).toBe('basic_text')
  })

  it('linux + unknown → "unavailable"', async () => {
    stubPlatform('linux')
    setBackend('unknown')
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(secureBackend.backend()).toBe('unavailable')
  })

  it('НЕ вызывает getSelectedStorageBackend() на non-linux (Pitfall #4)', async () => {
    stubPlatform('darwin')
    setEncryptionAvailable(true)
    const electron = await import('electron')
    const spy = electron.safeStorage.getSelectedStorageBackend as ReturnType<typeof vi.fn>
    spy.mockClear()
    const { secureBackend } = await import('./secure-backend')
    secureBackend.init()
    expect(spy).not.toHaveBeenCalled()
  })

  it('по умолчанию (до init) backend === "unavailable"', async () => {
    const { SecureBackendService } = await import('./secure-backend')
    const svc = new SecureBackendService()
    expect(svc.backend()).toBe('unavailable')
  })
})
