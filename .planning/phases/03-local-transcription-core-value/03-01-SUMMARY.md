---
phase: 03-local-transcription-core-value
plan: 01
subsystem: infra
tags: [whisper.cpp, ipc, electron, transcription, tdd, nyquist, sidecar-binary]

# Граф зависимостей
requires:
  - phase: 02-media-extraction-pipeline
    provides: "shared/ipc.ts (Result<T>, Channels, MediaApi/MediaReason, ScrubberApi), ffmpeg-args.ts (эталон pure-fn), ffmpeg-paths.ts (эталон resolve + asar.unpacked-патч + assert-guards), media-extractor.test.ts (эталон ForkMock)"
provides:
  - "Расширенный IPC-контракт transcribe.* / models.* (7 TRANSCRIBE_ + 5 MODELS_ каналов, TranscribeApi/ModelsApi, TranscribeReason/ModelReason, event-payload типы) — контракт под TRANS-01..07"
  - "buildTranscribeArgs — чистая функция сборки флагов whisper-cli (TRANS-03 GREEN)"
  - "whisper-paths.ts — резолв whisper-cli + моделей + VAD-модели + assert-guards (resolveWhisperCli/resolveModel/resolveVadModel/assertBinaryExists/assertModelExists/ensureExecutable)"
  - "Wave 0 RED тест-стабы (Nyquist): whisper-runner-parse / transcriber / model-manager / transcript-builder / transcribe-real — семплинг под TRANS-01/02/04/05/06/07"
  - "whisper.cpp v1.8.6 win32-x64 бинарник + DLL в git (resources/whisper/win32-x64/)"
affects: [03-02-pipeline-core, 03-03-model-manager, 03-04-transcription-ux]

# Трекинг технологий
tech-stack:
  added: ["whisper.cpp v1.8.6 (sidecar-бинарник, non-BLAS, win32-x64)"]
  patterns:
    - "IPC-контракт расширяется (не переписывается) зеркалированием MEDIA_* → TRANSCRIBE_*/MODELS_*"
    - "Pure-fn сборки CLI-аргументов без импортов electron/main-графа (зеркало ffmpeg-args.ts)"
    - "resolve-пути с .replace('app.asar','app.asar.unpacked') для packaged-бинарников"
    - "Wave 0 Nyquist: RED тест-стабы заводятся заранее, GREEN приходит в последующих волнах"
    - "whisper-cli как in-tree git-бинарник из официального ggml-org релиза (не npm)"

key-files:
  created:
    - src/main/utilities/whisper-args.ts
    - src/main/utilities/whisper-args.test.ts
    - src/main/utilities/whisper-runner-parse.ts
    - src/main/utilities/whisper-runner-parse.test.ts
    - src/main/services/whisper-paths.ts
    - src/main/services/transcriber.ts
    - src/main/services/transcriber.test.ts
    - src/main/services/model-manager.ts
    - src/main/services/model-manager.test.ts
    - src/main/services/transcript-builder.ts
    - src/main/services/transcript-builder.test.ts
    - tests/integration/transcribe-real.test.ts
    - resources/whisper/win32-x64/whisper-cli.exe
    - resources/whisper/win32-x64/whisper.dll
    - resources/whisper/win32-x64/ggml.dll
    - resources/whisper/win32-x64/ggml-base.dll
    - resources/whisper/win32-x64/ggml-cpu.dll
  modified:
    - src/shared/ipc.ts
    - .planning/phases/03-local-transcription-core-value/03-RESEARCH.md

key-decisions:
  - "Зафиксирована non-BLAS сборка whisper.cpp v1.8.6 как есть (checkpoint approved) — openblas.dll не требуется; 5 DLL/exe достаточно для spawn"
  - "frontmatter.requirements ограничен [TRANS-03] — единственное GREEN-требование этого плана; контракт/RED-стабы под TRANS-01/02/04/05/06/07 засчитываются в планах их GREEN (03-02/03/04)"
  - "Манифест моделей ведём вручную; размер small исправлен с ошибочного 488MB на точные 487,601,967 B (контент/SHA не менялись)"

