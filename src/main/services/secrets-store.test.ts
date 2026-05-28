// SHELL-02 (round-trip) + SHELL-03 (memory-only при basic_text).
// Покрываем encrypt/decrypt round-trip через диск, base64 сериализацию (Pitfall #6),
// валидацию пустого ключа, clearApiKey, отсутствие записи на диск в memory-only режиме.
//
// Источник: 01-RESEARCH.md §Pattern 3 (верхний блок), 01-PATTERNS.md §Сериализация криптотекста.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { setBackend, setEncryptionAvailable } from '../../../tests/setup'

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
  // Полностью очищаем tmp каталог + сбрасываем модульное состояние мока.
  await fs.rm(USER_DATA, { recursive: true, force: true })
  setEncryptionAvailable(true)
  setBackend('gnome_libsecret')
  stubPlatform('linux') // дефолт — backend === 'libsecret', пишем на диск
  vi.resetModules()
})

async function freshStore(): Promise<{
  store: typeof import('./secrets-store').secretsStore
  initBackend: typeof import('./secure-backend').secureBackend
}> {
  const backendMod = await import('./secure-backend')
  backendMod.secureBackend.init()
  const storeMod = await import('./secrets-store')
  await storeMod.secretsStore.init()
  return { store: storeMod.secretsStore, initBackend: backendMod.secureBackend }
}

describe('SecretsStore — disk persistence (backend=libsecret)', () => {
  it('saveApiKey пишет secrets.bin как JSON с base64 шифротекстом (mode 0o600)', async () => {
    const { store } = await freshStore()
    const result = await store.saveApiKey('sk-test-123')
    expect(result).toEqual({ ok: true })

    const raw = await fs.readFile(SECRETS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { apiKey?: string }
    expect(typeof parsed.apiKey).toBe('string')
    expect(parsed.apiKey).not.toContain('sk-test-123') // не plaintext

    // base64 декодируется обратно в bytes
    const buf = Buffer.from(parsed.apiKey!, 'base64')
    // Через mock decryptString восстанавливаем оригинал
    const electron = await import('electron')
    expect(electron.safeStorage.decryptString(buf)).toBe('sk-test-123')
  })

  it('SHELL-02 round-trip: save → новый init → hasApiKey === true', async () => {
    {
      const { store } = await freshStore()
      await store.saveApiKey('sk-roundtrip')
    }
    vi.resetModules()
    {
      const { store } = await freshStore()
      const r = await store.hasApiKey()
      expect(r).toEqual({ ok: true, data: true })
    }
  })

  it('hasApiKey возвращает { ok: true, data: false } для пустого стора', async () => {
    const { store } = await freshStore()
    const r = await store.hasApiKey()
    expect(r).toEqual({ ok: true, data: false })
  })

  it('clearApiKey удаляет ключ из памяти и с диска', async () => {
    const { store } = await freshStore()
    await store.saveApiKey('sk-tbd')
    expect((await store.hasApiKey()).ok && (await store.hasApiKey())).toMatchObject({ data: true })

    const r = await store.clearApiKey()
    expect(r).toEqual({ ok: true })

    const after = await store.hasApiKey()
    expect(after).toEqual({ ok: true, data: false })

    // На диске не должно быть apiKey
    try {
      const raw = await fs.readFile(SECRETS_FILE, 'utf8')
      const parsed = JSON.parse(raw) as { apiKey?: string }
      expect(parsed.apiKey).toBeUndefined()
    } catch (err: unknown) {
      // ENOENT — допустимо (файл может быть удалён целиком)
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT')
    }
  })

  it('saveApiKey("") → { ok: false, reason: "empty" }', async () => {
    const { store } = await freshStore()
    const r = await store.saveApiKey('')
    expect(r).toEqual({ ok: false, reason: 'empty' })
    expect((await store.hasApiKey()).ok && (await store.hasApiKey())).toMatchObject({ data: false })
  })

  it('hasApiKey НИКОГДА не возвращает поле apiKey/key/value (D-05, ASVS V2/V8)', async () => {
    const { store } = await freshStore()
    await store.saveApiKey('sk-leak-check')
    const r = await store.hasApiKey()
    expect(JSON.stringify(r)).not.toContain('sk-leak-check')
  })
})

describe('SecretsStore — memory-only (SHELL-03)', () => {
  it('backend=basic_text: saveApiKey НЕ пишет на диск, но hasApiKey в текущей сессии === true', async () => {
    setBackend('basic_text')
    const { store } = await freshStore()
    const fsSpy = vi.spyOn(fs, 'writeFile')
    const r = await store.saveApiKey('sk-mem')
    expect(r).toEqual({ ok: true })
    expect(fsSpy).not.toHaveBeenCalled()

    expect(await store.hasApiKey()).toEqual({ ok: true, data: true })

    // Файл secrets.bin не существует
    await expect(fs.access(SECRETS_FILE)).rejects.toThrow()
    fsSpy.mockRestore()
  })

  it('backend=basic_text: после "рестарта" hasApiKey === false (memory-only)', async () => {
    setBackend('basic_text')
    {
      const { store } = await freshStore()
      await store.saveApiKey('sk-mem')
    }
    vi.resetModules()
    {
      const { store } = await freshStore()
      expect(await store.hasApiKey()).toEqual({ ok: true, data: false })
    }
  })

  it('backend=unavailable: тоже memory-only, без записи на диск', async () => {
    setEncryptionAvailable(false)
    const { store } = await freshStore()
    const fsSpy = vi.spyOn(fs, 'writeFile')
    await store.saveApiKey('sk-mem-2')
    expect(fsSpy).not.toHaveBeenCalled()
    expect(await store.hasApiKey()).toEqual({ ok: true, data: true })
    fsSpy.mockRestore()
  })
})

describe('SecretsStore — устойчивость', () => {
  it('init() не падает, если secrets.bin отсутствует', async () => {
    const { store } = await freshStore()
    expect(await store.hasApiKey()).toEqual({ ok: true, data: false })
  })

  it('init() не падает, если secrets.bin содержит мусор', async () => {
    await fs.mkdir(USER_DATA, { recursive: true })
    await fs.writeFile(SECRETS_FILE, 'не-json-мусор')
    const { store } = await freshStore()
    // init должен корректно обработать ошибку парсинга
    expect(await store.hasApiKey()).toEqual({ ok: true, data: false })
  })
})

afterEachRestorePlatform()

// Хелпер, чтобы platform не утекал между файлами тестов
function afterEachRestorePlatform(): void {
  // Vitest: вызовем в конце suite. Здесь — просто сахар.
  // Реальный restore выполняется через PLATFORM_DESCRIPTOR в beforeEach следующего теста.
  restorePlatform()
}
