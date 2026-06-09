# Phase 3: Local Transcription (Core Value) - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 13 new/modified
**Analogs found:** 11 with strong analog / 13 total (2 partial: model-manager, transcript-builder)

> Phase 3 — структурное зеркало Phase 2 (media-extraction): `utilityProcess.fork(*.cjs)` → `spawn(binary)` → парсинг вывода → progress-event → Result через IPC. Большинство новых файлов копируют один-в-один отлаженный Phase-2-аналог с заменой ffmpeg→whisper. Все цитаты ниже — реальный код Phase 2 с путями и номерами строк.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/shared/ipc.ts` (расширение) | contract | request-response + event | сам файл (`MediaApi`/`MediaProgressEvent`/`MediaReason`) | exact (self-extend) |
| `src/main/services/transcriber.ts` | service | streaming (long-running subprocess) | `src/main/services/media-extractor.ts` | exact |
| `src/main/utilities/whisper-runner.ts` (→`.cjs`) | utility | streaming (stdout+stderr parse) | `src/main/utilities/ffmpeg-runner.ts` | exact |
| `src/main/utilities/whisper-args.ts` | utility | transform (pure fn) | `src/main/utilities/ffmpeg-args.ts` | exact |
| `src/main/services/whisper-paths.ts` | service | file-I/O (path resolve) | `src/main/services/ffmpeg-paths.ts` | exact |
| `src/main/ipc/transcribe.ts` | controller | request-response | `src/main/ipc/media.ts` | exact |
| `src/main/ipc/models.ts` | controller | request-response + event | `src/main/ipc/media.ts` | role-match |
| `src/main/services/model-manager.ts` | service | streaming (fetch→file+SHA) | `media-extractor.ts` (.tmp→rename, job-map) + `node:crypto` | partial (no exact analog) |
| `src/main/services/transcript-builder.ts` | service / utility | transform (segments→md) | нет прямого аналога; `ffmpeg-args.ts` (pure fn style) | partial (no exact analog) |
| `src/main/ipc/index.ts` (расширение) | registry | — | сам файл (`registerMediaHandlers`) | exact (self-extend) |
| `src/preload/index.ts` (расширение) | bridge | request-response + event | сам файл (namespace `media`) | exact (self-extend) |
| `src/renderer/src/routes/Transcribe.tsx` (расширение) | component (route, FSM) | event-driven | сам файл (extract-FSM) | exact (self-extend) |
| `src/renderer/src/components/Transcribe*` (новые) | component | event-driven | `ExtractProgress.tsx` / `ExtractDone.tsx` / `InlineError.tsx` | exact |
| `src/renderer/src/routes/Settings.tsx` (расширение) | component (route) | request-response | сам файл (API-key flow) | exact (self-extend) |
| `package.json` `build:utilities` (расширение) | config | — | сам скрипт (ffmpeg-runner esbuild) | exact (self-extend) |
| `src/main/services/transcriber.test.ts` | test | — | `src/main/services/media-extractor.test.ts` | exact |

---

## Pattern Assignments

### `src/main/services/transcriber.ts` (service, streaming)

**Analog:** `src/main/services/media-extractor.ts` — копировать почти один-в-один. Singleton-класс + экспорт инстанса в конце.

**read_first для планировщика:** `src/main/services/media-extractor.ts` (весь файл, 344 строки — он ≤2000, читать целиком).

**JobHandle + reason-map** (media-extractor.ts:44-68) — добавить `segments`-накопление если нужно, переписать `mapFsErr` под `TranscribeReason`:
```typescript
interface JobHandle {
  jobId: string
  proc: Electron.UtilityProcess
  outPath: string
  cancelled: boolean
  stderrTail: string   // хвост stderr для диагностики exit≠0 (та же роль, что в ffmpeg)
}
function mapFsErr(err: unknown): MediaReason {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return 'file_not_found'
  if (code === 'ENOSPC') return 'disk_full'
  return 'internal'
}
```

**init() — mkdir userData + assertBinaryExists ПЕРЕД любым spawn** (media-extractor.ts:75-89). Для transcriber: создать `userData/models/`, `assertWhisperCli()`:
```typescript
async init(): Promise<void> {
  if (this.initialised) return
  this.cacheDir = join(app.getPath('userData'), 'extracted')   // → 'models' для transcriber
  await fs.mkdir(this.cacheDir, { recursive: true })
  const ffPath = resolveFfmpeg()                               // → resolveWhisperCli()
  assertBinaryExists(ffPath, 'ffmpeg')                         // → assertBinaryExists(cli, 'whisper-cli')
  await ensureExecutable(ffPath)                               // chmod 0o755 на Linux/macOS
  this.initialised = true
}
```

**Core streaming pattern — fork + emit initial progress 0% ДО подписки + start-postMessage on 'spawn'** (media-extractor.ts:192-269). Это сердце сервиса. Для whisper два потока (segment+progress) приходят в одном `proc.on('message')`:
```typescript
const jobId = randomUUID()
const ffmpegPath = resolveFfmpeg()
// 02-06 Gap 3: ПОВТОРНЫЙ assertBinaryExists ПЕРЕД fork (init-throw проглатывается в index.ts).
// Для transcriber: проверять И whisper-cli, И modelPath физически — отсутствие модели → reason 'model_missing'.
try { assertBinaryExists(ffmpegPath, 'ffmpeg') }
catch (err) { console.error(`${LOG_PREFIX} ffmpeg binary missing before fork:`, err); return { ok: false, reason: 'internal' } }

