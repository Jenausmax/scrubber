#!/usr/bin/env node
// Standalone smoke-check для packaged build. Запускать ВРУЧНУЮ после `npm run build:unpack`
// на host-OS (Win/Linux/macOS — соответствующая target). НЕ цепляется в build:unpack chain
// (host-OS-only сценарий, см. 02-05-PLAN W-4).
//
// Проверяет, что electron-builder корректно распаковал ffmpeg/ffprobe бинарники
// в app.asar.unpacked (рекурсивный поиск файла, а не только директории).
// Закрывает regression-guard для Gap 2 из 02-VERIFICATION.md.
//
// Ожидаемый layout (Windows пример):
//   dist/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe
//   dist/win-unpacked/resources/app.asar.unpacked/node_modules/@ffprobe-installer/win32-x64/ffprobe.exe

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:os'

const ROOT = process.cwd()
const distDir = join(ROOT, 'dist')
if (!existsSync(distDir)) {
  console.error('[smoke] dist/ does not exist — run `npm run build:unpack` first')
  process.exit(2)
}

// Найти первую подпапку *-unpacked в dist/
const entries = readdirSync(distDir, { withFileTypes: true })
const unpacked = entries.find((e) => e.isDirectory() && /-unpacked$/.test(e.name))
if (!unpacked) {
  console.error('[smoke] no *-unpacked directory in dist/ — build:unpack failed?')
  process.exit(3)
}

const unpackedRoot = join(distDir, unpacked.name)
const asarUnpackedRoot = join(unpackedRoot, 'resources', 'app.asar.unpacked')
const ffmpegStaticDir = join(asarUnpackedRoot, 'node_modules', 'ffmpeg-static')
const ffprobeBaseDir = join(asarUnpackedRoot, 'node_modules', '@ffprobe-installer')

const isWin = platform() === 'win32'
const ffmpegBinName = isWin ? 'ffmpeg.exe' : 'ffmpeg'
const ffprobeBinName = isWin ? 'ffprobe.exe' : 'ffprobe'

/**
 * Рекурсивно ищет файл с именем `name` в дереве, начиная с `root`.
 * Возвращает абсолютный путь к первому найденному или null.
 * Глубина ограничена 4 уровнями (защита от циклов/глубоких node_modules).
 */
function findBinary(root, name, depth = 0) {
  if (!existsSync(root) || depth > 4) return null
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

const failures = []
if (!existsSync(asarUnpackedRoot)) {
  failures.push(`app.asar.unpacked NOT FOUND at ${asarUnpackedRoot}`)
}

// ffmpeg: бинарник лежит в ffmpeg-static/ напрямую
if (existsSync(ffmpegStaticDir)) {
  const ffmpegPath = join(ffmpegStaticDir, ffmpegBinName)
  if (!existsSync(ffmpegPath)) {
    failures.push(`ffmpeg binary missing at ${ffmpegPath}`)
  } else {
    try {
      if (statSync(ffmpegPath).size < 1024) {
        failures.push(`${ffmpegBinName} binary suspiciously small (<1KB) at ${ffmpegPath}`)
      }
    } catch {
      /* ignore stat errors */
    }
  }
} else {
  failures.push(`ffmpeg-static dir NOT unpacked at ${ffmpegStaticDir}`)
}

// ffprobe: бинарник лежит в @ffprobe-installer/<platform>-<arch>/ — рекурсивный поиск
if (existsSync(ffprobeBaseDir)) {
  const ffprobePath = findBinary(ffprobeBaseDir, ffprobeBinName)
  if (!ffprobePath) {
    failures.push(
      `${ffprobeBinName} binary not found anywhere under ${ffprobeBaseDir} ` +
        `(expected in per-OS subpackage e.g. @ffprobe-installer/win32-x64/)`
    )
  } else {
    // Доп. проверка: бинарник не пустой
    try {
      if (statSync(ffprobePath).size < 1024) {
        failures.push(`${ffprobeBinName} binary suspiciously small (<1KB) at ${ffprobePath}`)
      }
    } catch {
      /* ignore stat errors */
    }
  }
} else {
  failures.push(`@ffprobe-installer dir NOT unpacked at ${ffprobeBaseDir}`)
}

if (failures.length > 0) {
  console.error('[smoke] PACKAGED BUILD CHECK FAILED:')
  for (const f of failures) console.error('  - ' + f)
  console.error(
    '\nFix: проверь electron-builder.yml asarUnpack секцию + перезапусти `npm run build:unpack`.'
  )
  process.exit(1)
}
console.log(`[smoke] OK: ffmpeg + ffprobe бинарники найдены в ${asarUnpackedRoot}`)
process.exit(0)
