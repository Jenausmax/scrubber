---
phase: 03-local-transcription-core-value
reviewed: 2026-06-17T09:50:00Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - src/shared/ipc.ts
  - src/main/index.ts
  - src/main/ipc/index.ts
  - src/main/ipc/models.ts
  - src/main/ipc/settings.ts
  - src/main/ipc/transcribe.ts
  - src/main/services/model-manager.ts
  - src/main/services/model-manager.test.ts
  - src/main/services/settings-store.ts
  - src/main/services/transcriber.ts
  - src/main/services/transcriber.test.ts
  - src/main/services/transcript-builder.ts
  - src/main/services/transcript-builder.test.ts
  - src/main/services/whisper-paths.ts
  - src/main/utilities/whisper-args.ts
  - src/main/utilities/whisper-args.test.ts
  - src/main/utilities/whisper-runner.ts
  - src/main/utilities/whisper-runner-parse.ts
  - src/main/utilities/whisper-runner-parse.test.ts
  - src/preload/index.ts
  - src/preload/index.test.ts
  - src/renderer/src/components/InlineError.tsx
  - src/renderer/src/components/TimecodeToggle.tsx
  - src/renderer/src/components/TranscribeProgress.tsx
  - src/renderer/src/components/TranscriptResult.tsx
  - src/renderer/src/lib/transcript-display.ts
  - src/renderer/src/routes/Settings.tsx
  - src/renderer/src/routes/Settings.test.tsx
  - src/renderer/src/routes/Transcribe.tsx
  - src/renderer/src/routes/Transcribe.test.tsx
  - scripts/smoke-packaged.mjs
  - tests/integration/transcribe-real.test.ts
findings:
  critical: 2
  warning: 9
  info: 6
  total: 17
findings_resolved:
  critical: 2
  warning: 0
  info: 0
critical_resolved:
  - CR-01  # fixed in d6c33db — redirect:'manual' + host allowlist
  - CR-02  # fixed in cc1c1de — path containment in userData/transcripts
status: critical_resolved
remaining_open: 15  # 9 warning + 6 info
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-17T09:50:00Z
**Depth:** standard
**Files Reviewed:** 32
**Status:** critical_resolved (2 Critical fixed; 9 Warning + 6 Info remain open)

## Summary

Ревью локального оффлайн-пайплайна транскрипции (whisper.cpp sidecar через `utilityProcess.fork`). Прицельно проверены границы доверия IPC, аргументы spawn, path traversal в `saveAs`/моделях, SSRF в загрузке моделей и SHA256-проверка целостности.

Хорошее: основной анти-SSRF контур держится — URL для загрузки берётся ТОЛЬКО из pinned `MODEL_MANIFEST`, имя модели валидируется по whitelist в двух местах (IPC + сервис); spawn whisper-cli идёт через массив аргументов без shell (нет injection); SHA256 проверяется ДО `rename` .tmp→final; `saveAs` использует путь только из системного диалога, а имя файла формирует main.

Основные дефекты: (1) **открытый редирект/SSRF при загрузке моделей** — `fetch` следует за HTTP-редиректами по умолчанию, а тело сохраняется на диск ещё ДО SHA-проверки, поэтому редирект с huggingface на произвольный хост скачивает чужой контент (SHA ловит только integrity, но не сам факт обращения и записи); (2) **TOCTOU / отсутствие нормализации `..` в `TRANSCRIBE_OPEN`/`REVEAL`** — проверка `isAbsolute + endsWith('.md')` пропускает `C:\...\..\..\secret.md`, а `shell.openPath` исполняет произвольный путь. Плюс ряд багов корректности: утечка silero `.tmp` при отмене, гонка `getCurrentAudioPath` между параллельными job'ами, неверный прогресс-роутинг silero в UI, `disk_full` теряется при отмене.

## Critical Issues

### CR-01: fetch следует за редиректами — SSRF/открытый редирект мимо MODEL_MANIFEST

**Status:** RESOLVED (commit d6c33db) — `fetch(..., { redirect: 'manual' })` + host-allowlist (`huggingface.co` + `*.hf.co`/cdn-lfs), валидация host КАЖДОГО хопа ПЕРЕД следующим запросом, не-allowlisted цель → `download_failed` (ничего не пишется); silero идёт через тот же gated-путь; SHA256-before-rename сохранён. Тесты: reject evil-host + follow allowlisted CDN.

