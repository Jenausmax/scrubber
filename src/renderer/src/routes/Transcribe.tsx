// Transcribe FSM-экран — оркеструет pickFile/probe/extractAudio/cancel + onProgress.
// Источник: 02-UI-SPEC.md §State Map / §Copywriting Contract / §Layout & Sizing;
//          02-PATTERNS.md §routes/Transcribe.tsx; 02-CONTEXT.md D-03..D-12.
// CONTEXT решения:
//   D-03 — drop-zone на вкладке Transcribe (не отдельный экран)
//   D-05 — после выбора meta + CTA «Извлечь аудио»; авто-старт отвергнут
//   D-06/07 — валидация .mp4 + multi-drop в DropZone
//   D-08 — progress event-канал MEDIA_PROGRESS через onProgress
//   D-09 — cancel: SIGTERM + сообщение «Извлечение отменено»
//   D-10 — один активный job
//   D-12 — cache-hit (gap: UI-SPEC требует отличить заголовок,
//          но MediaExtractResult не несёт `cacheHit` — backend gap для Plan 04+;
//          в текущем плане cacheHit всегда false)
//
// GAP «Открыть папку»: shell.showItemInFolder отсутствует в shared/ipc — кнопка
// заменена на «Скопировать путь» через navigator.clipboard (документировано в SUMMARY).

import { useEffect, useRef, useState } from 'react'
import type {
  MediaProbeResult,
  MediaReason,
  TranscribeReason
} from '../../../shared/ipc'
import DropZone from '../components/DropZone'
import FileMetaCard from '../components/FileMetaCard'
import ExtractProgress from '../components/ExtractProgress'
import ExtractDone from '../components/ExtractDone'
import TranscribeProgress from '../components/TranscribeProgress'
import TranscriptResult from '../components/TranscriptResult'
import InlineError from '../components/InlineError'
import { buildDisplayText } from '../lib/transcript-display'

// Дефолты на случай, если getPreferences ещё не загрузился (D-08/D-02).
const DEFAULT_MODEL = 'medium'
const DEFAULT_LANGUAGE = 'ru'

// Языки селектора (D-14): ru по умолчанию + auto + частые.
const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'auto', label: 'Автоопределение' },
  { value: 'en', label: 'Английский' },
  { value: 'de', label: 'Немецкий' },
  { value: 'fr', label: 'Французский' },
  { value: 'es', label: 'Испанский' }
]

interface TranscribeSegment {
  startMs: number
  text: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'idle-drag-over' }
  | { kind: 'validating'; path: string }
  | { kind: 'selected'; meta: MediaProbeResult; path: string }
  | {
      kind: 'extracting'
      jobId: string | null
      meta: MediaProbeResult
      path: string
      percent: number
      etaSec: number | null
    }
  | { kind: 'done'; audioPath: string; cacheHit: boolean }
  // Phase 3 (03-02): транскрипция извлечённого WAV.
  | {
      kind: 'transcribing'
      jobId: string | null
      audioPath: string
      percent: number
      segments: TranscribeSegment[]
    }
  | {
      kind: 'transcript-done'
      mdPath: string
      text: string
      segments: TranscribeSegment[]
    }
  // D-13: транскрипция отменена, но накопленные сегменты ценны — предлагаем сохранить.
  | { kind: 'transcript-cancelled-partial'; segments: TranscribeSegment[] }
  | { kind: 'transcript-error'; reason: TranscribeReason }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: MediaReason }

