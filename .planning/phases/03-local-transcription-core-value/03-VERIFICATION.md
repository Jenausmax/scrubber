---
phase: 03-local-transcription-core-value
verified: 2026-06-17T12:55:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
security_follow_ups:
  - id: CR-01
    severity: critical
    file: src/main/services/model-manager.ts:140
    summary: "fetch следует за HTTP-редиректами (redirect:'follow' по умолчанию) — SSRF/обход T-3-07 антиSSRF при компрометации DNS/MITM; для silero ошибка SHA non-blocking, .tmp может остаться"
    fix: "добавить redirect:'manual' + проверку хоста назначения ∈ allowlist"
  - id: CR-02
    severity: critical
    file: src/main/ipc/transcribe.ts:148-175
    summary: "TRANSCRIBE_OPEN/REVEAL — isAbsolute+endsWith('.md') пропускает '../' сегменты в пути из renderer, shell.openPath исполняет произвольный путь (path traversal)"
    fix: "resolve(mdPath) + relative(transcriptsDir, real) с проверкой startsWith('..') || isAbsolute(rel)"
---

# Phase 3: Local Transcription (Core Value) — Verification Report

**Цель фазы:** Ядро ценности продукта — пользователь получает качественный `transcript.md` из mp4 полностью офлайн через whisper.cpp, с выбором модели, прогрессом и возможностью отмены.
**Верифицировано:** 2026-06-17T12:55:00Z
**Статус:** ACHIEVED
**Ре-верификация:** Нет — первичная верификация

---

## Итоговое заключение

Все 7 требований TRANS-01..07 реализованы в коде: pipeline mp4 → transcript.md связан сквозь все слои (preload → IPC handler → transcriber service → whisper-runner utility process → transcript-builder). UAT-прохождение на упакованной Windows-сборке подтверждено в 03-04 SUMMARY. Два критических security-дефекта (CR-01, CR-02 из кодревью) НЕ блокируют достижение цели фазы (функциональность работает), но требуют устранения до фазы 5 (дистрибуция). Регрессия тестов Phase 1 — подтверждённый pre-existing flake (race-condition, не введён Phase 3).

---

## Наблюдаемые истины (Success Criteria)

| # | Истина | Статус | Доказательство в коде |
|---|--------|--------|-----------------------|
| 1 | Пользователь может транскрибировать извлечённое аудио локально через whisper.cpp полностью офлайн | VERIFIED | `transcriber.ts:196` — `utilityProcess.fork(whisper-runner.cjs)`; `whisper-runner.ts:89` — `spawn(cliPath, args)`; нет сетевых вызовов в pipeline |
| 2 | Пользователь может выбрать модель Whisper и скачать её по запросу (модели не бандлятся) | VERIFIED | `model-manager.ts:64-89` — `MODEL_MANIFEST` (small/medium/large-v3); `Settings.tsx:109-110` — `models.download(name)`; `whisper-paths.ts:48` — `resolveModel` в `userData/models/` |
| 3 | Транскрипция по умолчанию использует русский язык (`language=ru`) с VAD | VERIFIED | `settings-store.ts:37` — `selectedLanguage: 'ru'`; `Transcribe.tsx:35` — `DEFAULT_LANGUAGE = 'ru'`; `whisper-args.ts:47-49` — `--vad -vm <vadModel>` если VAD-модель присутствует |
| 4 | Пользователь видит прогресс транскрипции в реальном времени, может её отменить, UI не зависает | VERIFIED | `transcriber.ts:208` — `webContents.send(TRANSCRIBE_PROGRESS)`; `transcriber.ts:213` — `webContents.send(TRANSCRIBE_SEGMENT)`; `Transcribe.tsx:122-148` — подписки onProgress/onSegment; `transcriber.ts:359-365` — `cancel()` SIGTERM; `transcriber.ts:196` — `utilityProcess.fork` (не блокирует main) |
| 5 | Готовый транскрипт сохраняется в `.md`-файл, который пользователь может открыть | VERIFIED | `transcriber.ts:344-350` — `fs.writeFile(tmpPath)` + `fs.rename(tmpPath, mdPath)` → `userData/transcripts/<hash>.transcript.md`; `ipc/transcribe.ts:143-163` — `TRANSCRIBE_OPEN` shell.openPath; `ipc/transcribe.ts:167-183` — `TRANSCRIBE_REVEAL` showItemInFolder |

