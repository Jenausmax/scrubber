---
phase: 02-media-extraction-pipeline
status: gaps_found
verified: 2026-06-02
verifier: human smoke-test (Windows host)
requirements: [MEDIA-01, MEDIA-02, MEDIA-03, MEDIA-04]
must_haves_total: 4
must_haves_verified: 1
gaps_count: 3
---

# Phase 2 Verification Report

## Summary

Automated suite: **112/112 passed** (`npx vitest run --no-file-parallelism`, включая integration extract-real). Build: `npm run build:unpack` зелёный (по факту артефакты падают в `dist/win-unpacked/`, а не `out/win-unpacked/` — `electron-builder` пишет в `dist/` по умолчанию).

Human smoke-test на Windows host (2026-06-02) выявил **3 gap'a**, блокирующих acceptance MEDIA-02/03/04:

## Verified

| ID | Statement | Evidence |
|----|-----------|----------|
| MEDIA-01 | IPC контракт `window.scrubber.media.*` существует, типизирован, экспонирован через preload | preload-тест 9/9, packaged-build открывается, кнопка «Выбрать файл» работает → namespace доступен в renderer |

## Gaps (failed must_haves)

### Gap 1 — Drop-zone не реагирует на drag-drop

- **Requirement:** MEDIA-01 (pick file через drag-drop как primary способ — D-04, UI-SPEC §DropZone).
- **Observed:** При перетаскивании mp4-файла в drop-zone ничего не происходит. Pick через кнопку «Выбрать файл» работает корректно (`dialog.showOpenDialog` → `media.pickFile`).
- **Hypothesis:** `onDrop` / `onDragOver` handler в `src/renderer/src/components/DropZone.tsx` не вызывает `event.preventDefault()` на `onDragOver`, или не извлекает путь из `dataTransfer.files[0].path` (в Electron renderer этот API доступен — `File.path` non-standard, но Electron его экспонирует).
- **Severity:** HIGH — основной UX pickup-flow сломан; кнопка-fallback не закрывает acceptance.
- **Affected:** MEDIA-01

### Gap 2 — `extractAudio` падает с reason для всех mp4 фикстур

- **Requirement:** MEDIA-02 (extract → wav на диск).
- **Observed:** В упакованном билде нажатие «Извлечь аудио» возвращает Result.ok=false; UI показывает «внутренняя ошибка приложения, неподдерживаемый кодек». Прогресс не идёт.
- **Hypothesis (приоритет проверки):**
  1. **`ffmpegPath.replace('app.asar','app.asar.unpacked')` не сработал в packaged build** — `ffmpeg-static` пытается читать бинарник из asar, ffmpeg возвращает non-zero exit, media-extractor мапит stderr на `ffmpeg_failed`, UI показывает «неподдерживаемый кодек». См. `src/main/services/ffmpeg-paths.ts` — путь надо переписать как на dev, так и на prod. (Pitfall #1 в RESEARCH.)
  2. **stderr mapping в `progress-parser` / `media-extractor`** возвращает `MediaReason='internal'` или `'ffmpeg_failed'`, а UI Transcribe.tsx маппит обе на одну строку «неподдерживаемый кодек». UI message слишком общий — нужно различать reason'ы.
  3. Фикстура `tests/fixtures/media/short.mp4` имеет такой кодек, который ffmpeg-static в упакованном билде не понимает. Маловероятно — fixture-generator использует libx264+aac, стандартные кодеки.
- **Severity:** BLOCKER — core value Phase 2 (mp4 → wav) не работает в production-build.
- **Affected:** MEDIA-02, MEDIA-03.

### Gap 3 — UI-сообщение об ошибке не отражает корневую причину

- **Requirement:** UX-acceptance (UI-SPEC §InlineError — каждый reason имеет осмысленный текст).
- **Observed:** Reason `internal` или `ffmpeg_failed` → UI «неподдерживаемый кодек». Это лишь один из 7 reason-кодов; user не понимает, что произошло.
- **Hypothesis:** В `src/renderer/src/routes/Transcribe.tsx` (или InlineError.tsx) маппинг `MediaReason → string` не покрывает все 7 кодов из D-16, либо дефолтный fallback неверно подписан.
- **Severity:** MEDIUM — отдельно не блокирует MEDIA-02, но при closure Gap 2 нужно вместе починить error-mapping.
- **Affected:** все MEDIA-* (UX-уровень).

## Notes

- **Path discrepancy в smoke-инструкции:** упакованный билд лежит в `dist/win-unpacked/`, не `out/win-unpacked/` (default `electron-builder` directory). `out/` использует только `electron-vite`. Не баг, а дефект документации — поправить в plan smoke-инструкциях.
- **Linux / macOS:** не верифицированы (нет host-машин). MEDIA-04 (cross-platform) для этих платформ — **SKIPPED**, оставлено на v1.1 milestone или ручной CI-прогон.
- Integration-test `tests/integration/extract-real.test.ts` зелёный в **dev-режиме** — это означает, что mp4→wav pipeline работает когда ffmpeg-path указывает в `node_modules/ffmpeg-static/` напрямую. Регрессия только в packaged build → подтверждает Hypothesis 1 в Gap 2.

## Recommended Next Step

`/gsd:plan-phase 2 --gaps` → создаст плана 02-X с tasks:
1. Починить `onDrop`/`onDragOver` в `DropZone.tsx` (Gap 1).
2. Починить `ffmpegPath.replace` в `ffmpeg-paths.ts` + добавить assertion в integration-тест на packaged-build path resolution (Gap 2).
3. Расширить `MediaReason → string` маппинг в UI до всех 7 кодов (Gap 3).
4. Добавить smoke-чеклист в CI (или скрипт) для проверки packaged build, чтоб не повторять fix-and-pray цикл (Gap 2 был бы пойман автоматизированной проверкой `app.asar.unpacked/`).

После gap-closure: повторный `/gsd:execute-phase 2 --gaps-only` → повторный human smoke на Windows.
