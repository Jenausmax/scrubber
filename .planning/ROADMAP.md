# Roadmap: scrubber

## Overview

scrubber превращает mp4-видео в анализируемый текст полностью на машине пользователя. Путь начинается с безопасного Electron-каркаса (process boundaries, safeStorage, IPC-контракт), проходит через извлечение аудио (ffmpeg) и локальную офлайн-транскрипцию (whisper.cpp) — это ядро ценности: `mp4 → transcript.md` без сети. Затем добавляется LLM-слой (конфигурируемый OpenAI-совместимый endpoint + библиотека промптов → `analysis.md`). Завершается всё кросс-платформенной упаковкой с подписью и нотаризацией macOS. Дистрибуция — кросс-сквозная: packaged-build smoke-тест валидируется уже с фазы извлечения медиа, а нотаризация macOS финализируется последней как известный длинный хвост.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation & App Shell** - Безопасный Electron-каркас, IPC-контракт, safeStorage, базовый UI на трёх ОС (completed 2026-05-30)
- [x] **Phase 2: Media Extraction Pipeline** - Выбор/drag&drop mp4 и извлечение аудио через ffmpeg в упакованной сборке (completed 2026-06-08, Windows-таргет; Linux/macOS → v1.1)
- [ ] **Phase 3: Local Transcription (Core Value)** - Офлайн mp4 → transcript.md через whisper.cpp с прогрессом и Cancel
- [ ] **Phase 4: LLM Analysis & Prompt Library** - Конфигурируемый LLM, библиотека промптов, анализ транскрипта → analysis.md
- [ ] **Phase 5: Distribution & Cross-Platform** - Устанавливаемые артефакты под Windows/Linux/macOS, подпись и нотаризация

## Phase Details

### Phase 1: Foundation & App Shell

**Goal**: Запускаемый Electron-каркас на Windows/Linux/macOS с безопасными границами процессов, единым IPC-контрактом и хранением секретов через safeStorage — фундамент, который дорого переделывать.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: SHELL-01, SHELL-02, SHELL-03
**Success Criteria** (what must be TRUE):

  1. Пользователь видит окно приложения с базовым UI на каждой из трёх ОС (Windows, Linux, macOS)
  2. API-ключ, введённый пользователем, сохраняется в системном защищённом хранилище (safeStorage), а не в plaintext, и читается при перезапуске
  3. Если защищённое хранилище недоступно (например, Linux без keyring), пользователь видит понятное предупреждение вместо тихого сбоя
  4. Renderer изолирован (contextIsolation/sandbox), все секреты и IPC проходят через allow-list preload-мост

**Plans:** 4/4 plans complete
Plans:

- [x] 01-01-PLAN.md — Scaffold react-ts + Vitest mock infra (Wave 1)
- [x] 01-02-PLAN.md — Shared IPC contract + main services (secure-backend, secrets-store, IPC handlers, bootstrap) (Wave 2)
- [x] 01-03-PLAN.md — Preload bridge + secrets persist integration test (Wave 3)
- [x] 01-04-PLAN.md — Renderer App shell + Settings + BackendWarningBanner + manual cross-OS smoke (Wave 4)

### Phase 2: Media Extraction Pipeline

**Goal**: Пользователь может подать mp4 в приложение и получить извлечённую аудиодорожку через ffmpeg, работающий в utilityProcess — включая упакованную сборку (доказан паттерн asarUnpack для нативных бинарников).
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MEDIA-01, MEDIA-02, MEDIA-03, MEDIA-04
**Success Criteria** (what must be TRUE):

  1. Пользователь может выбрать mp4-файл через системный диалог выбора файла
  2. Пользователь может перетащить mp4-файл в окно приложения (drag&drop)
  3. Приложение извлекает аудиодорожку из выбранного mp4 через ffmpeg без зависания UI
  4. Извлечение аудио работает в **упакованной сборке** на всех трёх ОС (ffmpeg-бинарник доступен из прода через asarUnpack/extraResources)

