---
phase: 3
slug: local-transcription-core-value
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — Phase 1/2 infra) + @testing-library/react |
| **Config file** | electron.vite.config.ts / vitest config (existing) |
| **Quick run command** | `npm run test:unit -- <file>` |
| **Full suite command** | `npm test` (typecheck + vitest run + electron-vite build) |
| **Packaged smoke** | `npm run smoke:packaged` (расширяется под whisper в 03-04) |
| **Estimated runtime** | unit ~10-20s; integration (реальный whisper) gated/skip без бинарника |

---

## Sampling Rate

- **After every task commit:** `npm run test:unit -- <file>`
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** Full suite green + packaged smoke на Windows
- **Max feedback latency:** < 30s (unit)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 03-01-01 | 01 | 1 | TRANS-01..07 (контракт) | T-3-01 | Result<T> на все мутации, нет throw через IPC | typecheck | `npm run typecheck` | ⬜ |
| 03-01-02 | 01 | 1 | TRANS-03 + Wave0 стабы | T-3-05 | assertBinaryExists guard готов | unit | `npm run test:unit -- src/main/utilities/whisper-args.test.ts` | ⬜ |
| 03-01-03 (chk) | 01 | 1 | — (resources prep) | T-3-02 | бинарник из офиц. релиза; SHA-манифест сверен | human | manual: whisper-cli --help + curl -sI | ⬜ |
| 03-02-01 | 02 | 2 | TRANS-04, TRANS-07 | — | parser изолирован в utility | unit | `npm run test:unit -- src/main/utilities/whisper-runner-parse.test.ts src/main/services/transcript-builder.test.ts` | ⬜ |
| 03-02-02 | 02 | 2 | TRANS-01, TRANS-05, TRANS-06 | T-3-03, T-3-04, T-3-05 | isAbsolute+fs.access; spawn массивом; assertBinaryExists перед fork | unit | `npm run test:unit -- src/main/services/transcriber.test.ts` | ⬜ |
| 03-02-03 | 02 | 2 | TRANS-07 | T-3-06 | open/reveal только для нашего mdPath | unit (RTL) | `npm run test:unit -- src/renderer/src/routes/Transcribe.test.tsx src/renderer/src/components/InlineError.test.tsx` | ⬜ |
| 03-02-04 (chk) | 02 | 2 | TRANS-01, TRANS-03 | — | офлайн транскрипция; качество ru | human UAT | manual dev e2e | ⬜ |
| 03-03-01 | 03 | 3 | TRANS-02 | T-3-07, T-3-08, T-3-09 | whitelist model-name (анти-SSRF); SHA256; .tmp→rename | unit | `npm run test:unit -- src/main/services/model-manager.test.ts` | ⬜ |
| 03-03-02 | 03 | 3 | TRANS-02 | T-3-07 | model_missing блок + отсылка в Settings | unit (RTL) | `npm run test:unit -- src/renderer/src/routes/Settings.tsx src/renderer/src/routes/Transcribe.test.tsx` | ⬜ |
| 03-04-01 | 04 | 4 | TRANS-03, TRANS-04, TRANS-05, TRANS-07 | T-3-06 | saveAs путь только из showSaveDialog | unit (RTL) | `npm run test:unit -- src/renderer/src/routes/Transcribe.test.tsx` | ⬜ |
| 03-04-02 | 04 | 4 | TRANS-01, TRANS-04 | T-3-10 | whisper-cli+DLL из app.asar.unpacked (Pitfall 1) | integration + smoke | `npm run test:unit -- tests/integration/transcribe-real.test.ts` | ⬜ |
| 03-04-03 (chk) | 04 | 4 | TRANS-03..07 | — | packaged e2e; качество ru без галлюцинаций | human UAT | manual packaged e2e | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (заводятся в 03-01, GREEN-наются в волнах 2-4)

- [ ] `src/main/utilities/whisper-args.test.ts` — TRANS-03 (GREEN уже в 03-01)
- [ ] `src/main/utilities/whisper-runner-parse.test.ts` — TRANS-04 (RED→GREEN в 03-02)
- [ ] `src/main/services/transcriber.test.ts` — TRANS-05/06 (RED→GREEN в 03-02)
- [ ] `src/main/services/model-manager.test.ts` — TRANS-02 (RED→GREEN в 03-03)
- [ ] `src/main/services/transcript-builder.test.ts` — TRANS-07/D-01/D-02/D-03 (RED→GREEN в 03-02)
- [ ] `tests/integration/transcribe-real.test.ts` — TRANS-01 (RED→GREEN/skip в 03-04)
- [ ] `scripts/smoke-packaged.mjs` под whisper-cli+DLL (03-04)
- [ ] RTL Transcribe (model_missing блок, live-стриминг, тумблер, cancel-partial)

---

## Manual-Only Verifications

| Behavior | Requirement | Plan | Why Manual | Test Instructions |
|----------|-------------|------|------------|-------------------|
| Качество русского транскрипта (WER) | TRANS-03 | 03-02 chk, 03-04 chk | Требует реального аудио и человеческой оценки осмысленности | Прогнать реальный русский mp4, оценить читаемость |
| Отсутствие галлюцинаций на тишине | TRANS-03 | 03-02 chk | Зависит от реального не-речевого аудио | Файл с паузами/музыкой; искать повторы/выдуманный текст; тюнинг VAD по результату |
| Живой стриминг сегментов в реальном времени | TRANS-04 | 03-04 chk | Зависит от тайминга subprocess (A5) | Длинный файл, наблюдать появление сегментов по мере распознавания |
| Packaged whisper-cli + DLL | TRANS-01 | 03-04 chk | Реальная распаковка asar на Windows | build:unpack → транскрипция из app.asar.unpacked |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive code tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s (unit)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (2026-06-09)
