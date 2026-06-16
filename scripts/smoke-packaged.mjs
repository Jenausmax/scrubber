#!/usr/bin/env node
// Standalone smoke-check для packaged build. Запускать ВРУЧНУЮ командой
// `node scripts/smoke-packaged.mjs` после `npm run build:unpack` на host-OS
// (Win/Linux/macOS — соответствующая target). НЕ цепляется в build:unpack chain.
//
// Проверяет, что electron-builder корректно распаковал нативные бинарники в
// app.asar.unpacked (рекурсивный поиск файла):
//   - ffmpeg / ffprobe (Phase 2, Gap 2 regression-guard);
//   - whisper-cli + DLL (Phase 3, Pitfall #1 — бинарник не исполняется из app.asar,
//     должен лежать в app.asar.unpacked рядом со своими DLL).
//
// Контракт явного gating (НЕ ложный зелёный):
//   - packaged build (dist/*-unpacked) ОТСУТСТВУЕТ → console.log('[smoke] SKIP ...') + exit 0
//     (это НЕ «passed» — SKIP логируется отдельно, чтобы CI/человек видел разницу);
//   - packaged build ЕСТЬ → проверяем ffmpeg/ffprobe + whisper-cli/DLL; при наличии
//     ru WAV-фикстуры и tiny/small модели рядом — реально прогоняем whisper-cli
//     (Pitfall #1 end-to-end); любой провал → console.error + exit 1.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { platform, arch, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const distDir = join(ROOT, 'dist')

// ── Explicit SKIP (exit 0) когда packaged build отсутствует ──────────────────
if (!existsSync(distDir)) {
  console.log('[smoke] SKIP: packaged build not found (no dist/) — run `npm run build:unpack` first')
  process.exit(0)
}
const distEntries = readdirSync(distDir, { withFileTypes: true })
const unpacked = distEntries.find((e) => e.isDirectory() && /-unpacked$/.test(e.name))
if (!unpacked) {
  console.log('[smoke] SKIP: no *-unpacked directory in dist/ — run `npm run build:unpack` first')
  process.exit(0)
}

const unpackedRoot = join(distDir, unpacked.name)
const asarUnpackedRoot = join(unpackedRoot, 'resources', 'app.asar.unpacked')
if (!existsSync(asarUnpackedRoot)) {
  console.error(`[smoke] FAIL: app.asar.unpacked NOT FOUND at ${asarUnpackedRoot}`)
  process.exit(1)
}

const isWin = platform() === 'win32'
const platArch = `${platform()}-${arch()}`

/**
 * Рекурсивно ищет файл `name` в дереве от `root` (глубина ≤ 5).
 * Возвращает абсолютный путь к первому найденному или null.
 */
function findBinary(root, name, depth = 0) {
  if (!existsSync(root) || depth > 5) return null
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    const full = join(root, e.name)
    if (e.isFile() && e.name === name) return full
    if (e.isDirectory()) {
      const found = findBinary(full, name, depth + 1)
      if (found) return found
    }
  }
  return null
}

function checkSize(path, label, failures) {
  try {
    if (statSync(path).size < 1024) {
      failures.push(`${label} suspiciously small (<1KB) at ${path}`)
    }
  } catch {
    /* ignore stat errors */
  }
}

const failures = []

// ── ffmpeg / ffprobe (Phase 2 regression-guard) ─────────────────────────────
const ffmpegStaticDir = join(asarUnpackedRoot, 'node_modules', 'ffmpeg-static')
const ffprobeBaseDir = join(asarUnpackedRoot, 'node_modules', '@ffprobe-installer')
const ffmpegBinName = isWin ? 'ffmpeg.exe' : 'ffmpeg'
const ffprobeBinName = isWin ? 'ffprobe.exe' : 'ffprobe'

if (existsSync(ffmpegStaticDir)) {
  const ffmpegPath = join(ffmpegStaticDir, ffmpegBinName)
  if (!existsSync(ffmpegPath)) failures.push(`ffmpeg binary missing at ${ffmpegPath}`)
  else checkSize(ffmpegPath, ffmpegBinName, failures)
} else {
  failures.push(`ffmpeg-static dir NOT unpacked at ${ffmpegStaticDir}`)
}

if (existsSync(ffprobeBaseDir)) {
  const ffprobePath = findBinary(ffprobeBaseDir, ffprobeBinName)
  if (!ffprobePath) {
    failures.push(
      `${ffprobeBinName} binary not found anywhere under ${ffprobeBaseDir} ` +
        `(expected in per-OS subpackage e.g. @ffprobe-installer/win32-x64/)`
    )
  } else {
    checkSize(ffprobePath, ffprobeBinName, failures)
  }
} else {
  failures.push(`@ffprobe-installer dir NOT unpacked at ${ffprobeBaseDir}`)
}

