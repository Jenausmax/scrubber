---
phase: 02-media-extraction-pipeline
plan: 03
subsystem: renderer-transcribe-ui
tags: [renderer, react, ui, drag-drop, file-picker, fsm, vertical-slice]
requires:
  - 02-01-PLAN (shared/ipc types — MediaApi, MediaReason, MediaProbeResult, MediaExtractResult, MediaProgressEvent; preload bridge media.*)
  - 02-02-PLAN (реальные IPC handlers + utilityProcess ffmpeg pipeline)
provides:
  - 5 stateless renderer-компонентов (DropZone, FileMetaCard, ExtractProgress, ExtractDone, InlineError)
  - Transcribe FSM-экран — 8 состояний, орчестрирует pickFile/probe/extractAudio/cancel + onProgress
  - Renderer test infrastructure: @testing-library/react + jsdom + per-file environment директива
  - Unit-тесты Transcribe (8 it-блоков, покрывают drop-валидацию + FSM transitions)
affects:
  - Plan 04 (packaged smoke) теперь имеет рабочий UI в dev для финальной проверки
tech-stack:
  added:
    - "@testing-library/react@16.1.0 (devDep, --save-exact)"
    - "@testing-library/user-event@14.5.2 (devDep, --save-exact)"
    - "@testing-library/jest-dom@6.6.3 (devDep, --save-exact, на будущее)"
    - "jsdom@25.0.1 (devDep, --save-exact)"
  patterns:
    - "// @vitest-environment jsdom — per-file директива (renderer-тесты)"
    - "stateless component с Props-интерфейсом, BackendWarningBanner-аналог"
    - "FSM на discriminated union + useState (Settings.tsx-аналог)"
    - "onProgress subscription через useEffect + stateRef для замыкания свежего state"
    - "navigator.clipboard.writeText вместо shell.showItemInFolder (gap)"
    - "cleanup() в afterEach — RTL+vitest не делает автоматически"
key-files:
  created:
    - src/renderer/src/components/DropZone.tsx
    - src/renderer/src/components/FileMetaCard.tsx
    - src/renderer/src/components/ExtractProgress.tsx
    - src/renderer/src/components/ExtractDone.tsx
    - src/renderer/src/components/InlineError.tsx
    - src/renderer/src/routes/Transcribe.test.tsx
  modified:
    - package.json (devDependencies: testing-library/react, user-event, jest-dom, jsdom)
    - package-lock.json
    - vitest.config.ts (include *.test.tsx)
    - src/renderer/src/routes/Transcribe.tsx (placeholder → FSM-экран)
decisions:
  - "D-COPY-PATH: вместо UI-SPEC §Copywriting 'Открыть папку' — реализуем 'Скопировать путь' через navigator.clipboard.writeText. Причина: shell.showItemInFolder отсутствует в текущем shared/ipc контракте, добавлять новый namespace выходит за scope Plan 03. Документировано как GAP для будущего плана (Phase 3+ или Plan 04, если расширение shell-API)."
  - "D-CACHE-HIT-FLAT: MediaExtractResult из Plan 02 не несёт поля cacheHit:boolean. UI-SPEC требует разный заголовок (Аудио извлечено vs Аудио уже извлечено), но без сигнала backend оба пути показывают единый заголовок 'Аудио извлечено'. Компонент ExtractDone уже умеет показать оба варианта через prop cacheHit — нужно только расширить MediaExtractResult и пробросить флаг. GAP для будущего плана."
  - "D-JOBID-LATE: backend Plan 02 возвращает jobId только в resolve MEDIA_EXTRACT и через initial-progress event (D-INITIAL-PROGRESS в 02-02-SUMMARY). FSM хранит jobId как string | null; кнопка 'Отменить' disabled пока jobId === null. Первый onProgress event привязывает jobId — это работает потому что Plan 02 эмитит progress(0, null) синхронно после fork."
  - "D-RTL-CLEANUP: vitest по умолчанию не делает RTL cleanup() — добавили в afterEach. Без этого DOM от prev-test остаётся, и getByText/getByRole падает с 'multiple elements'. Документировано в комментариях теста."
  - "D-SCRUBBER-MOCK: вместо переиспользования глобального electron-mock (tests/setup.ts) Transcribe.test.tsx мокает window.scrubber напрямую через Object.defineProperty. Причина: компонент вызывает window.scrubber.media.*, а не ipcRenderer.invoke."
metrics:
  duration: ~45 минут
  completed: 2026-05-31
  tasks_total: 3
  tasks_completed: 3
---

# Phase 02 Plan 03: UI Vertical Slice — Transcribe FSM Summary