export default function Transcribe(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [cancelledMsg, setCancelledMsg] = useState(false)
  const [copied, setCopied] = useState(false)
  // Несекретные настройки (D-08/D-02). selectedModel — какую модель запускать,
  // modelAvailable — есть ли она на диске (D-09: model_missing-блок).
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [selectedLanguage, setSelectedLanguage] = useState(DEFAULT_LANGUAGE)
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null)
  // D-02: дефолт тумблера таймкодов из settings-store (false по умолчанию).
  const [timecodesEnabled, setTimecodesEnabled] = useState(false)
  // Храним актуальный state в ref для onProgress-handler'а, который замыкает
  // первое значение setState через useEffect.
  const stateRef = useRef<State>(state)
  stateRef.current = state

  // Subscription на MEDIA_PROGRESS — один раз на mount.
  useEffect(() => {
    const unsub = window.scrubber.media.onProgress((e) => {
      const s = stateRef.current
      if (s.kind !== 'extracting') return
      // Если jobId ещё неизвестен — первый event «привязывает» job к UI.
      if (s.jobId === null || s.jobId === e.jobId) {
        setState({
          kind: 'extracting',
          jobId: e.jobId,
          meta: s.meta,
          path: s.path,
          percent: e.percent,
          etaSec: e.etaSec
        })
      }
    })
    return unsub
  }, [])

  // Subscription на TRANSCRIBE_PROGRESS/SEGMENT — один раз на mount (зеркало media).
  useEffect(() => {
    const unsubProgress = window.scrubber.transcribe.onProgress((e) => {
      setState((prev) => {
        if (prev.kind !== 'transcribing') return prev
        if (prev.jobId !== null && prev.jobId !== e.jobId) return prev
        return { ...prev, jobId: e.jobId, percent: e.percent }
      })
    })
    const unsubSegment = window.scrubber.transcribe.onSegment((e) => {
      // Функциональный setState: несколько сегментов могут прийти в одном тике —
      // читаем актуальный prev, чтобы не терять накопленное (stale-closure guard).
      setState((prev) => {
        if (prev.kind !== 'transcribing') return prev
        if (prev.jobId !== null && prev.jobId !== e.jobId) return prev
        return {
          ...prev,
          jobId: e.jobId,
          segments: [...prev.segments, { startMs: e.startMs, text: e.text }]
        }
      })
    })
    return () => {
      unsubProgress()
      unsubSegment()
    }
  }, [])

  // Загрузка настроек + проверка наличия выбранной модели на диске (D-09).
  // model_missing-блок: если модель не скачана — кнопка транскрипции заблокирована
  // с отсылкой в Настройки → Модели.
  useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      const [prefsRes, listRes] = await Promise.all([
        window.scrubber.settings.getPreferences(),
        window.scrubber.models.list()
      ])
      if (cancelled) return
      let model = DEFAULT_MODEL
      if (prefsRes.ok && prefsRes.data) {
        model = prefsRes.data.selectedModel
        setSelectedModel(prefsRes.data.selectedModel)
        setSelectedLanguage(prefsRes.data.selectedLanguage)
        setTimecodesEnabled(prefsRes.data.timecodesEnabled)
      }
      if (listRes.ok && listRes.data) {
        const row = listRes.data.find((m) => m.name === model)
        setModelAvailable(row ? row.downloaded : false)
      } else {
        setModelAvailable(false)
      }
    })()
    return (): void => {
      cancelled = true
    }
  }, [])

  function resetIdle(): void {
    setCancelledMsg(false)
    setCopied(false)
    setState({ kind: 'idle' })
  }

  async function handleTranscribe(): Promise<void> {
    if (state.kind !== 'done') return
    const { audioPath } = state
    setState({ kind: 'transcribing', jobId: null, audioPath, percent: 0, segments: [] })
    // NB: timecodesEnabled персистится в settings-store (D-02), но НЕ передаётся в
    // transcribe.start — auto-save (D-01) всегда пишет сплошной текст; тумблер
    // применяется renderer-side в 03-04 пересборкой из сегментов БЕЗ re-run whisper.
    const r = await window.scrubber.transcribe.start(audioPath, {
      model: selectedModel,
      language: selectedLanguage
    })
    if (r.ok && r.data) {
      setState({
        kind: 'transcript-done',
        mdPath: r.data.mdPath,
        text: r.data.text,
        segments: r.data.segments
      })
      return
    }
    const reason = (!r.ok ? (r.reason as TranscribeReason) : 'internal') ?? 'internal'
    if (reason === 'cancelled') {
      // D-13: не сбрасываем в idle — предлагаем сохранить накопленные сегменты.
      const s = stateRef.current
      const partial = s.kind === 'transcribing' ? s.segments : []
      setState({ kind: 'transcript-cancelled-partial', segments: partial })
      return
    }
    // model_missing (D-09): синхронизируем флаг доступности — кнопка заблокируется.
    if (reason === 'model_missing') {
      setModelAvailable(false)
    }
    setState({ kind: 'transcript-error', reason })
  }

  async function handleOpenTranscript(): Promise<void> {
    if (state.kind !== 'transcript-done') return
    await window.scrubber.transcribe.openFile(state.mdPath)
  }

  async function handleRevealTranscript(): Promise<void> {
    if (state.kind !== 'transcript-done') return
    await window.scrubber.transcribe.revealInFolder(state.mdPath)
  }

  // D-05: «Сохранить как» — отправляем ТОЛЬКО md-контент, имя файла формирует main.
  async function handleSaveAs(md: string): Promise<void> {
    await window.scrubber.transcribe.saveAs(md)
  }

  // D-13: сохранить частичный транскрипт из накопленных сегментов (после отмены).
  async function handleSavePartial(): Promise<void> {
    if (state.kind !== 'transcript-cancelled-partial') return
    const md = buildDisplayText(state.segments, timecodesEnabled)
    await window.scrubber.transcribe.saveAs(md)
  }

  // TRANS-05: отмена идущей транскрипции (SIGTERM → reason cancelled → partial-save).
  async function handleCancelTranscribe(): Promise<void> {
    if (state.kind !== 'transcribing' || state.jobId === null) return
    await window.scrubber.transcribe.cancel(state.jobId)
  }

  async function handlePathSelected(path: string): Promise<void> {
    setCancelledMsg(false)
    setState({ kind: 'validating', path })
    const r = await window.scrubber.media.probe(path)
    if (r.ok && r.data) {
      setState({ kind: 'selected', meta: r.data, path })
    } else {
      const reason = (!r.ok ? (r.reason as MediaReason) : 'internal') ?? 'internal'
      setState({ kind: 'error', reason })
    }
  }

  async function handlePickClick(): Promise<void> {
    const r = await window.scrubber.media.pickFile()
    if (!r.ok) {
      setState({ kind: 'error', reason: (r.reason as MediaReason) ?? 'internal' })
      return
    }
    if (!r.data) {
      // dialog cancelled — остаёмся в idle
      return
    }
    await handlePathSelected(r.data.path)
  }

  function handleDropError(reason: MediaReason): void {
    setState({ kind: 'error', reason })
  }

  async function handleExtract(): Promise<void> {
    if (state.kind !== 'selected') return
    const { meta, path } = state
    setState({
      kind: 'extracting',
      jobId: null,
      meta,
      path,
      percent: 0,
      etaSec: null
    })
    const r = await window.scrubber.media.extractAudio(path)
    if (r.ok && r.data) {
      setState({ kind: 'done', audioPath: r.data.audioPath, cacheHit: false })
      return
    }
    const reason = (!r.ok ? (r.reason as MediaReason) : 'internal') ?? 'internal'
    if (reason === 'cancelled') {
      setCancelledMsg(true)
      setState({ kind: 'idle' })
      return
    }
    setState({ kind: 'error', reason })
  }

  async function handleCancel(): Promise<void> {
    if (state.kind !== 'extracting' || state.jobId === null) return
    await window.scrubber.media.cancel(state.jobId)
    // Финальная транзиция произойдёт в handleExtract по resolve extractAudio
    // (reason: 'cancelled' → idle + cancelledMsg).
  }

  async function handleCopyPath(): Promise<void> {
    if (state.kind !== 'done') return
    try {
      await navigator.clipboard.writeText(state.audioPath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard может быть недоступен — тихо игнорируем, путь виден глазами
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Транскрипция</h1>

      {(state.kind === 'idle' ||
        state.kind === 'idle-drag-over' ||
        state.kind === 'validating') && (
        <>
          <DropZone
            onPick={(p): void => {
              void handlePathSelected(p)
            }}
            onError={handleDropError}
            onPickClick={(): void => {
              void handlePickClick()
            }}
            disabled={state.kind === 'validating'}
            dragOver={state.kind === 'idle-drag-over'}
            onDragOver={(): void => {
              if (stateRef.current.kind === 'idle') {
                setState({ kind: 'idle-drag-over' })
              }
            }}
            onDragLeave={(): void => {
              if (stateRef.current.kind === 'idle-drag-over') {
                setState({ kind: 'idle' })
              }
            }}
          />
          {state.kind === 'validating' && (
            <p className="mt-3 text-sm text-gray-600" role="status">
              Проверяем файл…
            </p>
          )}
          {state.kind !== 'validating' && cancelledMsg && (
            <p className="mt-3 text-sm text-gray-700" role="status">
              Извлечение отменено
            </p>
          )}
        </>
      )}

      {state.kind === 'selected' && (
        <FileMetaCard
          meta={state.meta}
          onExtract={(): void => {
            void handleExtract()
          }}
          onReset={resetIdle}
        />
      )}

      {state.kind === 'extracting' && (
        <ExtractProgress
          filename={state.meta.name}
          percent={state.percent}
          etaSec={state.etaSec}
          onCancel={(): void => {
            void handleCancel()
          }}
          cancelDisabled={state.jobId === null}
        />
      )}

      {state.kind === 'done' && (
        <div className="space-y-4">
          <ExtractDone
            audioPath={state.audioPath}
            cacheHit={state.cacheHit}
            onCopyPath={(): void => {
              void handleCopyPath()
            }}
            onReset={resetIdle}
            copied={copied}
          />
          <div className="flex items-center gap-2">
            <label htmlFor="transcribe-language" className="text-sm text-gray-700">
              Язык
            </label>
            <select
              id="transcribe-language"
              value={selectedLanguage}
              onChange={(e): void => {
                const lang = e.target.value
                setSelectedLanguage(lang)
                void window.scrubber.settings.setPreference('selectedLanguage', lang)
              }}
              className="text-sm rounded-md border border-gray-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={modelAvailable === false}
            onClick={(): void => {
              void handleTranscribe()
            }}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Транскрибировать
          </button>
          {modelAvailable === false && (
            <p className="text-sm text-amber-700" role="alert">
              Модель «{selectedModel}» не скачана — перейдите в Настройки → Модели,
              чтобы загрузить её.
            </p>
          )}
        </div>
      )}

      {state.kind === 'transcribing' && (
        <TranscribeProgress
          percent={state.percent}
          segments={state.segments}
          onCancel={(): void => {
            void handleCancelTranscribe()
          }}
          cancelDisabled={state.jobId === null}
        />
      )}

      {state.kind === 'transcript-cancelled-partial' && (
        <div
          role="status"
          className="p-6 rounded-md border border-amber-300 bg-amber-50 text-amber-900 space-y-4"
        >
          <h2 className="text-lg font-medium">Транскрипция отменена</h2>
          <p className="text-sm">
            Распознанная часть сохранена. Можно сохранить частичный транскрипт в файл.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={(): void => {
                void handleSavePartial()
              }}
              className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Сохранить частичное
            </button>
            <button
              type="button"
              onClick={resetIdle}
              className="px-4 py-2 text-sm rounded-md bg-gray-200 text-gray-900 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Сбросить
            </button>
          </div>
        </div>
      )}

      {state.kind === 'transcript-done' && (
        <TranscriptResult
          mdPath={state.mdPath}
          text={state.text}
          segments={state.segments}
          timecodesDefault={timecodesEnabled}
          onOpenFile={(): void => {
            void handleOpenTranscript()
          }}
          onRevealInFolder={(): void => {
            void handleRevealTranscript()
          }}
          onSaveAs={(md): void => {
            void handleSaveAs(md)
          }}
          onReset={resetIdle}
        />
      )}

      {state.kind === 'transcript-error' && (
        <InlineError reason={state.reason} onRetry={resetIdle} />
      )}

      {state.kind === 'error' && (
        <InlineError reason={state.reason} onRetry={resetIdle} />
      )}
    </div>
  )
}
