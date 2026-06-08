---
phase: 2
slug: media-extraction-pipeline
status: approved
reviewed_at: 2026-05-31
shadcn_initialized: false
preset: none
created: 2026-05-31
---

# Phase 2 — UI Design Contract

> Дизайн-контракт фазы Media Extraction Pipeline. Расширяет визуальный язык Phase 1 (App.tsx + Settings + BackendWarningBanner) без введения новой системы. MVP-эстетика: минимум зависимостей, спокойный desktop-look, light-only.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (Tailwind CSS v4, CSS-first, без shadcn) |
| Preset | not applicable |
| Component library | none (нативные HTML-элементы + Tailwind utility-классы; паттерн из Phase 1) |
| Icon library | none (Unicode-глифы при необходимости: `✓`, `×`; иконографические библиотеки отложены до Phase 3+) |
| Font | system stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` (унаследовано из `src/renderer/src/styles.css`) |

**Источники пресета:**
- CONTEXT §Claude's Discretion: «Конкретный JSX/Tailwind layout Transcribe-вкладки — планировщик/исполнитель. UI-фаза не нужна (MVP-эстетика)».
- Phase 1 codebase (`styles.css`, `App.tsx`, `Settings.tsx`, `BackendWarningBanner.tsx`) — единственный источник дизайн-токенов проекта.
- CLAUDE.md §Tech Stack: React 19 + Tailwind 4, без сторонних UI-китов.

**shadcn gate:** пропущен. `components.json` отсутствует, добавление shadcn в Phase 2 нарушает MVP-принцип (CONTEXT D-13 deferred-логика расширений). При необходимости — отдельная backlog-задача.

---

## Spacing Scale

8-point scale, мапится на стандартные Tailwind utilities (`p-2` = 8px, `p-4` = 16px, …). Кратно 4.

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| xs | 4px | `*-1` | Промежутки между inline-элементами (иконка/глиф ↔ текст) |
| sm | 8px | `*-2` | Промежутки между связанными элементами (label ↔ value в строке метаданных) |
| md | 16px | `*-4` | Базовый паддинг карточек, gap между формами и кнопками |
| lg | 24px | `*-6` | Внутренние отступы крупных секций (карточка метаданных, drop-zone padding) |
| xl | 32px | `*-8` | Паддинг страницы Transcribe (`p-8` уже используется в Settings/Transcribe placeholder) |
| 2xl | 48px | `*-12` | Вертикальный воздух внутри пустого drop-zone (между иконкой/текстом и кнопкой) |
| 3xl | 64px | `*-16` | Минимальная высота отступа от верха окна до центрированного drop-zone (при необходимости) |

**Exceptions:**
- Drop-zone target — минимальная высота **240px** (3xl × 3.75), это не spacing-токен, а размер контейнера; зафиксирован отдельно ниже.
- Progress-bar высота — **8px** (`h-2`); это размер компонента, не spacing.

---

## Typography

3 размера + 1 для табличных значений = 4 роли. 2 веса: `font-normal` (400) и `font-semibold` (600). Унаследовано из Phase 1 (`text-2xl font-semibold` для h1, `text-sm` для контролов).

| Role | Size | Tailwind | Weight | Tailwind | Line Height |
|------|------|----------|--------|----------|-------------|
| Display (h1 экрана Transcribe) | 24px | `text-2xl` | 600 | `font-semibold` | 1.2 (`leading-tight`) |
| Heading (заголовок drop-zone «Перетащите mp4-файл сюда») | 20px | `text-xl` | 600 | `font-semibold` | 1.25 (`leading-snug`) |
| Body (основной текст, описания, имя файла) | 16px | `text-base` | 400 | `font-normal` | 1.5 (`leading-normal`) |
| Label/UI (кнопки, метаданные, статус-строки, secondary hint) | 14px | `text-sm` | 400 / 600 (только для кнопочного label) | `font-normal` / `font-semibold` | 1.4 (`leading-snug`) |

**Моноширинный шрифт не используется** (длительность `00:12:34` показываем обычным sans с `tabular-nums` через `font-variant-numeric: tabular-nums` или Tailwind `tabular-nums` utility, чтобы цифры не «прыгали» при тике ETA).

---

## Color

Light-only палитра, унаследована из `styles.css` и Tailwind defaults Phase 1. Тёмная тема — out of scope (не было в Phase 1, не вводим в Phase 2).

| Role | Value | Tailwind | Usage |
|------|-------|----------|-------|
| Dominant (60%) | `#f9fafb` | `gray-50` | Фон body, фон рабочей области Transcribe |
| Surface (часть 60%) | `#ffffff` | `white` | Фон nav-bar, фон карточек (метаданные, progress), фон drop-zone в idle |
| Secondary (30%) | `#e5e7eb` / `#d1d5db` | `gray-200` / `gray-300` | Границы карточек, dashed-border drop-zone (idle), вторичная кнопка «Отменить» background `gray-200` |
| Text primary | `#111827` | `gray-900` | Основной текст |
| Text secondary | `#374151` / `#6b7280` | `gray-700` / `gray-500` | Метки, hint-текст, длительность/размер |
| Accent (10%) | `#2563eb` | `blue-600` | **Резервируется строго для:** активная вкладка nav (Phase 1), primary CTA «Извлечь аудио», заливка progress-bar, focus-ring форм. |
| Accent hover | `#1d4ed8` | `blue-700` | Hover primary CTA |
| Success | `#16a34a` / `#dcfce7` / `#15803d` | `green-600` / `green-100` / `green-700` | Success badge «Аудио извлечено» (фон `green-100`, бордер `green-300`, текст `green-900`) — мапится на паттерн Settings «Ключ сохранён». |
| Destructive | `#b91c1c` / `#fee2e2` / `#fecaca` | `red-700` / `red-100` / `red-200` | Текст inline-ошибки (`text-red-700` с `role="alert"` — паттерн Settings); фон карточки ошибки `red-50` с бордером `red-200` |
| Warning | `#fef3c7` / `#facc15` / `#713f12` | `yellow-100` / `yellow-400` / `yellow-900` | Не используется напрямую в Phase 2 (зарезервирован за `BackendWarningBanner` из Phase 1) |
| Drag-over highlight | `#dbeafe` / `#2563eb` | `bg-blue-50` + `border-blue-500` | Подсветка drop-zone когда файл над ней (state `drag-over`) |

