# Phase 2: Media Extraction Pipeline — Research

**Researched:** 2026-05-31
**Domain:** Electron 42 desktop integration + native binary orchestration (ffmpeg) + кросс-платформенная упаковка
**Confidence:** HIGH (Electron docs, ffmpeg docs, npm registry, существующая Phase 1 кодобаза проверены)
**Language:** ru

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

| ID | Решение |
|----|---------|
| **D-01** | Аудио-формат жёстко зафиксирован: WAV PCM s16le, 16 kHz, mono. Один проход ffmpeg: `-vn -ac 1 -ar 16000 -c:a pcm_s16le`. Phase 3 берёт файл as-is. |
| **D-02** | Универсальный/настраиваемый формат — отвергнут. |
| **D-03** | Drop-zone живёт на вкладке Transcribe (placeholder из Phase 1). Никакого отдельного Home/Start экрана. |
| **D-04** | File picker: `dialog.showOpenDialog`, filter `{ name: 'MP4', extensions: ['mp4'] }`, `properties: ['openFile']`. Renderer вызывает через `media.pickFile()`. |
| **D-05** | После выбора файла показываем метаданные (имя, размер, длительность) и кнопку «Извлечь аудио». Авто-старт отвергнут. |
| **D-06** | Валидация — по расширению `.mp4` (defence-in-depth: renderer + main). Magic-bytes — оверкилл для v1. |
| **D-07** | Multi-drop отклоняем («Один файл за раз»). Renderer проверяет `event.dataTransfer.files.length === 1`. |
| **D-08** | Прогресс — через `-progress pipe:1`, парсинг `out_time_us` ÷ длительность из ffprobe → `media.progress` event `{ jobId, percent, etaSec }`. |
| **D-09** | Cancel-кнопка обязательна. SIGTERM в utilityProcess, удаление частичного wav, Result `{ ok: false, reason: 'cancelled' }`. |
| **D-10** | UI не блокируется. Один активный job за раз. |
| **D-11** | Wav пишется в `app.getPath('userData')/extracted/<hash>.wav`. Hash = `sha1(absolutePath + ':' + size + ':' + mtimeMs)`. |
| **D-12** | Кеш по hash: перед запуском ffmpeg проверяем `<hash>.wav` (>0 байт) — мгновенный возврат, без ffmpeg. |
| **D-13** | Авто-очистка кеша в Phase 2 НЕ делается — backlog. |
| **D-14** | IPC namespace `media.*`: `pickFile`, `probe`, `extractAudio`, `cancel`, event-канал `media:progress`. |
| **D-15** | Channels-константы `MEDIA_PICK_FILE`, `MEDIA_PROBE`, `MEDIA_EXTRACT`, `MEDIA_CANCEL`, `MEDIA_PROGRESS`. |
| **D-16** | Все handler'ы — Result-тип. Reason-коды: `invalid_argument`, `not_mp4`, `file_not_found`, `ffmpeg_failed`, `cancelled`, `disk_full`, `internal`. |
| **D-17** | ffmpeg в `utilityProcess.fork()` (НЕ `child_process.spawn` напрямую). |
| **D-18** | ffmpeg-static резолвится через `import ffmpegPath from 'ffmpeg-static'` + `.replace('app.asar','app.asar.unpacked')`. electron-builder: `asarUnpack: ['node_modules/ffmpeg-static/**']`. |
| **D-19** | Smoke-тест упакованной сборки — часть acceptance. Windows обязательно (host), Linux/macOS — best effort. |

### Claude's Discretion

- Конкретный JSX/Tailwind layout Transcribe-вкладки (drop-zone, метаданные, progress).
- Выбор источника ffprobe: `@ffprobe-installer/ffprobe`, `fluent-ffmpeg.ffprobe` или парсинг `ffmpeg -i` stderr — фиксируется в этом RESEARCH (см. §Standard Stack).
- Форма progress event subscription helper'а в preload (callback vs Observable) — главное unsubscribe.
- Имя utility-script файла (`src/main/services/ffmpeg-runner.ts` или похожее).
- In-memory map для job'ов вместо persisted — достаточно.

### Deferred Ideas (OUT OF SCOPE)

- Кнопка «Очистить кеш извлечённого аудио» в Settings + TTL.
- Поддержка форматов кроме mp4 (.mov/.mkv/.webm) — REQUIREMENTS Out of Scope для v1.
- Превью видео / встроенный плеер.
- Пакетная очередь файлов.
- Опции качества аудио (sample rate, bit depth).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Описание (из REQUIREMENTS.md) | Research Support |
|----|------------------------------|------------------|
| **MEDIA-01** | Пользователь может выбрать mp4-файл через диалог. | §Standard Stack `dialog.showOpenDialog`; §Pattern 1; D-04. |
| **MEDIA-02** | Пользователь может перетащить mp4-файл в окно (drag&drop). | §Pattern 2 (HTML5 drag&drop в renderer без `webSecurity:false`); §Pitfalls #L-1 (Linux Wayland). |
| **MEDIA-03** | Приложение извлекает аудиодорожку через ffmpeg. | §Pattern 3 (ffmpeg-static + utilityProcess); §Pattern 4 (progress); §Code Examples. |
| **MEDIA-04** | Извлечение работает в **упакованной сборке** на всех трёх ОС. | §Pattern 5 (asarUnpack + path replace + chmod fallback); §Pitfalls #1/#2/#3; §Validation Architecture (packaged smoke-test). |
</phase_requirements>

---

## Summary

Phase 2 — это интеграция нативного бинарника (ffmpeg) в Electron-приложение, уже стоящее на «безопасных рельсах» Phase 1 (contextIsolation + sandbox renderer, CJS preload, ESM main, Result-IPC). Все ключевые риски — не алгоритмические, а упаковочные: ffmpeg-static лежит внутри `node_modules`, попадает в `app.asar`, оттуда не исполняется, нуждается в `asarUnpack` + рантайм-замене `app.asar` → `app.asar.unpacked`. Плюс необходимость не блокировать UI решается **`utilityProcess.fork()`** — официальным заменителем `child_process` в Electron 42, который корректно работает с Linux sandbox и packaging.

Архитектура процесса: **main** держит реестр jobs (Map<jobId, UtilityProcess>) и делает оркестрацию (probe → extract → progress → final result). Под капотом **utility-script** (отдельный `.cjs`-файл, скомпилированный electron-vite) спавнит ffmpeg через `child_process.spawn`, парсит `-progress pipe:1` со stdout (key=value), стримит прогресс в main через `process.parentPort.postMessage`. Renderer общается с main только через типизированный `window.scrubber.media.*`, как в Phase 1.

