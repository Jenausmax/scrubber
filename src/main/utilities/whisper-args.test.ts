// TRANS-03: buildTranscribeArgs flag assembly (GREEN — реализация уже есть).
// Зеркало стиля проверки args в Phase 2.
//
// Источник: 03-PLAN-01 Task 2 behavior, 03-RESEARCH.md §buildTranscribeArgs (376-401).

import { describe, it, expect } from 'vitest'
import { buildTranscribeArgs } from './whisper-args'

const BASE = {
  modelPath: '/m/ggml-large-v3.bin',
  audioPath: '/a/clip.wav',
  language: 'ru',
  threads: 8
}

describe('buildTranscribeArgs', () => {
  it('собирает -m/-l/-pp/-oj/-t/-f в правильном порядке (ru, без VAD)', () => {
    const args = buildTranscribeArgs({ ...BASE, vadModelPath: null })
    expect(args).toEqual([
      '-m',
      '/m/ggml-large-v3.bin',
      '-l',
      'ru',
      '-pp',
      '-oj',
      '-t',
      '8',
      '-f',
      '/a/clip.wav'
    ])
  })

  it('при vadModelPath добавляет --vad -vm <path> в конец (TRANS-03)', () => {
    const args = buildTranscribeArgs({ ...BASE, vadModelPath: '/x/silero.bin' })
    expect(args).toContain('-l')
    expect(args).toContain('ru')
    expect(args).toContain('-pp')
    expect(args).toContain('-oj')
    expect(args).toContain('--vad')
    const vmIdx = args.indexOf('-vm')
    expect(vmIdx).toBeGreaterThan(-1)
    expect(args[vmIdx + 1]).toBe('/x/silero.bin')
  })

  it('при vadModelPath:null НЕ содержит --vad и -vm', () => {
    const args = buildTranscribeArgs({ ...BASE, vadModelPath: null })
    expect(args).not.toContain('--vad')
    expect(args).not.toContain('-vm')
  })

  it('-f получает audioPath as-is (WAV не ресемплится, Pitfall 7)', () => {
    const args = buildTranscribeArgs({ ...BASE, vadModelPath: null })
    const fIdx = args.indexOf('-f')
    expect(args[fIdx + 1]).toBe('/a/clip.wav')
  })

  it('threads сериализуется в строку', () => {
    const args = buildTranscribeArgs({ ...BASE, threads: 4, vadModelPath: null })
    const tIdx = args.indexOf('-t')
    expect(args[tIdx + 1]).toBe('4')
  })

  it("language 'auto' прокидывается как есть (whisper автодетект)", () => {
    const args = buildTranscribeArgs({ ...BASE, language: 'auto', vadModelPath: null })
    const lIdx = args.indexOf('-l')
    expect(args[lIdx + 1]).toBe('auto')
  })
})
