---
phase: 03-local-transcription-core-value
plan: 04
subsystem: transcription-ux
tags: [whisper.cpp, live-streaming, progress, cancel-partial, timecodes, save-as, language-selector, integration-test, packaged-smoke, TRANS-03, TRANS-04, TRANS-05, TRANS-07]
requires:
  - "03-02: pipeline (transcriber singleton + audioPath, transcribe.onSegment/onProgress, buildTranscriptMd, Transcribe FSM, TranscriptResult)"
  - "03-03: settings-store (selectedModel/selectedLanguage/timecodesEnabled), settings.getPreferences/setPreference, model_missing-блок"
  - "03-01: IPC-контракт transcribe.* (включая TRANSCRIBE_SAVE_AS канал), whisper-paths, buildTranscribeArgs, transcribe-real.test RED-стаб"
provides:
  - "TranscribeProgress: role=progressbar + aria-valuenow + clamp + Cancel + область живого стриминга сегментов (TRANS-04, D-11)"
  - "TimecodeToggle + lib/transcript-display.buildDisplayText: пересборка тела транскрипта из сегментов БЕЗ re-run whisper (D-02)"
  - "TranscriptResult «Сохранить как»: transcribe.saveAs(md) без имени из renderer + интеграция тумблера таймкодов"
  - "Transcribe.tsx: live-накопление сегментов, cancel-partial state (предложение сохранить частичное), селектор языка ru/auto/частые с персистом"
  - "transcriber.getCurrentAudioPath(): источник истины для main-tier defaultName в saveAs (D-05)"
  - "ipc/transcribe TRANSCRIBE_SAVE_AS: defaultName = basename(audioPath)+'.transcript.md' формирует MAIN; путь — только из showSaveDialog (T-3-06)"
  - "tests/integration/transcribe-real.test.ts: GREEN — assert ≥1 непустой сегмент (gated/skip без бинарника, не fail)"
  - "scripts/smoke-packaged.mjs: ветка whisper-cli + DLL в app.asar.unpacked (Pitfall #1) с явным SKIP/PASS/FAIL"
affects:
  - "Phase 4 (LLM-анализ): полный transcript.md как вход; UX длительного процесса как эталон для analyze"
  - "Phase 5 (дистрибуция): packaged smoke whisper-cli/DLL — основа cross-platform валидации"
tech-stack:
  added: []
  patterns:
    - "Функциональный setState (setSegments(prev => [...prev, seg])) для onSegment/onProgress — две подписки в одном useEffect через stateRef (Pitfall closure-state)"
    - "Renderer-side пересборка отображаемого текста из сегментов (D-02) — чистая buildDisplayText без IPC/electron, зеркало body-логики transcript-builder без frontmatter/H1"
    - "Main-tier defaultName: имя файла формирует main из transcriber.audioPath (basename), untrusted renderer не передаёт имя (T-3-06, warning-5)"
    - "saveAs путь записи ТОЛЬКО из dialog.showSaveDialog; cancel диалога → Result<{ok:true, data:null}>"
    - "Cancel-partial: reason cancelled → state transcript-cancelled-partial (предложение сохранить накопленное), НЕ сброс в idle (D-13)"
    - "Integration/smoke gating: skipIf(!CAN_RUN_REAL) и явный SKIP+exit0 — без ложного зелёного при отсутствии бинарника/модели"
key-files:
  created:
    - src/renderer/src/components/TranscribeProgress.tsx
    - src/renderer/src/components/TimecodeToggle.tsx
    - src/renderer/src/lib/transcript-display.ts
  modified:
    - src/renderer/src/routes/Transcribe.tsx
    - src/renderer/src/routes/Transcribe.test.tsx
    - src/renderer/src/components/TranscriptResult.tsx
    - src/main/ipc/transcribe.ts
    - src/main/services/transcriber.ts
    - tests/integration/transcribe-real.test.ts
    - scripts/smoke-packaged.mjs
