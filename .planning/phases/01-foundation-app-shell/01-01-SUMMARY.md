---
phase: 01-foundation-app-shell
plan: 01
subsystem: build / test-infra
tags: [electron, electron-vite, vitest, scaffold, esm, wave-0]
one_liner: "Скаффолд шаблона electron-vite react-ts, ESM, версии стека по CLAUDE.md и Wave 0 мок модуля electron для vitest"
requires: []
provides:
  - "Запускаемый electron-vite-проект (npm run dev) с зелёным npm run typecheck"
  - "Wave 0 тестовая инфраструктура vitest@2 + mock 'electron' (app/safeStorage/BrowserWindow/ipcMain/contextBridge/shell/utilityProcess)"
  - "tests/setup.ts экспортирует setBackend()/setEncryptionAvailable() для перепривязки safeStorage между тестами Plan 02..04"
  - "Каркас каталогов src/shared, src/main/services, src/main/ipc, src/renderer/src/routes, src/renderer/src/components, tests/integration"
affects:
  - "Все последующие планы фазы (01-02..01-04) опираются на ESM-сборку main и мок electron"
tech_stack_added:
  - "electron@42.3.0"
  - "electron-vite@5.0.0"
  - "electron-builder@26.8.1"
  - "react@19.2.6, react-dom@19.2.6"
  - "typescript@5.9.3"
  - "tailwindcss@4.3.0 + @tailwindcss/vite@4.3.0"
  - "vitest@2.1.9 + @vitest/coverage-v8@2.1.9"
  - "@electron-toolkit/preload@3.0.2, @electron-toolkit/utils@4.0.0, @electron-toolkit/tsconfig@2.0.0"
patterns_used:
  - "ESM main+preload (electron.vite.config.ts format='es' + package.json type=module) — Pitfall #3"
  - "tsconfig.web include preload .d.ts и shared/** — Pitfall #10"
  - "vi.mock('electron') как глобальный setupFile vitest — Wave 0 Gap"
key_files_created:
  - path: "package.json"
    role: "ESM, точные версии CLAUDE.md, scripts dev/build/typecheck/test/test:unit"
  - path: "electron.vite.config.ts"
    role: "main+preload format='es', @tailwindcss/vite в renderer, alias @shared"
  - path: "tsconfig.web.json"
    role: "include preload .d.ts + shared/** + alias @shared"
  - path: "tsconfig.node.json"
    role: "include shared/** + alias @shared (main/preload)"
  - path: "vitest.config.ts"
    role: "Vitest 2.x ESM, environment=node, setupFiles=[tests/setup.ts], alias"
  - path: "tests/setup.ts"
    role: "vi.mock('electron') фабрика с app/safeStorage/BrowserWindow/ipcMain/contextBridge/shell/utilityProcess + setBackend/setEncryptionAvailable хелперы"
  - path: "tests/smoke.test.ts"
    role: "Sanity-тест, что vitest исполняет ESM-проект"
  - path: "tests/electron-mock.test.ts"
    role: "Контрактные тесты на сам мок (6 проверок): импорт electron, encrypt/decrypt round-trip, переподмена backend, getPath, isEncryptionAvailable, BrowserWindow __opts"
  - path: ".gitignore"
    role: "node_modules/dist/out/*.bin/secrets.bin"
  - path: "src/shared/, src/main/services/, src/main/ipc/, src/renderer/src/routes/, src/renderer/src/components/, tests/integration/"
    role: "Каркас каталогов для Plan 02..04 (через .gitkeep)"
key_files_modified: []
decisions:
  - "Сборка main и preload как ESM (format:'es' + type:module) — закрывает Pitfall #3 (electron-store@11 ESM-only). Альтернатива через динамический import() отклонена: ломает единообразие модульной системы и усложняет dev-experience."
  - "Шаблон скопирован из github.com/alex8088/quick-start/master/playground/react-ts (extract), а не сгенерирован через `npm create @quick-start/electron`. Причина: CLI ожидает интерактивный TTY (prompts), не поддерживает non-TTY pipe-stdin → нельзя автоматизировать. Результат идентичен официальному шаблону (тот же дерево файлов из релиза @quick-start/create-electron@1.0.30)."
  - "Удалены eslint/prettier из шаблона: они не нужны в Phase 1 и затянули бы 200+ MB зависимостей. Добавим при необходимости позже."
  - "test:unit и test реально работают: vitest без vitest.config.ts тоже стартует, но через config мы фиксируем setupFiles глобально — обязательное условие для последующих unit-тестов Plan 02..04 (без него каждый тестовый файл должен сам мокать electron)."