const scriptPath = join(__dirname, 'ffmpeg-runner.cjs')        // → 'whisper-runner.cjs'
const proc = utilityProcess.fork(scriptPath, [], { serviceName: 'scrubber-ffmpeg', stdio: 'pipe' })

// СРАЗУ синхронно — initial progress 0% с jobId, чтобы renderer связал jobId ДО любого cancel (D-09/D-12)
const emitProgress = (percent, etaSec) => {
  const payload = { jobId, percent, etaSec }
  if (onProgress) onProgress(payload)
  else BrowserWindow.getAllWindows()[0]?.webContents.send(Channels.MEDIA_PROGRESS, payload)
}
emitProgress(0, null)
```

**proc.on('spawn') → postMessage start** (media-extractor.ts:261-269). Для whisper передать `{type:'start', cliPath, modelPath, vadModelPath, audioPath, language, threads}`.

**proc.on('message') — для transcriber добавить ветку `type==='segment'`** (расширение media-extractor.ts:271-302). Эталон ветки `progress`:
```typescript
proc.on('message', (msg) => {
  if (!msg) return
  if (msg.type === 'progress') { emitProgress(msg.percent ?? 0, msg.etaSec ?? null); return }
  // НОВОЕ для transcriber (D-11 живой стриминг):
  // if (msg.type === 'segment') { emitSegment({ jobId, startMs: msg.startMs, text: msg.text }); return }
  if (msg.type === 'done' && typeof msg.stderrTail === 'string') {
    const h = this.jobs.get(jobId); if (h) h.stderrTail = msg.stderrTail; return
  }
})
```

**proc.on('exit') — settle + reason-map + .tmp→rename** (media-extractor.ts:304-330). ВНИМАНИЕ на отличие D-13: для whisper после `cancelled` НЕ удаляем накопленный текст (renderer хранит сегменты, может сохранить частичное). Эталон (адаптировать `ffmpeg_failed`→`whisper_failed`):
```typescript
proc.on('exit', (code) => {
  const h = this.jobs.get(jobId); this.jobs.delete(jobId)
  if (h?.cancelled) { /* ffmpeg: unlink tmp; whisper D-13: НЕ удалять, частичное ценно */ settle({ ok: false, reason: 'cancelled' }); return }
  if (code !== 0) { console.error(`... exit code ${code} ... stderr tail:\n${h?.stderrTail}`); settle({ ok: false, reason: 'whisper_failed' }); return }
  // whisper: читать <audio>.json (-oj) → сегменты → transcript-builder → авто-save → settle ok
})
```
Также скопировать `settled`-дедуп резолва (media-extractor.ts:240-245) и `proc.on('error', (type:'FatalError', ...))` → reason `internal` (media-extractor.ts:249-259) — НЕ маскировать V8-fatal под `whisper_failed`.

**cancel() — SIGTERM** (media-extractor.ts:334-340), копировать дословно:
```typescript
cancel(jobId: string): Result {
  const h = this.jobs.get(jobId)
  if (!h) return { ok: false, reason: 'invalid_argument' }
  h.cancelled = true
  h.proc.kill()    // SIGTERM (D-12)
  return { ok: true }
}
```

**Singleton export** (media-extractor.ts:343-344): `export const transcriber = new Transcriber()`.

---

### `src/main/utilities/whisper-runner.ts` → esbuild → `out/main/whisper-runner.cjs` (utility, streaming)

**Analog:** `src/main/utilities/ffmpeg-runner.ts` (весь файл, 120 строк).

**read_first:** `src/main/utilities/ffmpeg-runner.ts`, `src/main/utilities/ffmpeg-args.ts`, и RESEARCH §"segment + progress parsing" (03-RESEARCH.md:403-418).

**CJS-контракт (Pitfall #5/#6): `require`, НЕ ESM; никаких импортов из electron/`src/main/*`** (ffmpeg-runner.ts:22-27):
```javascript
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const { spawn } = require('node:child_process')
const { buildExtractArgs } = require('./ffmpeg-args') as typeof import('./ffmpeg-args')
// → const { buildTranscribeArgs } = require('./whisper-args')
```

**parentPort message + SIGTERM lifecycle** (ffmpeg-runner.ts:44-62) — копировать дословно:
```javascript
const parentPort = (process as any).parentPort
parentPort?.on('message', (e) => {
  const msg = e.data as { type?: string }
  if (msg && msg.type === 'start') startFfmpeg(msg as ...)   // → startWhisper
})
process.on('SIGTERM', () => { if (child) child.kill('SIGTERM') })   // cancel из main
```

**spawn + dual line-buffer** — КЛЮЧЕВОЕ ОТЛИЧИЕ от ffmpeg: ffmpeg парсит ТОЛЬКО stdout (progress), stderr копит в tail (ffmpeg-runner.ts:77-95). whisper парсит ОБА потока: **stdout → сегменты** (regex), **stderr → процент** (regex) + tail. Эталон line-buffer (ffmpeg-runner.ts:77-90), применить к обоим потокам:
```javascript
child = spawn(whisperCliPath, args, { windowsHide: true })
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => { buf += chunk; while ((idx = buf.indexOf('\n')) >= 0) { onStdoutLine(buf.slice(0,idx).trim()); buf = buf.slice(idx+1) } })
child.stderr.setEncoding('utf8')
child.stderr.on('data', (c) => { errBuf += c; /* также: line-buffer для progress-regex */; stderrTail = (stderrTail + c).slice(-2000) })
child.on('exit', (code) => { parentPort?.postMessage({ type: 'done', code, stderrTail /*, jsonPath */ }); process.exit(code ?? 1) })
child.on('error', (err) => { parentPort?.postMessage({ type: 'error', message: err.message }); process.exit(1) })
```

**Regex-парсеры (из 03-RESEARCH.md:403-418):** stdout-сегменты + stderr-процент:
```javascript
const SEG = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(.*)$/
function onStdoutLine(line) { const m = SEG.exec(line); if (!m) return
  const startMs = (+m[1]*3600 + +m[2]*60 + +m[3])*1000 + +m[4]
  parentPort.postMessage({ type: 'segment', startMs, text: m[9] }) }
