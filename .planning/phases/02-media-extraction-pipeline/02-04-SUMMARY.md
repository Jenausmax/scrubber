---
phase: 02-media-extraction-pipeline
plan: 04
subsystem: verification-integration-smoke
tags: [integration, packaging, smoke, verification, ffmpeg, asar-unpack, checkpoint]
status: partial-at-checkpoint
requires:
  - 02-01-PLAN (contract + asarUnpack в electron-builder.yml + ffmpeg-runner.cjs build)
  - 02-02-PLAN (mediaExtractor + ffmpeg-paths + utility runner + IPC handlers)
  - 02-03-PLAN (Transcribe FSM UI — нужен для drag&drop в packaged smoke)
provides:
  - tests/fixtures/media/generate.mjs — standalone fixture generator (short.mp4 + no-audio.mp4) через ffmpeg-static
  - tests/integration/extract-real.test.ts — 9 it-блоков покрывают ffmpeg-static/@ffprobe-installer резолв, ffprobe duration, ffmpeg WAV-формат, parseProgressLine на реальном stdout
  - .gitignore: tests/fixtures/media/*.mp4|*.wav
  - vitest.config.ts: testTimeout: 60000
affects:
  - Phase 2 acceptance MEDIA-03 в dev покрыт автоматическим integration test (без зависимости от Electron-рантайма)
  - MEDIA-04 (packaged smoke) — Task 2 checkpoint: human-verify; VERIFICATION.md заполняется continuation после ручного прогона
tech-stack:
  added: []
  patterns:
    - "Integration-тест без electron mock: тестируем ffmpeg/ffprobe напрямую через child_process (ffmpeg-paths не зависит от electron, child_process не мокается глобально)"
    - "Fixture generator как ESM-скрипт (.mjs), idempotent — node tests/fixtures/media/generate.mjs"
    - "Beforе-all авто-генерация фикстур через process.execPath + GENERATE_SCRIPT (CI-friendly)"
    - "ensureExecutable перед integration-тестами — на случай свежего clone/CI где exec-bit мог слететь (Pitfall #2)"
key-files:
  created:
    - tests/fixtures/media/generate.mjs
    - tests/integration/extract-real.test.ts
  modified:
    - .gitignore
    - vitest.config.ts
  pending_at_checkpoint:
    - .planning/phases/02-media-extraction-pipeline/02-VERIFICATION.md (заполнить после ручного smoke на Windows host)
decisions:
  - "D-INT-SCOPE: Integration-тест НЕ вызывает mediaExtractor.startExtract — utilityProcess.fork требует Electron-рантайма. Покрываем низ pipeline (ffmpeg/ffprobe через child_process). Полный pipeline (включая utilityProcess) — только packaged smoke (Task 2 manual). Это сознательное сужение per PLAN <action> финального решения."
  - "D-NO-UNMOCK: Глобальный vi.mock('electron') в tests/setup.ts НЕ мешает — ffmpeg-paths.ts не импортирует electron, и тест работает с child_process.spawn напрямую. Поэтому НЕ потребовалось ни cross-env, ни ENV-флага VITEST_INTEGRATION (упрощение vs PLAN <action>)."
  - "D-BEFOREALL-NODE: beforeAll авто-вызывает generate.mjs через process.execPath (не через npm script) — это CI-friendly и не требует доп. test:integration script. Запуск: `npx vitest run tests/integration/extract-real.test.ts` — фикстуры создаются автоматически если их нет."
metrics:
  duration: ~25 минут (Task 1 only; Task 2 — checkpoint await)
  completed_at_checkpoint: 2026-05-31
  tasks_total: 2
  tasks_completed: 1
  tasks_at_checkpoint: 1
---

# Phase 02 Plan 04: Verification + Smoke Summary (PARTIAL — at checkpoint)

Closing wave Phase 2. Закрывает acceptance двумя путями:
1. **Integration test** (Task 1 — ✅ done) — реальный ffmpeg/ffprobe pipeline на сгенерированной 5-сек mp4 фикстуре, покрывает MEDIA-03 в dev.
2. **Packaged smoke** (Task 2 — ⏸ checkpoint) — пользователь на Windows host прогоняет упакованную сборку и фиксирует результат в `02-VERIFICATION.md`.

## Outcomes (Task 1 only)

### Task 1 — Integration test + fixture generator

**Fixture generator** (`tests/fixtures/media/generate.mjs`):
- ESM (.mjs) standalone.
- Цели: `short.mp4` (lavfi sine 440Hz + color blue 320x240, 5 сек, `-shortest`) и `no-audio.mp4` (только color, `-an`, 5 сек).
- Idempotent: `existsSync(out) → skip`.
- Запуск: `node tests/fixtures/media/generate.mjs` (использует `process.execPath` в beforeAll теста).

**Integration test** (`tests/integration/extract-real.test.ts`, 9 it-блоков, 3 describe):

| # | Group | Тест | Покрывает |
|---|-------|------|-----------|
| 1 | binaries | resolveFfmpeg → existing file | ffmpeg-static резолвится |
| 2 | binaries | resolveFfprobe → existing file | @ffprobe-installer резолвится |
| 3 | binaries | `ffmpeg -version` exits 0 | Бинарник исполняемый |
| 4 | ffprobe | durationSec(short.mp4) ≈ 5 (4.5..5.5) | MEDIA meta — probe реален |
| 5 | ffmpeg | spawn с contract-args → wav 16kHz mono PCM s16le | A4 RESEARCH (sample 16k, mono, PCM, `-progress pipe:1`) |
| 6 | ffmpeg | no-audio mp4 — без exception | edge case Graceful handling |
| 7 | parser | `out_time_us=2500000` + duration 5 → 50% + etaSec | A3 RESEARCH — реальный stdout format |
| 8 | parser | non-progress строки игнорируются (frame=, bitrate=, progress=) | дедуп |
| 9 | parser | повторный percent → null (dedup) | D-08 throttle |

**Scope-сужение** (D-INT-SCOPE): `utilityProcess.fork` недоступен в node-vitest, поэтому **полный** `mediaExtractor.startExtract` покрывается только packaged smoke (Task 2). Здесь — ffmpeg/ffprobe через `child_process.spawn` напрямую (низ pipeline). RESEARCH A3/A4 при этом всё равно закрыты: те же args, тот же контракт, тот же stdout формат.

**Глобальный electron mock не мешает** (D-NO-UNMOCK): `ffmpeg-paths.ts` не импортирует electron, `child_process` не мокается. Это позволило обойтись без `cross-env`/`VITEST_INTEGRATION` ENV-флага из PLAN <action> — упрощение.

**vitest.config.ts**: `testTimeout: 60000` — глобально, чтобы integration-кейсы со spawn ffmpeg не отваливались по 5-сек дефолту.

**.gitignore**: `tests/fixtures/media/*.mp4|*.wav` — фикстуры не коммитятся.

## Verification (Task 1)

| Шаг | Команда | Результат |
|-----|---------|-----------|
| Генератор | `node tests/fixtures/media/generate.mjs` | short.mp4 51999 B, no-audio.mp4 5201 B созданы |
| Integration-тест | `npx vitest run tests/integration/extract-real.test.ts` | **9/9 passed** (~470ms tests + setup) |
| Полный suite (sequential) | `npx vitest run --no-file-parallelism` | **112/112 passed** (13 файлов) |
| Полный suite (parallel) | `npx vitest run` | 111/112 (1 flake) — Phase 1 secrets-store race (документирован в 02-02-SUMMARY, 02-03-SUMMARY); не вызван этим планом |
| gitignore проверка | `git check-ignore tests/fixtures/media/short.mp4` | exits 0 (файл ignored) |

## Commits (Task 1)

| Task | Commit | Files |
|------|--------|-------|
| 1 | `96d2a4d` test(02-04): integration test для real ffmpeg/ffprobe pipeline + fixture generator | tests/fixtures/media/generate.mjs, tests/integration/extract-real.test.ts, .gitignore, vitest.config.ts |

## ⏸ Task 2 — CHECKPOINT (human-verify)

**Status:** AWAITING USER. Этот SUMMARY будет дополнен после approve/failed/skipped.

**Что нужно от пользователя** (см. Task 2 `<how-to-verify>` в PLAN):

1. **Сборка:** `npm run build:unpack` (script уже в `package.json`) → должно завершиться без ошибок, появиться `out/win-unpacked/...exe` + `resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`.
2. **Проверка unpacked:** `dir out/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/`, `dir out/win-unpacked/resources/app.asar.unpacked/node_modules/@ffprobe-installer/`.
3. **Запуск:** двойной клик на `out/win-unpacked/scrubber.exe` (или `react-ts.exe`).
4. **Drop:** перетащить `tests/fixtures/media/short.mp4` в drop-zone Transcribe.
5. **Извлечение:** нажать «Извлечь аудио» → прогресс → ExtractDone карточка с путём.
6. **Файл на диске:** `dir $env:APPDATA\<productName>\extracted\` — `<hash>.wav` должен лежать.
7. **(Optional)** проигрывание wav в Windows Media Player — тон 440Hz.

После ручного прогона:
- Если **OK**: type "approved" → continuation создаст `02-VERIFICATION.md` с PASS-метками для Windows + SKIPPED для Linux/macOS, обновит этот SUMMARY до `status: complete`.
- Если **FAIL**: type "failed: <описание>" → continuation либо документирует gap, либо открывает новый план через `/gsd:plan-phase --gaps`.
- Если **SKIP**: type "skipped: <причина>" → continuation отметит MEDIA-04 (Win) как SKIPPED-WITH-REASON.

## Pending Artifacts

- `.planning/phases/02-media-extraction-pipeline/02-VERIFICATION.md` — будет создан в continuation с реальными результатами Windows smoke + явными SKIP для Linux/macOS.
- Финальный коммит для Task 2 (после approve): `docs(02-04): VERIFICATION.md — Windows smoke <PASS/FAIL>` + завершение SUMMARY.

## Deviations from Plan (Task 1)

### Auto-fixed Issues

Нет автофиксов. Task 1 выполнен в точности по PLAN <action> с одним сознательным упрощением:

**Упрощение vs PLAN: пропустили cross-env / VITEST_INTEGRATION ENV-флаг**

- **PLAN <action>** предлагал «обернуть `vi.mock('electron')` в tests/setup.ts через `if (!process.env.VITEST_INTEGRATION)` + добавить `cross-env` + script `test:integration`».
- **Сделано:** оставили глобальный mock как есть. Тест работает потому что `ffmpeg-paths` не импортирует electron, а `child_process` не мокается ни в одном файле setup.
- **Эффект:** -1 dependency (cross-env), -1 script (test:integration), -1 туровой обвес в tests/setup.ts. Integration-тесты запускаются обычным `npx vitest run` (входят в общий include по pattern `tests/**/*.test.ts`).
- **Trade-off:** если в будущем понадобится unmock electron для теста, который импортирует `mediaExtractor` целиком — тогда придётся ввести флаг. Сейчас не требуется.
- **Документация:** D-INT-SCOPE + D-NO-UNMOCK в frontmatter.

### Architectural Decisions (документация, не отклонения)

См. секцию `decisions` в frontmatter: D-INT-SCOPE, D-NO-UNMOCK, D-BEFOREALL-NODE.

## CONTEXT Decisions Implemented (Task 1)

| Decision | Где |
|----------|-----|
| D-01 (WAV PCM s16le 16kHz mono) | Integration-тест проверяет ffprobe over output wav: `codec_name=pcm_s16le`, `sample_rate='16000'`, `channels=1` |
| D-08 (`-progress pipe:1`) | spawn args идентичны `ffmpeg-runner.ts`; парсер тестируется на реальном `out_time_us=` |
| D-18 (chmod 0o755 + asar.unpacked) | beforeAll вызывает `ensureExecutable(resolveFfmpeg/ffprobe)` перед тестами |

## CONTEXT Decisions Awaiting (Task 2)

| Decision | Где будет |
|----------|-----------|
| D-19 (Windows packaged smoke acceptance) | Awaiting — Task 2 checkpoint |

## Threat Model Confirmation

| Threat ID | Status |
|-----------|--------|
| T-02-04-01 (tampering — ffmpeg binary integrity) | accepted в RESEARCH; интегра-тест подтверждает что бинарник из `ffmpeg-static@5.3.0` исполняется (`ffmpeg -version` exit 0) |
| T-02-04-02 (DoS — большой файл в smoke) | mitigated через 5-сек fixture (≤52 KB на диске) |
| T-02-04-03 (info disclosure через VERIFICATION.md абс. пути) | accepted — VERIFICATION хранится в репо как планирование, не secret |

## Stub Tracking

Стабов нет. Все тестовые кейсы используют реальный ffmpeg-static / @ffprobe-installer бинарники.

## Self-Check (Task 1): PASSED

- [x] `tests/fixtures/media/generate.mjs` существует
- [x] `tests/integration/extract-real.test.ts` существует
- [x] `tests/fixtures/media/short.mp4` сгенерирован (51999 B)
- [x] `tests/fixtures/media/no-audio.mp4` сгенерирован (5201 B)
- [x] `git check-ignore tests/fixtures/media/short.mp4` exits 0 (ignored)
- [x] `vitest.config.ts` содержит `testTimeout: 60000`
- [x] `.gitignore` содержит `tests/fixtures/media/*.mp4`
- [x] `npx vitest run tests/integration/extract-real.test.ts` — 9/9 passed
- [x] `npx vitest run --no-file-parallelism` — 112/112 passed (полный suite)
- [x] Commit `96d2a4d` присутствует в git log
- [x] STATE.md / ROADMAP.md / REQUIREMENTS.md НЕ модифицированы (orchestrator handles)
- [ ] `02-VERIFICATION.md` создан — **awaiting Task 2 checkpoint**
- [ ] Phase 2 готова к `/gsd:verify-work` — **awaiting Task 2 checkpoint**

## Self-Check (Task 1): PASSED

## Hand-Off to continuation (Task 2)

После того как user даст "approved" / "failed" / "skipped":
1. Создать `.planning/phases/02-media-extraction-pipeline/02-VERIFICATION.md` по шаблону из PLAN Task 2 `<action>` с реальными результатами.
2. Обновить этот SUMMARY: `status: partial-at-checkpoint` → `complete`; убрать секцию ⏸ Task 2; добавить commit Task 2 в таблицу; пометить D-19 как Implemented.
3. Финальный коммит: `docs(02-04): VERIFICATION.md — Windows packaged smoke <result>` (+ дополненный SUMMARY).

---

## Task 2 — Smoke-test Result (2026-06-02)

**Status:** failed — 3 gaps зафиксированы в `02-VERIFICATION.md`.

### Что прошло
- `npm run build:unpack` — успешен (артефакты в `dist/win-unpacked/`).
- `ffmpeg-static/ffmpeg.exe` и `@ffprobe-installer/ffprobe.exe` распакованы в `resources/app.asar.unpacked/node_modules/…` ✓ — asarUnpack из Plan 01 работает.
- Приложение запускается, вкладка «Транскрипция» доступна.
- Pick через кнопку «Выбрать файл» (`dialog.showOpenDialog` → `media.pickFile`) работает.

### Что упало
1. **Drop-zone не реагирует на drag-drop** — `onDrop`/`onDragOver` не работает (MEDIA-01).
2. **`extractAudio` возвращает «внутренняя ошибка / неподдерживаемый кодек»** в packaged build — вероятнее всего `ffmpegPath.replace('app.asar', 'app.asar.unpacked')` не применён (Pitfall #1, RESEARCH §Pitfall 1) — БЛОКЕР MEDIA-02/03.
3. **UI-маппинг ошибок неполный** — `MediaReason → string` не покрывает все 7 кодов из D-16.

Подробности и hypotheses — `02-VERIFICATION.md` §Gaps.

**Next:** `/gsd:plan-phase 2 --gaps` создаст коррекционный план; затем `/gsd:execute-phase 2 --gaps-only` + повторный smoke на Windows.

**Status:** partial (waiting gap-closure).