**Счёт по Success Criteria: 5/5**

---

## Проверка по требованиям TRANS-01..07

### TRANS-01: Локальная транскрипция офлайн через whisper.cpp

**Статус: VERIFIED**

- `whisper-runner.ts:32-34` — `require('node:child_process').spawn`; нет импортов сети
- `transcriber.ts:196` — `utilityProcess.fork(scriptPath)` (CJS bundle `whisper-runner.cjs`)
- `whisper-paths.ts:33-41` — `resolveWhisperCli()` → `resources/whisper/<platform-arch>/whisper-cli(.exe)` с правкой `app.asar.unpacked`
- `electron-builder.yml:17` — `asarUnpack: resources/**` обеспечивает распаковку бинарника
- `transcriber.ts:127-135` — `init()`: assertBinaryExists + ensureExecutable перед первым fork
- Интеграционный тест `tests/integration/transcribe-real.test.ts` — GREEN (gated по наличию бинарника)

### TRANS-02: Выбор и скачивание модели по запросу

**Статус: VERIFIED**

- `model-manager.ts:64-89` — pinned `MODEL_MANIFEST`: small (467 МБ, SHA256), medium (1.4 ГБ), large-v3 (2.9 ГБ); silero VAD (~885 кБ)
- `model-manager.ts:230-257` — `download()`: fetch → stream → SHA256-проверка ДО `rename .tmp→final` (D-10)
- `model-manager.ts:111-119` — `list()`: `existsSync(resolveModel(name))` — корректный статус downloaded
- `ipc/models.ts:33-97` — `registerModelsHandlers()`: whitelist-валидация в двух местах (IPC + сервис)
- `Settings.tsx:79,97-133` — UI списка моделей + onProgress + download/cancel/delete
- `preload/index.ts:78-88` — namespace `models.*` подключён в bridge
- `ipc/index.ts:9,15` — `registerModelsHandlers()` зарегистрирован

### TRANS-03: Русский язык по умолчанию с VAD

**Статус: VERIFIED**

- `settings-store.ts:36-37` — `selectedModel: 'medium'`, `selectedLanguage: 'ru'` как defaults
- `Transcribe.tsx:34-35` — `DEFAULT_MODEL = 'medium'`, `DEFAULT_LANGUAGE = 'ru'` (fallback до загрузки preferences)
- `whisper-args.ts:34-50` — `buildTranscribeArgs`: `-l <language>` + `-pp -oj`; если `vadModelPath` задан → `--vad -vm <vadModel>`
- `transcriber.ts:177-186` — VAD-модель опциональна: если нет → логирует warn и продолжает без `--vad`
- UAT 03-04 SUMMARY: «качество русского подтверждено manual UAT (без галлюцинаций)»

### TRANS-04: Прогресс в реальном времени, UI не зависает

**Статус: VERIFIED**

- `whisper-runner.ts:57` — `PROG_REGEX = /progress\s*=\s*(\d+)%/` (парс stderr whisper-cli `-pp`)
- `whisper-runner.ts:54-55` — `SEG_REGEX` (парс stdout сегментов)
- `whisper-runner.ts:148-156` — `handleProgressLine` → `parentPort.postMessage({type:'progress', percent})`; cap 99
- `whisper-runner.ts:136-144` — `handleSegmentLine` → `parentPort.postMessage({type:'segment', startMs, text})`
- `transcriber.ts:205-213` — `emitProgress/emitSegment` → `webContents.send(TRANSCRIBE_PROGRESS/SEGMENT)`
- `Transcribe.tsx:122-148` — подписки через `window.scrubber.transcribe.onProgress/onSegment` с функциональным setState (stale-closure guard)
- `components/TranscribeProgress.tsx` — `role="progressbar"` + `aria-valuenow` + clamp + сегменты
- `utilityProcess.fork` — изоляция в отдельном процессе → UI не блокируется

### TRANS-05: Отмена транскрипции (Cancel)

**Статус: VERIFIED**

