// Stateless drop-zone компонент.
// Источник: 02-UI-SPEC.md §Component Inventory / §Layout & Sizing / §Accessibility;
//          02-PATTERNS.md §DropZone.tsx; 02-RESEARCH.md §Pattern 2 (drag&drop + file.path).
// CONTEXT: D-03 (drop-zone на вкладке Transcribe), D-06 (.mp4 валидация в renderer),
//          D-07 (multi-drop отклоняется).
// Threat:  T-02-03-01/04 — `e.preventDefault()` на drag-handlers, никакого чтения
//          содержимого файла (только `.path` строкой).
//
// Контракт: stateless. Состояние (idle/dragOver/disabled) приходит из родителя.
// `onPickClick` — keyboard-fallback кнопка; родитель вызывает IPC pickFile.

import type { DragEvent } from 'react'
import type { MediaReason } from '../../../shared/ipc'

interface Props {
  onPick: (path: string) => void
  onError: (reason: MediaReason) => void
  onPickClick: () => void
  disabled?: boolean
  dragOver?: boolean
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void
}

export default function DropZone({
  onPick,
  onError,
  onPickClick,
  disabled = false,
  dragOver = false,
  onDragOver,
  onDragLeave
}: Props): React.JSX.Element {
  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (disabled) return
    const files = e.dataTransfer?.files
    if (!files || files.length !== 1) {
      onError('invalid_argument')
      return
    }
    const f = files[0]
    if (!f.name.toLowerCase().endsWith('.mp4')) {
      onError('not_mp4')
      return
    }
    // Electron-расширение File: `.path` (D-14 sandbox:true сохраняет атрибут).
    const filePath = (f as File & { path?: string }).path
    if (!filePath || filePath.length === 0) {
      onError('internal')
      return
    }
    onPick(filePath)
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (onDragOver) onDragOver(e)
  }

  const base =
    'min-h-[240px] w-full rounded-lg border-2 border-dashed p-12 flex flex-col items-center justify-center gap-4 transition-colors'
  const stateClass = dragOver
    ? 'border-blue-500 bg-blue-50'
    : 'border-gray-300 bg-white'
  const disabledClass = disabled ? 'opacity-60 pointer-events-none' : ''

  return (
    <div
      role="region"
      aria-label="Зона перетаскивания mp4-файла"
      className={`${base} ${stateClass} ${disabledClass}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={onDragLeave}
    >
      <p className="text-base text-gray-700">Перетащите mp4-файл сюда</p>
      <p className="text-sm text-gray-500">или</p>
      <button
        type="button"
        onClick={onPickClick}
        disabled={disabled}
        className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Выбрать mp4-файл
      </button>
      <p className="text-xs text-gray-500">Один файл за раз. Только .mp4</p>
    </div>
  )
}