Замыкающий вертикальный слой Phase 02. После Plan 01 (контракт + skeleton) и Plan 02 (реальный backend через utilityProcess + ffmpeg) — здесь Renderer оживает: пользователь дропает mp4, видит meta, жмёт «Извлечь аудио», получает wav на диске. Полный pipeline в dev работает; единственное, что осталось на Plan 04 — packaged-smoke.

## Outcomes

### Task 1 — Renderer test infra + 5 stateless-компонентов

- Установили `@testing-library/react@16.1.0`, `@testing-library/user-event@14.5.2`, `@testing-library/jest-dom@6.6.3`, `jsdom@25.0.1` через `--save-exact` (RESEARCH §Wave 0 Gaps).
- `vitest.config.ts`: `include` расширен до `src/**/*.test.tsx`; jsdom-environment — per-file директивой `// @vitest-environment jsdom`. Глобальная environment остаётся `'node'` (settings/secrets/media — node-тесты).
- 5 stateless-компонентов (analog `BackendWarningBanner.tsx`):
  - `DropZone.tsx` — drop-handler с D-06/D-07 валидацией (`endsWith('.mp4')`, `files.length === 1`), Electron-расширение `file.path` через type-cast, keyboard-fallback `<button>Выбрать mp4-файл</button>`, Tailwind `min-h-[240px] border-2 border-dashed`, состояния через props (`dragOver`, `disabled`).
  - `FileMetaCard.tsx` — заголовок «Файл готов к извлечению», `<dl>` с meta (имя/размер/длительность), CTA Primary `Извлечь аудио` + Secondary `Выбрать другой файл`. Локальные хелперы `formatSize`, `formatDuration` (без внешних либ).
  - `ExtractProgress.tsx` — `role="progressbar"` + `aria-valuenow/min/max/label`, animated bar, строка `{percent}% · ~{etaSec} сек` с `tabular-nums`, Secondary CTA `Отменить` (с пропом `cancelDisabled` пока jobId не привязан).
  - `ExtractDone.tsx` — `role="status"` зелёная карточка, два заголовка через prop `cacheHit`, монопространный путь, CTA `Скопировать путь` (см. D-COPY-PATH) + `Сбросить`.
  - `InlineError.tsx` — `role="alert"` красная карточка, mapping `MediaReason → user copy` через `REASON_COPY` константу (exact копи из UI-SPEC §Copywriting Contract), CTA `Попробовать снова`.

### Task 2 — Transcribe FSM-экран

- Полная замена placeholder'а из Phase 1. Новый файл — 226 строк.
- `State` discriminated union на 8 вариантов: `idle | idle-drag-over | validating | selected | extracting | done | cancelled | error`. `extracting` хранит `jobId: string | null`, `meta`, `path`, `percent`, `etaSec`.
- `useEffect` подписка на `onProgress` — один раз на mount, callback читает `stateRef.current` (избегаем stale closure).
- 5 async-handler'ов:
  - `handlePathSelected(path)`: → validating → probe → selected | error.
  - `handlePickClick()`: → pickFile → handlePathSelected | error (data===null → no-op).
  - `handleExtract()`: → extracting(jobId=null) → extractAudio → done | (cancelled → idle+cancelledMsg) | error.
  - `handleCancel()`: → cancel(jobId); финальный transition приходит через resolve extractAudio с reason='cancelled'.
  - `handleCopyPath()`: → navigator.clipboard.writeText (try/catch на недоступный clipboard).
- Tailwind контейнер: `p-8 max-w-3xl mx-auto` (по UI-SPEC §Layout & Sizing).
- Drag-over visual: `idle-drag-over` через `onDragOver` / `onDragLeave` хендлеры на DropZone wrapper.

### Task 3 — Transcribe.test.tsx (8 it-блоков)

| # | Тест | Что проверяет |
|---|------|---------------|
| 1 | rejects multi-drop | drop 2 файлов → копи `Можно перетащить только один файл за раз.` |
| 2 | rejects non-mp4 | drop `.txt` → копи `Поддерживается только формат .mp4...` |
| 3 | accepts valid mp4 + meta | drop `.mp4` + probe success → `Файл готов к извлечению` + `probe` вызван с path |
| 4 | starts extraction | `selected` → click `Извлечь аудио` → `Извлекаем аудио…` + `extractAudio` вызван |
| 5 | updates progress on event | вызов сохранённого onProgress-cb с percent=50 → `50%` на экране |
| 6 | ffmpeg_failed copy | extract resolve `ok:false, reason:'ffmpeg_failed'` → копи `Не удалось извлечь аудио...` |
| 7 | pickFile flow | click `Выбрать mp4-файл` → pickFile + probe → meta-карточка |
| 8 | done card | extract success → `Аудио извлечено` + audioPath в DOM |