const PROG = /progress\s*=\s*(\d+)%/
function onStderrLine(line) { const m = PROG.exec(line); if (!m) return
  parentPort.postMessage({ type: 'progress', percent: Math.min(99, +m[1]) }) }   // cap 99, как ffmpeg-parser
```
Note: как ffmpeg-runner инлайнит дубль parseProgressLine (ffmpeg-runner.ts:103-119, сознательное дублирование из-за bundle-границы), так whisper-runner должен инлайнить/импортировать парсеры так, чтобы они покрывались отдельным тестом (`whisper-runner-parse.test.ts`).

---

### `src/main/utilities/whisper-args.ts` (utility, transform — pure fn)

**Analog:** `src/main/utilities/ffmpeg-args.ts` (37 строк, читать целиком).

**read_first:** `src/main/utilities/ffmpeg-args.ts`, 03-RESEARCH.md §"buildTranscribeArgs" (03-RESEARCH.md:376-401), §"VAD Parameters" (03-RESEARCH.md:175-195).

**Контракт чистой функции без импортов electron/main-графа** (ffmpeg-args.ts:1-11). Та же функция используется И в runner (esbuild инлайнит), И в тесте — args не разъезжаются. Эталон сигнатуры (ffmpeg-args.ts:11-36) → переписать тело под whisper-флаги из RESEARCH:
```typescript
export interface TranscribeOpts { modelPath: string; audioPath: string; language: string; vadModelPath: string | null; threads: number }
export function buildTranscribeArgs(o: TranscribeOpts): string[] {
  const args = ['-m', o.modelPath, '-l', o.language, '-pp', '-oj', '-t', String(o.threads), '-f', o.audioPath]
  if (o.vadModelPath) args.push('--vad', '-vm', o.vadModelPath)   // D-14; тюнинг threshold по UAT
  return args
}
```
ВНИМАНИЕ Pitfall 7: WAV из `media.extractAudio` уже PCM 16kHz mono s16le — НЕ ресемплить, подавать через `-f` напрямую.

---

### `src/main/services/whisper-paths.ts` (service, file-I/O)

**Analog:** `src/main/services/ffmpeg-paths.ts` (70 строк, читать целиком).

**read_first:** `src/main/services/ffmpeg-paths.ts`, `electron-builder.yml` (asarUnpack уже содержит `resources/**`).

**ОТЛИЧИЕ от ffmpeg-paths:** ffmpeg-static — npm-пакет (`ffmpegStatic.replace('app.asar','app.asar.unpacked')`, ffmpeg-paths.ts:24-39). whisper-cli — НЕ npm: бинарник лежит в `resources/whisper/<platform-arch>/whisper-cli(.exe)`. Резолв строить от `process.resourcesPath` (packaged) / repo-`resources/` (dev), затем `.replace('app.asar','app.asar.unpacked')` если путь попал внутрь asar. Дополнительно резолвить модель в `userData/models/ggml-<model>.bin`.

**assertBinaryExists — копировать дословно** (ffmpeg-paths.ts:47-57), это тот самый Gap 3 guard:
```typescript
export function assertBinaryExists(p: string, name: string): void {
  if (!existsSync(p)) {
    const msg = `[services/ffmpeg-paths] ${name} binary not found at resolved path: ${p}. ` +
      `Check electron-builder asarUnpack config and ensure 'npm run postinstall' ... completed successfully.`
    console.error(msg); throw new Error(msg)
  }
}
```

**ensureExecutable — chmod 0o755 fallback (win32 no-op)** (ffmpeg-paths.ts:63-69), копировать дословно для Linux/macOS-бинарника (v1.1). Для whisper-cli добавить `resolveModel(name): string` (userData/models) и `assertModelExists` (→ reason `model_missing`).

---

### `src/main/ipc/transcribe.ts` (controller, request-response)

**Analog:** `src/main/ipc/media.ts` (136 строк, читать целиком).

**read_first:** `src/main/ipc/media.ts`, `src/main/ipc/index.ts`.

**Defense-in-depth validation pattern** (media.ts:39-57) — для transcribe валидировать `audioPath`: `typeof string` + `isAbsolute` + `fs.access(R_OK)` (whisper-вход — WAV из userData, не .mp4, так что без `endsWith('.mp4')`):
```typescript
async function validateAudioPath(arg: unknown): Promise<{ok:true;path:string}|{ok:false;reason:TranscribeReason}> {
  if (typeof arg !== 'string' || arg.length === 0) return { ok: false, reason: 'invalid_argument' }
  if (!isAbsolute(arg)) return { ok: false, reason: 'invalid_argument' }
  try { await fs.access(arg, fsc.R_OK) } catch { return { ok: false, reason: 'audio_not_found' } }
  return { ok: true, path: arg }
}
```

**handle-обёртка с try/catch → reason 'internal'** (media.ts:62-135) — каждый handler обёрнут, никаких throw через IPC (Pitfall #7). Эталон (media.ts:102-117):
```typescript
ipcMain.handle(Channels.TRANSCRIBE_START, async (_e, ...args): Promise<Result<{jobId:string}>> => {
  try {
    const v = await validateAudioPath(args[0]); if (!v.ok) return v
    // здесь же: validate opts.model/language; передать в transcriber.startTranscribe
    return await transcriber.startTranscribe(v.path, opts)
  } catch (err) { console.error(`${LOG_PREFIX} start internal error:`, err); return { ok: false, reason: 'internal' } }
})
```

**UUID-regex для cancel** (media.ts:30, 119-135) — копировать дословно:
```typescript
const UUID_REGEX = /^[0-9a-f-]{36}$/i
// в handler TRANSCRIBE_CANCEL:
if (typeof jobId !== 'string' || !UUID_REGEX.test(jobId)) return { ok: false, reason: 'invalid_argument' }
return transcriber.cancel(jobId)
```

**Для saveAs/openFile/reveal (D-05/D-06):** dialog/shell handlers — `dialog.showSaveDialog` (паттерн `dialog.showOpenDialog` media.ts:62-82), `shell.openPath` / `shell.showItemInFolder`. Путь только из доверенного dialog-результата или сгенерированного нами mdPath (Security: НЕ из произвольной renderer-строки).

---

### `src/main/ipc/models.ts` (controller, request-response + event)

**Analog:** `src/main/ipc/media.ts` (role-match — та же handle-обёртка + Result + reason-коды).

**Security-критично (V5, 03-RESEARCH.md:515, 522):** `model-name` — **whitelist** (`small`/`medium`/`large-v3`), НЕ произвольная строка → URL (иначе SSRF). URL строится ТОЛЬКО из pinned-манифеста в main:
```typescript
const MODEL_WHITELIST = new Set(['small','medium','large-v3'])
if (typeof name !== 'string' || !MODEL_WHITELIST.has(name)) return { ok: false, reason: 'invalid_argument' }
```
Делегирует в `model-manager`. `MODELS_PROGRESS` — event-канал (НЕ handle), как `MEDIA_PROGRESS`.

---

### `src/main/services/model-manager.ts` (service, streaming — NO exact analog)

**Closest patterns (partial):**
- **`.tmp→rename`-паттерн** из media-extractor.ts:178-179, 322-330 (скачивать в `userData/models/<name>.bin.tmp`, на успехе `fs.rename` → final, на ошибке/cancel `fs.unlink`).
- **in-memory job-map + cancel** из media-extractor.ts:71, 334-340 (но cancel здесь = `AbortController.abort()` для fetch + unlink .tmp, НЕ SIGTERM).
- **SHA-проверка** — `node:crypto createHash` уже используется в media-extractor.ts:30,58-60 (там sha1 для кеш-ключа; здесь `createHash('sha256')` для целостности по манифесту, D-10).
- **event-progress** — `emitProgress` через `webContents.send(Channels.MODELS_PROGRESS)` (паттерн media-extractor.ts:224-232).

**Манифест URL+SHA256+size** — из 03-RESEARCH.md:160-173 (small/medium/large-v3 + silero VAD). Скачивание: `fetch(url)` → stream в .tmp, прогресс по `Content-Length`, на завершении `createHash('sha256')` → сверка с манифестом → `rename` или `unlink`+reason `sha_mismatch`. Resume НЕ делаем (D-10). Reason-коды: `download_failed`/`sha_mismatch`/`cancelled`/`disk_full`/`internal`.

---

### `src/main/services/transcript-builder.ts` (service / transform — NO exact analog)

**Closest pattern (partial):** pure-fn стиль `ffmpeg-args.ts` (без импортов electron/main-графа, тестируемо изолированно). Это transform: сегменты (из `-oj` JSON) → markdown-строка.

**Контракт (D-01/D-02/D-03, 03-RESEARCH.md:282-283):** YAML-frontmatter (`source`, `model`, `language`, `duration`, `date`) + `# <имя файла>` H1 + тело. Тело: дефолт — склейка `text` в абзацы (D-01); с тумблером — `[ЧЧ:ММ:СС] text` построчно (D-02). Тумблер пересобирает БЕЗ re-run из сохранённых сегментов (сегменты живут в renderer-state). Покрыть `transcript-builder.test.ts` (TRANS-07).

---

### `src/main/services/transcriber.test.ts` (test)

**Analog:** `src/main/services/media-extractor.test.ts` (читать целиком).

**read_first:** `src/main/services/media-extractor.test.ts`, `tests/setup.ts`.

**Паттерны для копирования** (media-extractor.test.ts:10-70):
- Per-file isolated `USER_DATA = join(os.tmpdir(), 'scrubber-test-transcriber', 'userData')` (vitest параллельный).
- `overrideUserDataPath()` — `electron.app.getPath` mockImplementation для `userData` (media-extractor.test.ts:18-27).
- **Мок `whisper-paths`** (зеркало `vi.mock('./ffmpeg-paths', ...)` media-extractor.test.ts:33-38): `resolveWhisperCli`/`resolveModel`/`ensureExecutable`/`assertBinaryExists` (дефолт no-op; отдельный тест подменяет `assertBinaryExists` на throw → reason `internal`).
- **ForkMock** (media-extractor.test.ts:40-46): `postMessage`/`kill`/`on`/`__emit` — эмуляция `utilityProcess.fork` без реального процесса. Покрыть TRANS-05 (cancel→SIGTERM→`cancelled`), TRANS-06 (start не блокирует / fork, не spawn).

---

### Расширения существующих файлов

**`src/shared/ipc.ts`** (self-extend, exact). read_first: весь файл (130 строк).
- В `Channels` добавить (зеркало MEDIA_*, ipc.ts:35-50): `TRANSCRIBE_START/CANCEL/PROGRESS/SEGMENT/SAVE_AS/OPEN/REVEAL`, `MODELS_LIST/DOWNLOAD/CANCEL/DELETE/PROGRESS`. Channels-константы ТОЛЬКО здесь.
- Добавить `TranscribeReason`/`ModelReason` (зеркало `MediaReason` ipc.ts:68-75; точный union — 03-RESEARCH.md:427-432).
- Добавить `TranscribeApi`/`ModelsApi` интерфейсы (зеркало `MediaApi` ipc.ts:108-114; точные сигнатуры — 03-RESEARCH.md:434-449), `onProgress`/`onSegment` возвращают unsubscribe `() => void`.
- В `ScrubberApi` (ipc.ts:120-130) добавить `transcribe: TranscribeApi; models: ModelsApi`.

**`src/preload/index.ts`** (self-extend, exact). read_first: весь файл (50 строк).
- Добавить namespace `transcribe` и `models` в объект `scrubber` — зеркало namespace `media` (preload/index.ts:31-43), включая `onProgress`/`onSegment` через `ipcRenderer.on` + возврат unsubscribe (preload/index.ts:36-42):
```typescript
onProgress: (cb) => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(Channels.TRANSCRIBE_PROGRESS, listener)
  return () => { ipcRenderer.removeListener(Channels.TRANSCRIBE_PROGRESS, listener) }
}
```
Никаких строковых литералов каналов — только `Channels.*`. Никаких `node:*` импортов (sandboxed preload, Pitfall #9).

**`src/main/ipc/index.ts`** (self-extend, exact). Добавить `registerTranscribeHandlers()` + `registerModelsHandlers()` в `registerIpcHandlers()` (index.ts:9-14, комментарий `// future: registerTranscribeHandlers() — Phase 3` уже стоит на строке 12).

**`src/main/index.ts`** — добавить `await transcriber.init()` рядом с `await mediaExtractor.init()` (index.ts:45), в том же try/catch (init-throw проглатывается, поэтому Gap-3 assertBinaryExists перед fork обязателен в самом сервисе).

**`src/renderer/src/routes/Transcribe.tsx`** (self-extend, exact). read_first: весь файл (234 строки).
- Продолжение FSM: после `{ kind: 'done'; audioPath }` (Transcribe.tsx:42) добавить состояния транскрипции: `transcribing` (percent + накопленные segments), `transcript-done`, `transcript-cancelled-partial`, `transcript-error`.
- Паттерн подписки на event-канал через `useEffect` + `stateRef` (Transcribe.tsx:50-73) — скопировать для `transcribe.onProgress` И `transcribe.onSegment` (две подписки, один mount). `stateRef.current = state` для замыкания актуального state в handler.
- Паттерн async-action + Result-маппинг + reason→state (Transcribe.tsx:110-133): `handleTranscribe` зеркалит `handleExtract`; `cancelled` → предложить сохранить частичное (D-13, ОТЛИЧИЕ — не сброс в idle, а partial-save).
- `handleCancel` (Transcribe.tsx:135-140) → `transcribe.cancel(jobId)`.

**`src/renderer/src/components/Transcribe*` (новые)** — exact analog по компонентам:
- `TranscribeProgress.tsx` ← `ExtractProgress.tsx` (весь файл): stateless `role="progressbar"` + `aria-valuenow` + clamp + Cancel-кнопка (ExtractProgress.tsx:21-51). Добавить под баром область живого стриминга сегментов (D-11).
- `TranscriptResult.tsx` ← `ExtractDone.tsx` (ExtractDone.tsx:19-57): `role="status"` карточка + кнопки. Заменить «Скопировать путь» на «Сохранить как» / «Открыть файл» / «Показать в папке» (D-06 — теперь shell-handlers есть в этой фазе).
- `TimecodeToggle.tsx` — новый, тумблер `[ЧЧ:ММ:СС]` (D-02), пересборка из сегментов в renderer-state без IPC.
- Ошибки ← `InlineError.tsx` (InlineError.tsx:18-29): `REASON_COPY: Record<TranscribeReason, string>` — точные РУССКИЕ копи, каждая уникальна (тест `new Set(texts).size === N`), `role="alert"`. Для `model_missing` — копи с отсылкой в Settings (D-09).

**`src/renderer/src/routes/Settings.tsx`** (self-extend, exact). read_first: весь файл. Добавить раздел «Модели»: список small/medium/large-v3 с размерами + статус «скачана/нет» + кнопки «Скачать»(прогресс+отмена)/«Удалить» (D-09). Использовать паттерн `useEffect`-загрузки + Result-маппинг + `Status`-union (Settings.tsx:14-38). Сохранение выбора модели/языка/тумблера через расширенный settings-store.

**`src/main/services/settings-store.ts`** — расширить `SettingsSchema` (settings-store.ts:15-17): добавить `selectedModel?: string` (дефолт `medium`), `selectedLanguage?: string` (`ru`), `timecodesEnabled?: boolean` (false). Класс уже generic — менять только интерфейс схемы.

**`package.json` → `scripts.build:utilities`** (self-extend, exact). Текущий: `esbuild src/main/utilities/ffmpeg-runner.ts --bundle ... --outfile=out/main/ffmpeg-runner.cjs --external:electron`. Добавить второй esbuild-инвок для `whisper-runner.ts` → `out/main/whisper-runner.cjs` (те же флаги).

---

## Shared Patterns

### Result-тип на все IPC-мутации (никаких throw через границу)
**Source:** `src/shared/ipc.ts:22-26`
**Apply to:** все handlers в `ipc/transcribe.ts`, `ipc/models.ts`, все методы `transcriber.ts`/`model-manager.ts`
```typescript
export type Result<T = void> = { ok: true; data?: T } | { ok: false; reason: string }
```
Каждый handler — `try { ... } catch (err) { console.error(...); return { ok: false, reason: 'internal' } }` (media.ts:62-82).

### assertBinaryExists перед fork (Gap 3 — defense-in-depth)
**Source:** `src/main/services/ffmpeg-paths.ts:47-57` + `src/main/services/media-extractor.ts:199-205`
**Apply to:** `transcriber.startTranscribe` (проверять whisper-cli И modelPath ПЕРЕД `utilityProcess.fork`). Отсутствие бинарника → `internal`; отсутствие модели → `model_missing` (UI: «скачайте в Settings»). init-throw проглатывается в `index.ts`, поэтому повторная проверка перед fork обязательна.

### utilityProcess.fork для long-running subprocess (НЕ spawn в main)
**Source:** `src/main/services/media-extractor.ts:209-212` + `src/main/utilities/ffmpeg-runner.ts` (весь, CJS)
**Apply to:** `transcriber.ts` + `whisper-runner.cjs`. Один активный job (D-12), cancel = SIGTERM (media-extractor.ts:334-340 + ffmpeg-runner.ts:60-62). Utility-скрипт — CJS (`require`, Pitfall #6), бандлится esbuild'ом, без импортов electron/main-графа.

### Event-канал прогресса (webContents.send → ipcRenderer.on → unsubscribe)
**Source:** main-side `media-extractor.ts:224-232`; preload-side `src/preload/index.ts:36-42`; renderer-side `Transcribe.tsx:56-73`
**Apply to:** `TRANSCRIBE_PROGRESS`, `TRANSCRIBE_SEGMENT`, `MODELS_PROGRESS`. Канал-константа только в `shared/ipc.ts`; preload возвращает unsubscribe; renderer подписывается в `useEffect` один раз на mount с `stateRef` для актуального state.

### .tmp→rename атомарность для файлов на диске
**Source:** `src/main/services/media-extractor.ts:178-179, 322-330`
**Apply to:** `model-manager.ts` (скачивание .bin), `transcriber.ts` (если кеш transcript.md по hash). Писать в `<final>.tmp`, на успехе `fs.rename`, на ошибке/cancel `fs.unlink`. Никогда не отдавать частично-записанный файл как готовый.

### Defense-in-depth валидация входа в main (V4/V5)
**Source:** `src/main/ipc/media.ts:39-57` (path) + `media.ts:30,125` (UUID-regex)
**Apply to:** `transcribe.ts` (audioPath: isAbsolute + fs.access), `models.ts` (model-name: **whitelist**, НЕ произвольная строка → URL — анти-SSRF). jobId — UUID-regex `/^[0-9a-f-]{36}$/i`.

### Точные русские user-facing копи + reason-маппинг
**Source:** `src/renderer/src/components/InlineError.tsx:18-29` (`REASON_COPY: Record<MediaReason, string>`)
**Apply to:** все user-facing строки Phase 3 (D-/specifics: всё на русском). Каждая reason-копи уникальна (unit-тест `new Set(...).size`). Структурированный console-вывод в main: `[ipc/transcribe]`, `[services/transcriber]`, `[services/model-manager]` (паттерн `LOG_PREFIX`).

### asarUnpack для нативных бинарников (Pitfall #1)
**Source:** `electron-builder.yml:12-19` (УЖЕ содержит `resources/**`)
**Apply to:** `resources/whisper/win32-x64/` (whisper-cli.exe + ВСЕ DLL — Pitfall 1 RESEARCH: DLL обязаны лежать рядом с .exe). `whisper-paths.resolveWhisperCli` правит путь `app.asar → app.asar.unpacked` как `ffmpeg-paths` (ffmpeg-paths.ts:28). Packaged smoke-тест обязателен (расширить `scripts/smoke-packaged.mjs`).

---

## No Analog Found

Файлы без точного аналога в кодовой базе (планировщик использует RESEARCH.md + указанные partial-паттерны):

| File | Role | Data Flow | Reason | Partial guidance |
|------|------|-----------|--------|------------------|
| `src/main/services/model-manager.ts` | service | streaming (network fetch + SHA) | Нет сетевого-скачивания в кодовой базе (Phase 1/2 были офлайн) | .tmp→rename + job-map + cancel из media-extractor; `createHash('sha256')` из node:crypto; манифест 03-RESEARCH.md:160-173 |
| `src/main/services/transcript-builder.ts` | service | transform (segments→markdown) | Нет генерации .md в кодовой базе (Phase 4 будет analysis.md) | pure-fn стиль ffmpeg-args.ts; формат D-01/D-02/D-03, 03-RESEARCH.md:282-283 |

---

## Metadata

**Analog search scope:** `src/shared/`, `src/main/services/`, `src/main/utilities/`, `src/main/ipc/`, `src/preload/`, `src/renderer/src/routes/`, `src/renderer/src/components/`, `electron-builder.yml`, `package.json`
**Files scanned (read in full):** ipc.ts, media-extractor.ts, ffmpeg-runner.ts, ffmpeg-args.ts, ffmpeg-paths.ts, progress-parser.ts, media.ts, ipc/index.ts, preload/index.ts, settings-store.ts, Transcribe.tsx, ExtractProgress.tsx, ExtractDone.tsx, InlineError.tsx, media-extractor.test.ts (head), Settings.tsx (head), electron-builder.yml, main/index.ts (init wiring)
**Pattern extraction date:** 2026-06-09
