<!-- GSD:project-start source:PROJECT.md -->
## Project

**scrubber**

Кросс-платформенное десктоп-приложение (Windows, Linux, macOS) на Electron, которое берёт mp4-видеофайл, извлекает из него аудиодорожку и транскрибирует её в текст. Транскрипт сохраняется в `.md`-файл. После этого пользователь может отправить полученный текст в настраиваемую нейросетевую API (LLM) вместе с выбранным системным промптом, чтобы суммаризировать или проанализировать содержимое, посмотреть результат и сохранить его отдельным `.md`-файлом. Для себя и подобных пользователей, кому нужно быстро превращать видео в анализируемый текст.

**Core Value:** Превратить mp4-видео в качественный текстовый транскрипт (`.md`) — это обязано работать, даже если всё остальное отвалится.

### Constraints

- **Tech stack**: Electron (кросс-платформенный десктоп) — выбор пользователя; JS/TS экосистема.
- **Compatibility**: должно собираться и работать на Windows, Linux и macOS.
- **Privacy**: локальный режим транскрипции должен работать полностью офлайн, без отправки данных вовне.
- **Dependencies**: ffmpeg для извлечения аудио; локальная Whisper-реализация (whisper.cpp / faster-whisper или аналог — определит ресёрч).
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Electron | 42.x (`electron@42.3.0`) | Desktop runtime | Заданное ограничение проекта. Бери последний стабильный major (релизный цикл — каждые 8 недель, поддерживаются 3 последних major). На 42.x встроены `safeStorage`, `utilityProcess` — оба нужны нам. |
| electron-vite | 5.x (`electron-vite@5.0.0`) | Dev/build тулинг (HMR, бандлинг main/preload/renderer) | Стандарт 2025/2026 для новых Electron-проектов. Vite-скорость и HMR для renderer + отдельная сборка main/preload из коробки. Не пакует приложение сам — отдаёт это electron-builder (рекомендованный официальными шаблонами). |
| electron-builder | 26.x (`electron-builder@26.8.1`) | Упаковка и дистрибутив (NSIS/MSI, dmg, AppImage/deb) | Де-факто стандарт для кросс-платформенной упаковки. Глубокий контроль над тем, какие нативные бинарники (ffmpeg, whisper) попадают в сборку через `extraResources` и `files` макросы. Шаблоны electron-vite уже настроены под него. |
| TypeScript | 5.x | Язык | Норма для всей экосистемы Electron/Vite; типобезопасность критична для IPC main↔renderer. |
| React | 19.x | Frontend framework | Самый частый выбор в шиппящихся Whisper/Electron-приложениях (OpenWhispr, AutoTitles). Максимум готовых UI-компонентов (shadcn/ui), наём/AI-ассист лучше всего. Vue/Svelte допустимы (см. альтернативы), но React — путь наименьшего сопротивления. |
| Tailwind CSS | 4.x | Стилизация | Стандарт-связка с React в современных Electron-приложениях; v4 — новый движок, без `tailwind.config.js` для базовых кейсов. |
### Transcription Engines
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| whisper.cpp (sidecar бинарник) | ggml-org/whisper.cpp, последний релиз | Локальная транскрипция (офлайн-режим) | Единственная реализация Whisper, которая кросс-платформенно работает на CPU/Metal/CUDA/Vulkan — а нам нужны Win/Linux/macOS. Один и тот же WER, что у faster-whisper (одинаковые веса), но faster-whisper без Metal и тянет Python/CTranslate2 — неприемлемо для Electron-бандла. **Рекомендуемый паттерн: бандлить заранее собранный CLI-бинарник `whisper-cli` per-OS и вызывать через `utilityProcess`/`child_process`, а не через native node-биндинги.** |
| OpenAI `gpt-4o-transcribe` / Whisper API | через `openai` SDK 6.x | Облачная транскрипция (режим по выбору) | Дефолтный пресет облака. `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` (март 2025) дают WER ниже классического `whisper-1`. Один и тот же ключ может переиспользоваться для LLM-анализа, если юзер на OpenAI. |
| Deepgram Nova-3 | через REST/`@deepgram/sdk` | Альтернативный облачный пресет (опционально) | Дешевле и быстрее для батча ($0.0043/мин), мультиязычный. Опционально как второй пресет; не обязателен для v1. |
### LLM Client
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Vercel AI SDK | 6.x (`ai@6.0.191`) | Унифицированный LLM-клиент | Один API (`generateText`/`streamText`) поверх всех провайдеров — ровно под требование «пресеты + кастомный endpoint». Стриминг ответа в окно из коробки. |
| `@ai-sdk/openai` | 3.x (`@ai-sdk/openai@3.0.65`) | Пресет OpenAI | Официальный провайдер. |
| `@ai-sdk/anthropic` | 3.x (`@ai-sdk/anthropic@3.0.80`) | Пресет Claude | Официальный провайдер. |
| `@ai-sdk/google` | 3.x (`@ai-sdk/google@3.0.80`) | Пресет Gemini | Официальный провайдер. |
| `@ai-sdk/openai-compatible` | 2.x (`@ai-sdk/openai-compatible@2.0.48`) | Кастомный endpoint (Ollama, LM Studio, сторонние) | **Ключевой кусок.** `createOpenAICompatible({ baseURL, apiKey })` закрывает требование «кастомный OpenAI-совместимый endpoint URL+key+model» — этим же путём подключаются локальные LLM (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`). |
### Secure Storage & Persistence
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Electron `safeStorage` (встроено) | в составе Electron 42 | Шифрование API-ключей | Использует системный keychain (macOS Keychain / Windows DPAPI / Linux libsecret-kwallet), без нативной зависимости. VS Code и др. ушли с keytar на него. Keytar не поддерживается с дек. 2022 — не использовать. |
| electron-store | 11.x (`electron-store@11.0.2`) | Настройки, библиотека промптов, выбор провайдера/модели | Простой JSON-стор для непаролей (пресеты, имена промптов, путь к модели). Шифрованные ключи храним отдельно: `safeStorage.encryptString` → base64 → в этот же стор или отдельный файл. |
## Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ffmpeg-static | 5.x (`ffmpeg-static@5.3.0`) | Бинарник ffmpeg per-OS | Извлечение аудио из mp4. Отдаёт путь к бинарнику; в упакованном приложении путь надо чинить (`.replace('app.asar','app.asar.unpacked')`) и распаковывать через `asarUnpack`. |
| fluent-ffmpeg | 2.x (`fluent-ffmpeg@2.1.3`) | Удобная обёртка над ffmpeg CLI | Опционально. Декларативно задать «извлечь WAV 16kHz mono» (формат, который ждёт Whisper). Можно обойтись прямым вызовом `child_process` — обёртка нетривиально поддерживается, но всё ещё рабочая. |
| openai | 6.x (`openai@6.39.0`) | Облачная транскрипция (Whisper/gpt-4o-transcribe) | Для STT-вызова к OpenAI (`audio.transcriptions`). AI SDK ориентирован на текст/чат — для аудио-транскрипции бери официальный `openai` SDK. |
| electron-vite шаблон (react-ts) | через `npm create @quick-start/electron` | Скелет проекта | Стартовая точка с настроенными main/preload/renderer + electron-builder. |
## Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| electron-vite | dev-сервер + сборка | `electron-vite dev` для HMR; `electron-vite build` перед упаковкой. |
| electron-builder | упаковка | Цели: Win — NSIS; macOS — dmg (нужна подпись + нотаризация для распространения); Linux — AppImage + deb. Нативные бинарники → `extraResources`/`asarUnpack`. |
| @electron/rebuild | пересборка нативных модулей | Нужен ТОЛЬКО если возьмёшь native node-биндинги (smart-whisper) или better-sqlite3 под ABI Electron. При sidecar-подходе к whisper не требуется. |
## Installation
# Скелет (интерактивно выбрать react-ts)
# Core (уже частично в шаблоне)
# LLM-клиент
# Облачная транскрипция
# ffmpeg
# Dev
# (Tailwind v4 + React 19 идут из шаблона react-ts)
# whisper.cpp — НЕ npm-пакет. Скачать/собрать whisper-cli бинарники per-OS
# и положить в resources/whisper/<platform>/ (см. ARCHITECTURE.md / PITFALLS.md)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| whisper.cpp как sidecar-бинарник | smart-whisper (native node-биндинг) | Если очень нужны in-process биндинги с авто-выгрузкой модели. **Минус: пакет не обновлялся с окт. 2024, требует @electron/rebuild под ABI Electron — хрупко при апгрейдах Electron.** Sidecar надёжнее для кросс-платформы. |
| whisper.cpp как sidecar-бинарник | nodejs-whisper (npm, активен, апр. 2026) | Удобнее в dev (сам клонирует/собирает whisper.cpp), но компиляция из исходников в момент установки/рантайма плохо ложится на упакованное приложение. Годится для прототипа, не для дистрибутива. |
| whisper.cpp | faster-whisper (CTranslate2) | Если таргет только Win/Linux с NVIDIA GPU и не жалко тащить Python-рантайм. Нет Metal (macOS медленный), тяжёлый бандл — не для нашей кросс-платформы. |
| electron-vite + electron-builder | Electron Forge (+ Vite plugin) | Если хочется «всё-в-одном» (сборка+упаковка+publish) одним инструментом и официальной поддержки Electron-команды. Полностью валидный выбор; мы берём electron-vite за лучший renderer-DX и гибкость electron-builder для нативных бинарников. |
| React 19 | Vue 3 / Svelte 5 | Если у Max уже есть предпочтение. Технически эквивалентны; React выбран за плотность экосистемы и AI-ассист. SolidJS — если важна максимальная производительность UI (не наш случай). |
| AI SDK `@ai-sdk/openai-compatible` | Голый `openai` SDK с `baseURL` для всего | Если хочется минимум зависимостей и один клиент. Минус — нет единого абстрактного слоя над Anthropic/Gemini (у них своя схема), придётся руками. AI SDK даёт единый интерфейс под все пресеты. |
| OpenAI `gpt-4o-transcribe` | ElevenLabs Scribe v2 | Если нужна топовая мультиязычная точность + диаризация и готов платить. Хороший кандидат на доп. пресет позже. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| keytar / node-keytar | Не поддерживается с дек. 2022; нативная компиляция, ломается на апгрейдах | Electron `safeStorage` (встроено) |
| electron-store «encryption» для секретов | Ключ шифрования лежит в коде/предсказуем — легко вскрывается (документированный взлом) | `safeStorage` для ключей; electron-store только для несекретных настроек |
| faster-whisper в Electron-бандле | Python + CTranslate2, нет Metal, огромный кросс-платформенный бандл | whisper.cpp sidecar |
| smart-whisper как основа | Заброшен с окт. 2024, хрупкая native-сборка под ABI Electron | whisper.cpp sidecar (utilityProcess) |
| Whisper `turbo`/`large-v3-turbo` для русского | Turbo заметно деградирует на non-English; русский — основной язык проекта | `large-v3` (или `medium` как лёгкий компромисс) |
| Системный ffmpeg как обязательная зависимость | Нарушает «работает офлайн из коробки»; у юзера может не быть ffmpeg | Бандлить `ffmpeg-static` per-OS |
| Хранить транскрипт/анализ только в памяти | Core value — надёжный `.md` на диске | Писать `.md` сразу через `fs` из main-процесса |
## Stack Patterns by Variant
- whisper.cpp **sidecar-бинарник** + `utilityProcess`
- Модели Whisper НЕ бандлить — скачивать по запросу пользователя в `app.getPath('userData')` (large-v3 ~3 ГБ)
- Никаких native node-модулей → не нужен @electron/rebuild → апгрейд Electron безболезненный
- Можно перейти на native-биндинг, но заложить @electron/rebuild в CI и зафиксировать версию Electron
- Облачный режим: `openai` SDK для `gpt-4o-transcribe`, тот же провайдер можно переиспользовать для LLM-анализа
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| electron@42 | electron-vite@5, electron-builder@26 | Проверенная актуальная связка для новых проектов. |
| ai@6 | @ai-sdk/*@3 (openai/anthropic/google), @ai-sdk/openai-compatible@2 | AI SDK 6 — текущий latest. Все провайдеры на «V2 specification». Внимание: миграция v4→v5→v6 ломающая — начинай сразу на 6, не на старых гайдах. |
| ffmpeg-static@5 | electron-builder asarUnpack | Бинарник внутри asar не исполняется — обязателен `asarUnpack`/`extraResources` + правка пути `app.asar.unpacked`. |
| safeStorage (Linux) | gnome-libsecret / kwallet | Если secret store недоступен — `getSelectedStorageBackend()` вернёт `basic_text` (ключи фактически в открытом виде). Проверять и предупреждать пользователя. |
| openai@6 | Node 18+/Electron main | STT-вызовы делать из main-процесса (ключи не утекают в renderer). |
## Sources
- npm registry (прямой `npm view`) — точные актуальные версии: ai@6.0.191, @ai-sdk/openai@3.0.65, @ai-sdk/anthropic@3.0.80, @ai-sdk/google@3.0.80, @ai-sdk/openai-compatible@2.0.48, electron@42.3.0, electron-vite@5.0.0, electron-builder@26.8.1, @electron-forge/cli@7.11.2, ffmpeg-static@5.3.0, fluent-ffmpeg@2.1.3, openai@6.39.0, electron-store@11.0.2, smart-whisper@0.8.1 (modified 2024-10-02 — заброшен), nodejs-whisper@0.3.0 (modified 2026-04-11 — активен) — HIGH
- electron-vite.org / electron-vite FAQ (Electron Forge) — тулинг и связка с electron-builder — HIGH
- releases.electronjs.org / endoflife.date — релизный цикл и поддержка major-версий — HIGH
- github.com/ggml-org/whisper.cpp — кросс-платформенные бэкенды (CPU/Metal/CUDA/Vulkan) — HIGH
- github.com/ismaelcompsci/AutoTitles, OpenWhispr (HeroTools/open-whispr) — реальные шиппящиеся Electron+whisper.cpp стеки (React/TS/Tailwind/electron-vite/electron-builder) — MEDIUM
- electronjs.org/docs/latest/api/safe-storage + Freek van der Herten (keytar→safeStorage) + blog.jse.li (взлом electron-store encryption) — секретное хранилище — HIGH
- ai-sdk.dev / vercel.com/blog/ai-sdk-5 + ai-sdk-6 + Ollama OpenAI-compatibility docs — LLM-клиент и кастомные endpoint'ы — HIGH
- promptquorum.com (whisper.cpp vs faster-whisper 2026), novascribe.ai (Whisper WER by language) — одинаковый WER движков, large-v3 для non-English, VAD против галлюцинаций — MEDIUM
- deepgram.com / elevenlabs.io / OpenAI gpt-4o-transcribe анонс — облачные STT-опции и цены — MEDIUM
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
