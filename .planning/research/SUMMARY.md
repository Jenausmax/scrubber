# Project Research Summary

**Project:** scrubber
**Domain:** Кросс-платформенное десктоп-приложение для транскрипции видео + LLM-анализ (Electron, русскоязычный фокус)
**Researched:** 2026-05-27
**Confidence:** HIGH

## Executive Summary

scrubber — десктопное приложение для транскрипции видео с последующим LLM-анализом, ориентированное на русскоязычных пользователей. Ближайший аналог — MacWhisper (macOS): файл → офлайн-транскрипция → библиотека промптов → анализ через LLM. Эта product shape доказана рынком. Buzz — лучший кросс-платформенный open-source референс для транскрипционной части. Принципиальные отличия scrubber: кросс-платформенность (Win/Linux/macOS), первоклассная поддержка русского, полностью конфигурируемый LLM-слой с пресетами и кастомными OpenAI-совместимыми endpoint'ами.

Рекомендованный подход: Electron 42 + electron-vite + React 19 + TypeScript, whisper.cpp как **sidecar-бинарник** (не native node addon и не Python), Vercel AI SDK 6 для унифицированного LLM-клиента, встроенный `safeStorage` для API-ключей. Для русского языка по умолчанию модель `large-v3` + VAD + явный `language=ru`. Архитектура: тонкий renderer (UI), тонкий main (оркестратор/секреты/окна), `utilityProcess`-воркеры для тяжёлой работы (ffmpeg, Whisper).

Главные риски хорошо изучены: бинарники попадают внутрь `app.asar` и не запускаются из упакованной сборки; галлюцинации Whisper на длинных/шумных записях; блокировка UI на многоминутных задачах; нотаризация macOS как поздний сюрприз. Важно заложить правильные паттерны (process boundaries, asarUnpack, безопасное хранение ключей) уже в первой фазе — переделывать дорого.

## Key Findings

### Recommended Stack

Стандарт 2025/2026 для нового Electron-проекта: electron-vite (dev/HMR) + electron-builder (упаковка), Electron 42. Локальная транскрипция — whisper.cpp как sidecar-бинарник через `utilityProcess` (единственная реализация с кросс-платформенными бэкендами CPU/Metal/CUDA/Vulkan, без Python-рантайма). LLM-слой — Vercel AI SDK 6 с официальными провайдерами + `@ai-sdk/openai-compatible` для кастомных endpoint'ов (Ollama/LM Studio/сторонние).

**Core technologies:**
- Electron 42 + electron-vite 5 + electron-builder 26 — каркас/сборка/упаковка
- React 19 + TypeScript 5 + Tailwind 4 — UI
- whisper.cpp (sidecar-бинарник) — локальная транскрипция, кросс-платформенно без Python
- Vercel AI SDK 6 + `@ai-sdk/openai-compatible` — единый LLM-клиент для пресетов и кастомных endpoint'ов
- openai SDK 6 (`gpt-4o-transcribe`) — облачная транскрипция
- `safeStorage` (встроенный) — хранение API-ключей; electron-store 11 — несекретные настройки/библиотека промптов
- ffmpeg-static — извлечение аудио

**НЕ использовать:** keytar (заброшен с 2022), smart-whisper (заброшен окт. 2024), faster-whisper (нет Metal, тянет Python), «encryption» electron-store для секретов (вскрываемо).

### Expected Features

**Must have (table stakes):**
- Выбор mp4 (picker + drag&drop) — пользователи ожидают
- Извлечение аудио через ffmpeg — обязательный технический шлюз
- Локальная транскрипция Whisper с выбором модели — ядро ценности
- Облачная транскрипция через API (с guard на лимит 25 МБ) — альтернатива на выбор
- `language=ru` по умолчанию — русскоязычный фокус
- Прогресс + Cancel — обязателен для длинных файлов
- Просмотр транскрипта + сохранение в .md
- Конфигурация LLM (3 пресета + кастомный endpoint) + safeStorage
- Библиотека промптов (CRUD + 2-3 русских стартовых) + single-shot анализ → analysis.md
- Обработка ошибок, кросс-платформенная сборка