// ── whisper-cli + DLL (Phase 3, Pitfall #1) ─────────────────────────────────
const whisperDir = join(asarUnpackedRoot, 'resources', 'whisper', platArch)
const whisperCliName = isWin ? 'whisper-cli.exe' : 'whisper-cli'
const whisperCliPath = join(whisperDir, whisperCliName)

if (!existsSync(whisperDir)) {
  failures.push(
    `whisper resources dir NOT unpacked at ${whisperDir} ` +
      `(asarUnpack: resources/** должен распаковать whisper-cli + DLL — Pitfall #1)`
  )
} else {
  if (!existsSync(whisperCliPath)) {
    failures.push(`${whisperCliName} missing at ${whisperCliPath} (Pitfall #1)`)
  } else {
    checkSize(whisperCliPath, whisperCliName, failures)
  }
  // На Windows whisper-cli не исполнится без своих DLL рядом (Pitfall #1).
  if (isWin) {
    for (const dll of ['whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll']) {
      const dllPath = join(whisperDir, dll)
      if (!existsSync(dllPath)) {
        failures.push(`required DLL ${dll} missing next to whisper-cli at ${dllPath} (Pitfall #1)`)
      } else {
        checkSize(dllPath, dll, failures)
      }
    }
  }
}

if (failures.length > 0) {
  console.error('[smoke] FAIL: PACKAGED BUILD CHECK FAILED:')
  for (const f of failures) console.error('  - ' + f)
  console.error(
    '\nFix: проверь electron-builder.yml asarUnpack секцию (resources/** + ffmpeg/ffprobe) ' +
      'и перезапусти `npm run build:unpack`.'
  )
  process.exit(1)
}

// ── End-to-end whisper-прогон из app.asar.unpacked (Pitfall #1) ─────────────
// Реальный прогон выполняется ТОЛЬКО если рядом есть (a) ru WAV-фикстура (извлекаем
// из tests/fixtures/media/short.mp4 через распакованный ffmpeg) и (b) tiny/small модель
// рядом с whisper-cli или в SCRUBBER_SMOKE_MODEL. Иначе — проверка наличия бинарников
// PASS без запуска (бинарники/DLL на месте — главное, что валидирует Pitfall #1).
const shortMp4 = resolve(ROOT, 'tests', 'fixtures', 'media', 'short.mp4')
const modelCandidates = [
  process.env.SCRUBBER_SMOKE_MODEL,
  join(whisperDir, 'ggml-tiny.bin'),
  join(whisperDir, 'ggml-small.bin'),
  join(whisperDir, 'ggml-medium.bin')
].filter((p) => typeof p === 'string' && p.length > 0)
const modelPath = modelCandidates.find((p) => existsSync(p))

if (modelPath && existsSync(shortMp4)) {
  const ffmpegPath = join(ffmpegStaticDir, ffmpegBinName)
  const wavPath = join(tmpdir(), 'scrubber-smoke-fixture-16k.wav')
  const ff = spawnSync(
    ffmpegPath,
    ['-y', '-i', shortMp4, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
    { windowsHide: true }
  )
  if (ff.status !== 0) {
    console.error('[smoke] FAIL: не удалось извлечь WAV-фикстуру через распакованный ffmpeg')
    process.exit(1)
  }
  const run = spawnSync(
    whisperCliPath,
    ['-m', modelPath, '-l', 'ru', '-oj', '-f', wavPath],
    { windowsHide: true, encoding: 'utf8' }
  )
  if (run.status !== 0) {
    console.error(
      `[smoke] FAIL: whisper-cli из app.asar.unpacked вернул код ${run.status} (Pitfall #1 — проверь DLL)`
    )
    if (run.stderr) console.error(run.stderr.slice(-2000))
    process.exit(1)
  }
  const jsonPath = `${wavPath}.json`
  if (!existsSync(jsonPath)) {
    console.error(`[smoke] FAIL: whisper-cli не создал -oj JSON по пути ${jsonPath}`)
    process.exit(1)
  }
  console.log(
    `[smoke] PASS: ffmpeg/ffprobe + whisper-cli (с DLL) распакованы и whisper-cli ` +
      `транскрибировал ru WAV (Pitfall #1 end-to-end) — ${asarUnpackedRoot}`
  )
  process.exit(0)
}

console.log(
  `[smoke] PASS: ffmpeg/ffprobe + whisper-cli + DLL найдены в ${asarUnpackedRoot} ` +
    `(модель/фикстура для end-to-end прогона не найдены — задайте SCRUBBER_SMOKE_MODEL ` +
    `для полного прогона; наличие бинарников/DLL подтверждено)`
)
process.exit(0)
