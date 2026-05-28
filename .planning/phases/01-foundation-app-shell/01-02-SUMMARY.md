---
phase: 01-foundation-app-shell
plan: 02
subsystem: main / ipc / secure-storage
tags: [electron, ipc, safestorage, secrets, contract, sandbox]
one_liner: "Main-сторона walking skeleton: shared IPC контракт, secure-backend сервис с linux-fallback, safeStorage round-trip через secrets.bin, 4 IPC handler'а settings и bootstrap в правильном порядке"
requires:
  - "01-01 (electron-vite scaffold + Vitest 2.x + tests/setup.ts мок electron)"
provides:
  - "src/shared/ipc.ts — единый источник правды для Channels, SettingsApi, ScrubberApi, SecureBackend, Result<T>"
  - "secureBackend singleton с маппингом gnome_libsecret/kwallet*/basic_text → SecureBackend union (D-06, Pitfall #4)"
  - "secretsStore singleton: safeStorage.encryptString → base64 → secrets.bin (mode 0o600); memory-only при backend ∈ {basic_text, unavailable} (D-07, SHELL-03)"
  - "settingsStore singleton (electron-store@11) с dynamic await import (Pitfall #3); БЕЗ encryptionKey (D-13)"
  - "createWindow() с фиксированными webPreferences: sandbox/contextIsolation/nodeIntegration=false/webSecurity=true (D-14)"
  - "4 IPC handler'а settings:* — все возвращают Result-тип, никаких сырых throw (Pitfall #7)"
  - "main bootstrap в порядке secureBackend.init → settingsStore.init → secretsStore.init → registerIpcHandlers → createWindow (Pitfall #5)"
affects:
  - "Plan 01-03 (preload bridge) — типы из shared/ipc.ts и Channels.* импортируются напрямую"
  - "Plan 01-04 (UI Settings) — вызывает 4 IPC канала через preload"
  - "Phase 2 (media.*), Phase 3 (transcribe.*), Phase 4 (llm.*) — расширят registerIpcHandlers()"
tech_stack_added:
  - "electron-store@11.0.2 (sindresorhus, ESM-only, dynamic import)"
patterns_used:
  - "Domain-namespaced IPC API: Channels const-enum + типизированный ScrubberApi.settings.* (RESEARCH §Pattern 2)"
  - "Result-тип для всех IPC мутаций — { ok: true, data?: T } | { ok: false, reason: string } (RESEARCH §Pattern 2, Pitfall #7)"
  - "Linux-only API guard: getSelectedStorageBackend() вызывается только под process.platform === 'linux' (Pitfall #4)"
  - "Сериализация криптотекста: Buffer ↔ base64 string на границе JSON-файла (Pitfall #6)"
  - "ESM bootstrap: import.meta.url → __dirname через fileURLToPath/dirname (Pitfall #3)"
  - "Singleton-сервисы с явным init() после app.whenReady() (Pitfall #5)"
key_files_created:
  - path: "src/shared/ipc.ts"
    role: "Контракт IPC: SecureBackend union, Result<T>, Channels const, SettingsApi, ScrubberApi"
  - path: "src/main/services/secure-backend.ts"
    role: "SecureBackendService singleton с маппингом и linux-guard"
  - path: "src/main/services/secrets-store.ts"
    role: "SecretsStore singleton: encrypt/decrypt round-trip + memory-only fallback"
  - path: "src/main/services/settings-store.ts"
    role: "SettingsStoreService singleton (electron-store обёртка с dynamic import)"
  - path: "src/main/window.ts"
    role: "createWindow() с безопасными webPreferences (D-14)"
  - path: "src/main/ipc/index.ts"
    role: "registerIpcHandlers() — точка расширения для будущих namespace"
  - path: "src/main/ipc/settings.ts"
    role: "4 ipcMain.handle для Channels.SETTINGS_*"
  - path: "src/main/services/secure-backend.test.ts"
    role: "11 тестов матрицы backend + linux-guard"
  - path: "src/main/window.test.ts"
    role: "3 теста snapshot webPreferences + setWindowOpenHandler"
  - path: "src/main/services/secrets-store.test.ts"
    role: "11 тестов SHELL-02 round-trip + SHELL-03 memory-only + валидация + устойчивость"
