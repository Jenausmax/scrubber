# Phase 2: Media Extraction Pipeline — Pattern Map

**Mapped:** 2026-05-31
**Files analyzed:** 17 (создаются/модифицируются)
**Analogs found:** 16 / 17 (Phase 1 даёт прямой аналог почти для всего; единственное «новое в проекте» — utility-script для `utilityProcess.fork`, у него нет родного аналога, паттерн берём из `02-RESEARCH.md §Pattern 3`).
**Language:** ru

> **Принцип.** Phase 2 расширяет ровно те же кодовые конвенции, что заложила Phase 1 (типизированный IPC через `Channels`/`Result`, namespace-bridge в preload, fail-loud guard, singleton-сервисы в `src/main/services/`, Vitest + глобальный мок `electron`). Никаких новых конвенций не вводим. Все ссылки на «Pattern N» без префикса = `02-RESEARCH.md`; с префиксом `Phase 1 §…` = `.planning/phases/01-foundation-app-shell/01-PATTERNS.md`.

---

## Source-of-truth ссылки

| Источник | Что лежит | Кто использует |
|----------|-----------|----------------|
| `02-RESEARCH.md §Pattern 1` (file picker) | `dialog.showOpenDialog` + Result-обёртка | `src/main/ipc/media.ts` (handler `pickFile`) |
| `02-RESEARCH.md §Pattern 2` (drag&drop) | HTML5 drop + `file.path` (Electron-расширение), валидация .mp4 / files.length===1 | `src/renderer/src/components/DropZone.tsx`, `Transcribe.tsx` |
| `02-RESEARCH.md §Pattern 3` (utilityProcess + ffmpeg) | `utilityProcess.fork`, `proc.postMessage`/`on('message')`, Map<jobId, JobHandle>, write `<hash>.wav.tmp` → rename on exit 0 | `src/main/services/media-extractor.ts`, `src/main/utilities/ffmpeg-runner.ts` |
| `02-RESEARCH.md §Pattern 4` (progress parser) | парсинг `out_time_us=`, throttle через `lastPct`, ETA-формула | `src/main/services/progress-parser.ts`, `ffmpeg-runner.ts` |
| `02-RESEARCH.md §Pattern 5` (paths) | `.replace('app.asar','app.asar.unpacked')` + `ensureExecutable(p)` (chmod 0o755 на linux/darwin) | `src/main/services/ffmpeg-paths.ts` |
| `02-RESEARCH.md §Pattern 6` (ffprobe) | `child_process.spawn(ffprobePath, [...json])` в main (короткоживущий) | `src/main/services/media-extractor.ts` (метод `probe`) |
| `02-RESEARCH.md §Code Examples` (IPC контракт) | `MediaApi`, `MediaProbeResult`, `MediaExtractResult`, `MediaProgressEvent`, расширение `Channels` | `src/shared/ipc.ts`, `src/preload/index.ts` |
| `02-RESEARCH.md §Pitfall #5` (CJS utility) | utility-entrypoint собирается как CJS (`format: 'cjs'`, `entryFileNames: '[name].cjs'`) | `electron.vite.config.ts` |
| `02-RESEARCH.md §Pitfall #1/#2` + `electron-builder Application Contents` | `asarUnpack: ['node_modules/ffmpeg-static/**', 'node_modules/@ffprobe-installer/**']` | `electron-builder.yml` |
| `02-UI-SPEC.md §Component Inventory / State Map / Layout & Sizing` | FSM `idle→selected→extracting→done|error|cache-hit`, drop-zone `min-h-[240px] border-2 border-dashed`, кнопки `px-4 py-2 text-sm rounded-md bg-blue-600 text-white` | все renderer-файлы Phase 2 |
| `Phase 1 §IPC contract shape` | `Channels` — единственный источник строковых имён | `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc/media.ts` |
| `Phase 1 §Result-тип для IPC` | `try/catch` в каждом `ipcMain.handle`, `console.error('[ipc/<ns>]', err)`, return `{ ok:false, reason:'internal' }` | `src/main/ipc/media.ts` |
| `Phase 1 §Process boundary` | `webSecurity:true`, `sandbox:true`, fail-loud `process.contextIsolated` | сохраняется без изменений |
| `tests/setup.ts` (Wave 0 Phase 1) | глобальный мок `electron`, `utilityProcess.fork` уже заглушен `vi.fn()` | все `*.test.ts` Phase 2 (расширяем мок) |

---

## File Classification