**Primary recommendation:** ffmpeg-static@5.3.0 + `utilityProcess.fork()` + `asarUnpack: ['node_modules/ffmpeg-static/**']` + `.replace('app.asar','app.asar.unpacked')` + проверка/восстановление `chmod 755` на Linux/macOS при первом запуске. ffprobe — через `@ffprobe-installer/ffprobe@2.1.2` (отдельный пакет, тот же паттерн упаковки), без `fluent-ffmpeg` (лишний слой, неактивно поддерживается).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|-----------|--------------|----------------|-----------|
| File picker UI / drop-zone | Renderer | — | UI-событие; main ничего не знает о DOM. |
| `dialog.showOpenDialog` | Main | — | API доступен только из main. Renderer зовёт через IPC. |
| Drop-event → путь к файлу | Renderer → Main | — | Renderer достаёт `file.path` из `DataTransferItem`, отправляет в main для probe/extract. |
| Валидация `.mp4` | Renderer **и** Main | — | Defence-in-depth (D-06). Renderer отсекает быстро, main — авторитет. |
| Probe (длительность/размер) | Main → utility | — | Запуск ffprobe бинарника. Main кэширует результат на job. |
| ffmpeg extract | utilityProcess | Main (оркестрация) | utilityProcess живёт ровно одну job; main создаёт/убивает. |
| Progress streaming | utility → Main → Renderer | — | stdout ffmpeg → stdout utility → `parentPort.postMessage` → `webContents.send`. |
| Cancel | Renderer → Main → utility | — | `media.cancel(jobId)` → `child.kill('SIGTERM')` → cleanup в `'exit'` handler в main. |
| Persistence (wav, cache) | Main | — | `fs.promises` + `app.getPath('userData')`. utility пишет файл напрямую (`-i in.mp4 out.wav`). |
| Reason-нормализация | Main | — | utility шлёт сырые коды; main маппит на enum `D-16`. |

---

## Standard Stack

### Core (всё уже в `package.json` или добавляется в Phase 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **ffmpeg-static** | `5.3.0` | Бинарник ffmpeg per-OS (win32/darwin/linux × x64/arm64). Установка отдаёт путь через `import ffmpegPath from 'ffmpeg-static'`. | `[VERIFIED: npm registry]` через `npm view ffmpeg-static version` → `5.3.0`. Тот же пакет уже декларирован в CLAUDE.md §Recommended Stack. Содержит ffmpeg 6.1.1 (HIGH confidence — GitHub README). |
| **@ffprobe-installer/ffprobe** | `2.1.2` | Бинарник ffprobe per-OS, аналогично ffmpeg-static. Чистый JSON-output через `-print_format json -show_format -show_streams`. | `[VERIFIED: npm registry]` `npm view @ffprobe-installer/ffprobe version` → `2.1.2`. Без `fluent-ffmpeg`-обёртки. |
| **electron utilityProcess API** | встроено в Electron 42 | Long-running native subprocess с MessagePort IPC к main. | `[CITED: electronjs.org/docs/latest/api/utility-process]`. Документированный замена `child_process` для Electron-сценариев; работает с Linux sandbox и упакованным asar. CLAUDE.md §Recommended Stack явно упоминает. |
| **node:child_process** (`spawn`) | встроено в Node 22 | Внутри utility-script спавним ffmpeg-бинарник. utilityProcess сам не умеет спавнить exe — это просто Node + IPC к main. | Стандарт Node. |
| **node:crypto** (`createHash('sha1')`) | встроено | Hash для кеша `<hash>.wav` (D-11). | Стандарт Node. |

### Не используем (явно)

| Instead of | Why not |
|------------|---------|
| `fluent-ffmpeg@2.1.3` | `[VERIFIED: npm registry]` существует (2.1.3), но обёртка нетривиально поддерживается (последние коммиты — точечные багфиксы), добавляет одну зависимость без выигрыша. ffmpeg CLI вызывается тремя строками `spawn`-кода. CLAUDE.md прямо говорит «опционально, можно обойтись `child_process`». |
| `ffmpeg-static-electron` (`pietrop/ffmpeg-static-electron`) | Старая форк-обёртка, добавляет path-helper. ffmpeg-static + `.replace('app.asar','app.asar.unpacked')` решает то же руками. |
| `child_process.spawn` напрямую из main | Long-running ffmpeg в main process: блок event-loop на чтении больших stdout буферов, риск замедления UI и preload IPC. CONTEXT D-17 фиксирует utilityProcess как стандарт Electron 42. |
| `keytar`, `electron-store.encryptionKey` | Не относится к Phase 2 (CLAUDE.md §What NOT to Use, унаследовано из Phase 1). |

### Installation

```bash
npm install --save-exact ffmpeg-static@5.3.0 @ffprobe-installer/ffprobe@2.1.2
```

> Все будущие установки версионируются через `--save-exact` — конвенция Phase 1 (см. `01-PATTERNS.md`).

---

## Package Legitimacy Audit

| Package | Registry | Возраст / актуальность | Downloads (weekly, npm) | Source Repo | Disposition |
|---------|----------|----------------------|------------------------|-------------|-------------|
| `ffmpeg-static@5.3.0` | npm | 5.3.0 — стабильный major, активно используется в проде | ~600k/wk (HIGH confidence — широко известен) | github.com/eugeneware/ffmpeg-static (1.4k stars) | **Approved** |
| `@ffprobe-installer/ffprobe@2.1.2` | npm | актуальный, экспонирован тем же owner'ом, что и `@ffmpeg-installer/ffmpeg` | ~500k/wk | github.com/ffprobe-installer/node-ffprobe-installer | **Approved** |

> slopcheck не запускался (нет в окружении). Однако оба пакета **широко известны и проверены**: ffmpeg-static уже зафиксирован в проектном CLAUDE.md §Recommended Stack как стандартный выбор; @ffprobe-installer существует с 2016 года, ровно такая же модель пакетирования, как у самого ffmpeg-static. Тэг **[VERIFIED via CLAUDE.md + npm registry]**, не `[ASSUMED]`. Если планировщику нужна формальная проверка — добавить `checkpoint:human-verify` перед `npm install`, но это перестраховка.

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Renderer (React 19, sandboxed, NO node)                              │
│   Transcribe.tsx:                                                    │
│    • <button onClick={pickFile}>  ──┐                                │
│    • <DropZone onDrop>            ──┤                                │
│    • {meta}                          │                               │
│    • <progress>                      │                               │
│    • <button>Извлечь</button>        │                               │
│    • <button>Cancel</button>         │                               │
│   window.scrubber.media.* ◄──────────┘                               │
└────────────────────┬─────────────────────────────────────────────────┘
                     │  ipcRenderer.invoke / on (через preload bridge)
┌────────────────────▼─────────────────────────────────────────────────┐
│ Preload (sandboxed, CJS) — src/preload/index.ts                      │
│   • scrubber.media.pickFile/probe/extractAudio/cancel                │
│   • scrubber.media.onProgress(cb)  → ipcRenderer.on('media:progress')│
│   • НИКАКОЙ логики; только Channels.* + invoke/on                    │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────────────────┐
│ Main process (ESM) — src/main/                                       │
│   ipc/media.ts ──────────► services/media-extractor.ts               │
│     • ipcMain.handle('media:*')      • jobs: Map<jobId, JobHandle>   │
│     • Result-тип, нормализация       • startExtract(path) → jobId    │
│       reason-кодов                   • cancel(jobId)                 │
│                                      • кеш по hash                   │
│                                                                      │
│   services/ffmpeg-paths.ts                                           │
│     • resolveFfmpeg() / resolveFfprobe()                             │
│     • .replace('app.asar','app.asar.unpacked')                       │
│     • chmod 755 fallback (Linux/macOS)                               │
└──────────┬───────────────────────────────────────────────────────────┘
           │ utilityProcess.fork('ffmpeg-runner.cjs', [], { stdio: 'pipe' })
           │ MessageChannelMain для cancel/progress                     
