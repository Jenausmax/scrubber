# Phase 3: Local Transcription (Core Value) - Research

**Researched:** 2026-06-09
**Domain:** Локальная офлайн-транскрипция через whisper.cpp sidecar-бинарник в Electron utilityProcess
**Confidence:** HIGH (CLI-флаги, модели/SHA, доставка бинарников — verified; VAD-параметры для русского — MEDIUM)

## Summary

Phase 3 — это почти один-в-один структурное зеркало Phase 2 (media-extraction), но с whisper.cpp вместо ffmpeg. Архитектура уже доказана: `utilityProcess.fork(*.cjs)` → `child_process.spawn(binary)` → парсинг вывода → progress-event в renderer → Result через IPC. Все паттерны (singleton-сервис, reason-маппинг, `assertBinaryExists` перед fork, `app.asar.unpacked`-патч, CJS-utility-bundle через esbuild) переиспользуются. Новизна Phase 3 в трёх местах: (1) **доставка whisper-бинарника** — он НЕ npm-пакет, нет `*-static` аналога; (2) **управление моделями** — скачивание ~0.5–3 ГБ с SHA-проверкой в userData; (3) **парсинг двух потоков** — прогресс (%) идёт в **stderr**, а живые сегменты (`[HH:MM:SS --> HH:MM:SS] текст`) идут в **stdout** по мере распознавания.

Критическая находка по кросс-платформе: **upstream ggml-org/whisper.cpp публикует prebuilt-бинарники ТОЛЬКО под Windows** (`whisper-bin-x64.zip` и BLAS/CUDA-варианты) плюс macOS xcframework и Java JAR. **Standalone CLI-бинарника под Linux и macOS в релизах НЕТ** — их нужно собирать из исходников (CMake). Это идеально совпадает с уже принятым в Phase 2 решением: v1 таргетит Windows, Linux/macOS перенесены в v1.1 (см. ROADMAP, 02-UAT.md). Поэтому для Phase 3 v1 рекомендуется: бандлить prebuilt `whisper-cli.exe` + его DLL под Windows, а Linux/macOS-бинарники готовить в Phase 5 / v1.1 (build-from-source в CI).

**Primary recommendation:** Зеркалируй сервис-слой Phase 2 (transcriber.ts + whisper-runner.cjs + whisper-paths.ts + transcribe IPC namespace). Бандли prebuilt `whisper-cli` v1.8.6 (Windows x64, CPU/BLAS) в `resources/whisper/win32-x64/` через уже настроенный `asarUnpack: resources/**`. Модели и silero-VAD скачивай по запросу в `userData/models/` с SHA256-проверкой по манифесту ниже. Транскрибируй с `-l ru --vad --vad-model <silero> -pp -oj`, парси stderr для %-прогресса и stdout для живых сегментов.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Запуск whisper.cpp (long-running) | Main → utilityProcess | — | Нативный subprocess, не блокирует main event-loop (Phase 2 D-17) |
| Парсинг прогресса/сегментов | utilityProcess (whisper-runner.cjs) | — | Изоляция stdout/stderr-парсинга от main-графа (Pitfall #5 Phase 2) |
| Резолв путей бинарника/моделей | Main (whisper-paths.ts) | — | `app.asar.unpacked`-патч и userData-резолв требуют electron API |
| Скачивание моделей + SHA-проверка | Main (model-manager.ts) | — | Сеть + fs + прогресс-event; ключи/секреты не нужны, но fs в main |
| Управление моделями (UI) | Renderer (Settings) | Main IPC | D-09: список/скачать/удалить только в Settings |
| Прогресс + живой стриминг сегментов (UI) | Renderer (Transcribe) | Main event-канал | D-11: progress bar + стриминг через webContents.send |
| Генерация transcript.md | Main (fs) | — | Core value — пишем .md сразу на диск из main (CLAUDE.md «не только в памяти») |
| Авто-сохранение + «Сохранить как» | Main (dialog/shell) | Renderer-триггер | D-04/D-05/D-06: showSaveDialog, shell.openPath/showItemInFolder |
| Пересборка текста с/без таймкодов | Renderer (из сохранённых сегментов) | — | D-02: тумблер не перезапускает whisper, работает над сегментами в памяти |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-14)

- **D-01:** Тело транскрипта по умолчанию — **сплошной текст** (сегменты склеиваются в абзацы без таймкодов). Основной режим (чтение + вход для LLM-анализа Phase 4).
- **D-02:** **Тумблер таймкодов** на вкладке Transcribe, по умолчанию **ВЫКЛ**. Переключение применяется к уже готовому результату — **пересборка из сохранённых сегментов БЕЗ повторного прогона whisper**. Формат: `[ЧЧ:ММ:СС]` в начале каждого сегмента.
- **D-03:** Шапка `.md` — **YAML-frontmatter + H1**. Frontmatter (минимум): `source`, `model`, `language`, `duration`, `date`. H1 — имя исходного файла. Сегменты сохраняются (память/временно), чтобы тумблер работал без re-run.
- **D-04:** **Авто-сохранение в `app.getPath('userData')`** сразу по завершении. Внутреннее имя — на усмотрение исполнителя (hash-based, согласованно с extracted-кешем Phase 2).
- **D-05:** Кнопка **«Сохранить как»** через системный save-dialog. Дефолтное имя: **`<имя_mp4>.transcript.md`** (`meeting.mp4` → `meeting.transcript.md`).
- **D-06:** После сохранения — **текст в окне** + кнопки **«Открыть файл»** и **«Показать в папке»**. Авто-открытие во внешнем редакторе ОТВЕРГНУТО.
- **D-07:** Линейка моделей — **`small` (~0.5 ГБ) / `medium` (~1.5 ГБ) / `large-v3` (~3 ГБ)**. `turbo`/`large-v3-turbo` **ИСКЛЮЧЕНЫ** (деградируют на non-English).
- **D-08:** **Дефолтная предвыбранная модель — `medium`**. `large-v3` — явным выбором.
- **D-09:** Управление моделями — **только в Settings** (раздел «Модели»). На Transcribe при отсутствии модели — транскрипция **заблокирована** с отсылкой в Settings.
- **D-10:** Скачивание: **progress bar + Отмена + SHA-проверка целостности** + повтор при ошибке. **Resume НЕ требуется** для v1 (обрыв → файл невалиден → качается заново).
- **D-11:** Прогресс — **progress bar с % сверху + живой стриминг распознанных сегментов**. Источник % — research (см. ниже).
- **D-12:** **UI не блокируется** (один активный job за раз). Cancel через **SIGTERM** в utility-процесс.
- **D-13:** **При отмене — предложить сохранить частичный распознанный текст** (то, что на экране). Отличается от Phase 2 (где частичный wav удалялся).
- **D-14:** Язык — **`ru` по умолчанию + VAD** + **селектор языка** (ru / auto / несколько частых). Точные VAD-параметры — research (см. ниже).

