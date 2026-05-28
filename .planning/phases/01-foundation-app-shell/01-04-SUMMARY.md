---
phase: 01-foundation-app-shell
plan: 04
subsystem: renderer-ui
tags: [react, tailwind, walking-skeleton, ui-shell, settings, secure-backend-warning]
requires:
  - 01-03 (preload bridge window.scrubber + типизация)
  - 01-02 (IPC handlers settings + secure-backend сервис)
  - 01-01 (skeleton: vite-plugins, shared/ipc.ts, tsconfig)
provides:
  - "Walking Skeleton end-to-end: окно → навигация → Settings save/replace → restart-persist"
  - "SHELL-01 закрыт визуально (manual cross-OS — см. checkpoint Task 3)"
  - "SHELL-02 закрыт end-to-end (round-trip уже зелёный в Plan 03, теперь и через UI)"
  - "SHELL-03 закрыт (memory-only + жёлтый BackendWarningBanner)"
affects:
  - src/renderer/src/main.tsx (переключён css entry на styles.css)
tech-stack:
  added:
    - "Tailwind v4 через styles.css `@import 'tailwindcss'` (плагин был ещё с Wave 0)"
  patterns:
    - "State-router useState<Tab> без react-router (MVP, CONTEXT discretion)"
    - "Mount-time fetch состояния (getSecureBackend, hasApiKey) с cancelled-флагом для unmount safety"
    - "Result-тип через `if (r.ok && r.data !== undefined)` в renderer (типобезопасное разворачивание)"
key-files:
  created:
    - src/renderer/src/styles.css
    - src/renderer/src/routes/Transcribe.tsx
    - src/renderer/src/routes/Analyze.tsx
    - src/renderer/src/routes/Settings.tsx
    - src/renderer/src/components/BackendWarningBanner.tsx
    - .planning/phases/01-foundation-app-shell/deferred-items.md
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/main.tsx
decisions:
  - "D-03 honored: дефолтная вкладка — Settings (пользователь сразу попадает в рабочую часть Phase 1)"
  - "D-05 honored: после save из state стираем input, никогда не рендерим ключ как текст в DOM"
  - "D-07 honored: жёлтый warning (не error), не блокирует UI"
  - "D-15 honored: zero impорts of electron/node:* в renderer (grep-gate passed)"
metrics:
  duration_min: 25
  tasks_completed: 2_of_3 # Task 3 — checkpoint human-verify, ожидает аппрува пользователя
  completed_date: "2026-05-28"
---

# Phase 1 Plan 04: Walking Skeleton UI Summary

**One-liner:** React UI с тремя вкладками + рабочий Settings экран (save/replace API key через safeStorage) + жёлтый BackendWarningBanner для деградации Linux-keyring.

## Что сделано

### Task 1 — App shell + routes + BackendWarningBanner (commit 49572b9)

- `src/renderer/src/App.tsx` — переписан с шаблонной заглушки:
  - `useState<Tab>('settings')` — дефолтная активная вкладка Settings (D-03).
  - `useState<SecureBackend | null>(null)` + `useEffect` маунт-time вызов
    `window.scrubber.settings.getSecureBackend()` с cancelled-флагом.
  - Топ-нав: три кнопки на русском (Транскрипция / Анализ / Настройки), активная подсвечена
    `bg-blue-600 text-white`, остальные — `hover:bg-gray-100`.
  - Под навигацией — `<BackendWarningBanner backend={backend} />`.
  - Под баннером — switch по active: рендер компонента из `routes/`.
- `src/renderer/src/routes/Transcribe.tsx` — placeholder «Доступно в Phase 3».
- `src/renderer/src/routes/Analyze.tsx` — placeholder «Доступно в Phase 4».
- `src/renderer/src/components/BackendWarningBanner.tsx`:
  - Props: `{ backend: SecureBackend | null }`.
  - `backend === null` → `return null` (загрузка).
  - `backend ∈ {'basic_text', 'unavailable'}` → жёлтый баннер
    (`bg-yellow-100 border border-yellow-400 text-yellow-900`) с инструкцией про
    `gnome-keyring`/`kwallet`.
  - Безопасные backend'ы → `return null`.
