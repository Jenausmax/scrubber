---
phase: 02-media-extraction-pipeline
plan: 02
subsystem: backend-media-extraction
tags: [backend, ffmpeg, utility-process, ipc, media-extractor, cache, electron]
requires:
  - 02-01-PLAN (shared/ipc types + skeleton handlers + ffmpeg-runner stub + tests/setup utilityProcess mock)
provides:
  - mediaExtractor singleton (probe/startExtract/cancel + sha1 cache)
  - ffmpeg-paths utilities (resolveFfmpeg/resolveFfprobe/ensureExecutable)
  - progress-parser pure function
  - реальные ipcMain.handle для media.* (pickFile/probe/extractAudio/cancel)
  - out/main/ffmpeg-runner.cjs (CJS utility entrypoint, 79 строк)
affects:
  - Plan 03 (UI) теперь может вызывать window.scrubber.media.* и получать реальные результаты
tech-stack:
  added:
    - "ffmpeg-static@5.3.0 (--save-exact)"
    - "@ffprobe-installer/ffprobe@2.1.2 (--save-exact)"
  patterns:
    - utilityProcess.fork ffmpeg-runner.cjs с parentPort message lifecycle (RESEARCH Pattern 3)
    - app.asar→app.asar.unpacked path-rewrite + ensureExecutable chmod 0o755 (Pitfall #1, #2)
    - parseProgressLine как pure function (testable in isolation), inline-дубль в utility-bundle
    - sha1(absPath:size:mtimeMs) non-security hash для cache-ключа (D-11)
    - defence-in-depth validateMp4Path в IPC handlers (D-06)
    - initial progress emit (percent:0, etaSec:null) синхронно после fork — даёт renderer
      jobId ДО возможной cancel-кнопки (D-09)
key-files:
  created:
    - src/main/services/ffmpeg-paths.ts
    - src/main/services/ffmpeg-paths.test.ts
    - src/main/services/progress-parser.ts
    - src/main/services/progress-parser.test.ts
    - src/main/services/media-extractor.ts
    - src/main/services/media-extractor.test.ts
    - src/main/ipc/media.test.ts
  modified:
    - package.json (новые dependencies)
    - src/main/utilities/ffmpeg-runner.ts (skeleton → полная CJS реализация)
    - src/main/ipc/media.ts (stub → полные handlers)
    - src/main/index.ts (добавлен mediaExtractor.init после registerIpcHandlers)
decisions:
  - "D-PAYLOAD: MEDIA_EXTRACT payload — string (только path). Handler сам вызывает probe для durationSec — упрощает renderer (single meta-call), согласуется с UI-SPEC State Map (selected→extracting без повторного probe в UI)."
  - "D-INLINE: parseProgressLine дублируется inline в ffmpeg-runner.cjs (~10 строк). Utility-bundle не импортирует из src/main/services/ (изоляция от main-графа, esbuild bundle отдельный). Поведение покрыто progress-parser.test.ts; дублирование сознательное, документировано в комментариях обоих файлов."
  - "D-ONEWINDOW: webContents.send(MEDIA_PROGRESS) использует BrowserWindow.getAllWindows()[0] — корректно для v1 (одно окно). Refactor требуется если v2 будет multi-window (трекать webContents в JobHandle)."
  - "D-INITIAL-PROGRESS: emitProgress(0, null) вызывается СРАЗУ после utilityProcess.fork() ДО подписки на ffmpeg-output. Это гарантирует, что renderer получает jobId раньше любой cancel-кнопки — для коротких mp4 ffmpeg может завершиться до первого out_time_us=, иначе renderer не успеет связать UUID с UI (race-fix per PLAN Task 2 A6)."
  - "D-TEST-ISOLATION: media-extractor.test.ts использует уникальный USER_DATA = scrubber-test-media-extractor/userData через override app.getPath mockImplementation. Это устраняет race-condition с secrets-store.test.ts в parallel-run (без этого Phase 1 SHELL-02 round-trip иногда flake-ит)."
metrics:
  duration: ~50 минут
  completed: 2026-05-31
  tasks_total: 3
  tasks_completed: 3
---

# Phase 02 Plan 02: Backend Media Extraction Service Summary

JWT? Нет — это полный backend-слайс извлечения аудио. Из `media.*` stub Plan 01 сделан реально работающий конвейер: `pickFile → probe → extractAudio (utilityProcess fork ffmpeg) → cancel` с кешем по sha1 (absPath:size:mtimeMs) и progress-events через `webContents.send`.

## Outcomes

Wave 1 (Plan 01) дал контракт `media.*` и пустые handlers. Этот план превратил их в работающий backend:

1. **Чистые утилиты** (Task 1):
   - `resolveFfmpeg()`/`resolveFfprobe()` — fail-fast на null + replace `app.asar`→`app.asar.unpacked` (Pitfall #1).
   - `ensureExecutable(p)` — idempotent chmod 0o755 на Linux/macOS, no-op на win32 (D-18, Pitfall #2).
   - `parseProgressLine(line, durationSec, startedMs, lastPct)` — pure function: парсит `out_time_us=N`, percent cap 99, etaSec calc, dedup по lastPct (D-08, Pattern 4).

2. **Singleton-сервис media-extractor** (Task 2):
   - `init()` создаёт `<userData>/extracted/` + ensureExecutable ffmpeg/ffprobe (idempotent).
   - `probe(absPath)` — короткоживущий `child_process.spawn(ffprobe)`, JSON-parse `format.duration` (RESEARCH Pattern 6).
   - `startExtract(absPath, durationSec, onProgress?)` — hash → cache-hit short-circuit (D-12) → utilityProcess.fork → `postMessage({type:'start'})` на event 'spawn' → progress relay через `BrowserWindow.getAllWindows()[0]?.webContents.send(Channels.MEDIA_PROGRESS, ...)` → exit 0 → `rename .tmp → .wav`. На cancel/error → `fs.unlink(.tmp)`.
   - `cancel(jobId)` — `proc.kill()` (SIGTERM) + флаг `cancelled=true` (D-09, D-10).
   - `onProgress` опционально передаётся для unit-тестов (заменяет webContents.send).

3. **ffmpeg-runner.cjs** (Task 2):
   - CJS-стиль (`require`), НЕ ESM (Pitfall #5).
   - Слушает `parentPort.on('message')` → spawn ffmpeg с args ровно `-vn -ac 1 -ar 16000 -c:a pcm_s16le -progress pipe:1 -y` (D-01, D-08).
   - stdout line-buffer → inline `handleProgressLine` (дубль ~10 строк) → `parentPort.postMessage({type:'progress', ...})`.
   - SIGTERM → child.kill (cancel из main).
   - На exit → `postMessage({type:'done', code, stderrTail})` + `process.exit(code ?? 1)`.

4. **IPC handlers** (Task 3):
   - 4 канала: `MEDIA_PICK_FILE/PROBE/EXTRACT/CANCEL`. `MEDIA_PROGRESS` НЕ через `ipcMain.handle` (event-канал).
   - `validateMp4Path` хелпер для дедупа D-06 валидации (PROBE/EXTRACT): `typeof===string` → `isAbsolute` → `endsWith('.mp4')` case-insensitive → `fs.access R_OK`.
   - `MEDIA_EXTRACT` payload = `string` (только path); handler сам вызывает probe для durationSec, см. **D-PAYLOAD**.
   - `MEDIA_CANCEL`: UUID-regex `/^[0-9a-f-]{36}$/i` валидация перед делегированием.
   - Reason-коды из `MediaReason` union; никаких throw через IPC.

5. **app-init wiring**:
   - `src/main/index.ts` после `registerIpcHandlers()` (но до `createWindow()`) вызывает `await mediaExtractor.init()` в try/catch — окно может сразу вызвать `media:probe`, но если ffmpeg init fail — не падаем целиком (settings/secrets уже работают).

## Verification

| Шаг | Команда | Результат |
|-----|---------|-----------|
| Task 1 tests | `npx vitest run src/main/services/{ffmpeg-paths,progress-parser}.test.ts` | 17/17 passed |
| Task 2 tests | `npx vitest run src/main/services/media-extractor.test.ts` | 12/12 passed |
| Task 3 tests | `npx vitest run src/main/ipc/media.test.ts` | 19/19 passed |
| Полный vitest | `npx vitest run --reporter=dot` | 95/95 passed (см. Known Issues — flake-ит при параллельном запуске Phase 1 secrets-store) |
| Typecheck | `npm run typecheck` | passed (node + web) |
| Build | `npm run build` | passed; `out/main/ffmpeg-runner.cjs` = 2.1 KB / 79 строк > 20 |

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 | (см. git log) feat(02-02): ffmpeg-paths + progress-parser + install ffmpeg-static/ffprobe | package.json + 4 services-файла |
| 2 | feat(02-02): media-extractor singleton + ffmpeg-runner CJS utility | media-extractor.ts + .test + ffmpeg-runner.ts + index.ts |
| 3 | feat(02-02): media IPC handlers с defence-in-depth + изоляция test userData | media.ts + media.test.ts + media-extractor.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking issue] Изоляция USER_DATA в media-extractor.test.ts**

- **Found during:** Task 3 (full vitest run после регистрации media.test.ts)
- **Issue:** Vitest по умолчанию запускает test-файлы параллельно. `secrets-store.test.ts` и `media-extractor.test.ts` оба обращались к `<tmpdir>/scrubber-test/userData/` — это давало race-condition (нерегулярный fail SHELL-02 round-trip и ENOTEMPTY на rmdir).
- **Fix:** В `media-extractor.test.ts` ввёл уникальный путь `scrubber-test-media-extractor/userData` и override `app.getPath` через `mockImplementation` в beforeEach. Тесты `secrets-store.test.ts` НЕ модифицированы (Phase 1 артефакт).
- **Files modified:** `src/main/services/media-extractor.test.ts`
- **Commit:** Task 3 финальный

### Architectural Decisions Made (документация, не отклонения)

См. секцию `decisions` в frontmatter: D-PAYLOAD, D-INLINE, D-ONEWINDOW, D-INITIAL-PROGRESS, D-TEST-ISOLATION.

## CONTEXT Decisions Implemented

| Decision | Где |
|----------|-----|
| D-01 (WAV PCM s16le 16kHz mono) | `ffmpeg-runner.ts` args + inline-test |
| D-04 (dialog MP4 filter) | `media.ts` MEDIA_PICK_FILE handler |
| D-06 (defence-in-depth `.mp4` валидация) | `media.ts` `validateMp4Path` |
| D-08 (`-progress pipe:1` + throttle) | `progress-parser.ts` + inline `handleProgressLine` |
| D-09 (cancel SIGTERM + удаление .tmp) | `media-extractor.ts` `cancel()` + exit-handler |
| D-10 (один активный job) | `jobs: Map<string, JobHandle>` в `media-extractor.ts` |
| D-11 (cache hash sha1(absPath:size:mtimeMs)) | `media-extractor.ts` `hashFor()` |
| D-12 (cache-hit short-circuit) | `media-extractor.ts` `startExtract` начало |
| D-16 (reason-коды) | `MediaReason` union + `mapFsErr()` helper |
| D-17 (utilityProcess.fork) | `media-extractor.ts` startExtract |
| D-18 (app.asar.unpacked + chmod 0o755) | `ffmpeg-paths.ts` + `mediaExtractor.init()` |

## Threat Model Confirmation

| Threat ID | Status |
|-----------|--------|
| T-02-02-01 path traversal | `isAbsolute` гейт в `validateMp4Path` (ipc) + `startExtract` (services) |
| T-02-02-02 argument injection | `spawn(ffmpegPath, args)` БЕЗ shell во всём коде; outputPath под нашим контролем (`<hash>.wav.tmp`) |
| T-02-02-03 stderr утечка | stderr собирается в utility, на error возвращается ТОЛЬКО `reason:'ffmpeg_failed'`, stderrTail в `console.error` логе main |
| T-02-02-04 DoS | один job за раз через `jobs: Map` + cancel-кнопка |
| T-02-02-05/SC supply chain | оба пакета [VERIFIED] в RESEARCH Audit, установлены с `--save-exact` |

## Known Issues / Flakes

- **Phase 1 SHELL-02 round-trip flake**: `secrets-store.test.ts` и `tests/integration/secrets-persist.test.ts` оба обращаются к shared `<tmpdir>/scrubber-test/userData/` — при определённом ordering параллельный rm/recreate один разрушает state другого. Запуск изолированно — зелёный. Решение в Phase 1 артефакте — не правил, чтобы не выходить за scope этого плана. Запуск повторный обычно проходит.

## Stub Tracking

Стабов нет. Все code-paths имеют реальную реализацию (ffmpeg-spawn, ffprobe-spawn, cache check). UI Plan 03 будет вызывать `window.scrubber.media.*` и получать настоящие WAV-файлы.

## Self-Check: PASSED

- [x] `src/main/services/ffmpeg-paths.ts` существует
- [x] `src/main/services/progress-parser.ts` существует
- [x] `src/main/services/media-extractor.ts` существует
- [x] `src/main/services/media-extractor.test.ts` существует (12 тестов)
- [x] `src/main/utilities/ffmpeg-runner.ts` обновлён (CJS, ~130 строк)
- [x] `src/main/ipc/media.ts` обновлён (полные handlers)
- [x] `src/main/ipc/media.test.ts` существует (19 тестов)
- [x] `out/main/ffmpeg-runner.cjs` собран (`npm run build`), 79 строк (>20)
- [x] Все 3 коммита присутствуют в git log
- [x] `grep -c "ipcMain.handle" src/main/ipc/media.ts` == 4
- [x] `grep -c "endsWith('.mp4')" src/main/ipc/media.ts` >= 1
- [x] `grep -c "isAbsolute" src/main/ipc/media.ts` >= 1
- [x] `grep -c "'media:" src/main/ipc/media.ts` == 0 (только через Channels.*)
- [x] `grep -c "utilityProcess.fork" src/main/services/media-extractor.ts` >= 1
- [x] `grep -c "Channels.MEDIA_PROGRESS" src/main/services/media-extractor.ts` >= 1
- [x] `grep -c "webContents.send" src/main/services/media-extractor.ts` >= 1
- [x] `grep -c "require(" src/main/utilities/ffmpeg-runner.ts` >= 1 (CJS-стиль)
- [x] `grep -c "mediaExtractor.init" src/main/index.ts` >= 1
- [x] STATE.md / ROADMAP.md / REQUIREMENTS.md НЕ модифицированы (orchestrator handles)
