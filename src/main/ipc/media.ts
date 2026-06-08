// IPC handlers для media namespace — Phase 2 Plan 02 (полная реализация).
//
// Источник: 02-CONTEXT.md D-04, D-06, D-14, D-15, D-16, 02-PATTERNS.md §src/main/ipc/media.ts,
// 02-RESEARCH.md §Pattern 1 (pickFile), §Security Domain V5 (валидация в main).
//
// КОНТРАКТ:
//   - 4 ipcMain.handle: Channels.MEDIA_PICK_FILE / PROBE / EXTRACT / CANCEL.
//   - MEDIA_PROGRESS НЕ регистрируется через ipcMain.handle — event-канал шлёт
//     mediaExtractor через webContents.send.
//   - Defence-in-depth (D-06): isAbsolute + endsWith('.mp4') + fs.access(R_OK) ПЕРЕД
//     делегированием в mediaExtractor (даже если renderer уже валидировал).
//   - MEDIA_EXTRACT payload — string (только path); handler сам делает probe и
//     передаёт durationSec в startExtract (упрощает renderer, см. UI-SPEC State Map).
//   - MEDIA_CANCEL: UUID regex /^[0-9a-f-]{36}$/ перед mediaExtractor.cancel.
//   - Reason-коды строго из MediaReason (D-16). Никаких throw через IPC (Pitfall #7 Phase 1).

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { promises as fs, constants as fsc } from 'node:fs'
import { isAbsolute } from 'node:path'
import {
  Channels,
  type MediaExtractResult,
  type MediaProbeResult,
  type MediaReason,
  type Result
} from '../../shared/ipc'
import { mediaExtractor } from '../services/media-extractor'

const LOG_PREFIX = '[ipc/media]'
const UUID_REGEX = /^[0-9a-f-]{36}$/i

/**
 * Defence-in-depth валидация mp4-пути для PROBE/EXTRACT (D-06):
 *   1. typeof === 'string'
 *   2. isAbsolute (T-02-02-01 mitigation, path traversal)
 *   3. endsWith('.mp4') case-insensitive (D-06)
 *   4. fs.access R_OK
 */
async function validateMp4Path(
  arg: unknown
): Promise<{ ok: true; path: string } | { ok: false; reason: MediaReason }> {
  if (typeof arg !== 'string' || arg.length === 0) {
    return { ok: false, reason: 'invalid_argument' }
  }
  if (!isAbsolute(arg)) {
    return { ok: false, reason: 'invalid_argument' }
  }
  if (!arg.toLowerCase().endsWith('.mp4')) {
    return { ok: false, reason: 'not_mp4' }
  }
  try {
    await fs.access(arg, fsc.R_OK)
  } catch {
    return { ok: false, reason: 'file_not_found' }
  }
  return { ok: true, path: arg }
}

export function registerMediaHandlers(): void {
  // MEDIA_PICK_FILE — нативный dialog. Возвращает Result<{path}|null>.
  // null — пользователь нажал Cancel в диалоге (D-04, RESEARCH Pattern 1).
  ipcMain.handle(
    Channels.MEDIA_PICK_FILE,
    async (event): Promise<Result<{ path: string } | null>> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, reason: 'internal' }
        const res = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'MP4', extensions: ['mp4'] }]
        })
        if (res.canceled || res.filePaths.length === 0) {
          return { ok: true, data: null }
        }
        return { ok: true, data: { path: res.filePaths[0] } }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} pickFile internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // MEDIA_PROBE — defence-in-depth validation → mediaExtractor.probe().
  ipcMain.handle(
    Channels.MEDIA_PROBE,
    async (_event, ...args: unknown[]): Promise<Result<MediaProbeResult>> => {
      try {
        const v = await validateMp4Path(args[0])
        if (!v.ok) return v
        return await mediaExtractor.probe(v.path)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} probe internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // MEDIA_EXTRACT — validation → probe (для durationSec) → mediaExtractor.startExtract().
  // Payload = string (только path); handler сам берёт durationSec из probe (см. UI-SPEC).
  ipcMain.handle(
    Channels.MEDIA_EXTRACT,
    async (_event, ...args: unknown[]): Promise<Result<MediaExtractResult>> => {
      try {
        const v = await validateMp4Path(args[0])
        if (!v.ok) return v
        const probe = await mediaExtractor.probe(v.path)
        if (!probe.ok) return probe
        return await mediaExtractor.startExtract(v.path, probe.data!.durationSec)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} extractAudio internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // MEDIA_CANCEL — UUID-regex validation → mediaExtractor.cancel().
  ipcMain.handle(
    Channels.MEDIA_CANCEL,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const jobId = args[0]
        if (typeof jobId !== 'string' || !UUID_REGEX.test(jobId)) {
          return { ok: false, reason: 'invalid_argument' }
        }
        return mediaExtractor.cancel(jobId)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} cancel internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )
}