decisions:
  - "03-04: defaultName для saveAs формируется в MAIN из transcriber.getCurrentAudioPath() (basename + '.transcript.md'); сигнатура TranscribeApi.saveAs(md, defaultName?) принимает имя опционально, но main его ИГНОРИРУЕТ (T-3-06, warning-5)"
  - "03-04: тумблер таймкодов реализован renderer-side через buildDisplayText (D-02) — переключение пересобирает текст из накопленных сегментов БЕЗ повторного transcribe.start, как и было заложено в 03-03 (timecodesEnabled вне IPC-контракта)"
  - "03-04: cancel переводит UI в transcript-cancelled-partial (предложение сохранить частичное), а не в idle — частичный текст не теряется (D-13)"
  - "03-04: VAD-тюнинг флаги (--vad-threshold и т.п.) НЕ добавлялись — UAT подтвердил качество русского без галлюцинаций на дефолтах, сигнала на тюнинг не было (опциональный action (7) не потребовался)"
metrics:
  duration: ~50min
  completed: 2026-06-17
requirements-completed: [TRANS-03, TRANS-04, TRANS-05, TRANS-07]
---

# Phase 03 Plan 04: UX-полировка транскрипции (live-стриминг, cancel-partial, таймкоды, экспорт, язык) Summary

