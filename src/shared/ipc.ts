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
 *
 * MEDIA_* добавлены в Phase 2 — namespace media.* (02-CONTEXT.md D-15).
 * MEDIA_PROGRESS — event-канал (webContents.send → ipcRenderer.on), а не invoke (D-14).
 */
export const Channels = {
  SETTINGS_SAVE_API_KEY: 'settings:saveApiKey',
  SETTINGS_HAS_API_KEY: 'settings:hasApiKey',
  SETTINGS_CLEAR_API_KEY: 'settings:clearApiKey',
  SETTINGS_GET_SECURE_BACKEND: 'settings:getSecureBackend',
  /** media.pickFile() — открыть нативный file dialog, фильтр *.mp4 (02-CONTEXT.md D-04, D-15). */
  MEDIA_PICK_FILE: 'media:pickFile',
  /** media.probe(path) — ffprobe-метаданные mp4 до старта извлечения (02-CONTEXT.md D-14, D-15). */
  MEDIA_PROBE: 'media:probe',
  /** media.extractAudio(path) — старт ffmpeg-job, resolve по завершению (02-CONTEXT.md D-14, D-15). */
  MEDIA_EXTRACT: 'media:extractAudio',
  /** media.cancel(jobId) — SIGTERM в utility-процесс ffmpeg (02-CONTEXT.md D-09, D-15). */
  MEDIA_CANCEL: 'media:cancel',
  /** media:progress — event-канал, webContents.send из main, ipcRenderer.on в preload (02-CONTEXT.md D-08, D-15). */
  MEDIA_PROGRESS: 'media:progress'
} as const

export type ChannelName = (typeof Channels)[keyof typeof Channels]

/**
 * Settings namespace — единственный реально реализованный в Phase 1 (D-11).
 */
export interface SettingsApi {
  saveApiKey: (key: string) => Promise<Result>
  hasApiKey: () => Promise<Result<boolean>>
  clearApiKey: () => Promise<Result>
  getSecureBackend: () => Promise<Result<SecureBackend>>
}

/**
 * Reason-коды для media-handler'ов (02-CONTEXT.md D-16).
 * Все handler'ы возвращают Result, никаких throw через границу IPC (Pitfall #7 Phase 1).
 */
export type MediaReason =
  | 'invalid_argument'
  | 'not_mp4'
  | 'file_not_found'
  | 'ffmpeg_failed'
  | 'cancelled'
  | 'disk_full'
  | 'internal'

/**
 * Результат media.probe — метаданные mp4 (02-CONTEXT.md D-14).
 */
export interface MediaProbeResult {
  durationSec: number
  sizeBytes: number
  name: string
}

/**
 * Результат media.extractAudio — путь к итоговому wav в userData/extracted (02-CONTEXT.md D-11, D-14).
 */
export interface MediaExtractResult {
  jobId: string
  audioPath: string
}

/**
 * Event-payload, который main шлёт в renderer через webContents.send(MEDIA_PROGRESS) (02-CONTEXT.md D-08, D-14).
 */
export interface MediaProgressEvent {
  jobId: string
  percent: number
  etaSec: number | null
}

/**
 * Media namespace — Phase 2 контракт (02-CONTEXT.md D-14).
 * pickFile/probe/extractAudio/cancel — request-response через ipcRenderer.invoke.
 * onProgress — подписка на event-канал MEDIA_PROGRESS, возвращает unsubscribe-функцию.
 */
export interface MediaApi {
  pickFile: () => Promise<Result<{ path: string } | null>>
  probe: (path: string) => Promise<Result<MediaProbeResult>>
  extractAudio: (path: string) => Promise<Result<MediaExtractResult>>
  cancel: (jobId: string) => Promise<Result>
  onProgress: (cb: (event: MediaProgressEvent) => void) => () => void
}

/**
 * Корневой API, который preload экспонирует в renderer как `window.scrubber`.
 * Расширяется новыми namespaces в Phase 2..4.
 */
export interface ScrubberApi {
  settings: SettingsApi
  media: MediaApi
  /**
   * Electron 32+ drag-drop fix (02-05 Gap 1).
   * `File.path` удалён в Electron ≥32; renderer получает абсолютный путь
   * только через `webUtils.getPathForFile(file)` в preload.
   * Это renderer-side утилита, НЕ IPC — без Result-обёртки, синхронная.
   */
  getPathForFile: (file: File) => string
}
