# Phase 3: Local Transcription (Core Value) - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Пользователь получает текстовый `transcript.md` из извлечённого WAV полностью **офлайн** через **whisper.cpp sidecar-бинарник в `utilityProcess`**. Вход — `audioPath` (WAV PCM 16 kHz mono s16le) из `media.extractAudio` (контракт уже заложен в Phase 2 D-01). Поток: выбор/скачивание модели → запуск whisper.cpp в utility-процессе → прогресс + живой стриминг сегментов в renderer → авто-сохранение `transcript.md` в userData с возможностью экспорта. Достигается главный milestone проекта — рабочий офлайн-pipeline `mp4 → transcript.md` без сети.

**In scope:**
- Новый IPC namespace (`transcribe.*` / `whisper.*`) в `src/shared/ipc.ts` поверх контракта Phase 1/2 (Channels, Result-тип, event-канал прогресса).
- whisper.cpp `whisper-cli`-бинарник per-OS в `utilityProcess.fork` (паттерн Phase 2 D-17), вход — WAV из `media.extractAudio`.
- Управление моделями в Settings: список `small` / `medium` / `large-v3`, скачать по запросу (прогресс + отмена + SHA-проверка целостности), удалить. Модели **не бандлятся**, качаются в `app.getPath('userData')`.
- Транскрипция с `language=ru` по умолчанию + VAD; селектор языка (ru / auto / несколько частых).
- Прогресс транскрипции: progress bar с % + живой стриминг распознанных сегментов в окно.
- Cancel (SIGTERM в utility-процесс), при отмене — предложить сохранить частичный распознанный текст.
- Генерация `transcript.md`: YAML-frontmatter + H1 + тело (сплошной текст по умолчанию, тумблер таймкодов), авто-сохранение в userData + «Сохранить как» для экспорта.
- UI на той же вкладке **Transcribe** (Phase 2 D-03), продолжение состояния после извлечения аудио.

**Out of scope (другие фазы / v2):**
- LLM-анализ транскрипта → `analysis.md` (Phase 4).
- Облачная транскрипция (OpenAI/Deepgram) — отложена в v2 (Roadmap), v1 только локальный whisper.cpp.
- Подпись/нотаризация whisper-бинарника в установщике (Phase 5).
- Диаризация (разделение говорящих) — whisper.cpp не даёт из коробки, v2.
- Редактирование транскрипта в приложении (REQUIREMENTS Out of Scope).
- Пакетная обработка нескольких файлов (REQUIREMENTS Out of Scope, v1 — один файл за раз).
- Форматы кроме mp4 на входе (REQUIREMENTS Out of Scope).

</domain>

<decisions>
## Implementation Decisions

### Формат transcript.md (что пользователь читает)
- **D-01:** Тело транскрипта по умолчанию — **сплошной текст**: сегменты whisper склеиваются в абзацы без таймкодов. Это основной режим (чтение + вход для LLM-анализа Phase 4).
- **D-02:** **Тумблер таймкодов** на вкладке Transcribe, **по умолчанию ВЫКЛ**. whisper.cpp всё равно выдаёт сегменты с таймкодами, поэтому переключение применяется к уже готовому результату — **пересборка текста из сохранённых сегментов БЕЗ повторного прогона whisper**. Формат таймкода при включении: `[ЧЧ:ММ:СС]` в начале каждого сегмента.
- **D-03:** Шапка `.md` — **YAML-frontmatter + H1**. Frontmatter-поля (минимум): `source` (имя/путь mp4), `model` (использованная whisper-модель), `language`, `duration`, `date`. H1 — имя исходного файла. Сегменты сохраняются (в памяти/во временном виде), чтобы тумблер таймкодов работал без re-run.

### Сохранение результата
- **D-04:** **Авто-сохранение в `app.getPath('userData')`** (как extracted-кеш Phase 2) сразу по завершении транскрипции. Пользователь не теряет результат. Внутреннее имя файла — на усмотрение исполнителя (hash-based, согласованно с extracted-кешем разумно).
- **D-05:** Кнопка **«Сохранить как»** для экспорта в выбранную папку через системный save-dialog. **Дефолтное имя экспорта: `<имя_mp4>.transcript.md`** (например `meeting.mp4` → `meeting.transcript.md`) — явно читается как транскрипт и не конфликтует с будущим `analysis.md` (Phase 4).
- **D-06:** После сохранения — **текст показывается в окне** (готов как вход для Phase 4) + кнопки **«Открыть файл»** и **«Показать в папке»** (закрывает TRANS-07 «можно открыть»). Авто-открытие в внешнем редакторе отвергнуто — мешает переходу в анализ.

