// Integration: SHELL-02 end-to-end и SHELL-03 persistence side.
//
// Цель: проверить контракт SecretsStore «через имитацию рестарта» — не unit-уровень
// (round-trip внутри одного инстанса), а полный путь save → новый инстанс класса → init →
// hasApiKey. Это закрывает SHELL-02b («секрет переживает рестарт») и явно показывает,
// что basic_text/unavailable backend секрет НЕ переживает.
//
// Источники:
//   - 01-VALIDATION.md SHELL-02b
//   - 01-RESEARCH.md §Wave 0 Gaps (integration)
//   - 01-PATTERNS.md §Tests
//   - 01-PLAN 01-03 Task 2

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { setBackend, setEncryptionAvailable } from '../setup'
import { SecretsStore } from '../../src/main/services/secrets-store'
import { secureBackend } from '../../src/main/services/secure-backend'

const USER_DATA = join(os.tmpdir(), 'scrubber-test', 'userData')
const SECRETS_FILE = join(USER_DATA, 'secrets.bin')

const PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform')
function stubPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}
function restorePlatform(): void {
  if (PLATFORM_DESCRIPTOR) Object.defineProperty(process, 'platform', PLATFORM_DESCRIPTOR)
}

beforeEach(async () => {
  // Полная очистка tmpdir, чтобы тесты не зависели друг от друга.
  await fs.rm(USER_DATA, { recursive: true, force: true })
  await fs.mkdir(USER_DATA, { recursive: true })
  setEncryptionAvailable(true)
  setBackend('gnome_libsecret')
  stubPlatform('linux')
})

afterAll(() => {
  restorePlatform()
})

/** Помощник: проинициализировать backend, создать НОВЫЙ инстанс SecretsStore и вызвать init(). */
async function makeStore(): Promise<SecretsStore> {
  secureBackend.init()
  const store = new SecretsStore()
  await store.init()
  return store
}

describe('SecretsStore — round-trip через имитацию рестарта (backend=libsecret)', () => {
  it('save → новый инстанс → init → hasApiKey === true (SHELL-02b)', async () => {
    // Шаг 1: «первый запуск процесса» — сохраняем ключ.
    const first = await makeStore()
    const saveResult = await first.saveApiKey('integration-key-42')
    expect(saveResult).toEqual({ ok: true })
    // Файл должен существовать на диске.
    await expect(fs.access(SECRETS_FILE)).resolves.toBeUndefined()

    // Шаг 2: «второй запуск процесса» — новый инстанс класса. Память пустая.
    const second = await makeStore()
    const has = await second.hasApiKey()
    expect(has).toEqual({ ok: true, data: true })
  })

  it('clearApiKey на втором инстансе удаляет файл; третий инстанс видит пустоту', async () => {
    const first = await makeStore()
    await first.saveApiKey('integration-key-to-clear')

    const second = await makeStore()
    expect(await second.hasApiKey()).toEqual({ ok: true, data: true })

    const clearResult = await second.clearApiKey()
    expect(clearResult).toEqual({ ok: true })
    await expect(fs.access(SECRETS_FILE)).rejects.toThrow()

    const third = await makeStore()
    expect(await third.hasApiKey()).toEqual({ ok: true, data: false })
  })
})

describe('SecretsStore — basic_text НЕ переживает рестарт (SHELL-03)', () => {
  it('save на basic_text → файл не создан → новый инстанс → hasApiKey === false', async () => {
    setBackend('basic_text')

    const first = await makeStore()
    const saveResult = await first.saveApiKey('memory-only-key')
    expect(saveResult).toEqual({ ok: true })
    // В memory-only режиме файл на диск НЕ пишется.
    await expect(fs.access(SECRETS_FILE)).rejects.toThrow()
    // В рамках текущей сессии ключ доступен.
    expect(await first.hasApiKey()).toEqual({ ok: true, data: true })

    // «Рестарт» — новый инстанс, новый backend.init(). Файла нет, память пустая.
    const second = await makeStore()
    expect(await second.hasApiKey()).toEqual({ ok: true, data: false })
  })

  it('unavailable backend тоже memory-only — ничего не записывает на диск', async () => {
    setEncryptionAvailable(false)

    const first = await makeStore()
    const writeSpy = vi.spyOn(fs, 'writeFile')
    await first.saveApiKey('unavailable-key')
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()

    const second = await makeStore()
    expect(await second.hasApiKey()).toEqual({ ok: true, data: false })
  })
})
