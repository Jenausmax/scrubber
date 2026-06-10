// TRANS-02 (GREEN, 03-03): ModelManager — скачивание whisper-моделей с SHA256-проверкой.
//   - манифест моделей (URL + SHA256 + size) — D-10;
//   - download(name): fetch → .tmp → sha256-сверка → rename; sha-mismatch → fail (reason sha_mismatch);
//   - cancel → abort + unlink; list() возвращает {name, sizeBytes, downloaded}.
//
// Стратегия теста: мокаем global fetch (отдаём контролируемые байты с известным SHA256)
// и whisper-paths (resolveModel/resolveVadModel → tmpdir). Реальной сети нет.
//
// Источник: 03-RESEARCH.md §Model Manifest (160-173), §Validation Architecture (TRANS-02).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// resolveModel/resolveVadModel → изолированный per-test каталог моделей.
let modelsDir: string
vi.mock('./whisper-paths', () => ({
  resolveModel: (name: string): string => join(modelsDir, `ggml-${name}.bin`),
  resolveVadModel: (): string => join(modelsDir, 'ggml-silero-v5.1.2.bin')
}))

async function loadModelManager(): Promise<typeof import('./model-manager')> {
  return import('./model-manager')
}

/** Построить мок Response со стримом из заданных байтов + content-length. */
function makeResponse(bytes: Uint8Array, opts?: { status?: number }): Response {
  const status = opts?.status ?? 200
  let sent = false
  const body = {
    getReader(): {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>
    } {
      return {
        read: async () => {
          if (sent) return { done: true, value: undefined }
          sent = true
          return { done: false, value: bytes }
        }
      }
    }
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? String(bytes.length) : null) },
    body
  } as unknown as Response
}

const GOOD_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const GOOD_SHA = createHash('sha256').update(GOOD_BYTES).digest('hex')

describe('ModelManager (TRANS-02, GREEN — 03-03)', () => {
  beforeEach(async () => {
    modelsDir = join(tmpdir(), `scrubber-models-test-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(modelsDir, { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(modelsDir, { recursive: true, force: true }).catch(() => {})
  })

  it('экспортирует MODEL_MANIFEST с URL+SHA256+size для small/medium/large-v3/silero (D-10)', async () => {
    const mod = await loadModelManager()
    expect(mod.MODEL_MANIFEST['large-v3']).toMatchObject({
      sha256: expect.any(String),
      url: expect.stringContaining('huggingface.co'),
      sizeBytes: expect.any(Number)
    })
    expect(mod.MODEL_MANIFEST.silero.url).toContain('huggingface.co')
  })

  it('list() возвращает {name, sizeBytes, downloaded} для selectable-моделей', async () => {
    const mod = await loadModelManager()
    const r = await mod.modelManager.list()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const names = r.data!.map((m) => m.name).sort()
    expect(names).toEqual(['large-v3', 'medium', 'small'])
    expect(r.data!.every((m) => m.downloaded === false)).toBe(true)
    expect(r.data!.every((m) => typeof m.sizeBytes === 'number')).toBe(true)
  })

  it('list() отмечает downloaded=true, если файл существует на диске', async () => {
    const mod = await loadModelManager()
    await fs.writeFile(join(modelsDir, 'ggml-medium.bin'), 'x')
    const r = await mod.modelManager.list()
    if (!r.ok) throw new Error('expected ok')
    expect(r.data!.find((m) => m.name === 'medium')!.downloaded).toBe(true)
  })

  it('download happy-path: fetch → .tmp → sha ok → rename в final', async () => {
    const mod = await loadModelManager()
    // Подменяем манифест на тестовый SHA (содержимое контролируем мы).
    mod.MODEL_MANIFEST.small.sha256 = GOOD_SHA
    mod.MODEL_MANIFEST.silero.sha256 = GOOD_SHA
    const fetchMock = vi.fn(async () => makeResponse(GOOD_BYTES))
    vi.stubGlobal('fetch', fetchMock)

    const r = await mod.modelManager.download('small')
    expect(r.ok).toBe(true)
    expect(existsSync(join(modelsDir, 'ggml-small.bin'))).toBe(true)
    // .tmp не должен оставаться
    expect(existsSync(join(modelsDir, 'ggml-small.bin.tmp'))).toBe(false)
    // silero обеспечивается первым
    expect(existsSync(join(modelsDir, 'ggml-silero-v5.1.2.bin'))).toBe(true)
  })

  it('download: sha256 mismatch → reason sha_mismatch + .tmp удалён (анти-коррупция D-10)', async () => {
    const mod = await loadModelManager()
    // silero ok (чтобы не падать на нём), основная модель — несовпадающий SHA.
    mod.MODEL_MANIFEST.silero.sha256 = GOOD_SHA
    mod.MODEL_MANIFEST.medium.sha256 = 'deadbeef'.repeat(8)
    vi.stubGlobal('fetch', vi.fn(async () => makeResponse(GOOD_BYTES)))

    const r = await mod.modelManager.download('medium')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('sha_mismatch')
    expect(existsSync(join(modelsDir, 'ggml-medium.bin'))).toBe(false)
    expect(existsSync(join(modelsDir, 'ggml-medium.bin.tmp'))).toBe(false)
  })

  it('download: имя вне whitelist → invalid_argument (анти-SSRF)', async () => {
    const mod = await loadModelManager()
    const r = await mod.modelManager.download('../etc/passwd')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid_argument')
    // silero (внутренняя запись манифеста) тоже не качается напрямую
    const r2 = await mod.modelManager.download('silero')
    expect(r2.ok).toBe(false)
  })

  it('download: сетевая ошибка → download_failed', async () => {
    const mod = await loadModelManager()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down')
      })
    )
    const r = await mod.modelManager.download('small')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('download_failed')
  })

  it('cancel(jobId неизвестный) → invalid_argument', async () => {
    const mod = await loadModelManager()
    const r = await mod.modelManager.cancel('00000000-0000-0000-0000-000000000000')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('invalid_argument')
  })

  it('delete: существующую модель удаляет; отсутствующую — идемпотентно ok', async () => {
    const mod = await loadModelManager()
    await fs.writeFile(join(modelsDir, 'ggml-large-v3.bin'), 'x')
    const r1 = await mod.modelManager.delete('large-v3')
    expect(r1.ok).toBe(true)
    expect(existsSync(join(modelsDir, 'ggml-large-v3.bin'))).toBe(false)
    // повторно — всё равно ok (идемпотентно)
    const r2 = await mod.modelManager.delete('large-v3')
    expect(r2.ok).toBe(true)
  })

  it('delete: имя вне whitelist → invalid_argument', async () => {
    const mod = await loadModelManager()
    const r = await mod.modelManager.delete('evil')
    expect(r.ok).toBe(false)
  })
})
