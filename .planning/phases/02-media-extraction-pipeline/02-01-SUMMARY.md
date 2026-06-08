---
phase: 02-media-extraction-pipeline
plan: 01
status: complete
completed: 2026-05-31
requirements: [MEDIA-01, MEDIA-02, MEDIA-03, MEDIA-04]
---

# Plan 02-01 SUMMARY — IPC-контракт `media.*` + build-инфраструктура

## Result

Контракт `window.scrubber.media.{pickFile,probe,extractAudio,cancel,onProgress}` зафиксирован сквозь все три слоя (shared/ipc.ts → main/ipc → preload bridge). Build-pipeline собирает отдельный CJS-entrypoint `out/main/ffmpeg-runner.cjs` для `utilityProcess.fork()`. `electron-builder` распаковывает `ffmpeg-static` и `@ffprobe-installer` из asar. Plan 02 (бэкенд) и Plan 03 (UI) могут начинать реализацию без правки контрактов и build-конфига.

## Tasks Completed

| Task | Files | Commit |
|------|-------|--------|
| 1. Расширить `shared/ipc.ts` контрактом media + slot в реестре | `src/shared/ipc.ts`, `src/main/ipc/index.ts`, `src/main/ipc/media.ts` | 53d6ad0 |
| 2. Preload bridge для media + расширить preload-тест и тестовый mock | `src/preload/index.ts`, `src/preload/index.test.ts`, `tests/setup.ts` | bdd96a1 |
| 3. CJS utility entry + asarUnpack для нативных бинарников | `electron.vite.config.ts`, `electron-builder.yml`, `package.json`, `src/main/utilities/ffmpeg-runner.ts` | b0d7a3a |

## Decisions Honored

- **D-04** — `dialog.showOpenDialog` + MP4 filter: контракт `media.pickFile` зафиксирован (stub в `media.ts`).
- **D-14** — Namespace `media.*` в `shared/ipc.ts` с 5 методами: реализован, `ScrubberApi` расширен `media: MediaApi`.
- **D-15** — `Channels.MEDIA_*` константы (`media:pickFile`, `media:probe`, `media:extractAudio`, `media:cancel`, `media:progress`): объявлены, единственный источник имён каналов.
- **D-16** — `Result<T>` + `MediaReason` union (7 reason-кодов): `invalid_argument | not_mp4 | file_not_found | ffmpeg_failed | cancelled | disk_full | internal`.
- **D-17** — `utilityProcess.fork()` pattern требует CJS-entry: `src/main/utilities/ffmpeg-runner.ts` (skeleton) + npm script `build:utilities` собирает его esbuild'ом в `out/main/ffmpeg-runner.cjs`.
- **D-18** — `asarUnpack` в `electron-builder.yml` включает `node_modules/ffmpeg-static/**` и `node_modules/@ffprobe-installer/**` (Pitfall #1 — нативные бинарники не исполняются из asar).

## Key Implementation Choice — Rollup Output для ffmpeg-runner

Plan давал две альтернативы: (а) массив outputs в `main.build.rollupOptions`, либо (б) отдельный esbuild post-build шаг.

**Принято: (б).** Подход (а) при первом `npm run build` упал с ошибкой `electron-vite`:

```
Error: The electron vite main config does not support multiple outputs.
```

`electron-vite` явно валидирует main config и блокирует rollup `output:[…]` массив. Подход (б) реализован тривиально: `package.json` script

```json
"build:utilities": "esbuild src/main/utilities/ffmpeg-runner.ts --bundle --platform=node --target=node20 --format=cjs --outfile=out/main/ffmpeg-runner.cjs --external:electron",
"build": "electron-vite build && npm run build:utilities"
```

esbuild уже в зависимостях (peer от vite). Артефакты лежат рядом: `out/main/index.js` (ESM main entry) и `out/main/ffmpeg-runner.cjs` (CJS utility entry). electron-builder упакует оба автоматически — оба файла в `out/main/`, который попадает в asar по умолчанию.

## Self-Check

- [x] `npm run typecheck` — passed.
- [x] `npm run test` — 7 файлов / 47 тестов passed (включая 9 it'ов в `src/preload/index.test.ts`, из них 5 новых для media-bridge).
- [x] `npm run build` — passed; артефакты: `out/main/index.js`, `out/main/ffmpeg-runner.cjs`, `out/preload/index.cjs`, `out/renderer/*`.
- [x] AC Task 3: `out/main/ffmpeg-runner.cjs` существует, начинается с `var _cp = require("node:child_process");` — нет top-level ESM `import`.
- [x] AC: `electron-builder.yml asarUnpack` содержит `ffmpeg-static` и `@ffprobe-installer`.
- [x] AC: `grep -c "registerMediaHandlers" src/main/ipc/index.ts >= 2` (import + вызов).
- [x] AC: нет строковых литералов `'media:'` в `src/main/ipc/media.ts` (все через `Channels.MEDIA_*`).

## key-files

```yaml
created:
  - src/main/ipc/media.ts
  - src/main/utilities/ffmpeg-runner.ts
  - .planning/phases/02-media-extraction-pipeline/02-01-SUMMARY.md
modified:
  - src/shared/ipc.ts
  - src/main/ipc/index.ts
  - src/preload/index.ts
  - src/preload/index.test.ts
  - tests/setup.ts
  - electron.vite.config.ts
  - electron-builder.yml
  - package.json
```

## Self-Check: PASSED

## Hand-Off to Plan 02

- `src/main/ipc/media.ts` содержит четыре stub-handler'а (`Channels.MEDIA_PICK_FILE/PROBE/EXTRACT/CANCEL`) — Plan 02 заменит каждый на реальную имплементацию, используя те же типы из `shared/ipc.ts`.
- `src/main/utilities/ffmpeg-runner.ts` — skeleton с `process.parentPort?.on('message')`. Plan 02 расширит его до полноценного runner (spawn ffmpeg, парсинг прогресса `out_time_us=`, postMessage с `MediaProgressEvent`).
- `MEDIA_PROGRESS` НЕ зарегистрирован в `ipcMain.handle` — это event-канал, Plan 02 будет вызывать `webContents.send(Channels.MEDIA_PROGRESS, payload)` из main.
- Build-pipeline уже знает про `ffmpeg-runner.cjs`; Plan 02 НЕ трогает `electron.vite.config.ts` / `package.json scripts` — только содержимое `ffmpeg-runner.ts` и main-сервисы.
