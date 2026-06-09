// TRANS-05/06 (RED-стаб, Wave 0): Transcriber service на utilityProcess.fork.
//   - start() не блокирует main (fork, не spawn в main-процессе) — TRANS-06;
//   - cancel(jobId) → SIGTERM в utility-процесс → reason 'cancelled' — TRANS-05.
//
// GREEN придёт в 03-02 (ядро pipeline): src/main/services/transcriber.ts —
// зеркало media-extractor.ts (ForkMock + overrideUserDataPath + vi.mock whisper-paths).
// Этот файл RED: модуль transcriber ещё не существует → динамический import падает.
//
// Источник: 03-PATTERNS.md §transcriber.test.ts (297-308), media-extractor.test.ts (эталон).

import { describe, it, expect } from 'vitest'

async function loadTranscriber(): Promise<typeof import('./transcriber')> {
  return import('./transcriber')
}

describe('Transcriber (TRANS-05/06, RED — реализация в 03-02)', () => {
  it('TRANS-06: экспортирует singleton transcriber c init()/startTranscribe()/cancel()', async () => {
    const mod = await loadTranscriber()
    expect(mod.transcriber).toBeDefined()
    expect(typeof mod.transcriber.init).toBe('function')
    expect(typeof mod.transcriber.startTranscribe).toBe('function')
    expect(typeof mod.transcriber.cancel).toBe('function')
  })

  it('TRANS-06: start не блокирует — использует utilityProcess.fork, не sync spawn в main', async () => {
    // RED: пока модуля нет, fail на import. После GREEN — проверка через ForkMock,
    // что fork вызван, а main не блокируется (зеркало media-extractor.test).
    const mod = await loadTranscriber()
    expect(mod.transcriber).toBeDefined()
  })

  it('TRANS-05: cancel(jobId) шлёт SIGTERM и резолвит reason cancelled', async () => {
    // RED: после GREEN — ForkMock.__emit + проверка kill() + Result reason 'cancelled'.
    const mod = await loadTranscriber()
    expect(typeof mod.transcriber.cancel).toBe('function')
  })
})