**File:** `src/main/services/model-manager.ts:148` (`fetchToFile` → `fetch(entry.url, { signal })`)
**Issue:** URL берётся из pinned-манифеста (это правильно), но `fetch` по умолчанию следует за HTTP 3xx-редиректами (`redirect: 'follow'`). HuggingFace `resolve/main/` как раз отвечает 302-редиректом на CDN (`cdn-lfs.huggingface.co` или подменяемый прокси/MITM при компрометации DNS). Тело ответа стримится и пишется на диск (`out.write`) ДО любой проверки источника. SHA256 ловит несовпадение контента, но:
- для silero VAD при mismatch ошибка лишь логируется и НЕ блокирует (`ensureSilero` → non-blocking) — то есть атакующий, контролирующий редирект, может заставить приложение записать произвольные байты в `userData/models/*.tmp` и они unlink-аются только в happy-path;
- цель анти-SSRF (T-3-07) — «никакого обращения к не-pinned хосту»; следование редиректу нарушает это инвариант, хост назначения фактически не контролируется.

**Fix:** Запретить редиректы и валидировать финальный хост, либо принять, что pin = хост huggingface, и явно ограничить:
```ts
res = await fetch(entry.url, { signal: controller.signal, redirect: 'manual' })
if (res.status >= 300 && res.status < 400) {
  const loc = res.headers.get('location')
  const host = loc ? new URL(loc, entry.url).host : ''
  const ALLOWED = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co'])
  if (!ALLOWED.has(host)) return { ok: false, reason: 'download_failed' }
  res = await fetch(loc!, { signal: controller.signal, redirect: 'manual' })
  // повторить guard на второй редирект или ограничить число хопов
}
```
Минимум — задокументировать и проверять `new URL(res.url).protocol === 'https:'` и host ∈ allowlist после завершения.

### CR-02: TRANSCRIBE_OPEN / REVEAL — отсутствует нормализация пути, обход проверки через `..`

**Status:** RESOLVED (commit cc1c1de) — `validateTranscriptPath`: `path.resolve()` + `path.relative()`-containment в `userData/transcripts` (реальный каталог записи из `finishTranscript`); `..`/out-of-bounds → `invalid_argument`; `.md`-проверка сохранена. Тесты: `..`-traversal reject + легитимный in-bounds путь accept для OPEN и REVEAL.

**File:** `src/main/ipc/transcribe.ts:150-153` (OPEN) и `src/main/ipc/transcribe.ts:172-175` (REVEAL)
**Issue:** Валидация — `isAbsolute(mdPath) && mdPath.endsWith('.md')`. Контракт заявляет «shell только для сгенерированного нами mdPath (T-3-06)», но фактически путь приходит из renderer (untrusted) и НЕ ограничен каталогом `userData/transcripts`. Строка вида `C:\Users\victim\AppData\...\transcripts\..\..\..\Windows\System32\evil.md` проходит обе проверки (она абсолютна и кончается на `.md`), после чего `shell.openPath` отдаёт её ОС на исполнение через ассоциацию расширения. Это позволяет скомпрометированному/багнутому renderer открыть произвольный путь оболочкой. Расширение `.md` не гарантирует безопасности: на многих системах `.md` ассоциирован с редактором, но `endsWith` не защищает от `..`-сегментов внутри пути и от symlink.

**Fix:** Канонизировать путь и проверить, что он внутри доверенного каталога transcripts:
```ts
import { resolve, relative } from 'node:path'
const dir = join(app.getPath('userData'), 'transcripts')
const real = resolve(mdPath)
const rel = relative(dir, real)
if (rel.startsWith('..') || isAbsolute(rel) || !real.endsWith('.md')) {
  return { ok: false, reason: 'invalid_argument' }
}
```
Альтернатива: вообще не принимать путь из renderer, а открывать `transcriber`-кэшированный последний `mdPath` (как сделано для `getCurrentAudioPath` в saveAs).

## Warnings

### WR-01: Утечка silero `.tmp` при отмене — cancel чистит не тот tmpPath

