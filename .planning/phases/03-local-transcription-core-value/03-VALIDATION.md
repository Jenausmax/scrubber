---
phase: 3
slug: local-transcription-core-value
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — Phase 1/2 infra) |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npm run test -- --run <file>` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | ~{N} seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run <file>`
- **After every plan wave:** Run `npm run test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 0 | TRANS-{XX} | T-3-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] whisper-args test stubs — TRANS-03 (CLI flag assembly, language=ru, VAD)
- [ ] whisper-runner-parse test stubs — TRANS-04, TRANS-05 (progress % from stderr, segment streaming from stdout)
- [ ] transcriber service test stubs — TRANS-01, TRANS-06 (utilityProcess fork, cancel/SIGTERM, partial save)
- [ ] model-manager test stubs — TRANS-02 (download, SHA256 verify, delete)
- [ ] transcript-builder test stubs — TRANS-07 (frontmatter + body, timecode toggle re-assembly)
- [ ] integration + packaged smoke test stubs — TRANS-01, TRANS-07

*Wave 0 establishes test stubs for all phase requirements before implementation waves.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Качество русского транскрипта (WER) | TRANS-03 | Требует реального аудио и человеческой оценки осмысленности текста | Прогнать реальный mp4 с русской речью, оценить читаемость и отсутствие галлюцинаций |
| Живой стриминг сегментов в реальном времени | TRANS-04 | Зависит от тайминга subprocess, не детерминируется в unit-тесте | Запустить транскрипцию длинного файла, наблюдать появление сегментов по мере распознавания |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
