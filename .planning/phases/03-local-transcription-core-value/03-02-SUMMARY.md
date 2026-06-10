---
phase: 03-local-transcription-core-value
plan: 02
subsystem: local-transcription
tags: [whisper.cpp, utilityProcess, transcript-md, ipc, milestone, core-value]
requires:
  - "03-01: IPC-контракт transcribe.*, whisper-args.buildTranscribeArgs, whisper-paths.* (resolve/assert), whisper-cli бинарники win32-x64"
provides:
  - "transcriber (singleton): fork whisper-runner.cjs → segments → авто-save transcript.md в userData"
  - "buildTranscriptMd: сегменты → md (frontmatter + H1 + тело, режимы сплошной/таймкоды)"
  - "whisper-runner.cjs: dual-stream parser (stdout сегменты / stderr прогресс)"
  - "ipc/transcribe: TRANSCRIBE_START/CANCEL/OPEN/REVEAL с defense-in-depth валидацией"
  - "preload namespace transcribe.* + renderer transcribe-слайс (TranscriptResult, InlineError)"
affects:
  - "03-03: добавит models.* namespace и live-стриминг поверх этого ядра"
  - "03-04: SAVE_AS handler, cancel-partial, тумблер таймкодов, селектор языка, build/smoke"
tech-stack:
  added:
    - "esbuild второй инвок: whisper-runner.ts → out/main/whisper-runner.cjs"
  patterns:
    - "utilityProcess.fork CJS-runner (зеркало media-extractor/ffmpeg-runner из Phase 2)"
    - "assert binary + model ПЕРЕД fork (fail-fast, Gap 3)"
    - "Result-объекты через IPC, никаких throw (catch→internal)"
    - "авто-save .tmp→rename (атомарная запись transcript.md, D-04)"
key-files:
  created:
    - src/main/utilities/whisper-runner.ts
    - src/main/services/transcript-builder.ts
    - src/main/services/transcriber.ts
    - src/main/ipc/transcribe.ts
    - src/renderer/src/components/TranscriptResult.tsx
  modified:
    - src/main/utilities/whisper-runner-parse.ts
    - src/main/ipc/index.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/routes/Transcribe.tsx
    - src/renderer/src/components/InlineError.tsx
    - src/shared/ipc.ts
    - package.json
    - electron.vite.config.ts
decisions:
  - "03-02: ядро ценности (mp4→transcript.md офлайн) подтверждено на UAT — milestone gate пройден"
  - "03-02: dev-сборка .cjs-утилит чинится через predev-хук + emptyOutDir:false (root-cause Phase 2 dev-wiring gap)"
metrics:
  duration: 12min
  completed: 2026-06-09
---

# Phase 03 Plan 02: Local Transcription Core Value (mp4→transcript.md) Summary

Тончайший рабочий end-to-end офлайн-слайс: whisper-cli через `utilityProcess.fork` распознаёт извлечённый WAV, приложение собирает и авто-сохраняет осмысленный русский `transcript.md` и показывает его текст с кнопками «Открыть»/«Показать в папке» — главный milestone-gate роадмапа достигнут.

## Что сделано

- **whisper-runner.cjs (dual-stream parser).** CJS-entry без electron-импортов (Pitfall 6): `spawn(whisper-cli, buildTranscribeArgs(...))`, два независимых line-buffer'а — stdout `[чч:мм:сс.ммм --> ...] text` → `{type:'segment', startMs, text}`, stderr `progress = NN%` → `{type:'progress', percent: min(99,n)}` + накопление stderrTail (последние 2000 байт). SIGTERM → `child.kill`. На exit → `{type:'done', code, stderrTail, jsonPath}`.
- **transcript-builder.ts.** Pure-fn `buildTranscriptMd(segments, meta, {timecodes})` → YAML-frontmatter (source/model/language/duration/date) + `# <basename>` + тело: сплошной текст (D-01) или `[ЧЧ:ММ:СС] text` построчно из тех же сегментов без re-run (D-02). Пустой массив → валидный md с пустым телом.
- **transcriber.ts (singleton).** Зеркало media-extractor: `init()` (mkdir userData/models, assert whisper-cli, ensureExecutable), `startTranscribe()` (assert binary + `assertModelExists` ПЕРЕД fork → `model_missing` если модели нет, Gap 3), `utilityProcess.fork(whisper-runner.cjs)`, ветки message progress/segment/done, на code 0 читает `<audio>.json` (-oj) → `buildTranscriptMd` → атомарный авто-save `<hash>.transcript.md` (.tmp→rename, D-04) → Result `{mdPath, segments}`. `cancel(jobId)` → SIGTERM → reason `cancelled`; code≠0 → `whisper_failed` + лог stderrTail; один активный job; settled-дедуп.
- **ipc/transcribe.ts.** `registerTranscribeHandlers()` с handle-обёртками (try/catch→internal): START валидирует audioPath (isAbsolute + access R_OK → `audio_not_found`) + model-whitelist + language; CANCEL валидирует jobId UUID_REGEX; OPEN/REVEAL принимают только нами сгенерированный mdPath (D-06). SAVE_AS здесь НЕ регистрируется (приходит в 03-04).
- **Wiring.** `ipc/index.ts` → `registerTranscribeHandlers()` (заменён future-комментарий); `main/index.ts` → `transcriber.init()` рядом с `mediaExtractor.init()`.
- **preload + renderer-слайс.** Namespace `transcribe.{start,cancel,saveAs(заглушка),openFile,revealInFolder,onProgress,onSegment}` (зеркало media, sandboxed). После extract-done — кнопка «Транскрибировать» → state transcribing → по done `TranscriptResult` c текстом + «Открыть файл»/«Показать в папке». Reason `whisper_failed`/`internal` → `InlineError` с уникальной русской копией (role=alert). UI не блокируется (TRANS-06).