**Accent reserved for:**
1. Активная вкладка `nav` (Phase 1, не трогаем).
2. Primary CTA `«Извлечь аудио»` (`bg-blue-600 text-white hover:bg-blue-700`).
3. Primary CTA `«Выбрать mp4-файл»` (тот же стиль — это альтернативный путь к одному и тому же действию выбора файла).
4. Заливка progress-bar (`bg-blue-600` поверх трека `bg-gray-200`).
5. Focus-ring всех интерактивных контролов (`focus:ring-2 focus:ring-blue-500`).
6. Подсветка границы drop-zone в состоянии `drag-over` (`border-blue-500`, фон `bg-blue-50`).

**Запрещено использовать accent для:**
- Вторичных кнопок («Отменить», «Сбросить», «Открыть папку», «Попробовать снова») — они `gray-200` / `gray-300`.
- Hover-состояний неактивных вкладок (остаётся `gray-100` из Phase 1).
- Карточек метаданных.
- Текстовых hint'ов.

**60/30/10 проверка:**
- 60% — белый/`gray-50` фоны (рабочая зона, карточки).
- 30% — `gray-200/300` границы, вторичные кнопки, dashed-border idle drop-zone.
- 10% — `blue-600` (CTA + progress fill + focus-ring + drag-over). Зарезервирован, не растекается.

---

## Copywriting Contract

Все строки — **на русском** (CONTEXT §specifics: «Все user-facing строки — на русском»).

