# Phase 2: Media Extraction Pipeline - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Пользователь подаёт mp4 в приложение (file dialog либо drag&drop), приложение через ffmpeg в `utilityProcess` извлекает аудиодорожку в WAV PCM 16 kHz mono s16le и кладёт результат в `app.getPath('userData')/extracted/<hash>.wav`. Поток работает в dev и в **упакованной сборке** на Windows/Linux/macOS (доказан паттерн `asarUnpack`/`extraResources` для бандлинга ffmpeg-static — Pitfall #1 закрыт smoke-тестом).

**In scope:**
- Новый IPC namespace `media.*` в `src/shared/ipc.ts` поверх контракта Phase 1 (Channels, Result-тип).
- File picker (Electron `dialog.showOpenDialog` с фильтром `*.mp4`) + drop-zone на вкладке Transcribe.
- ffprobe-вызов для метаданных (длительность/размер) до старта извлечения.
- ffmpeg-static в `utilityProcess` с `-progress pipe:1` → progress-события в renderer.
- Cancel-кнопка (SIGTERM в utilityProcess), удаление частичного wav.
- Кеш по hash(absolutePath + size + mtime) — повторное извлечение того же файла мгновенное.
- Packaged-build smoke-тест: установить unpacked-сборку, drop тестового mp4, увидеть `.wav` в userData/extracted. Минимум — Windows (host OS); Linux/macOS — ручной чек на доступной машине, фиксируем результат.

**Out of scope (другие фазы / v2):**
- Транскрипция wav → текст (Phase 3).
- LLM-анализ (Phase 4).
- Подпись/нотаризация бинарников ffmpeg в установщике (Phase 5).
- Авто-очистка кеша / кнопка «очистить кеш» в Settings (deferred).
- Форматы кроме mp4 (REQUIREMENTS Out of Scope, v2-расширение).
- Пакетная обработка нескольких файлов (REQUIREMENTS Out of Scope).
- Встроенный плеер / превью видео (REQUIREMENTS Out of Scope).

</domain>

<decisions>
## Implementation Decisions

### Аудио-формат и параметры извлечения
- **D-01:** Извлекаем **сразу под Whisper**: WAV PCM s16le, 16 kHz, mono. Один проход ffmpeg: `-vn -ac 1 -ar 16000 -c:a pcm_s16le`. Phase 3 (whisper.cpp) берёт файл as-is без ресемплинга.
- **D-02** `[informational]`**:** Универсальный/настраиваемый формат отвергнут: REQUIREMENTS §Out of Scope запрещает встроенный плеер и редактирование транскрипта, повторных потребителей аудио в v1 нет.

### UX выбора файла и drop-zone
- **D-03:** Drop-zone живёт на **вкладке Transcribe** (она и так появилась в Phase 1 как placeholder). Phase 3 продолжит UI той же вкладки. Никакого отдельного «Home/Start» экрана.
- **D-04:** File picker: `dialog.showOpenDialog` в main, фильтр `{ name: 'MP4', extensions: ['mp4'] }`, `properties: ['openFile']`. Renderer вызывает через `media.pickFile()`.
- **D-05:** После выбора файла (любым способом) показываем **метаданные** (имя, размер, длительность из ffprobe) и кнопку **«Извлечь аудио»**. Авто-старт отвергнут — даёт точку отмены при ошибочном файле и валидации, что файл читается.
- **D-06:** **Валидация — по расширению `.mp4`**: file dialog уже отфильтрован; для drag&drop renderer проверяет `file.name.toLowerCase().endsWith('.mp4')` и main делает ту же проверку повторно (defence-in-depth). Magic-bytes отвергнуты как оверкилл для v1. Повреждённый/нерабочий mp4 отлавливает ffmpeg на старте — возвращаем `reason: 'ffmpeg_failed'`.
- **D-07:** **Multi-drop отклоняем** с сообщением «Один файл за раз» (соответствует v1 constraint «без пакетной обработки»). Renderer проверяет `event.dataTransfer.files.length === 1` до отправки в main.

### Прогресс, Cancel, UI-state
- **D-08:** Прогресс через **`-progress pipe:1`**: main парсит `out_time_us=` (или `out_time_ms=`) ÷ длительность из ffprobe → шлёт renderer'у `media.progress` event с `{ jobId, percent, etaSec }`. Тот же паттерн будет переиспользован whisper в Phase 3.
- **D-09:** **Cancel-кнопка обязательна.** Renderer вызывает `media.cancel(jobId)` → main шлёт SIGTERM в utilityProcess, удаляет частичный wav, отвечает Result `{ ok: false, reason: 'cancelled' }` на текущий extract-promise.
- **D-10:** **UI не блокируется** во время извлечения. Пользователь может перейти на Settings/Analyze; статус и прогресс показываются в строке в верхней части окна или в самой Transcribe-вкладке при возврате. Один активный job за раз (соответствует v1 «один файл за раз»).