patterns-established:
  - "Расширение IPC-контракта: строковые литералы каналов ТОЛЬКО в Channels, всё остальное — типы поверх"
  - "Pure-fn CLI-args изолированы от electron — тестируются без мока main-графа"
  - "Nyquist-семплинг: тест-стабы создаются в Wave 0, видны vitest как RED/skip (не 'no tests')"

requirements-completed: [TRANS-03]

# Метрики
duration: ~35min (включая checkpoint-паузу)
completed: 2026-06-09
---

# Phase 3 Plan 01: Контракт транскрипции + whisper-cli бинарник Summary

**Заложена общая IPC-инфраструктура транскрипции (transcribe.*/models.* контракт под TRANS-01..07), GREEN-реализована чистая функция сборки флагов whisper-cli (TRANS-03), подготовлены Wave 0 RED-стабы для Nyquist-семплинга и внесён в git официальный whisper.cpp v1.8.6 win32-x64 бинарник (non-BLAS).**

## Performance

- **Duration:** ~35 min (с учётом паузы на checkpoint human-verify)
- **Completed:** 2026-06-09
- **Tasks:** 3/3 (Task 1 — IPC-контракт; Task 2 — buildTranscribeArgs + whisper-paths + RED-стабы; Task 3 — whisper-cli бинарник, прошёл через checkpoint)
- **Files modified:** 18 (16 создано, 2 изменено)

## Accomplishments

- **IPC-контракт фазы** — `shared/ipc.ts` расширен 7 каналами `TRANSCRIBE_*` и 5 каналами `MODELS_*`, интерфейсами `TranscribeApi`/`ModelsApi`, union-типами `TranscribeReason` (7 значений) / `ModelReason` (6 значений) и event-payload типами. Все downstream-слайсы (03-02/03/04) теперь импортируют типы из плана, а не ищут в коде.
- **TRANS-03 GREEN** — `buildTranscribeArgs` собирает `-m/-l ru/-pp/-oj/-t/-f` и условно `--vad/-vm` при наличии VAD-модели; 6 unit-тестов зелёные. Чистая функция без импортов electron (зеркало `ffmpeg-args.ts`).
- **whisper-paths.ts** — резолв whisper-cli (с asar.unpacked-патчем), моделей, VAD-модели + assert-guards под reason `model_missing`.
- **Wave 0 Nyquist** — заведены RED тест-стабы (`whisper-runner-parse`, `transcriber`, `model-manager`, `transcript-builder`, `transcribe-real`); vitest видит их как RED (9 fail / семплинг включён) — GREEN придёт в волнах 1-3.
- **whisper-cli бинарник** — внесён в git официальный ggml-org релиз v1.8.6 win32-x64: `whisper-cli.exe` + `whisper.dll` + `ggml.dll` + `ggml-base.dll` + `ggml-cpu.dll`. Проверено: `whisper-cli.exe --help` показывает `-m/-l/--vad/-vm/-pp/-oj/-f`.

## Task Commits

Атомарные коммиты:

1. **Task 1: IPC-контракт transcribe.*/models.*** — `465ab12` (feat)
2. **Task 2: buildTranscribeArgs + whisper-paths + Wave 0 RED-стабы** — `1db2f53` (feat, TRANS-03 GREEN)
3. **Task 3: whisper.cpp v1.8.6 win32-x64 бинарники** — `4942f0c` (feat, через checkpoint human-verify → approved)

**Дополнительно:** `0968aee` (docs) — коррекция размеров моделей в манифесте 03-RESEARCH.md.

## Files Created/Modified