### Claude's Discretion (research targets — разрешено в этой фазе)

1. Способ доставки `whisper-cli` per-OS (prebuilt → `resources/whisper/<platform>/`, бандлинг через `asarUnpack`/`extraResources`) — **resolved ниже**.
2. Точные VAD-параметры whisper.cpp для русского против галлюцинаций — **resolved ниже (MEDIUM)**.
3. Выбор бэкенда (CPU vs CUDA/Metal/Vulkan) для v1 — **resolved: CPU/BLAS для предсказуемости**.
4. Механика парсинга прогресса (% и сегменты) — **resolved ниже**.
5. Внутреннее имя авто-сохранённого `.md` + стратегия хранения сегментов для тумблера — **рекомендация ниже**.
6. Точный набор языков в селекторе сверх ru/auto — **рекомендация ниже**.
7. JSX/Tailwind layout вкладки Transcribe — MVP-эстетика, отдельная UI-фаза не нужна.
8. Имена файлов (`whisper-runner.cjs`, `transcriber.ts`) — **рекомендация ниже**.

### Deferred Ideas (OUT OF SCOPE)

- Облачная транскрипция (OpenAI/Deepgram) — v2.
- Диаризация — whisper.cpp не даёт из коробки, v2.
- Докачка модели с обрыва (HTTP Range resume) — НЕ для v1 (D-10).
- Редактирование транскрипта в приложении — Out of Scope.
- GPU-ускорение (CUDA/Metal/Vulkan) как опция в Settings — v1 CPU-only.
- Кеш транскриптов по hash(audioPath+model+language) — опционально, на усмотрение плана.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRANS-01 | Локальная транскрипция через whisper.cpp офлайн | whisper-cli sidecar (§Standard Stack, §Code Examples). Полностью офлайн после скачивания модели — никакой сети в transcribe-пути |
| TRANS-02 | Выбор модели + скачивание по запросу (не бандлятся) | §Model Manifest (URL+SHA), §Architecture Pattern 4 (model-manager). small/medium/large-v3 |
| TRANS-03 | По умолчанию `ru` + VAD | §VAD Parameters, §Code Examples (`-l ru --vad --vad-model`). Silero VAD-модель |
| TRANS-04 | Прогресс в реальном времени | §Progress Parsing — `-pp` → stderr `progress = N%`; сегменты → stdout live |
| TRANS-05 | Отмена транскрипции (Cancel) | §Pattern 2 — SIGTERM в utilityProcess (зеркало Phase 2 D-09) |
| TRANS-06 | UI не зависает | utilityProcess.fork (long-running вне main loop). Phase 2 D-10/D-17 доказано |
| TRANS-07 | Сохранение в `.md`, который можно открыть | §Pattern 5 (transcript-builder + frontmatter), shell.openPath/showItemInFolder |
</phase_requirements>

## Standard Stack

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| whisper.cpp `whisper-cli` (sidecar binary) | v1.8.6 (latest, 2026-06-02) | Локальная транскрипция | Единственная кросс-платформенная Whisper-реализация на CPU без Python (CLAUDE.md locked). НЕ npm-пакет |
| Silero VAD GGML-модель | `ggml-silero-v5.1.2.bin` (885 kB) | VAD против галлюцинаций (D-14) | whisper.cpp VAD требует отдельную модель; silero — рекомендованная upstream |
| ggml whisper-модели | small / medium / large-v3 | Веса распознавания | D-07. Качаются в userData, не бандлятся |
| utilityProcess (встроено в Electron 42) | — | Запуск whisper-cli | Phase 2 D-17, доказанный паттерн |
| electron-store 11.0.2 (уже в deps) | 11.0.2 | Выбор модели/языка/тумблера, статусы скачанных моделей | Уже используется (settings-store) |

### Supporting (всё уже в проекте — НОВЫХ npm-зависимостей НЕ требуется)
| Component | Source | Purpose |
|-----------|--------|---------|
| `node:https` / `fetch` (встроено) | Node/Electron | Скачивание моделей с HuggingFace |
| `node:crypto` createHash('sha256') | встроено | SHA-проверка модели (D-10) — уже используется sha1 в media-extractor |
| `electron.dialog.showSaveDialog` | встроено | «Сохранить как» (D-05) |
| `electron.shell.openPath` / `showItemInFolder` | встроено | D-06 |
| esbuild | уже в build:utilities | Бандлинг whisper-runner.cjs (как ffmpeg-runner) |

### Backend Choice (Claude's Discretion #3 → RESOLVED)
**Рекомендация: CPU / OpenBLAS для v1.** Бери `whisper-bin-x64.zip` (чистый CPU) или `whisper-blas-bin-x64.zip` (CPU + OpenBLAS, заметно быстрее на encoder без GPU). НЕ бери cublas-варианты — они требуют установленный CUDA Toolkit у пользователя (нарушает «работает из коробки»). CPU/BLAS даёт предсказуемость на любой машине; GPU — отложено в v2 (deferred).
- **Tradeoff:** large-v3 на CPU медленная (~realtime или хуже на слабой машине) — поэтому дефолт `medium` (D-08) разумен; live-стриминг сегментов (D-11) маскирует ожидание.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| prebuilt whisper-cli.exe | build-from-source (CMake) per-OS | Обязательно для Linux/macOS (нет prebuilt). Для Windows prebuilt проще. См. §Cross-Platform Delivery |
| sidecar-бинарник | smart-whisper / nodejs-whisper (native) | CLAUDE.md ЗАПРЕТ: заброшен / компиляция в рантайме. НЕ использовать |
| CPU/BLAS | CUDA cublas-вариант | Требует CUDA Toolkit у юзера, не кросс-платформа. v2 |
| silero-v5.1.2 | silero-v6.2.0 | v6.2.0 новее (то же 885 kB). v5.1.2 дольше в проде, оба валидны. План может взять любой; **закрепить один в манифесте** |

