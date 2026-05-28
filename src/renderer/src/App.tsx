// Корневой компонент renderer.
// - State-router useState<'transcribe' | 'analyze' | 'settings'>.
// - Маунт-time чтение getSecureBackend() для BackendWarningBanner.
// - Дефолтная активная вкладка — Settings (D-03: пользователь сразу попадает в рабочую часть).
//
// Источник: 01-CONTEXT.md D-03/D-04/D-07/D-15, 01-PATTERNS.md §App.tsx,
// 01-RESEARCH.md §Architecture Diagram (renderer часть).
//
// Запрещено: импорт electron/node:*/react-router-dom (D-15).

import { useEffect, useState } from 'react'
import type { SecureBackend } from '../../shared/ipc'
import BackendWarningBanner from './components/BackendWarningBanner'
import Transcribe from './routes/Transcribe'
import Analyze from './routes/Analyze'
import Settings from './routes/Settings'

type Tab = 'transcribe' | 'analyze' | 'settings'

interface TabSpec {
  id: Tab
  label: string
}

const TABS: TabSpec[] = [
  { id: 'transcribe', label: 'Транскрипция' },
  { id: 'analyze', label: 'Анализ' },
  { id: 'settings', label: 'Настройки' }
]

function App(): React.JSX.Element {
  const [active, setActive] = useState<Tab>('settings')
  const [backend, setBackend] = useState<SecureBackend | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const r = await window.scrubber.settings.getSecureBackend()
      if (!cancelled && r.ok && r.data !== undefined) {
        setBackend(r.data)
      }
    })()
    return (): void => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <nav className="flex items-center gap-1 border-b border-gray-200 bg-white px-4 py-2">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              onClick={(): void => setActive(tab.id)}
              className={
                'px-4 py-2 text-sm rounded-md transition-colors ' +
                (isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100')
              }
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      <BackendWarningBanner backend={backend} />

      <main className="flex-1 overflow-auto">
        {active === 'transcribe' && <Transcribe />}
        {active === 'analyze' && <Analyze />}
        {active === 'settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