### Модели Whisper
- **D-07:** Предлагаемая линейка — **`small` (~0.5 ГБ) / `medium` (~1.5 ГБ) / `large-v3` (~3 ГБ)**. `large-v3` — максимум качества русского (CLAUDE.md), `small` — для слабых машин/быстрых черновиков. `turbo`/`large-v3-turbo` **исключены** — деградируют на non-English (CLAUDE.md What NOT to Use).
- **D-08:** **Дефолтная предвыбранная модель — `medium`** (баланс качество/скорость/диск, ниже порог входа). `large-v3` доступна явным выбором для макс. качества.
- **D-09:** Управление моделями — **только в Settings** (раздел «Модели»: список с размерами, статус «скачана/нет», кнопки «Скачать» / «Удалить»). На вкладке Transcribe при отсутствии скачанной модели — **транскрипция заблокирована** с понятным сообщением и отсылкой в Settings.
- **D-10:** **Скачивание модели**: progress bar с размером + кнопка Отмена + **проверка целостности через SHA** (из манифеста whisper.cpp/HF) + повтор при ошибке. **Докачка (resume) НЕ требуется** для v1 — при обрыве файл считается невалидным (SHA не сошёлся) и качается заново.

### Прогресс, отмена, язык
- **D-11:** Прогресс транскрипции — **progress bar с % сверху + живой стриминг распознанных сегментов** в окно по мере готовности. Лучший UX для длительного процесса: видно что идёт + результат сразу. Источник % прогресса whisper.cpp — определит research (`--print-progress` / парсинг stderr).
- **D-12:** **UI не блокируется** во время транскрипции (паттерн Phase 2 D-10) — один активный job за раз. Cancel через **SIGTERM** в utility-процесс (паттерн Phase 2 D-09).
- **D-13:** **При отмене — предложить сохранить частичный распознанный текст** (то, что уже на экране при живом стриминге). Отличается от ffmpeg Phase 2 (где частичный wav удалялся): частичный транскрипт имеет ценность для пользователя.
- **D-14:** Язык — **`ru` по умолчанию + VAD** (Roadmap/TRANS-03), плюс **селектор языка** (ru / auto / несколько частых). Точные VAD-параметры для русского — research.

### Claude's Discretion (отдаётся research/планировщику)
- Способ сборки/доставки `whisper-cli`-бинарников per-OS (prebuilt из ggml-org/whisper.cpp релизов → `resources/whisper/<platform>/`, бандлинг через `extraResources`/`asarUnpack`) — research + plan. Аналог паттерна ffmpeg-static Phase 2, но whisper.cpp **не npm-пакет**.
- Точные VAD-параметры whisper.cpp для русского против галлюцинаций — research.
- Выбор бэкенда (CPU vs CUDA/Metal/Vulkan) для v1 — вероятно CPU для кросс-платформенной предсказуемости; финализирует research/plan.
- Механика парсинга прогресса whisper.cpp (% и сегменты) — research.
- Внутреннее имя авто-сохранённого `.md` в userData и стратегия хранения/кеша сегментов для тумблера таймкодов.
- Точный набор языков в селекторе (D-14) сверх ru/auto.
- Конкретный JSX/Tailwind layout вкладки Transcribe (прогресс, стриминг текста, тумблер, кнопки) — MVP-эстетика, отдельная UI-фаза не нужна.
- Имя utility-скрипта (`whisper-runner.cjs` / похоже) и сервис-файла (`src/main/services/transcriber.ts` / похоже).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — core value (`mp4 → transcript.md` обязан работать), констрейнт приватности (локальная транскрипция полностью офлайн), контекст (аудио преимущественно русское — качество критично).
- `.planning/REQUIREMENTS.md` §Transcription (TRANS-01..07) и §Out of Scope — точные требования и явные запреты (редактор транскрипта, пакетная обработка, форматы кроме mp4).
- `.planning/ROADMAP.md` §Phase 3 — goal и 5 success criteria.

