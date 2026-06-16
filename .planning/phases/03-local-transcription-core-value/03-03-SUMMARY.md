---
phase: 03-local-transcription-core-value
plan: 03
subsystem: model-management
tags: [whisper.cpp, model-download, sha256, anti-ssrf, settings-ui, ipc, TRANS-02]
requires:
  - "03-01: IPC-контракт models.* / ModelsApi / ModelProgressEvent / ModelReason; whisper-paths.resolveModel/resolveVadModel; MODEL_MANIFEST RED-стаб; model-manager.test.ts RED"
  - "03-02: ядро pipeline (transcriber model_missing reason, InlineError.TRANSCRIBE_REASON_COPY[model_missing]), Transcribe FSM"
provides:
  - "modelManager (singleton): list/download(SHA256+.tmp→rename)/cancel(AbortController)/delete — модели в userData, не бандлятся"
  - "MODEL_MANIFEST (pinned URL+SHA256+size для small/medium/large-v3/silero, D-10)"
  - "ipc/models: registerModelsHandlers с MODEL_WHITELIST (анти-SSRF, T-3-07) + UUID-валидация cancel"
  - "settings-store: selectedModel/selectedLanguage/timecodesEnabled (D-08/D-02) + SETTINGS_DEFAULTS"
  - "settings.getPreferences/setPreference (несекретные UI-настройки через electron-store)"
  - "Settings «Модели»: список+размеры+статус+Скачать(прогресс/отмена)/Удалить + селекты модель/язык + чекбокс таймкоды"
  - "Transcribe model_missing-блок: кнопка disabled + отсылка в Настройки → Модели (D-09)"
affects:
  - "03-04: live-прогресс UX, cancel UX, тумблер таймкодов в окне (renderer-side пересборка из timecodesEnabled)"
tech-stack:
  added: []
  patterns:
    - "fetch(WHATWG ReadableStream) → createWriteStream(.tmp) → createHash('sha256') → fs.rename (.tmp→final атомарно)"
    - "AbortController в job-map для cancel скачивания (зеркало media-extractor job-map+kill)"
    - "Анти-SSRF: URL строится ТОЛЬКО из pinned MODEL_MANIFEST, model-name из renderer проверяется по MODEL_WHITELIST в main"
    - "Несекретные UI-настройки через settings.getPreferences/setPreference (whitelist ключей в main, electron-store, НЕ safeStorage)"
key-files:
  created:
    - src/main/ipc/models.ts
    - src/renderer/src/routes/Settings.test.tsx
  modified:
    - src/main/services/model-manager.ts
    - src/main/services/model-manager.test.ts
    - src/main/ipc/index.ts
    - src/main/ipc/settings.ts
    - src/main/services/settings-store.ts
    - src/preload/index.ts
    - src/preload/index.test.ts
    - src/shared/ipc.ts
    - src/renderer/src/routes/Settings.tsx
    - src/renderer/src/routes/Transcribe.tsx
    - src/renderer/src/routes/Transcribe.test.tsx
decisions:
  - "03-03: timecodesEnabled персистится в settings-store (D-02 default ВЫКЛ), но НЕ добавлен в IPC-контракт transcribe.start — конфликт между acceptance-критерием и frontmatter key_link разрешён в пользу key_link (контракт авторитетен; тумблер применяется renderer-side в 03-04 пересборкой из сегментов без re-run whisper)"
  - "03-03: добавлены каналы SETTINGS_GET_PREFERENCES/SET_PREFERENCE + SettingsApi.getPreferences/setPreference — план допускал «переиспользовать имеющиеся либо завести settings IPC»; готовых generic get/set не было, заведены с whitelist ключей"
metrics:
  duration: ~1.5h
  completed: 2026-06-16
requirements-completed: [TRANS-02]
---

# Phase 03 Plan 03: Управление whisper-моделями (download/SHA256/UI) Summary

Вертикальный слайс управления моделями: пользователь скачивает/удаляет модели Whisper прямо в Settings (прогресс + отмена + SHA256-проверка целостности), а вкладка Transcribe блокирует транскрипцию при отсутствии выбранной модели и отсылает в Настройки. Снимает ручную подкладку модели из 03-02 — закрывает TRANS-02 и требование «модели не бандлятся».

## Что сделано

### Task 1 — backend моделей (`3ddf173`)

