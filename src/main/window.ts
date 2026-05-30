// Фабрика BrowserWindow с безопасными webPreferences (D-14, Anti-Pattern #1).
//
// Источник: 01-RESEARCH.md §Pattern 1.
//
// КОНТРАКТ:
//   - sandbox: true, contextIsolation: true, nodeIntegration: false (D-14).
//   - webSecurity: true, allowRunningInsecureContent: false (явно, чтобы не сломать ревью).
//   - Любая внешняя ссылка → shell.openExternal + { action: 'deny' } (Pattern 1).
//   - В dev — ELECTRON_RENDERER_URL, в prod — локальный index.html.

import { BrowserWindow, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ESM-аналог __dirname: main собирается как ESM (Pitfall #3).
// `import.meta.url` определён только в ESM-контексте; vitest при тестах не вызывает
// createWindow() — фабрика URL вычисляется лениво в самом вызове, не на верхнем уровне.
function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

// is.dev — inlined, чтобы не тянуть @electron-toolkit/utils в граф window.ts.
// Тот пакет на верхнем уровне делает `import { app, session, ipcMain, BrowserWindow } from 'electron'`,
// что ломает vitest-мок (vitest externalizes node_modules → real CJS electron вместо vi.mock).
const isDev = !!process.env['ELECTRON_RENDERER_URL']

export function createWindow(): BrowserWindow {
  const __dirname = moduleDir()
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Внешние ссылки — в системный браузер. Только http/https — не open file://, javascript: и т.п.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(url)
      }
    } catch {
      // невалидный URL — игнорируем
    }
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
