// IPC handlers для models namespace — Phase 3 Plan 03 (TRANS-02, D-10).
//
// Источник: 03-PATTERNS.md §ipc/models.ts (264-273), §Security Domain (505-526),
//   эталон src/main/ipc/media.ts (handle-wrapper + UUID_REGEX), 03-CONTEXT.md D-09/D-10.
//
// КОНТРАКТ:
//   - 4 ipcMain.handle: Channels.MODELS_LIST / DOWNLOAD / CANCEL / DELETE.
//   - MODELS_PROGRESS НЕ регистрируется через ipcMain.handle — event-канал шлёт
//     modelManager через webContents.send.
//   - Анти-SSRF (T-3-07): model-name из renderer недоверенный. MODELS_DOWNLOAD/DELETE
//     валидируют name ∈ MODEL_WHITELIST {small,medium,large-v3}; URL строится ТОЛЬКО
//     из pinned MODEL_MANIFEST в model-manager, НИКОГДА из renderer-строки.
//   - MODELS_CANCEL — UUID regex /^[0-9a-f-]{36}$/.
//   - Reason-коды строго из ModelReason. Никаких throw через IPC (Pitfall #7 Phase 1).

import { ipcMain } from 'electron'
import {
  Channels,
  type ModelReason,
  type Result
} from '../../shared/ipc'
import { modelManager, type ModelInfo } from '../services/model-manager'

const LOG_PREFIX = '[ipc/models]'
const UUID_REGEX = /^[0-9a-f-]{36}$/i

/**
 * Whitelist selectable-моделей (анти-SSRF, T-3-07). Renderer может прислать ТОЛЬКО
 * одно из этих имён; URL строится из MODEL_MANIFEST в model-manager, не из аргумента.
 */
export const MODEL_WHITELIST = new Set<string>(['small', 'medium', 'large-v3'])

export function registerModelsHandlers(): void {
  // MODELS_LIST — перечень моделей + downloaded-статус (без аргументов).
  ipcMain.handle(Channels.MODELS_LIST, async (): Promise<Result<ModelInfo[]>> => {
    try {
      return await modelManager.list()
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} list internal error:`, err)
      return { ok: false, reason: 'internal' }
    }
  })

  // MODELS_DOWNLOAD — whitelist-валидация name → modelManager.download().
  ipcMain.handle(
    Channels.MODELS_DOWNLOAD,
    async (_event, ...args: unknown[]): Promise<Result<{ jobId: string }>> => {
      try {
        const name = args[0]
        if (typeof name !== 'string' || !MODEL_WHITELIST.has(name)) {
          return { ok: false, reason: 'invalid_argument' as ModelReason }
        }
        return await modelManager.download(name)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} download internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // MODELS_CANCEL — UUID-regex валидация jobId → modelManager.cancel().
  ipcMain.handle(
    Channels.MODELS_CANCEL,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const jobId = args[0]
        if (typeof jobId !== 'string' || !UUID_REGEX.test(jobId)) {
          return { ok: false, reason: 'invalid_argument' }
        }
        return await modelManager.cancel(jobId)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} cancel internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // MODELS_DELETE — whitelist-валидация name → modelManager.delete().
  ipcMain.handle(
    Channels.MODELS_DELETE,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const name = args[0]
        if (typeof name !== 'string' || !MODEL_WHITELIST.has(name)) {
          return { ok: false, reason: 'invalid_argument' }
        }
        return await modelManager.delete(name)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} delete internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )
}