- `src/shared/ipc.ts` — расширен контрактом transcribe.*/models.* (модифицирован)
- `src/main/utilities/whisper-args.ts` — `buildTranscribeArgs` + `TranscribeOpts` (TRANS-03 GREEN)
- `src/main/utilities/whisper-args.test.ts` — 6 GREEN-тестов сборки флагов
- `src/main/utilities/whisper-runner-parse.{ts,test.ts}` — парсер segment/progress (RED-стаб, TRANS-04)
- `src/main/services/whisper-paths.ts` — resolve + assert-guards
- `src/main/services/transcriber.{ts,test.ts}` — RED-стаб (TRANS-05/06)
- `src/main/services/model-manager.{ts,test.ts}` — RED-стаб (TRANS-02)
- `src/main/services/transcript-builder.{ts,test.ts}` — RED-стаб (TRANS-07)
- `tests/integration/transcribe-real.test.ts` — gated integration RED-стаб (TRANS-01)
- `resources/whisper/win32-x64/*` — whisper-cli.exe + 4 DLL (v1.8.6 non-BLAS)
- `.planning/phases/03-local-transcription-core-value/03-RESEARCH.md` — коррекция размеров манифеста

## Decisions Made

- **D-чекпоинт:** non-BLAS сборка v1.8.6 зафиксирована как есть. BLAS-замена не требуется — 5 файлов (exe + 4 DLL) достаточно, openblas.dll отсутствует штатно.
- **Атрибуция требований:** план GREEN-реализует только TRANS-03. TRANS-01/02/04/05/06/07 получают контракт+RED-стабы здесь, но засчитываются в 03-02 (TRANS-01/03/06/07), 03-03 (TRANS-02), 03-04 (TRANS-03/04/05/07) — где приходит GREEN. Фазовое покрытие TRANS-01..07 сохранено суммой слайсов.

## Deviations from Plan

None — план выполнен ровно как написано. Checkpoint Task 3 прошёл штатно (human approved non-BLAS вариант). Коррекция манифеста 03-RESEARCH.md выполнена в рамках checkpoint-шага 3 (сверка актуальности SHA/размеров) — это предусмотренное действие плана, не отклонение.

## Known Stubs

Wave 0 RED-стабы — намеренные и предусмотрены планом (infrastructure/Nyquist):

| Файл | Требование | GREEN в плане |
|------|-----------|---------------|
| `src/main/utilities/whisper-runner-parse.ts` | TRANS-04 | 03-02 |
| `src/main/services/transcriber.ts` | TRANS-05/06 | 03-02 |
| `src/main/services/model-manager.ts` | TRANS-02 | 03-03 |
| `src/main/services/transcript-builder.ts` | TRANS-07 | 03-02 |
| `tests/integration/transcribe-real.test.ts` | TRANS-01 | 03-02 |

Эти стабы НЕ блокируют цель плана — план является infrastructure-планом (Wave 0), его цель — контракт + GREEN TRANS-03 + бинарник. Стабы намеренно RED для Nyquist-семплинга последующих волн.

## TDD Gate Compliance

Задачи помечены `tdd="true"`. Для TRANS-03 (единственное GREEN-требование) тесты `whisper-args.test.ts` существуют и зелёные. Прочие тесты намеренно RED (стабы под будущие волны) — это infrastructure-паттерн Wave 0, а не нарушение gate-последовательности.

## Verification

- `npm run typecheck` — зелёный (контракт компилируется)
- `npm run test:unit -- src/main/utilities/whisper-args.test.ts` — 6 passed (TRANS-03 GREEN)
- Wave 0 стабы видны vitest как RED (не «no tests found») — семплинг включён
- `whisper-cli.exe --help` — показывает -m/-l/--vad/-vm/-pp/-oj/-f; бинарник запускается
- `resources/whisper/win32-x64/` закоммичен в git (in-tree, не gitignore)

## Self-Check: PASSED

Все заявленные файлы существуют на диске; все коммиты (465ab12, 1db2f53, 4942f0c, 0968aee) присутствуют в git-истории.