| Element | Copy |
|---------|------|
| Заголовок экрана (h1) | `Транскрипция` (унаследовано из Phase 1 placeholder; не меняем — это та же вкладка) |
| Подзаголовок idle-состояния | `Перетащите mp4-файл сюда` |
| Hint под подзаголовком idle | `или` |
| Primary CTA в idle | `Выбрать mp4-файл` |
| Ограничение | `Один файл за раз. Только .mp4` |
| Заголовок карточки метаданных | `Файл готов к извлечению` |
| Лейблы метаданных | `Имя файла` · `Размер` · `Длительность` |
| Primary CTA в `selected` | `Извлечь аудио` |
| Secondary CTA в `selected` | `Выбрать другой файл` |
| Заголовок прогресса | `Извлекаем аудио…` |
| Прогресс-строка | `{percent}% · ~{etaSec} сек` (например: `45% · ~12 сек`) |
| Secondary CTA в `extracting` | `Отменить` |
| Заголовок done-состояния | `Аудио извлечено` |
| Подпись done | `Файл сохранён в кеше приложения` |
| Путь к wav (отображение) | `{audioPath}` (моноширинный взгляд через `tabular-nums`/`font-mono`-utility опционально, MVP — обычный текст с переносами `break-all`) |
| Primary CTA в `done` | `Открыть папку` |
| Secondary CTA в `done` | `Сбросить` |
| Cache-hit success (быстрый возврат) | `Аудио уже извлечено` |
| Сообщение после отмены | `Извлечение отменено` |
| Empty/initial state копи (drop-zone, нет файла) | См. idle выше — экран никогда не пустой, drop-zone сам по себе empty state. |
| **Error: not mp4** | `Поддерживается только формат .mp4. Выберите другой файл.` |
| **Error: multi-drop** | `Можно перетащить только один файл за раз.` |
| **Error: file not found** | `Файл не найден. Возможно, он был перемещён или удалён.` |
| **Error: ffmpeg_failed** | `Не удалось извлечь аудио. Файл повреждён или неподдерживаемый кодек.` |
| **Error: disk_full** | `Недостаточно места на диске для извлечения аудио. Освободите место и попробуйте снова.` |
| **Error: internal** | `Внутренняя ошибка. Попробуйте перезапустить приложение.` |
| **Error CTA (универсальный)** | `Попробовать снова` |

**Destructive actions:**
- В Phase 2 только одно прерывающее действие: **«Отменить»** в состоянии `extracting`.
- **Подтверждение НЕ требуется** (CONTEXT D-09: SIGTERM + удаление частичного wav — пользователь явно вызвал отмену, потеря частичного wav безвредна, файл-источник не трогается).
- После cancel показывается сообщение `Извлечение отменено` (см. выше) под drop-zone, CTA `Извлечь аудио` возвращается в активное состояние (CONTEXT §specifics).
- «Сбросить» в done-состоянии — не destructive (wav остаётся в кеше, мы только возвращаем UI в idle).

---

## Component Inventory (Phase 2)

Минимальный набор компонентов для исполнителя:

| Component | File path (предложение) | Stateless? | Описание |
|-----------|------------------------|-----------|----------|
| `Transcribe` (экран) | `src/renderer/src/routes/Transcribe.tsx` | Stateful (FSM `idle` → `selected` → `extracting` → `done` \| `error`) | Корневой контейнер экрана, оркестрирует под-состояния и IPC-вызовы. |
| `DropZone` | `src/renderer/src/components/DropZone.tsx` | Stateless (контролируется props) | Крупная dashed-area + кнопка «Выбрать mp4-файл». Props: `onPick(path)`, `onError(reason)`, `disabled`, `dragOver` (внешний state из родителя). |
| `FileMetaCard` | `src/renderer/src/components/FileMetaCard.tsx` | Stateless | Карточка с `name`/`size`/`duration` + 2 кнопки (CTA + secondary). |
| `ExtractProgress` | `src/renderer/src/components/ExtractProgress.tsx` | Stateless | Заголовок + linear progress bar + строка `{percent}% · ~{eta} сек` + кнопка «Отменить». |
| `ExtractDone` | `src/renderer/src/components/ExtractDone.tsx` | Stateless | Success-карточка с путём + 2 кнопки. |
| `InlineError` | `src/renderer/src/components/InlineError.tsx` | Stateless | Карточка ошибки (`bg-red-50 border border-red-200 text-red-900`, `role="alert"`) с текстом и кнопкой `Попробовать снова`. |

