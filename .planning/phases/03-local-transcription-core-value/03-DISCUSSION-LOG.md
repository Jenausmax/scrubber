# Phase 3: Local Transcription (Core Value) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 3-Local Transcription (Core Value)
**Areas discussed:** Формат transcript.md, Сохранение результата, Модели Whisper, Прогресс и язык

---

## Формат transcript.md

| Option | Description | Selected |
|--------|-------------|----------|
| Сплошной текст | Сегменты склеиваются в абзацы, без таймкодов; вход для LLM | |
| Таймкоды по сегментам | [ЧЧ:ММ:СС] в начале каждой строки | |
| Текст + таймкоды (тумблер) | По умолчанию сплошной текст, опция включить таймкоды | ✓ |

**User's choice:** Текст + таймкоды (тумблер)

| Option | Description | Selected |
|--------|-------------|----------|
| YAML-frontmatter + H1 | Блок --- (source, model, language, duration, date) + заголовок | ✓ |
| Только H1-заголовок | Имя файла, без структурированных метаданных | |
| Ничего, только текст | Чистый транскрипт без шапки | |

**User's choice:** YAML-frontmatter + H1

| Option | Description | Selected |
|--------|-------------|----------|
| На вкладке, дефолт ВЫКЛ | Чекбокс рядом с результатом; пересборка из сегментов без re-run | ✓ |
| В Settings (глобально) | Один флаг на всё приложение | |
| Исполнитель решит | На усмотрение планировщика | |

**User's choice:** На вкладке, по умолчанию ВЫКЛ
**Notes:** whisper выдаёт сегменты с таймкодами → переключение применяется к готовому результату без повторного прогона whisper.

---

## Сохранение результата

| Option | Description | Selected |
|--------|-------------|----------|
| Рядом с исходным mp4 | Авто в папку видео; риск read-only | |
| Системный save-dialog | Спрашивать каждый раз | |
| userData + «Сохранить как» | Авто в userData, кнопка экспорта | ✓ |

**User's choice:** userData + «Сохранить как»

| Option | Description | Selected |
|--------|-------------|----------|
| <имя_mp4>.transcript.md | meeting.mp4 → meeting.transcript.md | ✓ |
| <имя_mp4>.md | Короче, но конфликт с analysis.md | |
| Исполнитель решит | На усмотрение | |

**User's choice:** <имя_mp4>.transcript.md

| Option | Description | Selected |
|--------|-------------|----------|
| Показать в окне + кнопки | Текст в окне + «Открыть файл» / «Показать в папке» | ✓ |
| Авто-открыть в редакторе | Открыть .md во внешнем приложении | |
| Только показать в окне | Без кнопок открытия | |

**User's choice:** Показать в окне + кнопки

---

## Модели Whisper

| Option | Description | Selected |
|--------|-------------|----------|
| large-v3 + medium | Два варианта: макс качество + лёгкий | |
| Только large-v3 | Один вариант, всегда ~3 ГБ | |
| small + medium + large-v3 | Три уровня, включая small для слабых машин | ✓ |

**User's choice:** small + medium + large-v3

| Option | Description | Selected |
|--------|-------------|----------|
| large-v3 | Макс качество русского по умолчанию | |
| medium | Быстрее/легче, «достаточно хорошо» | ✓ |

**User's choice:** medium (дефолтная предвыбранная модель)

| Option | Description | Selected |
|--------|-------------|----------|
| Settings + подсказка на вкладке | Управление в Settings + inline-кнопка на вкладке | |
| Только на вкладке | Предложение скачать перед транскрипцией | |
| Только в Settings | Управление в настройках; вкладка блокирует и отсылает | ✓ |

**User's choice:** Только в Settings

| Option | Description | Selected |
|--------|-------------|----------|
| Прогресс + отмена + SHA | Бар + отмена + проверка целостности + повтор | ✓ |
| + докачка (resume) | Всё выше + HTTP Range resume | |
| Простой прогресс + отмена | Без SHA и докачки | |

**User's choice:** Прогресс + отмена + SHA (без resume)

---

## Прогресс и язык

| Option | Description | Selected |
|--------|-------------|----------|
| Progress bar + живой текст | % сверху + сегменты появляются по мере распознавания | ✓ |
| Только progress bar + ETA | Как ffmpeg Phase 2; текст по завершении | |
| Только живой текст | Сегменты + спиннер, без %-бара | |

**User's choice:** Progress bar + живой текст

| Option | Description | Selected |
|--------|-------------|----------|
| ru дефолт + селектор | По умолчанию ru+VAD, выпадающий список ru/auto/частые | ✓ |
| Жёстко ru | language=ru зашит, без выбора | |
| ru дефолт + только auto | Переключатель ru/auto | |

**User's choice:** ru дефолт + селектор

| Option | Description | Selected |
|--------|-------------|----------|
| Предложить сохранить | При Cancel предложить сохранить частичный текст | ✓ |
| Отбросить | Удалить частичный результат (как ffmpeg) | |

**User's choice:** Предложить сохранить частичный текст

---

## Claude's Discretion

- Способ сборки/доставки whisper-cli бинарников per-OS (resources/whisper/<platform>/, extraResources/asarUnpack) — research + plan.
- Точные VAD-параметры whisper.cpp для русского — research.
- Выбор бэкенда CPU vs CUDA/Metal/Vulkan для v1 (вероятно CPU) — research/plan.
- Механика парсинга прогресса whisper.cpp (% и сегменты) — research.
- Внутреннее имя авто-сохранённого .md в userData + хранение сегментов для тумблера.
- Конкретный набор языков в селекторе сверх ru/auto.
- JSX/Tailwind layout вкладки Transcribe (MVP-эстетика).
- Имена utility-скрипта (whisper-runner.cjs) и сервиса (transcriber.ts).

## Deferred Ideas

- Облачная транскрипция (OpenAI/Deepgram) — v2.
- Диаризация говорящих — v2.
- Докачка модели с места обрыва (HTTP Range resume) — улучшение позже.
- Редактирование транскрипта в приложении — REQUIREMENTS Out of Scope.
- GPU-ускорение как опция в Settings — позже.
- Кеш транскриптов по hash(audioPath+model+language) — на усмотрение плана.
