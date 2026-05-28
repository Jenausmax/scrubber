# Phase 1: Foundation & App Shell - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Запускаемый Electron-каркас на Windows/Linux/macOS с безопасными границами процессов (contextIsolation + sandbox + preload allow-list), единым типизированным IPC-контрактом, хранением секретов через `safeStorage` и базовым UI с навигацией и рабочим экраном Settings, который end-to-end проверяет цикл сохранения/восстановления API-ключа.

**In scope:**
- Electron 42 + electron-vite 5 + electron-builder 26 + React 19 + Tailwind 4 + TypeScript skeleton, поднятый из официального шаблона.
- main / preload / renderer разделение, contextIsolation: true, sandbox: true.
- Domain-namespaced preload API (`window.scrubber.settings.*`) и shared TS-типы.
- `safeStorage`-сервис в main с детектом backend и fallback memory-only.
- UI shell: окно + навигация (Transcribe / Analyze / Settings), Transcribe и Analyze — заглушки; Settings — рабочий.
- Хранилище: `electron-store` для несекретного config + отдельный `secrets.bin` для зашифрованных ключей.

**Out of scope (другие фазы):**
- ffmpeg-извлечение аудио (Phase 2)
- whisper.cpp (Phase 3)
- LLM-клиент, библиотека промптов, реальный UI Analyze (Phase 4)
- Упаковка/подпись/нотаризация (Phase 5)

</domain>

<decisions>
## Implementation Decisions

### Project Scaffold
- **D-01:** Стартуем через `npm create @quick-start/electron@latest` с шаблоном **react-ts**. Не настраиваем electron-vite вручную и не форкаем сторонние проекты — это минимизирует риск отстать от официальных best practices и сразу даёт настроенный electron-builder.
- **D-02:** Версии стека фиксируем из CLAUDE.md `Technology Stack`: electron@42, electron-vite@5, electron-builder@26, React@19, Tailwind@4. После генерации шаблона привести зависимости к этим версиям, если шаблон отстал.

### UI Scope (Phase 1)
- **D-03:** Базовый UI = **скелет навигации с тремя верхнеуровневыми разделами + рабочий Settings**. Это даёт реальный end-to-end safeStorage flow (SHELL-02), а не просто «окно открылось».
- **D-04:** Разделы навигации: **Transcribe / Analyze / Settings**. Transcribe и Analyze — заглушки с понятным «coming in Phase N»; Settings полностью функционален.
- **D-05:** Settings включает: поле ввода API-ключа (`OpenAI-compatible`), кнопка Save, визуальный фидбек «ключ сохранён», после перезапуска приложения ключ автоматически подтягивается и UI показывает его как «сохранён» (не отображаем сам ключ в открытом виде — только маркер наличия + кнопка «Replace»).

### safeStorage Behaviour
- **D-06:** При старте приложения main вызывает `safeStorage.isEncryptionAvailable()` и `safeStorage.getSelectedStorageBackend()`. Результат пробрасывается в renderer одним полем `secureBackend: 'keychain' | 'dpapi' | 'libsecret' | 'kwallet' | 'basic_text' | 'unavailable'`.
- **D-07:** Если backend === `basic_text` или encryption недоступно → переходим в **memory-only режим на текущую сессию**:
  - Ключ принимается, шифруется (если есть хоть какой-то safeStorage) или хранится в памяти main-процесса до выхода.
  - На диск секреты НЕ пишутся.
  - В Settings и поверх главного окна показываем **жёлтый баннер**: «Системное защищённое хранилище недоступно. Ключ не сохранится между запусками. На Linux установите `gnome-keyring` или `kwallet`.»
  - Не блокируем работу пользователя, не врём про безопасность (никаких plaintext-файлов с красным баннером — это явно отклонено).

### IPC Contract
- **D-08:** Используем **domain-namespaced API** с shared TS-типами. Никакого electron-trpc/zod в фазе 1 — лишняя абстракция.
- **D-09:** Структура: `window.scrubber.settings.*` в фазе 1; namespaces `.media.*`, `.transcribe.*`, `.llm.*` зарезервированы и появятся в своих фазах. Это значит preload экспортирует объект с явно перечисленными namespaces, а не один плоский allow-list.
- **D-10:** Shared-папка (например `src/shared/ipc.ts` или `packages/shared/`) содержит типы вида `{ channel: string, request: T, response: R }`. Main регистрирует хендлеры через типизированный helper, preload оборачивает `ipcRenderer.invoke` в типизированные функции, renderer вызывает их через `window.scrubber.<namespace>.<method>(args)`. Конкретная форма helper'а — на усмотрение планировщика, но контракт «один channel — один request/response тип» обязателен.
- **D-11:** В фазе 1 реально реализованы только методы settings-namespace: `settings.saveApiKey(key)`, `settings.hasApiKey()`, `settings.clearApiKey()`, `settings.getSecureBackend()`. Скелеты остальных namespace в preload — НЕ создаём (создаст соответствующая фаза). Это держит явный allow-list честным.

