// IPC handlers для media namespace — Phase 2 Plan 01 (02-CONTEXT.md D-14, D-15, D-16).
//
// КОНТРАКТ Plan 01 (skeleton-only):
//   - Зарегистрированы 4 ipcMain.handle на Channels.MEDIA_PICK_FILE/PROBE/EXTRACT/CANCEL.
//   - Все 4 handler'а возвращают { ok:false, reason:'internal' } — это stub,
//     реальная логика приходит в Plan 02 (services/media-extractor.ts + utilityProcess).
//   - MEDIA_PROGRESS НЕ регистрируется через ipcMain.handle — это event-канал,
//     main шлёт через webContents.send (02-PATTERNS.md, 02-RESEARCH.md §Pattern 3).
//   - Никаких строковых литералов 'media:...' — только через Channels.*.
//   - Никаких throw через границу IPC (Pitfall #7 Phase 1 → Phase 1 §Result-тип).
//
// Аналог: src/main/ipc/settings.ts (та же shape try/catch + Result + console.error префикс).

import { ipcMain } from 'electron'
import { Channels, type Result } from '../../shared/ipc'

const LOG_PREFIX = '[ipc/media]'

export function registerMediaHandlers(): void {
  // Plan 02 заменит на real-implementation: dialog.showOpenDialog в BrowserWindow.fromWebContents.
  ipcMain.handle(Channels.MEDIA_PICK_FILE, async (): Promise<Result> => {
    try {
      // TODO(Plan 02): dialog.showOpenDialog + Result<{ path }|null>.
      return { ok: false, reason: 'internal' }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} pickFile internal error:`, err)
      return { ok: false, reason: 'internal' }
    }
  })

  // Plan 02 заменит на real-implementation: mediaExtractor.probe(path).
  ipcMain.handle(Channels.MEDIA_PROBE, async (): Promise<Result> => {
    try {
      // TODO(Plan 02): валидация path + ffprobe spawn + Result<MediaProbeResult>.
      return { ok: false, reason: 'internal' }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} probe internal error:`, err)
      return { ok: false, reason: 'internal' }
    }
  })

  // Plan 02 заменит на real-implementation: mediaExtractor.startExtract(path, durationSec).
  ipcMain.handle(Channels.MEDIA_EXTRACT, async (): Promise<Result> => {
    try {
      // TODO(Plan 02): utilityProcess.fork(ffmpeg-runner.cjs) + Result<MediaExtractResult>.
      return { ok: false, reason: 'internal' }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} extractAudio internal error:`, err)
      return { ok: false, reason: 'internal' }
    }
  })

  // Plan 02 заменит на real-implementation: mediaExtractor.cancel(jobId).
  ipcMain.handle(Channels.MEDIA_CANCEL, async (): Promise<Result> => {
    try {
      // TODO(Plan 02): handle.proc.kill('SIGTERM') + cleanup tmp.
      return { ok: false, reason: 'internal' }
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} cancel internal error:`, err)
      return { ok: false, reason: 'internal' }
    }
  })
}
