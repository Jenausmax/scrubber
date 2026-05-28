// SecretsStore — единственный модуль в main, который владеет API-ключом (D-04, D-05, D-12).
//
// Источник: 01-RESEARCH.md §Pattern 3 (верхний блок), §Common Pitfalls #3 #5 #6 #8.
//
// КОНТРАКТ:
//   - plaintext-ключ живёт только в this.memory, никогда не пересекает границу IPC (D-05).
//   - На диск пишется ТОЛЬКО safeStorage.encryptString → base64 (Pitfall #6).
//   - Файл `app.getPath('userData')/secrets.bin`, mode 0o600 (ASVS V8).
//   - Backend ∈ { 'unavailable', 'basic_text' } → memory-only режим, на диск НЕ пишем (D-07, SHELL-03).
//   - hasApiKey возвращает только boolean — НИКАКОГО plaintext через IPC.
//   - Все методы возвращают Result-тип (Pitfall #7).

import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Result } from '../../shared/ipc'
import { secureBackend } from './secure-backend'

interface SecretsFileShape {
  apiKey?: string // base64 шифротекст; никогда не plaintext
}

function isMemoryOnlyBackend(): boolean {
  const b = secureBackend.backend()
  return b === 'unavailable' || b === 'basic_text'
}

export class SecretsStore {
  private memory: { apiKey?: string } = {}
  private diskCache: SecretsFileShape | null = null
  private filePath = ''

  async init(): Promise<void> {
    // Pitfall #8: всегда через app.getPath('userData'), не хардкодить пути.
    this.filePath = join(app.getPath('userData'), 'secrets.bin')

    if (isMemoryOnlyBackend()) {
      // D-07: ничего не читаем с диска, memory-only режим.
      this.diskCache = null
      return
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as SecretsFileShape
      this.diskCache = parsed
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0) {
        const cipher = Buffer.from(parsed.apiKey, 'base64')
        this.memory.apiKey = safeStorage.decryptString(cipher)
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        this.diskCache = {}
        return
      }
      // Парс-ошибки или повреждённый файл — не падаем, просто стартуем с пустым стором.
      // eslint-disable-next-line no-console
      console.error('[secrets-store] failed to read secrets.bin, starting empty:', err)
      this.diskCache = {}
    }
  }

  async saveApiKey(key: string): Promise<Result> {
    // V5 ASVS: ручная валидация на main-стороне.
    if (typeof key !== 'string' || key.length === 0) {
      return { ok: false, reason: 'empty' }
    }
    this.memory.apiKey = key

    if (isMemoryOnlyBackend()) {
      // D-07: на диск не пишем, ключ живёт только в текущей сессии.
      return { ok: true }
    }

    try {
      const cipher = safeStorage.encryptString(key) // Buffer
      // Pitfall #6: сериализуем Buffer → base64, не через JSON.stringify(Buffer).
      const next: SecretsFileShape = {
        ...(this.diskCache ?? {}),
        apiKey: cipher.toString('base64')
      }
      await this.ensureUserDataDir()
      await fs.writeFile(this.filePath, JSON.stringify(next), { mode: 0o600 })
      this.diskCache = next
      return { ok: true }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[secrets-store] saveApiKey failed:', err)
      return { ok: false, reason: 'write_failed' }
    }
  }

  async hasApiKey(): Promise<Result<boolean>> {
    return { ok: true, data: typeof this.memory.apiKey === 'string' && this.memory.apiKey.length > 0 }
  }

  async clearApiKey(): Promise<Result> {
    delete this.memory.apiKey

    if (isMemoryOnlyBackend()) {
      return { ok: true }
    }

    try {
      if (this.diskCache && this.diskCache.apiKey) {
        const next: SecretsFileShape = { ...this.diskCache }
        delete next.apiKey
        // Если других полей нет — удаляем файл целиком, иначе перезаписываем.
        if (Object.keys(next).length === 0) {
          await fs.rm(this.filePath, { force: true })
          this.diskCache = {}
        } else {
          await fs.writeFile(this.filePath, JSON.stringify(next), { mode: 0o600 })
          this.diskCache = next
        }
      } else {
        // На случай рассинхрона — попытаться удалить файл, не падать если его нет.
        await fs.rm(this.filePath, { force: true })
      }
      return { ok: true }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[secrets-store] clearApiKey failed:', err)
      return { ok: false, reason: 'clear_failed' }
    }
  }

  private async ensureUserDataDir(): Promise<void> {
    const dir = join(this.filePath, '..')
    await fs.mkdir(dir, { recursive: true })
  }
}

/** Singleton: единственный потребитель safeStorage.encrypt/decrypt в main. */
export const secretsStore = new SecretsStore()