### Хранилище и кеш
- **D-11:** Извлечённый wav пишется в **`app.getPath('userData')/extracted/<hash>.wav`**. Hash = `sha1(absolutePath + ':' + size + ':' + mtimeMs)`. Это переживает рестарт, изолировано от папок пользователя, предсказуемо.
- **D-12:** **Кеш по hash**: перед запуском ffmpeg main проверяет существование `<hash>.wav` валидного размера (>0 байт); если есть — возвращает существующий путь немедленно, без вызова ffmpeg. UI показывает «извлечено» без прогресса.
- **D-13** `[informational]`**:** **Авто-очистка кеша в Phase 2 не делается.** Phase 5 / отдельная backlog-задача добавит кнопку «Очистить кеш извлечённого аудио» в Settings и/или TTL-политику.

### IPC контракт `media.*`
- **D-14:** Новый namespace в `src/shared/ipc.ts`:
  - `media.pickFile()` → `Result<{ path: string } | null>` (null = пользователь отменил dialog).
  - `media.probe(path)` → `Result<{ durationSec: number; sizeBytes: number; name: string }>`.
  - `media.extractAudio(path)` → `Result<{ jobId: string; audioPath: string }>` (resolve когда извлечение завершилось, audioPath = путь к wav).
  - `media.cancel(jobId)` → `Result<void>`.
  - Event-канал `media:progress` → `{ jobId, percent, etaSec }` через `webContents.send` + типизированная подписка в preload (`window.scrubber.media.onProgress(cb)` возвращает unsubscribe-функцию).
- **D-15:** Channels-константы `MEDIA_PICK_FILE`, `MEDIA_PROBE`, `MEDIA_EXTRACT`, `MEDIA_CANCEL`, `MEDIA_PROGRESS` добавляются в `Channels` объект в shared/ipc.ts. Никаких строковых литералов вне shared (паттерн Phase 1).
- **D-16:** Все handler'ы возвращают `Result`-тип, никаких throw через границу IPC. Список reason-кодов: `invalid_argument`, `not_mp4`, `file_not_found`, `ffmpeg_failed`, `cancelled`, `disk_full`, `internal`.