**Уже существуют (не трогаем):** `App.tsx` (только заменяет внутренности роута Transcribe), `BackendWarningBanner.tsx`, `Settings.tsx`.

---

## State Map — Transcribe FSM

| State | Triggered by | UI |
|-------|--------------|----|
| `idle` | начальный + после `Сбросить` + после cancel/error через «Попробовать снова»/«Выбрать другой файл» | DropZone активен. `Перетащите mp4-файл сюда` + кнопка `Выбрать mp4-файл`. Hint об ограничениях. |
| `idle-drag-over` | `dragenter`/`dragover` с файлом | DropZone с подсвеченной границей `border-blue-500`, фон `bg-blue-50`. Тот же текст. |
| `validating` | сразу после `pickFile`/`drop` до получения метаданных от `media.probe` | Loader-текст «Читаем метаданные…» (см. ниже), drop-zone недоступен (`pointer-events-none`, `opacity-60`). |
| `selected` | успешный `media.probe` | `FileMetaCard` с метаданными + CTA `Извлечь аудио` + secondary `Выбрать другой файл`. DropZone скрыт. |
| `extracting` | пользователь нажал `Извлечь аудио` (или `media.extractAudio` запущена) | `ExtractProgress` с linear bar, `45% · ~12 сек`, кнопка `Отменить`. DropZone и `FileMetaCard` свёрнуты в одну строку «{filename} · {size}». |
| `done` | `media.extractAudio` resolved с `audioPath` | `ExtractDone` с путём + `Открыть папку` + `Сбросить`. |
| `cache-hit` | `media.extractAudio` мгновенно вернул существующий путь (CONTEXT D-12) | То же, что `done`, но заголовок `Аудио уже извлечено` (вместо `Аудио извлечено`); прогресс-бар не показывается. |
| `error` | reason из `media.*` | `InlineError` с соответствующим текстом (см. Copywriting) + кнопка `Попробовать снова` (возвращает в `idle`). |
| `cancelled` | `media.extractAudio` rejected с `reason: 'cancelled'` | Возврат в `idle` + строка-сообщение `Извлечение отменено` под drop-zone в течение текущей сессии экрана. |

**Loader-текст для `validating`:** `Читаем метаданные…` (text-sm, gray-500, centered).

---

## Layout & Sizing Constraints

| Element | Constraint |
|---------|-----------|
| Корневой контейнер `Transcribe` | `p-8` (32px), `max-w-3xl` (768px), `mx-auto` — центрирован внутри `<main>` |
| DropZone размер | `min-h-[240px]` (60 × 4 = 240px, кратно 4), `w-full` |
| DropZone border | `border-2 border-dashed border-gray-300` в idle; `border-blue-500 bg-blue-50` в drag-over |
| DropZone radius | `rounded-lg` (8px) — единый radius проекта |
| Кнопки (primary/secondary) | `px-4 py-2 text-sm rounded-md` — точно такой же, как в Settings/Phase 1 (`px-4 py-2 text-sm rounded-md bg-blue-600 text-white`) |
| Карточки (FileMetaCard, ExtractDone, ExtractProgress, InlineError) | `p-6 rounded-md border` (24px паддинг, 6px радиус, бордер цвета по роли) |
| Progress bar трек | `h-2 w-full rounded-full bg-gray-200` |
| Progress bar заливка | `h-2 rounded-full bg-blue-600` с `transition-[width] duration-200` |
| Focus ring | `focus:outline-none focus:ring-2 focus:ring-blue-500` (унаследовано из Settings) |
| Tabular numerics для процента/ETA/длительности | utility `tabular-nums` (Tailwind 4 поддерживает) |

