# Phase 1: Foundation & App Shell — Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 22 (всё создаётся с нуля)
**Analogs found:** 0 кодовых аналогов в репозитории / 22 файла
**Greenfield notice:** Папка `src/` пуста. Скелет генерируется командой `npm create @quick-start/electron@latest scrubber -- --template react-ts` в первой задаче Wave 0. Большинство файлов «модифицируются после генерации», а не пишутся с нуля; для них «аналог» = файл из стандартного шаблона `electron-vite/react-ts` (`@quick-start/create-electron@1.0.30`). Конкретные паттерны лежат в `01-RESEARCH.md` — здесь только классификация и ссылки.

## Source-of-truth ссылки

| Источник | Что лежит | Используют файлы |
|----------|-----------|------------------|
| `01-RESEARCH.md` §Pattern 1 «Безопасный BrowserWindow» | createWindow + webPreferences (D-14) | `src/main/window.ts` |
| `01-RESEARCH.md` §Pattern 2 «Типизированный IPC контракт» | ScrubberApi, Channels, contextBridge bridge, ipcMain.handle | `src/shared/ipc.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/main/ipc/settings.ts` |
| `01-RESEARCH.md` §Pattern 3 «safeStorage сервис» | SecretsStore + SecureBackendService | `src/main/services/secrets-store.ts`, `src/main/services/secure-backend.ts` |
| `01-RESEARCH.md` §Pattern 4 «main bootstrap» | app.whenReady, инициализация в порядке backend → secrets → IPC → window | `src/main/index.ts` |
| `01-RESEARCH.md` §Common Pitfalls #3 | ESM/CJS — `"type": "module"` + dynamic `import('electron-store')` | `package.json`, `src/main/services/settings-store.ts` |
| `01-RESEARCH.md` §Common Pitfalls #4, #5, #6 | Linux backend detection, app.ready guard, Buffer↔base64 | `src/main/services/secure-backend.ts`, `src/main/services/secrets-store.ts` |
| `01-RESEARCH.md` §Common Pitfalls #10 | `tsconfig.web.json` должен включать `src/preload/index.d.ts` | `tsconfig.web.json` |
| `01-RESEARCH.md` §Validation Architecture / Wave 0 Gaps | Vitest 2.x setup, моки `electron`, snapshot webPreferences | все `*.test.ts` |
| `01-CONTEXT.md` §Decisions D-01..D-15 | Закреплённые ограничения и контракты | все файлы |

## File Classification