key_files_modified:
  - path: "src/main/index.ts"
    role: "Заменён шаблонный bootstrap на правильный порядок init (Pattern 4)"
  - path: "package.json"
    role: "Добавлен electron-store@11.0.2"
decisions:
  - "isDev определён через `!!process.env.ELECTRON_RENDERER_URL` вместо `is.dev` из @electron-toolkit/utils. Причина: @electron-toolkit/utils на верхнем уровне делает `import { app, session, ipcMain, BrowserWindow } from 'electron'`, что ломает vi.mock('electron') в vitest (vitest externalizes node_modules → грузит реальный CJS electron вместо мока). В runtime функционал идентичен."
  - "moduleDir() — функция вместо top-level const, чтобы fileURLToPath(import.meta.url) вычислялся только при реальном вызове createWindow() (не на сборке тестов). Это устраняет краевые случаи ESM-резолва в vitest."
  - "В secrets-store.ts при clearApiKey() удаляем файл целиком, если после удаления apiKey не остаётся других полей (минимизация surface)."
  - "settings-store.ts использует свой StoreCtor type-only declaration вместо импорта типа из electron-store. Причина: electron-store@11 экспортирует тип Store через generic, который не парсится тривиально при dynamic import — type-only локальная декларация даёт стабильный API без зависимости от внутренней геометрии типов пакета."
metrics:
  duration: "≈ 20 мин (RED → GREEN для каждой из 3 задач; 1 деbug на конфликт vitest mock vs @electron-toolkit/utils)"
  tasks_completed: 3
  files_created: 10
  files_modified: 2
  commits: 3
date_completed: "2026-05-28"
---

# Phase 01 Plan 02: Main process boundaries, IPC contract, safeStorage — Summary