**Installation (бинарник — НЕ npm):**
```text
# 1. Скачать whisper-bin-x64.zip (или whisper-blas-bin-x64.zip) из релиза v1.8.6:
#    https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.6
# 2. Извлечь whisper-cli.exe + ВСЕ .dll (ggml.dll, ggml-base.dll, ggml-cpu.dll,
#    whisper.dll / libwhisper-1.dll, при BLAS — openblas.dll) в:
#    resources/whisper/win32-x64/
# 3. Модели и VAD НЕ кладём в resources — качаются в userData по запросу.
```
**НОВЫХ записей в package.json dependencies НЕ добавляется** — whisper.cpp не npm-пакет.

**Version verification:**
- whisper.cpp последний релиз — **v1.8.6**, опубликован **2026-06-02** [VERIFIED: api.github.com/repos/ggml-org/whisper.cpp/releases/latest]. Assets: `whisper-bin-Win32.zip`, `whisper-bin-x64.zip`, `whisper-blas-bin-Win32.zip`, `whisper-blas-bin-x64.zip`, `whisper-cublas-11.8.0-bin-x64.zip`, `whisper-cublas-12.4.0-bin-x64.zip`, `whisper-v1.8.6-xcframework.zip`, `whispercpp.jar.zip`.

## Package Legitimacy Audit

> Phase 3 **НЕ добавляет npm-пакетов**. whisper.cpp поставляется как нативный бинарник из официального GitHub-релиза ggml-org, не из реестра. slopcheck/npm-аудит неприменимы.

| Artifact | Source | Integrity | Disposition |
|----------|--------|-----------|-------------|
| whisper-bin-x64.zip (v1.8.6) | github.com/ggml-org/whisper.cpp/releases | Скачивается разработчиком вручную, кладётся в repo `resources/` (in-tree, в git) | Approved — официальный ggml-org релиз |
| ggml-{small,medium,large-v3}.bin | huggingface.co/ggerganov/whisper.cpp | SHA256 проверяется в рантайме (D-10, манифест ниже) | Approved |
| ggml-silero-v5.1.2.bin | huggingface.co/ggml-org/whisper-vad | SHA256 проверяется в рантайме | Approved |

**Packages removed:** none (npm-пакеты не добавляются).
**Suspicious:** none.

## Cross-Platform Delivery (Claude's Discretion #1 → RESOLVED)

**Критическая находка:** upstream ggml-org/whisper.cpp в релизах даёт **только Windows prebuilt-бинарники** + macOS xcframework (это библиотека для iOS/macOS-приложений, НЕ standalone CLI) + Java JAR. **Готового standalone `whisper-cli` под Linux и macOS НЕТ** — собирается из исходников через CMake (`cmake -B build && cmake --build build -j --config Release`). [VERIFIED: GitHub releases API + README build section]

**Рекомендация для v1 (совпадает с ROADMAP):**
- **Windows (v1 таргет):** бандлить prebuilt `whisper-cli.exe` + DLL из `whisper-blas-bin-x64.zip` в `resources/whisper/win32-x64/`. Никакой компиляции.
- **Linux/macOS (v1.1, как и MEDIA-04):** собирать `whisper-cli` из исходников в CI и класть per-platform в `resources/whisper/linux-x64/`, `resources/whisper/darwin-arm64/`, `resources/whisper/darwin-x64/`. Финализируется в Phase 5 / v1.1. Зафиксировать как Open Question, не блокировать v1.

**Бандлинг — `asarUnpack` УЖЕ настроен** (electron-builder.yml содержит `resources/**` в `asarUnpack`). whisper-paths.ts резолвит путь так же, как ffmpeg-paths.ts:
```text
resources/whisper/<platform-arch>/whisper-cli(.exe)   ← бинарник + DLL рядом
userData/models/ggml-<model>.bin                       ← модели (скачаны)
userData/models/ggml-silero-v5.1.2.bin                 ← VAD-модель (скачана)
```

**Windows zip-контент (что положить рядом с .exe):** `whisper-cli.exe`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`, `whisper.dll` (или `libwhisper-1.dll`), при BLAS — `openblas.dll` / `libopenblas.dll`. **Все DLL обязаны лежать в той же папке, что и .exe** — иначе spawn упадёт с ошибкой загрузки библиотеки (аналог Pitfall #1 Phase 2, но для DLL). [VERIFIED: WebSearch zip-contents + MEDIUM]

## Model Manifest (Claude's Discretion #5 → RESOLVED)

Манифест для D-10 (URL + SHA256 + size). **Базовый URL моделей:** `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/`. **VAD-модель:** `https://huggingface.co/ggml-org/whisper-vad/resolve/main/`. [CITED: models/download-ggml-model.sh, models/download-vad-model.sh]

| Имя | Файл | URL (resolve/main/) | Размер | SHA256 |
|-----|------|---------------------|--------|--------|
| small | `ggml-small.bin` | huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin | 488 MB (~511,705,088 B) | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |
| medium | `ggml-medium.bin` | …/resolve/main/ggml-medium.bin | 1.53 GB | `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208` |
| large-v3 | `ggml-large-v3.bin` | …/resolve/main/ggml-large-v3.bin | 3.1 GB | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |
| silero VAD | `ggml-silero-v5.1.2.bin` | huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin | 885 kB | `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf` |

> SHA256-значения взяты из HuggingFace Xet/LFS pointer-метаданных каждого файла [VERIFIED: huggingface.co blob-pages]. Это хэш содержимого файла — именно то, что считает `createHash('sha256')` после полного скачивания. **План ДОЛЖЕН добавить checkpoint:human-verify** перед закреплением: точные байтовые размеры small/medium/large-v3 (HF показывает округлённо в ГБ) и значения SHA уточнить повторным `curl -sI` + сверкой LFS pointer на момент реализации — upstream может перезалить файлы. download-скрипты upstream **НЕ содержат checksum-логики**, так что манифест ведём сами.

**VAD-модель — скачивается, НЕ бандлится:** при первом включении VAD (или вместе с первой whisper-моделью) тянем silero (885 kB — мгновенно) в `userData/models/`. Бандлить её в `resources/` тоже допустимо (крошечная) — на усмотрение плана; скачивание единообразнее с whisper-моделями.

## VAD Parameters for Russian (Claude's Discretion #2 → RESOLVED, MEDIUM)

