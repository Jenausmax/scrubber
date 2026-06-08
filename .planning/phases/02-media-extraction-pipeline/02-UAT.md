---
status: complete
phase: 02-media-extraction-pipeline
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, fix-02-06 (commits 7f9e9f0, 6fcb885)]
started: 2026-06-08T10:03:19Z
updated: 2026-06-08T10:12:00Z
---

## Current Test

[testing complete — MEDIA-01/02/03 + Gap 3 ✅; MEDIA-04 (Linux/macOS) deferred → v1.1]

## Tests

### 1. Выбор mp4 через кнопку «Выбрать файл» (MEDIA-01)
expected: Клик «Выбрать файл» → нативный диалог с фильтром .mp4 → выбор файла отдаёт путь в renderer, появляется карточка метаданных.
result: pass
note: Подтверждено human smoke 02-04 (VERIFICATION.md «Verified» MEDIA-01) — namespace `window.scrubber.media.*` доступен, dialog работает.

### 2. Drag-drop mp4 в drop-zone (MEDIA-01 / Gap 1)
expected: Перетаскивание mp4 в drop-zone → извлекается абсолютный путь → карточка метаданных + CTA «Извлечь аудио».
result: pass
note: Verified live 2026-06-06 на packaged build (dist/win-unpacked). Лог показал `fork ffmpeg-runner ... inputPath=...tests\fixtures\media\short.mp4` — путь доставлен через `webUtils.getPathForFile` (Electron 32+ fix). Gap 1 закрыт.

### 3. Извлечение аудио → прогресс → wav на диске (MEDIA-02 / MEDIA-03 / Gap 2)
expected: Клик «Извлечь аудио» → прогресс 0→100% → done-state с путём к `<userData>/extracted/<hash>.wav` (16kHz mono pcm_s16le).
result: pass
note: Verified live 2026-06-06 (packaged). Финальный wav создан: `<userData>/extracted/8ed76da...wav`, 160574 B, RIFF, pcm_s16le/16000/mono, лог без ошибок. Закрыт реальный root cause (`-f wav`, commit 7f9e9f0) — НЕ каскад Gap 1, как предполагал 02-05-SUMMARY.

### 4. Осмысленный текст ошибки при отсутствии ffmpeg-бинарника (Gap 3 / UX)
expected: Если ffmpeg-бинарник не распакован — UI показывает `internal`-копию «…бинарник ffmpeg может быть не распакован», а НЕ «неподдерживаемый кодек».
result: pass
note: Исправлено commit 6fcb885 — startExtract() вызывает assertBinaryExists перед fork → reason 'internal'. Verified unit-тестом media-extractor.test.ts «Gap 3» (RED→GREEN): отсутствующий бинарник → reason internal, fork не вызывается. InlineError 'internal' содержит намёк про нераспакованный бинарник (подтверждено). Опционально: live missing-binary smoke на packaged build (rename ffmpeg.exe→.bak) не прогонялся — логика покрыта unit-тестом + копия подтверждена.

### 5. Кросс-платформенность Linux / macOS (MEDIA-04)
expected: Тот же pick→extract→wav pipeline на Linux и macOS packaged build.
result: blocked
blocked_by: third-party
reason: Нет Linux/macOS host-машин. Предварительно акцептовано в 02-VERIFICATION.md (SKIPPED → v1.1 milestone или ручной CI-прогон). Не блокирует закрытие Phase 2 на Windows-таргете.

## Summary

total: 5
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "При отсутствии ffmpeg-бинарника UI показывает internal-копию про нераспакованный бинарник, а не «неподдерживаемый кодек»"
  status: resolved
  reason: "Code-trace: assertBinaryExists только в init() (throw проглатывается в index.ts); live extract-путь мапил spawn-ENOENT ffmpeg в reason='ffmpeg_failed'."
  severity: minor
  test: 4
  root_cause: "assertBinaryExists вызывался лишь в MediaExtractor.init() (bootstrap, swallowed). startExtract() не проверял наличие бинарника перед fork → отсутствующий ffmpeg.exe доходил как spawn-ENOENT воркера → proc exit code≠0 → main маппил в ffmpeg_failed (а не internal)."
  fix: "commit 6fcb885 — startExtract() вызывает assertBinaryExists(resolveFfmpeg(),'ffmpeg') перед utilityProcess.fork; при throw → return reason='internal'. TDD-гард: media-extractor.test.ts «Gap 3» (RED→GREEN)."
  artifacts:
    - path: "src/main/services/media-extractor.ts"
      issue: "[resolved] startExtract() теперь вызывает assertBinaryExists перед fork"
  debug_session: ""