| Файл | Origin | Role | Data Flow | Closest Analog | Match |
|------|--------|------|-----------|----------------|-------|
| `src/shared/ipc.ts` | **modify** | contract / types | n/a | `src/shared/ipc.ts` (Phase 1) | exact |
| `src/main/ipc/index.ts` | **modify** | registry | event-driven (ipcMain) | `src/main/ipc/index.ts` (Phase 1) | exact |
| `src/main/ipc/media.ts` | create | controller (IPC handlers) | request-response + event-stream | `src/main/ipc/settings.ts` | exact |
| `src/main/services/media-extractor.ts` | create | service (job orchestrator, singleton) | event-driven (utilityProcess) + CRUD (cache) | `src/main/services/secrets-store.ts` (singleton-сервис в `services/`) | role-match |
| `src/main/services/ffmpeg-paths.ts` | create | utility (path resolver) | sync read | `src/main/services/secure-backend.ts` (singleton-resolver) | role-match |
| `src/main/services/progress-parser.ts` | create | utility (pure function) | transform | — (нет аналога; чистая функция) | no-analog |
| `src/main/utilities/ffmpeg-runner.ts` | create | utility-process entrypoint (CJS) | event-driven (parentPort) + spawn child | `src/preload/index.ts` (тот же режим — CJS-bundle, общается через IPC, никакого общего шейпа кода) | partial / pitfall-mirror |
| `src/preload/index.ts` | **modify** | bridge | request-response + subscription | `src/preload/index.ts` (Phase 1) | exact |
| `src/preload/index.d.ts` | **modify** (no-op если `ScrubberApi` экспортирует media) | type declaration | n/a | `src/preload/index.d.ts` (Phase 1) | exact |
| `src/renderer/src/routes/Transcribe.tsx` | **replace** (placeholder) | component (FSM stateful screen) | request-response + subscription | `src/renderer/src/routes/Settings.tsx` | exact |
| `src/renderer/src/components/DropZone.tsx` | create | component (stateless) | event-driven (DOM) | `src/renderer/src/components/BackendWarningBanner.tsx` (Phase 1 — единственный кастомный компонент) | role-match |
| `src/renderer/src/components/FileMetaCard.tsx` | create | component (stateless) | static | `BackendWarningBanner.tsx` | role-match |
| `src/renderer/src/components/ExtractProgress.tsx` | create | component (stateless) | render props | `BackendWarningBanner.tsx` | role-match |
| `src/renderer/src/components/ExtractDone.tsx` | create | component (stateless) | render props | `BackendWarningBanner.tsx` | role-match |
| `src/renderer/src/components/InlineError.tsx` | create | component (stateless) | render props | `BackendWarningBanner.tsx` | role-match |
| `electron.vite.config.ts` | **modify** | config (build) | n/a | `electron.vite.config.ts` (Phase 1 — preload как CJS) | exact (тот же приём CJS-output) |
| `electron-builder.yml` | **modify** | config (packaging) | n/a | `electron-builder.yml` (расширяем `asarUnpack`) | template-baseline |
| `tests/setup.ts` | **modify** | test fixture | n/a | `tests/setup.ts` (Phase 1, `utilityProcess: { fork: vi.fn() }` уже есть — расширяем mock-возвратом) | exact |
| `src/main/ipc/media.test.ts` | create | unit test | n/a | `src/main/services/secure-backend.test.ts` (vi.mock + Channels) | role-match |
| `src/main/services/media-extractor.test.ts` | create | unit test | n/a | `src/main/services/secrets-store.test.ts` (изолированный async setup + tmp file) | role-match |
| `src/main/services/ffmpeg-paths.test.ts` | create | unit test | n/a | `src/main/services/secure-backend.test.ts` (platform-stub) | role-match |
| `src/main/services/progress-parser.test.ts` | create | unit test (pure) | n/a | `src/main/services/secure-backend.test.ts` (структура describe/it) | role-match |
| `src/preload/index.test.ts` | **modify** | unit test | n/a | `src/preload/index.test.ts` (Phase 1) | exact (расширяем allow-list ожиданий) |
| `src/renderer/src/routes/Transcribe.test.tsx` | create | unit test (React) | n/a | — (в Phase 1 renderer-тестов не было) | no-analog → RESEARCH §Wave 0 Gaps |
| `tests/integration/extract-real.test.ts` | create | integration test | n/a | `tests/integration/` (папка существует с Phase 1) | role-match |
| `tests/fixtures/media/generate.mjs` | create | dev tool (one-off) | n/a | — | no-analog |
| `02-VERIFICATION.md` | create | doc | n/a | `.planning/phases/01-foundation-app-shell/VERIFICATION.md` | exact |

---

## Pattern Assignments (per file)

> Для каждого файла указан режим, контракт, аналог-файл с путём и якорные строки. Планировщик не дублирует код — он ссылается на §Pattern в RESEARCH и на excerpt из аналога.

---

### `src/shared/ipc.ts` — contract / types (modify)

**Analog:** `src/shared/ipc.ts` (Phase 1) — расширяем тот же файл.

**Конвенция из Phase 1, строки 31-39 — `Channels` объект:**

```typescript
export const Channels = {
  SETTINGS_SAVE_API_KEY: 'settings:saveApiKey',
  SETTINGS_HAS_API_KEY: 'settings:hasApiKey',
  SETTINGS_CLEAR_API_KEY: 'settings:clearApiKey',
  SETTINGS_GET_SECURE_BACKEND: 'settings:getSecureBackend'
} as const
```

**Что добавить (по `02-RESEARCH.md §Code Examples`):**
- Расширить `Channels` на 5 новых ключей: `MEDIA_PICK_FILE='media:pickFile'`, `MEDIA_PROBE='media:probe'`, `MEDIA_EXTRACT='media:extractAudio'`, `MEDIA_CANCEL='media:cancel'`, `MEDIA_PROGRESS='media:progress'`.
- Добавить типы: `MediaReason` (union из D-16: `invalid_argument | not_mp4 | file_not_found | ffmpeg_failed | cancelled | disk_full | internal`), `MediaProbeResult`, `MediaExtractResult`, `MediaProgressEvent`, `MediaApi` (5 методов), расширить `ScrubberApi { settings; media }`.

**MUST соблюсти конвенцию Phase 1 (строки 12-18):**
- Каждая публичная сущность с JSDoc, в нём — ссылка на CONTEXT decision (D-14, D-15, D-16).
- Result-тип `{ ok: true; data?: T } | { ok: false; reason: string }` — НЕ переопределять, переиспользовать существующий из Phase 1 (строка 30).
- `event-канал` `media:progress` декларируется в `Channels` отдельно (это не invoke, а `webContents.send` → `ipcRenderer.on`).

---

### `src/main/ipc/index.ts` — registry (modify)

**Analog:** `src/main/ipc/index.ts` (Phase 1, целиком, 13 строк).

**Полный текущий файл:**

```typescript
import { registerSettingsHandlers } from './settings'

export function registerIpcHandlers(): void {
  registerSettingsHandlers()
  // future: registerMediaHandlers() — Phase 2     ← раскомментировать и реализовать
  // future: registerTranscribeHandlers() — Phase 3
  // future: registerLlmHandlers() — Phase 4
}
```

**Что добавить:** `import { registerMediaHandlers } from './media'` + вызов `registerMediaHandlers()` после `registerSettingsHandlers()`. Удалить TODO-коммент про Phase 2.

---

### `src/main/ipc/media.ts` — controller (IPC handlers, create)

**Analog:** `src/main/ipc/settings.ts` (целиком — это **exact match** по роли и data-flow).

**Imports pattern** (settings.ts строки 7-10):

```typescript
import { ipcMain } from 'electron'
import { Channels, type Result, type SecureBackend } from '../../shared/ipc'
import { secretsStore } from '../services/secrets-store'
import { secureBackend } from '../services/secure-backend'
```

→ Для media: добавить `import { BrowserWindow, dialog } from 'electron'`, `import { mediaExtractor } from '../services/media-extractor'`, `import type { MediaProbeResult, MediaExtractResult } from '../../shared/ipc'`.

**Handler skeleton** (settings.ts строки 16-32 — образец для `MEDIA_PICK_FILE`, `MEDIA_PROBE`, `MEDIA_EXTRACT`, `MEDIA_CANCEL`):

```typescript
ipcMain.handle(
  Channels.SETTINGS_SAVE_API_KEY,
  async (_event, ...args: unknown[]): Promise<Result> => {
    try {
      const key = args[0]
      if (typeof key !== 'string') {
        return { ok: false, reason: 'invalid_argument' }
      }
      return await secretsStore.saveApiKey(key)
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error('[ipc/settings] saveApiKey internal error:', err)
      return { ok: false, reason: 'internal' }
    }
  }
)
```

