---
phase: 2
slug: media-extraction-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-31
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

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-* | 01 | 0 | MEDIA-01..04 | — | Контракты IPC `media.*` типизированы, channel-allowlist расширен | unit | `npm run test -- --run src/shared/__tests__/ipc-contracts.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-* | 02 | 1 | MEDIA-01 | — | `dialog.showOpenDialog` фильтрует `.mp4`; renderer не получает абсолютный путь без выбора | unit + integration | `npm run test -- --run src/main/__tests__/media-pick.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-* | 03 | 1 | MEDIA-02 | — | Drag-drop принимает только `video/mp4`, отклоняет прочее без `webSecurity:false` | unit | `npm run test -- --run src/renderer/src/components/__tests__/DropZone.test.tsx` | ❌ W0 | ⬜ pending |
| 02-04-* | 04 | 2 | MEDIA-03 | — | ffmpeg выполняется в utilityProcess, main не блокируется (timing assertion) | integration | `npm run test -- --run src/main/__tests__/media-extract.test.ts` | ❌ W0 | ⬜ pending |
| 02-05-* | 05 | 2 | MEDIA-03 | — | utility-runner парсит `-progress pipe:1`, постит прогресс ≥1 раз для тестового mp4 | integration | `npm run test -- --run src/main/utilities/__tests__/ffmpeg-runner.test.ts` | ❌ W0 | ⬜ pending |
| 02-06-* | 06 | 3 | MEDIA-03 | — | Отмена job убивает child-процесс, временные файлы очищаются | integration | `npm run test -- --run src/main/__tests__/media-cancel.test.ts` | ❌ W0 | ⬜ pending |
| 02-07-* | 07 | 4 | MEDIA-01..03 | — | Экран Transcribe рендерит DropZone, meta, progress; ошибки видны в UI | unit | `npm run test -- --run src/renderer/src/routes/__tests__/Transcribe.test.tsx` | ❌ W0 | ⬜ pending |
| 02-08-* | 08 | 5 | MEDIA-04 | — | Упакованная сборка: ffmpeg вызывается из `app.asar.unpacked`, аудио извлекается на host-OS | manual smoke + e2e fixture | `npm run build && npm run package -- --dir` + manual run | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — расширить include для `src/main/utilities/**` и `src/renderer/src/components/**`
- [ ] `src/shared/__tests__/ipc-contracts.test.ts` — стабы под MEDIA-01..04 (channel-allowlist + payload-схемы)
- [ ] `tests/fixtures/media/` — fixture-генератор: короткий mp4 с аудио (silent.mp4), mp4 без audio track (video-only.mp4), повреждённый mp4 (broken.mp4). Скрипт `scripts/generate-media-fixtures.cjs` использует системный ffmpeg/ffmpeg-static для генерации; не коммитим бинари, генерим на лету.
- [ ] `src/main/__tests__/_helpers/utility-process-mock.ts` — мок Electron `utilityProcess.fork` для unit-уровня.
- [ ] `electron.vite.config.ts` — второй input-entry для `ffmpeg-runner.cjs` (CJS-output) — без него интеграционные тесты utility-runner'а не подцепят бандл.
- [ ] `electron-builder.yml` — `asarUnpack` для `node_modules/ffmpeg-static/**` и `@ffprobe-installer/**` — иначе packaged-смок упадёт.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Упакованная сборка на Windows — извлечение аудио из реального mp4 | MEDIA-04 | Требует запуска NSIS/portable, отсутствие UI-движка в CI | 1) `npm run build && npm run package -- --dir`; 2) Запустить `out/win-unpacked/scrubber.exe`; 3) Перетащить test.mp4; 4) Убедиться, что `audio.wav` создан в userData; 5) Открыть wav в плеере |
| Упакованная сборка на macOS | MEDIA-04 | Нет host-машины в dev-окружении Max'а (Win11) | Отмечается в VERIFICATION.md как best-effort; гарантия конфигом (asarUnpack + chmod fallback). Manual smoke выполнить при первой возможности на macOS. |
| Упакованная сборка на Linux | MEDIA-04 | Нет host-машины | Аналогично macOS — best-effort, фиксируется как known-gap. |
| Drag-drop UX на реальном trackpad/mouse | MEDIA-02 | jsdom не эмулирует DataTransfer полноценно | Manual smoke в dev: перетащить mp4, перетащить .txt (должен отклонить с visible feedback). |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
