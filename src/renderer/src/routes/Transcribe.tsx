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
  MediaReason
} from '../../../shared/ipc'
import DropZone from '../components/DropZone'
import FileMetaCard from '../components/FileMetaCard'
import ExtractProgress from '../components/ExtractProgress'
import ExtractDone from '../components/ExtractDone'
import InlineError from '../components/InlineError'

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
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: MediaReason }

export default function Transcribe(): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [cancelledMsg, setCancelledMsg] = useState(false)
  const [copied, setCopied] = useState(false)
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

  function resetIdle(): void {
    setCancelledMsg(false)
    setCopied(false)
    setState({ kind: 'idle' })
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
        <ExtractDone
          audioPath={state.audioPath}
          cacheHit={state.cacheHit}
          onCopyPath={(): void => {
            void handleCopyPath()
          }}
          onReset={resetIdle}
          copied={copied}
        />
      )}

      {state.kind === 'error' && (
        <InlineError reason={state.reason} onRetry={resetIdle} />
      )}
    </div>
  )
}