**File:** `src/main/services/model-manager.ts:241-247` (`cancel`) + `:212` (`ensureSilero`)
**Issue:** `DownloadJob.tmpPath` фиксируется как `${resolveModel(name)}.tmp` (основная модель). Но `download()` сначала вызывает `ensureSilero(controller)`, который качает silero в `ggml-silero-v5.1.2.bin.tmp` — другой файл. Если пользователь отменяет во время фазы silero, `cancel()` делает `fs.unlink(job.tmpPath)` для НЕ существующего ещё файла основной модели, а реально пишущийся silero `.tmp` остаётся на диске. Plus: `controller.abort()` прервёт `fetchToFile` silero, его внутренний `catch` сделает unlink — но это гонка, и при `await fs.rename` или между итерациями частичный файл может остаться.

**Fix:** Отслеживать активный tmpPath динамически (поле в job, обновляемое перед каждым `fetchToFile`), либо чистить оба известных tmp при cancel:
```ts
await fs.unlink(`${resolveVadModel()}.tmp`).catch(() => {})
await fs.unlink(job.tmpPath).catch(() => {})
```

### WR-02: Гонка `getCurrentAudioPath` — saveAs может взять имя чужого job'а

**File:** `src/main/services/transcriber.ts:118-120` + `:159` (`this.lastAudioPath = audioPath`)
**Issue:** `lastAudioPath` — единственное поле на весь singleton, перезаписывается при КАЖДОМ `startTranscribe`. Архитектура допускает несколько одновременных job'ов (`jobs` — Map, нет guard «один активный»). Если запущены две транскрипции, `saveAs` для первой возьмёт `defaultName` из audioPath второй. UI Phase 3 запускает по одному, но контракт и сервис этого не гарантируют — это скрытый баг, который проявится при первом параллельном сценарии (или при сохранении старого результата после старта нового).

**Fix:** Привязать audioPath к результату/jobId и передавать его в `saveAs` через main-side lookup по jobId, а не через единственное mutable-поле. Либо явно задокументировать и enforce «один активный job» (reject второго старта).

### WR-03: `disk_full` при отмене перетирается на `cancelled`

**File:** `src/main/services/model-manager.ts:175-183` (stream catch)
**Issue:** В catch стрима: `const reason = mapFetchErr(err); if (reason === 'cancelled') return cancelled`. Но `out.write`/`out.end` могут отклониться с `ENOSPC` ИМЕННО в момент, когда `controller` уже abort-нут (или наоборот). `mapFetchErr` смотрит сначала на `name === 'AbortError'`. Если abort и ENOSPC совпали, `disk_full` будет замаскирован. Менее критично, но пользователь получит «отменено» вместо «диск полон». Также: ошибка записи в файл (`out.write` reject) маппится через `mapFetchErr`, который рассчитан на сетевые ошибки — для disk-ошибок код `ENOSPC` ловится, но прочие fs-ошибки (`EACCES`, `EROFS`) уйдут в `download_failed`, что вводит в заблуждение.

**Fix:** Различать источник ошибки (network vs write-stream) и приоритизировать `ENOSPC` над `AbortError`, либо проверять `controller.signal.aborted` явно.

### WR-04: Прогресс silero VAD роутится в UI как прогресс основной модели некорректно

**File:** `src/main/services/model-manager.ts:213` (`fetchToFile(..., 'silero')`) + `src/renderer/src/routes/Settings.tsx:96-99` (onProgress)
**Issue:** При первой загрузке `download('small')` сначала качается silero с `emitName='silero'`, шлёт `MODELS_PROGRESS {name:'silero', percent}`. В Settings подписка делает `setModelStatus(prev => ({...prev, [e.name]: ...}))` — то есть создаётся строка статуса `silero`, которой нет в списке `models` (только small/medium/large-v3). Прогресс silero нигде не виден, а основная модель в это время показывает «Скачивание… 0%» застывшим (её progress пойдёт только после silero). Пользователь видит зависший 0% на ~секунду+ без объяснений. Не краш, но вводит в заблуждение и противоречит UX-ожиданию.

**Fix:** Не эмитить отдельный `name:'silero'` в общий канал прогресса, а либо подмешивать silero в прогресс основной модели, либо слать отдельное событие фазы, которое renderer покажет как «Подготовка VAD…».

### WR-05: download() резолвится по завершению, но jobId возвращается только в конце — cancel недоступен во время скачивания

