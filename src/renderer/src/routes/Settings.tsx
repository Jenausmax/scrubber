// Settings — единственный реально-функциональный экран Phase 1.
// Контракт: ввод API-ключа, Save через window.scrubber.settings.saveApiKey,
// маркер «Ключ сохранён», Replace flow через clearApiKey + повторный ввод.
//
// Источник: 01-CONTEXT.md D-05 (наличие vs значение), §specifics (не показывать ключ
// открытым текстом, type="password"); 01-PATTERNS.md §Settings.tsx.
// Threat: T-01 (Information Disclosure — ключ не рендерится в DOM открытым текстом).
//
// Запрещено: localStorage/sessionStorage для ключа, getSecureBackend() здесь
// (это делает App.tsx и прокидывает в BackendWarningBanner), вывод plaintext ключа.

import { useEffect, useState, type FormEvent } from 'react'

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

interface ModelRow {
  name: string
  sizeBytes: number
  downloaded: boolean
}

// Состояние строки модели в UI: простаивает / качается (percent) / ошибка.
type ModelStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'error'; text: string }

const LANGUAGE_OPTIONS = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'Автоопределение' }
]

/** Человекочитаемый размер (ГБ/МБ) из байтов — для списка моделей. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`
  return `${Math.round(bytes / 1024 ** 2)} МБ`
}

export default function Settings(): React.JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  // Раздел «Модели» (TRANS-02, D-09): список + статус скачивания + job-ids.
  const [models, setModels] = useState<ModelRow[]>([])
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({})
  const [jobIds, setJobIds] = useState<Record<string, string>>({})

  // Несекретные настройки (D-08/D-02): выбор модели/языка/таймкодов.
  const [selectedModel, setSelectedModel] = useState('medium')
  const [selectedLanguage, setSelectedLanguage] = useState('ru')
  const [timecodesEnabled, setTimecodesEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const r = await window.scrubber.settings.hasApiKey()
      if (!cancelled && r.ok && r.data !== undefined) {
        setHasKey(r.data)
      } else if (!cancelled && !r.ok) {
        setStatus({ kind: 'error', text: r.reason })
      }
    })()
    return (): void => {
      cancelled = true
    }
  }, [])

  // Загрузка списка моделей + несекретных настроек.
  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const [listRes, prefsRes] = await Promise.all([
        window.scrubber.models.list(),
        window.scrubber.settings.getPreferences()
      ])
      if (cancelled) return
      if (listRes.ok && listRes.data) setModels(listRes.data)
      if (prefsRes.ok && prefsRes.data) {
        setSelectedModel(prefsRes.data.selectedModel)
        setSelectedLanguage(prefsRes.data.selectedLanguage)
        setTimecodesEnabled(prefsRes.data.timecodesEnabled)
      }
    })()
    return (): void => {
      cancelled = true
    }
  }, [])

  // Подписка на прогресс скачивания моделей (MODELS_PROGRESS).
  useEffect(() => {
    const unsub = window.scrubber.models.onProgress((e) => {
      setModelStatus((prev) => ({ ...prev, [e.name]: { kind: 'downloading', percent: e.percent } }))
    })
    return unsub
  }, [])

  async function refreshModels(): Promise<void> {
    const r = await window.scrubber.models.list()
    if (r.ok && r.data) setModels(r.data)
  }

  async function handleDownloadModel(name: string): Promise<void> {
    setModelStatus((prev) => ({ ...prev, [name]: { kind: 'downloading', percent: 0 } }))
    const r = await window.scrubber.models.download(name)
    if (r.ok && r.data) {
      setJobIds((prev) => ({ ...prev, [name]: r.data!.jobId }))
    }
    // download резолвится по завершению (как extractAudio) — обновляем по факту.
    if (r.ok) {
      setModelStatus((prev) => ({ ...prev, [name]: { kind: 'idle' } }))
      await refreshModels()
    } else {
      setModelStatus((prev) => ({ ...prev, [name]: { kind: 'error', text: r.reason } }))
    }
  }

  async function handleCancelModel(name: string): Promise<void> {
    const jobId = jobIds[name]
    if (jobId) await window.scrubber.models.cancel(jobId)
    setModelStatus((prev) => ({ ...prev, [name]: { kind: 'idle' } }))
  }

  async function handleDeleteModel(name: string): Promise<void> {
    const r = await window.scrubber.models.delete(name)
    if (r.ok) {
      await refreshModels()
    } else {
      setModelStatus((prev) => ({ ...prev, [name]: { kind: 'error', text: r.reason } }))
    }
  }

  async function persistModel(value: string): Promise<void> {
    setSelectedModel(value)
    await window.scrubber.settings.setPreference('selectedModel', value)
  }

  async function persistLanguage(value: string): Promise<void> {
    setSelectedLanguage(value)
    await window.scrubber.settings.setPreference('selectedLanguage', value)
  }

  async function persistTimecodes(value: boolean): Promise<void> {
    setTimecodesEnabled(value)
    await window.scrubber.settings.setPreference('timecodesEnabled', value)
  }

  async function handleSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    const trimmed = input.trim()
    if (trimmed === '') {
      setStatus({ kind: 'error', text: 'Введите ключ' })
      return
    }
    setStatus({ kind: 'saving' })
    const r = await window.scrubber.settings.saveApiKey(input)
    if (r.ok) {
      setHasKey(true)
      setInput('')
      setStatus({ kind: 'success', text: 'Сохранено' })
    } else {
      setStatus({ kind: 'error', text: r.reason })
    }
  }

  async function handleReplace(): Promise<void> {
    setStatus({ kind: 'idle' })
    const r = await window.scrubber.settings.clearApiKey()
    if (r.ok) {
      setHasKey(false)
      setInput('')
    } else {
      setStatus({ kind: 'error', text: r.reason })
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-semibold mb-4">Настройки</h1>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">API-ключ</h2>

        {hasKey === null ? (
          <p className="text-gray-500 text-sm">Загрузка…</p>
        ) : hasKey ? (
          <div className="space-y-3">
            <div
              role="status"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-green-100 text-green-900 border border-green-300 text-sm"
            >
              <span aria-hidden="true">✓</span>
              <span>Ключ сохранён</span>
            </div>
            <div>
              <button
                type="button"
                onClick={(): void => {
                  void handleReplace()
                }}
                className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300"
              >
                Заменить
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e): void => {
              void handleSave(e)
            }}
            className="space-y-3"
          >
            <label className="block">
              <span className="block text-sm text-gray-700 mb-1">
                OpenAI-compatible API key
              </span>
              <input
                type="password"
                value={input}
                onChange={(e): void => setInput(e.target.value)}
                placeholder="OpenAI-compatible API key"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <button
              type="submit"
              disabled={status.kind === 'saving'}
              className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {status.kind === 'saving' ? 'Сохранение…' : 'Сохранить'}
            </button>
          </form>
        )}

        {status.kind === 'success' && (
          <p className="mt-3 text-sm text-green-700">{status.text}</p>
        )}
        {status.kind === 'error' && (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {status.text}
          </p>
        )}
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">Модели</h2>
        <p className="text-sm text-gray-600 mb-3">
          Модели Whisper скачиваются по запросу и не входят в установщик. Выберите модель
          для распознавания и при необходимости скачайте её.
        </p>

        <ul className="space-y-3">
          {models.map((m) => {
            const st = modelStatus[m.name] ?? { kind: 'idle' }
            return (
              <li
                key={m.name}
                className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-md"
              >
                <div className="min-w-0">
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-2 text-sm text-gray-500">{formatBytes(m.sizeBytes)}</span>
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded ${
                      m.downloaded
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {m.downloaded ? 'скачана' : 'не скачана'}
                  </span>
                  {st.kind === 'downloading' && (
                    <div className="mt-2 w-48">
                      <div className="w-full bg-blue-100 rounded h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-600 h-1.5 transition-all"
                          style={{ width: `${st.percent}%` }}
                        />
                      </div>
                      <p className="text-xs text-blue-800 mt-1" role="status">
                        Скачивание… {st.percent}%
                      </p>
                    </div>
                  )}
                  {st.kind === 'error' && (
                    <p className="text-xs text-red-700 mt-1" role="alert">
                      Ошибка скачивания: {st.text}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {st.kind === 'downloading' ? (
                    <button
                      type="button"
                      onClick={(): void => {
                        void handleCancelModel(m.name)
                      }}
                      className="px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300"
                    >
                      Отмена
                    </button>
                  ) : m.downloaded ? (
                    <button
                      type="button"
                      onClick={(): void => {
                        void handleDeleteModel(m.name)
                      }}
                      className="px-3 py-1.5 text-sm rounded-md bg-red-100 text-red-800 hover:bg-red-200"
                    >
                      Удалить
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(): void => {
                        void handleDownloadModel(m.name)
                      }}
                      className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Скачать
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-sm text-gray-700 mb-1">Модель для распознавания</span>
            <select
              value={selectedModel}
              onChange={(e): void => {
                void persistModel(e.target.value)
              }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-sm text-gray-700 mb-1">Язык распознавания</span>
            <select
              value={selectedLanguage}
              onChange={(e): void => {
                void persistLanguage(e.target.value)
              }}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={timecodesEnabled}
              onChange={(e): void => {
                void persistTimecodes(e.target.checked)
              }}
            />
            <span>Показывать таймкоды в транскрипте</span>
          </label>
        </div>
      </section>
    </div>
  )
}
