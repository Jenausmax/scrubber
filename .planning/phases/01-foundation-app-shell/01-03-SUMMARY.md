---
phase: 01-foundation-app-shell
plan: 03
subsystem: preload-bridge
tags: [preload, ipc, contextBridge, integration-test, SHELL-02, SHELL-03]
requires:
  - 01-02 (Channels, ScrubberApi, SecretsStore, secureBackend)
provides:
  - "window.scrubber.settings.* (4 типизированные функции)"
  - "Integration-проверка SHELL-02b (save → restart → read)"
affects:
  - renderer (Phase 4 UI получит типизированный window.scrubber)
tech-stack:
  added: []
  patterns:
    - "preload allow-list через contextBridge (D-08, D-11)"
    - "fail-loud guard на process.contextIsolated (D-14)"
    - "Integration-тест через имитацию рестарта (новый инстанс класса вместо процесса)"
key-files:
  created:
    - src/preload/index.test.ts
    - tests/integration/secrets-persist.test.ts
  modified:
    - src/preload/index.ts (полная замена: shell-шаблон → bridge с allow-list)
    - src/preload/index.d.ts (полная замена: ElectronAPI → ScrubberApi)
    - tests/setup.ts (+ipcRenderer mock)
    - src/renderer/src/App.tsx (убрано использование window.electron)
    - src/renderer/src/components/Versions.tsx (убрано использование window.electron)
decisions:
  - "Преlоad экспонирует ТОЛЬКО namespace settings — никаких заглушек под media/transcribe/llm (D-09)"
  - "Fail-loud throw при contextIsolated=false вместо тихого fallback в window.* (D-14)"
  - "Integration-тест эмулирует «рестарт» через `new SecretsStore()` + повторный init() — без процесс-форка"
metrics:
  duration: "≈12 минут"
  completed: 2026-05-28
  tasks_completed: 2
  tests_added: 9 (5 preload + 4 integration)
  total_tests_passing: 41
---

# Phase 01 Plan 03: Preload Bridge + Integration Test Summary

Типизированный bridge `window.scrubber.settings.*` (4 функции), fail-loud guard на contextIsolation, integration-тест save→рестарт→read через имитацию нового процесса — SHELL-02 закрыт end-to-end.

## What Was Built

**Преlоad bridge (`src/preload/index.ts`):**
- Заменён шаблонный `electronAPI/api` preload на узкий allow-list: `contextBridge.exposeInMainWorld('scrubber', { settings: { saveApiKey, hasApiKey, clearApiKey, getSecureBackend } })`.
- Каждая функция — обёртка над `ipcRenderer.invoke(Channels.X, ...)`. Каналы тянутся **только** через `Channels.*` из `src/shared/ipc.ts` — строковых литералов вне shared нет (grep gate подтверждает).
- На самом верху модуля: `if (!process.contextIsolated) throw new Error(...)` — fail-loud (D-14).
- Никаких импортов `fs`, `path`, `child_process`, `os`, `node:*` — sandboxed preload по Pitfall #9.

**Типизация (`src/preload/index.d.ts`):**
- `declare global { interface Window { scrubber: ScrubberApi } }` — TypeScript видит bridge в renderer-проекте (tsconfig.web.json уже включает `src/preload/*.d.ts`).
- Подтверждено: `npm run typecheck` (node + web) exit 0.

**Unit-тесты preload (`src/preload/index.test.ts`, 5 кейсов):**
1. `contextBridge.exposeInMainWorld` вызван **ровно один раз**, ключ === `'scrubber'`.
2. Объект содержит **только** ключ `settings` с четырьмя функциями (`saveApiKey/hasApiKey/clearApiKey/getSecureBackend`).
3. Нет запрещённых namespaces: `media`, `transcribe`, `llm`, `api`, `electron`, `ipcRenderer`.
4. Каждая функция проксирует в `ipcRenderer.invoke` с правильным каналом и аргументом.
5. Fail-loud: при `process.contextIsolated === false` `await import('./index')` rejects с `/contextIsolation/i`.

