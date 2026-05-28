// Контракт IPC — единственный источник правды для main / preload / renderer.
//
// Источники:
// - 01-CONTEXT.md D-06 (SecureBackend union), D-08..D-11 (domain-namespaced API),
//   D-12/D-13 (раздельное хранение), D-14 (process boundaries).
// - 01-RESEARCH.md §Pattern 2 (Типизированный IPC контракт).
// - 01-PATTERNS.md §Shared contract, §IPC contract shape, §Result-тип для IPC.

/**
 * Backend безопасного хранилища, нормализованный для UI.
 * Маппинг сырых значений `safeStorage.getSelectedStorageBackend()` происходит
 * в `src/main/services/secure-backend.ts` (Pitfall #4).
 */
export type SecureBackend =
  | 'keychain' // macOS
  | 'dpapi' // Windows
  | 'libsecret' // Linux gnome_libsecret
  | 'kwallet' // Linux kwallet / kwallet5 / kwallet6
  | 'basic_text' // Linux без keyring (D-07: memory-only)
  | 'unavailable' // safeStorage.isEncryptionAvailable() === false

/**
 * Result-тип для всех IPC-мутаций (Pitfall #7).
 * Никаких сырых throw через границу IPC — handler возвращает Result.
 */
export type Result<T = void> = { ok: true; data?: T } | { ok: false; reason: string }

/**
 * Каналы IPC. Единственное место, где живут строковые имена каналов
 * (anti-pattern checklist 01-PATTERNS.md).
 */
export const Channels = {
  SETTINGS_SAVE_API_KEY: 'settings:saveApiKey',
  SETTINGS_HAS_API_KEY: 'settings:hasApiKey',
  SETTINGS_CLEAR_API_KEY: 'settings:clearApiKey',
  SETTINGS_GET_SECURE_BACKEND: 'settings:getSecureBackend'
} as const

export type ChannelName = (typeof Channels)[keyof typeof Channels]

/**
 * Settings namespace — единственный реально реализованный в Phase 1 (D-11).
 * Никаких заглушек под media / transcribe / llm (D-09).
 */
export interface SettingsApi {
  saveApiKey: (key: string) => Promise<Result>
  hasApiKey: () => Promise<Result<boolean>>
  clearApiKey: () => Promise<Result>
  getSecureBackend: () => Promise<Result<SecureBackend>>
}

/**
 * Корневой API, который preload экспонирует в renderer как `window.scrubber`.
 * Расширяется новыми namespaces в Phase 2..4.
 */
export interface ScrubberApi {
  settings: SettingsApi
}