**Plans:** 6 plans (4 baseline + gap-closure 02-05 + root-cause fix 02-06); все выполнены
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — IPC media контракт + CJS utility entry + asarUnpack build-инфра (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Backend: ffmpeg-paths, progress-parser, media-extractor singleton, utility-runner, IPC handlers (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-03-PLAN.md — Renderer слайс: 5 компонентов + Transcribe FSM + RTL-тесты (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-04-PLAN.md — Integration test (реальный ffmpeg) + packaged smoke Windows + VERIFICATION.md (Wave 4)

**Gap closure** *(human smoke выявил 3 gap'a — см. 02-VERIFICATION.md)*

- [x] 02-05-PLAN.md — Gap-closure: webUtils.getPathForFile (Gap 1) + assertBinaryExists + smoke-packaged.mjs (Gap 2) + uniqueness REASON_COPY (Gap 3)

**Root-cause fix** *(packaged smoke 2026-06-06 — Gap 2 имел более глубокую причину; см. 02-UAT.md)*

- [x] 02-06 (fix-коммиты, без PLAN.md) — `-f wav` muxer fix (commit 7f9e9f0) + Gap 3 assertBinaryExists в startExtract (commit 6fcb885). Verified end-to-end на packaged build; MEDIA-01/02/03 ✅, MEDIA-04 (Linux/macOS) → v1.1.

**UI hint**: yes

### Phase 3: Local Transcription (Core Value)

**Goal**: Ядро ценности продукта — пользователь получает качественный `transcript.md` из mp4 полностью офлайн через whisper.cpp, с выбором модели, прогрессом и возможностью отмены. Достигается главный milestone: рабочий офлайн-pipeline mp4 → transcript.md.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: TRANS-01, TRANS-02, TRANS-03, TRANS-04, TRANS-05, TRANS-06, TRANS-07
**Success Criteria** (what must be TRUE):

  1. Пользователь может транскрибировать извлечённое аудио локально через whisper.cpp полностью офлайн (без сети)
  2. Пользователь может выбрать модель Whisper и скачать её по запросу (модели не бандлятся в установщик)
  3. Транскрипция по умолчанию использует русский язык (`language=ru`) с VAD, давая осмысленный русский текст
  4. Пользователь видит прогресс транскрипции в реальном времени, может её отменить, и UI не зависает во время длительной обработки
  5. Готовый транскрипт сохраняется в `.md`-файл, который пользователь может открыть

**Plans:** 3/4 plans executed
Plans:

**Wave 1**

- [x] 03-01-PLAN.md — Контракт transcribe.*/models.* + Wave 0 Nyquist-стабы + whisper-args/paths + подготовка whisper-cli бинарника (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — ЯДРО ЦЕННОСТИ: офлайн mp4→transcript.md (whisper-runner + transcriber + transcript-builder + минимальный renderer-слайс) (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — Управление моделями: скачивание+SHA256+отмена+удаление в Settings + model_missing-блок на Transcribe (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 03-04-PLAN.md — Live-стриминг+бар, cancel-partial, тумблер таймкодов, «Сохранить как», селектор языка + integration/packaged smoke (Wave 4)

**UI hint**: yes

### Phase 4: LLM Analysis & Prompt Library

**Goal**: Вторая половина ценности — пользователь настраивает подключение к LLM (OpenAI-совместимый endpoint, включая локальные Ollama/LM Studio), ведёт библиотеку именованных русских промптов и получает суммаризацию/анализ транскрипта в виде `analysis.md`.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: ANLZ-01, ANLZ-02, ANLZ-03, ANLZ-04, ANLZ-05, ANLZ-06
**Success Criteria** (what must be TRUE):

  1. Пользователь может настроить подключение к LLM (URL, API-ключ, модель) для любого OpenAI-совместимого endpoint, включая локальные Ollama/LM Studio
  2. Пользователь может создавать, просматривать, изменять и удалять именованные системные промпты, а приложение поставляется с 2-3 готовыми русскими промптами
  3. Пользователь может отправить транскрипт + выбранный системный промпт в LLM и получить ответ
  4. Результат анализа отображается в окне приложения и сохраняется отдельным `.md`-файлом

**Plans**: TBD
**UI hint**: yes

### Phase 5: Distribution & Cross-Platform

**Goal**: Приложение собирается в устанавливаемые артефакты под все три ОС; macOS-сборка подписана и нотаризована со всеми вложенными бинарниками (ffmpeg, whisper.cpp). Кросс-сквозная задача: packaged-build smoke-тест ведётся с Phase 2, здесь финализируется нотаризация macOS как известный длинный хвост.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: DIST-01, DIST-02, DIST-03
**Success Criteria** (what must be TRUE):

  1. Пользователь может установить и запустить приложение из артефакта под Windows
  2. Пользователь может установить и запустить приложение из артефакта под Linux
  3. macOS-артефакт подписан и нотаризован (все вложенные бинарники подписаны), запускается без предупреждений Gatekeeper
  4. Во всех трёх установленных сборках полный pipeline (mp4 → transcript.md → analysis.md) работает end-to-end

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & App Shell | 4/4 | Complete   | 2026-05-30 |
| 2. Media Extraction Pipeline | 6/6 | Complete (Windows; Linux/macOS→v1.1) | 2026-06-08 |
| 3. Local Transcription (Core Value) | 3/4 | In Progress|  |
| 4. LLM Analysis & Prompt Library | 0/TBD | Not started | - |
| 5. Distribution & Cross-Platform | 0/TBD | Not started | - |
