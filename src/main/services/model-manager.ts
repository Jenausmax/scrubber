// TRANS-02 (Wave 0 STUB): ModelManager — скачивание whisper-моделей с SHA256-проверкой.
//
// СТАТУС: RED-стаб. MODEL_MANIFEST намеренно ПУСТ + методы бросают — тесты красные.
// GREEN — в 03-03 (управление моделями): манифест URL/SHA256/size (D-10), fetch→.tmp→sha→rename,
// sha-mismatch → reason 'sha_mismatch'. Манифест НЕ заполняем здесь: финальные SHA/размеры
// сверяются на checkpoint:human-verify этого плана (Open Q2 / A3, 03-RESEARCH.md §Model Manifest).
//
// Источник: 03-RESEARCH.md §Model Manifest (160-173), §Validation Architecture (TRANS-02).

import type { Result } from '../../shared/ipc'

const NOT_IMPLEMENTED = '[model-manager] not implemented yet (Wave 0 stub — GREEN в 03-03)'

export interface ModelManifestEntry {
  /** Имя файла на диске: ggml-<name>.bin. */
  file: string
  /** HTTPS URL (HuggingFace resolve/main/). */
  url: string
  /** Точный размер в байтах. */
  sizeBytes: number
  /** SHA256 содержимого файла (анти-коррупция, D-10). */
  sha256: string
}

export interface ModelInfo {
  name: string
  sizeBytes: number
  downloaded: boolean
}

export interface ModelManager {
  list(): Promise<Result<ModelInfo[]>>
  download(name: string): Promise<Result<{ jobId: string }>>
  cancel(jobId: string): Promise<Result>
  delete(name: string): Promise<Result>
}

/**
 * Манифест моделей (D-10). ПУСТ в Wave 0 — финальные SHA256/размеры подтверждаются
 * человеком на checkpoint:human-verify (upstream может перезалить файлы, A3).
 * Заполняется в 03-03 значениями из 03-RESEARCH.md §Model Manifest.
 */
export const MODEL_MANIFEST: Record<string, ModelManifestEntry> = {}

export const modelManager: ModelManager = {
  async list(): Promise<Result<ModelInfo[]>> {
    throw new Error(NOT_IMPLEMENTED)
  },
  async download(): Promise<Result<{ jobId: string }>> {
    throw new Error(NOT_IMPLEMENTED)
  },
  async cancel(): Promise<Result> {
    throw new Error(NOT_IMPLEMENTED)
  },
  async delete(): Promise<Result> {
    throw new Error(NOT_IMPLEMENTED)
  }
}