### Из прошлых фаз (обязательное чтение — Phase 3 расширяет эти контракты)
- `.planning/phases/02-media-extraction-pipeline/02-CONTEXT.md` — **критично**: D-01 (формат WAV-входа), D-08 (паттерн прогресс-событий), D-09 (Cancel/SIGTERM), D-10 (неблокирующий UI), D-14/D-15 (IPC namespace + Channels), D-17 (`utilityProcess.fork`), D-18 (asarUnpack для нативных бинарников — расширяется на whisper). Phase 3 строится поверх этого один-в-один.
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` — IPC-паттерн (Channels/Result-тип/namespaces), process boundaries, безопасность preload, контракт Settings (раздел «Модели» добавляется туда).
- `CLAUDE.md` §Transcription Engines — whisper.cpp sidecar-паттерн (`whisper-cli` per-OS через utilityProcess), `large-v3` для русского, модели не бандлить (качать в userData), `turbo` исключён для non-English.
- `CLAUDE.md` §What NOT to Use — faster-whisper/smart-whisper/Python-рантайм запрещены; whisper `turbo` для русского запрещён.

### Существующий код (реальные точки интеграции — см. <code_context>)
- `src/shared/ipc.ts` — `Channels`, `Result<T>`, `ScrubberApi`, паттерн `MediaApi`/`MediaProgressEvent` (новый transcribe-namespace зеркалит его).
- `src/main/services/media-extractor.ts` — эталон singleton-сервиса с `utilityProcess.fork`, прогресс-emit, кеш, cancel, reason-маппинг. Transcriber строится по тому же шаблону.
- `src/main/utilities/ffmpeg-runner.ts` + `src/main/utilities/ffmpeg-args.ts` — эталон utility-runner CJS-скрипта; whisper-runner зеркалит.
- `src/main/services/ffmpeg-paths.ts` — резолв бинарника + `app.asar.unpacked` патч; whisper-paths зеркалит для `whisper-cli` + моделей.
- `src/main/services/progress-parser.ts` — паттерн парсинга прогресса subprocess (адаптируется под whisper).
- `src/renderer/src/routes/Transcribe.tsx` + компоненты `DropZone`/`FileMetaCard`/`ExtractProgress`/`ExtractDone`/`InlineError` — продолжение того же экрана.

### External docs (читать через context7 по мере необходимости)
- github.com/ggml-org/whisper.cpp — `whisper-cli` CLI-флаги (`-m`, `-l ru`, VAD, `--print-progress`, вывод сегментов), релизы prebuilt-бинарников per-OS, манифест моделей (ggml-*.bin) и их SHA/URL.
- electronjs.org/docs/latest/api/utility-process — `utilityProcess.fork`, IPC main↔utility, lifecycle (уже использовано в Phase 2).
- electron.build / electron-builder — `extraResources`/`asarUnpack` для бандлинга `whisper-cli` (расширение конфига Phase 2 D-18).
- electronjs.org/docs/latest/api/dialog — `showSaveDialog` для «Сохранить как» (D-05).
- electronjs.org/docs/latest/api/shell — `shell.openPath` / `shell.showItemInFolder` для D-06.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (фундамент Phase 1/2)
- **`src/shared/ipc.ts`** — расширяется новым namespace транскрипции. `MediaApi` (pickFile/probe/extractAudio/cancel/onProgress) + `MediaProgressEvent` — прямой шаблон для `transcribe.*` (start/cancel/onProgress + onSegment для живого стриминга). Channels-константы только здесь.
- **`src/main/services/media-extractor.ts`** — singleton `MediaExtractor` с `init()` (создаёт userData-подпапку, `assertBinaryExists`), `utilityProcess.fork`, in-memory job-map, emitProgress, cancel (SIGTERM + cleanup), reason-маппинг fs-ошибок. Transcriber-сервис строится по этому шаблону почти один-в-один.
- **`src/main/utilities/ffmpeg-runner.ts` + `ffmpeg-args.ts`** — CJS utility-entry + вынесенная сборка аргументов. whisper-runner + whisper-args зеркалят.
- **`src/main/services/ffmpeg-paths.ts`** — резолв пути к бинарнику с `app.asar` → `app.asar.unpacked` патчем (Pitfall #1). whisper-paths делает то же для `whisper-cli` и резолвит путь к модели в userData.
- **`src/main/ipc/media.ts`** (+ `media.test.ts`) — эталон IPC-handler'ов с defense-in-depth валидацией (isAbsolute, probe-before-extract guard, `assertBinaryExists` перед fork — Gap 3 fix). transcribe-handlers зеркалят.
- **`src/main/ipc/index.ts`** — `registerIpcHandlers()` registry; добавляется `registerTranscribeHandlers()`.
- **`src/preload/index.ts`** — namespace-объект `window.scrubber.*`; добавляется `scrubber.transcribe = { start, cancel, onProgress, onSegment, ... }` + методы управления моделями (или через `scrubber.settings`/новый namespace).
- **`src/renderer/src/routes/Transcribe.tsx`** + `ExtractProgress`/`ExtractDone`/`InlineError` — реальный экран продолжается: после extracted-аудио идёт блок транскрипции (прогресс + стриминг + результат + сохранение).
- **`src/main/services/settings-store.ts`** + Settings route — добавляется раздел «Модели» (список/скачать/удалить) и хранение выбора модели/языка/тумблера.
- Тестовая инфра Vitest + RTL + моки — переиспользуется для main/preload/renderer тестов.

### Established Patterns (обязательны к соблюдению)
- Domain-namespaced API: `window.scrubber.<namespace>.*`; Channels-константы только в `shared/ipc.ts`; никаких строковых литералов вне shared.
- Result-тип на все IPC-мутации; никаких throw через границу IPC. Свой набор reason-кодов (по образцу `MediaReason`): добавить `model_missing`, `model_download_failed`, `whisper_failed`, `cancelled`, `internal` и т.п.
- `utilityProcess.fork` для long-running native subprocess (не `child_process.spawn`); preload/utility-скрипт в CJS (Pitfall #9 Phase 1).
- Прогресс через event-канал (`webContents.send` → `ipcRenderer.on`), типизированная подписка в preload возвращает unsubscribe.
- `assertBinaryExists` перед fork → reason `internal`/специфичный (Gap 3 Phase 2) — для whisper-бинарника И для наличия модели.
- contextIsolation + sandbox в renderer; структурированный console-вывод в main (`[ipc/transcribe]`, `[services/transcriber]`).
- Все user-facing строки — на русском.

### Integration Points
- **Вход из Phase 2:** `media.extractAudio` возвращает `audioPath` (WAV 16 kHz mono s16le) — это прямой вход транскрипции. Контракт уже заложен (Phase 2 D-01), ресемплинг не нужен.
- **Выход в Phase 4:** `transcript.md` (и/или текст в окне) — вход LLM-анализа. Поэтому frontmatter + чистый сплошной текст (D-01/D-03) важны для качественного входа в анализ.
- **В Phase 5:** electron-builder config (asarUnpack/extraResources) расширяется на `whisper-cli`-бинарник; модели НЕ бандлятся (качаются в userData), но бинарник подписывается/нотаризуется на macOS.
- **Settings:** раздел «Модели» + сохранение выбора модели/языка живут рядом с существующим Settings-store (Phase 1).

### Risks / Pitfalls (известные)
- **whisper.cpp не npm-пакет** — нет готового `*-static` пакета как у ffmpeg; бинарники нужно брать из релизов ggml-org/whisper.cpp per-OS и класть в `resources/`. Research должен зафиксировать источник и способ.
- **Pitfall #1 (asar)** — whisper-бинарник в asar не запустится; обязателен `asarUnpack`/`extraResources` + packaged smoke-тест (как Phase 2 D-19).
- **Галлюцинации whisper на тишине/русском** — VAD обязателен; параметры — research. Качество русского — ядро ценности, нельзя халтурить с моделью/настройками.
- **Большая загрузка (~3 ГБ large-v3)** — обрывы реальны; SHA-проверка обязательна (D-10).
- **Прогресс whisper.cpp** менее «чистый», чем ffmpeg `-progress` — парсинг % и сегментов нужно проверить в research.

</code_context>

<specifics>
## Specific Ideas

- Тумблер таймкодов **не перезапускает** whisper — текст пересобирается из сохранённых сегментов (D-02). Это и UX, и экономия времени.
- Дефолтное имя экспорта строго `<имя_mp4>.transcript.md` (D-05) — отделяет транскрипт от будущего `analysis.md`.
- При отмене длительной транскрипции пользователю **предлагается сохранить уже распознанное** (D-13) — не теряем минуты работы.
- Дефолтная модель `medium`, а не `large-v3` (D-08) — осознанный выбор «ниже порог входа», large-v3 остаётся для тех, кому нужно макс. качество.
- Управление моделями централизовано в Settings (D-09); вкладка Transcribe лишь блокирует и отсылает туда при отсутствии модели.
- Живой стриминг сегментов в окно во время транскрипции (D-11) — пользователь видит работу в реальном времени, а не «висящий» бар.
- Все user-facing строки — на русском (наследие Phase 2).

</specifics>

<deferred>
## Deferred Ideas

- **Облачная транскрипция (OpenAI gpt-4o-transcribe / Deepgram) как альтернативный режим** — Roadmap отложил в v2; v1 только локальный whisper.cpp.
- **Диаризация (разделение говорящих)** — whisper.cpp не даёт из коробки, кандидат на v2 (ElevenLabs Scribe и пр.).
- **Докачка модели с места обрыва (HTTP Range resume)** — для v1 решено НЕ делать (D-10); кандидат на улучшение при плохих каналах.
- **Редактирование транскрипта в приложении** — REQUIREMENTS Out of Scope (v1 — генерация, не правка).
- **GPU-ускорение (CUDA/Metal/Vulkan) как опция в Settings** — v1 вероятно CPU-only ради предсказуемости; ускорение можно добавить позже.
- **Кеш транскриптов по hash(audioPath+model+language)** — аналог extracted-кеша Phase 2; полезно, но не обязательно для v1, отдать на усмотрение плана.

</deferred>

---

*Phase: 3-Local Transcription (Core Value)*
*Context gathered: 2026-06-08*
