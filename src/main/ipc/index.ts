// Registry IPC handler'ов. Точка расширения для будущих namespaces (D-09):
// media.* (Phase 2), transcribe.* (Phase 3), llm.* (Phase 4).
//
// Источник: 01-RESEARCH.md §Pattern 2, 01-PATTERNS.md §IPC contract shape.

import { registerSettingsHandlers } from './settings'
import { registerMediaHandlers } from './media'
import { registerTranscribeHandlers } from './transcribe'
import { registerModelsHandlers } from './models'

export function registerIpcHandlers(): void {
  registerSettingsHandlers()
  registerMediaHandlers()
  registerTranscribeHandlers() // Phase 3 — transcribe.* (ядро ценности)
  registerModelsHandlers() // Phase 3 — models.* (управление моделями, TRANS-02)
  // future: registerLlmHandlers() — Phase 4
}