Поднята main-сторона walking skeleton: типизированный IPC контракт в shared/ipc.ts, безопасный BrowserWindow (D-14), детект safeStorage backend с Linux-fallback (Pitfall #4), сервис SecretsStore с round-trip шифрованием через safeStorage и memory-only режимом при недоступном keyring (D-07, SHELL-03), 4 IPC handler'а settings:*. Bootstrap в правильном порядке. 25 новых юнит-тестов покрывают SHELL-02, SHELL-03, D-14.

## IPC каналы settings namespace (D-11)

| Channel | Request | Response | Покрытие |
|---------|---------|----------|----------|
| `settings:saveApiKey` | `string` | `Result<void>` | tests + handler validation |
| `settings:hasApiKey` | `()` | `Result<boolean>` | tests (round-trip + leak-check) |
| `settings:clearApiKey` | `()` | `Result<void>` | tests (memory + disk удаление) |
| `settings:getSecureBackend` | `()` | `Result<SecureBackend>` | tests матрица 11 кейсов |

Имена каналов — только в `src/shared/ipc.ts` (anti-pattern checklist 01-PATTERNS.md соблюдён).

## Task-by-task

### Task 1: Shared IPC contract + secure-backend service + window factory
**Commit:** `0079bc6` — `feat(01-02): shared IPC контракт, secure-backend сервис, безопасная window factory`

**TDD RED → GREEN:**
- Сначала созданы `secure-backend.test.ts` (11 кейсов матрицы) и `window.test.ts` (3 snapshot-теста). Запущены — упали на «Failed to load url ./secure-backend» (файлов нет). RED подтверждён.
- Имплементация:
  - `src/shared/ipc.ts` — types-only: `SecureBackend` union (6 значений), `Result<T = void>`, `Channels` const с 4 ключами SETTINGS_*, `SettingsApi`, `ScrubberApi`.
  - `src/main/services/secure-backend.ts` — `SecureBackendService` с приватным `value: SecureBackend = 'unavailable'`, методом `init()` и геттером `backend()`. Singleton `export const secureBackend`. Маппинг: `darwin → keychain`, `win32 → dpapi`, `linux/gnome_libsecret → libsecret`, `linux/kwallet|5|6 → kwallet`, `linux/basic_text → basic_text`, прочее → `unavailable`. Linux-only guard через `if (process.platform === 'linux')` — `getSelectedStorageBackend()` НЕ вызывается на macOS/Windows.
  - `src/main/window.ts` — `createWindow()` с `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false`. `setWindowOpenHandler({ url })` — валидируем протокол через `new URL(url)`, открываем только http/https через `shell.openExternal`, всегда возвращаем `{ action: 'deny' }`.

**Acceptance:**
- `npx vitest run src/main/services/secure-backend.test.ts src/main/window.test.ts` → 14/14 пройдено, exit 0
- `grep -c "sandbox: true" src/main/window.ts` → 2 (≥ 1)
- `src/main/services/secure-backend.ts` содержит `process.platform === 'linux'`
- `src/shared/ipc.ts` экспортирует Channels, SettingsApi, ScrubberApi, SecureBackend, Result

### Task 2: SecretsStore + settings-store + secrets persist round-trip
**Commit:** `b0fefd8` — `feat(01-02): SecretsStore (safeStorage round-trip) + SettingsStore (electron-store)`

**TDD RED → GREEN:**
- Создан `secrets-store.test.ts` с 11 тестами: запись на диск как base64 (mode 0o600), SHELL-02 round-trip, hasApiKey false для пустого, clearApiKey (memory + диск), пустой ключ → `{ ok: false, reason: 'empty' }`, leak-check (ключ НЕ в JSON.stringify(result)), SHELL-03 backend=basic_text (нет writeFile, есть память в сессии), basic_text после рестарта (false), unavailable тоже memory-only, init без файла, init с мусором.
- Перед запуском теста: установлен `electron-store@11.0.2` (Rule 3 — planned dep из CLAUDE.md, не slop).
- Имплементация:
  - `src/main/services/secrets-store.ts` — `SecretsStore` с `memory.apiKey`, `diskCache: SecretsFileShape | null`, `filePath`. `init()` ставит filePath из `app.getPath('userData')`, в memory-only режиме НЕ читает диск. Иначе читает `secrets.bin`, парсит JSON, декодирует `Buffer.from(b64, 'base64')` → `safeStorage.decryptString` → memory. ENOENT — стартуем пустым. Парс-ошибки — лог + пустой стор (не падаем).
  - `saveApiKey()` валидирует пустой → `{ ok: false, reason: 'empty' }`, пишет в memory, в memory-only режиме НЕ пишет на диск, иначе `encryptString → base64 → JSON.stringify → fs.writeFile mode 0o600`.
  - `hasApiKey()` возвращает только `{ ok: true, data: boolean }` (никогда не plaintext).
  - `clearApiKey()` чистит memory, удаляет apiKey из JSON, удаляет файл если других ключей нет.
  - `src/main/services/settings-store.ts` — `SettingsStoreService` с `await import('electron-store')` внутри `init()` (Pitfall #3). type-only локальный `StoreCtor` для типизации без зависимости от внутренних типов пакета. НИКАКОГО `encryptionKey` (D-13).

**Acceptance:**
- `npx vitest run src/main/services/secrets-store.test.ts` → 11/11, exit 0
- Source содержит `safeStorage.encryptString` и `.toString('base64')`
- `hasApiKey` возвращает только `{ ok, data: boolean }` (без apiKey)
- Round-trip save→reload→hasApiKey === true пройден
- Memory-only режим: `fs.writeFile` НЕ вызван при basic_text
- npm run typecheck exit 0

### Task 3: IPC handlers + main bootstrap
**Commit:** `6c174b7` — `feat(01-02): IPC handlers settings + main bootstrap в правильном порядке`

- `src/main/ipc/settings.ts` — `registerSettingsHandlers()` регистрирует 4 `ipcMain.handle`. Каждый завёрнут в try/catch с `console.error` + `{ ok: false, reason: 'internal' }` (Pitfall #7). SAVE_API_KEY валидирует `typeof key !== 'string'` → `{ ok: false, reason: 'invalid_argument' }`. GET_SECURE_BACKEND возвращает `{ ok: true, data: secureBackend.backend() }`.
- `src/main/ipc/index.ts` — `registerIpcHandlers()` зовёт `registerSettingsHandlers()`. Комментарии-маркеры для будущих namespace.
- `src/main/index.ts` — заменён шаблонный bootstrap. В `app.whenReady().then(async () => { ... })` порядок: `secureBackend.init()` → `await settingsStore.init()` → `await secretsStore.init()` → `registerIpcHandlers()` → `createWindow()`. Используется `electronApp.setAppUserModelId('com.scrubber.app')` и `optimizer.watchWindowShortcuts(window)` на `browser-window-created`. macOS activate → переоткрывает окно. `window-all-closed` на не-darwin → `app.quit()`. `.catch()` на bootstrap-промисе → лог + quit.

**Acceptance:**
- `npm run typecheck` exit 0
- `npm run build` exit 0 (main 8.04 kB ESM + preload 0.38 kB + renderer 556.35 kB)
- `grep -c "ipcMain.handle" src/main/ipc/settings.ts` → 4
- `grep -v "^//" src/main/ipc/settings.ts | grep -c "Channels\."` → 4
- `npx vitest run` → 32/32 пройдено (5 файлов: smoke + electron-mock + secure-backend + window + secrets-store)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] `@electron-toolkit/utils` ломает `vi.mock('electron')` при импорте в `window.ts`**

- **Found during:** Task 1 (RED → GREEN, имплементация window.ts)
- **Issue:** План §Action(3) предписывает использовать `is.dev` из `@electron-toolkit/utils` (есть в шаблоне). При прямом `import { is } from '@electron-toolkit/utils'` в `src/main/window.ts` vitest падает с `SyntaxError: Named export 'BrowserWindow' not found. The requested module 'electron' is a CommonJS module` (трасс указывает на window.ts:4). Причина: `@electron-toolkit/utils/dist/index.mjs` на верхнем уровне делает `import { app, session, ipcMain, BrowserWindow } from 'electron'`. Vitest externalizes `node_modules/*` → грузит реальный CJS-модуль electron (которого в окружении нет / без named exports), минуя `vi.mock('electron')` из `tests/setup.ts`.
- **Fix:** Удалил `import { is } from '@electron-toolkit/utils'` в `src/main/window.ts`. Inlined: `const isDev = !!process.env['ELECTRON_RENDERER_URL']` — функционально эквивалентно `is.dev && process.env.ELECTRON_RENDERER_URL` (в production env-переменная отсутствует, в dev — есть). В `src/main/index.ts` `@electron-toolkit/utils` остался — потому что bootstrap не покрывается юнит-тестами Plan 02 (только npm run build верифицирует).
- **Files modified:** `src/main/window.ts`
- **Commit:** `0079bc6` (Task 1)
- **Не Rule 4 (архитектурное):** D-14 фиксирует webPreferences, а не источник `isDev`. Контракт «createWindow() с безопасными webPreferences» соблюдён.

**2. [Rule 3 — Blocking issue] `fileURLToPath(import.meta.url)` на top-level в window.ts ломал ESM-резолв в vitest**

- **Found during:** Task 1 (debug первого падения)
- **Issue:** Оригинальная имплементация имела `const __dirname = dirname(fileURLToPath(import.meta.url))` на top-level. В сочетании с vi.mock приводило к лишнему ESM-eval'у на этапе collect.
- **Fix:** Перенесено в функцию `moduleDir(): string`, которая вызывается только внутри `createWindow()`. Поведение в runtime не меняется (import.meta.url доступен в ESM), но collect-phase vitest стабилен.
- **Files modified:** `src/main/window.ts`
- **Commit:** `0079bc6` (Task 1)

**3. [Rule 3 — Package install] установка `electron-store@11.0.2`**

- **Found during:** Task 2 (settings-store.ts требует этот пакет)
- **Issue:** Plan 01-01 не установил `electron-store` (только зафиксировал в CLAUDE.md `Technology Stack` как plan-target). Без него Task 2 settings-store.ts не сможет ни импортироваться, ни собраться.
- **Verification:** Пакет легитимный, published by `sindresorhus`, зафиксирован в CLAUDE.md §Technology Stack (`electron-store@11.0.2`), VERIFIED в 01-RESEARCH.md §Package Legitimacy Audit. Не slopcheck-flagged. Использован `npm install --save-exact electron-store@11.0.2`. Версия совпадает с CLAUDE.md.
- **Files modified:** `package.json`, `package-lock.json` (87 пакетов от deps electron-store)
- **Commit:** `b0fefd8` (Task 2)
- **Не human-verify checkpoint:** пакет в white-list CLAUDE.md, не «cannot be found», не slopsquatted кандидат.

### Out-of-Scope (не реализовано — относится к Plan 03/04)

- Preload bridge (`src/preload/index.ts` / `index.d.ts`) — Plan 03.
- Renderer UI (Settings, BackendWarningBanner, навигация) — Plan 04.
- `src/preload/index.test.ts` (SHELL-02c — proof, что preload не утечкает ключ) — Plan 03.
- `tests/integration/secrets-persist.test.ts` (отдельный integration-уровень) — Plan 03 или Plan 04.

## Authentication / Setup Gates

Нет. План не требует ввода ключей, секретов или внешней авторизации. SHELL-02 round-trip полностью верифицируется юнит-тестами через мок `safeStorage` (обратимая обёртка `enc:<plaintext>`).

## Threat Surface Scan

Threat-register плана (`<threat_model>`) предусматривал T-01..T-03 + T-02-SC. Все они реализованы как и спланировано:

- **T-01 (Tampering через invoke):** preload — Plan 03; пока handler'ы main защищены ручной валидацией `typeof key === 'string'` (Pattern 2 V5 ASVS) + Result-fail вместо throw (Pitfall #7).
- **T-02 (Info Disclosure ключа):** `hasApiKey` возвращает только `boolean` (тест `leak-check` это проверяет). На диск пишется ТОЛЬКО `safeStorage.encryptString` → base64. Логи main используют `console.error(err)` без args.
- **T-03 (Linux degradation):** SecretsStore детектит `backend ∈ {basic_text, unavailable}` и переходит в memory-only — тест-кейсы это покрывают. UI-баннер — Plan 04.
- **T-02-SC (Tampering npm install):** `electron-store@11.0.2` — official sindresorhus, версия из CLAUDE.md, зафиксирована в `--save-exact`. Никаких `[ASSUMED]`/`[SUS]` пакетов.

Новых surface, не описанных в threat_model плана, не появилось.

## Known Stubs

Нет. Все артефакты — функциональный код с тестовым покрытием. Renderer-стороны (Settings UI с потенциальными stub-баннерами) ещё нет — она в Plan 04.

## Self-Check: PASSED

Файлы (все FOUND через `git log --stat` / file system):
- `src/shared/ipc.ts` — commit 0079bc6
- `src/main/services/secure-backend.ts` + `.test.ts` — commit 0079bc6
- `src/main/window.ts` + `.test.ts` — commit 0079bc6
- `src/main/services/secrets-store.ts` + `.test.ts` — commit b0fefd8
- `src/main/services/settings-store.ts` — commit b0fefd8
- `src/main/ipc/index.ts` + `settings.ts` — commit 6c174b7
- `src/main/index.ts` (modified) — commit 6c174b7

Коммиты:
- `0079bc6` — FOUND (Task 1)
- `b0fefd8` — FOUND (Task 2)
- `6c174b7` — FOUND (Task 3)

Команды (все exit 0):
- `npx vitest run src/main/services/secure-backend.test.ts src/main/window.test.ts` — 14/14 пройдено
- `npx vitest run src/main/services/secrets-store.test.ts` — 11/11 пройдено
- `npx vitest run` — 32/32 пройдено (5 тестовых файлов)
- `npm run typecheck` — exit 0 (node + web)
- `npm run build` — exit 0 (main 8.04 kB ESM + preload + renderer)

---

*Plan 01-02 executed 2026-05-28. Worktree: `agent-ada08bbc43b0ee893`. Дальше — Plan 01-03 (preload bridge с типизированным `contextBridge.exposeInMainWorld('scrubber', ...)`) и Plan 01-04 (UI Settings + BackendWarningBanner).*