**Should have (competitive, v1.x):**
- Русско-тюненая Whisper-модель (WER 6.39 против 9.84 у стокового large-v3) — дифференциатор
- `initial_prompt`/словарные подсказки (+20-30% точности) — дифференциатор
- Переключатель пресета качества; повторный анализ без повторной транскрипции; редактируемый транскрипт

**Defer (v2+):**
- Пакетная обработка/очередь, диаризация спикеров, запись с микрофона, многоходовой чат, видеоплеер, облачная синхронизация

### Architecture Approach

Тонкий renderer (UI) + тонкий main (оркестратор, секреты, окна) + выделенные `utilityProcess`-воркеры для ffmpeg и Whisper (официально рекомендованная замена `child_process.fork` для CPU-тяжёлой/крэш-склонной работы). Renderer командует через `ipcRenderer.invoke` сквозь allow-list preload-мост (`contextIsolation:true`); воркеры шлют прогресс через `postMessage` → main → `webContents.send`. Main владеет авторитетным Job state machine. Провайдеры (транскрипция и LLM) скрыты за интерфейсами по паттерну Strategy + Registry; один `openai-compatible` класс покрывает OpenAI-пресет + кастом + Ollama/LM Studio.

**Major components:**
1. Main process — оркестратор задач, хранение секретов (safeStorage), управление окнами, IPC-хаб
2. Renderer (React) — UI, read-only зеркало состояния задач
3. utilityProcess-воркеры — ffmpeg-экстракция и whisper.cpp-транскрипция (изоляция крэшей, async)
4. TranscriptionProvider (local-whisper / openai-cloud) — единый интерфейс транскрипции
5. LlmProvider (openai-compatible / claude / gemini) — единый интерфейс LLM
6. `shared/ipc-contract.ts` — единственный источник типов IPC

### Critical Pitfalls

1. **Бинарники внутри asar не запускаются** — `asarUnpack`/`extraResources` + правка пути на `app.asar.unpacked`; обязательный smoke-тест **упакованной** сборки (не только dev)
2. **API-ключи в renderer** — все секреты и исходящие API-вызовы только в main с начала; `contextIsolation`/`sandbox` включены. Ретрофит = переархитектура
3. **UI-freeze на длинных задачах** — utilityProcess + async IPC + стриминг прогресса + рабочий Cancel
4. **Whisper галлюцинирует на тишине/шуме и длинном аудио** — VAD-чанкинг ~30с + явный `language=ru` + `initial_prompt`; cloud STT имеет лимит 25 МБ и ~1500с — чанковать или явно отклонять
5. **macOS нотаризация — длинный хвост** — каждый вложенный бинарник (ffmpeg, whisper, .node) должен быть подписан; реальный macOS CI-раннер; нельзя откладывать на релизную неделю. Native .node addon'ы требуют CI-матрицы по всем целевым триплетам

## Implications for Roadmap

Предлагается 7 фаз:

### Phase 1: Foundation & App Shell
**Rationale:** Process boundaries, IPC-контракт и safeStorage-инфраструктура закладываются один раз; переделывать дорого.
**Delivers:** Electron-скелет (electron-vite scaffold), `shared/ipc-contract.ts`, безопасное хранение ключей, базовый UI-каркас.
**Avoids:** Pitfall #2 (ключи в renderer), задаёт contextIsolation/sandbox.

### Phase 2: Media Extraction Pipeline
**Rationale:** Первый технический шлюз; доказывает паттерн asarUnpack для нативных бинарников.
**Delivers:** ffmpeg в utilityProcess, извлечение аудио из mp4, **packaged-build smoke test**.
**Uses:** ffmpeg-static. **Avoids:** Pitfall #1 (asar).

### Phase 3: Local Transcription (Core Value)
**Rationale:** Ядро ценности продукта — офлайн mp4 → transcript.md.
**Delivers:** whisper.cpp sidecar, `TranscriptionProvider` интерфейс, выбор/скачивание модели, прогресс+Cancel, transcript.md. **Milestone: полный офлайн pipeline.**
**Avoids:** Pitfalls #3, #4 (UI-freeze, галлюцинации; VAD + language=ru).