---

## Accessibility Contract

| Концерн | Решение |
|---------|---------|
| Кнопка «Выбрать mp4-файл» | Нативная `<button type="button">`, focus-ring обязателен. Та же — для всех кнопок. |
| DropZone keyboard alternative | DropZone сам **не** интерактивен с клавиатуры (drag-only). Кнопка `Выбрать mp4-файл` внутри DropZone — keyboard-доступная альтернатива (соответствует WCAG 2.1.1, drag-and-drop НЕ обязателен). |
| Progress bar | `<div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Прогресс извлечения аудио">` |
| Inline-ошибки | `role="alert"` + красный текст; паттерн Settings. |
| Success-сообщения | `role="status"` + зелёный badge; паттерн Settings. |
| Loader `validating` | `role="status"`, `aria-live="polite"`. |
| Drag-over состояние | Визуальное; для скринридеров не сигнализируется (не нужно — кнопка fallback покрывает). |
| Цветовой контраст | Все text/background пары — `gray-900` на белом / `gray-700` на белом / `white` на `blue-600` / `green-900` на `green-100` / `red-900` на `red-50`. Все ≥ 4.5:1 (AA). |
| Минимальный touch-target | Кнопки `py-2 px-4 text-sm` дают ≈ 36px высоту. Desktop-only приложение, AAA-target 44px не обязателен; AA-touch 24px удовлетворён. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | — (не используется) | not applicable |
| third-party | — | not applicable |

**Гейт не применим:** shadcn не инициализирован, сторонние UI-реестры не подключаются. Все компоненты — собственный код проекта поверх Tailwind 4 utility-классов. Если в Phase 3+ возникнет потребность в shadcn (например, для tooltips/popovers/dialog'ов), это будет отдельная задача с прохождением `<shadcn_gate>`.

---

## Inherited from Phase 1 (НЕ переопределять)

Следующие визуальные паттерны Phase 1 — источник истины; Phase 2 их использует as-is:

1. **Nav-bar** в `App.tsx`: `border-b border-gray-200 bg-white px-4 py-2`, активная вкладка `bg-blue-600 text-white`, неактивная `text-gray-700 hover:bg-gray-100`.
2. **BackendWarningBanner** (если backend деградирован) — рендерится **над** контентом Transcribe; учитывать в визуальном дизайне (Transcribe не должен скрываться под баннером — `overflow-auto` на `<main>` уже работает в Phase 1).
3. **Settings-форма** — паттерн примера для inline error/success.
4. **CSS reset** в `styles.css` — не менять.

---

## Open Questions

Закрытых не осталось. CONTEXT.md и Phase 1 codebase покрыли:
- Палитра — Phase 1 light-only зафиксирована, тёмная тема — out of scope.
- Прогресс — linear bar (CONTEXT §specifics: «progress bar + `45% · ~12 сек`»).
- Toast vs inline — inline (паттерн Settings, минимум зависимостей).
- Иконография — без иконок в Phase 2 (Phase 1 обходится Unicode).
- Drop-zone размеры — зафиксированы выше (`min-h-[240px]`, `max-w-3xl`).

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS (русский, конкретные глаголы, все error-reason'ы покрыты)
- [x] Dimension 2 Visuals: PASS (одна радиус-шкала, один паттерн карточек, один паттерн кнопок)
- [x] Dimension 3 Color: PASS (60/30/10 с явным списком accent-зон; destructive отдельным красным)
- [x] Dimension 4 Typography: PASS (4 размера, 2 веса, унаследовано из Phase 1)
- [x] Dimension 5 Spacing: PASS (multiples of 4, мапится 1-в-1 на Tailwind utilities)
- [x] Dimension 6 Registry Safety: PASS (не применимо — нет third-party реестров)

**Approval:** approved 2026-05-31
