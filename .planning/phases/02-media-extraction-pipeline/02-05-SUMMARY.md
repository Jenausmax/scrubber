---
phase: 02-media-extraction-pipeline
plan: 05
status: superseded-by-02-06
gap_closure: true
tasks_completed: [1, 2, 3, 4]
tasks_pending: [5]
correction: "Gap 2 root-cause-анализ ниже ОШИБОЧЕН (не каскад Gap 1). Реальная причина и фикс — commit 7f9e9f0 (fix 02-06). См. блок «ПОПРАВКА» в начале body."
commits:
  - hash: 8dfa197
    message: "fix(02-05): Gap 1 — webUtils.getPathForFile в preload + DropZone"
  - hash: 0a4130c
    message: "fix(02-05): Gap 2 — assertBinaryExists fail-fast + utility-process fatal-error mapping"
  - hash: ef01e9e
    message: "fix(02-05): Gap 3 — уточнить REASON_COPY + uniqueness-тест для 7 кодов"
  - hash: c9775d8
    message: "chore(02-05): scripts/smoke-packaged.mjs + smoke:packaged npm-script"
key-files:
  modified:
    - src/shared/ipc.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/preload/index.test.ts
    - src/renderer/src/components/DropZone.tsx
    - src/renderer/src/components/InlineError.tsx
    - src/renderer/src/routes/Transcribe.test.tsx
    - src/main/services/ffmpeg-paths.ts
    - src/main/services/ffmpeg-paths.test.ts
    - src/main/services/media-extractor.ts
    - src/main/services/media-extractor.test.ts
    - tests/integration/extract-real.test.ts
    - tests/setup.ts
    - package.json
  created:
    - src/renderer/src/components/DropZone.test.tsx
    - src/renderer/src/components/InlineError.test.tsx
    - scripts/smoke-packaged.mjs
metrics:
  duration_minutes: ~15
  tests_before: 112
  tests_after: 126
  tests_added: 14
  typecheck: green
  smoke_packaged_on_existing_dist: OK
---

# Phase 2 Plan 05: Gap Closure (partial — awaiting human smoke)

Закрыты 3 gap'a из 02-VERIFICATION.md, добавлены regression-guard'ы. Tasks 1–4 выполнены автоматически; **Task 5 (human Windows smoke) — ожидает оператора**.

---

## ⚠️ ПОПРАВКА (Jun 6 2026, packaged smoke + fix 02-06, commit 7f9e9f0)

**Gap 2 закрыт НЕ так, как описано ниже.** При живом packaged-smoke извлечение
аудио всё равно падало с «неподдерживаемый кодек». Диагностическое логирование
(stderrTail + fork-параметры) показало настоящий root cause:

> `startExtract` пишет во временный файл `<hash>.wav.tmp`. ffmpeg выбирает муксер
> ПО РАСШИРЕНИЮ выходного файла; `.tmp` неизвестно → `Unable to choose an output
> format ... Invalid argument` (exit EINVAL) → reason `ffmpeg_failed`.

Это **не** каскад Gap 1 (гипотеза в секции «Gap 2» ниже — ошибочна).

**Фикс (commit 7f9e9f0):** аргументы ffmpeg вынесены в единый
`src/main/utilities/ffmpeg-args.ts` (`buildExtractArgs`) — общий источник для
раннера (esbuild инлайнит) и интеграционного теста. Добавлен явный `-f wav`.
Гард: `extract-real.test.ts` «regression 02-06» (извлечение в `.wav.tmp` → exit 0
+ валидный RIFF/pcm_s16le/16000/mono). Verified end-to-end на packaged build:
финальный `.wav` создаётся, лог без ошибок. Gap 1 и Gap 2 подтверждены вживую.

**Остаётся:** Gap 3 (ручная проверка текста ошибки `internal` при отсутствии
ffmpeg-бинарника) — единственный непроверенный пункт Task 5.

---

## Что сделано по каждому Gap

### Gap 1 (MEDIA-01) — drag-drop в packaged build не отдаёт path

**Root cause (фактический в коде):** `DropZone.handleDrop` читал путь через `(f as File & { path?: string }).path`. В Electron ≥32 (мы на 42.3.0) `File.path` удалён — атрибута попросту нет в sandboxed renderer. Результат: `filePath === undefined` → `onError('internal')`, drop тихо «не делает ничего».

