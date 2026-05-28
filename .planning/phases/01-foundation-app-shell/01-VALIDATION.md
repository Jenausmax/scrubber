---
phase: 1
slug: foundation-app-shell
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Источник истины — `01-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (ESM-native, совместим с Vite/electron-vite) |
| **Config file** | `vitest.config.ts` (создаётся в Wave 0) |
| **Quick run command** | `npm run test:unit` → `vitest run --reporter=dot` |
| **Full suite command** | `npm run test` → `npm run typecheck && vitest run && npm run build` |
| **Estimated runtime** | quick ~5–10s; full ~60–90s (включая electron-vite build) |

E2E через Playwright Electron отложен — в Phase 1 покрытие unit + integration + ручной smoke на 3 ОС.

---

## Sampling Rate

- **After every task commit:** `npm run test:unit` (quick)
- **After every plan wave:** `npm run test` (full = typecheck + vitest + build)
- **Before `/gsd:verify-work`:** Full suite зелёный + ручной smoke на текущей ОС
- **Max feedback latency:** ~10 секунд для quick

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | Wave 0 | Notes |
|-----|----------|-----------|-------------------|--------|-------|
| SHELL-01 | Окно открывается на win/linux/mac | manual-smoke (3 OS) | `npm run dev` + чек-лист | ❌ W0 | Кросс-OS только вручную в Phase 1 |
| SHELL-02a | `safeStorage` encrypt/decrypt API-ключа | unit | `vitest run src/main/services/secrets-store.test.ts` | ❌ W0 | Мок `electron.safeStorage` |
| SHELL-02b | Ключ переживает рестарт | integration | `vitest run tests/integration/secrets-persist.test.ts` | ❌ W0 | Мок `app.getPath('userData')` на tmpdir |
| SHELL-02c | Renderer не имеет прямого доступа к секрету | unit | `vitest run src/preload/index.test.ts` | ❌ W0 | Снапшот публичного API preload |
| SHELL-03 | Backend === `basic_text` → memory-only + баннер | unit + manual | `vitest run src/main/services/secure-backend.test.ts` + UI smoke | ❌ W0 | Linux-специфика, тест мокает platform |
| D-14 | `sandbox/contextIsolation/nodeIntegration` правильны | unit | `vitest run src/main/window.test.ts` (snapshot webPreferences) | ❌ W0 | Snapshot-тест на BrowserWindow opts |
| D-10 | IPC контракт типизирован | typecheck | `npm run typecheck` | ✓ | Скрипт уже есть в шаблоне |
| D-08/D-09 | preload-allow-list (нет произвольного invoke) | unit | `vitest run src/preload/contract.test.ts` | ❌ W0 | Проверка whitelist каналов |

*Status legend per-task: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — заполняется в PLAN.md.*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — базовая конфигурация (ESM, alias из electron-vite)
- [ ] `tests/setup.ts` — общий setup (mock `electron` модуль)
- [ ] `package.json` scripts: `test:unit`, `test`, `typecheck`
- [ ] Установка: `vitest`, `@vitest/coverage-v8`, `@types/node` (если нет)
- [ ] Тестовые стабы для каждого Req выше (заглушки, помечены `.todo`)
- [ ] Мок-фабрика для `electron.safeStorage` (`isEncryptionAvailable`, `encryptString`, `decryptString`, `getSelectedStorageBackend`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Окно реально открывается на Windows | SHELL-01 | Кросс-OS GUI smoke; CI matrix отложен | `npm run dev` на Win 11 → видно окно с baseline UI |
| Окно реально открывается на Linux | SHELL-01 | То же | `npm run dev` на Ubuntu 22.04 LTS → видно окно |
| Окно реально открывается на macOS | SHELL-01 | То же | `npm run dev` на macOS 14+ → видно окно |
| Linux без gnome-keyring/kwallet — баннер виден | SHELL-03 | UX-валидация; mock покрывает логику, но не UX | Установить на чистый Linux без secret backend → запустить → увидеть предупреждение |
| Ключ переживает рестарт (E2E ручной) | SHELL-02 | Дублирует integration-тест, но проверяет реальный keychain | Ввести ключ → закрыть app → открыть → ключ читается |

---

## Validation Sign-Off

- [ ] Все задачи в PLAN.md имеют `<automated>` verify или Wave 0 dependency
- [ ] Sampling continuity: нет 3 подряд задач без автоматизированной верификации
- [ ] Wave 0 покрывает все MISSING references
- [ ] Нет watch-mode флагов в командах
- [ ] Feedback latency < 10s для quick
- [ ] `nyquist_compliant: true` выставлен в frontmatter после ревью планировщика

**Approval:** pending
