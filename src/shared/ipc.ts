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
  MEDIA_PROGRESS: 'media:progress',
  /** transcribe.start(audioPath,{model,language}) — старт whisper-job через utilityProcess.fork (03-CONTEXT.md D-08, D-14, TRANS-01/06). */
  TRANSCRIBE_START: 'transcribe:start',
  /** transcribe.cancel(jobId) — SIGTERM в whisper utility-процесс → reason cancelled (03-RESEARCH.md TRANS-05). */
  TRANSCRIBE_CANCEL: 'transcribe:cancel',
  /** transcribe:progress — event-канал, percent из stderr `progress=N%` (03-RESEARCH.md TRANS-04). */
  TRANSCRIBE_PROGRESS: 'transcribe:progress',
  /** transcribe:segment — event-канал, живые сегменты из stdout SEG-regex (03-RESEARCH.md TRANS-04). */
  TRANSCRIBE_SEGMENT: 'transcribe:segment',
  /** transcribe.saveAs(md,defaultName?) — нативный save dialog для итогового .md (03-CONTEXT.md D-04, TRANS-03). */
  TRANSCRIBE_SAVE_AS: 'transcribe:saveAs',
  /** transcribe.openFile(path) — shell.openPath сохранённого .md (TRANS-03 UX). */
  TRANSCRIBE_OPEN: 'transcribe:open',
  /** transcribe.revealInFolder(path) — shell.showItemInFolder для .md (TRANS-03 UX). */
  TRANSCRIBE_REVEAL: 'transcribe:reveal',
  /** models.list() — перечень доступных whisper-моделей + статус downloaded (03-RESEARCH.md TRANS-02, D-10). */
  MODELS_LIST: 'models:list',
  /** models.download(name) — старт download-job с SHA256-проверкой (03-RESEARCH.md TRANS-02, D-10). */
  MODELS_DOWNLOAD: 'models:download',
  /** models.cancel(jobId) — отмена download-job (03-RESEARCH.md TRANS-02). */
  MODELS_CANCEL: 'models:cancel',
  /** models.delete(name) — удалить скачанную модель из userData/models (03-RESEARCH.md TRANS-02). */
  MODELS_DELETE: 'models:delete',
  /** models:progress — event-канал, percent скачивания модели (03-RESEARCH.md TRANS-02). */
  MODELS_PROGRESS: 'models:progress'
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
 * Reason-коды для transcribe-handler'ов (03-CONTEXT.md D-16, зеркало MediaReason).
 * Все handler'ы возвращают Result, никаких throw через границу IPC (Pitfall #7 Phase 1).
 */
export type TranscribeReason =
  | 'invalid_argument'
  | 'model_missing'
  | 'audio_not_found'
  | 'whisper_failed'
  | 'cancelled'
  | 'disk_full'
  | 'internal'

/**
 * Reason-коды для models-handler'ов (03-RESEARCH.md TRANS-02, D-10).
 * sha_mismatch — целостность скачанной модели (анти-коррупция, не безопасность).
 */
export type ModelReason =
  | 'invalid_argument'
  | 'download_failed'
  | 'sha_mismatch'
  | 'cancelled'
  | 'disk_full'
  | 'internal'

/**
 * Event-payload, который main шлёт в renderer через webContents.send(TRANSCRIBE_PROGRESS)
 * (03-RESEARCH.md TRANS-04 — percent из stderr `progress=N%`, cap 99). Зеркало MediaProgressEvent.
 */
export interface TranscribeProgressEvent {
  jobId: string
  percent: number
}

/**
 * Event-payload живого сегмента транскрипции, webContents.send(TRANSCRIBE_SEGMENT)
 * (03-RESEARCH.md TRANS-04 — SEG-regex по stdout: startMs + текст).
 */
export interface TranscribeSegmentEvent {
  jobId: string
  startMs: number
  text: string
}

/**
 * Event-payload прогресса скачивания модели, webContents.send(MODELS_PROGRESS)
 * (03-RESEARCH.md TRANS-02).
 */
export interface ModelProgressEvent {
  name: string
  percent: number
}

/**
 * Результат transcribe.start — итог транскрипции (03-02, ядро ценности).
 * start резолвится по завершению whisper-job (зеркало MediaExtractResult, который
 * резолвится по exit ffmpeg): jobId + путь к авто-сохранённому .md + готовый текст
 * (для немедленного показа в окне без повторного чтения файла) + накопленные сегменты
 * (для тумблера таймкодов в 03-04 без re-run, D-02).
 */
export interface TranscribeStartResult {
  jobId: string
  mdPath: string
  text: string
  segments: Array<{ startMs: number; text: string }>
}

/**
 * Transcribe namespace — Phase 3 контракт (03-RESEARCH.md TRANS-01..07).
 * start/cancel/saveAs/openFile/revealInFolder — request-response через ipcRenderer.invoke.
 * onProgress/onSegment — подписка на event-каналы TRANSCRIBE_PROGRESS/TRANSCRIBE_SEGMENT,
 * каждая возвращает unsubscribe-функцию (зеркало MediaApi.onProgress).
 * GREEN-реализация распределена по слайсам 03-02 (ядро pipeline) / 03-04 (UX).
 */
export interface TranscribeApi {
  start: (
    audioPath: string,
    opts: { model: string; language: string }
  ) => Promise<Result<TranscribeStartResult>>
  cancel: (jobId: string) => Promise<Result>
  /** defaultName опционален — имя файла формирует main (03-04), не renderer. */
  saveAs: (md: string, defaultName?: string) => Promise<Result<{ path: string } | null>>
  openFile: (path: string) => Promise<Result>
  revealInFolder: (path: string) => Promise<Result>
  onProgress: (cb: (event: TranscribeProgressEvent) => void) => () => void
  onSegment: (cb: (event: TranscribeSegmentEvent) => void) => () => void
}

/**
 * Models namespace — Phase 3 контракт (03-RESEARCH.md TRANS-02, D-10).
 * list/download/cancel/delete — request-response через ipcRenderer.invoke.
 * onProgress — подписка на event-канал MODELS_PROGRESS, возвращает unsubscribe-функцию.
 * GREEN-реализация — в слайсе 03-03 (управление моделями).
 */
export interface ModelsApi {
  list: () => Promise<Result<Array<{ name: string; sizeBytes: number; downloaded: boolean }>>>
  download: (name: string) => Promise<Result<{ jobId: string }>>
  cancel: (jobId: string) => Promise<Result>
  delete: (name: string) => Promise<Result>
  onProgress: (cb: (event: ModelProgressEvent) => void) => () => void
}

/**
 * Корневой API, который preload экспонирует в renderer как `window.scrubber`.
 * Расширяется новыми namespaces в Phase 2..4.
 */
export interface ScrubberApi {
  settings: SettingsApi
  media: MediaApi
  /** Транскрипция аудио → текст через локальный whisper-cli (03-RESEARCH.md TRANS-01..07). */
  transcribe: TranscribeApi
  /** Управление whisper-моделями: список / скачивание / удаление (03-RESEARCH.md TRANS-02, D-10). */
  models: ModelsApi
  /**
   * Electron 32+ drag-drop fix (02-05 Gap 1).
   * `File.path` удалён в Electron ≥32; renderer получает абсолютный путь
   * только через `webUtils.getPathForFile(file)` в preload.
   * Это renderer-side утилита, НЕ IPC — без Result-обёртки, синхронная.
   */
  getPathForFile: (file: File) => string
}
