# Deferred Items — Phase 03 (local-transcription-core-value)

Обнаружено во время исполнения, вне scope текущего слайса. НЕ чинить здесь.

## Из 03-02 (ядро ценности)

- **`src/main/services/model-manager.test.ts` — RED (TRANS-02).**
  Стаб `MODEL_MANIFEST` намеренно красный (Nyquist Wave 0). GREEN приходит в **03-03**
  (управление моделями). НЕ в scope 03-02. Подтверждено 03-01-SUMMARY §Known Stubs.

- **`tests/integration/transcribe-real.test.ts` — реальный whisper-прогон gated/skip.**
  Кейс `whisper-cli офлайн прогоняет WAV` пропускается, пока в окружении нет ggml-модели
  (модели не бандлятся, CLAUDE.md). Полная GREEN-проверка качества русского — на
  human-verify чекпоинте 03-02 (TRANS-03 manual UAT) или при наличии модели
  (`SCRUBBER_TEST_MODEL=<path>` / ggml-small.bin рядом с бинарником).

- **`src/main/services/secrets-store.test.ts` — флака при параллельном прогоне.**
  Изолированно проходит (11/11); падает иногда в полном параллельном прогоне vitest
  (конкуренция за tmp userData). Предсуществующая проблема изоляции тестов, не связана
  с транскрипцией. Кандидат на `test.sequential`/per-file tmp-dir в отдельном плане.