## Требования

| Req | Статус | Примечание |
|-----|--------|------------|
| TRANS-01 | GREEN (UAT) | Локальная офлайн-транскрипция — подтверждено вручную, осмысленный русский без галлюцинаций |
| TRANS-03 | GREEN | `-l ru --vad` через buildTranscribeArgs (контракт из 03-01, теперь в рабочем pipeline) |
| TRANS-06 | GREEN | fork (не spawn в main) — UI не зависает, один job, cancel SIGTERM |
| TRANS-07 | GREEN (UAT) | transcript.md авто-сохранён, открыт/показан — подтверждено вручную |

Остаются вне слайса: **TRANS-02** (управление моделями → 03-03), **TRANS-04** (live-прогресс UI) и **TRANS-05** (cancel UX) — база заложена, UX/доводка в 03-03/03-04.

## TDD Gate Compliance

План `type: tdd`-задачи (Wave 0 RED-стабы из 03-01). RED → GREEN последовательность подтверждена: `whisper-runner-parse.test.ts`, `transcript-builder.test.ts`, `transcriber.test.ts` стартовали красными (skip/todo из 03-01) и стали зелёными в этом плане. GREEN-коммиты: `4740ec6`, `10ad47a`, `338e83b`.

## Checkpoint (human-verify) — ядро ценности

Milestone-gate UAT пройден человеком: офлайн mp4→transcript.md работает, русский транскрипт осмысленный, без галлюцинаций. Ответ: **approved**. TRANS-01/03/06/07 GREEN подтверждены вручную.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dev-сборка не собирала .cjs-утилиты → ffmpeg_failed в `npm run dev`**

- **Found during:** human-verify чекпоинт (UAT ядра ценности), применено оркестратором, уже закоммичено.
- **Issue:** `npm run dev` (electron-vite dev) НЕ собирал `ffmpeg-runner.cjs` / `whisper-runner.cjs` в `out/main/` — `build:utilities` запускался только на `npm run build`. В dev `utilityProcess.fork(out/main/*.cjs)` падал → извлечение аудио И транскрипция возвращали `ffmpeg_failed` («повреждён/кодек»). Phase 2 верифицировался на packaged-сборке, поэтому dev-дыра не была поймана.
- **Fix:** `package.json` — `predev`-хук запускает `build:utilities` перед `electron-vite dev`; `electron.vite.config.ts` — `main.build.emptyOutDir=false`, чтобы dev не стирал собранные `.cjs`.
- **Root-cause:** Phase 2 dev-wiring gap, всплыл при первом реальном dev-прогоне ядра ценности в 03-02.
- **Files modified:** `package.json`, `electron.vite.config.ts`
- **Commit:** `676eb0c`

**Cross-phase note:** этот dev-wiring gap нужно учесть в 03-04 (build/smoke-проверка должна покрывать и dev-режим, не только packaged) и занести в Phase 2 retro (smoke-тест верифицировал только packaged build — dev-путь `utilityProcess.fork` остался непроверенным).

## Known Stubs

- **`transcribe.saveAs` в preload** — объявлена ради единого namespace-контракта, но НЕ имеет UI-вызова и handler'а в 03-02. Handler `TRANSCRIBE_SAVE_AS` и кнопка «Сохранить как» приходят в 03-04 (осознанно, см. scope-note плана). Скрытой нерабочей кнопки в 03-02 нет.
- **`model-manager.test.ts` (TRANS-02)** — остаётся RED (Nyquist Wave 0), GREEN в 03-03. Вне scope. См. `deferred-items.md`.
- **`tests/integration/transcribe-real.test.ts`** — реальный whisper-прогон gated/skip без ggml-модели в окружении; покрытие качества обеспечено человеческим UAT-чекпоинтом.

## Self-Check: PASSED

- Файлы созданы: whisper-runner.ts, transcript-builder.ts, transcriber.ts, ipc/transcribe.ts, TranscriptResult.tsx — FOUND
- Коммиты существуют: 4740ec6, 10ad47a, 338e83b, 676eb0c — FOUND
- key_links подтверждены: `utilityProcess.fork` + `buildTranscriptMd` + авто-save в transcriber.ts; `registerTranscribeHandlers` в ipc/index.ts; `transcriber.init()` в main/index.ts