**Что изменено:**
- `src/shared/ipc.ts`: `ScrubberApi` расширен top-level полем `getPathForFile(file: File): string`.
- `src/preload/index.ts`: импорт `webUtils` из `electron` + expose `getPathForFile: (file) => webUtils.getPathForFile(file)`.
- `src/preload/index.d.ts`: комментарий-источник (тип берётся из `ScrubberApi`).
- `src/renderer/src/components/DropZone.tsx`: `const filePath = window.scrubber.getPathForFile(f)`; пустая строка → `onError('internal')`.
- **Regression guard:** `DropZone.test.tsx` (4 теста) — happy / non-mp4 / multi-drop / empty-path. Все зелёные.

### Gap 2 (MEDIA-02/03) — packaged build падает "неподдерживаемый кодек"

**Root cause (анализ кода + smoke-проверка):** ровно совпадает с гипотезой из VERIFICATION. Без `assertBinaryExists` ситуация «бинарник не распакован» приводит к spawn с misleading exit-code → `ffmpeg_failed`. Дополнительная проверка через standalone smoke-script (запущенный против существующего `dist/win-unpacked/`) показала `[smoke] OK: ffmpeg + ffprobe бинарники найдены` — значит на текущем build asarUnpack-секция в `electron-builder.yml` работает корректно. Реальная боль Gap 2 в smoke от 02-04 могла быть следствием Gap 1 (path=undefined → передавался undefined в `media.probe`, и тот валился).

**Что изменено:**
- `src/main/services/ffmpeg-paths.ts`: новая функция `assertBinaryExists(p, name)` — sync `existsSync`-guard, понятный Error с упоминанием `asarUnpack` + `console.error` префикс `[services/ffmpeg-paths]`.
- `src/main/services/media-extractor.ts`:
  - `init()`: `assertBinaryExists(ffPath, 'ffmpeg')` и `assertBinaryExists(fpPath, 'ffprobe')` ДО `ensureExecutable` — fail-fast.
  - `startExtract()`: добавлен `proc.on('error', ...)` для UtilityProcess FatalError → `reason='internal'` (НЕ `ffmpeg_failed`). Введён `settle()`-дедуп резолва.
- **Regression guards:**
  - `ffmpeg-paths.test.ts`: новый `describe('assertBinaryExists')` — 3 теста (exists / missing / asarUnpack hint).
  - `media-extractor.test.ts`: `init() rejects when assertBinaryExists throws`.
  - `tests/integration/extract-real.test.ts`: `regression Gap-2: resolved ffmpeg/ffprobe binaries physically exist (dev path)`.

### Gap 3 (UX) — копии для всех 7 reason'ов

**Root cause:** существующий `REASON_COPY` уже покрывал 7 ключей, но текст для `internal` был слишком общий ("Внутренняя ошибка. Попробуйте перезапустить") и не помогал юзеру понять, что речь о ffmpeg-binary.

**Что изменено:**
- `src/renderer/src/components/InlineError.tsx`: 7 уникальных русских строк (см. UI-SPEC §Copywriting Contract). `internal` теперь явно намекает на ffmpeg-binary install issue. `invalid_argument` упоминает 'mp4-файл' (вместо просто 'файл'). `cancelled` / `disk_full` / `ffmpeg_failed` уточнены.
- **Regression guard:** `InlineError.test.tsx` (5 тестов) — все 7 reason'ов non-empty (≥10 символов), `new Set(texts).size === 7`, retry-кнопка вызывает callback, `internal` ≠ `ffmpeg_failed`, `cancelled` уникален.
- **Побочное:** `Transcribe.test.tsx` regex для `invalid_argument` обновлён под новую копию.

## Standalone smoke-script (закрывает Gap 2 без человека)

`scripts/smoke-packaged.mjs` + `npm run smoke:packaged`. Host-OS-only, НЕ цепляется в `build:unpack` chain (решение по W-4 вариант a — иначе любая попытка `build:unpack` на «чужой» OS была бы красной). Рекурсивно ищет именно бинарник `ffmpeg(.exe)` / `ffprobe(.exe)` в `app.asar.unpacked/node_modules/*` (закрытие W-2 — не просто existsSync директории).

**Поведение verified:**
- На существующем `dist/win-unpacked/` → `[smoke] OK: ...` (exit 0).
- Из директории без `dist/` → `[smoke] dist/ does not exist — run \`npm run build:unpack\` first` (exit 2).
- Syntax-check `node -c scripts/smoke-packaged.mjs` — clean.

## Test counts / typecheck

- Baseline до плана: **112 passed**.
- После плана: **126 passed** (14 новых тестов: 4 DropZone + 3 assertBinaryExists + 1 media-extractor.init + 1 integration regression + 5 InlineError + патчи Transcribe/preload).
- `npm run typecheck`: green (node + web).
- `npx vitest run --no-file-parallelism --reporter=dot`: 126 passed.

