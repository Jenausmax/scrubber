---
phase: 2
slug: media-extraction-pipeline
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-31
updated: 2026-05-31
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Phase 1 baseline) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm run test -- --run` |
| **Full suite command** | `npm run test -- --run && npm run typecheck && npm run build` |
| **Estimated runtime** | ~60s (unit+typecheck+build) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run`
- **After every plan wave:** Run `npm run test -- --run && npm run typecheck && npm run build`
- **Before `/gsd:verify-work`:** Полная команда зелёная + ручной smoke упакованной сборки на хост-OS (Windows).
- **Max feedback latency:** 60 секунд

---

## Per-Task Verification Map

> Test-file paths синхронизированы с фактическими `files_modified` в 02-01-PLAN..02-04-PLAN.
> Phase 2 распакован в 4 плана (Wave 1: 02-01 IPC contracts → Wave 2: 02-02 backend → Wave 3: 02-03 UI → Wave 4: 02-04 integration + packaged smoke).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 02-01-T1 | 01 | 1 | MEDIA-01..04 | T-02-01-* | Contextbridge whitelist, IPC channel allowlist расширен | unit | `npm run test -- --run src/preload/index.test.ts` | ⬜ pending |
| 02-02-T1 | 02 | 2 | MEDIA-01, MEDIA-03 | T-02-02-01 | resolveFfmpeg/Ffprobe: `app.asar` → `app.asar.unpacked` rewrite; ensureExecutable chmod 0o755 | unit | `npm run test -- --run src/main/services/ffmpeg-paths.test.ts` | ⬜ pending |
| 02-02-T1 | 02 | 2 | MEDIA-03 | — | progress-parser: `out_time_us=` → `{percent, etaSec}`, edge cases (NaN, division by zero) | unit | `npm run test -- --run src/main/services/progress-parser.test.ts` | ⬜ pending |
| 02-02-T2 | 02 | 2 | MEDIA-01, MEDIA-03 | T-02-02-02..04 | utilityProcess.fork, cancel/cache/progress, path-traversal mitigation, stderr НЕ утекает в renderer | unit (mocked utilityProcess) | `npm run test -- --run src/main/services/media-extractor.test.ts` | ⬜ pending |
| 02-02-T3 | 02 | 2 | MEDIA-01..03 | T-02-02-05 | ipcMain.handle media.*: `isAbsolute`+`endsWith('.mp4')`+`fs.access(R_OK)` ДО вызова сервиса; reason-коды per D-16 | unit | `npm run test -- --run src/main/ipc/media.test.ts` | ⬜ pending |
| 02-03-T1 | 03 | 3 | MEDIA-02 | — | Transcribe route: DropZone (только `video/mp4`), file picker, meta-display, progress, error states; `webSecurity` остаётся `true` | unit (jsdom) | `npm run test -- --run src/renderer/src/routes/Transcribe.test.tsx` | ⬜ pending |
| 02-04-T1 | 04 | 4 | MEDIA-03, MEDIA-04 | — | E2E через прямой `child_process.spawn` ffmpeg-static на реальном fixture (silent.mp4); utilityProcess-обход — см. Manual-Only | integration (real ffmpeg) | `npm run test -- --run tests/integration/extract-real.test.ts` | ⬜ pending |
| 02-04-T2 | 04 | 4 | MEDIA-04 | — | Packaged smoke: NSIS на Windows, ffmpeg запускается из `app.asar.unpacked` | manual smoke (checkpoint) | `npm run build && npm run package -- --dir` + manual run | ⬜ checkpoint |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (✅ COMPLETED via Plan 02-01)

> Wave 0 инфраструктура поглощена Plan 01 (IPC contracts) и Plan 02 Task 1 (чистые утилиты). Отдельной фазы Wave 0 не требуется — все тестовые файлы создаются как часть TDD-задач первой волны соответствующих планов.

- [x] `vitest.config.ts` — наследуется из Phase 1 baseline; include уже покрывает `src/**` и `tests/**`.
- [x] `src/preload/index.test.ts` — создаётся в Plan 01 Task 1 (IPC contracts + channel allowlist).
- [x] `tests/fixtures/media/` — fixture-генератор создаётся в Plan 04 Task 1 (`scripts/generate-media-fixtures.cjs`, генерит `silent.mp4`, `video-only.mp4`, `broken.mp4` на лету через ffmpeg-static; бинарники не коммитятся).
- [x] `tests/setup.ts` — мок Electron `utilityProcess.fork` с `__emit` хелпером создаётся в Plan 02 Task 2 (через `vi.mock('electron')`).
- [x] `electron.vite.config.ts` — второй input-entry для `ffmpeg-runner.cjs` (CJS-output) добавляется в Plan 02 Task 2.
- [x] `electron-builder.yml` — `asarUnpack` для `node_modules/ffmpeg-static/**` и `@ffprobe-installer/**` настраивается в Plan 04 Task 2 (packaged smoke).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **Полный `utilityProcess.fork` pipeline на реальном ffmpeg** | MEDIA-03 | `utilityProcess` — это Electron-runtime-only API; недоступен в чистом vitest/Node-окружении. Автоматический integration-тест в Plan 04 Task 1 запускает ffmpeg-static через прямой `child_process.spawn`, что покрывает корректность args/stdout/exit, но НЕ покрывает `utilityProcess.fork` lifecycle (spawn/message/exit/kill через `parentPort`). Lifecycle покрыт unit-тестами `media-extractor.test.ts` с моком `utilityProcess` (Plan 02 Task 2). Полное end-to-end (Electron→utilityProcess→ffmpeg→wav на диске) проверяется только packaged-смоком. | Plan 04 Task 2 (blocking-human checkpoint, Windows host): запуск `out/win-unpacked/scrubber.exe`, перетаскивание реального mp4, проверка `audio.wav` в `userData/extracted/` и воспроизводимость в плеере. |
| **Упакованная сборка на Windows — извлечение аудио из реального mp4** | MEDIA-04 | Требует запуска NSIS/portable, отсутствие UI-движка в CI | 1) `npm run build && npm run package -- --dir`; 2) Запустить `out/win-unpacked/scrubber.exe`; 3) Перетащить test.mp4; 4) Убедиться, что `audio.wav` создан в userData; 5) Открыть wav в плеере. |
| **Упакованная сборка на macOS** | MEDIA-04 | Нет host-машины в dev-окружении Max'а (Win11). **Cross-platform packaged smoke deferred to Phase 5 CI.** | Гарантия конфигом (asarUnpack + chmod fallback). Помечается в VERIFICATION.md как best-effort. Manual smoke выполнить при первой возможности на macOS host. |
| **Упакованная сборка на Linux** | MEDIA-04 | Нет host-машины. **Cross-platform packaged smoke deferred to Phase 5 CI.** | Аналогично macOS — best-effort, фиксируется как known-gap до Phase 5 CI matrix. |
| **Drag-drop UX на реальном trackpad/mouse** | MEDIA-02 | jsdom не эмулирует DataTransfer полноценно | Manual smoke в dev: перетащить mp4, перетащить .txt (должен отклонить с visible feedback). Покрывается Plan 04 Task 2 чек-листом. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Manual-Only entry (utilityProcess.fork полный pipeline → manual smoke)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (распределено по Plan 01/02/04 task 1)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete: true` set in frontmatter

**Approval:** ready for /gsd:execute-phase