**Integration-тест (`tests/integration/secrets-persist.test.ts`, 4 кейса):**
- На backend=libsecret: round-trip save → новый `SecretsStore` инстанс + init → `hasApiKey === true` (SHELL-02b).
- На libsecret: `clearApiKey()` на втором инстансе удаляет файл; третий инстанс видит пустоту.
- На basic_text: `saveApiKey` НЕ пишет файл; «рестарт» (новый инстанс) → `hasApiKey === false` (SHELL-03).
- На unavailable: `fs.writeFile` НЕ вызывается; memory-only поведение симметрично basic_text.

**Сопутствующие правки:**
- `tests/setup.ts`: добавлен `ipcRenderer` mock (`invoke/on/removeListener/send`) — без него preload-тест не мог импортировать `electron` модуль.
- `src/renderer/src/App.tsx`, `components/Versions.tsx`: удалены обращения к `window.electron.*` — преlоад больше его не экспонирует (D-08/D-09). Это шаблонный код из starter'а, который и так будет переписан в Plan 04 UI. Минимальное изменение, чтобы typecheck:web прошёл.

## Acceptance Gates

| Gate | Команда | Результат |
|------|---------|-----------|
| Preload-тест зелёный | `npx vitest run src/preload/index.test.ts` | 5/5 |
| Integration-тест зелёный | `npx vitest run tests/integration/secrets-persist.test.ts` | 4/4 |
| Вся unit-suite зелёная | `npm run test:unit` | 41/41 |
| Typecheck (node + web) | `npm run typecheck` | exit 0 |
| Один вызов exposeInMainWorld | `grep -c contextBridge.exposeInMainWorld src/preload/index.ts` | 1 |
| Нет media/transcribe/llm namespaces | `grep -cE "(media\|transcribe\|llm):" src/preload/index.ts` | 0 |
| Нет node-импортов в preload | `grep -E "from '(node:\|fs\|path\|child_process\|os)'" src/preload/index.ts` | exit 1 (пусто) |
| Нет строковых каналов вне shared/ipc.ts | recursive grep | exit 1 (пусто) |

## SecretsStore — диff по контракту

**Не потребовался рефакторинг.** План допускал лёгкий рефакторинг (вынос `export class SecretsStore` отдельно от singleton), но Wave 2 уже экспортирует и класс, и singleton:

```ts
// src/main/services/secrets-store.ts (без изменений)
export class SecretsStore { /* ... */ }
export const secretsStore = new SecretsStore()
```

Integration-тест импортирует **класс** и инстанцирует его дважды для эмуляции «рестарта» — singleton не трогает, чтобы не загрязнять состояние между тестами.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] renderer обращался к `window.electron`, которого больше нет**
- **Найдено при:** Task 1, после изменения preload — `npm run typecheck:web` падал с `Property 'electron' does not exist on type Window`.
- **Причина:** Шаблонный `src/renderer/src/App.tsx` и `components/Versions.tsx` использовали `window.electron.ipcRenderer.send('ping')` и `window.electron.process.versions`. Новый preload экспонирует только `window.scrubber.settings.*` (D-09 запрещает заглушки под другие namespaces).
- **Фикс:** Удалены обращения к `window.electron` — кнопка «Send IPC» и блок версий заменены на статичные плейсхолдеры. Это шаблонный UI, который Plan 04 переписывает целиком.
- **Файлы:** `src/renderer/src/App.tsx`, `src/renderer/src/components/Versions.tsx`.
- **Коммит:** `b911af5`.