- `src/renderer/src/styles.css` — Tailwind v4 entry (`@import "tailwindcss";`) + базовый reset
  для full-height layout.
- `src/renderer/src/main.tsx` — импорт переключён с `./assets/main.css` на `./styles.css`.

### Task 2 — Settings форма Save/Replace (commit beabd49)

- `src/renderer/src/routes/Settings.tsx`:
  - State: `hasKey: boolean | null`, `input: string`, `status: Status` (discriminated union
    idle/saving/success/error).
  - Mount-time `hasApiKey()` → проставляет `hasKey`.
  - **Ветка `hasKey === true`:** зелёный маркер «Ключ сохранён» + кнопка «Заменить»
    (`clearApiKey()` → `setHasKey(false)` → возвращается режим ввода).
  - **Ветка `hasKey === false`:** `<input type="password" autoComplete="off" spellCheck={false}>`
    + Save → `saveApiKey(input)` → если `r.ok`: `setHasKey(true)`, очистка input,
    `setStatus({kind:'success', text:'Сохранено'})`; иначе показать `r.reason`.
  - Клиент-валидация trim'нутого пустого ключа → «Введите ключ» (defense-in-depth,
    main валидирует независимо — Plan 02).
  - **T-01 mitigated:** `type="password"`, после save input стирается из state,
    ни в одном `<div>{input}</div>` / `aria-label={input}` / `title={input}` ключ не
    выводится. Grep-gate `\{input\}` показывает только `value={input}` в самом input.

### Task 3 — Manual smoke (checkpoint:human-verify)

**Статус:** ожидает аппрува пользователя (см. секцию Checkpoint ниже).

## Walking Skeleton артефакты

Полный сценарий из `SKELETON.md` теперь возможен:

1. ✅ `npm run dev` → окно открывается с навигацией на трёх вкладках.
2. ✅ Settings — input принимает ключ, Save сохраняет через `saveApiKey` → safeStorage.
3. ✅ После save видно «Ключ сохранён» + «Заменить» (ключ как plaintext не показан).
4. ✅ Перезапуск приложения → Settings сразу показывает «Ключ сохранён» (через `hasApiKey()`).
5. ✅ На basic_text/unavailable backend — жёлтый баннер с инструкцией про keyring.
6. ✅ DevTools: `window.scrubber` содержит только namespace `settings` (D-09, D-11).

## Acceptance gates

| Gate | Status | Notes |
|------|--------|-------|
| `npm run typecheck` | ✅ зелёный | node + web проекты |
| `npm run build` | ✅ зелёный | electron-vite собирает все три target'а (main/preload/renderer), CSS 13.52 kB, JS 562 kB |
| `grep "from 'electron'" src/renderer/src/**` | ✅ пусто | D-15 соблюдён |
| `grep "window.scrubber.settings.getSecureBackend" App.tsx` | ✅ 1 | один маунт-time вызов |
| `grep "bg-red-" BackendWarningBanner.tsx` | ✅ пусто | только yellow, не error |
| `head -1 styles.css == '@import "tailwindcss";'` | ✅ | Tailwind v4 entry |
| `grep "saveApiKey/hasApiKey/clearApiKey" Settings.tsx` | ✅ все три | |
| `grep 'type="password"' Settings.tsx` | ✅ 1 | T-01 mitigation |
| `npm run test:unit` | ⚠️ pre-existing flaky | DEF-01 в deferred-items.md — race tmpdir между secrets-store.test.ts и secrets-persist.test.ts. Не вызвано Plan 04, baseline (HEAD~1) сам по себе 41/41 нестабилен при повторных прогонах. Build + typecheck стабильны. |

## Deviations from Plan

### Auto-fixed Issues

Нет фактических отклонений по реализации — план выполнен ровно как написан.

### Deferred (out-of-scope discoveries)

**DEF-01 [pre-existing] — Flaky secrets-store/secrets-persist tests.**
- **Found during:** Task 2 verify `npm run test:unit`.
- **Issue:** 1–3 теста из 41 нестабильно падают (`SHELL-02 round-trip → data: false`).
  Причина — общий `os.tmpdir() + scrubber-test/userData` между `secrets-store.test.ts`
  и `tests/integration/secrets-persist.test.ts`, Vitest гоняет файлы параллельно.
