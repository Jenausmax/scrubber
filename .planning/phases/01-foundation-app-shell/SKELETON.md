# Walking Skeleton — scrubber

**Phase:** 1 (Foundation & App Shell)
**Generated:** 2026-05-28

## Capability Proven End-to-End

Пользователь запускает приложение, открывает экран **Settings**, вводит API-ключ OpenAI-совместимого endpoint, нажимает **Save** → ключ шифруется через `safeStorage` и пишется на диск в `secrets.bin`. После перезапуска приложения ключ автоматически расшифровывается в памяти main-процесса, и UI показывает маркер «Ключ сохранён» + кнопку «Заменить» (сам ключ в открытом виде не отображается). Это тончайший срез, который доказывает: окно открывается, renderer изолирован, preload-bridge типизирован, IPC-канал работает, secure storage end-to-end функционален.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Desktop runtime | Electron 42.3.0 | CONTEXT D-02; есть `safeStorage` со всеми backends и `utilityProcess` для будущих фаз |
| Build tooling | electron-vite 5.0.0 + electron-builder 26.8.1 | CONTEXT D-01/D-02; стандарт 2025/2026, отдельные роли (сборка vs упаковка) |
| Scaffold | `npm create @quick-start/electron@latest -- --template react-ts` | CONTEXT D-01; официальный шаблон, не форкаем сторонние |
| Frontend framework | React 19.2.6 | CLAUDE.md; максимум экосистемы и AI-ассиста |
| Styling | Tailwind CSS 4.3.0 (через `@tailwindcss/vite`) | CLAUDE.md; новый engine, без конфига |
| Language | TypeScript 5.9.3 | CLAUDE.md; типобезопасность для IPC main↔renderer критична |
| Module system | ESM (`"type": "module"` в `package.json`) | RESEARCH Pitfall #3; electron-store@11 — ESM-only |
| Process boundaries | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` | CONTEXT D-14; явные значения, не дефолты шаблона |
| IPC pattern | Domain-namespaced (`window.scrubber.<namespace>.*`) с единым shared контрактом в `src/shared/ipc.ts` | CONTEXT D-08/D-09/D-10; одно место для имён каналов, типов request/response |
| Secret storage | Electron `safeStorage` → `secrets.bin` отдельно от `config.json` | CONTEXT D-12/D-13; никакого keytar, никакого electron-store encryptionKey |
| Non-secret settings | `electron-store@11.0.2` (`config.json`) через динамический `await import('electron-store')` | RESEARCH Pitfall #3; ESM-only пакет |
| Linux fallback | Memory-only режим при `secureBackend ∈ {basic_text, unavailable}` + жёлтый warning-баннер | CONTEXT D-07; не блокируем работу пользователя |
| Test framework | Vitest 2.x с моком `electron`-модуля в `tests/setup.ts` | RESEARCH §Validation Architecture; zero-config с Vite, ESM-native |
| Directory layout | `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, `tests/` | RESEARCH §Recommended Project Structure |

## Stack Touched in Phase 1

- [x] Project scaffold — Electron 42 + electron-vite 5 + React 19 + TS 5 + Tailwind 4 из официального шаблона `react-ts` + версии приведены к CLAUDE.md
- [x] Routing — client-side state-router в `App.tsx` (Transcribe / Analyze / Settings), без `react-router`
- [x] Persistent storage — реальный write (`safeStorage.encryptString` → `secrets.bin`) и реальный read (`safeStorage.decryptString` при старте main)
- [x] UI — Settings экран с интерактивной формой сохранения ключа, BackendWarningBanner с динамическим состоянием
- [x] Local full-stack run — `npm run dev` запускает electron-vite + Electron main; smoke-команда `npm run build` для проверки сборки main/preload/renderer

> Развёртывание в облако и кросс-OS CI matrix отложены в Phase 5 (Distribution). В Phase 1 — ручной smoke на трёх ОС.

## Out of Scope (Deferred to Later Slices)

- Извлечение аудио из mp4 через ffmpeg (Phase 2)
- Локальная транскрипция через whisper.cpp (Phase 3)
- LLM-клиент, библиотека промптов, реальный Analyze экран (Phase 4)
- Упаковка, подпись и нотаризация macOS (Phase 5)
- E2E через Playwright Electron (кандидат на Phase 5)
- CI matrix на трёх ОС (минимальный CI — typecheck + build на ubuntu, кросс-OS smoke вручную)
- Window state persistence (размер/позиция/zoom) — отложено
- Системный tray, single-instance lock, auto-update — не v1 / Phase 5
- i18n / переключение языка UI — продукт русскоязычный по дефолту, локализация в v2
- Скелеты будущих preload namespaces (`media.*`, `transcribe.*`, `llm.*`) — каждая фаза вносит свой namespace отдельно (CONTEXT D-09)

## Subsequent Slice Plan

Каждая последующая фаза добавляет один вертикальный срез поверх этого скелета, не меняя архитектурных решений выше:

- **Phase 2 — Media Extraction Pipeline:** добавляет namespace `window.scrubber.media.*`, бандлит `ffmpeg-static` через `asarUnpack`, запускает ffmpeg в `utilityProcess`. UI получает drag&drop + file picker.
- **Phase 3 — Local Transcription (Core Value):** добавляет namespace `window.scrubber.transcribe.*`, sidecar-бинарник `whisper-cli` per-OS, on-demand загрузку моделей в `app.getPath('userData')`, прогресс через `ipcMain.on/webContents.send`. Достигается главная ценность: mp4 → transcript.md офлайн.
- **Phase 4 — LLM Analysis & Prompt Library:** добавляет namespace `window.scrubber.llm.*`, библиотеку промптов через `electron-store` (config.json), интеграцию `@ai-sdk/openai-compatible`. Settings расширяется полями baseURL/model.
- **Phase 5 — Distribution & Cross-Platform:** разворачивает `electron-builder.yml`, NSIS/dmg/AppImage targets, подпись macOS-сборки и нотаризацию всех вложенных бинарников.