**File:** `src/main/services/model-manager.ts:218-238` (`download`) + `src/renderer/src/routes/Settings.tsx:107-118` (`handleDownloadModel`)
**Issue:** `download()` не резолвит Promise с `{jobId}` до полного завершения скачивания (3 ГБ для large-v3). В renderer `handleDownloadModel` делает `const r = await ...download(name)` и только ПОСЛЕ резолва пишет `setJobIds(... r.data.jobId)`. Значит во время реального скачивания `jobIds[name]` пуст, и `handleCancelModel` → `if (jobId) ...cancel` — `jobId` undefined, отмена тихо не срабатывает (только локально сбрасывает статус в idle, а фоновая загрузка продолжается). Кнопка «Отмена» в UI фактически не отменяет загрузку. Это функциональный дефект ключевого UX (отмена 3 ГБ-загрузки).

**Fix:** Возвращать `jobId` СРАЗУ (как `MediaExtractResult` возвращает jobId до завершения через event-канал), а завершение сигналить отдельным событием/percent=100. Либо слать jobId через первый `MODELS_PROGRESS`.

### WR-06: Десериализация JSON из whisper без ограничений и валидации структуры массива

**File:** `src/main/services/transcriber.ts:88-115` (`readSegmentsFromJson`)
**Issue:** Файл `<audio>.json` пишется самим whisper-cli (доверенный), но читается без ограничения размера и с частичной типобезопасностью. Каждый `item` приводится `as { offsets?... }` без проверки, что `item` — объект (не null/число/строка). Если `transcription` содержит `null` элемент, `(null as {...}).offsets` бросит TypeError, который перехватится в `.catch` верхнего уровня и смапится в `mapFsErr` → `internal` вместо корректного результата. Низкий риск (источник — наш CLI), но хрупко.

**Fix:** `if (item === null || typeof item !== 'object') continue` перед чтением полей.

### WR-07: `out.destroy()` без гарантии flush/закрытия дескриптора при ошибке rename

**File:** `src/main/services/model-manager.ts:200-209` (rename catch)
**Issue:** При успешном стриме `out.end()` дожидается закрытия, затем `rename`. Если `rename` падает (например, антивирус держит .tmp на Windows — частый кейс), делается `fs.unlink(tmpPath)`, который тоже может упасть на Windows с `EBUSY`, тогда `.tmp` остаётся. Также при ошибке в фазе стрима `out.destroy()` не гарантирует, что все буферы сброшены до `unlink` — на Windows unlink открытого хендла даёт `EPERM`/`EBUSY`, и `.catch(()=>{})` молча оставляет мусорный `.tmp`. Накопление недокачанных `.tmp` (до 3 ГБ каждый) — потенциальная проблема, отмеченная в скоупе как resource cleanup.

**Fix:** Дождаться close-события destroy перед unlink; добавить best-effort повторную попытку unlink через таймаут на Windows; либо периодическую очистку `*.bin.tmp` в `models/` при старте.

### WR-08: `total` из Content-Length может быть отрицательным/NaN → прогресс ломается

**File:** `src/main/services/model-manager.ts:165` (`Number(res.headers.get('content-length') ?? entry.sizeBytes)`)
**Issue:** Если сервер вернёт пустой/мусорный `content-length` (после редиректа, gzip, chunked), `Number('')` = 0, `Number('abc')` = NaN. `if (total > 0)` отсекает 0 и NaN (прогресс просто не шлётся — приемлемо), но при `total` отрицательном (теоретически невозможно из заголовка, но защита отсутствует) `Math.floor(received/total*100)` даст мусор. Кроме того, для chunked-ответа без Content-Length прогресс вообще не показывается, а пользователь ждёт 3 ГБ без обратной связи — UX-деградация.

**Fix:** `const total = Number(res.headers.get('content-length')); const denom = Number.isFinite(total) && total > 0 ? total : entry.sizeBytes` — использовать манифестный размер как fallback-знаменатель (он известен точно).

### WR-09: `language` передаётся в whisper-cli без валидации по whitelist значений

