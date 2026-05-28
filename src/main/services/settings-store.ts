// SettingsStore — обёртка над electron-store@11 для НЕсекретных настроек (D-12, D-13).
//
// Источник: 01-RESEARCH.md §Pattern 3, §Common Pitfalls #3 (ESM-only).
//
// КОНТРАКТ:
//   - НИКОГДА не использовать опцию `encryptionKey` (D-13, документировано взламываемо).
//   - electron-store@11 — ESM-only; импорт через `await import('electron-store')` чтобы
//     дать TypeScript собрать main как ESM при любых настройках tsconfig (Pitfall #3, A2).
//   - В Phase 1 хранит только `secureBackend` last-known. Дальнейшие ключи добавятся
//     в своих фазах.

import { app } from 'electron'
import type { SecureBackend } from '../../shared/ipc'

export interface SettingsSchema {
  secureBackend?: SecureBackend
}

// electron-store экспортирует класс Store как default. Тип импортируем лениво —
// generic-параметризацию делаем здесь, чтобы не тащить тип в верхний scope модуля.
type StoreCtor = new <T extends Record<string, unknown>>(opts: {
  name?: string
  cwd?: string
}) => {
  get: <K extends keyof T>(key: K) => T[K] | undefined
  set: <K extends keyof T>(key: K, value: T[K]) => void
  delete: (key: keyof T) => void
  clear: () => void
}

class SettingsStoreService {
  private store: ReturnType<InstanceType<StoreCtor>['get']> extends never
    ? never
    : InstanceType<StoreCtor> | null = null

  async init(): Promise<void> {
    // Dynamic import — ESM-only пакет (Pitfall #3).
    const mod = await import('electron-store')
    const Store = (mod as unknown as { default: StoreCtor }).default
    this.store = new Store<Record<string, unknown>>({
      name: 'config',
      cwd: app.getPath('userData')
      // НИКАКОГО encryptionKey — D-13.
    }) as unknown as InstanceType<StoreCtor>
  }

  get<K extends keyof SettingsSchema>(key: K): SettingsSchema[K] | undefined {
    if (!this.store) return undefined
    return this.store.get(key as string) as SettingsSchema[K] | undefined
  }

  set<K extends keyof SettingsSchema>(key: K, value: NonNullable<SettingsSchema[K]>): void {
    if (!this.store) return
    this.store.set(key as string, value as unknown)
  }
}

export const settingsStore = new SettingsStoreService()