whisper.cpp VAD-флаги и их **дефолты** [VERIFIED: examples/vad-speech-segments + cli help; значения — MEDIUM]:

| Флаг | Дефолт | Назначение |
|------|--------|-----------|
| `--vad` | off | Включить VAD |
| `-vm` / `--vad-model <path>` | — | Путь к silero GGML-модели (обязателен при `--vad`) |
| `-vt` / `--vad-threshold <f>` | 0.5 | Порог вероятности речи. ↑ = строже (меньше ложной речи на шуме) |
| `--vad-min-speech-duration-ms` | 250 | Сегменты речи короче — отбрасываются (фильтр кратких шумов) |
| `--vad-min-silence-duration-ms` | 100 | Тишина короче — не разрывает сегмент |
| `--vad-max-speech-duration-s` | FLT_MAX | Макс. длина сегмента речи |
| `--vad-speech-pad-ms` | 30 | Паддинг вокруг речевого сегмента |

**Рекомендация для русского против галлюцинаций (MEDIUM — нет источника, специфичного для ru):**
- **Стартовать с дефолтами + `--vad`** — этого достаточно для устранения галлюцинаций на тишине (главная проблема Whisper на non-speech, подтверждено upstream issue #1724 и arxiv 2501.11378).
- Если в UAT всплывут галлюцинации на музыке/шуме — поднять `--vad-threshold` до **0.6** и `--vad-min-speech-duration-ms` до **300–500**.
- Дополнительно (за пределами VAD): whisper.cpp по умолчанию использует `condition_on_previous_text`; при VAD-нарезке сегменты <30s, и этот режим менее склонен к «зацикливанию». Если повторяющийся текст всё же появляется — рассмотреть отключение через соответствующий флаг (проверить в `whisper-cli --help` на момент реализации).
- **Качество русского — ядро ценности.** План ДОЛЖЕН включить ручной UAT-чек на реальном русском mp4 с тишиной/паузами на medium и large-v3 (см. §Validation).

> **[ASSUMED]** точные оптимальные VAD-числа именно для русского — не нашёл источника. Дефолты + VAD — безопасная база; тюнинг по UAT. Закрепить как разрешённую дискрецию плана, не как жёсткое значение.

## Progress Parsing (Claude's Discretion #4 → RESOLVED)

Два независимых потока — это ключевое отличие от ffmpeg (где всё шло в один `-progress pipe:1`):

| Что | Поток | Формат | Флаг |
|-----|-------|--------|------|
| **Процент прогресса** | **stderr** | `whisper_print_progress_callback: progress = N%` (формат `%s: progress = %3d%%`) | `-pp` / `--print-progress` |
| **Живые сегменты** | **stdout** | `[HH:MM:SS.mmm --> HH:MM:SS.mmm]   текст` — печатается по мере распознавания | дефолт (печатается всегда, если не `-nt`) |

[VERIFIED: examples/cli/cli.cpp — progress callback пишет в stderr; README — пример stdout-формата сегментов]

**Механика для whisper-runner.cjs (зеркало ffmpeg-runner):**
1. `spawn(whisperCliPath, args, {windowsHide:true})`.
2. **stdout** line-buffer → regex на `^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> ...\]\s+(.*)$` → `postMessage({type:'segment', startMs, endMs, text})` → renderer аппендит сегмент (D-11 живой стриминг).
3. **stderr** line-buffer → regex `progress\s*=\s*(\d+)%` → `postMessage({type:'progress', percent})` → progress bar (D-11). Также копить stderr-tail (последние 2000 байт) для диагностики exit≠0 (как Phase 2).
4. `exit code 0` → `done`; `!=0 && !cancelled` → `whisper_failed`; `cancelled` → `cancelled`.

**Машинно-надёжный режим для финального результата — `-oj` / `--output-json`:** whisper-cli пишет `<input>.json` с массивом сегментов + таймкоды. **Рекомендация: использовать оба канала** — stdout-сегменты для живого UX (D-11), а `-oj` JSON-файл как авторитетный источник сегментов для генерации transcript.md и тумблера таймкодов (D-02/D-03), чтобы не зависеть от парсинга человекочитаемого stdout. Парсить JSON надёжнее, чем regex по stdout.

> **Важно про %:** whisper.cpp прогресс «грубее» ffmpeg — шаг callback ~5%, и encoder-фаза молчит. На длинном файле бар может «прыгать». Это ожидаемо; живой стриминг сегментов (D-11) компенсирует.

## Architecture Patterns

### System Architecture Diagram

```
renderer (Transcribe.tsx, Settings «Модели»)
   │  window.scrubber.transcribe.start(audioPath, opts) / .cancel(jobId)
   │  window.scrubber.models.list/download/delete/cancel
   │  .onProgress(cb)  .onSegment(cb)   (event-каналы)
   ▼ (ipcRenderer.invoke / ipcRenderer.on)  ──preload bridge (allow-list)──
main: ipc/transcribe.ts + ipc/models.ts   (defence-in-depth валидация)
   │
   ├─ services/model-manager.ts ── fetch(HF URL) → stream → userData/models/ggml-*.bin
   │       └─ createHash('sha256') проверка по манифесту → emit MODELS_PROGRESS
   │
   └─ services/transcriber.ts (singleton, зеркало media-extractor)
          │ resolveWhisperCli() + resolveModel() + assertBinaryExists()
          │ utilityProcess.fork(whisper-runner.cjs)
          ▼ postMessage{type:'start', cliPath, modelPath, vadModelPath, audioPath, lang, opts}
       whisper-runner.cjs (CJS, изолирован)
          │ spawn(whisper-cli, buildTranscribeArgs(...))
          ├─ stdout → segment-regex → postMessage{type:'segment'}  ──► TRANSCRIBE_SEGMENT ──► renderer (живой стриминг)
          ├─ stderr → progress-regex → postMessage{type:'progress'} ──► TRANSCRIBE_PROGRESS ──► renderer (бар)
          └─ exit(code) → postMessage{type:'done', code, jsonPath, stderrTail}
                  │
       transcriber.ts: читает <audio>.json (-oj) → сегменты →
          transcript-builder.ts → transcript.md (frontmatter+H1+тело) →
          авто-сохранение в userData → Result{ ok, mdPath, segments }
```

### Recommended Project Structure (новые файлы — зеркало Phase 2)
```
src/shared/ipc.ts                       # +Channels TRANSCRIBE_*/MODELS_*, +TranscribeApi/ModelsApi, +TranscribeReason
src/main/services/transcriber.ts        # singleton, зеркало media-extractor.ts
src/main/services/whisper-paths.ts      # зеркало ffmpeg-paths.ts (resolveWhisperCli/resolveModel/assertBinaryExists)
src/main/services/model-manager.ts      # скачивание + SHA256 + прогресс + cancel + delete
src/main/services/transcript-builder.ts # сегменты → md (frontmatter+H1+тело), пересборка с/без таймкодов
src/main/utilities/whisper-runner.ts    # → esbuild → out/main/whisper-runner.cjs (зеркало ffmpeg-runner)
src/main/utilities/whisper-args.ts      # buildTranscribeArgs() — чистая функция (зеркало ffmpeg-args)
src/main/ipc/transcribe.ts              # handlers (зеркало ipc/media.ts)
src/main/ipc/models.ts                  # handlers скачивания/удаления/списка
src/renderer/src/routes/Transcribe.tsx  # +блок транскрипции после extract
src/renderer/src/components/Transcribe*  # TranscribeProgress, SegmentStream, TranscriptResult, TimecodeToggle
src/renderer/src/routes/Settings.tsx     # +раздел «Модели»
resources/whisper/win32-x64/             # whisper-cli.exe + DLL (in-tree, в git)
```

### Pattern 1: Singleton transcriber (зеркало media-extractor)
**What:** singleton с `init()` (mkdir userData/models, assertBinaryExists whisper-cli), in-memory job-map, `startTranscribe(audioPath, opts)`, `cancel(jobId)`, emit progress+segment.
**When:** один активный job за раз (D-12). Cancel = SIGTERM (D-12/D-13).
**Source:** src/main/services/media-extractor.ts (один-в-один шаблон).

### Pattern 2: Cancel + частичный результат (D-13 — ОТЛИЧИЕ от Phase 2)
**What:** при cancel renderer УЖЕ накопил сегменты (живой стриминг). После SIGTERM-exit → reason `cancelled`, но renderer предлагает «Сохранить частичное?» из накопленных сегментов. В отличие от Phase 2, где .tmp удалялся, здесь частичный текст имеет ценность.
**Реализация:** сегменты живут в renderer-state по мере `onSegment`; на cancel main НЕ генерирует .md, но renderer может вызвать `transcribe.saveMd(segments, meta)` для частичного.

### Pattern 3: assertBinaryExists перед fork (Gap 3 Phase 2)
**What:** проверять `whisper-cli` И `modelPath` физически перед `utilityProcess.fork`. Отсутствие модели → reason `model_missing` (→ UI «скачайте в Settings», D-09). Отсутствие бинарника → `internal` (asarUnpack сломан).
**Source:** media-extractor.startExtract Gap 3 (commit 6fcb885) + ffmpeg-paths.assertBinaryExists.

### Pattern 4: Model download + SHA256 (D-10)
**What:** stream-скачивание в `userData/models/<name>.bin.tmp`, прогресс по `Content-Length`, на завершении `createHash('sha256')` → сверка с манифестом → `rename .tmp→final` или unlink+`model_download_failed`. Cancel = abort fetch + unlink .tmp. Resume НЕ делаем (D-10).
**Source:** паттерн `.tmp→rename` из media-extractor; sha-логика — `node:crypto` (уже в проекте).

### Pattern 5: transcript.md builder (D-01/D-02/D-03)
**What:** из сегментов (из `-oj` JSON) собрать .md: YAML-frontmatter (`source`, `model`, `language`, `duration`, `date`) + `# <имя файла>` + тело. Тело: дефолт — склейка `text` в абзацы (D-01); с тумблером — `[ЧЧ:ММ:СС] text` построчно (D-02). **Сегменты хранятся в renderer-state** → тумблер пересобирает БЕЗ re-run и БЕЗ повторного IPC.

### Anti-Patterns to Avoid
- **Парсить только stdout для %:** прогресс там НЕ печатается — он в stderr. Сегменты в stdout, % в stderr — НЕ перепутать.
- **Бандлить модели в установщик:** D-07/CLAUDE.md ЗАПРЕТ — large-v3 ~3 ГБ. Только userData по запросу.
- **Native node-биндинги (smart-whisper/nodejs-whisper):** CLAUDE.md ЗАПРЕТ.
- **Класть DLL отдельно от whisper-cli.exe:** spawn упадёт с library-load error.
- **`large-v3-turbo`/`turbo` для русского:** CLAUDE.md ЗАПРЕТ (деградация на non-English).
- **child_process.spawn напрямую из main для транскрипции:** длинный процесс заблокирует — только utilityProcess.fork (D-12/D-17).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Транскрипция | Свой STT | whisper.cpp whisper-cli | Локл. Whisper — годы R&D |
| VAD против галлюцинаций | Своя detection тишины | `--vad` + silero-модель | whisper.cpp встроил silero |
| Парсинг сегментов | regex по человекочитаемому stdout как единственный источник | `-oj` JSON + stdout для live | JSON авторитетен; stdout только для UX |
| Long-running subprocess | child_process в main | utilityProcess.fork + CJS-runner | Phase 2 доказано (D-17, Pitfall #5) |
| Резолв бинарника в packaged | hardcode путь | whisper-paths (app.asar.unpacked) | Pitfall #1 Phase 2 |
| SHA-проверка | своя реализация | node:crypto createHash('sha256') | Встроено |
| Save-dialog / открыть файл | своё | dialog.showSaveDialog / shell.openPath | Встроено (D-05/D-06) |

**Key insight:** Phase 3 на 80% — копирование уже отлаженного Phase-2-слоя с заменой ffmpeg→whisper. Новый код там, где whisper.cpp отличается: два потока вывода, доставка не-npm-бинарника, скачивание моделей.

## Runtime State Inventory

> Phase 3 — greenfield-расширение (новые namespaces/файлы), НЕ rename/refactor. Но есть persisted-state, который план должен учесть:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | userData/models/*.bin (скачанные модели); userData/<...>.transcript.md (авто-сохранённые). НОВЫЕ директории — конфликтов с extracted/ Phase 2 нет | Создать `userData/models/` в transcriber.init() |
| Live service config | electron-store: добавляются ключи `selectedModel` (дефолт `medium`), `selectedLanguage` (`ru`), `timecodesEnabled` (false), статусы моделей | Расширить settings-store схему |
| OS-registered state | None — нет OS-регистраций. Verified: проект не использует Task Scheduler/launchd | None |
| Secrets/env vars | None для локальной транскрипции (офлайн, ключи не нужны). API-ключи — Phase 4 | None |
| Build artifacts | `out/main/whisper-runner.cjs` (новый esbuild-таргет, добавить в `build:utilities`); `resources/whisper/win32-x64/` (in-tree бинарники) | Расширить package.json scripts.build:utilities |

## Common Pitfalls

### Pitfall 1: DLL не рядом с whisper-cli.exe → library load error
**Что:** spawn(whisper-cli.exe) падает, если ggml*.dll / whisper.dll не в той же папке.
**Почему:** Windows ищет DLL в директории .exe; asar-распаковка должна сохранить всю папку целиком.
**Как избежать:** класть ВЕСЬ контент zip (exe + все dll) в `resources/whisper/win32-x64/`; `asarUnpack: resources/**` уже сохраняет дерево. Packaged smoke-тест (как Phase 2 D-19) обязателен.
**Признаки:** exit-code ≠ 0 сразу, stderr про missing DLL.

### Pitfall 2: % прогресса парсится из stdout (пусто)
**Что:** прогресс не двигается.
**Почему:** `-pp` пишет в **stderr**, не stdout. Сегменты — в stdout.
**Как избежать:** два разных line-buffer'а; regex `progress = N%` на stderr.

### Pitfall 3: Галлюцинации на тишине/русском без VAD
**Что:** whisper выдаёт повторы/выдуманный текст на паузах.
**Почему:** Whisper галлюцинирует на non-speech (upstream issue #1724, arxiv 2501.11378).
**Как избежать:** ВСЕГДА `--vad --vad-model <silero>` (D-14). Тюнинг threshold по UAT. Качество русского — ядро ценности.
**Признаки:** повторяющиеся фразы, текст в тихих местах.

### Pitfall 4: Обрыв скачивания large-v3 (~3 ГБ) → битый файл
**Что:** неполный .bin молча используется → whisper падает / мусор.
**Почему:** сеть рвётся на больших файлах.
**Как избежать:** SHA256-проверка ОБЯЗАТЕЛЬНА (D-10); fail → unlink → перекачка. Resume не делаем (D-10).
**Признаки:** размер < ожидаемого, SHA mismatch.

### Pitfall 5: Нет prebuilt для Linux/macOS
**Что:** план закладывает «скачать whisper-cli per-OS» как ffmpeg-static — не сработает.
**Почему:** upstream не публикует Linux/macOS standalone CLI.
**Как избежать:** v1 — только Windows prebuilt (совпадает с MEDIA-04→v1.1). Linux/macOS — build-from-source в Phase 5/v1.1.

### Pitfall 6: ESM-вход для utilityProcess.fork
**Что:** whisper-runner как ESM падает в Electron 42.
**Как избежать:** CJS (`require`), esbuild `--format=cjs` (как ffmpeg-runner). Pitfall #5 Phase 2.

### Pitfall 7: WAV-вход уже правильный — НЕ ресемплить
**Что:** соблазн пересжать аудио.
**Почему:** media.extractAudio уже даёт PCM 16kHz mono s16le (Phase 2 D-01) — ровно вход whisper. Подавать audioPath напрямую через `-f`.

## Code Examples

### Reference command line (WAV → segments, русский, VAD, прогресс, JSON)
```bash
# Source: README + cli.cpp (VERIFIED)
whisper-cli \
  -m  <userData>/models/ggml-medium.bin \
  -l  ru \
  --vad \
  -vm <userData>/models/ggml-silero-v5.1.2.bin \
  -pp \
  -oj \
  -t  <threads> \
  -f  <userData>/extracted/<hash>.wav
# stdout: [00:00:00.000 --> 00:00:03.480]  распознанный текст     ← живой стриминг (D-11)
# stderr: whisper_print_progress_callback: progress =  35%        ← progress bar (D-11)
# файл:   <hash>.wav.json                                          ← авторитетные сегменты для .md
```

### buildTranscribeArgs (зеркало ffmpeg-args.ts — чистая функция)
```typescript
// src/main/utilities/whisper-args.ts — без импортов electron/main-графа
export interface TranscribeOpts {
  modelPath: string
  audioPath: string
  language: string          // 'ru' | 'auto' | ...
  vadModelPath: string | null
  threads: number
}
export function buildTranscribeArgs(o: TranscribeOpts): string[] {
  const args = [
    '-m', o.modelPath,
    '-l', o.language,        // 'auto' → whisper-cli автодетект
    '-pp',                   // прогресс в stderr (D-11)
    '-oj',                   // JSON-файл рядом с входом (авторитет для .md)
    '-t', String(o.threads),
    '-f', o.audioPath        // WAV из Phase 2 D-01 — НЕ ресемплить (Pitfall 7)
  ]
  if (o.vadModelPath) {
    args.push('--vad', '-vm', o.vadModelPath)   // D-14
    // тюнинг по UAT: '--vad-threshold','0.6' и т.п.
  }
  return args
}
```

### segment + progress parsing (whisper-runner.cjs)
```javascript
// stdout — живые сегменты
const SEG = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(.*)$/
function onStdoutLine(line) {
  const m = SEG.exec(line.trim()); if (!m) return
  const startMs = (+m[1]*3600 + +m[2]*60 + +m[3]) * 1000 + +m[4]
  parentPort.postMessage({ type: 'segment', startMs, text: m[9] })
}
// stderr — процент
const PROG = /progress\s*=\s*(\d+)%/
function onStderrLine(line) {
  const m = PROG.exec(line); if (!m) return
  parentPort.postMessage({ type: 'progress', percent: Math.min(99, +m[1]) })
}
```

## IPC Contract Additions (зеркало MediaApi)

```typescript
// Channels (только в shared/ipc.ts)
TRANSCRIBE_START / TRANSCRIBE_CANCEL / TRANSCRIBE_PROGRESS / TRANSCRIBE_SEGMENT / TRANSCRIBE_SAVE_AS / TRANSCRIBE_OPEN / TRANSCRIBE_REVEAL
MODELS_LIST / MODELS_DOWNLOAD / MODELS_CANCEL / MODELS_DELETE / MODELS_PROGRESS

export type TranscribeReason =
  | 'invalid_argument' | 'model_missing' | 'audio_not_found'
  | 'whisper_failed' | 'cancelled' | 'disk_full' | 'internal'
export type ModelReason =
  | 'invalid_argument' | 'download_failed' | 'sha_mismatch'
  | 'cancelled' | 'disk_full' | 'internal'

interface TranscribeApi {
  start: (audioPath: string, opts: { model: string; language: string }) => Promise<Result<{ jobId: string }>>
  cancel: (jobId: string) => Promise<Result>
  saveAs: (md: string, defaultName: string) => Promise<Result<{ path: string } | null>>
  openFile: (path: string) => Promise<Result>
  revealInFolder: (path: string) => Promise<Result>
  onProgress: (cb: (e: { jobId: string; percent: number }) => void) => () => void
  onSegment: (cb: (e: { jobId: string; startMs: number; text: string }) => void) => () => void
}
interface ModelsApi {
  list: () => Promise<Result<Array<{ name: string; sizeBytes: number; downloaded: boolean }>>>
  download: (name: string) => Promise<Result<{ jobId: string }>>
  cancel: (jobId: string) => Promise<Result>
  delete: (name: string) => Promise<Result>
  onProgress: (cb: (e: { name: string; percent: number }) => void) => () => void
}
```
> Зеркалирует существующий `MediaApi`/`MediaProgressEvent` + правила: Channels только в shared, Result на все мутации, event-каналы через webContents.send + unsubscribe в preload.

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| `main` (старое имя CLI) | `whisper-cli` (с 2024) | Бинарник называется whisper-cli(.exe) |
| VAD как внешний препроцессинг | Встроенный `--vad` + silero GGML (whisper.cpp ≥1.7.x) | Не нужен отдельный pyannote/silero-pipeline |
| `download-ggml-model.sh` без checksum | Тот же (checksum НЕ добавили) | Манифест SHA ведём сами (D-10) |

**Deprecated/avoid:** `turbo`/`large-v3-turbo` для русского; native-биндинги smart-whisper/nodejs-whisper (CLAUDE.md).

## Validation Architecture

> nyquist_validation = true → секция включена.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (+ @testing-library/react 16) — уже в проекте |
| Config | electron-vite / vitest конфиг из Phase 1/2 |
| Quick run | `npm run test:unit` (vitest run --reporter=dot) |
| Full suite | `npm test` (typecheck + vitest + electron-vite build) |
| Packaged smoke | `npm run smoke:packaged` (расширить под whisper) |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command | Exists? |
|-----|----------|------|---------|---------|
| TRANS-01 | whisper-cli транскрибирует офлайн | integration (реальный whisper + tiny/small + короткий ru wav) | `vitest run tests/integration/transcribe-real.test.ts` | ❌ Wave 0 |
| TRANS-02 | манифест URL/SHA; download+sha-mismatch→fail | unit | `vitest run src/main/services/model-manager.test.ts` | ❌ Wave 0 |
| TRANS-03 | buildTranscribeArgs включает `-l ru --vad -vm` | unit | `vitest run src/main/utilities/whisper-args.test.ts` | ❌ Wave 0 |
| TRANS-04 | stderr `progress=N%`→progress; stdout seg-regex→segment | unit | `vitest run src/main/utilities/whisper-runner-parse.test.ts` | ❌ Wave 0 |
| TRANS-05 | cancel→SIGTERM→reason cancelled | unit (мок utilityProcess) | `vitest run src/main/services/transcriber.test.ts` | ❌ Wave 0 |
| TRANS-06 | start не блокирует (fork, не spawn в main) | unit (мок fork) | `vitest run src/main/services/transcriber.test.ts` | ❌ Wave 0 |
| TRANS-07 | builder → frontmatter+H1+тело; тумблер пересобирает | unit | `vitest run src/main/services/transcript-builder.test.ts` | ❌ Wave 0 |
| D-09 | model_missing → блок + отсылка | unit + RTL | `vitest run src/renderer/.../Transcribe.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + **packaged smoke на Windows** (реальный whisper-cli.exe из распакованного asar транскрибирует короткий ru wav) перед `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/main/utilities/whisper-args.test.ts` — TRANS-03
- [ ] `src/main/utilities/whisper-runner-parse.test.ts` — TRANS-04 (segment/progress regex, изолированно как progress-parser Phase 2)
- [ ] `src/main/services/transcriber.test.ts` — TRANS-05/06 (мок utilityProcess как media-extractor.test)
- [ ] `src/main/services/model-manager.test.ts` — TRANS-02 (мок fetch + sha)
- [ ] `src/main/services/transcript-builder.test.ts` — TRANS-07/D-01/D-02/D-03
- [ ] `tests/integration/transcribe-real.test.ts` — TRANS-01 (реальный whisper-cli + tiny/small + короткий ru-wav фикстура; gated по наличию бинарника как extract-real)
- [ ] обновить `scripts/smoke-packaged.mjs` под whisper-cli + DLL
- [ ] RTL для Transcribe (model_missing блок, живой стриминг, тумблер, cancel-частичный)

*Manual-only UAT (нельзя автоматизировать качество): качество русского на medium и large-v3, отсутствие галлюцинаций на тишине — ручной чек на реальном mp4 (ядро ценности).*

## Security Domain

> security_enforcement не выставлен в false → секция включена.

### Applicable ASVS Categories
| Category | Applies | Control |
|----------|---------|---------|
| V2 Authentication | no | Локальная транскрипция офлайн, без auth |
| V3 Session | no | — |
| V4 Access Control | yes | isAbsolute + проверка путей перед fork (зеркало media validateMp4Path); audioPath из доверенного userData |
| V5 Input Validation | yes | audioPath/jobId/model-name валидируются в main (defence-in-depth). model-name — whitelist (small/medium/large-v3), НЕ произвольная строка → URL |
| V6 Cryptography | yes | SHA256 целостность модели (НЕ безопасность, а anti-corruption — D-10). Использовать node:crypto, не катать своё |
| V12 Files/Resources | yes | Скачивание из HTTPS HuggingFace; запись .tmp→rename; путь whisper-cli фиксирован (resources), не из renderer |

### Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Renderer передаёт произвольный model-name → SSRF/произвольный URL | Tampering/Info-disclosure | Whitelist моделей в main; URL строится ТОЛЬКО из фиксированного манифеста, не из renderer-строки |
| Подмена скачанной модели (MITM/перезалив) | Tampering | SHA256-сверка с pinned-манифестом перед использованием (D-10) |
| Произвольный путь в transcribe.start | Tampering/path-traversal | isAbsolute + audioPath обязан быть внутри userData/extracted (или проверка существования) |
| Command injection через args | Tampering | spawn с массивом args (НЕ shell-строка) — как ffmpeg. Пути не интерполируются в шелл |
| Произвольный путь в saveAs/openFile | Tampering | путь только из dialog.showSaveDialog (доверенный) / из сгенерированного нами mdPath |

## Sources

### Primary (HIGH)
- api.github.com/repos/ggml-org/whisper.cpp/releases/latest — v1.8.6 (2026-06-02), список assets (Windows-only prebuilt + xcframework + jar)
- github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp — CLI-флаги, progress callback → stderr формат `progress = N%`
- github.com/ggml-org/whisper.cpp/blob/master/README.md — формат stdout-сегментов `[HH:MM:SS.mmm --> ...]`, VAD-пример команды
- raw.githubusercontent.com/.../models/download-ggml-model.sh — базовый URL моделей, поддерживаемые имена, отсутствие checksum
- raw.githubusercontent.com/.../models/download-vad-model.sh — silero VAD URL/имена
- huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-{small,medium,large-v3}.bin — SHA256 + размеры (Xet/LFS pointer)
- huggingface.co/ggml-org/whisper-vad — silero VAD файлы/SHA
- Существующий код Phase 1/2 (media-extractor.ts, ffmpeg-runner/args, ffmpeg-paths, ipc/media, preload, electron-builder.yml) — паттерны для зеркалирования

### Secondary (MEDIUM)
- WebSearch zip-contents whisper-bin-x64 (whisper-cli.exe + DLL) — содержимое Windows-релиза
- WebSearch VAD-дефолты (vad-min-silence-duration-ms=100, vad-speech-pad-ms=30, threshold=0.5, min-speech=250)
- github issue #1724 / arxiv 2501.11378 — галлюцинации Whisper на non-speech, VAD как митигатор

### Tertiary (LOW)
- Оптимальные VAD-числа именно для русского — источник не найден; рекомендация на дефолтах + UAT-тюнинг [ASSUMED]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Оптимальные VAD-параметры для русского = дефолты + `--vad`; тюнинг по UAT | §VAD | Галлюцинации/обрезка речи; митигируется ручным UAT (ядро ценности) — план ОБЯЗАН проверить |
| A2 | Windows zip содержит все нужные DLL рядом с whisper-cli.exe (ggml*, whisper, openblas) | §Cross-Platform Delivery | spawn падает; митигируется packaged smoke-тестом до релиза |
| A3 | SHA256/размеры моделей актуальны на момент реализации (HF мог перезалить) | §Model Manifest | sha_mismatch на корректном файле; план добавляет checkpoint:human-verify повторной сверки |
| A4 | silero-v5.1.2 достаточен (vs v6.2.0) | §Stack | Незначительно — обе модели валидны; закрепить одну в манифесте |
| A5 | whisper-cli печатает сегменты в stdout live (не только в конце) | §Progress Parsing | Если только в конце — живой стриминг (D-11) не сработает; fallback: %-бар из stderr + JSON в конце. Проверить на первом реальном прогоне |

## Open Questions

1. **Linux/macOS whisper-cli бинарники**
   - Знаем: upstream prebuilt — только Windows; Linux/macOS — build-from-source (CMake).
   - Неясно: точный CI-рецепт сборки per-OS.
   - Рекомендация: v1 = Windows-only (совпадает с MEDIA-04→v1.1). Build-from-source в Phase 5/v1.1. НЕ блокировать v1.

2. **Точные байтовые размеры + актуальность SHA моделей**
   - Знаем: SHA256 из HF pointer (verified на момент research).
   - Неясно: точные байты small/medium/large-v3 (HF округляет в ГБ); upstream может перезалить.
   - Рекомендация: checkpoint:human-verify — `curl -sI` + LFS pointer на момент реализации Wave с моделями.

3. **Живой стриминг сегментов в реальном времени (A5)**
   - Рекомендация: на первом реальном прогоне подтвердить, что stdout-сегменты идут по мере распознавания, а не батчем в конце. Если батчем — % из stderr остаётся живым, сегменты появятся в конце (деградация UX, не блокер).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| whisper-cli.exe + DLL | Транскрипция (Windows v1) | ✗ (надо скачать из релиза и положить в resources) | v1.8.6 | — (блокер для запуска, не для планирования) |
| ggml-модели | Транскрипция | ✗ (качаются в рантайме по запросу — by design D-07) | — | UI блокирует + отсылает в Settings (D-09) |
| silero VAD | VAD (D-14) | ✗ (качается) | v5.1.2 | без VAD при отсутствии (деградация качества) |
| ffmpeg-static | Вход (WAV из Phase 2) | ✓ | 5.3.0 | — (уже в проекте) |
| Node/Electron utilityProcess | Запуск sidecar | ✓ | Electron 42.3.0 | — |
| esbuild | Бандлинг whisper-runner.cjs | ✓ | (в build:utilities) | — |
| Сеть (HTTPS HuggingFace) | Скачивание моделей (one-time) | зависит от машины юзера | — | Без сети — нельзя скачать модель; сама транскрипция офлайн |

**Missing, blocking планирование:** нет — все «✗» это by-design рантайм-артефакты (скачиваются/кладутся), а не блокеры планирования.
**Missing with fallback:** whisper-cli бинарник нужно физически подготовить (скачать zip → resources) до первого реального прогона/smoke — план должен включить эту задачу подготовки (как «положить ffmpeg-static» было решено npm-пакетом в Phase 2, здесь — ручная подготовка resources).

## Metadata

**Confidence breakdown:**
- Standard stack / CLI-флаги / манифест моделей+SHA: **HIGH** — verified против GitHub API, cli.cpp, HF pointer-страниц
- Прогресс/сегменты (stderr/stdout): **HIGH** — verified cli.cpp + README; live-стриминг во времени — MEDIUM (A5)
- Доставка бинарника: **HIGH для Windows** (verified releases), Linux/macOS — отложено (Open Q1)
- VAD для русского: **MEDIUM** — флаги/дефолты verified, ru-специфичные значения assumed (A1)
- Архитектура: **HIGH** — прямое зеркало доказанного Phase 2

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (whisper.cpp релизится часто — перепроверить версию/assets/SHA при старте реализации; ~7–14 дней для fast-moving частей)