- **`model-manager.ts` (RED→GREEN).** Singleton `modelManager`:
  - `list()` → `{name, sizeBytes, downloaded}` для small/medium/large-v3 (`downloaded = existsSync(resolveModel)`).
  - `download(name)`: `fetch(manifest URL, {signal})` → стрим WHATWG `ReadableStream` в `userData/models/ggml-<name>.bin.tmp`, прогресс по `Content-Length` → `webContents.send(MODELS_PROGRESS, {name, percent})`; по завершении `createHash('sha256')` сверяется с манифестом → `fs.rename(.tmp→final)`; mismatch → `unlink + reason 'sha_mismatch'` (D-10, T-3-08).
  - `cancel(jobId)`: `AbortController.abort()` + `unlink .tmp` → `cancelled`; resume не делается.
  - `delete(name)`: `unlink ggml-<name>.bin`; ENOENT → ok (идемпотентно).
  - reason-маппинг: AbortError→`cancelled`, ENOSPC→`disk_full`, прочее→`download_failed`.
  - **silero VAD:** `ensureSilero()` вызывается ПЕРЕД основной моделью при первом download; если silero уже на диске — noop; падение silero логируется и **НЕ блокирует** основную модель (VAD опционален — transcriber передаёт `vadModelPath=null`).
- **`MODEL_MANIFEST`** заполнен pinned значениями (URL HuggingFace + SHA256 + точные байты) для small/medium/large-v3/silero — сверены в 03-01 Task 3 с live LFS-метаданными.
- **`ipc/models.ts`:** `registerModelsHandlers()` с handle-обёртками. `MODEL_WHITELIST = {small,medium,large-v3}` — анти-SSRF (T-3-07): URL строится только из манифеста, никогда из renderer-строки. DOWNLOAD/DELETE валидируют name по whitelist, CANCEL — по UUID_REGEX. MODELS_PROGRESS — event-канал (не handle).
- **`ipc/index.ts`:** `registerModelsHandlers()` добавлен в `registerIpcHandlers`.

### Task 2 — Settings UI + настройки + model_missing-блок (`5469a14`)

- **`settings-store.ts`:** `SettingsSchema += selectedModel/selectedLanguage/timecodesEnabled`; экспортирован `SETTINGS_DEFAULTS` (medium/ru/false — D-08, D-02).
- **`shared/ipc.ts`:** `UserPreferences`/`PreferenceKey`; каналы `SETTINGS_GET_PREFERENCES/SET_PREFERENCE`; `SettingsApi.getPreferences/setPreference`.
- **`ipc/settings.ts`:** два новых handler'а с whitelist разрешённых ключей (V5 ASVS) и типовой валидацией значений.
- **`preload/index.ts`:** `settings.getPreferences/setPreference`.
- **`Settings.tsx`:** раздел «Модели» — список 3 моделей с размерами (`formatBytes`) и статусом «скачана/нет», кнопки `Скачать`(прогресс-бар + `Отмена`)/`Удалить`, подписка на `MODELS_PROGRESS`; селекты выбранной модели и языка + чекбокс таймкодов — всё персистится через `setPreference`. Загрузочное состояние API-ключа вынесено inline (Models-раздел рендерится всегда).
- **`Transcribe.tsx`:** при mount читает `getPreferences` + `models.list` → `modelAvailable`; если выбранная модель не скачана — кнопка «Транскрибировать» `disabled` + сообщение «Модель … не скачана — перейдите в Настройки → Модели» (D-09). `start` вызывается с `model/language` из настроек; `reason model_missing` синхронизирует `modelAvailable=false`.

## Требования

| Req | Статус | Примечание |
|-----|--------|------------|
| TRANS-02 | GREEN | Скачивание/удаление/список моделей в Settings с прогрессом, отменой, SHA256-проверкой; модели в userData (не бандлятся); model_missing-блок на Transcribe |

## TDD Gate Compliance

- **model-manager.test.ts:** RED-стаб из 03-01 (только проверка существования функций) → GREEN с 10 тестами: happy-path (fetch→.tmp→sha→rename), sha_mismatch (unlink + reason), invalid_argument (анти-SSRF — `../etc/passwd` и `silero`), network→download_failed, cancel неизвестного jobId, delete идемпотентно, list downloaded-статус. Мок global `fetch` + mock `whisper-paths` (resolveModel→tmpdir). Реальной сети нет.
- **Settings.test.tsx:** новый, 6 RTL-тестов — список с размерами/статусом, Скачать→download+прогресс, MODELS_PROGRESS-обновление, Удалить→delete, персист selectedModel/timecodesEnabled через setPreference.
- **Transcribe.test.tsx:** добавлен тест model_missing-блока (кнопка disabled + отсылка в Настройки, start не вызывается); обновлён мок `window.scrubber` (settings/models namespaces).
- **preload/index.test.ts:** обновлён (settings = 6 функций — добавлены getPreferences/setPreference).