### Settings Storage Layout
- **D-12:** **Два раздельных файла** в `app.getPath('userData')`:
  - `config.json` через `electron-store` — несекретное (выбранная модель, baseURL без ключа, язык UI, последние выбранные опции и т.д.). В Phase 1 содержит как минимум `secureBackend` last-known + UI prefs (если такие появятся).
  - `secrets.bin` — сырой бинарный вывод `safeStorage.encryptString(...)` (или JSON {field: base64(encrypted)} если ключей несколько). Управляется отдельным модулем в main.
- **D-13:** electron-store **не используем** для шифрованных значений. Никаких «encryption» опций electron-store — они задокументировано взламываются (см. CLAUDE.md `What NOT to Use`).

### Process Boundaries
- **D-14:** BrowserWindow создаётся с `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. preload — единственный мост renderer↔main.
- **D-15:** Никакой Node API в renderer. Никаких `remote` модулей (давно deprecated в любом случае).

### Claude's Discretion
- Конкретный layout Settings экрана (выравнивание, типографика) — на усмотрение реализатора в рамках Tailwind v4 defaults; UI-фаза для каркаса не нужна, MVP-эстетика.
- Точная сигнатура IPC helper'а (Result-обёртка vs throws, naming) — выбор планировщика, главное чтобы контракт «channel → request/response типы из shared» соблюдался.
- Window state persistence (размер/позиция) — можно сделать в фазе 1 через `electron-store`, можно отложить; решает планировщик исходя из объёма.
- Стратегия логирования (console + файл / только console) — не критично для фазы 1; минимум — структурированный вывод в main.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — общая цель проекта и core value.
- `.planning/REQUIREMENTS.md` §App Shell — SHELL-01, SHELL-02, SHELL-03 (точные формулировки требований).
- `.planning/ROADMAP.md` §Phase 1 — goal, success criteria.
- `CLAUDE.md` §Technology Stack — версии и обоснование (Electron 42, electron-vite 5, electron-builder 26, React 19, Tailwind 4, safeStorage, electron-store 11).
- `CLAUDE.md` §What NOT to Use — keytar, encrypted electron-store для секретов — запрещены.

### External docs (читать через context7/web по мере необходимости)
- electronjs.org/docs/latest/api/safe-storage — API safeStorage, backend detection, особенности Linux.
- electron-vite.org — структура шаблона react-ts, конфигурация main/preload/renderer, интеграция с electron-builder.
- electronjs.org/docs/latest/tutorial/context-isolation — обязательные настройки contextIsolation + sandbox.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Кода ещё нет — это первая фаза. Скелет придёт из официального шаблона `@quick-start/electron react-ts`.

### Established Patterns
- Паттерны установятся в этой фазе и станут эталоном для последующих:
  - Domain-namespaced preload API (`window.scrubber.<namespace>.*`).
  - Shared TS-типы для IPC контракта.
  - safeStorage сервис в main как единая точка работы с секретами.
  - electron-store как единая точка работы с несекретными настройками.

### Integration Points
- Phase 2 расширит preload новым namespace `media.*` и подключит ffmpeg в utilityProcess — каркас должен это позволять без переписывания.
- Phase 3 добавит `transcribe.*` namespace и whisper-sidecar — та же модель.
- Phase 4 добавит `llm.*` namespace; `settings.*` уже хранит API-ключ и URL/модель.

</code_context>

<specifics>
## Specific Ideas

- Жёлтый баннер (warning), не красный (error), для случая недоступного keyring — пользователь должен понимать, что это деградация, а не блокировка.
- В Settings после сохранения ключа НЕ показывать сам ключ в открытом виде — только маркер «сохранён» + кнопка «Заменить» (replace flow). Это снижает риск засветить ключ через скриншот.
- Все user-facing строки в Settings и баннере — на русском (язык продукта).

</specifics>

<deferred>
## Deferred Ideas

- **Persistence window state (размер/позиция/zoom)** — может попасть в Phase 1, если объём позволит, иначе тривиальное улучшение в любой последующей фазе.
- **Системный tray / single-instance lock** — не обсуждалось как требование, не входит в v1; добавим если возникнет.
- **i18n / переключение языка UI** — продукт сейчас русскоязычный по дефолту, отдельной фазы локализации в v1 нет; зафиксируем в backlog как v2.
- **Auto-update** — относится к Phase 5 (Distribution), не сюда.

</deferred>

---

*Phase: 1-Foundation & App Shell*
*Context gathered: 2026-05-28*