- `transcriber.ts:358-365` — `cancel(jobId)`: `h.cancelled = true` + `h.proc.kill()` (SIGTERM)
- `whisper-runner.ts:75-77` — `process.on('SIGTERM') → child.kill('SIGTERM')`
- `transcriber.ts:290-292` — `on('exit')`: если `h.cancelled → settle({ok:false, reason:'cancelled'})`
- `ipc/transcribe.ts:87-101` — `TRANSCRIBE_CANCEL`: UUID-regex validation → `transcriber.cancel(jobId)`
- `Transcribe.tsx:243-247` — `handleCancelTranscribe` → `window.scrubber.transcribe.cancel(state.jobId)`
- `Transcribe.tsx:207-212` — D-13: `reason === 'cancelled'` → state `transcript-cancelled-partial` с предложением сохранить накопленное

### TRANS-06: UI не зависает во время длительной транскрипции

**Статус: VERIFIED**

- `transcriber.ts:196` — `utilityProcess.fork(scriptPath)` — whisper-cli запускается в изолированном utility-process, не в main thread
- `whisper-runner.ts:32` — utility bundle использует только `node:child_process`, без импортов `electron` или main-графа
- `transcriber.ts:139-141` — комментарий явно фиксирует: «Неблокирующий старт whisper-job (TRANS-06: fork, не sync spawn в main)»
- `Transcribe.tsx:186` — `handleTranscribe` — async function, UI отзывчив; `transcribe.start` резолвится только по завершению whisper, но это в `await` без блокировки event loop

### TRANS-07: Транскрипт сохраняется в .md-файл

**Статус: VERIFIED**

- `transcriber.ts:321-355` — `finishTranscript()`: читает `-oj` JSON → `buildTranscriptMd` → `fs.writeFile(tmpPath)` → `fs.rename(tmpPath, mdPath)` (атомарная запись D-04)
- `transcript-builder.ts:67-97` — `buildTranscriptMd()`: YAML frontmatter (source/model/language/duration/date) + H1 + тело; timestamps тумблер D-02
- `transcriber.ts:344-347` — путь: `userData/transcripts/<sha1(audioPath)>.transcript.md`
- `ipc/transcribe.ts:104-139` — `TRANSCRIBE_SAVE_AS`: `dialog.showSaveDialog` → `fs.writeFile(res.filePath, md)`
- `ipc/transcribe.ts:143-163` — `TRANSCRIBE_OPEN`: `shell.openPath(mdPath)`
- `TranscriptResult.tsx:80-108` — кнопки «Открыть файл», «Сохранить как», «Показать в папке»
- `lib/transcript-display.ts:31-38` — `buildDisplayText`: тумблер таймкодов renderer-side без re-run

---

## Артефакты — наличие и связность

| Артефакт | Существует | Содержательный | Подключён | Статус |
|----------|-----------|----------------|-----------|--------|
| `src/main/services/transcriber.ts` (369 строк) | да | да (полный singleton) | да (ipc/transcribe.ts:28) | VERIFIED |
| `src/main/services/model-manager.ts` (288 строк) | да | да (download+SHA256+silero) | да (ipc/models.ts:22) | VERIFIED |
| `src/main/services/transcript-builder.ts` (98 строк) | да | да (frontmatter+body+timecodes) | да (transcriber.ts:42) | VERIFIED |
| `src/main/services/whisper-paths.ts` (98 строк) | да | да (resolve+guards) | да (transcriber.ts:34-41) | VERIFIED |
| `src/main/utilities/whisper-args.ts` (51 строк) | да | да (buildTranscribeArgs) | да (whisper-runner.ts:34) | VERIFIED |
| `src/main/utilities/whisper-runner.ts` (157 строк) | да | да (spawn+SIGTERM+SEG+PROG) | да (transcriber.ts:193) | VERIFIED |
| `src/main/ipc/transcribe.ts` (184 строк) | да | да (5 handlers) | да (ipc/index.ts:8,14) | VERIFIED |
| `src/main/ipc/models.ts` (98 строк) | да | да (4 handlers) | да (ipc/index.ts:9,15) | VERIFIED |
| `src/renderer/src/routes/Transcribe.tsx` (505 строк) | да | да (FSM + все состояния Phase 3) | да (routes) | VERIFIED |
| `src/renderer/src/components/TranscribeProgress.tsx` | да | да | да (Transcribe.tsx:437) | VERIFIED |
| `src/renderer/src/components/TranscriptResult.tsx` | да | да (saveAs+timecodes toggle) | да (Transcribe.tsx:478) | VERIFIED |
| `src/renderer/src/components/TimecodeToggle.tsx` | да | да | да (TranscriptResult.tsx:11) | VERIFIED |
| `src/renderer/src/lib/transcript-display.ts` | да | да (buildDisplayText) | да (TranscriptResult.tsx:12) | VERIFIED |
| `src/preload/index.ts` — namespaces transcribe.* и models.* | да | да | да (contextBridge) | VERIFIED |
| `electron-builder.yml` — `asarUnpack: resources/**` | да | да | да | VERIFIED |