### Process & packaging
- **D-17:** ffmpeg запускается в `utilityProcess.fork()` (а не `child_process.spawn` напрямую). Это паттерн Electron 42 для long-running native subprocess, корректно работает с упакованной сборкой и Linux sandbox.
- **D-18:** ffmpeg-static резолвится через `import ffmpegPath from 'ffmpeg-static'` и патчится для упакованной сборки: `ffmpegPath.replace('app.asar', 'app.asar.unpacked')`. В `electron-builder` config: `asarUnpack: ['node_modules/ffmpeg-static/**']` (Pitfall #1).
- **D-19:** **Smoke-тест упакованной сборки — часть acceptance Phase 2.** Сценарий: `npm run build:unpack` → запустить unpacked exe → drop тестового mp4 → дождаться wav в `userData/extracted/`. Результат логируется в `02-VERIFICATION.md`. Windows — обязательно (host). Linux/macOS — best effort, отметить пропуск явно если нет машины.

### Claude's Discretion
- Конкретный JSX/Tailwind layout Transcribe-вкладки (drop-zone, метаданные, progress) — планировщик/исполнитель. UI-фаза не нужна (MVP-эстетика).
- Выбор ffprobe-источника: либо `@ffprobe-installer/ffprobe` (отдельный пакет per-OS), либо `fluent-ffmpeg.ffprobe`, либо парсинг `ffmpeg -i` stderr. Решает планировщик после короткого ресёрча — фиксируется в RESEARCH.md.
- Конкретная форма progress event subscription helper'а в preload (callback vs Observable) — выбор планировщика, главное чтобы возвращал unsubscribe.
- Имя utility-script файла (`src/main/services/ffmpeg-runner.ts` или похожее) — на усмотрение.
- Стратегия логирования job'ов (in-memory map vs persisted) — не критично для Phase 2, in-memory достаточно.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning или implementing.**

### Project-level
- `.planning/PROJECT.md` — core value, констрейнты приватности (офлайн).
- `.planning/REQUIREMENTS.md` §Media (MEDIA-01..04) и §Out of Scope — точные требования и явные запреты (пакетная обработка, форматы кроме mp4, плеер).
- `.planning/ROADMAP.md` §Phase 2 — goal и success criteria.
- `.planning/phases/01-foundation-app-shell/01-CONTEXT.md` §D-08..D-15 — IPC паттерн (Channels/Result-тип/namespaces), process boundaries, безопасность preload. Mandatory чтение, Phase 2 расширяет этот контракт.
- `.planning/phases/01-foundation-app-shell/01-PATTERNS.md` — паттерны main/preload/renderer; новый код Phase 2 обязан их соблюдать.
- `.planning/phases/01-foundation-app-shell/01-RESEARCH.md` §Pattern 2 (IPC) — типизированный helper, на котором живут `settings.*` handlers; `media.*` идёт по той же схеме.
- `CLAUDE.md` §Technology Stack — ffmpeg-static@5, electron-vite asarUnpack, electron-builder extraResources.
- `CLAUDE.md` §What NOT to Use — системный ffmpeg как обязательная зависимость запрещён, всё бандлим.

### External docs (читать через context7 по мере необходимости)
- electronjs.org/docs/latest/api/utility-process — `utilityProcess.fork`, IPC между main и utility, lifecycle.
- electronjs.org/docs/latest/api/dialog — `showOpenDialog`, filters, properties.
- electron.build / electron-builder config — `asarUnpack`, `extraResources`, `app.asar.unpacked` path-patching для нативных бинарников.
- ffmpeg.org/ffmpeg.html §progress option — формат `-progress pipe:1` (key=value).
- npm `ffmpeg-static` README — корректный путь к бинарнику в production, известная замена `app.asar` → `app.asar.unpacked`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (фундамент Phase 1)
- `src/shared/ipc.ts` — `Channels`, `Result<T>`, `ScrubberApi` (расширяется новым namespace `media`).
- `src/main/ipc/index.ts` — registry `registerIpcHandlers()` уже зарезервировал слот «future: registerMediaHandlers() — Phase 2». Добавляем `registerMediaHandlers()` в `src/main/ipc/media.ts`.
- `src/preload/index.ts` — паттерн namespace-объекта; добавляем `scrubber.media = { pickFile, probe, extractAudio, cancel, onProgress }`.
- `src/renderer/src/routes/Transcribe.tsx` — placeholder, превращается в реальный экран (drop-zone + метаданные + кнопка + прогресс).
- `src/main/services/` — convention для main-сервисов; ffmpeg-runner кладётся туда (`ffmpeg-runner.ts` или `media-extractor.ts`).
- Тестовая инфра Vitest + моки — переиспользуем для main и preload тестов.

### Established Patterns (обязательны к соблюдению)
- Domain-namespaced API: `window.scrubber.media.*`.
- Channels-константы только в `shared/ipc.ts`.
- Result-тип на все мутации; никаких throw через IPC.
- contextIsolation + sandbox в renderer; никаких node-импортов в preload (Pitfall #9 уже сжёг проект — preload рантайм в CJS, см. dist hooks).
- Структурированный console-вывод в main (`[ipc/media]`, `[services/ffmpeg-runner]`).

### Integration Points
- **С Phase 1:** Settings (API-ключи) и SecureBackend существуют независимо; Phase 2 их не трогает.
- **В Phase 3:** whisper-pipeline получает `audioPath` (путь к wav) — контракт `media.extractAudio` сразу заложен под этот вход.
- **В Phase 5:** electron-builder config (asarUnpack для ffmpeg-static) — фактически закладывается уже в Phase 2; Phase 5 расширит его на whisper-бинарник и нотаризует.

### Risks / Pitfalls (известные)
- **Pitfall #1** — бинарник в asar не запускается. Закрывается smoke-тестом упакованной сборки (D-19).
- **Linux drag&drop в Wayland** — известная капризность Electron на Wayland. Если выявится — отступаем на file dialog, drag&drop помечаем как best-effort на Linux. Не блокер.
- **utilityProcess + sandbox** — preload в utility-процессе работает иначе, чем в renderer. См. Pitfall #9 из Phase 1 (preload в CJS); для utilityProcess путь к скрипту разрешается отдельно — планировщик должен проверить в RESEARCH.

</code_context>

<specifics>
## Specific Ideas

- Кнопка извлечения называется **«Извлечь аудио»**, не «Старт» — конкретное действие.
- Метаданные перед запуском: имя файла, размер (МБ), длительность (HH:MM:SS). Эти 3 поля — минимум.
- Прогресс-индикатор: progress bar + `45% · ~12 сек` (percent + ETA). ETA = `(100/percent − 1) · elapsedSec`, обновлять не чаще раза в секунду.
- При cancelled-job сообщение «Извлечение отменено» под drop-zone, кнопка «Извлечь аудио» снова активна.
- При повторном drop того же файла — мгновенный success-state «Аудио уже извлечено», без прогресс-бара (cache hit).
- Все user-facing строки — на русском.

</specifics>

<deferred>
## Deferred Ideas

- **Кнопка «Очистить кеш извлечённого аудио» в Settings** + опционально TTL-политика (например, 30 дней) — backlog после Phase 2.
- **Поддержка форматов кроме mp4 (.mov/.mkv/.webm)** — REQUIREMENTS Out of Scope для v1, потенциальное v2-расширение (тривиально: расширить filter и валидацию).
- **Превью видео / встроенный плеер** — REQUIREMENTS Out of Scope.
- **Пакетная очередь файлов** — REQUIREMENTS Out of Scope.
- **Опции качества аудио (sample rate, bit depth)** — REQUIREMENTS QUAL-* отложено в v2.

</deferred>

---

*Phase: 2-Media Extraction Pipeline*
*Context gathered: 2026-05-30*
