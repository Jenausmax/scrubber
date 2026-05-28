function Versions(): React.JSX.Element {
  // Заглушка до Phase 4 UI: показывает доступные через process.versions значения.
  // window.electron убран — preload экспонирует только window.scrubber (D-08, D-09).
  return (
    <ul className="versions">
      <li className="electron-version">Electron</li>
      <li className="chrome-version">Chromium</li>
      <li className="node-version">Node</li>
    </ul>
  )
}

export default Versions