**File:** `src/main/ipc/transcribe.ts:74-76` + `src/main/utilities/whisper-args.ts:46` (`-l <language>`)
**Issue:** Валидация языка — только `typeof === 'string' && length>0`. Любая непустая строка уходит как аргумент `-l` в spawn (массив аргументов — injection невозможен, это плюс). Но whisper-cli при неизвестном языке может повести себя непредсказуемо (ошибка → whisper_failed, либо игнор). Renderer ограничивает выбор списком, но IPC-контракт принимает произвольную строку. Не security (нет shell), но defence-in-depth по аналогии с MODEL_WHITELIST отсутствует — несогласованность с заявленным V5 ASVS-подходом.

**Fix:** Завести `LANGUAGE_WHITELIST` (ISO-коды + 'auto') и валидировать в handler, как для model.

## Info

### IN-01: Дублирование regex-парсеров между whisper-runner.ts и whisper-runner-parse.ts

**File:** `src/main/utilities/whisper-runner.ts:48-51` vs `src/main/utilities/whisper-runner-parse.ts:27,33`
**Issue:** `SEG_REGEX`/`PROG_REGEX` и логика парсинга продублированы (задокументировано как вынужденное из-за bundle-границы). Риск рассинхрона: тест покрывает `*-parse.ts`, а в проде исполняется inline-копия в runner. Если кто-то поправит regex в одном месте — тесты останутся зелёными, а прод сломается.
**Fix:** Импортировать `whisper-runner-parse.ts` в runner так же, как импортируется `whisper-args.ts` (esbuild уже инлайнит `./whisper-args`); устранить дубль.

### IN-02: `console.error` используется для информационных логов (не ошибок)

**File:** `src/main/services/transcriber.ts:194-196` (fork log), `:260` (transcript saved)
**Issue:** Успешные события («fork whisper-runner», «transcript saved») логируются через `console.error`, засоряя stderr. Затрудняет фильтрацию реальных ошибок.
**Fix:** Использовать `console.log`/`console.info` для не-ошибочных сообщений.

### IN-03: `BrowserWindow.getAllWindows()[0]` как адресат событий — хрупко при мультиокне

**File:** `src/main/services/transcriber.ts:200,205` + `src/main/services/model-manager.ts:171`
**Issue:** Прогресс/сегменты шлются в `getAllWindows()[0]`. При нескольких окнах (или окне devtools как отдельном) событие уйдёт не туда или потеряется. Сейчас одно окно — ок, но это неявная зависимость.
**Fix:** Адресовать `event.sender` инициировавшего invoke (пробросить webContents в job), как минимум задокументировать инвариант «одно окно».

### IN-04: Магическое число 2000 (stderrTail), 8 (threads), 99 (progress cap) без именованных констант

**File:** `src/main/utilities/whisper-runner.ts:97,159` , `src/main/services/transcriber.ts:182`
**Issue:** `.slice(-2000)`, `Math.min(8, cpus().length)`, `Math.min(99, n)` — магические числа без констант/комментария о происхождении (8 потоков — почему не больше?).
**Fix:** Вынести в именованные константы с комментарием.

### IN-05: `yamlValue` не экранирует ведущие спецсимволы YAML (`-`, `?`, `&`, `*`, `[`)

**File:** `src/main/services/transcript-builder.ts:73-78`
**Issue:** Экранирование срабатывает только на `[:#"\n]`. Имя файла, начинающееся с `- ` или содержащее `&`/`*`/`{`/`[`, может сломать YAML-фронтматтер при последующем парсинге .md другими инструментами. Источник (basename mp4) частично контролируется пользователем (имя файла).
**Fix:** Расширить набор триггеров кавычек или всегда заключать значения в двойные кавычки с полным экранированием.

### IN-06: `formatBytes` в Settings и `formatDuration`/`formatTimecode` дублируются в 3 модулях

**File:** `src/renderer/src/routes/Settings.tsx:46` , `src/renderer/src/lib/transcript-display.ts:16` , `src/main/services/transcript-builder.ts:54` , `src/main/services/transcriber.ts:64`
**Issue:** `formatTimecode`/`formatDuration` реализованы идентично минимум в трёх местах (main builder, transcriber, renderer display). Риск рассинхрона формата таймкодов между авто-сохранённым .md и UI-отображением.
**Fix:** Вынести в общий чистый модуль (shared util без electron-импортов), импортировать в обе стороны.

---

_Reviewed: 2026-06-17T09:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