GREEN-коммиты: `3ddf173` (Task 1), `5469a14` (Task 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Конфликт acceptance-критерия и frontmatter key_link по timecodes**

- **Found during:** Task 2.
- **Issue:** Behavior/acceptance Task 2 требовал «`transcribe.start` вызывается с полем `timecodes` из settings-store», но frontmatter `key_link` (`timecodesEnabled`) ЯВНО запрещал: «НЕ добавлять поле `timecodes` в `TranscribeApi.start` / `shared/ipc.ts`». Существующий `Transcribe.test.tsx` к тому же ассертит `start` ровно с `{model, language}`.
- **Resolution:** frontmatter key_link авторитетен и конкретнее. `timecodesEnabled` персистится в settings-store (D-02 default ВЫКЛ) и читается renderer-side; IPC-контракт `start` НЕ менялся. Тумблер применяется в 03-04 пересборкой из сохранённых сегментов без re-run whisper (как и задумано D-02). Auto-save (D-01) продолжает писать сплошной текст.
- **Files:** `src/renderer/src/routes/Transcribe.tsx` (комментарий-обоснование у `start`).

**2. [Rule 2 - Critical] Заведены каналы settings.getPreferences/setPreference**

- **Found during:** Task 2.
- **Issue:** План допускал «settings IPC для чтения/записи ключей либо переиспользовать имеющиеся», но готового generic get/set в `SettingsApi` не было (только saveApiKey/hasApiKey/clearApiKey/getSecureBackend).
- **Fix:** добавлены `SETTINGS_GET_PREFERENCES/SET_PREFERENCE` + `UserPreferences` + методы в `SettingsApi`, handler'ы с whitelist ключей в main (renderer не может записать произвольный ключ). Обновлён preload-тест (settings = 6 функций).
- **Files:** `src/shared/ipc.ts`, `src/main/ipc/settings.ts`, `src/preload/index.ts`, `src/preload/index.test.ts`.

**3. [Rule 1 - Bug] preload/index.test.ts ассертил устаревшее число функций settings**

- **Found during:** прогон полного `test:unit` после Task 2.
- **Issue:** тест жёстко ассертил `settings содержит 4 функции` — после добавления getPreferences/setPreference их 6.
- **Fix:** обновлены имя теста и список ключей.
- **Files:** `src/preload/index.test.ts`.

## Threat Surface

Все mitigate-диспозиции из `<threat_model>` реализованы:

| Threat ID | Mitigation | Где |
|-----------|-----------|-----|
| T-3-07 (SSRF) | `MODEL_WHITELIST` в `ipc/models.ts`; URL только из pinned `MODEL_MANIFEST` | `src/main/ipc/models.ts`, `src/main/services/model-manager.ts` |
| T-3-08 (Tampering/MITM) | `createHash('sha256')` сверка с манифестом ПЕРЕД использованием; mismatch→unlink | `src/main/services/model-manager.ts` |
| T-3-09 (обрыв скачивания) | `.tmp→rename` атомарность; неполный файл не проходит SHA→unlink; resume не делаем (D-10) | `src/main/services/model-manager.ts` |

Новой security-relevant поверхности вне threat_model не добавлено (settings.setPreference ограничен whitelist несекретных ключей, не пишет в safeStorage).

## Known Stubs

Нет. Стабы из 03-01 для model-manager переведены в GREEN. `tests/integration/transcribe-real.test.ts` остаётся gated/skip (вне scope — реальный whisper-прогон без модели в окружении).

## Verification

- `npx vitest run src/main/services/model-manager.test.ts` — 10 passed (TRANS-02 GREEN).
- `npx vitest run src/renderer/src/routes/Settings.test.tsx src/renderer/src/routes/Transcribe.test.tsx` — 21 passed.
- `npm run typecheck` — зелёный (node + web).
- `npm run test:unit` — 22 файла, 173 passed / 1 skipped (gated integration).
- grep: `createHash('sha256')` (×2) и `fs.rename(tmpPath, targetPath)` в model-manager; `MODEL_WHITELIST` (×4) в models.ts; `registerModelsHandlers()` в ipc/index.ts; `modelAvailable` (×4) в Transcribe.tsx; `models:` namespace в preload; SettingsSchema содержит selectedModel/selectedLanguage/timecodesEnabled.

## Self-Check: PASSED

- Файлы созданы: `src/main/ipc/models.ts`, `src/renderer/src/routes/Settings.test.tsx` — FOUND.
- Файлы изменены: model-manager.ts/.test.ts, ipc/index.ts, ipc/settings.ts, settings-store.ts, preload/index.ts/.test.ts, shared/ipc.ts, Settings.tsx, Transcribe.tsx/.test.tsx — FOUND.
- Коммиты: `3ddf173` (Task 1), `5469a14` (Task 2) — присутствуют в git-истории.