## Deviations

### Auto-fixed Issues

**1. [Rule 1 — Bug] tests/setup.ts: добавлен mock для `electron.webUtils.getPathForFile`**

- **Found during:** Task 1 (после добавления `import { webUtils } from 'electron'` в preload).
- **Issue:** existing tests/setup.ts global electron mock не имел `webUtils` → импорт preload падал бы.
- **Fix:** добавил `webUtils: { getPathForFile: vi.fn((file) => file?.name ?? '') }` в return-объект `vi.mock('electron', ...)`.
- **Files modified:** tests/setup.ts.
- **Commit:** c9775d8.

**2. [Rule 1 — Bug] src/preload/index.test.ts: allow-list контракт расширен**

- **Found during:** Task 4 full-test guard.
- **Issue:** существующий тест "экспонирует namespaces settings и media (allow-list)" проверял точное `Object.keys(bridge).sort()` === `['media', 'settings']`. После Task 1 это валилось на `['getPathForFile', 'media', 'settings']`.
- **Fix:** обновил expected allow-list на `['getPathForFile', 'media', 'settings'].sort()` + добавил assertion `typeof bridge.getPathForFile === 'function'`. Контракт корректно отражает новый Phase 2 расширенный API.
- **Files modified:** src/preload/index.test.ts.
- **Commit:** c9775d8.

**3. [Rule 1 — Bug] src/renderer/src/routes/Transcribe.test.tsx: фабрики mp4File/txtFile + installScrubberMock**

- **Found during:** Task 1.
- **Issue:** существующие фабрики писали путь в `File.path`. DropZone теперь читает через `window.scrubber.getPathForFile` → старый stub перестал работать.
- **Fix:** фабрики кладут путь в `__path`, `installScrubberMock` отдаёт `getPathForFile: (file) => file.__path`. Все 8 тестов Transcribe зелёные.
- **Files modified:** src/renderer/src/routes/Transcribe.test.tsx.
- **Commit:** 8dfa197.

### Architectural / unresolved

None.

## Authentication gates

None (плана выполнен полностью offline).

## Known Stubs

None.

## Threat Flags

None — все изменения в существующих trust boundaries, никаких новых endpoints/auth-путей/schema-изменений. STRIDE register плана T-02-05-01..04 + T-02-05-SC — без новых сюрфейсов.

## Self-Check: PASSED

Проверено:
- `src/renderer/src/components/DropZone.test.tsx` — FOUND.
- `src/renderer/src/components/InlineError.test.tsx` — FOUND.
- `scripts/smoke-packaged.mjs` — FOUND.
- Все 4 коммита присутствуют в git log feature/SCR-02-media-extraction-pipeline (8dfa197, 0a4130c, ef01e9e, c9775d8).
- `npx vitest run --no-file-parallelism` — 126 passed.
- `npm run typecheck` — green.
- `node scripts/smoke-packaged.mjs` (на существующем dist/win-unpacked/) — `[smoke] OK`.

## Pending: Task 5 — Human Windows smoke-test

**Status:** AWAITING HUMAN. Не выполнен автоматически — требует Windows host, ручного drag-drop, ручного timing-наблюдения за progress-bar'ом, скриншот-валидации копий ошибок.

**Required steps (см. полное описание в 02-05-PLAN.md, секция Task 5):**

1. `npm run build:unpack` на Windows host.
2. `npm run smoke:packaged` отдельно — ожидание `[smoke] OK:` (для текущего dist это уже подтверждено auto-выполненным запуском в Task 4).
3. Запустить `dist/win-unpacked/react-ts.exe`.
4. **Gap 1 verify:** drag-drop mp4 в drop-zone → FileMetaCard с meta + CTA «Извлечь аудио».
5. **Gap 2 verify:** клик «Извлечь аудио» → progress 0→100% → ExtractDone с путём в `<userData>/extracted/<hash>.wav`.
6. **Gap 3 verify:** временно переименовать `dist/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe` → `.bak`; перезапустить app; ожидание — UI текст для `internal` упоминает «бинарник ffmpeg может быть не распакован» (НЕ «неподдерживаемый кодек»). Восстановить .bak → .exe.
7. Кнопка «Скопировать путь» на done-state → clipboard содержит wav-путь.

**Resume signal:** type `approved` если все 3 gap'a end-to-end OK; иначе описать какой gap провалился + observed behavior — будет открыт Plan 02-06.
