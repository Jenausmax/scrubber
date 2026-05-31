// Тесты parseProgressLine — чистая функция, никаких моков, кроме Date.now (через startedMs).
// Источник: 02-PLAN-02 Task 1 behavior table, 02-RESEARCH.md §Pattern 4.

import { describe, it, expect } from 'vitest'
import { parseProgressLine } from './progress-parser'

const DUR = 10 // 10 секунд

describe('parseProgressLine', () => {
  it('out_time_us=5000000 при durationSec=10, lastPct=-1 → percent=50', () => {
    const startedMs = Date.now() - 5_000 // 5 сек прошло
    const r = parseProgressLine('out_time_us=5000000', DUR, startedMs, -1)
    expect(r).not.toBeNull()
    expect(r!.percent).toBe(50)
    expect(typeof r!.etaSec).toBe('number')
  })

  it('out_time_us=5000000, lastPct=50 → null (дедуп)', () => {
    const r = parseProgressLine('out_time_us=5000000', DUR, Date.now(), 50)
    expect(r).toBeNull()
  })

  it('bitrate=64.0kbits/s → null (не out_time_us)', () => {
    const r = parseProgressLine('bitrate=64.0kbits/s', DUR, Date.now(), -1)
    expect(r).toBeNull()
  })

  it('out_time_us=5000000 при durationSec=0 → null (divide-by-zero guard)', () => {
    const r = parseProgressLine('out_time_us=5000000', 0, Date.now(), -1)
    expect(r).toBeNull()
  })

  it('out_time_us=5000000 при durationSec=-5 → null (negative duration)', () => {
    const r = parseProgressLine('out_time_us=5000000', -5, Date.now(), -1)
    expect(r).toBeNull()
  })

  it('out_time_us больше durationSec*1e6 → percent capped на 99', () => {
    // duration=10sec → 10e6 us = 100%. Подадим 100e6 us (10x) → должно быть capped 99.
    const r = parseProgressLine('out_time_us=100000000', DUR, Date.now(), -1)
    expect(r).not.toBeNull()
    expect(r!.percent).toBe(99)
  })

  it('строка без = → null', () => {
    const r = parseProgressLine('progress', DUR, Date.now(), -1)
    expect(r).toBeNull()
  })

  it('out_time_us=NaN-строка → null', () => {
    const r = parseProgressLine('out_time_us=abc', DUR, Date.now(), -1)
    expect(r).toBeNull()
  })

  it('pct=0 → etaSec === null (нельзя оценить ETA по нулевому прогрессу)', () => {
    const r = parseProgressLine('out_time_us=0', DUR, Date.now(), -1)
    // pct = floor(0/10*100) = 0, lastPct=-1, разрешено
    expect(r).not.toBeNull()
    expect(r!.percent).toBe(0)
    expect(r!.etaSec).toBeNull()
  })

  it('etaSec = max(0, round((100/pct - 1) * elapsed))', () => {
    // pct=50, elapsed=5s → eta = round((100/50 - 1) * 5) = round(1*5) = 5
    const startedMs = Date.now() - 5_000
    const r = parseProgressLine('out_time_us=5000000', DUR, startedMs, -1)
    expect(r!.etaSec).toBeGreaterThanOrEqual(4)
    expect(r!.etaSec).toBeLessThanOrEqual(6)
  })
})