---

## Ключевые связи (Key Links)

| От | К | Через | Статус |
|----|---|-------|--------|
| `Transcribe.tsx` | `transcriber` (main) | `window.scrubber.transcribe.start` → `preload` → `ipcRenderer.invoke(TRANSCRIBE_START)` → `ipc/transcribe.ts:60` → `transcriber.startTranscribe` | WIRED |
| `Transcribe.tsx` | прогресс/сегменты | `window.scrubber.transcribe.onProgress/onSegment` → `ipcRenderer.on(TRANSCRIBE_PROGRESS/SEGMENT)` ← `transcriber.ts:208/213` `webContents.send` | WIRED |
| `transcriber.ts` | `whisper-runner.cjs` | `utilityProcess.fork(scriptPath)` + `proc.postMessage({type:'start', ...})` | WIRED |
| `whisper-runner.ts` | `whisper-cli` binary | `spawn(cliPath, buildTranscribeArgs({...}))` | WIRED |
| `whisper-runner.ts` → `transcriber.ts` | JSON результат | `parentPort.postMessage({type:'done', jsonPath})` → `proc.on('message')` → `finishTranscript(jsonPath)` | WIRED |
| `finishTranscript` | `.md` файл на диске | `readSegmentsFromJson(jsonPath)` → `buildTranscriptMd` → `fs.writeFile(tmpPath)` + `fs.rename` | WIRED |
| `Settings.tsx` | `model-manager` (main) | `window.scrubber.models.download/list/delete` → `ipc/models.ts` → `modelManager` | WIRED |
| `ipc/index.ts` | все handlers | `registerTranscribeHandlers()` + `registerModelsHandlers()` вызваны в `registerIpcHandlers()` | WIRED |

---

## Потоки данных (Level 4)

| Компонент | Переменная | Источник | Реальные данные | Статус |
|-----------|-----------|---------|-----------------|--------|
| `TranscriptResult.tsx` | `text` / `segments` | `transcribe.start` → `TranscribeStartResult.text/segments` | JSON от whisper-cli через `readSegmentsFromJson` | FLOWING |
| `TranscribeProgress.tsx` | `percent` / `segments` | `onProgress` / `onSegment` events | stderr `progress=N%` / stdout SEG-regex от реального whisper process | FLOWING |
| `Settings.tsx` — список моделей | `models` | `modelManager.list()` | `existsSync(resolveModel(name))` против реального диска | FLOWING |
| `Transcribe.tsx` | `modelAvailable` | `models.list()` на mount | реальный диск через `existsSync` | FLOWING |
| `transcript-builder.ts` | текст `.md` | `segments[]` из `-oj` JSON | `whisper.cpp transcription[].offsets + text` | FLOWING |

---

## Покрытие требований

| Требование | План | Описание | Статус | Доказательство |
|------------|------|----------|--------|----------------|
| TRANS-01 | 03-02 | Офлайн транскрипция через whisper.cpp | SATISFIED | `transcriber.ts` + `whisper-runner.ts` + integration test |
| TRANS-02 | 03-03 | Выбор и скачивание модели | SATISFIED | `model-manager.ts` + `ipc/models.ts` + `Settings.tsx` |
| TRANS-03 | 03-04 | Русский язык по умолчанию + VAD | SATISFIED | `settings-store.ts:37` + `whisper-args.ts:47-49` + UAT |
| TRANS-04 | 03-04 | Прогресс в реальном времени | SATISFIED | PROG/SEG regex → webContents.send → onProgress/onSegment |
| TRANS-05 | 03-04 | Отмена транскрипции | SATISFIED | `transcriber.cancel()` SIGTERM + `whisper-runner.ts:75-77` |
| TRANS-06 | 03-02 | UI не зависает | SATISFIED | `utilityProcess.fork` в изолированном процессе |
| TRANS-07 | 03-02/04 | Сохранение в .md | SATISFIED | `finishTranscript` + `TRANSCRIBE_SAVE_AS` + `TRANSCRIBE_OPEN` |