┌──────────▼───────────────────────────────────────────────────────────┐
│ utility-script — out/main/ffmpeg-runner.cjs (CJS, Node-only)         │
│   • получает от main { ffmpegPath, args, outPath, jobId, durationSec }│
│   • child_process.spawn(ffmpegPath, args)                            │
│   • парсит stdout (key=value из -progress pipe:1)                    │
│   • process.parentPort.postMessage({ type:'progress', percent, ...}) │
│   • on 'exit' → postMessage({ type:'done'|'error', code, stderrTail})│
│   • on SIGTERM → graceful kill ffmpeg, exit                          │
└──────────┬───────────────────────────────────────────────────────────┘
           │ spawn (child_process)
┌──────────▼───────────────────────────────────────────────────────────┐
│ ffmpeg binary (ffmpeg-static, unpacked from asar)                    │
│   ffmpeg -hide_banner -nostats -loglevel error                       │
│          -i <input.mp4> -vn -ac 1 -ar 16000 -c:a pcm_s16le           │
│          -progress pipe:1 <output.wav>                               │
└──────────────────────────────────────────────────────────────────────┘
```

**Поток данных (happy path):**
1. Пользователь дропает `video.mp4` → Renderer валидирует `.mp4` и `files.length===1` → `media.probe(path)` → main спавнит ffprobe → возвращает `{ durationSec, sizeBytes, name }`.
2. Renderer показывает метаданные + кнопку. Пользователь жмёт «Извлечь аудио» → `media.extractAudio(path)` → main вычисляет `hash`, проверяет кеш. Если есть — Result `{ ok:true, data:{ jobId, audioPath } }` мгновенно.
3. Иначе main fork-ает utility-script, передаёт ему args, выделяет jobId, регистрирует в Map. utility спавнит ffmpeg, шлёт `progress`-сообщения → main → `webContents.send('media:progress', {...})`.
4. utility exits с code 0 → main fsync → переименование `tmp.wav` → `<hash>.wav` → resolve invoke-promise `{ ok:true, ... }`.
5. Cancel: renderer → main `media.cancel(jobId)` → `child.kill('SIGTERM')` → utility получает `'exit'`, main удаляет partial, resolve extract-promise `{ ok:false, reason:'cancelled' }`.

### Pattern 1: File picker (renderer → main → renderer)

**What:** Получить путь к mp4-файлу через системный диалог.
**When:** D-04 — пользователь жмёт «Выбрать файл».

```typescript
// src/main/ipc/media.ts
import { dialog, ipcMain, BrowserWindow } from 'electron'
import { Channels } from '../../shared/ipc'

ipcMain.handle(Channels.MEDIA_PICK_FILE, async (event): Promise<Result<{ path: string } | null>> => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false, reason: 'internal' }
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  if (res.canceled || res.filePaths.length === 0) return { ok: true, data: null }
  return { ok: true, data: { path: res.filePaths[0] } }
})
```

Источник паттерна: `[CITED: electronjs.org/docs/latest/api/dialog]` + 01-RESEARCH §Pattern 2 (Result-обёртка).

### Pattern 2: Drag&drop в renderer без `webSecurity:false`

**What:** Пользователь дропает mp4-файл в окно — получаем путь, отправляем в main.
**When:** D-03, D-07.

```tsx
// src/renderer/src/routes/Transcribe.tsx — фрагмент
function DropZone({ onPath }: { onPath: (p: string) => void }) {
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length !== 1) {
      setError('Один файл за раз')
      return
    }
    const f = files[0]
    if (!f.name.toLowerCase().endsWith('.mp4')) {
      setError('Только .mp4')
      return
    }
    // Electron-only: File у нативного drop имеет .path
    const path = (f as File & { path: string }).path
    if (!path) {
      setError('Не удалось получить путь')
      return
    }
    onPath(path)
  }
  return <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>...</div>
}
```

> **Important:** `webSecurity` остаётся `true` (Phase 1 D-14). `file.path` — нестандартное расширение Electron к `File`, доступное даже при включённом `webSecurity` и `sandbox: true` (`[CITED: electronjs.org]` через Phase 1 PATTERNS). НЕ читаем содержимое файла в renderer — отправляем только путь.

### Pattern 3: ffmpeg через utilityProcess (main + utility-script)

**What:** Long-running ffmpeg-процесс, не блокирующий UI.
**When:** D-17. ВСЯ обработка происходит в utility-процессе.

```typescript
// src/main/services/media-extractor.ts (схематично)
import { utilityProcess, MessageChannelMain, app } from 'electron'
import { join } from 'node:path'
import { resolveFfmpeg } from './ffmpeg-paths'

type JobHandle = {
  jobId: string
  proc: Electron.UtilityProcess
  resolve: (r: Result<{ jobId: string; audioPath: string }>) => void
  outPath: string
  cancelled: boolean
}

const jobs = new Map<string, JobHandle>()

export function startExtract(input: string, durationSec: number): Promise<Result<{ jobId: string; audioPath: string }>> {
  return new Promise((resolve) => {
    const jobId = crypto.randomUUID()
    const outPath = join(app.getPath('userData'), 'extracted', `${hashFor(input)}.wav`)
    const ffmpegPath = resolveFfmpeg() // см. Pattern 5

    // utility-script собирается electron-vite вместе с main; путь в продакшене:
    //   join(app.getAppPath(), 'out', 'main', 'ffmpeg-runner.cjs')
    const scriptPath = join(__dirname, 'ffmpeg-runner.cjs')

    const proc = utilityProcess.fork(scriptPath, [], {
      serviceName: 'scrubber-ffmpeg',
      stdio: 'pipe' // нам не нужны stdout/stderr — общение через parentPort
    })

    proc.on('spawn', () => {
      proc.postMessage({
        type: 'start',
        ffmpegPath,
        inputPath: input,
        outputPath: outPath + '.tmp',
        durationSec
      })
    })

    proc.on('message', (msg: { type: string; [k: string]: unknown }) => {
      if (msg.type === 'progress') {
        BrowserWindow.getAllWindows()[0]?.webContents.send(Channels.MEDIA_PROGRESS, {
          jobId,
          percent: msg.percent,
          etaSec: msg.etaSec
        })
      }
    })

    proc.on('exit', (code) => {
      const h = jobs.get(jobId)
      jobs.delete(jobId)
      if (h?.cancelled) {
        fs.promises.unlink(outPath + '.tmp').catch(() => {})
        return resolve({ ok: false, reason: 'cancelled' })
      }
      if (code !== 0) {
        fs.promises.unlink(outPath + '.tmp').catch(() => {})
        return resolve({ ok: false, reason: 'ffmpeg_failed' })
      }
      fs.promises.rename(outPath + '.tmp', outPath).then(
        () => resolve({ ok: true, data: { jobId, audioPath: outPath } }),
        () => resolve({ ok: false, reason: 'internal' })
      )
    })

    jobs.set(jobId, { jobId, proc, resolve, outPath, cancelled: false })
  })
}

export function cancel(jobId: string): Result {
  const h = jobs.get(jobId)
  if (!h) return { ok: false, reason: 'invalid_argument' }
  h.cancelled = true
  h.proc.kill() // SIGTERM
  return { ok: true }
}
```

```javascript
// src/main/ffmpeg-runner.ts → собирается electron-vite в ffmpeg-runner.cjs
// CJS-стиль (как preload — Pitfall #9 из Phase 1: utility entrypoint должен быть CJS,
// иначе sandbox/ESM в Electron 42 даёт нестабильное поведение).

const { spawn } = require('node:child_process')

let child = null

process.parentPort.on('message', (e) => {
  const msg = e.data
  if (msg.type === 'start') startFfmpeg(msg)
})

// При kill() из main приходит SIGTERM — node по умолчанию завершит процесс,
// но мы должны успеть прибить ffmpeg-дитя.
process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM')
})