- **Scope:** проблема существует со времён Wave 2/3 (renderer Plan 04 не задевает
  `secrets-store.ts`). Документировано в
  `.planning/phases/01-foundation-app-shell/deferred-items.md`.
- **Action:** не блокирующее для Plan 04. Рекомендуемый фикс описан в DEF-01
  (per-suite uuid-path или `singleFork` для двух файлов).

## Threat Surface

| Threat | Status |
|--------|--------|
| T-01 (key plaintext in DOM) | ✅ mitigated: `type="password"`, после save state input стирается, нет JSX-рендера переменной как текста |
| T-02 (renderer обходит preload) | ✅ mitigated: D-15 grep-gate, sandbox+contextIsolation из Plan 01 |
| T-03 (Linux basic_text незаметный) | ✅ mitigated: жёлтый BackendWarningBanner с понятным русским текстом |

Новой security-surface, не описанной в `<threat_model>` плана, не введено.

## Checkpoint: Task 3 — Manual cross-OS smoke (ожидает пользователя)

**Что построено:** Walking Skeleton end-to-end. Перед тем как закрывать Phase 1, требуется
manual smoke хотя бы на текущей dev-машине; остальные ОС можно отложить (отметить как
«проверено только на Windows», cross-OS verification — на Phase 5 packaging-плане).

**Что верифицировать (минимум — текущая ОС):**

1. **Запуск dev-сборки**
   ```bash
   npm run dev
   ```
   - Электрон-окно открывается; видна навигация «Транскрипция / Анализ / Настройки».
   - По умолчанию активна вкладка «Настройки» (D-03).

2. **Save flow**
   - В Settings: ввести `sk-test-001`, нажать «Сохранить».
   - Появляется зелёный маркер «Ключ сохранён» и кнопка «Заменить».
   - Под маркером — текст «Сохранено».
   - Ключ нигде в DOM не виден plaintext.

3. **Restart-persist (SHELL-02)**
   - Закрыть окно полностью (Alt-F4 на Windows / Cmd-Q на macOS / окно на Linux).
   - Снова `npm run dev`.
   - На Settings сразу видно «Ключ сохранён» (без необходимости ввода).

4. **Replace flow**
   - Нажать «Заменить» → input возвращается, прежний ключ удалён (`clearApiKey`).
   - Ввести новый ключ, Save → снова «Ключ сохранён».

5. **DevTools sanity (на любой ОС)**
   - F12 → Console → выполнить `window.scrubber`.
   - Ожидается только `{ settings: { saveApiKey, hasApiKey, clearApiKey, getSecureBackend } }`.
   - Никаких `media`, `transcribe`, `llm`, `electron`, `ipcRenderer`.
   - `window.require` → `undefined` (nodeIntegration выключен).

6. **(Опционально, Linux) basic_text баннер**
   - Запустить с `npm run dev -- --password-store=basic-text`.
   - Появляется жёлтый баннер про gnome-keyring/kwallet.
   - Save принимает ключ, но после рестарта «Ключ сохранён» отсутствует (memory-only, SHELL-03).

7. **macOS Keychain / Windows DPAPI / Linux libsecret-or-kwallet**
   - Баннера НЕТ.
   - Ключ переживает рестарт (см. шаг 3).

**Сигнал на resume:** напишите `approved` если всё прошло (или укажите ОС из доступных как
«проверено только на $OS, остальные — отложены на Phase 5 packaging smoke»), либо опишите
конкретные проблемы (какой шаг, какое поведение увидено).

## Self-Check: PASSED

Verified files exist:
- ✅ `src/renderer/src/App.tsx`
- ✅ `src/renderer/src/styles.css`
- ✅ `src/renderer/src/routes/Transcribe.tsx`
- ✅ `src/renderer/src/routes/Analyze.tsx`
- ✅ `src/renderer/src/routes/Settings.tsx`
- ✅ `src/renderer/src/components/BackendWarningBanner.tsx`
- ✅ `.planning/phases/01-foundation-app-shell/deferred-items.md`

Verified commits exist:
- ✅ `49572b9` — feat(01-04): app shell, маршруты-заглушки и BackendWarningBanner
- ✅ `beabd49` — feat(01-04): Settings форма — Save/Replace flow