| Файл | Origin | Role | Data Flow | Closest Analog | Match Quality |
|------|--------|------|-----------|----------------|---------------|
| `package.json` | modify (из шаблона) | config | n/a | шаблон `react-ts` → правится | template-baseline |
| `electron.vite.config.ts` | modify (из шаблона) | config (build) | n/a | шаблон `react-ts` → правится | template-baseline |
| `electron-builder.yml` | модификация/no-op | config (packaging) | n/a | шаблон → не трогаем в Phase 1 (Phase 5) | deferred |
| `tsconfig.json` | modify (из шаблона) | config (TS solution) | n/a | шаблон `react-ts` | template-baseline |
| `tsconfig.node.json` | modify (из шаблона) | config (main+preload TS) | n/a | шаблон `react-ts` | template-baseline |
| `tsconfig.web.json` | modify (из шаблона) | config (renderer TS) | n/a | шаблон + Pitfall #10 (include preload .d.ts + shared) | template-baseline |
| `vitest.config.ts` | create | config (test) | n/a | RESEARCH §Validation Arch (Wave 0 Gap) | research-only |
| `tests/setup.ts` | create | test fixture | n/a | RESEARCH §Wave 0 Gaps (мок `electron`) | research-only |
| `src/shared/ipc.ts` | create | contract / types | n/a (compile-time) | RESEARCH §Pattern 2 | research-only |
| `src/main/index.ts` | replace (шаблонный) | bootstrap | event-driven (lifecycle) | RESEARCH §Pattern 4 | research-only |
| `src/main/window.ts` | create | factory | request-response (lifecycle) | RESEARCH §Pattern 1 | research-only |
| `src/main/ipc/index.ts` | create | registry | event-driven (ipcMain) | RESEARCH §Pattern 2 (registerSettingsHandlers вызов) | research-only |
| `src/main/ipc/settings.ts` | create | controller (IPC handler) | request-response | RESEARCH §Pattern 2 (нижний блок) | research-only |
| `src/main/services/secure-backend.ts` | create | service (singleton) | sync read | RESEARCH §Pattern 3 (нижний блок) | research-only |
| `src/main/services/secrets-store.ts` | create | service (repo) | CRUD (file I/O + crypto) | RESEARCH §Pattern 3 (верхний блок) | research-only |
| `src/main/services/settings-store.ts` | create | service (config repo) | CRUD (electron-store) | RESEARCH §Pitfall #3 (dynamic import) | research-only |
| `src/preload/index.ts` | replace (шаблонный) | bridge | request-response (IPC проксирование) | RESEARCH §Pattern 2 (preload блок) | research-only |
| `src/preload/index.d.ts` | replace (шаблонный) | type declaration | n/a | RESEARCH §Pattern 2 (последний блок) | research-only |
| `src/renderer/src/App.tsx` | replace (шаблонный) | component (root + router-lite) | request-response (через `window.scrubber`) | RESEARCH §Architecture Diagram (renderer часть) | research-only |
| `src/renderer/src/routes/Transcribe.tsx` | create | component (placeholder) | static | RESEARCH §Architecture Diagram | research-only |
| `src/renderer/src/routes/Analyze.tsx` | create | component (placeholder) | static | RESEARCH §Architecture Diagram | research-only |
| `src/renderer/src/routes/Settings.tsx` | create | component (form) | request-response | CONTEXT D-05 + RESEARCH §Architecture Diagram | research-only |
| `src/renderer/src/components/BackendWarningBanner.tsx` | create | component | request-response (читает `getSecureBackend()`) | CONTEXT D-07 + RESEARCH §Architecture Diagram | research-only |
| `src/renderer/src/styles.css` | modify | style entry | n/a | шаблон + `@import "tailwindcss"` | template-baseline |
| `src/main/window.test.ts` | create | unit test | n/a | RESEARCH §Wave 0 Gaps (snapshot webPreferences) | research-only |
| `src/main/services/secrets-store.test.ts` | create | unit test | n/a | RESEARCH §Wave 0 Gaps (SHELL-02a) | research-only |
| `src/main/services/secure-backend.test.ts` | create | unit test | n/a | RESEARCH §Wave 0 Gaps (SHELL-03 + Pitfall #4 матрица бэкендов) | research-only |
| `src/preload/index.test.ts` | create | unit test | n/a | RESEARCH §Wave 0 Gaps (SHELL-02c) | research-only |
| `tests/integration/secrets-persist.test.ts` | create | integration test | n/a | RESEARCH §Wave 0 Gaps (SHELL-02b) | research-only |

## Pattern Assignments (per file, без копирования кода)

> Для каждого файла указан режим модуля, контракты безопасности, источник в RESEARCH.md и якорные решения CONTEXT. Планировщик НЕ должен дублировать код — он должен ссылаться на §Pattern N в RESEARCH.md.

### Config / build / tests

#### `package.json`
- Origin: модифицируем шаблонный.
- **MUST:** `"type": "module"` (RESEARCH Pitfall #3, A2). Закрепить точные версии через `--save-exact` (RESEARCH §Standard Stack).
- Scripts: `dev`, `build`, `typecheck`, `test`, `test:unit` (RESEARCH §Validation Architecture).
- Никаких `keytar`, `@electron/remote` (CONTEXT D-15, RESEARCH §Anti-Patterns).

#### `electron.vite.config.ts`
- Origin: модифицируем шаблонный.
- **MUST:** main собирается как ESM (`format: 'es'`). Tailwind v4 через `@tailwindcss/vite` для renderer.
- Источник: RESEARCH §Common Pitfalls #3 (assumption A2 — проверить, что шаблон уже даёт ESM-output для main; если нет — фикс).

#### `tsconfig.web.json`
- Origin: модифицируем шаблонный.
- **MUST:** include `../preload/index.d.ts` и `../shared/ipc.ts`, иначе `window.scrubber` не типизируется (RESEARCH Pitfall #10).

#### `vitest.config.ts` + `tests/setup.ts`
- Origin: создать.
- Контракт: Vitest 2.x, ESM, `setupFiles: ['./tests/setup.ts']`. Setup мокает модуль `electron` (`app.getPath`, `safeStorage.*`, `BrowserWindow`) — без этого юнит-тесты не запустятся вне Electron-рантайма.
- Источник: RESEARCH §Validation Architecture / §Wave 0 Gaps.

### Shared contract (фундамент IPC)

#### `src/shared/ipc.ts`
- Origin: создать. ESM. Чистые типы + const-enum `Channels`.
- **MUST:** ровно 4 метода settings-namespace из D-11 (`saveApiKey`, `hasApiKey`, `clearApiKey`, `getSecureBackend`). Никаких заглушек под `media/transcribe/llm` (CONTEXT D-09).
- Result-тип для мутаций: `{ ok: true } | { ok: false; reason: string }` (RESEARCH Pitfall #7, CONTEXT discretion).
- `SecureBackend` union: `keychain | dpapi | libsecret | kwallet | basic_text | unavailable` (CONTEXT D-06).
- Источник кода: RESEARCH §Pattern 2 (верхний блок).

### Main process

#### `src/main/index.ts` (bootstrap)
- Origin: замена шаблонного.
- **MUST:** инициализация строго в порядке `secureBackend.init()` → `await secretsStore.init()` → `registerIpcHandlers()` → `createWindow()` внутри `app.whenReady()` (RESEARCH Pitfall #5 — safeStorage недоступен до ready).
- Подключить `@electron-toolkit/utils` (`electronApp`, `optimizer`) — из шаблона.
- Источник: RESEARCH §Pattern 4.

#### `src/main/window.ts` (factory)
- Origin: создать (шаблонный `createWindow` в `index.ts` шаблона переезжает сюда и переписывается).
- **MUST:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false` (CONTEXT D-14, RESEARCH Anti-Pattern #1).
- `setWindowOpenHandler` → `shell.openExternal` + `deny` (RESEARCH §Security Domain / Pattern 1).
- Источник: RESEARCH §Pattern 1.

#### `src/main/ipc/index.ts` + `src/main/ipc/settings.ts`
- Origin: создать.
- **MUST:** все 4 канала D-11 через `ipcMain.handle` (не `on/send` — RESEARCH Anti-Pattern). Возвращать Result-тип, валидация типа аргументов руками (`typeof key === 'string'`, V5 ASVS, без zod в Phase 1).
- `registerIpcHandlers()` из `index.ts` зовёт `registerSettingsHandlers()` — точка расширения для будущих namespaces (CONTEXT D-09).
- Источник: RESEARCH §Pattern 2 (нижний блок).

#### `src/main/services/secure-backend.ts`
- Origin: создать. Singleton-экспорт (`export const secureBackend = new SecureBackendService()`).
- **MUST:** `getSelectedStorageBackend()` зовётся ТОЛЬКО при `process.platform === 'linux'` (RESEARCH Pitfall #4). Маппинг `gnome_libsecret → libsecret`, `kwallet|kwallet5|kwallet6 → kwallet`, `basic_text → basic_text`, прочее → `unavailable`.
- Init вызывается ПОСЛЕ `app.whenReady()` (Pitfall #5).
- Источник: RESEARCH §Pattern 3 (нижний блок).

#### `src/main/services/secrets-store.ts`
- Origin: создать.
- **MUST:** plaintext-ключ живёт в `this.memory` только в main; на диск пишется `safeStorage.encryptString` → `Buffer.toString('base64')` в `secrets.bin` (Pitfall #6). Файл `app.getPath('userData')/secrets.bin`, `mode: 0o600`.
- Memory-only режим если backend ∈ {`unavailable`, `basic_text`} — никаких записей на диск (CONTEXT D-07, SHELL-03).
- `hasApiKey()` — синхронный boolean (renderer не получает значение, только факт — D-05, ASVS V2/V8).
- Источник: RESEARCH §Pattern 3 (верхний блок).

#### `src/main/services/settings-store.ts`
- Origin: создать.
- **MUST:** ESM-only `electron-store@11`. Импорт через `const Store = (await import('electron-store')).default` внутри async init (RESEARCH Pitfall #3, ассумпция A2).
- НИ В КОЕМ СЛУЧАЕ не использовать опцию `encryptionKey` (CONTEXT D-13, RESEARCH Anti-Pattern).
- В Phase 1 хранит только `secureBackend` last-known + UI prefs (если будут) — `config.json` рядом с `secrets.bin`.

### Preload (sandboxed bridge)

#### `src/preload/index.ts`
- Origin: замена шаблонного.
- **MUST:** `contextBridge.exposeInMainWorld('scrubber', scrubber)`. Если `process.contextIsolated === false` — `throw new Error(...)` (fail-loud, D-14).
- Только `ipcRenderer.invoke` через `Channels.*` константы из `shared/ipc.ts`. Никаких `fs/path/child_process` (RESEARCH Pitfall #9 — sandboxed preload их не даст).
- Никакого `api: unknown` (RESEARCH Anti-Pattern #2). Bridge типизирован как `ScrubberApi`.
- Источник: RESEARCH §Pattern 2 (preload блок).

#### `src/preload/index.d.ts`
- Origin: замена шаблонного.
- **MUST:** `declare global { interface Window { scrubber: ScrubberApi } }`. Файл подхватывается через `tsconfig.web.json` (см. Pitfall #10).
- Источник: RESEARCH §Pattern 2 (последний блок).

### Renderer (React 19 + Tailwind 4, no Node)

> Все renderer-файлы НЕ импортируют ничего из `electron`/`node:*`. Единственный канал к main — `window.scrubber.*` (CONTEXT D-15).

#### `src/renderer/src/App.tsx`
- Origin: замена шаблонного.
- **MUST:** контракт — топ-нав с 3 вкладками (Transcribe/Analyze/Settings, CONTEXT D-04). Router-lite (useState активной вкладки) — без `react-router`, MVP-минимум (CONTEXT discretion).
- При маунте — `window.scrubber.settings.getSecureBackend()` → проброс в `<BackendWarningBanner />`.

#### `src/renderer/src/routes/Transcribe.tsx`, `Analyze.tsx`
- Origin: создать. Placeholder-компоненты «Coming in Phase 3/4» (CONTEXT D-04). Никакой логики.

#### `src/renderer/src/routes/Settings.tsx`
- Origin: создать.
- **MUST:** поле ввода API-ключа (OpenAI-compatible), кнопка Save, баннер `hasApiKey === true` → «Ключ сохранён», replace-flow через `clearApiKey() → saveApiKey()` (CONTEXT D-05).
- Использует `window.scrubber.settings.{saveApiKey,hasApiKey,clearApiKey,getSecureBackend}` — все 4 метода из D-11.
- Tailwind v4 defaults, MVP-стилистика (CONTEXT discretion).

#### `src/renderer/src/components/BackendWarningBanner.tsx`
- Origin: создать.
- **MUST:** показывает жёлтый warning (не error) если `secureBackend ∈ {basic_text, unavailable}`, с инструкцией поставить `gnome-keyring`/`kwallet` (CONTEXT D-07). Save при этом НЕ блокируется.

### Tests (Wave 0 gates)

| Файл | Что покрывает | Источник в RESEARCH |
|------|---------------|----------------------|
| `src/main/window.test.ts` | snapshot `webPreferences` ⇒ D-14 constraints | §Wave 0 Gaps |
| `src/main/services/secrets-store.test.ts` | encrypt/decrypt round-trip, memory-only path, base64-сериализация (Pitfall #6) | §Wave 0 Gaps, SHELL-02a |
| `src/main/services/secure-backend.test.ts` | матрица `gnome_libsecret/kwallet5/kwallet6/basic_text/unknown` + linux/non-linux platform guard | §Wave 0 Gaps, SHELL-03, Pitfall #4 |
| `src/preload/index.test.ts` | bridge не утечкает ключ; имена каналов совпадают с `Channels.*` | §Wave 0 Gaps, SHELL-02c |
| `tests/integration/secrets-persist.test.ts` | save → reload main → read; mock `app.getPath` через `tmpdir` | §Wave 0 Gaps, SHELL-02b |

## Shared Patterns (cross-cutting)

### Process boundary (D-14, ASVS V4)
**Source:** CONTEXT D-14, D-15, RESEARCH §Pattern 1 / §Security Domain.
**Apply to:** `src/main/window.ts` (фиксация webPreferences) + `src/preload/index.ts` (fail-loud если контекст не изолирован) + ВСЕ renderer-файлы (запрет любых `electron`/`node:*` импортов).

### IPC contract shape (D-08, D-09, D-10)
**Source:** RESEARCH §Pattern 2.
**Apply to:** `src/shared/ipc.ts` (единый source-of-truth), `src/preload/index.ts` (использует `Channels.*`), `src/main/ipc/settings.ts` (использует те же `Channels.*`), `src/renderer/src/routes/Settings.tsx` (только через `window.scrubber.settings.*`).
**Правило:** имя канала меняется в одном месте — в `shared/ipc.ts`. Никаких строковых литералов каналов в main/preload/renderer.

### Result-тип для IPC (Pitfall #7)
**Source:** RESEARCH §Pattern 2, Pitfall #7, CONTEXT discretion.
**Apply to:** все `ipcMain.handle` в `src/main/ipc/*.ts`. Никаких `throw new Error(...)` через границу IPC — только `{ ok: false, reason }`. Логирование оригинальной ошибки через `console.error` остаётся в main.

### safeStorage init order (Pitfall #5)
**Source:** RESEARCH §Pattern 4, Pitfall #5.
**Apply to:** `src/main/index.ts` (порядок init), `src/main/services/secure-backend.ts` (init вызывается извне), `src/main/services/secrets-store.ts` (init вызывается после backend).

### ESM-only paths (Pitfall #3)
**Source:** RESEARCH §Common Pitfalls #3, ассумпция A2.
**Apply to:** `package.json` (`"type": "module"`), `electron.vite.config.ts` (main как ESM), `src/main/services/settings-store.ts` (dynamic import `electron-store`).

### Сериализация криптотекста (Pitfall #6)
**Source:** RESEARCH §Common Pitfalls #6.
**Apply to:** `src/main/services/secrets-store.ts` — всегда `Buffer ↔ base64 string` на границе JSON-файла. Не сериализовать `Buffer` напрямую через JSON.

### Linux-only API guard (Pitfall #4)
**Source:** RESEARCH §Common Pitfalls #4.
**Apply to:** `src/main/services/secure-backend.ts` — `getSelectedStorageBackend()` только под `process.platform === 'linux'`.

## No Analog Found

Все 22+ файла Phase 1 не имеют аналогов в репозитории — проект greenfield. Планировщик ОБЯЗАН опираться на:

1. **RESEARCH §Pattern 1..4** — конкретные code-блоки для main/preload/shared.
2. **RESEARCH §Common Pitfalls #3..#10** — обязательные защитные меры.
3. **RESEARCH §Wave 0 Gaps** — точный список тест-файлов, которых нет в шаблоне.
4. **CONTEXT §Decisions D-01..D-15** — закреплённые ограничения.

Дублировать сами code-блоки в PLAN.md НЕ нужно — план должен ссылаться на секции (`см. 01-RESEARCH.md §Pattern 3`) и фиксировать только action-уровень («скопировать SecretsStore из §Pattern 3, расширить полем X»).

## Anti-Pattern Checklist (must NOT appear в diff Phase 1)

Из RESEARCH §Anti-Patterns + CONTEXT D-13/D-15:

- [ ] `sandbox: false` где-либо в `webPreferences`.
- [ ] `api: unknown` или `as any` в preload.
- [ ] `nodeIntegration: true`.
- [ ] `enableRemoteModule` / `@electron/remote`.
- [ ] `keytar` в `package.json`.
- [ ] `new Store({ encryptionKey: ... })`.
- [ ] `ipcMain.on(...) + webContents.send(...)` для запрос-ответа (только `handle/invoke`).
- [ ] `throw` сырых `Error` из `ipcMain.handle` (использовать Result).
- [ ] Импорты `fs`/`path`/`child_process` в renderer или preload.
- [ ] Хардкод путей вместо `app.getPath('userData')` (Pitfall #8).
- [ ] Любые строковые литералы каналов вне `src/shared/ipc.ts`.

## Metadata

**Analog search scope:** `src/**` (пуст), корень репозитория (только `.planning/` + `CLAUDE.md`).
**Files scanned:** 0 кодовых.
**Pattern source:** `.planning/phases/01-foundation-app-shell/01-RESEARCH.md` + `01-CONTEXT.md` + `CLAUDE.md` §Technology Stack.
**Pattern extraction date:** 2026-05-28.