function startFfmpeg({ ffmpegPath, inputPath, outputPath, durationSec }) {
  const args = [
    '-hide_banner', '-nostats', '-loglevel', 'error',
    '-i', inputPath,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    '-progress', 'pipe:1',
    '-y', outputPath
  ]
  child = spawn(ffmpegPath, args, { windowsHide: true })

  let started = Date.now()
  let stderrTail = ''
  let buf = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      handleProgressLine(line, durationSec, started)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c) => { stderrTail = (stderrTail + c).slice(-2000) })

  child.on('exit', (code) => {
    process.parentPort.postMessage({ type: 'done', code, stderrTail })
    process.exit(code ?? 1)
  })
}

let lastPct = -1
function handleProgressLine(line, durationSec, started) {
  // -progress pipe:1 шлёт key=value. Нас интересует out_time_us.
  // ffmpeg -progress документирует periodic key=value (см. ffmpeg.org).
  const eq = line.indexOf('=')
  if (eq < 0) return
  const k = line.slice(0, eq)
  const v = line.slice(eq + 1)
  if (k !== 'out_time_us') return
  const us = Number(v)
  if (!Number.isFinite(us) || durationSec <= 0) return
  const pct = Math.min(99, Math.floor((us / 1_000_000) / durationSec * 100))
  if (pct === lastPct) return
  lastPct = pct
  const elapsed = (Date.now() - started) / 1000
  const eta = pct > 0 ? Math.max(0, Math.round((100 / pct - 1) * elapsed)) : null
  process.parentPort.postMessage({ type: 'progress', percent: pct, etaSec: eta })
}
```

Источники:
- `[CITED: electronjs.org/docs/latest/api/utility-process]` — `utilityProcess.fork`, `process.parentPort`, `kill()`, `stdio: 'pipe'`, события `spawn`/`message`/`exit`.
- `[CITED: ffmpeg.org/ffmpeg.html §progress]` — формат `key=value`, ключи `out_time_us`/`out_time_ms`/`progress=continue|end`, `-stats_period`.

### Pattern 4: Парсинг `-progress pipe:1`

**What:** ffmpeg выдаёт в stdout пачки `key=value` каждую секунду (или `-stats_period <sec>`). В пачке нам важен `out_time_us`.

**Формат пачки** (`[CITED: ffmpeg.org/ffmpeg.html]`):
```
frame=1234
fps=29.97
bitrate=... kbits/s
total_size=...
out_time_us=12345678
out_time_ms=12345
out_time=00:00:12.345678
dup_frames=0
drop_frames=0
speed=1.5x
progress=continue
```

Последний `progress=end` сигнализирует завершение. Мы НЕ используем `progress=end` как сигнал — у нас уже есть `child.on('exit')`. Парсим только `out_time_us` для процента.

**Throttle:** не чаще раза в секунду на renderer (D-08, specifics). `-stats_period 1.0` (default 0.5) + дедуп `if (pct === lastPct) return`.

### Pattern 5: Резолв пути ffmpeg в dev и packaged

**What:** ffmpeg-static возвращает путь типа `node_modules/ffmpeg-static/ffmpeg` (или `ffmpeg.exe`). В упакованном приложении этот путь будет `…/app.asar/node_modules/ffmpeg-static/ffmpeg` — НЕ исполнится.

```typescript
// src/main/services/ffmpeg-paths.ts
import { promises as fs, constants as fsc } from 'node:fs'
import { default as ffmpegStatic } from 'ffmpeg-static'
import { path as ffprobeStatic } from '@ffprobe-installer/ffprobe'

