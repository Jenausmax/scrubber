// CJS utility entrypoint для utilityProcess.fork — Phase 2 Plan 02 (полная реализация).
//
// Источник: 02-RESEARCH.md §Pattern 3 (runner-блок), §Pattern 4, §Pitfall #5.
// КОНТРАКТ:
//   - CJS-стиль (`require`), НЕ ESM `import` — Pitfall #5 (ESM-вход для utilityProcess.fork
//     нестабилен в Electron 42).
//   - НИКАКИХ импортов из `electron` или `src/main/*` — utility изолирован от main-графа,
//     это отдельный Node-процесс, electron-API недоступны.
//   - Inline-парсер прогресса — сознательное дублирование parseProgressLine из
//     services/progress-parser.ts. Utility-script не может импортировать из src/main/services/
//     (bundle-граница), потому 10 строк дублируются здесь и покрываются тестом отдельно
//     (services/progress-parser.test.ts). См. 02-PATTERNS.md §src/main/utilities/ffmpeg-runner.ts.
//
// Лайфцикл (RESEARCH §Pattern 3):
//   1. parentPort.on('message') → if data.type==='start' → startFfmpeg(data)
//   2. process.on('SIGTERM') → child?.kill('SIGTERM') (cancel из main)
//   3. spawn(ffmpegPath, args, {windowsHide:true}); stdout line-buffer → parseProgressLine
//      → parentPort.postMessage({type:'progress', percent, etaSec})
//   4. stderr → накопить последние 2000 байт → на exit отправить {type:'done', code, stderrTail}
//      → process.exit(code ?? 1)

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

const { spawn } = require('node:child_process')
// Единый источник args (esbuild --bundle инлайнит модуль в ffmpeg-runner.cjs).
// Та же функция используется в tests/integration/extract-real.test.ts — args не разъезжаются.
const { buildExtractArgs } = require('./ffmpeg-args') as typeof import('./ffmpeg-args')

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

parentPort?.on('message', (e: { data: unknown }) => {
  const msg = e.data as { type?: string }
  if (msg && msg.type === 'start') {
    startFfmpeg(
      msg as unknown as {
        ffmpegPath: string
        inputPath: string
        outputPath: string
        durationSec: number
      }
    )
  }
})

process.on('SIGTERM', () => {
  if (child) child.kill('SIGTERM')
})

function startFfmpeg(opts: {
  ffmpegPath: string
  inputPath: string
  outputPath: string
  durationSec: number
}): void {
  const { ffmpegPath, inputPath, outputPath, durationSec } = opts
  const args = buildExtractArgs(inputPath, outputPath)
  child = spawn(ffmpegPath, args, { windowsHide: true }) as ChildProcLike
  const started = Date.now()
  let stderrTail = ''
  let buf = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buf += chunk
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      handleProgressLine(line, durationSec, started)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c: string) => {
    stderrTail = (stderrTail + c).slice(-2000)
  })

  child.on('exit', (code: number | null) => {
    parentPort?.postMessage({ type: 'done', code, stderrTail })
    process.exit(code ?? 1)
  })

  child.on('error', (err: Error) => {
    parentPort?.postMessage({ type: 'error', message: err.message })
    process.exit(1)
  })
}

// Inline-дубль parseProgressLine из services/progress-parser.ts (~10 строк).
// Дублирование сознательное: utility-bundle не импортирует из src/main/services/
// (изоляция от main-графа). Поведение покрыто тестом progress-parser.test.ts.
function handleProgressLine(line: string, durationSec: number, started: number): void {
  const eq = line.indexOf('=')
  if (eq < 0) return
  const key = line.slice(0, eq)
  if (key !== 'out_time_us') return
  if (durationSec <= 0) return
  const us = Number(line.slice(eq + 1))
  if (!Number.isFinite(us)) return
  const pct = Math.min(99, Math.floor((us / 1_000_000 / durationSec) * 100))
  if (pct === lastPct) return
  lastPct = pct
  const elapsed = (Date.now() - started) / 1000
  const eta = pct > 0 ? Math.max(0, Math.round((100 / pct - 1) * elapsed)) : null
  parentPort?.postMessage({ type: 'progress', percent: pct, etaSec: eta })
}
