// Preload bridge — единственная точка контакта renderer ↔ main (D-08, D-11, D-14).
//
// Контракт:
//   - Эспонируем РОВНО один namespace `settings` с четырьмя функциями (D-09 — никаких заглушек
//     под media/transcribe/llm; они придут в Phase 2..4).
//   - Каналы — только через `Channels.*` из shared/ipc; никаких строковых литералов (anti-pattern).
//   - Fail-loud при `process.contextIsolated === false` (D-14): рендерер не должен получить
//     прямой доступ к ipcRenderer ни при каких условиях.
//   - Никаких импортов `node:*`, `fs`, `path`, `child_process`, `os` (Pitfall #9, sandboxed preload).

import { contextBridge, ipcRenderer } from 'electron'
import { Channels } from '../shared/ipc'
import type { ScrubberApi } from '../shared/ipc'

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
    getSecureBackend: () => ipcRenderer.invoke(Channels.SETTINGS_GET_SECURE_BACKEND)
  }
}

contextBridge.exposeInMainWorld('scrubber', scrubber)