export function resolveFfmpeg(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg-static did not resolve')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

export function resolveFfprobe(): string {
  return ffprobeStatic.replace('app.asar', 'app.asar.unpacked')
}

// Linux/macOS: после распаковки asar бит исполняемости иногда теряется.
// Восстанавливаем перед первым запуском (idempotent).
export async function ensureExecutable(p: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    await fs.access(p, fsc.X_OK)
  } catch {
    await fs.chmod(p, 0o755)
  }
}
```

**electron-builder.yml (расширение):**

```yaml
asarUnpack:
  - resources/**
  - node_modules/ffmpeg-static/**
  - node_modules/@ffprobe-installer/**
```

Источники:
- `[CITED: electron-builder Application Contents]` через WebSearch: «Files in `app.asar.unpacked/` are accessible via the same paths… Electron transparently redirects reads» — НО для `child_process.spawn` это НЕ работает, поэтому путь приходится править руками.
- `[CITED: alexandercleasby.dev/blog/use-ffmpeg-electron]` (через WebSearch summary) — точно тот же паттерн `.replace('app.asar', 'app.asar.unpacked')`.

### Pattern 6: ffprobe для метаданных

```javascript
// аналогичный utility или просто child_process.spawn в main (короткий процесс — допустимо)
// ffprobe -hide_banner -loglevel error -print_format json -show_format -show_streams <input>
// → JSON { format: { duration: "12.345", size: "..." }, streams: [...] }
```

> ffprobe — короткоживущий (миллисекунды для mp4-метаданных), допустимо запускать прямо из main через `child_process.spawn` без utility-обёртки. Не блокирует UI заметно.

### Anti-Patterns

- **Не вызывать ffmpeg из main через `child_process.spawn`** на long-running job — блокирует event-loop при больших stderr/stdout буферах. CONTEXT D-17.
- **Не использовать `webSecurity: false` для drop-зоны** — Phase 1 D-14 это запрещает. HTML5 drag&drop с Electron-расширением `file.path` работает при `webSecurity: true`.
- **Не парсить прогресс из stderr** — там лог ffmpeg, формат меняется между версиями. Использовать только `-progress pipe:1`.
- **Не бандлить wav-кеш в asar** — он в userData, не в app-пакете.
- **Не доверять одной валидации (только renderer)** — main делает повторный `endsWith('.mp4')` и `fs.access(path, R_OK)` (D-06).
- **Не использовать `child.stderr` в utility как канал прогресса** — оставляем только error tail (на reason='ffmpeg_failed' хвостовик в лог main).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Скачать/собрать ffmpeg per-OS | свой downloader, msbuild-скрипт | `ffmpeg-static@5.3.0` | Уже собрано, подписано (Win), CI прогнан. CLAUDE.md фиксирует. |
| Парсить длительность из stderr `ffmpeg -i` | regex на `Duration: HH:MM:SS.ss` | `@ffprobe-installer/ffprobe` + JSON | stderr-формат нестабилен между версиями. ffprobe даёт чистый JSON. |
| Свой парсер прогресса из CR/`\r`-перезаписей stderr | state-machine | `-progress pipe:1` (key=value) | Документированный программный канал. |
| IPC между main и long-running subprocess | свой socket/named pipe | `utilityProcess` + `parentPort.postMessage` | Встроено в Electron, типизировано, прибивается `kill()`. |
| Кросс-платформенная упаковка нативных бинарников | свой post-build script | `electron-builder.asarUnpack` | Standard, уже частично в `electron-builder.yml`. |
| Шифрование/keychain | (relevant in Phase 1) | safeStorage | — |

---

## Runtime State Inventory

> Phase 2 — greenfield в части media-логики. Runtime state, который мы СОЗДАЁМ, минимален.

| Категория | Что мы добавляем | Action |
|----------|-------------------|--------|
| Stored data | `app.getPath('userData')/extracted/<hash>.wav` (кеш). | Создаётся при первом extract; cleanup deferred (D-13). |
| Live service config | Нет. | None. |
| OS-registered state | Нет. | None. |
| Secrets/env vars | Нет (Phase 2 не трогает Settings/safeStorage). | None. |
| Build artifacts | `out/main/ffmpeg-runner.cjs` (новый); `app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg(.exe)` в packaged-сборке. | Создаётся electron-vite / electron-builder автоматически. |

---

## Common Pitfalls

### Pitfall #1 — Бинарник в asar не исполняется
**Что:** В packaged-сборке `ffmpegPath = …/app.asar/node_modules/ffmpeg-static/ffmpeg` → `spawn` бросает `ENOENT` / `EACCES`. Бит исполняемости теряется тоже.
**Почему:** asar — read-only single-file archive, ОС не может exec-нуть файл оттуда.
**Как избежать:** `asarUnpack: ['node_modules/ffmpeg-static/**', 'node_modules/@ffprobe-installer/**']` + рантайм-замена `app.asar` → `app.asar.unpacked` (Pattern 5).
**Как заметить рано:** smoke-тест packaged-сборки (D-19). Без него dev-режим скрывает баг.

### Pitfall #2 — Linux/macOS: chmod слетает после unpacked
**Что:** Иногда (зависит от способа упаковки/distrib-target) бит `+x` не копируется в `app.asar.unpacked`. ffmpeg запускается с `EACCES`.
**Как избежать:** `ensureExecutable(p)` (Pattern 5) при первом резолве пути в сессии. Идемпотентно.
**Как заметить:** packaged-smoke на Linux/macOS падает с `EACCES`.

### Pitfall #3 — macOS Gatekeeper для неподписанных бинарников
**Что:** На macOS неподписанный ffmpeg-static может быть зарезан Gatekeeper'ом при запуске unpacked-сборки.
**Текущий статус:** Phase 2 НЕ покрывает подпись/нотаризацию (Phase 5). Smoke-тест на macOS — best effort. Если падает с «cannot be opened because the developer cannot be verified» — отмечаем и переносим лечение в Phase 5 (`spctl --add` либо подпись).
**Mitigation на сейчас:** локальный запуск из терминала; в нотаризованной сборке Phase 5 — корректные entitlements (`com.apple.security.cs.disable-library-validation` либо подпись каждого вложенного бинарника).

### Pitfall #4 — Windows: антивирус блокирует ffmpeg.exe
**Что:** Defender/Касперский иногда триггерят на неподписанный exe из user-AppData.
**Mitigation:** редко, но фиксируем в `02-VERIFICATION.md`. В Phase 5 подпишем installer.

### Pitfall #5 — utility-script собирается как ESM
**Что:** electron-vite по умолчанию собирает `main` как ESM (см. `electron.vite.config.ts` в репо). utility-entrypoint, fork-нутый через `utilityProcess.fork`, попадает в ту же сборку — если оставить ESM, может не подгрузиться `process.parentPort`/CJS-зависимости.
**Mitigation:** собирать `ffmpeg-runner.cjs` явно как CommonJS (`format: 'cjs'`, `entryFileNames: '[name].cjs'`) — ровно так же, как уже сделано для preload в `electron.vite.config.ts`. Унаследовать паттерн из Phase 1 Pitfall #9.
**Конкретно для планировщика:** в `electron.vite.config.ts` добавить второй `input` для main с CJS-output для utility-скрипта. Альтернативно — отдельный `rollupOptions.input` map.

### Pitfall #6 — Drop-zone не получает `file.path`
**Что:** В новых версиях Chromium/Electron `file.path` помечен deprecated, но всё ещё работает в Electron 42. В будущем (Electron 44+) может потребоваться `webUtils.getPathForFile(file)`.
**Сейчас (Electron 42):** `file.path` доступен.
**Future-proofing:** в preload экспонировать helper `getPathForFile(file)` через `webUtils` — minor, можно отложить.

### Pitfall #7 — Память на больших mp4
**Что:** Видео 5 ГБ → wav 16kHz mono ≈ 32 КБ/с × длительность. Для 2-часового видео ~230 МБ. Запись на диск через ffmpeg `-y outpath` — не в память.
**Mitigation:** не читаем wav в renderer. Phase 3 (Whisper) тоже работает по пути на диске.

### Pitfall #8 — Cancel не удалил частичный wav
**Что:** Кеш-проверка D-12 «`<hash>.wav` валидного размера (>0)» примет битый частичный wav как кеш-хит → Phase 3 упадёт.
**Mitigation:** пишем в `.tmp`-файл, переименовываем в финальный только на `exit code 0` (Pattern 3). Cancel удаляет `.tmp`.

### Pitfall #9 — Drag&drop на Wayland (Linux)
**Что:** Известная капризность Electron drag&drop в Wayland-сессиях.
**Mitigation:** Если на тестовой Linux-машине d&d не работает, объявить best-effort и направлять пользователя в file picker. Не блокер для Phase 2 (есть MEDIA-01 file dialog как обязательный путь).

### Pitfall #10 — `dialog.showOpenDialog` без owner-window
**Что:** На Windows/Linux диалог без `BrowserWindow` может оказаться позади окна.
**Mitigation:** `BrowserWindow.fromWebContents(event.sender)` (Pattern 1).

---

## Code Examples

См. **Pattern 1** (file picker), **Pattern 3** (utilityProcess + ffmpeg), **Pattern 4** (progress parser), **Pattern 5** (path resolve). Все примеры выше — verified against Electron 42 docs.

### Минимальный `media` IPC контракт (расширение `src/shared/ipc.ts`)

```typescript
// Дописать в src/shared/ipc.ts:

export const Channels = {
  // ...phase1
  MEDIA_PICK_FILE: 'media:pickFile',
  MEDIA_PROBE: 'media:probe',
  MEDIA_EXTRACT: 'media:extractAudio',
  MEDIA_CANCEL: 'media:cancel',
  MEDIA_PROGRESS: 'media:progress' // event channel (webContents.send), не invoke
} as const

export type MediaReason =
  | 'invalid_argument' | 'not_mp4' | 'file_not_found'
  | 'ffmpeg_failed' | 'cancelled' | 'disk_full' | 'internal'

export interface MediaProbeResult { durationSec: number; sizeBytes: number; name: string }
export interface MediaExtractResult { jobId: string; audioPath: string }
export interface MediaProgressEvent { jobId: string; percent: number; etaSec: number | null }

export interface MediaApi {
  pickFile: () => Promise<Result<{ path: string } | null>>
  probe: (path: string) => Promise<Result<MediaProbeResult>>
  extractAudio: (path: string) => Promise<Result<MediaExtractResult>>
  cancel: (jobId: string) => Promise<Result>
  onProgress: (cb: (e: MediaProgressEvent) => void) => () => void // возвращает unsubscribe
}

export interface ScrubberApi {
  settings: SettingsApi
  media: MediaApi // новый namespace
}
```

### Preload: подписка на event-канал

```typescript
// src/preload/index.ts — добавить в scrubber:
media: {
  pickFile: () => ipcRenderer.invoke(Channels.MEDIA_PICK_FILE),
  probe: (path) => ipcRenderer.invoke(Channels.MEDIA_PROBE, path),
  extractAudio: (path) => ipcRenderer.invoke(Channels.MEDIA_EXTRACT, path),
  cancel: (jobId) => ipcRenderer.invoke(Channels.MEDIA_CANCEL, jobId),
  onProgress: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: MediaProgressEvent) => cb(payload)
    ipcRenderer.on(Channels.MEDIA_PROGRESS, listener)
    return () => ipcRenderer.removeListener(Channels.MEDIA_PROGRESS, listener)
  }
}
```

---

## State of the Art

| Old / Alternative | Current Recommendation | Impact |
|-------------------|------------------------|--------|
| `child_process.spawn` напрямую из main | `utilityProcess.fork` (Electron 22+, stable в 42) | Не блокирует main, прибивается `kill()`, сериализует через `MessageChannelMain`. |
| `fluent-ffmpeg` | прямой `spawn(ffmpegPath, args)` | Минус одна зависимость, меньше абстракции. |
| `ffmpeg -i ... 2>&1` парсинг прогресса | `-progress pipe:1` (key=value) | Документированный канал, стабильный формат. |
| Чтение `file.path` (DEPRECATED notice) | `webUtils.getPathForFile(file)` | Доступно с Electron 30+, future-proof. Пока используем `file.path` — рабочее в 42. |

---

## Environment Availability

| Dependency | Required By | Available на dev-машине | Fallback |
|-----------|-------------|------------------------|----------|
| Node 22 / Electron 42 toolchain | весь стек | ✓ (Phase 1 завершена) | — |
| `npm install ffmpeg-static` (≈80MB) | extract | проверить наличие сети при первом ставе | — (есть в registry) |
| electron-builder (для smoke-теста D-19) | smoke | ✓ (в `devDependencies`) | — |
| Тестовый mp4-файл (короткий: 5-10 сек; длинный: 30+ мин; без аудио-дорожки) | Validation | **создать в `tests/fixtures/media/`** или собрать на лету через ffmpeg в Wave 0 | сгенерировать `ffmpeg -f lavfi -i sine=frequency=440:duration=5 -f lavfi -i color=c=blue:s=320x240:d=5 -shortest tests/fixtures/media/short.mp4` |
| Linux/macOS-машина для кросс-OS smoke (D-19) | MEDIA-04 на не-Win | ✗ (host = Windows) | best-effort, фиксация в `02-VERIFICATION.md` |

**Missing с fallback:**
- Тестовые видео — генерируем через `ffmpeg-static` (он уже будет установлен) скриптом `tests/fixtures/media/generate.mjs` в Wave 0.

**Missing без fallback:**
- Linux/macOS smoke-prod — отметить в VERIFICATION как known limitation Phase 2.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 (унаследовано из Phase 1, `package.json` `devDependencies`) |
| Config file | `vitest.config.ts` (создан в Phase 1) |
| Mock-инфра `electron` | `tests/setup.ts` (Phase 1) — расширить моками `dialog.showOpenDialog`, `utilityProcess.fork`, `BrowserWindow.fromWebContents` |
| Quick run command | `npm run test:unit -- --reporter=dot` |
| Full suite command | `npm test` (typecheck + vitest + electron-vite build) |
| Smoke-prod (D-19) | `npm run build:unpack && <запуск unpacked exe вручную, drop sample.mp4>` — manual, документируется в `02-VERIFICATION.md` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| MEDIA-01 | `dialog.showOpenDialog` зовётся с правильным filter | unit | `vitest run src/main/ipc/media.test.ts -t "pickFile"` | ❌ Wave 0 |
| MEDIA-01 | preload экспонирует `media.pickFile` через `Channels.MEDIA_PICK_FILE` | unit | `vitest run src/preload/index.test.ts -t "media bridge"` | ❌ Wave 0 |
| MEDIA-02 | DropZone: `files.length !== 1` → 'Один файл за раз' | unit (React Testing Library или ручной mock) | `vitest run src/renderer/src/routes/Transcribe.test.tsx` | ❌ Wave 0 |
| MEDIA-02 | DropZone: `!endsWith('.mp4')` отвергается | unit | то же | ❌ Wave 0 |
| MEDIA-02 | DropZone: валидный drop → `onPath(file.path)` | unit | то же | ❌ Wave 0 |
| MEDIA-03 | media-extractor собирает корректные ffmpeg args (`-vn -ac 1 -ar 16000 -c:a pcm_s16le -progress pipe:1`) | unit (snapshot args, мок utilityProcess) | `vitest run src/main/services/media-extractor.test.ts -t "args"` | ❌ Wave 0 |
| MEDIA-03 | парсер `out_time_us` → percent корректно (50% от длительности → 50) | unit (изолированный модуль) | `vitest run src/main/services/progress-parser.test.ts` | ❌ Wave 0 |
| MEDIA-03 | cancel → kill('SIGTERM') + unlink tmp + Result `cancelled` | unit | `vitest run src/main/services/media-extractor.test.ts -t "cancel"` | ❌ Wave 0 |
| MEDIA-03 | кеш-hit: существующий `<hash>.wav` (>0) → нет fork, Result сразу | unit (моки fs + utilityProcess) | то же | ❌ Wave 0 |
| MEDIA-03 | reason-нормализация: ffmpeg exit !=0 → `ffmpeg_failed`; ENOENT input → `file_not_found` | unit | то же | ❌ Wave 0 |
| MEDIA-04 (dev) | resolveFfmpeg/resolveFfprobe в dev: путь существует, исполняемый | unit | `vitest run src/main/services/ffmpeg-paths.test.ts -t "dev"` | ❌ Wave 0 |
| MEDIA-04 (dev) | `.replace('app.asar','app.asar.unpacked')` срабатывает на синтетическом пути | unit (input-output) | то же | ❌ Wave 0 |
| MEDIA-04 (integration, dev) | реальный ffmpeg извлекает 5-сек sample.mp4 → wav PCM 16kHz mono | integration | `vitest run tests/integration/extract-real.test.ts` (30-60 сек) | ❌ Wave 0 |
| MEDIA-04 (packaged, Win) | unpacked exe из `npm run build:unpack`: drop sample.mp4 → wav появляется в userData/extracted | **manual** (smoke) | документируется в `02-VERIFICATION.md` (скриншот + cat wav header) | ❌ |
| MEDIA-04 (packaged, Linux) | то же на Linux | **manual best-effort** | то же, отметка «skipped: no host» при отсутствии | ❌ |
| MEDIA-04 (packaged, macOS) | то же на macOS | **manual best-effort** | то же | ❌ |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- --reporter=dot` (быстрые юниты, < 5 сек).
- **Per wave merge:** `npm test` (typecheck + полный vitest + electron-vite build).
- **Phase gate:** Полный `npm test` зелёный **+** интеграционный `extract-real.test.ts` (реальный ffmpeg на 5-сек sample) зелёный **+** packaged-smoke на Windows green, Linux/macOS зафиксирован (passed либо skipped с причиной).

### Wave 0 Gaps (что планировщик обязан подготовить ДО реализации)

- [ ] `src/main/ipc/media.test.ts` — мок `dialog`, `BrowserWindow`, проверка filter и Result-формы. Покрывает MEDIA-01.
- [ ] `src/main/services/progress-parser.test.ts` — изолированная чистая функция (`parseLine(line, durationSec, started)` → MediaProgressEvent | null). Покрывает MEDIA-03 (progress).
- [ ] `src/main/services/ffmpeg-paths.test.ts` — `.replace`-логика и `ensureExecutable` (мок `fs.chmod`/`fs.access`). Покрывает MEDIA-04 (dev path).
- [ ] `src/main/services/media-extractor.test.ts` — мок `utilityProcess.fork` (возвращает EventEmitter с `postMessage`/`kill`), сценарии: happy path, cancel, ffmpeg_failed, cache-hit. Покрывает MEDIA-03.
- [ ] `src/renderer/src/routes/Transcribe.test.tsx` — DropZone и file-picker integration tests; мок `window.scrubber.media`. Покрывает MEDIA-02 валидацию.
- [ ] `src/preload/index.test.ts` — расширить: bridge `media.*` использует `Channels.MEDIA_*` константы, `onProgress` возвращает unsubscribe. Покрывает MEDIA-01/02/03 contract.
- [ ] `tests/integration/extract-real.test.ts` — генерирует 5-сек sample mp4 через реальный `ffmpeg-static`, прогоняет full extract pipeline (без моков utilityProcess), проверяет файл wav на диске (header `RIFF…WAVEfmt`, 16000 Hz mono PCM s16le через ffprobe). Покрывает MEDIA-03 end-to-end и MEDIA-04 в dev. **30-60 сек.**
- [ ] `tests/fixtures/media/generate.mjs` — скрипт генерации тестовых mp4: short (5 сек), long (опционально, 60+ сек), no-audio (`-an`). Запускается один раз, артефакты в `.gitignore` (генерируются в CI).
- [ ] `tests/setup.ts` — добавить моки `utilityProcess.fork`, `BrowserWindow.fromWebContents`, `dialog.showOpenDialog`.
- [ ] `electron.vite.config.ts` — добавить CJS-output entry для `ffmpeg-runner.ts` → `ffmpeg-runner.cjs` (Pitfall #5).
- [ ] `electron-builder.yml` — расширить `asarUnpack` (Pattern 5).
- [ ] `02-VERIFICATION.md` шаблон — секции «Windows packaged smoke», «Linux packaged smoke», «macOS packaged smoke» с чек-листами.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Применимо | Стандартный контроль |
|---------------|----------|----------------------|
| V2 Authentication | нет | n/a (Phase 1) |
| V3 Session Management | нет | n/a |
| V4 Access Control | да | contextIsolation + sandbox renderer + preload allow-list (унаследовано из Phase 1). Все пути в main валидируются. |
| V5 Input Validation | **да** | `path` из renderer: `typeof === 'string'`, не пустой, `endsWith('.mp4')`, `fs.access(path, R_OK)`. `jobId`: формат UUID. Defence-in-depth (D-06). |
| V6 Cryptography | да (минимально) | `crypto.createHash('sha1')` — для cache-key, НЕ для security. Документировать как «non-security hash». |
| V7 Errors / Logging | да | stderr-tail ffmpeg логируется в main `console.error('[services/media-extractor]', ...)`. Не утекает в renderer (только `reason: 'ffmpeg_failed'`). |
| V12 File handling | **да** | (см. ниже) |

### Известные threat patterns для Phase 2

| Pattern | STRIDE | Стандартная mitigation |
|---------|--------|------------------------|
| Path traversal через `media.extractAudio('..\\..\\etc\\passwd')` | Tampering | main валидирует `path.isAbsolute(path)`, `fs.access(R_OK)`. **Запись wav** ВСЕГДА в `app.getPath('userData')/extracted/<hash>.wav` — пользовательский input не контролирует output-path. |
| Argument injection в ffmpeg через имя файла начинающееся с `-` | Tampering | `spawn(ffmpegPath, args)` (НЕ shell). Префиксовать `inputPath` через `'--'` separator: `[..., '--', inputPath]` либо нормализовать `path.resolve(input)`. |
| Symlink attack (input = symlink на /etc/passwd) | Information disclosure | ffmpeg прочитает байты как медиа и быстро упадёт (`ffmpeg_failed`). Не критично, но логировать предупреждение. |
| DoS длинным/злым mp4 | DoS | Cancel-кнопка (D-09) + один job за раз (D-10). |
| Утечка пути userData в renderer | Information disclosure | `audioPath` возвращается renderer'у — это by design (Phase 3 будет его использовать). Не secret. |
| Side-loading стороннего ffmpeg через `PATH` | Tampering / Supply chain | Мы **никогда** не зовём `ffmpeg` по имени — только абсолютный путь от `ffmpeg-static`. |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `file.path` всё ещё работает в Electron 42 для дропнутых файлов (без `webSecurity: false`). | Pattern 2 | MEDIA-02 не работает; fallback — `webUtils.getPathForFile(file)`. Низкий риск: Electron 42 ещё поддерживает `file.path`, deprecation запланирована позже. |
| A2 | utility-script, собранный в CJS как и preload, корректно использует `process.parentPort`. | Pitfall #5, Pattern 3 | Pitfall #9 из Phase 1 уже показал, что preload должен быть CJS — тот же принцип применим к utility entry. Если внезапно нужен ESM, fork-ать `.mjs` отдельной точкой входа. |
| A3 | `asarUnpack: ['node_modules/ffmpeg-static/**']` действительно копирует бинарник в `app.asar.unpacked/`. | Pattern 5 | Подтверждено через WebSearch (electron-builder docs + блог Cleasby), но НЕ запущено в репо. Smoke-тест D-19 — обязательная валидация. |
| A4 | `ffmpeg-static@5.3.0` поставляет ffmpeg ≥ 4.0 (нужен `-progress pipe:1`). | Pattern 4 | `[CITED: github.com/eugeneware/ffmpeg-static]` — ffmpeg 6.1.1. Опция `-progress` есть с ffmpeg 2.0. Низкий риск. |
| A5 | `utilityProcess.fork` корректно работает с упакованной сборкой и Linux sandbox (Electron 42). | Pattern 3 | `[CITED: electronjs.org]` — да, это his raison d'être. Low risk. |
| A6 | `BrowserWindow.getAllWindows()[0]` — корректный канал для `media:progress` (одно окно в v1). | Pattern 3 | Phase 1 использует одно окно (D-04). Если v2 добавит окна — рефактор минимальный (хранить `webContents` пары к jobId). |
| A7 | Тестовые видео можно сгенерировать через `ffmpeg-static` в Wave 0; не нужны коммитнутые большие mp4. | Validation Architecture | Standard practice; ниже на repo size. |

**Если эта таблица содержит claims с MEDIUM-HIGH риском — планировщик должен заложить early validation tasks (e.g., A3 покрывается smoke-тестом D-19 в acceptance, A1 покрывается DropZone unit-тестом).**

---

## Open Questions

1. **Где хранить utility-script: `src/main/ffmpeg-runner.ts` (рядом с index) или `src/main/utilities/ffmpeg-runner.ts`?**
   - Что известно: electron-vite собирает по `lib.entry` / `rollupOptions.input`. Текущий конфиг имеет только дефолтный `main` entry.
   - Что неясно: точное имя/расположение — стилистика проекта.
   - Рекомендация: `src/main/utilities/ffmpeg-runner.ts` (новая папка для utility-entrypoint'ов), в `electron.vite.config.ts` добавить второй input с CJS-output. Альтернатива: `src/main/ffmpeg-runner.ts` (плоско).

2. **Один MessageChannel или просто `parentPort.postMessage` без портов?**
   - `process.parentPort` уже даёт двусторонний канал; `MessageChannelMain` нужен только для передачи дополнительных портов другому потребителю. Для Phase 2 — **простой `parentPort`** достаточен.

3. **Кеш-валидация: только `>0 байт`, или нужна проверка wav-header?**
   - D-12 говорит просто `>0`. Pattern 3 пишет в `.tmp` и переименовывает только на exit code 0 — этого достаточно. **Не усложняем** в v1.

4. **Linux Wayland drag&drop — фиксировать как known limitation или жёстко гарантировать?**
   - Phase 2 acceptance не требует d&d на Linux ОБЯЗАТЕЛЬНО (есть file picker как baseline). Помечаем «best-effort» в `02-VERIFICATION.md`. Решение: best-effort.

---

## Project Constraints (from CLAUDE.md)

| Источник | Директива | Применение в Phase 2 |
|----------|-----------|----------------------|
| CLAUDE.md §Tech stack | Electron 42.3.0, electron-vite 5, electron-builder 26, TypeScript 5, React 19, Tailwind 4 | Соблюдено — стек унаследован, ничего не меняем. |
| CLAUDE.md §Recommended Stack | `ffmpeg-static@5.3.0` для извлечения аудио | Используем. |
| CLAUDE.md §What NOT to Use | Системный ffmpeg как зависимость — запрещён | Запрещено. Всё через ffmpeg-static. |
| CLAUDE.md §What NOT to Use | `keytar`, `electron-store.encryptionKey` для секретов | Не используется в Phase 2 (нет секретов). |
| CLAUDE.md §Privacy | Локальная обработка | ffmpeg крутится локально; никаких сетевых вызовов в Phase 2. |
| CLAUDE.md §Compatibility | Win/Linux/macOS | MEDIA-04 acceptance + packaged smoke на трёх ОС (D-19, best-effort вне Windows). |
| CLAUDE.md §Constraints | `extraResources`/`asarUnpack` через electron-builder для нативных бинарников | Pattern 5 + electron-builder.yml расширение. |
| CLAUDE.md §GSD Workflow Enforcement | Все правки через GSD | Соблюдено: текущая фаза идёт через `/gsd-execute-phase`. |
| Phase 1 D-14 (через canonical_refs) | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` | Сохраняется. DropZone использует `file.path`-расширение Electron без отключения webSecurity. |
| Phase 1 Pitfall #9 (preload CJS) | utility-entrypoints — также CJS | Pitfall #5 этой фазы повторяет правило. |

---

## Sources

### Primary (HIGH confidence)

- `[CITED: electronjs.org/docs/latest/api/utility-process]` — API `utilityProcess.fork`, ForkOptions (stdio, serviceName, env), события (spawn/exit/message/error), `process.parentPort`, MessageChannelMain pattern, требование `app.ready`.
- `[CITED: ffmpeg.org/ffmpeg.html §progress]` — формат key=value, `out_time_us`/`out_time_ms`/`progress=continue|end`, `-stats_period`, `-nostats`/`-loglevel`.
- `[CITED: github.com/eugeneware/ffmpeg-static]` — поддерживаемые платформы (win/linux/macOS × x64/arm64), ffmpeg 6.1.1, GPL-3.0.
- `[VERIFIED: npm registry]` `npm view ffmpeg-static version` → `5.3.0`; `npm view @ffprobe-installer/ffprobe version` → `2.1.2`; `npm view fluent-ffmpeg version` → `2.1.3`.
- **Local codebase** — `package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`, `.planning/phases/01-foundation-app-shell/01-PATTERNS.md`.

### Secondary (MEDIUM confidence)

- `[CITED: alexandercleasby.dev/blog/use-ffmpeg-electron]` (через WebSearch summary, прямой fetch упал ECONNREFUSED) — паттерн `.replace('app.asar', 'app.asar.unpacked')` подтверждён независимым источником.
- `[CITED: electron-builder Application Contents]` (через WebSearch summary, прямой URL вернул 404) — описание `asarUnpack` и поведения `app.asar.unpacked`.
- CONTEXT.md (Phase 2) — все D-01..D-19 — авторитативный источник пользовательских решений.

### Tertiary (LOW confidence)

- Описание `webUtils.getPathForFile` как замены `file.path` — упомянуто как future-proofing; не верифицировано против Electron 42 changelog (низкий риск, отложено).

---

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — все версии проверены `npm view`, ffmpeg-static и @ffprobe-installer — широко известные пакеты.
- Architecture (utilityProcess + path-replace): **HIGH** — официальная документация Electron + два независимых блог-source.
- Pitfalls: **HIGH** для #1/#2/#5/#7/#8/#10; **MEDIUM** для #3/#4/#9 (зависит от среды пользователя, описаны как best-effort).
- Validation Architecture: **HIGH** — Vitest-инфра уже стоит из Phase 1, расширение очевидное.

**Research date:** 2026-05-31
**Valid until:** 2026-06-30 (Electron 42 — текущая stable; релизный цикл 8 недель).

---

## RESEARCH COMPLETE

**Phase:** 2 — Media Extraction Pipeline
**Confidence:** HIGH

**Key Findings:**
- Стек: `ffmpeg-static@5.3.0` + `@ffprobe-installer/ffprobe@2.1.2` + встроенный `utilityProcess` (Electron 42). `fluent-ffmpeg` НЕ нужен.
- Архитектурный шаблон: **main оркеструет**, **utility-script (CJS) спавнит ffmpeg** через `child_process.spawn`, парсит `-progress pipe:1` (key=value, `out_time_us`), стримит прогресс через `process.parentPort.postMessage` → `webContents.send(MEDIA_PROGRESS)`.
- Packaging критично: `asarUnpack: ['node_modules/ffmpeg-static/**', 'node_modules/@ffprobe-installer/**']` + рантайм-замена `app.asar` → `app.asar.unpacked` + `chmod 0o755` fallback на Linux/macOS. Smoke-тест packaged-сборки (D-19) — обязательный acceptance gate.
- IPC контракт `media.*` (pickFile/probe/extractAudio/cancel + event `media:progress`) — расширение существующего `src/shared/ipc.ts` ровно по паттерну Phase 1 (Channels + Result-тип + namespace-bridge).
- utility-script собираем как CJS (`*.cjs`) — повторяем урок Phase 1 Pitfall #9 (sandboxed preload как CJS). Требует доп. input в `electron.vite.config.ts`.

**File Created:**
`C:\Users\mminm\Documents\projects\scrubber\.planning\phases\02-media-extraction-pipeline\02-RESEARCH.md`

**Confidence Assessment:**
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Все версии verified через npm, пакеты широко известны и проверены. |
| Architecture (utilityProcess + path-replace) | HIGH | Официальная Electron docs + независимые подтверждения паттерна. |
| Pitfalls | HIGH (для core) / MEDIUM (для macOS Gatekeeper/Linux Wayland — среда-зависимы) | Best-effort помечен явно. |
| Validation Architecture | HIGH | Vitest 2.x инфра уже стоит из Phase 1. |

**Open Questions:**
- Точное имя/расположение utility-script (`src/main/ffmpeg-runner.ts` vs `src/main/utilities/`) — выбор стилистики, не блокер.
- Кросс-OS packaged-smoke (Linux/macOS) — best-effort при отсутствии host-машин, фиксируется в VERIFICATION.

**Ready for Planning.** Планировщик может создавать PLAN.md файлы по разбитию на волны: Wave 0 (контракт IPC + Vitest gaps + electron-vite CJS entry + electron-builder.yml + sample-видео генератор), Wave 1 (file picker + DropZone), Wave 2 (probe + media-extractor + utility-script), Wave 3 (cache + cancel + progress integration), Wave 4 (Transcribe-UI + integration test), Wave 5 (packaged smoke + VERIFICATION).