metrics:
  duration: "≈ 30 мин (включая npm install ≈ 1 мин и решение TTY-проблемы create-electron)"
  tasks_completed: 2
  files_created: 13
  files_modified: 0
  commits: 2
date_completed: "2026-05-28"
---

# Phase 01 Plan 01: Foundation scaffold & Wave 0 test infra — Summary

Поднят официальный шаблон electron-vite react-ts, версии приведены к CLAUDE.md, проект переведён на ESM, настроен Vitest 2.x с глобальным моком модуля `electron` — фундамент для Plan 02..04.

## Task-by-task

### Task 1: Scaffold react-ts + version pin + ESM
**Commit:** `3596754` — `feat(01-01): поднять скелет electron-vite react-ts, ESM и базовые версии`

- Извлёк шаблон `react-ts` напрямую из tarball репозитория `alex8088/quick-start@master` (CLI `npm create @quick-start/electron` зависает на интерактивных промптах в non-TTY среде Claude — задокументировал отклонение).
- Привёл `package.json` к версиям CLAUDE.md (electron@42.3.0, electron-vite@5.0.0, electron-builder@26.8.1, react@19.2.6, tailwindcss@4.3.0 и т.д.); добавил `"type": "module"`; удалил eslint/prettier и связанные dev-зависимости (Phase 1 их не требует).
- Scripts: `dev`, `build`, `start`, `typecheck` (Node+Web), `test:unit` (vitest run --reporter=dot), `test` (typecheck && vitest run && electron-vite build).
- `electron.vite.config.ts`: main и preload собираются как ESM (`rollupOptions.output.format = 'es'`), Tailwind v4 подключён через `@tailwindcss/vite()` в renderer, alias `@shared`.
- `tsconfig.web.json`: добавлены `src/preload/index.d.ts` и `src/shared/**/*` в include + alias `@shared/*` (Pitfall #10).
- `tsconfig.node.json`: добавлены `src/shared/**/*` + alias `@shared/*`.
- `.gitignore`: добавлены `*.bin` и `secrets.bin` (мера предосторожности — userData снаружи репо).
- Создан каркас каталогов через `.gitkeep`: `src/shared`, `src/main/services`, `src/main/ipc`, `src/renderer/src/routes`, `src/renderer/src/components`, `tests/integration`.
- `npm install`: 424 пакета, native-deps собраны под Electron 42 (`electron-builder install-app-deps`).

**Acceptance:**
- `npm run typecheck` → exit 0
- `package.json` содержит `"type": "module"`, точные версии, нет `keytar`
- `tsconfig.web.json` include содержит `src/preload/index.d.ts` и `src/shared/**/*`

### Task 2: Vitest 2.x + electron mock (TDD)
**Commit:** `73e16de` — `test(01-01): Vitest 2.x + Wave 0 мок модуля electron`

**TDD RED:** Создал `tests/electron-mock.test.ts` (6 проверок на контракт мока) и `tests/smoke.test.ts` до того, как появились `vitest.config.ts`/`tests/setup.ts`. Запустил `npx vitest run` — `electron-mock.test.ts` упал на `Failed to load url ./setup`, smoke прошёл. RED подтверждён.

**TDD GREEN:** Создал:
- `vitest.config.ts` — Vitest 2.x ESM, `environment: 'node'`, `setupFiles: ['./tests/setup.ts']`, `globals: false`, alias `@shared`/`@main`/`@renderer`, include `src/**/*.test.ts` и `tests/**/*.test.ts`.
- `tests/setup.ts` — `vi.mock('electron', () => ({ ... }))` с фабрикой:
  - `app.getPath(name)` → `os.tmpdir()/scrubber-test/<name>`, `whenReady` → Promise<void>, `on/quit/setAppUserModelId` — vi.fn().
  - `safeStorage.encryptString(s)` → `Buffer.from('enc:' + s)`; `decryptString(buf)` → strip `^enc:` (обратимая обёртка для round-trip тестов SHELL-02a).
  - `safeStorage.isEncryptionAvailable()` и `getSelectedStorageBackend()` — управляются модульным состоянием, перепривязываются через **экспортируемые** `setBackend(b)` и `setEncryptionAvailable(v)`. Дефолт: `'gnome_libsecret'`, `true`.
  - `BrowserWindow` — класс, сохраняющий все опции конструктора в `instance.__opts` (для snapshot-теста D-14 в Plan 02 `window.test.ts`). Прототип: `loadURL/loadFile/on/once/show`, `webContents.{setWindowOpenHandler,on,send}`, `static getAllWindows`.
  - `ipcMain`, `contextBridge`, `shell.openExternal`, `utilityProcess.fork` — vi.fn().

**Acceptance:**
- `npm run test:unit` → 7/7 пройдено (smoke 1 + electron-mock contract 6) → exit 0
- `vitest.config.ts` содержит `setupFiles: ['./tests/setup.ts']`
- `tests/setup.ts` содержит `vi.mock('electron'` и `export function setBackend`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Скаффолд через `npm create @quick-start/electron` невозможен в non-TTY среде**

- **Found during:** Task 1
- **Issue:** CLI `@quick-start/create-electron@1.0.30` использует библиотеку `prompts` с интерактивными промптами (Package name, Add updater, Mirror proxy, ...). В non-TTY pipe-stdin промпты не потребляют ответы корректно — CLI зависает на первом же вопросе. Передача `--template react-ts` пропускает только один вопрос (template).
- **Fix:** Скачал tarball официального репозитория `alex8088/quick-start@master`, извлёк `packages/create-electron/playground/react-ts` (это и есть фактический playground, который CLI копирует) и скопировал содержимое в воркtree. Дерево файлов идентично тому, что генерирует CLI (verified: `electron@39.2.6` в исходном `package.json`, `sandbox: false` в `src/main/index.ts`, `api: unknown` в `src/preload/index.ts` — те же артефакты, упомянутые в 01-RESEARCH.md §Pitfall 1/2).
- **Files modified:** все 13 файлов шаблона (см. key_files_created).
- **Commit:** `3596754`.
- **Не Rule 4 (архитектурное):** D-01 в 01-CONTEXT.md требует «стартуем через шаблон react-ts», а не «через конкретную команду npm create». Использован тот же исходник шаблона — закреплённое D-01 решение не нарушено.

### Out-of-Scope (не реализовано — относится к Plan 02..04)

- Перепись `src/main/index.ts` под безопасные `webPreferences` (D-14) и порядок `secureBackend.init() → secretsStore.init() → IPC → window` — Plan 02.
- `src/shared/ipc.ts`, переписанный preload, IPC хендлеры settings — Plan 02.
- safeStorage сервис, secrets.bin / config.json — Plan 02/03.
- Settings UI, навигация, BackendWarningBanner — Plan 04.

## Authentication / Setup Gates

Нет. Этот план не требует ввода ключей, секретов или внешней авторизации.

## Threat Surface Scan

Threat-register плана (`<threat_model>`) предусматривал:

- **T-01-SC (Tampering — npm install):** установлены только пакеты из white-list CLAUDE.md §Technology Stack. Анти-листа (keytar, @electron/remote, `electron-store` с encryptionKey) — нет. `package-lock.json` зафиксирован в коммите. Verified: `node -e "...keytar..."` exit 0.
- **T-01-CFG (Tampering — конфиги из шаблона):** Шаблон react-ts по умолчанию ставит `sandbox: false` в `src/main/index.ts` и `api: unknown` в `src/preload/index.ts`. Эти файлы оставлены **как есть** (не правились в Plan 01) — Plan 02 их **переписывает целиком** (см. 01-PATTERNS.md §`src/main/window.ts` и §`src/preload/index.ts`). Это **не запуск приложения с дырой**: Plan 01 не добавляет `npm run dev` в success-criteria фазы и не публикует артефакт — фаза откроется наружу только после Plan 04.

Новых surface, не описанных в threat_model плана, не появилось.

## Known Stubs

Нет. Все артефакты этого плана — реальная инфраструктура (конфиги, мок), без UI-заглушек, отображающих пустые данные.

## Self-Check: PASSED

Файлы:
- `package.json` — FOUND (commit 3596754)
- `electron.vite.config.ts` — FOUND
- `tsconfig.node.json`, `tsconfig.web.json` — FOUND
- `vitest.config.ts` — FOUND (commit 73e16de)
- `tests/setup.ts` — FOUND
- `tests/smoke.test.ts`, `tests/electron-mock.test.ts` — FOUND
- `.gitignore` — FOUND

Коммиты:
- `3596754` — FOUND (`git log --oneline`)
- `73e16de` — FOUND

Команды:
- `npm run typecheck` — exit 0 ✓
- `npm run test:unit` — exit 0, 7/7 тестов ✓

---

*Plan 01-01 executed 2026-05-28. Worktree: `agent-a7ab8bacf4504ee0e`. Дальше — Plan 01-02 (process boundaries, IPC contract, safeStorage сервис).*