**Применить в media.ts:**
1. **Префикс лога** — `[ipc/media]`, не `[ipc/settings]`.
2. **Валидация args руками** — `typeof path === 'string'` / `path.isAbsolute(path)` для `MEDIA_PROBE`/`MEDIA_EXTRACT`; формат UUID для `jobId` в `MEDIA_CANCEL`. На несоответствии → `{ ok: false, reason: 'invalid_argument' }`.
3. **`pickFile` handler требует `BrowserWindow`** — взять из `02-RESEARCH.md §Pattern 1`:
   ```typescript
   const win = BrowserWindow.fromWebContents(event.sender)
   if (!win) return { ok: false, reason: 'internal' }
   const res = await dialog.showOpenDialog(win, {
     properties: ['openFile'],
     filters: [{ name: 'MP4', extensions: ['mp4'] }]
   })
   ```
4. **Defence-in-depth (D-06)** — в `MEDIA_PROBE`/`MEDIA_EXTRACT` повторно проверить `path.toLowerCase().endsWith('.mp4')` (renderer уже проверил, main — авторитет). Reason: `not_mp4`.
5. **`MEDIA_PROBE`/`MEDIA_EXTRACT`** возвращают `Result<MediaProbeResult>` / `Result<MediaExtractResult>` — делегируют в `mediaExtractor.probe(path)` / `mediaExtractor.startExtract(path, durationSec)`.
6. **Никаких `throw` через границу IPC** — все ошибки → Result (Pitfall #7 / Phase 1 §Result-тип).
7. **Progress event НЕ регистрируется здесь** — `webContents.send(Channels.MEDIA_PROGRESS, payload)` шлётся из `media-extractor` напрямую (по `02-RESEARCH.md §Pattern 3`, см. ниже).

---

### `src/main/services/media-extractor.ts` — service (singleton, create)

**Analog (role/structure):** `src/main/services/secrets-store.ts`.

**Singleton-конвенция** (secrets-store.ts последние строки):

```typescript
/** Singleton: единственный потребитель safeStorage.encrypt/decrypt в main. */
export const secretsStore = new SecretsStore()
```

→ Для нас: `export const mediaExtractor = new MediaExtractor()` с JSDoc «единственный владелец utility-процессов ffmpeg и кеша wav в userData».

**Stored data convention** (secrets-store.ts строки 32-34):

```typescript
async init(): Promise<void> {
  // Pitfall #8: всегда через app.getPath('userData'), не хардкодить пути.
  this.filePath = join(app.getPath('userData'), 'secrets.bin')
```

→ Для нас: `this.cacheDir = join(app.getPath('userData'), 'extracted')`. `fs.mkdir(this.cacheDir, { recursive: true })` в init (по аналогии с `ensureUserDataDir()`, secrets-store.ts строки 121-124).

**Error handling pattern** (secrets-store.ts строки 53-65 — try/catch с `ENOENT` веткой):

```typescript
} catch (err: unknown) {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') {
    this.diskCache = {}
    return
  }
  // eslint-disable-next-line no-console
  console.error('[secrets-store] failed to read secrets.bin, starting empty:', err)
```

→ Для нас: при `probe()`/`startExtract()` маппить `ENOENT` → `reason: 'file_not_found'`, `ENOSPC` → `'disk_full'`, прочее → `'internal'` (списки reason из D-16). Префикс лога — `[services/media-extractor]`.

**Жизненный цикл job (из `02-RESEARCH.md §Pattern 3`, обязательно):**
- `jobs: Map<string, JobHandle>`; jobId через `crypto.randomUUID()`.
- `startExtract(input, durationSec): Promise<Result<MediaExtractResult>>` — fork utility, регистрирует JobHandle, ждёт `exit`.
- Запись в `<hash>.wav.tmp`, переименование в `<hash>.wav` только на `code === 0`. На cancel/error — `fs.rm(tmp, {force:true})`.
- `cancel(jobId): Result` — `handle.cancelled = true; handle.proc.kill()` (SIGTERM).
- **Cache hit (D-12)**: до fork-а `fs.stat(<hash>.wav)`; если size > 0 — resolve мгновенно `{ ok:true, data: { jobId, audioPath } }` без spawning utility.
- **Hash (D-11)**: `crypto.createHash('sha1').update(`${abs}:${size}:${mtimeMs}`).digest('hex')`. Документировать в комментарии «non-security hash» (RESEARCH §Security Domain V6).
- **Progress relay**: на `proc.on('message', m => { if (m.type === 'progress') BrowserWindow.getAllWindows()[0]?.webContents.send(Channels.MEDIA_PROGRESS, { jobId, percent, etaSec }) })`. См. assumption A6.
- **probe(path)**: короткоживущий `child_process.spawn(resolveFfprobe(), ['-hide_banner','-loglevel','error','-print_format','json','-show_format','-show_streams', path])`, парсит JSON, возвращает `{ durationSec, sizeBytes, name }`. `02-RESEARCH.md §Pattern 6` явно разрешает spawn из main для коротких процессов.

**Security (RESEARCH §Security Domain):**
- `spawn(ffmpegPath, args)` БЕЗ shell. Между опциями и `inputPath` ставить `'--'` separator против argument injection: `[..., '-y', outputPath]` (outputPath под нашим контролем — `<hash>.wav`, безопасный); inputPath первым после `-i` — оборачиваем `path.resolve(input)`.

---

### `src/main/services/ffmpeg-paths.ts` — utility resolver (create)

**Analog (role):** `src/main/services/secure-backend.ts` (singleton, который один знает про платформу + ленивая инициализация).

**Pattern (secure-backend.ts строки 22-27 — platform guard):**

```typescript
if (process.platform === 'darwin') {
  this.value = 'keychain'
  return
}
if (process.platform === 'win32') { ... }
if (process.platform === 'linux') { ... }
```

→ Для нас (`ensureExecutable`, `02-RESEARCH.md §Pattern 5`):

```typescript
export async function ensureExecutable(p: string): Promise<void> {
  if (process.platform === 'win32') return        // Windows ничего chmod-ить не надо
  try {
    await fs.access(p, fsc.X_OK)
  } catch {
    await fs.chmod(p, 0o755)
  }
}
```

**Imports — точно по RESEARCH (§Pattern 5):**
```typescript
import { promises as fs, constants as fsc } from 'node:fs'
import { default as ffmpegStatic } from 'ffmpeg-static'
import { path as ffprobeStatic } from '@ffprobe-installer/ffprobe'
```

**Экспорты:** `resolveFfmpeg(): string`, `resolveFfprobe(): string`, `ensureExecutable(p): Promise<void>`. Контракт: ровно одна замена `'app.asar' → 'app.asar.unpacked'` на каждый путь; throw `Error('ffmpeg-static did not resolve')` если `ffmpegStatic == null` (это уровень fail-fast).

**Init-порядок (по Phase 1 §safeStorage init order):** `mediaExtractor.init()` ДОЛЖЕН вызвать `ensureExecutable(resolveFfmpeg())` + `ensureExecutable(resolveFfprobe())` ОДИН раз в `app.whenReady()` (после `registerIpcHandlers`-блока в `src/main/index.ts`). Иначе первый extract-job словит EACCES на Linux/macOS (Pitfall #2).

---

### `src/main/services/progress-parser.ts` — pure function utility (create)

**Analog:** прямого аналога в репо нет — это первая чистая функция-парсер. Берём паттерн из `02-RESEARCH.md §Pattern 4`.

**Контракт (testable in isolation):**

```typescript
export interface ParsedProgress { percent: number; etaSec: number | null }

export function parseProgressLine(
  line: string,
  durationSec: number,
  startedMs: number,
  lastPct: number          // dedup state — передаётся снаружи
): ParsedProgress | null    // null если строка не out_time_us / pct === lastPct
```

Тело — точно как в RESEARCH §Pattern 4 (after `function handleProgressLine`). Никаких side-effects, никаких импортов кроме типов. Это позволяет покрыть юнит-тестами без mock `child_process` / `parentPort`.

---

### `src/main/utilities/ffmpeg-runner.ts` — utility-process entrypoint (create, CJS-bundled)

**Analog (паттерн «модуль, который собирается в особом формате»):** `src/preload/index.ts` — единственный другой файл в проекте, который собирается в **CJS** (см. `electron.vite.config.ts` строки 24-32, `preload.build.rollupOptions.output.format: 'cjs', entryFileNames: '[name].cjs'`).

**Конвенция Phase 1 (preload, строка 9-13):**

```typescript
// Никаких импортов `node:*`, `fs`, `path`, `child_process`, `os` (Pitfall #9, sandboxed preload).
```

→ Для utility **наоборот** — Node-API доступны (utilityProcess НЕ sandboxed); CJS-формат обязан тем, что Pitfall #5 (RESEARCH) повторяет урок preload: ESM-вход для fork-а нестабилен. **Использовать `require('node:child_process')`**, НЕ `import`. Никаких импортов из `electron`/`src/main/*` — utility-script изолирован от main-графа.

**Структура (целиком из `02-RESEARCH.md §Pattern 3` runner-блок):**
1. `process.parentPort.on('message', e => { if (e.data.type === 'start') startFfmpeg(e.data) })`
2. `process.on('SIGTERM', () => child?.kill('SIGTERM'))`
3. `startFfmpeg({ ffmpegPath, inputPath, outputPath, durationSec })` → `spawn` + stdout-line-buffer + `handleProgressLine`.
4. На `child.on('exit', code)` → `process.parentPort.postMessage({ type:'done', code, stderrTail })` → `process.exit(code ?? 1)`.

**MUST:**
- Использовать `progress-parser.ts`? **Нет** — utility собирается отдельным rollup-bundle и не должен импортировать из `src/main/`. Парсер встраивается inline (дубль ~10 строк допустим) **либо** конфигурируется как shared chunk. Простейшее: дублировать чистую функцию + покрыть её тестом отдельно. Документировать в комментарии файла.

---

### `src/preload/index.ts` — bridge (modify)

**Analog:** этот же файл, Phase 1, целиком 30 строк.

**Текущий bridge (строки 19-26):**

```typescript
const scrubber: ScrubberApi = {
  settings: {
    saveApiKey: (key) => ipcRenderer.invoke(Channels.SETTINGS_SAVE_API_KEY, key),
    hasApiKey: () => ipcRenderer.invoke(Channels.SETTINGS_HAS_API_KEY),
    clearApiKey: () => ipcRenderer.invoke(Channels.SETTINGS_CLEAR_API_KEY),
    getSecureBackend: () => ipcRenderer.invoke(Channels.SETTINGS_GET_SECURE_BACKEND)
  }
}
```

**Расширить до (по `02-RESEARCH.md §Preload подписка на event-канал`):**

```typescript
const scrubber: ScrubberApi = {
  settings: { /* как было */ },
  media: {
    pickFile: () => ipcRenderer.invoke(Channels.MEDIA_PICK_FILE),
    probe: (path) => ipcRenderer.invoke(Channels.MEDIA_PROBE, path),
    extractAudio: (path) => ipcRenderer.invoke(Channels.MEDIA_EXTRACT, path),
    cancel: (jobId) => ipcRenderer.invoke(Channels.MEDIA_CANCEL, jobId),
    onProgress: (cb) => {
      const listener = (_e, payload) => cb(payload)
      ipcRenderer.on(Channels.MEDIA_PROGRESS, listener)
      return () => ipcRenderer.removeListener(Channels.MEDIA_PROGRESS, listener)
    }
  }
}
```

**MUST соблюсти (строки 7-16):**
- Никаких `node:*` импортов (Pitfall #9). `IpcRendererEvent` — type-only import из `electron`.
- `process.contextIsolated` fail-loud сохраняется.
- `Channels.*` — без строковых литералов.
- `onProgress` возвращает **unsubscribe-функцию** (соответствует CONTEXT D-14 / discretion).

---

### `src/preload/index.d.ts` — type declaration (no-op modify)

**Analog:** этот же файл, Phase 1.

```typescript
declare global {
  interface Window {
    scrubber: ScrubberApi
  }
}
```

**Изменение:** ноль строк — `ScrubberApi` уже обновлён в `src/shared/ipc.ts` (новое поле `media`); глобал автоматически подхватит. Только проверить, что `tsconfig.web.json` includes этот файл (Phase 1 Pitfall #10).

---

### `src/renderer/src/routes/Transcribe.tsx` — FSM screen (replace placeholder)

**Analog:** `src/renderer/src/routes/Settings.tsx` — это **exact match** по data-flow (request-response через `window.scrubber.*`, FSM на `useState<Status>`, inline error/success).

**FSM-паттерн из Settings.tsx (строки 14-19):**

```typescript
type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }
```

→ Для Transcribe (по `02-UI-SPEC.md §State Map`):

```typescript
type State =
  | { kind: 'idle' }
  | { kind: 'idle-drag-over' }
  | { kind: 'validating' }
  | { kind: 'selected'; meta: MediaProbeResult; path: string }
  | { kind: 'extracting'; jobId: string; meta: MediaProbeResult; percent: number; etaSec: number | null }
  | { kind: 'done'; audioPath: string; cacheHit: boolean }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: MediaReason }
```

**IPC call pattern (Settings.tsx строки 21-32 — useEffect + cancelled flag):**

```typescript
useEffect(() => {
  let cancelled = false
  void (async (): Promise<void> => {
    const r = await window.scrubber.settings.hasApiKey()
    if (!cancelled && r.ok && r.data !== undefined) {
      setHasKey(r.data)
    } else if (!cancelled && !r.ok) {
      setStatus({ kind: 'error', text: r.reason })
    }
  })()
  return (): void => { cancelled = true }
}, [])
```

→ **Применить как минимум для подписки на progress** (`02-UI-SPEC.md §State Map → extracting`):

```typescript
useEffect(() => {
  const unsub = window.scrubber.media.onProgress((e) => {
    setState(s => s.kind === 'extracting' && s.jobId === e.jobId
      ? { ...s, percent: e.percent, etaSec: e.etaSec } : s)
  })
  return unsub
}, [])
```

**Async handler pattern (Settings.tsx строки 41-56):** `try` через Result-проверку — `if (r.ok) { setX } else { setStatus({ kind:'error', text: r.reason }) }`. Никакого `throw`. **Mapping `reason → user copy`** — по `02-UI-SPEC.md §Copywriting Contract` (готовая таблица).

**Tailwind токены — строго из `02-UI-SPEC.md §Layout & Sizing` + Settings.tsx как живой образец:**
- Контейнер: `<div className="p-8 max-w-3xl mx-auto">` (Settings — `p-8 max-w-xl`; для Transcribe UI-SPEC требует `max-w-3xl`).
- h1: `text-2xl font-semibold mb-4` (точно как Settings строка 84).
- Кнопки primary: `px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50` (Settings строки 137-138).
- Кнопки secondary: `px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300` (Settings строки 99-100).
- Inline error: `<p role="alert" className="mt-3 text-sm text-red-700">` (Settings строки 152-154).
- Success badge: `<div role="status" className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-green-100 text-green-900 border border-green-300 text-sm">` (Settings строки 89-93).

**Все user-facing строки — на русском** (CONTEXT §specifics + готовая таблица `02-UI-SPEC.md §Copywriting Contract`).

---

### `src/renderer/src/components/DropZone.tsx` — stateless component (create)

**Analog:** `src/renderer/src/components/BackendWarningBanner.tsx` (единственный кастомный компонент в Phase 1 — образец структуры).

**Структура BackendWarningBanner.tsx (целиком):**

```typescript
import type { SecureBackend } from '../../../shared/ipc'

interface Props {
  backend: SecureBackend | null
}

export default function BackendWarningBanner({ backend }: Props): React.JSX.Element | null {
  if (backend === null) return null
  if (backend !== 'basic_text' && backend !== 'unavailable') return null
  return (
    <div role="alert" className="bg-yellow-100 border border-yellow-400 text-yellow-900 px-4 py-3 text-sm">
      ...
    </div>
  )
}
```

**Применить:** функциональный компонент + `Props` интерфейс над дефолтным экспортом + ранние return'ы для альтернативных состояний (`disabled`, `dragOver`). Никакого `useState` — состояние снаружи (контролируется `Transcribe.tsx`).

**Контракт (по `02-UI-SPEC.md §Component Inventory`):**
- Props: `{ onPick: (path: string) => void; onError: (reason: MediaReason) => void; disabled?: boolean; dragOver?: boolean }`.
- Внутри — drop-handler по `02-RESEARCH.md §Pattern 2`: `e.preventDefault()`, `files.length === 1` (иначе onError('invalid_argument')), `endsWith('.mp4')` (иначе onError('not_mp4')), `(f as File & {path:string}).path`. Если путь пустой — onError('internal').
- Inside: кнопка `<button type="button">Выбрать mp4-файл</button>` для keyboard-доступной альтернативы (UI-SPEC §Accessibility), вызывает `window.scrubber.media.pickFile()` и пробрасывает результат через тот же `onPick`. **Внимание:** UI-SPEC говорит «DropZone сам не интерактивен с клавиатуры, кнопка fallback внутри»; этим единственным IPC-вызовом внутри stateless-компонента нарушается чистота. **Альтернатива:** кнопку оставить, но handler передать через props (`onPickClick`). Решает планировщик.
- Tailwind по UI-SPEC §Layout: `min-h-[240px] w-full rounded-lg border-2 border-dashed border-gray-300` в idle; `border-blue-500 bg-blue-50` в `dragOver`; `opacity-60 pointer-events-none` в `disabled`.

---

### `src/renderer/src/components/FileMetaCard.tsx` / `ExtractProgress.tsx` / `ExtractDone.tsx` / `InlineError.tsx` — stateless cards (create)

**Analog (общий):** `BackendWarningBanner.tsx` — структура `interface Props { ... } export default function X(props): React.JSX.Element { return (<div ...>) }`.

**Общая card-обёртка (по UI-SPEC §Layout):** `<div className="p-6 rounded-md border ...">`. Бордер по роли:
- FileMetaCard: `border-gray-200 bg-white`
- ExtractProgress: `border-gray-200 bg-white`
- ExtractDone: `border-green-300 bg-green-50 text-green-900` (паттерн success-badge из Settings.tsx строки 91)
- InlineError: `border-red-200 bg-red-50 text-red-900 role="alert"` (паттерн red-вариант, UI-SPEC §Color + Settings.tsx строка 153)

**ExtractProgress accessibility (UI-SPEC §Accessibility):**
```typescript
<div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
     aria-label="Прогресс извлечения аудио">
  <div className="h-2 w-full rounded-full bg-gray-200">
    <div className="h-2 rounded-full bg-blue-600 transition-[width] duration-200"
         style={{ width: `${percent}%` }} />
  </div>
  <p className="mt-2 text-sm text-gray-700 tabular-nums">{percent}% · ~{etaSec ?? '?'} сек</p>
</div>
```

**Все user-facing строки — по `02-UI-SPEC.md §Copywriting Contract` (готовая таблица, дублировать не надо).**

---

### `electron.vite.config.ts` — config (modify)

**Analog:** этот же файл, Phase 1, целиком 49 строк — особенно блок `preload.build.rollupOptions.output` (строки 24-32):

```typescript
preload: {
  build: {
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs'
      }
    }
  }
}
```

**Что добавить (по `02-RESEARCH.md §Pitfall #5`):** второй entry для main с CJS-output **только для utility-script**. Главный main остаётся ESM (electron-store ESM-only — Pitfall #3 Phase 1). Возможный вариант:

```typescript
main: {
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/main/index.ts'),
        'ffmpeg-runner': resolve('src/main/utilities/ffmpeg-runner.ts')
      },
      output: [
        { format: 'es', entryFileNames: '[name].js',
          chunkFileNames: '[name].js' },
        // utility CJS — отдельный output? rollup не поддерживает разные форматы
        // в одном output array одновременно с разным форматом per-entry.
      ]
    }
  }
}
```

> **Open Question для планировщика** (RESEARCH §Open Questions Q1): rollup один output-format на всю main-build. Решения два — (a) собрать utility отдельным `defineConfig` запуском, (b) собрать main весь как CJS (отказавшись от electron-store ESM — НЕ годится), (c) сделать utility статическим JS-файлом, копируемым в `out/main/` (как ассет). **Рекомендация:** (a) — через `vite.config.utility.ts` или второй entry с extension-hack. Финальное решение фиксирует исполнитель в SUMMARY.

---

### `electron-builder.yml` — packaging (modify)

**Analog:** этот же файл, Phase 1 (строка 9 — `asarUnpack`).

**Текущий блок:**
```yaml
asarUnpack:
  - resources/**
```

**Расширить до (по `02-RESEARCH.md §Pattern 5`, electron-builder.yml блок):**
```yaml
asarUnpack:
  - resources/**
  - node_modules/ffmpeg-static/**
  - node_modules/@ffprobe-installer/**
```

Больше ничего в YAML не трогаем (notarize/sign — Phase 5).

---

### `tests/setup.ts` — fixture (modify)

**Analog:** этот же файл, Phase 1, целиком.

**Текущий блок utility-mock (строки в конце мока `electron`):**
```typescript
utilityProcess: {
  fork: vi.fn()
}
```

**Расширить до:** `fork` возвращает `EventEmitter`-подобный объект с методами `postMessage`, `kill`, `on('message'|'exit'|'spawn'|'error')`. Это нужно для `media-extractor.test.ts` (по `02-RESEARCH.md §Wave 0 Gaps`):

```typescript
utilityProcess: {
  fork: vi.fn(() => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    return {
      postMessage: vi.fn(),
      kill: vi.fn(),
      on: vi.fn((evt: string, cb) => {
        const arr = listeners.get(evt) ?? []
        arr.push(cb)
        listeners.set(evt, arr)
      }),
      __emit: (evt: string, ...args: unknown[]) =>
        listeners.get(evt)?.forEach(cb => cb(...args))
    }
  })
}
```

Плюс **дополнительно** замокать `dialog`:
```typescript
dialog: {
  showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] })
}
```

И **`BrowserWindow.fromWebContents`** — добавить статический метод на `MockBrowserWindow` (строка ~35 setup.ts):
```typescript
static fromWebContents = vi.fn(() => new MockBrowserWindow())
```

---

### `src/main/ipc/media.test.ts` — unit (create)

**Analog:** `src/main/services/secure-backend.test.ts` (структура describe/it + `vi.resetModules` + `Channels.*`).

**Excerpt (secure-backend.test.ts строки 4-12):**
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setBackend, setEncryptionAvailable } from '../../../tests/setup'

beforeEach(() => {
  setBackend('gnome_libsecret')
  setEncryptionAvailable(true)
  vi.resetModules()
})
```

→ Для media.test.ts: импорт `dialog`/`utilityProcess.fork` моков из `electron`; `ipcMain.handle.mock.calls` для проверки регистрации правильного `Channels.MEDIA_*`.

**Тесты (по RESEARCH §Phase Requirements → Test Map):**
- `pickFile` — мок `dialog.showOpenDialog`, проверка filter `[{ name: 'MP4', extensions: ['mp4'] }]` и `properties: ['openFile']`.
- `probe`/`extractAudio` — `typeof path !== 'string'` → `{ ok:false, reason:'invalid_argument' }`.
- `extractAudio` — `path.endsWith('.mp4') === false` → `{ ok:false, reason:'not_mp4' }`.

---

### `src/main/services/media-extractor.test.ts` — unit (create)

**Analog:** `src/main/services/secrets-store.test.ts` — структура `freshStore()`-фабрики и tmpdir-изоляции.

**Excerpt (secrets-store.test.ts строки 11-15, 24-30, 34-44):**

```typescript
const USER_DATA = join(os.tmpdir(), 'scrubber-test', 'userData')

beforeEach(async () => {
  await fs.rm(USER_DATA, { recursive: true, force: true })
  vi.resetModules()
})

async function freshStore(): Promise<{ store }> {
  const storeMod = await import('./secrets-store')
  await storeMod.secretsStore.init()
  return { store: storeMod.secretsStore }
}
```

→ Для media-extractor.test.ts: `EXTRACTED = join(USER_DATA, 'extracted')`; `freshExtractor()` импортирует `media-extractor.ts` после `vi.resetModules()`; через `(electron.utilityProcess.fork as vi.Mock).mock.results[0].value.__emit('message', { type:'progress', ... })` симулирует жизненный цикл utility (используя расширенный mock из `tests/setup.ts`).

**Покрыть:** happy path (postMessage('start') → emit progress → emit exit code 0 → rename tmp → wav), cancel (kill → unlink tmp → reason cancelled), ffmpeg_failed (exit code != 0), cache hit (создать `<hash>.wav` >0 байт до вызова — никакого fork), reason normalization (ENOENT input).

---

### `src/main/services/ffmpeg-paths.test.ts` — unit (create)

**Analog:** `src/main/services/secure-backend.test.ts` — platform-stub.

**Excerpt (secure-backend.test.ts строки 14-19):**
```typescript
function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}
```

→ Для ffmpeg-paths.test.ts: stubPlatform('win32') проверяет, что `ensureExecutable` — no-op (нет вызовов `fs.chmod`). stubPlatform('linux') + mock `fs.access` → rejects → `fs.chmod` вызван с `0o755`.

Плюс юнит на `.replace('app.asar','app.asar.unpacked')` — input/output на синтетических путях.

---

### `src/main/services/progress-parser.test.ts` — unit (create)

**Analog:** `secure-backend.test.ts` — структура describe/it.it.each.

**Покрыть (по RESEARCH §Pattern 4):**
- `out_time_us=5000000` + `durationSec=10` + `lastPct=-1` → `{ percent: 50, etaSec: ~elapsed }`.
- `out_time_us=5000000`, `lastPct=50` → `null` (дедуп).
- Невалидная строка (`bitrate=...`) → `null`.
- `durationSec=0` → `null` (deler-by-zero guard).
- `percent` cap = 99 (никогда не 100, exit-сигнал отдельно).

---

### `src/preload/index.test.ts` — расширение (modify)

**Analog:** этот же файл, Phase 1, целиком 119 строк.

**Текущая проверка allow-list (строки 52-57):**
```typescript
const bridge = spy.mock.calls[0][1] as Record<string, unknown>
expect(Object.keys(bridge)).toEqual(['settings'])
```

**Изменить на:**
```typescript
expect(Object.keys(bridge).sort()).toEqual(['media', 'settings'])
const media = bridge.media as Record<string, unknown>
expect(Object.keys(media).sort()).toEqual(
  ['cancel', 'extractAudio', 'onProgress', 'pickFile', 'probe'].sort()
)
for (const fn of Object.values(media)) {
  expect(typeof fn).toBe('function')
}
```

**Текущая проверка forbidden (строки 70-72):**
```typescript
for (const forbidden of ['media', 'transcribe', 'llm', 'api', 'electron', 'ipcRenderer']) {
  expect(bridge[forbidden]).toBeUndefined()
}
```

**Изменить на:** убрать `'media'` из forbidden, оставить `['transcribe', 'llm', 'api', 'electron', 'ipcRenderer']`.

**Добавить новый describe:** `'media bridge'` с проверкой каналов (по образцу строки 78-115 — settings) для каждого из 5 каналов; для `onProgress` — что возвращает функцию-unsubscribe (вызывает `ipcRenderer.removeListener`).

---

### `src/renderer/src/routes/Transcribe.test.tsx` — React unit (create)

**Analog (нет в репо):** в Phase 1 не было renderer-тестов. Создаём первый — паттерн берём из `02-RESEARCH.md §Wave 0 Gaps`.

**Стек:** Vitest + React Testing Library (потребуется `@testing-library/react`, `@testing-library/user-event`, `jsdom` — добавить в `package.json` через `--save-exact`). Альтернатива (минимум зависимостей): мок `window.scrubber` через `Object.defineProperty(window, 'scrubber', { ... })` + ручная инстанцация компонента через `react-dom/client.createRoot` в `jsdom`-окружении. **Решает планировщик** (Wave 0 setup-задача).

**Покрыть (по RESEARCH §Phase Requirements → Test Map MEDIA-02):**
- DropZone: `dataTransfer.files.length === 2` → callback `onError('invalid_argument')`.
- DropZone: `!endsWith('.mp4')` → callback `onError('not_mp4')`.
- DropZone: валидный drop → `onPick(file.path)` вызван.

---

### `tests/integration/extract-real.test.ts` — integration (create)

**Analog:** папка `tests/integration/` уже существует (`tests/integration/secrets-persist.test.ts` из Phase 1) — структура та же.

**Сценарий (RESEARCH §Wave 0 Gaps):**
1. `beforeAll` — генерирует 5-сек sample.mp4 через `child_process.execFile(ffmpegStatic, ['-f','lavfi','-i','sine=frequency=440:duration=5','-f','lavfi','-i','color=c=blue:s=320x240:d=5','-shortest','-y', sampleMp4])`.
2. Вызывает `mediaExtractor.probe(sampleMp4)` → ожидает `durationSec ≈ 5`.
3. Вызывает `mediaExtractor.startExtract(sampleMp4, 5)` → ожидает `Result.ok`.
4. `fs.access(audioPath)` → файл существует, `>0` байт; `ffprobe` показывает `sample_rate=16000`, `channels=1`, `codec_name=pcm_s16le`.
5. `afterAll` — `fs.rm` чистит `EXTRACTED`.

**Timeout:** 60 сек (см. `vitest.config.ts` — нужно `testTimeout: 60000` для этого файла).

> **Внимание:** интеграционный тест **не** мокает `electron` (использует реальный `ffmpeg-static`). Решается через `vi.unmock('electron')` в начале файла **либо** через отдельный `vitest.integration.config.ts`. **Решает планировщик** в Wave 0.

---

### `tests/fixtures/media/generate.mjs` — dev tool (create)

**No analog.** Standalone Node-скрипт. Контракт: запускается `node tests/fixtures/media/generate.mjs`, генерирует через `ffmpeg-static` короткие/длинные/no-audio mp4 в `tests/fixtures/media/`, эти файлы добавляются в `.gitignore` (генерируем в CI/локально).

---

### `02-VERIFICATION.md` — phase verification doc (create)

**Analog:** `.planning/phases/01-foundation-app-shell/VERIFICATION.md`.

**Контракт (по CONTEXT D-19 + RESEARCH §Validation Architecture):**
- Секция «Windows packaged smoke» — обязательный чек-лист (D-19 host requirement): `npm run build:unpack` → запустить unpacked exe → drop 5-сек sample mp4 → проверить `<userData>/extracted/<hash>.wav` существует и валиден через `ffprobe`.
- Секция «Linux packaged smoke» — best-effort.
- Секция «macOS packaged smoke» — best-effort + явный лог Gatekeeper warning (Pitfall #3).
- Каждая ОС: дата, host, версия Electron, результат (PASS/SKIP с причиной), скриншот опционально.

---

## Shared Patterns (cross-cutting)

### Pattern A — Channels-константы как единственный источник имён каналов
**Source:** `src/shared/ipc.ts` Phase 1 (строки 31-39).
**Apply to:** `src/shared/ipc.ts` (добавить `MEDIA_*`), `src/preload/index.ts`, `src/main/ipc/media.ts`, `src/main/services/media-extractor.ts` (для `webContents.send(Channels.MEDIA_PROGRESS, ...)`).
**Excerpt:**
```typescript
export const Channels = {
  SETTINGS_SAVE_API_KEY: 'settings:saveApiKey',
  // ...
} as const
```
**Правило:** ни одна строка `'media:...'` не должна появиться вне `src/shared/ipc.ts`.

### Pattern B — Result-тип в каждом ipcMain.handle (Pitfall #7 Phase 1)
**Source:** `src/main/ipc/settings.ts` строки 17-32.
**Apply to:** все 4 handler'а в `src/main/ipc/media.ts`.
**Excerpt:**
```typescript
ipcMain.handle(Channels.X, async (...): Promise<Result<T>> => {
  try {
    // validate args
    if (typeof x !== 'string') return { ok: false, reason: 'invalid_argument' }
    return await service.method(x)
  } catch (err: unknown) {
    console.error('[ipc/media] X internal error:', err)
    return { ok: false, reason: 'internal' }
  }
})
```
**Mapping reason → user copy** — `02-UI-SPEC.md §Copywriting Contract` (таблица error-копи).

### Pattern C — Singleton-сервис в `src/main/services/<name>.ts`
**Source:** `src/main/services/secrets-store.ts` (последняя строка), `secure-backend.ts` (последняя строка), `settings-store.ts` (последняя строка).
**Apply to:** `src/main/services/media-extractor.ts` (`export const mediaExtractor = new MediaExtractor()`).
**Convention:** класс + singleton-инстанс; init() async, вызывается из `src/main/index.ts` ПОСЛЕ `app.whenReady()`.

### Pattern D — Логирование с префиксом `[<area>/<file>]`
**Source:** Phase 1 (secrets-store.ts строки 30/60/85/107, ipc/settings.ts строки 23/41/52/63, main/index.ts строка 51).
**Apply to:** `[ipc/media]`, `[services/media-extractor]`, `[services/ffmpeg-paths]`, `[utilities/ffmpeg-runner]`. Только `console.error`/`console.warn`; никакого `console.log` в продакшен-коде.

### Pattern E — Tailwind-токены для UI
**Source:** `src/renderer/src/routes/Settings.tsx` (строки 84-156 — h1, primary button, secondary button, inline error, success badge, focus ring).
**Apply to:** `Transcribe.tsx`, `DropZone.tsx`, `FileMetaCard.tsx`, `ExtractProgress.tsx`, `ExtractDone.tsx`, `InlineError.tsx`. Excerpts:
- Primary button: `px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50`
- Secondary button: `px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300`
- Inline error: `<p role="alert" className="mt-3 text-sm text-red-700">{text}</p>`
- Success badge: `<div role="status" className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-green-100 text-green-900 border border-green-300 text-sm">`
- Input focus ring: `focus:outline-none focus:ring-2 focus:ring-blue-500`

### Pattern F — useEffect c cancelled-flag для async IPC в renderer
**Source:** `src/renderer/src/routes/Settings.tsx` строки 21-32, `App.tsx` строки 30-39.
**Apply to:** `Transcribe.tsx` (probe-вызов, progress-подписка).
**Excerpt:**
```typescript
useEffect(() => {
  let cancelled = false
  void (async () => {
    const r = await window.scrubber.x.y()
    if (!cancelled && r.ok && r.data !== undefined) setX(r.data)
  })()
  return () => { cancelled = true }
}, [])
```

### Pattern G — CJS-bundle для non-ESM entries (Pitfall #9 Phase 1 / #5 Phase 2)
**Source:** `electron.vite.config.ts` строки 24-32 (preload).
**Apply to:** `src/main/utilities/ffmpeg-runner.ts` — собирается в `ffmpeg-runner.cjs` рядом с `out/main/index.js`. Конкретный rollup-config Open Question (см. блок `electron.vite.config.ts` выше).

### Pattern H — Global electron-mock + tmpdir-изоляция в тестах
**Source:** `tests/setup.ts` Phase 1 (целиком).
**Apply to:** все `*.test.ts` Phase 2. Расширение `setup.ts` обязательно: `utilityProcess.fork` → EventEmitter-фабрика, `dialog.showOpenDialog` → vi.fn, `BrowserWindow.fromWebContents` → возвращает MockBrowserWindow.

### Pattern I — Defence-in-depth валидация (CONTEXT D-06)
**Source:** RESEARCH §Security Domain V5.
**Apply to:** `DropZone.tsx` (renderer, быстрая отсечка `endsWith('.mp4')`, `files.length === 1`) **и** `src/main/ipc/media.ts` (повторно, авторитет: `typeof path === 'string'`, `path.isAbsolute(path)`, `path.toLowerCase().endsWith('.mp4')`, `fs.access(path, R_OK)`).

---

## No Analog Found

| Файл | Role | Причина |
|------|------|---------|
| `src/main/utilities/ffmpeg-runner.ts` | utility-process entrypoint | В Phase 1 не было ни одного utility-script; родственный паттерн (CJS-bundle) — у preload, но семантика разная. Полный шаблон — `02-RESEARCH.md §Pattern 3` runner-блок. |
| `src/main/services/progress-parser.ts` | pure function | Первая чисто-функциональная утилита в `services/`. Паттерн — `02-RESEARCH.md §Pattern 4`. |
| `src/renderer/src/routes/Transcribe.test.tsx` | React unit | В Phase 1 не было renderer-тестов. Setup стека (RTL+jsdom или альтернатива) — Wave 0 задача планировщика. |
| `tests/fixtures/media/generate.mjs` | dev tool | Не имеет родственников. |

---

## Open Questions для планировщика

1. **electron.vite.config.ts: как собрать ESM main + CJS utility одной командой?** Варианты: (a) второй `defineConfig` файл; (b) per-entry `output.entryFileNames` + post-build переименование; (c) копировать utility-script как ассет. Решение фиксируется в Wave 0 SUMMARY.
2. **Transcribe.test.tsx: RTL+jsdom vs ручной createRoot?** Поскольку renderer-тестов раньше не было, выбор лекарства влияет на `package.json`/`vitest.config.ts`. Решение в Wave 0.
3. **DropZone: file-picker handler внутри stateless-компонента или через props?** UI-SPEC намекает на «keyboard-fallback кнопка внутри DropZone»; чистота stateless-контракта vs локальный IPC-вызов. Решение влияет на тестируемость.

---

## Metadata

**Analog search scope:**
- `src/main/**`, `src/preload/**`, `src/renderer/**`, `src/shared/**`
- `.planning/phases/01-foundation-app-shell/01-PATTERNS.md` (carry-over конвенции)
- `electron.vite.config.ts`, `electron-builder.yml`, `tests/setup.ts`
- `02-RESEARCH.md` §Pattern 1..6, §Code Examples, §Pitfalls
- `02-UI-SPEC.md` §Component Inventory, §State Map, §Layout & Sizing, §Copywriting Contract

**Файлы прочитаны (вне re-read):** 13 (ipc.ts, ipc/index.ts, ipc/settings.ts, preload/index.ts, preload/index.d.ts, main/index.ts, services/secrets-store.ts, services/secure-backend.ts, services/settings-store.ts, main/window.ts, renderer/App.tsx, renderer/routes/Settings.tsx, renderer/routes/Transcribe.tsx, renderer/components/BackendWarningBanner.tsx, preload/index.test.ts, services/secure-backend.test.ts, services/secrets-store.test.ts head, tests/setup.ts, electron.vite.config.ts, electron-builder.yml, 01-PATTERNS.md head).

**Pattern extraction date:** 2026-05-31

---

## PATTERN MAPPING COMPLETE
