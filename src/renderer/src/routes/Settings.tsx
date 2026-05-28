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

export default function Settings(): React.JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

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

  if (hasKey === null) {
    return (
      <div className="p-8 text-gray-500">
        <p>Загрузка…</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-2xl font-semibold mb-4">Настройки</h1>

      <section className="mb-6">
        <h2 className="text-lg font-medium mb-2">API-ключ</h2>

        {hasKey ? (
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
    </div>
  )
}
