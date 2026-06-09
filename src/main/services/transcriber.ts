// TRANS-05/06 (Wave 0 STUB): Transcriber на utilityProcess.fork.
//
// СТАТУС: RED-стаб. Singleton + сигнатуры зафиксированы (контракт для transcriber.test.ts),
// но методы НЕ реализованы — бросают, тесты красные. GREEN — в 03-02 (ядро pipeline):
// зеркало media-extractor.ts (fork whisper-runner.cjs, прогресс/сегменты, cancel→SIGTERM→cancelled).
//
// Источник: 03-PATTERNS.md §transcriber, media-extractor.ts (эталон).

import type { Result } from '../../shared/ipc'

const NOT_IMPLEMENTED = '[transcriber] not implemented yet (Wave 0 stub — GREEN в 03-02)'

export interface StartTranscribeOpts {
  model: string
  language: string
}

export interface Transcriber {
  /** Идемпотентная инициализация (asar-guards, chmod, mkdir userData/models). */
  init(): Promise<void>
  /** TRANS-06: неблокирующий старт через utilityProcess.fork. */
  startTranscribe(
    audioPath: string,
    opts: StartTranscribeOpts
  ): Promise<Result<{ jobId: string }>>
  /** TRANS-05: SIGTERM в utility-процесс → reason cancelled. */
  cancel(jobId: string): Promise<Result>
}

export const transcriber: Transcriber = {
  async init(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED)
  },
  async startTranscribe(): Promise<Result<{ jobId: string }>> {
    throw new Error(NOT_IMPLEMENTED)
  },
  async cancel(): Promise<Result> {
    throw new Error(NOT_IMPLEMENTED)
  }
}