Финальный слайс фазы превращает минимальный happy-path 03-02 в полноценный UX длительного процесса: пользователь видит %-бар И живой поток распознанных сегментов, может отменить транскрипцию не потеряв уже распознанное, мгновенно переключает таймкоды без повторного прогона whisper, экспортирует результат «Сохранить как» и выбирает язык (ru+VAD по умолчанию). Реальный whisper-cli валидирован интеграционно и через packaged smoke (Pitfall #1). Все 5 success criteria фазы подтверждены ручным packaged UAT на Windows.

## Что сделано

### Task 1 — UX-слой (`b5e74e0`)

- **`TranscribeProgress.tsx` (новый).** Stateless: `role="progressbar"` + `aria-valuenow` + clamp 0–100; кнопка `Отмена`; ниже бара — область живого стриминга, рендерящая накопленные сегменты по мере прихода (props: percent, segments, onCancel). Эталон — `ExtractProgress.tsx`. Русские строки.
- **`TimecodeToggle.tsx` (новый) + `lib/transcript-display.ts` (новый).** Тумблер «Таймкоды» (default OFF, D-02). `buildDisplayText(segments, timecodes)` — чистая функция (без electron/IPC): `false` → сплошной текст, `true` → построчно `[ЧЧ:ММ:СС] text`. Renderer-зеркало body-логики `transcript-builder.ts` без frontmatter/H1. Переключение пересобирает текст из тех же сегментов — БЕЗ re-run whisper.
- **`TranscriptResult.tsx` (расширен).** Кнопка «Сохранить как» → `transcribe.saveAs(md)` БЕЗ передачи имени из renderer. Интегрирован `TimecodeToggle` (переключает отображаемый текст). Сохранены кнопки «Открыть»/«Показать в папке».
- **`Transcribe.tsx` (расширен).** Вторая подписка `transcribe.onSegment` в том же `useEffect`; функциональный `setState` (`prev => [...prev, seg]`) для onSegment/onProgress — без устаревшего замыкания. State `transcribing` накапливает `segments[]`; `reason cancelled` → состояние `transcript-cancelled-partial` с предложением сохранить накопленное (НЕ idle, D-13). Селектор языка (ru / auto / частые) над кнопкой «Транскрибировать»; `language` персистится через settings-store (03-03) и передаётся в `transcribe.start({language})`. `handleCancel` → `transcribe.cancel(jobId)`.
- **`transcriber.ts` (расширен).** Приватное `lastAudioPath` пишется в `start()`; публичный `getCurrentAudioPath()` — источник истины для main-tier defaultName (D-05, T-3-06).
- **`ipc/transcribe.ts` — `TRANSCRIBE_SAVE_AS` handler.** Принимает ТОЛЬКО md-контент (`typeof md === 'string'`, иначе `invalid_argument`). `defaultName = basename(transcriber.getCurrentAudioPath() ?? 'transcript') + '.transcript.md'` формируется в MAIN — имя из renderer (`args[1]`) игнорируется (T-3-06, warning-5). `dialog.showSaveDialog({defaultPath, filters:[{name:'Markdown', extensions:['md']}]})`; отмена → `{ok:true, data:null}`; успех → `fs.writeFile(res.filePath, md)` → `{ok:true, data:{path}}`. Путь записи — только из dialog-результата. `LOG_PREFIX '[ipc/transcribe]'`, без throw через IPC.

### Task 2 — реальная валидация whisper (`2ebbc4f`)

- **`tests/integration/transcribe-real.test.ts` (GREEN, gated).** Реальный whisper-cli на короткой ru WAV-фикстуре → парс `-oj` JSON → assert `transcription.length ≥ 1` И ≥1 сегмент с непустым `text.trim()` (TRANS-01). Gating `skipIf(!CAN_RUN_REAL)` сохранён — без бинарника/модели тест skip, НЕ fail (зеркало `extract-real`).
- **`scripts/smoke-packaged.mjs` (расширен под whisper).** Самодостаточный mjs с явным gating: нет `dist/*-unpacked` → `console.log('[smoke] SKIP ...')` + `exit 0` (явный SKIP, не «passed»). Build есть → проверяет ffmpeg/ffprobe + `whisper-cli(.exe)` + DLL (`whisper.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`) рядом в `app.asar.unpacked` (Pitfall #1); при наличии модели/фикстуры — реальный end-to-end whisper-прогон → JSON; отсутствие DLL или ненулевой код → `console.error` + `exit 1`. Логи PASS/FAIL/SKIP различимы.

## Требования

| Req | Статус | Примечание |
|-----|--------|------------|
| TRANS-03 | GREEN | Селектор языка; ru+VAD по умолчанию; качество русского подтверждено manual UAT (без галлюцинаций) |
| TRANS-04 | GREEN | %-бар (role=progressbar) + живой стриминг сегментов в окно по мере распознавания (D-11) |
| TRANS-05 | GREEN | Cancel во время transcribing → предложение «Сохранить частичное» из накопленных сегментов (D-13) |
| TRANS-07 | GREEN | «Сохранить как» → showSaveDialog; defaultName `<имя_mp4>.transcript.md` формирует main (D-05) |

TRANS-01 валидирован интеграционно/smoke (gated); TRANS-02/06 закрыты в 03-03/03-02.

## TDD Gate Compliance

- **Task 1 (tdd):** `Transcribe.test.tsx` расширен (21 теста total): mock onSegment-события аппендят сегменты в стриминг-область во время transcribing; onProgress двигает бар; Cancel → `transcribe.cancel`; cancelled → предложение «Сохранить частичное», клик → `transcribe.saveAs` с накопленным md; тумблер таймкодов переключает текст без повторного `transcribe.start`; «Сохранить как» вызывает `saveAs` с md без имени из renderer; селектор языка передаёт `language` в `start`. GREEN-коммит `b5e74e0`.
- **Task 2:** `transcribe-real.test.ts` усилен с RED-стаба (03-01) до полноценного assert ≥1 непустого сегмента. GREEN-коммит `2ebbc4f`.
- Полный gate-цикл фазы: RED-стабы (`1db2f53`, 03-01) → GREEN (`4740ec6`/`338e83b`/`10ad47a` 03-02, `3ddf173`/`5469a14` 03-03, `b5e74e0`/`2ebbc4f` 03-04). RED→GREEN последовательность соблюдена.

## Deviations from Plan

### Auto-fixed Issues

Нет. Plan исполнен как написано.

### Опциональный action не потребовался

**VAD-тюнинг флаги (`--vad-threshold` и т.п.), action (7) Task 1 — НЕ применялись.** Action был обусловлен «на случай gap'а качества из 03-02-чекпоинта». Manual packaged UAT (checkpoint approved) подтвердил осмысленное качество русского без галлюцинаций на дефолтах — сигнала на тюнинг не поступило. Дефолты не менялись (как и предписано: «дефолты не менять без UAT-сигнала»).

## Threat Surface

Все mitigate-диспозиции из `<threat_model>` реализованы:

| Threat ID | Категория | Mitigation | Где |
|-----------|-----------|-----------|-----|
| T-3-06 | Tampering/Path-traversal | saveAs: путь записи ТОЛЬКО из `dialog.showSaveDialog`; defaultName формирует main из `transcriber.getCurrentAudioPath()` (basename), НЕ из renderer-строки; md — текст, не исполняемый | `src/main/ipc/transcribe.ts`, `src/main/services/transcriber.ts` |
| T-3-10 | Tampering | packaged smoke проверяет whisper-cli + DLL рядом в app.asar.unpacked (Pitfall #1) | `scripts/smoke-packaged.mjs` |
| T-3-SC | Tampering/Supply-chain | npm-пакетов не добавлено (accept) | — |

Новой security-relevant поверхности вне threat_model не введено.

## Known Stubs

Нет. RED-стаб `transcribe-real.test.ts` (03-01) переведён в GREEN. Тест gated/skip при отсутствии ggml-модели в окружении (модели не бандлятся, CLAUDE.md) — это сознательный gating, не стаб: реальное качество подтверждено manual packaged UAT.

## Verification

- `npm run typecheck` — зелёный (node + web).
- `npx vitest run src/renderer/src/routes/Transcribe.test.tsx` — 21 passed (TRANS-04/05/07/03 RTL).
- `npm run test:unit` — 178 passed / 1 skipped (gated integration) / 1 flaky-fail вне scope (см. ниже).
- `node scripts/smoke-packaged.mjs` — `exit 0`, **PASS**: ffmpeg/ffprobe + whisper-cli + DLL найдены в `dist/win-unpacked/.../app.asar.unpacked` (Pitfall #1 закрыт).
- grep подтверждает: `getCurrentAudioPath()` в transcriber.ts; `defaultName`/`basename` из audioPath в transcribe.ts; `buildDisplayText` в transcript-display.ts; `role="progressbar"` в TranscribeProgress.tsx; `transcribe.onSegment` + функциональный setState в Transcribe.tsx; `skipIf` gating и `[smoke] SKIP/PASS/FAIL` ветки.
- **Manual packaged UAT на Windows (checkpoint approved):** `npm run build` + packaged smoke PASS; in-app скачивание medium; live-стриминг сегментов + %-бар; cancel с сохранением частичного; тумблер таймкодов без re-run; «Сохранить как»; качество русского осмысленное без галлюцинаций. Все 5 success criteria фазы выполнены.

### Out-of-scope flaky test (НЕ блокер, НЕ от этого плана)

`src/main/services/secrets-store.test.ts` иногда падает (ENOENT на tmp `userData/secrets.bin`) в полном параллельном прогоне vitest, НО проходит изолированно (11/11 — проверено: `npx vitest run src/main/services/secrets-store.test.ts`). Предсуществующая проблема изоляции тестов (конкуренция за общий tmp-dir), файл Phase 1, плана 03-04 не касается. Уже зафиксировано в `deferred-items.md` (из 03-02). Per SCOPE BOUNDARY — не чинится здесь.

## Self-Check: PASSED

- Файлы созданы: `src/renderer/src/components/TranscribeProgress.tsx`, `src/renderer/src/components/TimecodeToggle.tsx`, `src/renderer/src/lib/transcript-display.ts` — FOUND.
- Файлы изменены: `Transcribe.tsx`, `Transcribe.test.tsx`, `TranscriptResult.tsx`, `ipc/transcribe.ts`, `transcriber.ts`, `transcribe-real.test.ts`, `smoke-packaged.mjs` — FOUND.
- Коммиты: `b5e74e0` (Task 1), `2ebbc4f` (Task 2) — присутствуют в git-истории.