Helper'ы внутри файла: `installScrubberMock()` (Object.defineProperty на window.scrubber), `mp4File()`/`txtFile()` (File + manual `.path` через defineProperty), `dropFiles()` (synthetic DataTransfer).

## Verification

| Шаг | Команда | Результат |
|-----|---------|-----------|
| Task 1 typecheck | `npm run typecheck` | passed (node + web) |
| Task 2 typecheck | `npm run typecheck` | passed |
| Task 2 build | `npm run build` | passed; renderer 577.87 kB / out/main/index.js 18.57 kB / ffmpeg-runner.cjs 2.1 kB |
| Task 3 isolated | `npx vitest run src/renderer/src/routes/Transcribe.test.tsx` | 8/8 passed (≈400ms) |
| Полный прогон | `npx vitest run` | **103/103 passed** (12 файлов, ≈1.3s). Phase 1 + Phase 2 backend (Plans 01/02) — все зелёные. |

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 | `a8c77c8` feat(02-03): renderer test infra + 5 stateless components | package.json + package-lock + vitest.config.ts + 5 components |
| 2 | `51e121b` feat(02-03): Transcribe FSM orchestrator | Transcribe.tsx (placeholder → 226 строк FSM) |
| 3 | `eb8ab97` test(02-03): Transcribe FSM unit-tests | Transcribe.test.tsx (245 строк, 8 it-блоков) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] RTL cleanup() в afterEach**

- **Found during:** Task 3 — первый прогон Transcribe.test.tsx, 5/8 фейлов с `TestingLibraryElementError: Found multiple elements with text/role`.
- **Issue:** Vitest+RTL не очищает DOM между `it`-блоками автоматически (в отличие от Jest+RTL с `afterEach(cleanup)` в setup). DOM от предыдущего теста остаётся, queries падают на «multiple elements».
- **Fix:** Импорт `cleanup` из `@testing-library/react`, вызов в `afterEach`.
- **Files modified:** `src/renderer/src/routes/Transcribe.test.tsx`
- **Commit:** Task 3 (eb8ab97)

**2. [Rule 3 — Blocking] Worktree sync — base reset**

- **Found during:** Pre-Task 1 (setup).
- **Issue:** Worktree был создан с тривиальной README-веткой, `merge-base HEAD ce88178` ≠ ce88178. Файлы рабочей базы (`src/`, `.planning/`, etc.) отсутствовали.
- **Fix:** `git update-ref refs/heads/worktree-agent-ab195a2a766baa4c5 ce88178` + `git checkout -f HEAD` — переустановили ветку на ожидаемый базовый коммит, файлы Phase 2 baseline появились в worktree.
- **Не модифицирует:** STATE.md, ROADMAP.md, REQUIREMENTS.md (по требованию orchestrator).

### Architectural Decisions (документация, не отклонения)

См. секцию `decisions` в frontmatter: D-COPY-PATH, D-CACHE-HIT-FLAT, D-JOBID-LATE, D-RTL-CLEANUP, D-SCRUBBER-MOCK.

## CONTEXT Decisions Implemented

| Decision | Где |
|----------|-----|
| D-03 (drop-zone на вкладке Transcribe) | `Transcribe.tsx` + `DropZone.tsx` |
| D-05 (метаданные + CTA «Извлечь аудио», без auto-старта) | `FileMetaCard.tsx` + FSM state `selected` |
| D-06 (`.mp4` валидация в renderer) | `DropZone.tsx` — `f.name.toLowerCase().endsWith('.mp4')` |
| D-07 (multi-drop отклоняется) | `DropZone.tsx` — `files.length !== 1 → onError('invalid_argument')` |
| D-08 (progress events) | `Transcribe.tsx` — useEffect onProgress subscription |
| D-09 (Cancel-кнопка + сообщение «Извлечение отменено») | `Transcribe.tsx` `handleCancel` + cancelledMsg в idle |
| D-10 (один активный job; UI не блокирует навигацию) | FSM хранит ровно один `extracting`-state, навигация в App.tsx сохраняется |
| D-12 (cache-hit) | partial — `ExtractDone.cacheHit` пропс реализован, но всегда `false` (gap, см. D-CACHE-HIT-FLAT) |

## Threat Model Confirmation

