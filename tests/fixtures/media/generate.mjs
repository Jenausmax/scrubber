// Standalone fixture generator. Создаёт mp4-фикстуры через ffmpeg-static.
//
// Цели:
//   - tests/fixtures/media/short.mp4  — 5 сек, 440Hz sine tone + синий 320x240 video.
//   - tests/fixtures/media/no-audio.mp4 — 5 сек, только видео, `-an`.
//
// Запуск:
//   node tests/fixtures/media/generate.mjs
//
// Idempotent: если файлы уже существуют — не пересоздаёт.
//
// Источник: 02-RESEARCH.md §Environment Availability — точная ffmpeg-команда для генерации.
// 02-04-PLAN.md Task 1.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-static'

const execFileP = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))
const FFMPEG = ffmpegStatic
if (!FFMPEG) {
  console.error('[fixtures] ffmpeg-static did not resolve — install dependencies')
  process.exit(1)
}

mkdirSync(__dirname, { recursive: true })

async function genShort() {
  const out = resolve(__dirname, 'short.mp4')
  if (existsSync(out)) {
    console.log('[fixtures] short.mp4 already exists, skipping')
    return out
  }
  console.log('[fixtures] generating short.mp4 (5s sine 440Hz + blue 320x240)...')
  await execFileP(FFMPEG, [
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=5',
    '-shortest',
    '-y',
    out
  ])
  console.log('[fixtures] short.mp4 created:', out)
  return out
}

async function genNoAudio() {
  const out = resolve(__dirname, 'no-audio.mp4')
  if (existsSync(out)) {
    console.log('[fixtures] no-audio.mp4 already exists, skipping')
    return out
  }
  console.log('[fixtures] generating no-audio.mp4 (5s blue 320x240, no audio)...')
  await execFileP(FFMPEG, [
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=5',
    '-an',
    '-y',
    out
  ])
  console.log('[fixtures] no-audio.mp4 created:', out)
  return out
}

const main = async () => {
  await genShort()
  await genNoAudio()
  console.log('[fixtures] done')
}

main().catch((err) => {
  console.error('[fixtures] FAILED:', err)
  process.exit(1)
})