### Phase 4: Cloud Transcription
**Rationale:** Альтернатива на выбор за тем же интерфейсом.
**Delivers:** OpenAI STT за `TranscriptionProvider`, guard на 25 МБ.
**Uses:** openai SDK 6.

### Phase 5: LLM Analysis & Prompt Library
**Rationale:** Вторая половина ценности — анализ транскрипта.
**Delivers:** `LlmProvider` registry, openai-compatible (OpenAI + кастом + Ollama), библиотека промптов (CRUD), single-shot анализ → analysis.md.

### Phase 6: Additional LLM Presets
**Rationale:** Механическое расширение за готовым интерфейсом.
**Delivers:** Claude (Messages API) + Gemini адаптеры.

### Phase 7: Distribution & Cross-Platform
**Rationale:** Кросс-сквозная задача; финализируется последней, но валидируется с Phase 2.
**Delivers:** electron-builder конфиг, per-platform бинарники, macOS подпись+нотаризация, Linux keyring detection.
**Avoids:** Pitfall #5.

### Phase Ordering Rationale

- Phases 1-3 жёстко последовательны (каркас → ffmpeg → транскрипция); core value достигается на Phase 3.
- Provider-интерфейсы (транскрипция в Phase 3, LLM в Phase 5) — высоколевереджные ранние инвестиции, делающие Phases 4 и 6 механическими.
- Phase 7 начинается smoke-тестом ещё в Phase 2 и финализируется последней; macOS-нотаризация — длинный хвост, нельзя откладывать.

### Research Flags

Фазы, вероятно требующие углублённого ресёрча при планировании:
- **Phase 3:** VAD-параметры whisper.cpp для русского (`--vad-threshold`), on-demand model download flow (large-v3 ~3 ГБ в userData)
- **Phase 5:** стратегия обработки длинных транскриптов (context overflow): chunking vs warn-and-truncate vs out-of-scope
- **Phase 7:** конфигурация нотаризации macOS для нескольких вложенных бинарников

Фазы со стандартными паттернами (research-phase можно пропустить):
- **Phase 1:** electron-vite scaffold по шаблону
- **Phase 4:** вызов openai SDK за готовым интерфейсом
- **Phase 6:** механическое добавление адаптеров

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm-версии верифицированы прямыми запросами; паттерны — реальные shipping аналоги |
| Features | HIGH | MacWhisper и Buzz верифицированы; WER по языкам — HuggingFace |
| Architecture | HIGH | Официальная Electron-документация; provider strategy — паттерн из аналогов |
| Pitfalls | HIGH/MEDIUM | asar/signing/ABI — официальные docs; Whisper hallucination — академические исследования |

**Overall confidence:** HIGH

### Gaps to Address

- **VAD-стратегия v1:** whisper.cpp `--vad-threshold` — уточнить эмпирически на реальном русском аудио при реализации Phase 3
- **LLM context overflow v1:** конкретное решение не зафиксировано — решить при планировании Phase 5
- **RU-tuned модель v1.x:** требует faster-whisper/HF-бэкенда — точку расширения заложить в архитектуру Phase 3
- **Linux keyring:** `getSelectedStorageBackend()` + warning UI — небольшая работа в Phase 1/7
- **OpenAI-compatible endpoint quirks:** поведение streaming/SSE/param-tolerance варьируется per-provider — перепроверить под конкретные провайдеры в Phase 5/6

## Sources

### Primary (HIGH confidence)
- Официальная документация Electron (process-model, utility-process, safeStorage, performance)
- npm registry (прямые `npm view` для версий: electron, electron-vite, electron-builder, ai, openai, electron-store)
- Vercel AI SDK 6 официальные доки
- HuggingFace (WER-бенчмарки по языкам, русско-тюненые Whisper-модели)

### Secondary (MEDIUM confidence)
- MacWhisper, Buzz — feature-наборы реальных аналогов
- Community-гайды по бандлингу нативных бинарников в Electron
- VS Code migration issue (отказ от keytar)

### Tertiary (LOW confidence)
- Pisets paper — русско-ориентированная транскрипция (нужна эмпирическая валидация)
- Точечные русские WER-бенчмарки whisper.cpp по квантизациям — мало публичных данных

---
*Research completed: 2026-05-27*
*Ready for roadmap: yes*