**2. [Rule 3 — Blocking] tests/setup.ts мок `electron` не имел `ipcRenderer`**
- **Найдено при:** Task 1 RED — preload-тест падал с «Named export 'contextBridge' not found»/`ipcRenderer is undefined`.
- **Причина:** Wave 0/2 setup мокал `contextBridge`, но не `ipcRenderer` (Wave 2 main-handlers не нуждались в нём — они подключаются через `ipcMain`).
- **Фикс:** Добавлен мок `ipcRenderer: { invoke, on, removeListener, send }`.
- **Файл:** `tests/setup.ts`.
- **Коммит:** `b911af5`.

### Скоупных deviations нет

План выполнен ровно так, как написан: 2 задачи, 2 коммита, TDD-цикл соблюдён (RED-тесты падали до GREEN-имплементации).

## Threat Model — статус mitigations

| Threat ID | Disposition | Подтверждение |
|-----------|-------------|----------------|
| T-01 (renderer compromise → main) | mitigate | Preload экспонирует 4 функции; нет `ipcRenderer`, `fs`, `child_process`. Тест проверяет отсутствие этих ключей. |
| T-02 (API key leak в renderer) | mitigate | `hasApiKey` возвращает `Result<boolean>`, plaintext не пересекает границу IPC (контракт ScrubberApi). |
| T-01-PRE (расширение allow-list) | mitigate | Тест явно проверяет отсутствие media/transcribe/llm/api/electron/ipcRenderer namespaces. Grep-gate в acceptance запрещает строковые литералы каналов. |

Новых threat flags не обнаружено — план не добавлял network endpoints, file access patterns или auth путей сверх Wave 2.

## Coverage of Plan Requirements

- ✅ SHELL-02 end-to-end: integration-тест save→рестарт→read зелёный.
- ✅ SHELL-03 persistence side: basic_text/unavailable backend НЕ пишут файл; рестарт даёт пустоту.
- ✅ Preload bridge типизирован, TypeScript видит `window.scrubber` в renderer.
- ✅ Fail-loud guard на `process.contextIsolated === false`.

## Files Modified This Plan

| File | Change | Lines |
|------|--------|-------|
| `src/preload/index.ts` | rewrite (shell-шаблон → bridge) | ~30 |
| `src/preload/index.d.ts` | rewrite (ElectronAPI → ScrubberApi) | ~13 |
| `src/preload/index.test.ts` | create | ~125 |
| `tests/integration/secrets-persist.test.ts` | create | ~115 |
| `tests/setup.ts` | + ipcRenderer mock | +6 |
| `src/renderer/src/App.tsx` | убран window.electron | -3 |
| `src/renderer/src/components/Versions.tsx` | убран window.electron | -3 |

## Commits

| Hash | Message |
|------|---------|
| `b911af5` | feat(01-03): preload bridge window.scrubber + типизация и тесты |
| `46f6758` | test(01-03): integration-тест persistence SHELL-02 через имитацию рестарта |

## Known Stubs

Нет стабов, блокирующих цель плана. Шаблонный renderer (`App.tsx`, `Versions.tsx`) содержит статичные плейсхолдеры — их **по плану** переписывает Plan 04 (UI Settings). Это не «недопроделанная работа» в скоупе 01-03, а явная граница между фазами (D-09).

## Self-Check: PASSED

- ✅ `src/preload/index.ts` существует, содержит `contextBridge.exposeInMainWorld('scrubber', ...)`
- ✅ `src/preload/index.d.ts` содержит `interface Window { scrubber: ScrubberApi }`
- ✅ `src/preload/index.test.ts` существует, 5 тестов зелёных
- ✅ `tests/integration/secrets-persist.test.ts` существует, 4 теста зелёных
- ✅ Коммит `b911af5` есть в `git log` (preload + типизация + renderer fix + setup)
- ✅ Коммит `46f6758` есть в `git log` (integration test)
- ✅ `npm run test:unit` 41/41 зелёных
- ✅ `npm run typecheck` exit 0
- ✅ Никаких изменений в `.planning/STATE.md` или `.planning/ROADMAP.md` (по требованию parallel-wave)
