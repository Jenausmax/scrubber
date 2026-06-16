// IPC handlers для transcribe namespace — Phase 3 Plan 02 (ядро ценности).
//
// Источник: 03-PATTERNS.md §ipc/transcribe.ts (225-260), зеркало src/main/ipc/media.ts;
// 03-RESEARCH.md §Security Domain (505-526); threat_model 03-02-PLAN (T-3-03/04/06).
//
// КОНТРАКТ:
//   - ipcMain.handle: TRANSCRIBE_START / CANCEL / OPEN / REVEAL.
//   - TRANSCRIBE_PROGRESS/SEGMENT НЕ регистрируются через handle — event-каналы шлёт
//     transcriber через webContents.send.
//   - TRANSCRIBE_SAVE_AS (03-04): saveAs(md) — defaultName формирует MAIN из
//     transcriber.getCurrentAudioPath() (basename + '.transcript.md'), НЕ из renderer
//     (T-3-06, warning-5). Путь записи — ТОЛЬКО из dialog.showSaveDialog. md-контент — текст.
//   - Defence-in-depth (T-3-03): audioPath — string + isAbsolute + fs.access R_OK
//     (→ audio_not_found). model — whitelist; language — непустая строка.
//   - TRANSCRIBE_CANCEL: UUID-regex перед transcriber.cancel.
//   - TRANSCRIBE_OPEN/REVEAL: shell только для сгенерированного нами mdPath (T-3-06).
//   - Reason-коды строго из TranscribeReason. Никаких throw через IPC (Pitfall #7).

import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs, constants as fsc } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import {
  Channels,
  type Result,
  type TranscribeReason,
  type TranscribeStartResult
} from '../../shared/ipc'
import { transcriber } from '../services/transcriber'

const LOG_PREFIX = '[ipc/transcribe]'
const UUID_REGEX = /^[0-9a-f-]{36}$/i
// Whitelist whisper-моделей (03-RESEARCH.md §Model Manifest).
const MODEL_WHITELIST = new Set(['small', 'medium', 'large-v3'])

/**
 * Defence-in-depth валидация audioPath для TRANSCRIBE_START (T-3-03):
 *   1. typeof === 'string' && непустой
 *   2. isAbsolute (path-traversal)
 *   3. fs.access R_OK → audio_not_found
 */
async function validateAudioPath(
  arg: unknown
): Promise<{ ok: true; path: string } | { ok: false; reason: TranscribeReason }> {
  if (typeof arg !== 'string' || arg.length === 0) {
    return { ok: false, reason: 'invalid_argument' }
  }
  if (!isAbsolute(arg)) {
    return { ok: false, reason: 'invalid_argument' }
  }
  try {
    await fs.access(arg, fsc.R_OK)
  } catch {
    return { ok: false, reason: 'audio_not_found' }
  }
  return { ok: true, path: arg }
}

export function registerTranscribeHandlers(): void {
  // TRANSCRIBE_START — validation → transcriber.startTranscribe (резолвится по завершению).
  ipcMain.handle(
    Channels.TRANSCRIBE_START,
    async (_event, ...args: unknown[]): Promise<Result<TranscribeStartResult>> => {
      try {
        const v = await validateAudioPath(args[0])
        if (!v.ok) return v
        const opts = args[1]
        if (typeof opts !== 'object' || opts === null) {
          return { ok: false, reason: 'invalid_argument' }
        }
        const { model, language } = opts as { model?: unknown; language?: unknown }
        if (typeof model !== 'string' || !MODEL_WHITELIST.has(model)) {
          return { ok: false, reason: 'invalid_argument' }
        }
        if (typeof language !== 'string' || language.length === 0) {
          return { ok: false, reason: 'invalid_argument' }
        }
        return await transcriber.startTranscribe(v.path, { model, language })
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} start internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // TRANSCRIBE_CANCEL — UUID-regex validation → transcriber.cancel.
  ipcMain.handle(
    Channels.TRANSCRIBE_CANCEL,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const jobId = args[0]
        if (typeof jobId !== 'string' || !UUID_REGEX.test(jobId)) {
          return { ok: false, reason: 'invalid_argument' }
        }
        return await transcriber.cancel(jobId)
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} cancel internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // TRANSCRIBE_SAVE_AS — экспорт .md через системный диалог (D-05, TRANS-07, T-3-06).
  //   - принимает ТОЛЬКО md-контент (string); имя файла из renderer ИГНОРИРУЕТСЯ;
  //   - defaultName формирует MAIN: basename(transcriber.getCurrentAudioPath()) + '.transcript.md';
  //   - путь записи берётся ТОЛЬКО из dialog.showSaveDialog (доверенный);
  //   - отмена диалога → Result<null>; успех → Result<{path}>.
  ipcMain.handle(
    Channels.TRANSCRIBE_SAVE_AS,
    async (event, ...args: unknown[]): Promise<Result<{ path: string } | null>> => {
      try {
        const md = args[0]
        if (typeof md !== 'string') {
          return { ok: false, reason: 'invalid_argument' }
        }
        // defaultName формирует main из audioPath (НЕ из renderer-строки args[1]).
        const audioPath = transcriber.getCurrentAudioPath()
        const base = audioPath ? basename(audioPath) : 'transcript'
        const defaultName = `${base}.transcript.md`

        const win = BrowserWindow.fromWebContents(event.sender)
        if (!win) return { ok: false, reason: 'internal' }
        const res = await dialog.showSaveDialog(win, {
          defaultPath: defaultName,
          filters: [{ name: 'Markdown', extensions: ['md'] }]
        })
        if (res.canceled || !res.filePath) {
          return { ok: true, data: null }
        }
        // Путь — ТОЛЬКО из dialog-результата (T-3-06).
        await fs.writeFile(res.filePath, md, 'utf8')
        return { ok: true, data: { path: res.filePath } }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} saveAs internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // TRANSCRIBE_OPEN — shell.openPath для сгенерированного нами .md (T-3-06).
  ipcMain.handle(
    Channels.TRANSCRIBE_OPEN,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const mdPath = args[0]
        if (typeof mdPath !== 'string' || !isAbsolute(mdPath) || !mdPath.endsWith('.md')) {
          return { ok: false, reason: 'invalid_argument' }
        }
        const errMsg = await shell.openPath(mdPath)
        if (errMsg) {
          // eslint-disable-next-line no-console
          console.error(`${LOG_PREFIX} openPath failed: ${errMsg}`)
          return { ok: false, reason: 'internal' }
        }
        return { ok: true }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} open internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )

  // TRANSCRIBE_REVEAL — shell.showItemInFolder для сгенерированного нами .md (T-3-06).
  ipcMain.handle(
    Channels.TRANSCRIBE_REVEAL,
    async (_event, ...args: unknown[]): Promise<Result> => {
      try {
        const mdPath = args[0]
        if (typeof mdPath !== 'string' || !isAbsolute(mdPath) || !mdPath.endsWith('.md')) {
          return { ok: false, reason: 'invalid_argument' }
        }
        shell.showItemInFolder(mdPath)
        return { ok: true }
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error(`${LOG_PREFIX} reveal internal error:`, err)
        return { ok: false, reason: 'internal' }
      }
    }
  )
}
