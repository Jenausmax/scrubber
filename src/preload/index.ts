// Preload bridge — единственная точка контакта renderer ↔ main (D-08, D-11, D-14).
//
// Контракт:
//   - Эспонируем РОВНО один namespace `settings` с четырьмя функциями (D-09 — никаких заглушек
//     под media/transcribe/llm; они придут в Phase 2..4).
//   - Каналы — только через `Channels.*` из shared/ipc; никаких строковых литералов (anti-pattern).
//   - Fail-loud при `process.contextIsolated === false` (D-14): рендерер не должен получить
//     прямой доступ к ipcRenderer ни при каких условиях.
//   - Никаких импортов `node:*`, `fs`, `path`, `child_process`, `os` (Pitfall #9, sandboxed preload).

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { Channels } from '../shared/ipc'
import type {
  MediaProgressEvent,
  ModelProgressEvent,
  ScrubberApi,
  TranscribeProgressEvent,
  TranscribeSegmentEvent
} from '../shared/ipc'

if (!process.contextIsolated) {
  throw new Error(
    'preload: contextIsolation must be enabled (D-14). Refusing to bridge into a shared world.'
  )
}

const scrubber: ScrubberApi = {
  settings: {
    saveApiKey: (key) => ipcRenderer.invoke(Channels.SETTINGS_SAVE_API_KEY, key),
    hasApiKey: () => ipcRenderer.invoke(Channels.SETTINGS_HAS_API_KEY),
    clearApiKey: () => ipcRenderer.invoke(Channels.SETTINGS_CLEAR_API_KEY),
    getSecureBackend: () => ipcRenderer.invoke(Channels.SETTINGS_GET_SECURE_BACKEND),
    getPreferences: () => ipcRenderer.invoke(Channels.SETTINGS_GET_PREFERENCES),
    setPreference: (key, value) =>
      ipcRenderer.invoke(Channels.SETTINGS_SET_PREFERENCE, key, value)
  },
  // Phase 2 Plan 01 (02-CONTEXT.md D-14, D-15): namespace media.*
  // onProgress подписывается на event-канал MEDIA_PROGRESS и возвращает unsubscribe.
  media: {
    pickFile: () => ipcRenderer.invoke(Channels.MEDIA_PICK_FILE),
    probe: (path) => ipcRenderer.invoke(Channels.MEDIA_PROBE, path),
    extractAudio: (path) => ipcRenderer.invoke(Channels.MEDIA_EXTRACT, path),
    cancel: (jobId) => ipcRenderer.invoke(Channels.MEDIA_CANCEL, jobId),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, payload: MediaProgressEvent): void => cb(payload)
      ipcRenderer.on(Channels.MEDIA_PROGRESS, listener)
      return (): void => {
        ipcRenderer.removeListener(Channels.MEDIA_PROGRESS, listener)
      }
    }
  },
  // Phase 3 Plan 01 (03-RESEARCH.md TRANS-01..07): namespace transcribe.*
  // start/cancel/saveAs/openFile/revealInFolder — request-response через invoke.
  // onProgress/onSegment подписываются на event-каналы и возвращают unsubscribe.
  transcribe: {
    start: (audioPath, opts) => ipcRenderer.invoke(Channels.TRANSCRIBE_START, audioPath, opts),
    cancel: (jobId) => ipcRenderer.invoke(Channels.TRANSCRIBE_CANCEL, jobId),
    saveAs: (md, defaultName) => ipcRenderer.invoke(Channels.TRANSCRIBE_SAVE_AS, md, defaultName),
    openFile: (path) => ipcRenderer.invoke(Channels.TRANSCRIBE_OPEN, path),
    revealInFolder: (path) => ipcRenderer.invoke(Channels.TRANSCRIBE_REVEAL, path),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, payload: TranscribeProgressEvent): void => cb(payload)
      ipcRenderer.on(Channels.TRANSCRIBE_PROGRESS, listener)
      return (): void => {
        ipcRenderer.removeListener(Channels.TRANSCRIBE_PROGRESS, listener)
      }
    },
    onSegment: (cb) => {
      const listener = (_e: IpcRendererEvent, payload: TranscribeSegmentEvent): void => cb(payload)
      ipcRenderer.on(Channels.TRANSCRIBE_SEGMENT, listener)
      return (): void => {
        ipcRenderer.removeListener(Channels.TRANSCRIBE_SEGMENT, listener)
      }
    }
  },
  // Phase 3 Plan 01 (03-RESEARCH.md TRANS-02, D-10): namespace models.*
  models: {
    list: () => ipcRenderer.invoke(Channels.MODELS_LIST),
    download: (name) => ipcRenderer.invoke(Channels.MODELS_DOWNLOAD, name),
    cancel: (jobId) => ipcRenderer.invoke(Channels.MODELS_CANCEL, jobId),
    delete: (name) => ipcRenderer.invoke(Channels.MODELS_DELETE, name),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, payload: ModelProgressEvent): void => cb(payload)
      ipcRenderer.on(Channels.MODELS_PROGRESS, listener)
      return (): void => {
        ipcRenderer.removeListener(Channels.MODELS_PROGRESS, listener)
      }
    }
  },
  // 02-05 Gap 1: Electron 32+ удалил File.path. webUtils.getPathForFile —
  // единственный поддерживаемый API получения absolute-пути из DataTransfer.files
  // в sandboxed preload (D-14).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('scrubber', scrubber)
