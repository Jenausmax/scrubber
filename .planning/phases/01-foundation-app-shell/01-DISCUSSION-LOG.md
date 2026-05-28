# Phase 1: Foundation & App Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 1-Foundation & App Shell
**Areas discussed:** Объём базового UI, Поведение при недоступном safeStorage, Стартовая точка проекта, Форма IPC-контракта, Settings storage layout

---

## Объём базового UI

| Option | Description | Selected |
|--------|-------------|----------|
| Пустое окно с заголовком | Окно + тайтл + версия, без интерактива | |
| Скелет навигации + рабочий Settings | Layout под будущие экраны + полностью рабочий Settings с end-to-end safeStorage flow | ✓ |
| Только Settings экран | Один функциональный экран без навигации | |

**User's choice:** Скелет навигации + рабочий Settings (рекомендуется)
**Notes:** Цель — реально валидировать SHELL-02 (safeStorage round-trip) уже в фазе 1, а не просто доказать «окно открылось».

---

## Навигация (sub-question)

| Option | Description | Selected |
|--------|-------------|----------|
| Transcribe / Analyze / Settings | Три верхнеуровневых раздела по стадиям конвейера | ✓ |
| Files (одноэкранный workflow) / Settings | Один главный экран, всё подряд | |
| Home (история) / Transcribe / Settings | Экран истории прошлых файлов | |

**User's choice:** Transcribe / Analyze / Settings
**Notes:** Совпадает с естественными стадиями pipeline и фазами роадмапа. История файлов — v2.

---

## Поведение при недоступном safeStorage

| Option | Description | Selected |
|--------|-------------|----------|
| Блокировать сохранение ключа | Поле disabled, инструкция установить keyring | |
| Memory-only на сессию | Ключ в RAM до выхода + жёлтый баннер, без записи на диск | ✓ |
| Сохранить plaintext с красным баннером | Ключ в открытом виде + предупреждение | |

**User's choice:** Memory-only на сессию
**Notes:** Не блокирует юзера, не врёт про безопасность (никакого plaintext). Баннер именно жёлтый (warning), не красный.

---

## Стартовая точка проекта

| Option | Description | Selected |
|--------|-------------|----------|
| npm create @quick-start/electron (react-ts) | Официальный шаблон electron-vite + electron-builder + Tailwind v4 + React 19 | ✓ |
| Ручная настройка electron-vite с нуля | Полный контроль ценой времени и риска нюансов | |
| Форк референса (OpenWhispr/AutoTitles) | Готовый whisper.cpp + ffmpeg сетап чужого проекта | |

**User's choice:** npm create @quick-start/electron (react-ts)
**Notes:** Минимизирует риск отстать от best practices. Версии после генерации привести к зафиксированным в CLAUDE.md.

---

## Форма IPC-контракта

| Option | Description | Selected |
|--------|-------------|----------|
| Domain-namespaced API + shared TS-типы | `window.scrubber.settings.*` / `.media.*` / `.transcribe.*` / `.llm.*` | ✓ |
| Плоский allow-list поверх ipcRenderer.invoke | Один `window.api.{...}` объект | |
| electron-trpc / tRPC-like RPC | Zod-схемы, подписки, полный RPC слой | |

**User's choice:** Domain-namespaced API с shared TS-типами
**Notes:** В фазе 1 реально реализован только namespace `settings.*`. Остальные namespaces создаются в своих фазах — preload не объявляет пустые скелеты заранее, чтобы allow-list оставался честным.

---

## Settings storage layout

| Option | Description | Selected |
|--------|-------------|----------|
| Два раздельных файла | `config.json` (electron-store) для несекретного + `secrets.bin` для safeStorage-зашифрованного | ✓ |
| Один electron-store с base64-блобами | Всё в одном JSON, шифрованные поля рядом с обычными | |

**User's choice:** Два раздельных файла
**Notes:** Чёткое физическое разделение безопасного и небезопасного хранилища. electron-store «encryption» сознательно не используется (взламываемо).

---

## Claude's Discretion

- Конкретный layout Settings экрана (Tailwind defaults достаточно — UI-фазы для каркаса нет).
- Точная сигнатура IPC helper'а (Result-обёртка vs throws, naming) — выбор планировщика.
- Window state persistence — можно в Phase 1, можно отложить.
- Логирование — минимально структурированный вывод в main.

## Deferred Ideas

- Persistence окна (размер/позиция/zoom) — низкий приоритет, любая фаза.
- System tray / single-instance lock — не требование v1.
- i18n переключение языка UI — v2.
- Auto-update — Phase 5 (Distribution).
- История файлов / Home-экран — v2 (не в текущем роадмапе).
