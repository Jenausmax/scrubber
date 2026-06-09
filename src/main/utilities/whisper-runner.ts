// CJS utility entrypoint для utilityProcess.fork — Phase 3 Plan 02 (ядро ценности).
//
// Источник: 03-RESEARCH.md §Progress Parsing (197-216), §segment + progress parsing (403-418),
// 03-PATTERNS.md §whisper-runner.ts (134-179), зеркало ffmpeg-runner.ts (Phase 2).
//
// КОНТРАКТ:
//   - CJS-стиль (`require`), НЕ ESM `import` — Pitfall #6 (ESM-вход для utilityProcess.fork
//     нестабилен в Electron 42). esbuild --format=cjs бандлит этот файл в whisper-runner.cjs.
//   - НИКАКИХ импортов из `electron` или `src/main/*` — utility изолирован от main-графа.
//   - buildTranscribeArgs импортируется через require (esbuild инлайнит модуль в bundle) —
//     args не разъезжаются между прод-вызовом и tests/integration.
//   - Парсеры segment/progress инлайнятся здесь (дубль whisper-runner-parse.ts) — bundle-граница
//     не позволяет импортировать из main-графа; поведение покрыто whisper-runner-parse.test.ts.
//
// Лайфцикл:
//   1. parentPort.on('message') → if data.type==='start' → startWhisper(data)
//   2. process.on('SIGTERM') → child?.kill('SIGTERM') (cancel из main — TRANS-05)
//   3. spawn(cliPath, buildTranscribeArgs({...}), {windowsHide:true})
//      stdout line-buffer → SEG-regex → postMessage {type:'segment', startMs, text}
//      stderr line-buffer → PROG-regex → postMessage {type:'progress', percent} (cap 99)
//      stderr также копится в stderrTail (последние 2000 байт) для диагностики
//   4. child.on('exit', code) → postMessage {type:'done', code, stderrTail, jsonPath}
//      → process.exit(code ?? 1). jsonPath = audioPath+'.json' (whisper-cli -oj пишет рядом).

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

const { spawn } = require('node:child_process')
// Единый источник args (esbuild --bundle инлайнит модуль в whisper-runner.cjs).
const { buildTranscribeArgs } =
  require('./whisper-args') as typeof import('./whisper-args')

type ChildProcLike = {
  stdout: { setEncoding: (e: string) => void; on: (ev: string, cb: (c: string) => void) => void }
  stderr: { setEncoding: (e: string) => void; on: (ev: string, cb: (c: string) => void) => void }
  on: (ev: string, cb: (...args: any[]) => void) => void
  kill: (sig?: string) => void
}

type ParentPortLike = {
  on: (ev: string, cb: (e: { data: unknown }) => void) => void
  postMessage: (msg: unknown) => void
}

let child: ChildProcLike | null = null
let lastPct = -1

const parentPort: ParentPortLike | undefined = (process as any).parentPort

// SEG-regex: stdout-сегмент `[hh:mm:ss.mmm --> ...]  текст` (дубль whisper-runner-parse.ts).
const SEG_REGEX = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> .*\]\s+(.*)$/
// PROG-regex: stderr `progress = N%` (дубль whisper-runner-parse.ts).
const PROG_REGEX = /progress\s*=\s*(\d+)%/

parentPort?.on('message', (e: { data: unknown }) => {
  const msg = e.data as { type?: string }
  if (msg && msg.type === 'start') {
    startWhisper(
      msg as unknown as {
        cliPath: string
        modelPath: string
        vadModelPath: string | null
        audioPath: string
        language: string
        threads: number
      }
    )
  }
})

process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM')
})

function startWhisper(opts: {
  cliPath: string
  modelPath: string
  vadModelPath: string | null
  audioPath: string
  language: string
  threads: number
}): void {
  const { cliPath, modelPath, vadModelPath, audioPath, language, threads } = opts
  const args = buildTranscribeArgs({ modelPath, audioPath, language, vadModelPath, threads })
  child = spawn(cliPath, args, { windowsHide: true }) as ChildProcLike
  let stderrTail = ''
  let outBuf = ''
  let errBuf = ''

  // stdout → сегменты (SEG-regex).
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    outBuf += chunk
    let idx: number
    while ((idx = outBuf.indexOf('\n')) >= 0) {
      const line = outBuf.slice(0, idx)
      outBuf = outBuf.slice(idx + 1)
      handleSegmentLine(line)
    }
  })

  // stderr → прогресс (PROG-regex) + stderrTail для диагностики.
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-2000)
    errBuf += chunk
    let idx: number
    while ((idx = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, idx)
      errBuf = errBuf.slice(idx + 1)
      handleProgressLine(line)
    }
  })

  child.on('exit', (code: number | null) => {
    parentPort?.postMessage({
      type: 'done',
      code,
      stderrTail,
      jsonPath: `${audioPath}.json`
    })
    process.exit(code ?? 1)
  })

  child.on('error', (err: Error) => {
    parentPort?.postMessage({ type: 'error', message: err.message })
    process.exit(1)
  })
}

// Inline-дубль parseSegmentLine из whisper-runner-parse.ts (bundle-граница).
function handleSegmentLine(line: string): void {
  const m = SEG_REGEX.exec(line)
  if (!m) return
  const hh = Number(m[1])
  const mm = Number(m[2])
  const ss = Number(m[3])
  const mmm = Number(m[4])
  const startMs = (hh * 3600 + mm * 60 + ss) * 1000 + mmm
  parentPort?.postMessage({ type: 'segment', startMs, text: m[5] })
}

// Inline-дубль parseProgressLine из whisper-runner-parse.ts (bundle-граница). Cap 99.
function handleProgressLine(line: string): void {
  const m = PROG_REGEX.exec(line)
  if (!m) return
  const n = Number(m[1])
  if (!Number.isFinite(n)) return
  const pct = Math.min(99, n)
  if (pct === lastPct) return
  lastPct = pct
  parentPort?.postMessage({ type: 'progress', percent: pct })
}