| Threat ID | Status |
|-----------|--------|
| T-02-03-01 (tampering — non-mp4 через DropZone) | mitigated — `endsWith('.mp4')` в DropZone + defence-in-depth в Plan 02 IPC validateMp4Path |
| T-02-03-02 (info disclosure — audioPath в renderer) | accepted — путь в userData/extracted, не secret (UI-SPEC показывает) |
| T-02-03-03 (clipboard содержит абсолютный путь) | accepted — пользователь явно нажал «Скопировать путь» |
| T-02-03-04 (DataTransfer.files manipulation) | mitigated — `e.preventDefault()` на drag-handlers, не читаем содержимое файла, только `.path` строкой |
| T-02-03-SC (supply chain testing-library/jsdom) | mitigated — devDep, `--save-exact`, не входят в production bundle |

## Known Gaps (для будущих планов)

1. **«Открыть папку» вместо «Скопировать путь».** UI-SPEC требует `shell.showItemInFolder(audioPath)`. Текущий план реализует clipboard-copy как minimal viable. **Следующий шаг:** добавить `shell` namespace в `shared/ipc.ts` (метод `showItemInFolder(path)` или `openInFolder(path)`) + IPC handler в main + bridge в preload + обновить ExtractDone.tsx (вернуть `onOpenFolder`). 1-2 часа работы.
2. **cache-hit заголовок.** `MediaExtractResult` не возвращает `cacheHit: boolean`. ExtractDone уже умеет показать оба варианта; нужно только расширить контракт и пробросить флаг из `mediaExtractor.startExtract` (там cache-hit short-circuit реализован — D-12 в 02-02-SUMMARY). 15 минут работы.
3. **Phase 1 secrets-store flake.** При параллельном vitest-прогоне иногда падает `secrets-store.test.ts` race-condition (известно из 02-02-SUMMARY). В Plan 03 не трогали — out-of-scope. Подтверждено: тест зелёный изолированно.

## Manual dev smoke

**Не запускали в этом плане.** Plan 04 покроет packaged-smoke (`build:unpack` → запуск exe → drop mp4 → проверка `<userData>/extracted/<hash>.wav`). Все автоматические гейты (typecheck/test/build) зелёные, ручную проверку откладываем согласно `<success_criteria>` плана: «В dev-режиме... опциональный — не блокер плана».

## Stub Tracking

Стабов нет. Все code-paths имеют реальные вызовы:
- DropZone — реальная drop-валидация, кнопка делегирует через onPickClick в parent.
- Transcribe.tsx — все 5 IPC-методов вызываются по реальному пути.
- ExtractDone.copied — реальный stateful indicator через setTimeout.
- Единственное «упрощение» — `cacheHit` всегда `false` в текущем плане (см. D-CACHE-HIT-FLAT GAP).

## Self-Check: PASSED

- [x] `src/renderer/src/components/DropZone.tsx` существует
- [x] `src/renderer/src/components/FileMetaCard.tsx` существует
- [x] `src/renderer/src/components/ExtractProgress.tsx` существует
- [x] `src/renderer/src/components/ExtractDone.tsx` существует
- [x] `src/renderer/src/components/InlineError.tsx` существует
- [x] `src/renderer/src/routes/Transcribe.tsx` обновлён (placeholder → FSM)
- [x] `src/renderer/src/routes/Transcribe.test.tsx` существует (8 тестов)
- [x] `vitest.config.ts` обновлён (include *.test.tsx)
- [x] 3 коммита в git log: a8c77c8, 51e121b, eb8ab97
- [x] `npm run typecheck` passed
- [x] `npm run build` passed
- [x] `npx vitest run` — 103/103 passed (12 files)
- [x] `grep -c "role=\"progressbar\"" src/renderer/src/components/ExtractProgress.tsx` = 1
- [x] `grep -c "role=\"alert\"" src/renderer/src/components/InlineError.tsx` = 1
- [x] `grep -c "role=\"status\"" src/renderer/src/components/ExtractDone.tsx` = 1
- [x] `grep -c "min-h-\[240px\]" src/renderer/src/components/DropZone.tsx` = 1
- [x] Все 5 компонентов stateless (нет `useState`/`useEffect`)
- [x] `grep -c "kind:" src/renderer/src/routes/Transcribe.tsx` >= 7 (8 FSM-вариантов)
- [x] `grep -c "window.scrubber.media" src/renderer/src/routes/Transcribe.tsx` >= 4 (pickFile, probe, extractAudio, cancel, onProgress)
- [x] `grep -c "it(" src/renderer/src/routes/Transcribe.test.tsx` = 8
- [x] STATE.md / ROADMAP.md / REQUIREMENTS.md НЕ модифицированы (orchestrator handles)
