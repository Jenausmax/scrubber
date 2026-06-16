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
import TranscriptResult from '../components/TranscriptResult'
import InlineError from '../components/InlineError'

// Дефолты на случай, если getPreferences ещё не загрузился (D-08/D-02).
const DEFAULT_MODEL = 'medium'
const DEFAULT_LANGUAGE = 'ru'

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
  | { kind: 'transcript-done'; mdPath: string; text: string }
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
      const s = stateRef.current
      if (s.kind !== 'transcribing') return
      if (s.jobId === null || s.jobId === e.jobId) {
        setState({
          kind: 'transcribing',
          jobId: e.jobId,
          audioPath: s.audioPath,
          percent: e.percent,
          segments: s.segments
        })
      }
    })
    const unsubSegment = window.scrubber.transcribe.onSegment((e) => {
      const s = stateRef.current
      if (s.kind !== 'transcribing') return
      if (s.jobId === null || s.jobId === e.jobId) {
        setState({
          ...s,
          jobId: e.jobId,
          segments: [...s.segments, { startMs: e.startMs, text: e.text }]
        })
      }
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
      setState({ kind: 'transcript-done', mdPath: r.data.mdPath, text: r.data.text })
      return
    }
    const reason = (!r.ok ? (r.reason as TranscribeReason) : 'internal') ?? 'internal'
    if (reason === 'cancelled') {
      setCancelledMsg(true)
      setState({ kind: 'idle' })
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
        <div
          role="status"
          className="p-6 rounded-md border border-blue-200 bg-blue-50 text-blue-900"
        >
          <h2 className="text-lg font-medium mb-2">Распознаём речь…</h2>
          <div className="w-full bg-blue-100 rounded h-2 mb-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 transition-all"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          <p className="text-sm">{state.percent}%</p>
        </div>
      )}

      {state.kind === 'transcript-done' && (
        <TranscriptResult
          mdPath={state.mdPath}
          text={state.text}
          onOpenFile={(): void => {
            void handleOpenTranscript()
          }}
          onRevealInFolder={(): void => {
            void handleRevealTranscript()
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
