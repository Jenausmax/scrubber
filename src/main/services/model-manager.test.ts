// TRANS-02 (RED-стаб, Wave 0): ModelManager — скачивание whisper-моделей с SHA256-проверкой.
//   - манифест моделей (URL + SHA256 + size) — D-10;
//   - download(name): fetch → .tmp → sha256-сверка → rename; sha-mismatch → fail (reason sha_mismatch);
//   - list() возвращает {name, sizeBytes, downloaded}.
//
// GREEN придёт в 03-03 (управление моделями): src/main/services/model-manager.ts —
// мок global fetch + node:crypto sha256. Этот файл RED: модуль ещё не существует.
//
// Источник: 03-RESEARCH.md §Model Manifest (160-173), §Validation Architecture (TRANS-02).

import { describe, it, expect } from 'vitest'

async function loadModelManager(): Promise<typeof import('./model-manager')> {
  return import('./model-manager')
}

describe('ModelManager (TRANS-02, RED — реализация в 03-03)', () => {
  it('экспортирует MODEL_MANIFEST с URL+SHA256+size для small/medium/large-v3/silero (D-10)', async () => {
    const mod = await loadModelManager()
    expect(mod.MODEL_MANIFEST).toBeDefined()
    expect(mod.MODEL_MANIFEST['large-v3']).toMatchObject({
      sha256: expect.any(String),
      url: expect.stringContaining('huggingface.co')
    })
  })

  it('list() возвращает массив {name, sizeBytes, downloaded}', async () => {
    const mod = await loadModelManager()
    expect(typeof mod.modelManager.list).toBe('function')
  })

  it('download: sha256 mismatch → Result reason sha_mismatch (анти-коррупция D-10)', async () => {
    // RED: после GREEN — мок fetch отдаёт «битые» байты, ожидаем reason 'sha_mismatch'.
    const mod = await loadModelManager()
    expect(typeof mod.modelManager.download).toBe('function')
  })
})