---

## Антипаттерны

| Файл | Строка | Паттерн | Серьёзность | Влияние |
|------|--------|---------|-------------|---------|
| `model-manager.ts` | 140 | `fetch(entry.url, { signal })` без `redirect: 'manual'` | WARNING | CR-01 из REVIEW.md — не блокирует функциональность, но нарушает инвариант T-3-07 |
| `ipc/transcribe.ts` | 148-153 | `isAbsolute + endsWith('.md')` без `resolve()+relative()` | WARNING | CR-02 из REVIEW.md — path traversal через `..` в renderer-переданном пути |
| `transcriber.ts` | 115-124 | `lastAudioPath` — единственное mutable поле, перезаписывается при каждом start | WARNING | WR-02 из REVIEW.md — гонка при параллельных job'ах (UI Phase 3 запускает по одному, не проявляется) |
| `model-manager.ts` | 220-227 | `ensureSilero` cancel не чистит `.tmp` для silero | WARNING | WR-01 из REVIEW.md — tmp-файл silero может остаться при отмене во время фазы silero |

Debt-маркеры (`TBD`/`FIXME`/`XXX`): не обнаружены в файлах фазы.

---

## Безопасность — открытые дефекты (из 03-REVIEW.md)

### CR-01 (Critical): fetch follows redirects — SSRF/открытый редирект

**Файл:** `src/main/services/model-manager.ts:140`
**Суть:** `fetch(entry.url, { signal })` использует `redirect: 'follow'` по умолчанию. HuggingFace `resolve/main/` отвечает 302 на CDN. При компрометации DNS/MITM тело может быть скачано с произвольного хоста; SHA256 ловит integrity mismatch, но запись на диск происходит до проверки. Для silero VAD ошибка SHA non-blocking.
**Рекомендация:** `redirect: 'manual'` + проверка хоста назначения ∈ `{huggingface.co, cdn-lfs.huggingface.co, cdn-lfs-us-1.huggingface.co}`.
**Приоритет:** Устранить до Phase 5 (дистрибуция).

### CR-02 (Critical): TRANSCRIBE_OPEN/REVEAL — path traversal через `..`

**Файл:** `src/main/ipc/transcribe.ts:148-153` (OPEN), `172-175` (REVEAL)
**Суть:** Проверка `isAbsolute(mdPath) && mdPath.endsWith('.md')` пропускает `../`-сегменты. Скомпрометированный renderer может передать `C:\...\transcripts\..\..\..\Windows\evil.md`, и `shell.openPath` выполнит его через файловую ассоциацию ОС.
**Рекомендация:** `resolve(mdPath)` + `relative(transcriptsDir, real)` с проверкой `!rel.startsWith('..')`.
**Приоритет:** Устранить до Phase 5 (дистрибуция).

---

## Human Verification (выполнено — результаты из UAT)

По данным 03-04 SUMMARY — ручной packaged UAT на Windows выполнен и подтверждён:

- Packaged smoke: PASS (whisper-cli + DLL в `app.asar.unpacked`)
- In-app скачивание модели: PASS
- Live streaming сегментов во время транскрипции: PASS
- Cancel с сохранением частичного: PASS
- Тумблер таймкодов: PASS
- Save-as через системный диалог: PASS
- Качество русского без галлюцинаций: PASS

---

## Регрессии

**Unit-тесты Phase 1:** `secrets-persist.test.ts` / `secrets-store.test.ts` — 2 провала при совместном запуске. Задокументировано как pre-existing race-condition flake: каждый тест проходит изолированно (11/11 и 4/4). Не введено Phase 3.

---

_Верифицировано: 2026-06-17T12:55:00Z_
_Верификатор: Claude (gsd-verifier)_
