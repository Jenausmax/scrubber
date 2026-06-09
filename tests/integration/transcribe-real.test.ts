// TRANS-01 (RED-стаб, Wave 0): реальный whisper-cli транскрибирует короткий ru-WAV офлайн.
//
// Gated по наличию whisper-cli (как extract-real gated по ffmpeg): если бинарника нет
// в resources/whisper/<platform-arch>/ — кейс помечается skip (не fail на отсутствии binary).
// Полный pipeline (utilityProcess.fork) требует Electron-рантайма; здесь — прямой вызов
// whisper-cli через child_process на tiny/small модели + короткой ru-фикстуре.
//
// GREEN придёт в 03-02 (ядро pipeline): фикстура ru-WAV + tiny/small модель + сверка текста.
// Сейчас стаб RED/skip: модуль whisper-args есть, но runner/фикстуры ещё нет.
//
// Источник: 03-RESEARCH.md §Validation Architecture (TRANS-01), extract-real.test.ts (эталон gating).

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildTranscribeArgs } from '../../src/main/utilities/whisper-args'

const WHISPER_DIR = resolve(
  __dirname,
  '..',
  '..',
  'resources',
  'whisper',
  `${process.platform}-${process.arch}`
)
const WHISPER_CLI = join(
  WHISPER_DIR,
  process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
)
const HAS_WHISPER = existsSync(WHISPER_CLI)

describe('transcribe-real (TRANS-01, RED/gated — GREEN в 03-02)', () => {
  // Контрактный кейс: всегда выполняется (не зависит от бинарника) — args корректны.
  it('buildTranscribeArgs даёт -l ru + -f <wav> для реального вызова', () => {
    const args = buildTranscribeArgs({
      modelPath: join(WHISPER_DIR, 'ggml-small.bin'),
      audioPath: join(WHISPER_DIR, 'sample-ru.wav'),
      language: 'ru',
      vadModelPath: null,
      threads: 4
    })
    expect(args).toContain('-l')
    expect(args).toContain('ru')
    expect(args).toContain('-f')
  })

  // Реальный whisper-прогон: skip пока нет бинарника + ru-фикстуры + модели (GREEN в 03-02).
  it.skipIf(!HAS_WHISPER)(
    'whisper-cli транскрибирует короткий ru-WAV офлайн (GREEN в 03-02)',
    () => {
      // RED/TODO: в 03-02 — spawn whisper-cli с buildTranscribeArgs на ru-фикстуре,
      // прочитать -oj JSON, проверить непустой текст. Пока намеренно падает как напоминание.
      expect.fail('TRANS-01 GREEN не реализован — см. 03-02 (ядро pipeline)')
    }
  )
})
