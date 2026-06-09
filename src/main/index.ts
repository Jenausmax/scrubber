// Main bootstrap (D-14, Pitfall #5).
//
// Источник: 01-RESEARCH.md §Pattern 4.
//
// Строгий порядок инициализации внутри app.whenReady():
//   1. secureBackend.init()        — детект backend (Pitfall #5: safeStorage до ready невалиден)
//   2. await settingsStore.init()  — electron-store dynamic import (Pitfall #3)
//   3. await secretsStore.init()   — читает secrets.bin через safeStorage.decryptString
//   4. registerIpcHandlers()       — handler'ы должны быть готовы ДО первого окна
//   5. createWindow()              — окно может сразу вызвать invoke()

import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow } from './window'
import { secureBackend } from './services/secure-backend'
import { secretsStore } from './services/secrets-store'
import { settingsStore } from './services/settings-store'
import { mediaExtractor } from './services/media-extractor'
import { transcriber } from './services/transcriber'
import { registerIpcHandlers } from './ipc'

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('com.scrubber.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 1. Backend detection (после ready, Pitfall #5)
    secureBackend.init()

    // 2. electron-store dynamic import (Pitfall #3)
    await settingsStore.init()

    // 3. Secrets (читает secrets.bin через safeStorage)
    await secretsStore.init()

    // 4. IPC handlers — до открытия окна
    registerIpcHandlers()

    // 5. Media extractor init — chmod ffmpeg/ffprobe (D-18, Pitfall #2) + mkdir extracted/.
    //    После registerIpcHandlers, ДО createWindow — окно может сразу дёрнуть media:probe.
    try {
      await mediaExtractor.init()
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[main] mediaExtractor.init failed:', err)
      // Не падаем целиком — settings/secrets уже работают; ffmpeg-handler вернёт reason при первом invoke.
    }

    // 5b. Transcriber init — assertBinaryExists(whisper-cli) + chmod (Pitfall #2) +
    //     mkdir userData/models/. Тот же try/catch-паттерн: init-throw не валит окно,
    //     transcribe-handler вернёт reason ('internal'/'model_missing') при первом invoke (Gap 3).
    try {
      await transcriber.init()
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[main] transcriber.init failed:', err)
    }

    // 6. Окно
    createWindow()

    app.on('activate', () => {
      // macOS: re-open окно при клике на иконку Dock
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[main] bootstrap failed:', err)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
