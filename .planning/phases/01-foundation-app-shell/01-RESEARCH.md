# Phase 1: Foundation & App Shell — Research

**Researched:** 2026-05-28
**Domain:** Electron 42 app shell, process boundaries, IPC contract, safeStorage
**Confidence:** HIGH

## Summary

Phase 1 — это walking skeleton нового Electron-приложения. Стек уже зафиксирован в `CLAUDE.md`
(Electron 42, electron-vite 5, electron-builder 26, React 19, TypeScript 5, Tailwind 4,
`safeStorage`, `electron-store` 11). CONTEXT.md закрыл практически все архитектурные
развилки (D-01 … D-15), поэтому ресёрч сфокусирован на верификации стека, выявлении
ловушек официального шаблона, точных API-сигнатурах `safeStorage`/`contextBridge` и
ESM/CJS-ситуации с `electron-store@11`.

**Ключевые находки, влияющие на план:**

1. Команда скаффолдинга — `npm create @quick-start/electron@latest`. Сам npm-пакет на
   реестре отсутствует под именем `@quick-start/electron` — это специальный create-инициатор
   (`@quick-start/create-electron@1.0.30` `[VERIFIED: npm registry]`), и `npm create` его
   разрешает по конвенции. Прямая установка через `npm install @quick-start/electron`
   не сработает.
2. Дефолтный шаблон `react-ts` ставит `sandbox: false` и не выставляет `contextIsolation`
   явно — придётся **переписать `createWindow()`** с явными `sandbox: true`,
   `contextIsolation: true`, `nodeIntegration: false`.
3. Дефолтный шаблон фиксирует Electron **39.2.6**, не 42 — после генерации обязательно
   обновить `electron` до `42.3.0` и пересобрать зависимости.
4. `electron-store@11` — **ESM-only**. electron-vite 5 умеет собирать main как ESM, но в
   шаблоне это не дефолт, и есть подводный камень с `__dirname` — нужно зафиксировать
   `"type": "module"` или динамический `import()`.
5. `safeStorage.getSelectedStorageBackend()` существует **только на Linux**. На macOS/Windows
   эта функция отсутствует — детекция backend в кросс-платформенном коде должна
   разветвляться по `process.platform`.
6. Дефолтный шаблон экспортирует `api: unknown` через preload — это прямой антипаттерн
   к нашему D-08/D-09/D-10 (типизированный domain-namespaced API). Этот код **выбрасываем**
   и заменяем на `window.scrubber.settings.*`.

**Primary recommendation:** Сгенерировать шаблон `react-ts`, привести версии к CLAUDE.md,
переписать `src/main/index.ts` под безопасные `webPreferences`, заменить `src/preload/index.ts`
на типизированный domain-namespaced bridge, добавить `src/shared/ipc.ts` с контрактом,
реализовать `safeStorage` сервис с детектом backend и memory-only fallback, реализовать
рабочий Settings-экран.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 … D-15)

- **D-01** Стартуем через `npm create @quick-start/electron@latest` с шаблоном `react-ts`.
  Не настраиваем electron-vite вручную и не форкаем сторонние проекты.
- **D-02** Версии стека фиксируем из CLAUDE.md: `electron@42.3.0`, `electron-vite@5.0.0`,
  `electron-builder@26.8.1`, `react@19`, `tailwindcss@4`. После генерации привести версии
  к этим, если шаблон отстал.
- **D-03** Базовый UI = скелет навигации с тремя разделами + рабочий Settings (для
  end-to-end safeStorage flow).
- **D-04** Разделы: Transcribe / Analyze / Settings. Transcribe и Analyze — заглушки
  «coming in Phase N»; Settings полностью функционален.
- **D-05** Settings: поле ввода API-ключа (OpenAI-compatible), Save, фидбек «сохранён»,
  после рестарта ключ автоматически подтягивается. Сам ключ в открытом виде НЕ
  показываем — только маркер «сохранён» + кнопка «Replace».
- **D-06** При старте main вызывает `safeStorage.isEncryptionAvailable()` и (только на
  Linux) `safeStorage.getSelectedStorageBackend()`. Результат пробрасывается в renderer
  одним полем `secureBackend: 'keychain' | 'dpapi' | 'libsecret' | 'kwallet' | 'basic_text' | 'unavailable'`.
- **D-07** Если backend === `basic_text` или encryption недоступно → **memory-only режим
  на сессию**. На диск секреты НЕ пишутся. В Settings и поверх главного окна — **жёлтый
  баннер** с инструкцией про `gnome-keyring`/`kwallet`. Работу пользователя не блокируем.
- **D-08** Используем domain-namespaced API с shared TS-типами. Никакого electron-trpc /
  zod в фазе 1.
- **D-09** Структура: `window.scrubber.settings.*` в фазе 1; namespaces `.media.*`,
  `.transcribe.*`, `.llm.*` зарезервированы и появятся в своих фазах. **Скелеты будущих
  namespaces в preload НЕ создаём.**
- **D-10** Shared-папка (`src/shared/ipc.ts`) содержит типы `{ channel, request, response }`.
  Main регистрирует хендлеры через типизированный helper, preload оборачивает
  `ipcRenderer.invoke` в типизированные функции, renderer вызывает через
  `window.scrubber.<namespace>.<method>(args)`.
- **D-11** В фазе 1 реально реализованы только: `settings.saveApiKey(key)`,
  `settings.hasApiKey()`, `settings.clearApiKey()`, `settings.getSecureBackend()`.
- **D-12** Два раздельных файла в `app.getPath('userData')`:
  - `config.json` через `electron-store` — несекретное.
  - `secrets.bin` — сырой бинарный вывод `safeStorage.encryptString(...)` (или
    `JSON{field: base64(encrypted)}` если ключей несколько).
- **D-13** electron-store **не используем** для шифрованных значений. Никаких «encryption»
  опций electron-store.
- **D-14** BrowserWindow: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
  preload — единственный мост.
- **D-15** Никакого Node API в renderer. Никаких `remote` модулей.

### Claude's Discretion

- Конкретный layout Settings (выравнивание, типографика) — Tailwind v4 defaults, MVP-эстетика.
- Точная сигнатура IPC helper'а (Result-обёртка vs throws, naming) — выбор планировщика.
- Window state persistence (размер/позиция) через `electron-store` — можно сделать,
  можно отложить.
- Стратегия логирования — не критично; минимум — структурированный `console` в main.

### Deferred Ideas (OUT OF SCOPE)

- Window state persistence (размер/позиция/zoom) — допустимо в Phase 1 если объём
  позволит, иначе позже.
- Системный tray / single-instance lock — не требование v1.
- i18n — продукт русскоязычный по дефолту, локализация в v2.
- Auto-update — Phase 5.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHELL-01 | Пользователь видит окно приложения с базовым UI на Windows, Linux и macOS | Шаблон `@quick-start/electron react-ts` + electron-vite 5 покрывает кросс-платформенный bootstrap; `BrowserWindow` стандартный. Раздел *Standard Stack* и *Code Examples → BrowserWindow*. |
| SHELL-02 | API-ключ в `safeStorage`, не в plaintext | `safeStorage.encryptString/decryptString` (см. *Code Examples → safeStorage service*). Хранение в `secrets.bin` в `app.getPath('userData')` (D-12). |
| SHELL-03 | Понятное предупреждение, если безопасное хранилище недоступно | Детект через `isEncryptionAvailable()` + `getSelectedStorageBackend()` (только Linux). Memory-only fallback + жёлтый баннер (D-07). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Окно/UI оболочка | Renderer (React) | — | Tailwind v4 + React 19 рендерят shell. |
| Навигация Transcribe/Analyze/Settings | Renderer | — | Client-side роутинг — простой state, не нужен router в Phase 1. |
| Создание `BrowserWindow`, lifecycle | Main | — | Только main процесс владеет окнами. |
| Безопасные `webPreferences` | Main | — | Только main процесс задаёт sandbox/contextIsolation. |
| Preload bridge (allow-list IPC) | Preload | — | Preload — единственная контактная точка между renderer и main. |
| Шифрование/дешифрование секретов | Main | — | `safeStorage` доступен только в main. Renderer не должен видеть ни ключи, ни даже `Buffer` с шифротекстом. |
| Файловое хранилище секретов (`secrets.bin`) | Main | — | Renderer не имеет доступа к `fs` (D-15). |
| Несекретные настройки (`config.json`) | Main (через electron-store) | — | electron-store создаётся в main; renderer тянет значения через IPC. |
| Детект `secureBackend` | Main | — | `safeStorage.getSelectedStorageBackend()` — main-only API. |
| Жёлтый баннер «keyring недоступен» | Renderer | Main (источник флага) | Renderer показывает; main передаёт результат через `settings.getSecureBackend()`. |
| Валидация IPC payload | Main | Preload (узкое typing) | Phase 1 — TS-типы + ручная проверка типа в main-хендлере; без zod (D-08). |

## Standard Stack

### Core (Phase 1 scope)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | `42.3.0` | Desktop runtime | `[VERIFIED: npm registry]` Зафиксировано в CLAUDE.md (D-02). На 42.x есть `safeStorage` со всеми бэкендами и `utilityProcess`. |
| `electron-vite` | `5.0.0` | Dev/build тулинг | `[VERIFIED: npm registry]` Стандарт 2025/2026 для новых Electron-проектов. HMR для renderer + сборка main/preload. |
| `electron-builder` | `26.8.1` | Упаковка | `[VERIFIED: npm registry]` В Phase 1 нужен только для smoke-команд (`build:win`/`build:mac`/`build:linux`) — реальная упаковка в Phase 5. |
| `react` | `19.2.6` | UI framework | `[VERIFIED: npm registry]` Шаблон `react-ts` ставит 19.2.1; обновим до 19.2.6. |
| `react-dom` | `19.2.6` | DOM renderer | `[VERIFIED: npm registry]` Версия совпадает с react. |
| `typescript` | `5.9.3` | Язык | `[VERIFIED: npm registry]` Шаблон ставит 5.9.3 — соответствует CLAUDE.md «TypeScript 5.x». |
| `tailwindcss` | `4.3.0` | Стилизация | `[VERIFIED: npm registry]` v4 — новый engine, минимум конфигурации. В шаблоне НЕ установлен — доустанавливаем. |
| `electron-store` | `11.0.2` | Несекретные настройки | `[VERIFIED: npm registry]` ESM-only (см. *Common Pitfalls → ESM/CJS*). |
| `@electron-toolkit/preload` | как в шаблоне | Утилиты для preload | Поставляется шаблоном; используем как готовый `electronAPI` экспорт (минимально, поверх него — наш `window.scrubber`). |
| `@electron-toolkit/utils` | как в шаблоне | Утилиты main (`is.dev`, `electronApp.setAppUserModelId`) | Поставляется шаблоном. |

### Supporting (Phase 1)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@vitejs/plugin-react` | как в шаблоне | React-плагин для Vite | Уже в шаблоне. |
| `eslint`, `prettier` | как в шаблоне | Линтер/форматтер | Уже в шаблоне; не трогаем. |
| `@types/node`, `@types/react`, `@types/react-dom` | как в шаблоне | Типы | Уже в шаблоне. |

### Explicitly OUT of Phase 1 (другие фазы — НЕ ставить)

| Library | Phase |
|---------|-------|
| `ffmpeg-static`, `fluent-ffmpeg` | Phase 2 |
| Бинарники whisper.cpp / `nodejs-whisper` | Phase 3 |
| `ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `openai` | Phase 4 |
| `zod` или валидаторы схем | Не Phase 1 (D-08 явно исключил) |

**Installation (после `npm create`):**

```bash
# 1. Создать проект (интерактивный CLI)
npm create @quick-start/electron@latest scrubber -- --template react-ts

# 2. Войти в проект
cd scrubber

# 3. Обновить версии до CLAUDE.md
npm install --save-exact electron@42.3.0
npm install --save-exact electron-builder@26.8.1
npm install --save-exact electron-vite@5.0.0
npm install --save-exact react@19.2.6 react-dom@19.2.6

# 4. Добавить недостающие зависимости
npm install --save-exact electron-store@11.0.2
npm install --save-dev --save-exact tailwindcss@4.3.0 @tailwindcss/vite

# 5. Базовая установка
npm install
```

**Version verification (выполнено 2026-05-28):**

| Package | Reported version | Source |
|---------|------------------|--------|
| electron | 42.3.0 | `npm view electron version` |
| electron-vite | 5.0.0 | `npm view electron-vite version` |
| electron-builder | 26.8.1 | `npm view electron-builder version` |
| electron-store | 11.0.2 | `npm view electron-store version` |
| react | 19.2.6 | `npm view react version` |
| typescript | 6.0.3 (latest), 5.9.3 (используем) | `npm view typescript version` — на момент ресёрча 6.0.3 уже в registry, но CLAUDE.md фиксирует «TypeScript 5.x», поэтому остаёмся на 5.9.3 |
| tailwindcss | 4.3.0 | `npm view tailwindcss version` |
| @quick-start/create-electron | 1.0.30 | `npm view @quick-start/create-electron version` |

## Package Legitimacy Audit

| Package | Registry | Publisher | Source Repo | slopcheck | Disposition |
|---------|----------|-----------|-------------|-----------|-------------|
| `electron` | npm | OpenJS Foundation / Electron team | github.com/electron/electron | unavailable | Approved (де-факто стандарт; `[VERIFIED: npm registry]` + официальная страница electronjs.org) |
| `electron-vite` | npm | alex8088 | github.com/alex8088/electron-vite | unavailable | Approved (`[VERIFIED: npm registry]`; задокументировано в official electron-vite.org) |
| `electron-builder` | npm | electron-userland | github.com/electron-userland/electron-builder | unavailable | Approved (`[VERIFIED: npm registry]`; де-факто стандарт упаковки) |
| `electron-store` | npm | sindresorhus | github.com/sindresorhus/electron-store | unavailable | Approved (`[VERIFIED: npm registry]`; published by well-known maintainer) |
| `react`, `react-dom` | npm | Meta | github.com/facebook/react | unavailable | Approved |
| `typescript` | npm | Microsoft | github.com/microsoft/TypeScript | unavailable | Approved |
| `tailwindcss` | npm | Tailwind Labs | github.com/tailwindlabs/tailwindcss | unavailable | Approved |
| `@quick-start/create-electron` | npm | alex8088 | github.com/alex8088/quick-start | unavailable | Approved (`[VERIFIED: npm registry]` v1.0.30; используется только через `npm create`) |
| `@electron-toolkit/preload`, `@electron-toolkit/utils` | npm | alex8088 | github.com/alex8088/electron-toolkit | unavailable | Approved (бандл шаблона react-ts) |

**slopcheck status:** недоступен в среде (попытка `pip install slopcheck --break-system-packages` не дала бинарника). По протоколу
все пакеты выше промаркированы `[VERIFIED: npm registry]` (existence + corresponding official documentation), но **не** прошли
through-tool slopcheck. Это известные публичные пакеты с многолетней историей, риск slopsquatting минимальный, но планировщик
вправе добавить `checkpoint:human-verify` перед `npm install` если хочет дополнительную страховку.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       Main process (Node.js)                    │
│                                                                 │
│  app.whenReady()                                                │
│      │                                                          │
│      ├─► initSafeStorage() ──► detectBackend()                  │
│      │       │                  • isEncryptionAvailable()       │
│      │       │                  • getSelectedStorageBackend()   │
│      │       │                                                  │
│      │       └─► state.secureBackend ∈ { keychain, dpapi,       │
│      │             libsecret, kwallet, basic_text, unavailable }│
│      │                                                          │
│      ├─► initSettingsStore() ──► electron-store (config.json)   │
│      │                                                          │
│      ├─► initSecretsStore() ──► fs read secrets.bin             │
│      │       │                  ↓ decryptString(buf) → key      │
│      │       └─► in-memory plaintext (только main)              │
│      │                                                          │
│      ├─► registerIpcHandlers()                                  │
│      │       └─► ipcMain.handle('settings:saveApiKey', …)       │
│      │       └─► ipcMain.handle('settings:hasApiKey', …)        │
│      │       └─► ipcMain.handle('settings:clearApiKey', …)      │
│      │       └─► ipcMain.handle('settings:getSecureBackend',…)  │
│      │                                                          │
│      └─► createWindow()                                         │
│              new BrowserWindow({                                │
│                webPreferences: {                                │
│                  preload, sandbox: true,                        │
│                  contextIsolation: true,                        │
│                  nodeIntegration: false                         │
│                }                                                │
│              })                                                 │
└─────────────────────────────────────────────────────────────────┘
                         │            ▲
                         │            │ ipcRenderer.invoke(channel, payload)
                         │            │ → Promise<response>
                         ▼            │
┌─────────────────────────────────────────────────────────────────┐
│                Preload (sandboxed, contextIsolation)            │
│                                                                 │
│  import { contextBridge, ipcRenderer } from 'electron'          │
│  import type { ScrubberApi } from '../shared/ipc'               │
│                                                                 │
│  const scrubber: ScrubberApi = {                                │
│    settings: {                                                  │
│      saveApiKey: (k) => ipcRenderer.invoke('settings:save…', k),│
│      hasApiKey:  ()  => ipcRenderer.invoke('settings:has…'),    │
│      clearApiKey:()  => ipcRenderer.invoke('settings:clear…'),  │
│      getSecureBackend:() =>                                     │
│           ipcRenderer.invoke('settings:getSecureBackend')       │
│    }                                                            │
│  }                                                              │
│  contextBridge.exposeInMainWorld('scrubber', scrubber)          │
└─────────────────────────────────────────────────────────────────┘
                         │            ▲
                         │            │ window.scrubber.settings.*
                         ▼            │
┌─────────────────────────────────────────────────────────────────┐
│              Renderer (React 19, Tailwind 4, no Node)           │
│                                                                 │
│  App                                                            │
│   ├─ TopNav (Transcribe / Analyze / Settings)                   │
│   │                                                             │
│   ├─ <BackendWarningBanner /> ──── когда secureBackend ∈        │
│   │     { basic_text, unavailable } — жёлтый баннер             │
│   │                                                             │
│   ├─ Route: Transcribe (placeholder «Coming in Phase 3»)        │
│   ├─ Route: Analyze    (placeholder «Coming in Phase 4»)        │
│   └─ Route: Settings                                            │
│         ├─ getSecureBackend() — banner-зависимая визуальность   │
│         ├─ hasApiKey()        — «сохранён» маркер               │
│         ├─ saveApiKey(value)  — Save                            │
│         └─ clearApiKey()      — Replace                         │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
scrubber/
├── electron.vite.config.ts          # main / preload / renderer Vite config
├── electron-builder.yml             # минимальная конфигурация (Phase 5 расширит)
├── package.json                     # "type": "module" (см. ESM/CJS pitfall)
├── tsconfig.json                    # solution-style — references на node/web
├── tsconfig.node.json               # main + preload (Node lib)
├── tsconfig.web.json                # renderer (DOM lib)
├── src/
│   ├── main/
│   │   ├── index.ts                 # createWindow + app lifecycle
│   │   ├── ipc/
│   │   │   ├── index.ts             # registerIpcHandlers()
│   │   │   └── settings.ts          # хендлеры settings:* (D-11)
│   │   ├── services/
│   │   │   ├── secure-backend.ts    # детект backend, состояние «secureBackend»
│   │   │   ├── secrets-store.ts     # safeStorage + secrets.bin
│   │   │   └── settings-store.ts    # electron-store обёртка
│   │   └── window.ts                # createWindow с безопасными webPreferences
│   ├── preload/
│   │   ├── index.ts                 # contextBridge.exposeInMainWorld('scrubber', …)
│   │   └── index.d.ts               # declare global { interface Window { scrubber } }
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx              # навигация + рутинг по state
│   │       ├── routes/
│   │       │   ├── Transcribe.tsx   # заглушка
│   │       │   ├── Analyze.tsx      # заглушка
│   │       │   └── Settings.tsx     # рабочий
│   │       ├── components/
│   │       │   └── BackendWarningBanner.tsx
│   │       └── styles.css           # @import "tailwindcss";
│   └── shared/
│       └── ipc.ts                   # ScrubberApi, IpcContract, типы channels
└── resources/                       # иконки (для электрона)
```

### Pattern 1: Безопасный BrowserWindow

**What:** Каждое окно создаётся с минимально-разрешающими `webPreferences`.
**When to use:** Везде. Это не опция, это обязательное умолчание (D-14).
**Example:**
```typescript
// src/main/window.ts
// Source: https://www.electronjs.org/docs/latest/tutorial/security (Electron 2026 checklist)
import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,            // D-14 — НЕ оставлять дефолт шаблона (false)
      contextIsolation: true,   // D-14 — explicit, даже если default since 12.0
      nodeIntegration: false,   // D-14 — explicit, даже если default since 5.0
      webSecurity: true,        // default; явно — чтобы не сломать ревью
      allowRunningInsecureContent: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Любые внешние ссылки — в системный браузер
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
```

### Pattern 2: Типизированный IPC контракт

**What:** Один источник правды (`src/shared/ipc.ts`) с типами channel → request → response.
Main, preload и renderer импортируют ОДИН и тот же тип.
**When to use:** Каждый новый IPC-вызов.
**Example:**
```typescript
// src/shared/ipc.ts
// Контракт IPC — единый источник правды (D-10)

export type SecureBackend =
  | 'keychain'      // macOS
  | 'dpapi'         // Windows
  | 'libsecret'     // Linux gnome_libsecret
  | 'kwallet'       // Linux kwallet/kwallet5/kwallet6
  | 'basic_text'    // Linux без keyring
  | 'unavailable'   // safeStorage.isEncryptionAvailable() === false

export interface SettingsApi {
  saveApiKey: (key: string) => Promise<{ ok: true } | { ok: false; reason: string }>
  hasApiKey: () => Promise<boolean>
  clearApiKey: () => Promise<{ ok: true }>
  getSecureBackend: () => Promise<SecureBackend>
}

export interface ScrubberApi {
  settings: SettingsApi
  // намеренно НЕ объявляем media / transcribe / llm — приедут в своих фазах (D-09)
}

// Каналы — единственное место, где живут строковые имена
export const Channels = {
  Settings: {
    SaveApiKey: 'settings:saveApiKey',
    HasApiKey: 'settings:hasApiKey',
    ClearApiKey: 'settings:clearApiKey',
    GetSecureBackend: 'settings:getSecureBackend'
  }
} as const
```

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type ScrubberApi } from '../shared/ipc'

const scrubber: ScrubberApi = {
  settings: {
    saveApiKey: (k) => ipcRenderer.invoke(Channels.Settings.SaveApiKey, k),
    hasApiKey:  ()  => ipcRenderer.invoke(Channels.Settings.HasApiKey),
    clearApiKey:()  => ipcRenderer.invoke(Channels.Settings.ClearApiKey),
    getSecureBackend: () => ipcRenderer.invoke(Channels.Settings.GetSecureBackend)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('scrubber', scrubber)
} else {
  // process.contextIsolated должен быть всегда true в нашем шелле,
  // но fallback на случай ошибки конфигурации — fail-loud
  throw new Error('contextIsolation must be enabled (D-14)')
}
```

```typescript
// src/preload/index.d.ts
import type { ScrubberApi } from '../shared/ipc'
declare global {
  interface Window {
    scrubber: ScrubberApi
  }
}
export {}
```

```typescript
// src/main/ipc/settings.ts
import { ipcMain } from 'electron'
import { Channels, type SecureBackend } from '../../shared/ipc'
import { secretsStore } from '../services/secrets-store'
import { secureBackend } from '../services/secure-backend'

export function registerSettingsHandlers(): void {
  ipcMain.handle(Channels.Settings.SaveApiKey, async (_e, key: unknown) => {
    if (typeof key !== 'string' || key.length === 0) {
      return { ok: false as const, reason: 'invalid_key' }
    }
    return secretsStore.saveApiKey(key)
  })

  ipcMain.handle(Channels.Settings.HasApiKey, async () => secretsStore.hasApiKey())
  ipcMain.handle(Channels.Settings.ClearApiKey, async () => secretsStore.clearApiKey())
  ipcMain.handle(Channels.Settings.GetSecureBackend, async (): Promise<SecureBackend> =>
    secureBackend.current()
  )
}
```

### Pattern 3: safeStorage сервис

**What:** Один модуль в main, который инкапсулирует `safeStorage.encryptString/decryptString`,
файл `secrets.bin` и memory-only fallback. Renderer никогда не видит ни ключ, ни шифротекст.
**When to use:** Любая операция с API-ключом или другим секретом.
**Example:**
```typescript
// src/main/services/secrets-store.ts
import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { secureBackend } from './secure-backend'

const SECRETS_FILE = join(app.getPath('userData'), 'secrets.bin')

interface SecretsShape {
  apiKey?: string // base64 шифротекст
}

class SecretsStore {
  private memory: { apiKey?: string } = {} // plaintext в памяти на сессию
  private diskCache: SecretsShape | null = null

  async init(): Promise<void> {
    const backend = secureBackend.current()
    if (backend === 'unavailable' || backend === 'basic_text') {
      // D-07: memory-only режим, на диск не пишем
      this.diskCache = null
      return
    }
    try {
      const buf = await fs.readFile(SECRETS_FILE)
      this.diskCache = JSON.parse(buf.toString('utf8')) as SecretsShape
      if (this.diskCache.apiKey) {
        const cipher = Buffer.from(this.diskCache.apiKey, 'base64')
        this.memory.apiKey = safeStorage.decryptString(cipher)
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      this.diskCache = {}
    }
  }

  async saveApiKey(key: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.memory.apiKey = key
    const backend = secureBackend.current()
    if (backend === 'unavailable' || backend === 'basic_text') {
      // D-07: на диск не пишем
      return { ok: true }
    }
    try {
      const cipher = safeStorage.encryptString(key) // Buffer
      const next: SecretsShape = { ...(this.diskCache ?? {}), apiKey: cipher.toString('base64') }
      await fs.writeFile(SECRETS_FILE, JSON.stringify(next), { mode: 0o600 })
      this.diskCache = next
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: (err as Error).message }
    }
  }

  hasApiKey(): boolean {
    return typeof this.memory.apiKey === 'string' && this.memory.apiKey.length > 0
  }

  async clearApiKey(): Promise<{ ok: true }> {
    delete this.memory.apiKey
    if (this.diskCache?.apiKey) {
      const next = { ...this.diskCache }
      delete next.apiKey
      await fs.writeFile(SECRETS_FILE, JSON.stringify(next), { mode: 0o600 })
      this.diskCache = next
    }
    return { ok: true }
  }
}

export const secretsStore = new SecretsStore()
```

```typescript
// src/main/services/secure-backend.ts
import { app, safeStorage } from 'electron'
import type { SecureBackend } from '../../shared/ipc'

class SecureBackendService {
  private value: SecureBackend = 'unavailable'

  init(): void {
    // ОБЯЗАТЕЛЬНО вызывать после app.whenReady()
    if (!safeStorage.isEncryptionAvailable()) {
      this.value = 'unavailable'
      return
    }
    if (process.platform === 'darwin') { this.value = 'keychain'; return }
    if (process.platform === 'win32')  { this.value = 'dpapi';   return }
    if (process.platform === 'linux') {
      const raw = safeStorage.getSelectedStorageBackend()
      switch (raw) {
        case 'gnome_libsecret': this.value = 'libsecret'; break
        case 'kwallet':
        case 'kwallet5':
        case 'kwallet6':        this.value = 'kwallet';   break
        case 'basic_text':      this.value = 'basic_text'; break
        default:                this.value = 'unavailable'
      }
    }
  }

  current(): SecureBackend { return this.value }
}

export const secureBackend = new SecureBackendService()
```

### Pattern 4: main bootstrap

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow } from './window'
import { secureBackend } from './services/secure-backend'
import { secretsStore } from './services/secrets-store'
import { registerSettingsHandlers } from './ipc/settings'

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.scrubber.app')
  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))

  // 1. Детект безопасного хранилища — ДО регистрации хендлеров
  secureBackend.init()
  await secretsStore.init()

  // 2. Регистрация IPC
  registerSettingsHandlers()

  // 3. Окно
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

### Anti-Patterns to Avoid

- **`sandbox: false` в `webPreferences`** — это дефолт шаблона `react-ts`. Прямое
  нарушение D-14. **Обязательно поменять на `true`.**
- **`api: unknown` через `contextBridge`** — это дефолт шаблона. Нарушает D-08/D-09/D-10.
  Заменить на типизированный `ScrubberApi`.
- **Хранить расшифрованный ключ в renderer state** — D-15 запрещает Node API в renderer,
  и по той же логике — секреты не должны лежать в renderer. Renderer только показывает
  «сохранён/не сохранён» (D-05).
- **`electron-store` с `encryptionKey`** — D-13: документировано взламываемо.
- **`ipcMain.on/send` для запросов с ответом** — использовать `handle/invoke`. `on/send`
  оставляем только для будущих стримов прогресса (Phase 3).
- **Бросать сырые `Error` из `ipcMain.handle`** — only `.message` сериализуется. Возвращать
  Result-тип `{ ok: true } | { ok: false; reason }` (см. Pattern 2).
- **Использовать `enableRemoteModule`** — давно deprecated, не включать.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Хранение секретов | Свой XOR/AES поверх файла | `safeStorage` (встроено) | Системный keychain/DPAPI/libsecret-kwallet, ноль нативных зависимостей. |
| JSON-конфиг с атомарной записью | Свой `fs.writeFile + temp + rename` | `electron-store` 11 | Atomic write, schema-options, миграции. |
| Bootstrap Electron + Vite + React + TS | Свой webpack/rollup/tsconfig | `@quick-start/electron` шаблон `react-ts` | Покрывает HMR renderer + main, ESLint, Prettier, electron-builder. |
| Кросс-платформенный preload bridge | Прямой `window.electron = …` | `contextBridge.exposeInMainWorld` | Изолированный мир, нет утечек prototype chain. |
| TS-типы для `window.scrubber` | `as any` | `declare global { interface Window … }` в `preload/index.d.ts` | Стандарт; renderer автоматически видит типы. |
| Детект Linux keyring | `which gnome-keyring-daemon` | `safeStorage.getSelectedStorageBackend()` | Возвращает строку, которую можно нормализовать (см. Pattern 3). |

**Key insight:** Phase 1 — это «правильно собрать готовое». Каждая попытка написать
«своё» в безопасности/IPC/хранилище означает либо дыру, либо переделку через две фазы.

## Common Pitfalls

### Pitfall 1: Дефолтный шаблон НЕ безопасен из коробки

**What goes wrong:** Шаблон `react-ts` ставит `sandbox: false` и не выставляет
`contextIsolation: true` явно. При невнимательном чтении кажется, что «всё ок, ведь
contextIsolation default». Но шаблон ещё и пробрасывает `api: unknown` через
`contextBridge`, что превращает безопасный мост в нетипизированный allow-anything.

**Why it happens:** Шаблон нацелен на «быстро запустить», не на «защищённый продукт».

**How to avoid:** В Phase 1 первый task после `npm create` — **переписать
`src/main/window.ts` и `src/preload/index.ts` под D-14/D-08/D-09/D-10**. Проверять глазами:
`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, типизированный
`ScrubberApi` через `contextBridge`.

**Warning signs:** `sandbox: false` в diff. `window.api: unknown`. Отсутствие
`src/shared/ipc.ts`. Любой `as any` в preload.

### Pitfall 2: Шаблон отстаёт по версии Electron

**What goes wrong:** Шаблон `@quick-start/electron@1.0.30` ставит `electron@39.2.6` —
наш CLAUDE.md фиксирует `42.3.0`. Между 39 и 42 — два мажорных релиза, есть изменения
в `safeStorage` для Linux (kwallet5 → kwallet6 нормализация) и breaking-changes в
default'ах `BrowserWindow`.

**How to avoid:** Сразу после `npm create` выполнить `npm install --save-exact
electron@42.3.0` и `npm run typecheck` для проверки совместимости. Зафиксировать в plan
явный task «bump electron + retypecheck».

**Warning signs:** Любая ошибка вида «module not found» при типечеке после bump.

### Pitfall 3: `electron-store@11` — ESM-only, главный процесс на CJS

**What goes wrong:** `electron-store` v11 экспортирует только ESM. electron-vite собирает
main процесс в формате, зависящем от `package.json` `"type"`. Если `"type": "module"`
не выставлен и main собирается в CJS, прямой `import Store from 'electron-store'`
упадёт в runtime: `Error [ERR_REQUIRE_ESM]: require() of ES Module …`.

**Why it happens:** ESM-only пакеты не имеют CommonJS-точки входа.

**How to avoid:** Один из двух подходов:

1. **Рекомендуемый:** `"type": "module"` в `package.json`. electron-vite 5 поддерживает
   ESM-выход для main процесса (`build.rollupOptions.output.format: 'es'`). Проверить, что
   `electron.vite.config.ts` собирает main как ESM (или оставить дефолт, если он уже ESM).
2. **Альтернатива:** Динамический `const Store = (await import('electron-store')).default`
   в `app.whenReady()` хендлере. Менее красиво, но работает без перехода всего проекта на ESM.

**Warning signs:** `ERR_REQUIRE_ESM` в логах при запуске. `Store is not a constructor`.

### Pitfall 4: `getSelectedStorageBackend()` существует только на Linux

**What goes wrong:** `safeStorage.getSelectedStorageBackend()` — Linux-only. Прямой вызов
на macOS/Windows бросает `TypeError: getSelectedStorageBackend is not a function`
(или возвращает `undefined` в зависимости от версии).

**How to avoid:** Ветвление по `process.platform === 'linux'` — см. Pattern 3,
`SecureBackendService.init()`.

**Warning signs:** TypeError на macOS/Windows при старте; `secureBackend === 'unavailable'`
на macOS, хотя `safeStorage.isEncryptionAvailable()` === true.

### Pitfall 5: `safeStorage` API нельзя вызывать до `app.ready`

**What goes wrong:** `safeStorage.isEncryptionAvailable()` / `getSelectedStorageBackend()`
возвращают неверные значения или бросают, если их вызвать до `app.whenReady()`.
На Linux `getSelectedStorageBackend()` вернёт `'unknown'` если вызван до ready.

**How to avoid:** Все init-вызовы — **только внутри** `app.whenReady().then(…)`. См.
Pattern 4 (`src/main/index.ts`).

**Warning signs:** `secureBackend === 'unavailable'` на машине, где keyring явно есть.

### Pitfall 6: `safeStorage.encryptString` возвращает `Buffer`, не строку

**What goes wrong:** Шифротекст — `Buffer`. Его нельзя напрямую положить в JSON
(будет `{"type":"Buffer","data":[…]}` — большой и неудобный). Если потом сделать
`Buffer.from(JSON.parse(…))`, легко получить мусор при `decryptString`.

**How to avoid:** Кодировать в base64 при записи (`cipher.toString('base64')`) и
декодировать (`Buffer.from(b64, 'base64')`) при чтении — см. Pattern 3.

**Warning signs:** `Error: Decryption failed` при чтении сохранённого ключа.

### Pitfall 7: `ipcMain.handle` теряет stack trace ошибки

**What goes wrong:** Errors thrown через `ipcMain.handle` сериализуются — renderer
получает только `.message`. Stack trace и custom properties теряются. При отладке —
непонятно, что упало.

**How to avoid:** Возвращать **Result-тип** `{ ok: true } | { ok: false; reason: string }`
вместо бросания. Логировать полную ошибку в main через `console.error` перед возвратом.

**Warning signs:** В renderer — только «Error: secretsStore is not initialized» без места
падения.

### Pitfall 8: `process.platform` для путей `userData`

**What goes wrong:** Программисты иногда пишут `~/Library/...` или
`%APPDATA%` руками. `app.getPath('userData')` уже даёт правильный путь per-OS
(`~/Library/Application Support/scrubber` на macOS, `%APPDATA%\scrubber` на Windows,
`~/.config/scrubber` на Linux).

**How to avoid:** Всегда `app.getPath('userData')`. Никогда не хардкодить.

**Warning signs:** На Linux — пустая папка `~/Library/...`.

### Pitfall 9: Sandboxed preload — ограниченный набор модулей

**What goes wrong:** В sandboxed preload `require` поддерживает только: `electron`
(contextBridge, ipcRenderer, nativeImage, webFrame, webUtils, crashReporter) и Node
встроенные: `events`, `timers`, `url`. Импорт `fs`, `path`, `child_process` не
сработает.

**How to avoid:** В preload — только тонкая обёртка над `ipcRenderer.invoke`. Любая
логика, требующая fs/path/etc — в main, доступ через IPC.

**Warning signs:** `Error: Cannot find module 'fs'` в preload.

### Pitfall 10: TypeScript не видит `window.scrubber` в renderer

**What goes wrong:** Декларация `declare global { interface Window { scrubber } }`
в `src/preload/index.d.ts` не попадает в `tsconfig.web.json` (он смотрит на renderer).
В результате renderer пишет `window.scrubber.settings.…` и получает `Property 'scrubber'
does not exist on type 'Window'`.

**How to avoid:** В `tsconfig.web.json` (или его include) добавить `src/preload/index.d.ts`
и `src/shared/ipc.ts`. Альтернатива — отдельный `src/renderer/src/env.d.ts`, который
ре-импортирует декларацию.

**Warning signs:** TS-ошибка в Settings.tsx про несуществующее свойство.

## Runtime State Inventory

Не применимо. Phase 1 — greenfield (первая фаза нового проекта, кода ещё нет).
Нет ни баз данных, ни OS-registered state, ни build-артефактов, ни секретов,
которые надо мигрировать. Все указанные в плане файлы (`secrets.bin`, `config.json`)
создаются **впервые** этой фазой.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | electron-vite, npm | (предположительно ✓ — у пользователя установлен) | ≥ 20 LTS | — |
| npm | пакетный менеджер | ✓ | (текущий) | pnpm/yarn — на усмотрение Max |
| Git | history | ✓ (репозиторий уже инициализирован) | — | — |
| Electron 42 runtime | приложение | будет установлен через `npm install` | 42.3.0 | — |
| gnome-keyring / kwallet (Linux) | safeStorage hard-encryption | **runtime-зависимость пользователя** | — | **Detected:** `basic_text` backend → memory-only режим + жёлтый баннер (D-07). Не блокирует разработку. |
| macOS Keychain | safeStorage на macOS | системный | — | — |
| Windows DPAPI | safeStorage на Windows | системный | — | — |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** Linux keyring — детектируется в рантайме на
машине пользователя; на dev-машинах разработчика гарантировать наличие невозможно.
Fallback (memory-only) уже в скоупе фазы (D-07).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **Vitest 2.x** — выбор Phase 1 (не Jest). Совместим с Vite/electron-vite, native ESM. |
| Config file | `vitest.config.ts` (создаётся в Wave 0) |
| Quick run command | `npm run test:unit` → `vitest run --reporter=dot` |
| Full suite command | `npm run test` → `vitest run` + типечек + electron-builder dry-run |
| E2E (опционально Phase 1) | Playwright Electron — отложить если объём не позволяет; явный manual checklist для SHELL-01 на трёх ОС |

> Vitest выбран потому что: (1) zero-config с Vite, (2) ESM-native (мы и так на ESM из-за
> electron-store), (3) совместим с TS из коробки. Альтернативу Jest рассматривать только
> если у Max есть сильное предпочтение.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SHELL-01 | Окно приложения открывается на 3 ОС | manual-smoke (3 OS) | `npm run dev` на каждой ОС + чек-лист | ❌ Wave 0 |
| SHELL-02a | `safeStorage` encrypt/decrypt API-ключа (unit) | unit | `vitest run src/main/services/secrets-store.test.ts` | ❌ Wave 0 |
| SHELL-02b | API-ключ переживает рестарт (integration) | integration | `vitest run tests/integration/secrets-persist.test.ts` (mock `app.getPath`) | ❌ Wave 0 |
| SHELL-02c | Renderer не имеет прямого доступа к секрету | unit | `vitest run src/preload/index.test.ts` (ensure preload не выставляет ключ) | ❌ Wave 0 |
| SHELL-03 | Backend === `basic_text` → memory-only + баннер | unit + manual | `vitest run src/main/services/secure-backend.test.ts` + manual UI check | ❌ Wave 0 |
| D-14 | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` | unit | `vitest run src/main/window.test.ts` (snapshot of webPreferences) | ❌ Wave 0 |
| D-10 | IPC контракт типизирован | typecheck | `npm run typecheck` | ✓ (в шаблоне есть `typecheck` script) |
| Security baseline | `electron/fuses` правила (опционально) | static | — | (Phase 5) |

### Sampling Rate

- **Per task commit:** `npm run typecheck && npm run test:unit` (≤ 10 секунд для Phase 1).
- **Per wave merge:** `npm run test:unit && npm run build` (полный typecheck + сборка
  main/preload/renderer).
- **Phase gate:** Полный suite + manual smoke на трёх ОС (если CI matrix не настроен).

### Wave 0 Gaps

- [ ] `vitest.config.ts` — установить и сконфигурировать Vitest.
- [ ] `tests/setup.ts` — мокать `electron` модуль (`app`, `safeStorage`, `BrowserWindow`).
- [ ] `src/main/services/secrets-store.test.ts` — покрывает SHELL-02a.
- [ ] `src/main/services/secure-backend.test.ts` — покрывает SHELL-03 (нормализация
      строк gnome_libsecret → libsecret, kwallet5 → kwallet, basic_text → basic_text).
- [ ] `src/main/window.test.ts` — snapshot `webPreferences` для D-14.
- [ ] `tests/integration/secrets-persist.test.ts` — round-trip save → reload → read.
- [ ] `npm install --save-dev --save-exact vitest@2 @vitest/ui` — framework install.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | partial — API-ключ как «authenticator» для внешнего LLM | Сам ключ — ответственность пользователя; мы — secure storage. |
| V3 Session Management | no | Phase 1 не имеет сессий. |
| V4 Access Control | yes (process boundaries) | `contextIsolation` + `sandbox` + preload allow-list (D-14). |
| V5 Input Validation | yes | IPC payload — ручная проверка типа `typeof key === 'string'` в main-хендлерах (Phase 1 без zod). |
| V6 Cryptography | yes — secrets storage | `safeStorage` (D-12/D-13). Никаких самописных шифровок. |
| V8 Data Protection (secrets at rest) | yes | `secrets.bin` отдельно от `config.json`, mode `0o600`. |
| V14 Configuration | yes | `webPreferences` явный (D-14); secure defaults. |

### Known Threat Patterns for Electron Shell

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| RCE через `nodeIntegration: true` в renderer | Elevation of Privilege | `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true` (D-14). |
| Утечка API-ключа в renderer memory / DevTools | Information Disclosure | Ключ живёт только в main. Renderer видит только `hasApiKey: boolean`. UI не отображает сам ключ (D-05). |
| Хранение секрета в plaintext-файле | Information Disclosure | `safeStorage.encryptString`; при недоступности — memory-only (D-07). |
| Слабое «шифрование» через electron-store encryptionKey | Information Disclosure | Запрещено (D-13). |
| Спуфинг IPC канала из вредоносного фрейма | Spoofing | По умолчанию у нас один `BrowserWindow` без `<webview>`/iframe внешних сайтов; sandbox блокирует child-frames Node-доступ. Дополнительно — `webContents.setWindowOpenHandler` → `deny`. |
| Prototype pollution через `contextBridge` | Tampering | `contextBridge` сам по себе клонирует — нельзя передавать prototypes. Возвращаем plain JSON-сериализуемые объекты. |
| Загрузка стороннего HTTP-контента | Tampering | `webSecurity: true`, `allowRunningInsecureContent: false`. Внешние ссылки — через `shell.openExternal` в системный браузер. |

## Sources

### Primary (HIGH confidence)

- npm registry — точные актуальные версии электрон-стека:
  `electron@42.3.0`, `electron-vite@5.0.0`, `electron-builder@26.8.1`, `electron-store@11.0.2`,
  `react@19.2.6`, `typescript@5.9.3 / 6.0.3`, `tailwindcss@4.3.0`,
  `@quick-start/create-electron@1.0.30`.
- electronjs.org/docs/latest/api/safe-storage — API safeStorage, Linux backends,
  `getSelectedStorageBackend()` semantics.
- electronjs.org/docs/latest/tutorial/sandbox — sandbox semantics, ограничения preload.
- electronjs.org/docs/latest/tutorial/context-isolation — `contextBridge.exposeInMainWorld`,
  типизация `window.*`.
- electronjs.org/docs/latest/tutorial/security — official 2026 security checklist.
- electronjs.org/docs/latest/tutorial/ipc — invoke/handle vs send/on, error semantics.
- electron-vite.org — `npm create @quick-start/electron@latest`, шаблоны (vanilla, vue,
  react, svelte, solid × js/ts), структура `electron.vite.config.ts`.
- github.com/alex8088/quick-start/packages/create-electron/playground/react-ts —
  фактическое содержимое шаблона react-ts (electron@39.2.6, sandbox: false, api: unknown).
- github.com/sindresorhus/electron-store — v11 ESM-only, migration guidance.

### Secondary (MEDIUM confidence)

- CLAUDE.md §Technology Stack — наш собственный фиксатор версий (опирается на npm registry).
- @electron-toolkit/preload и @electron-toolkit/utils — поставляются шаблоном; полагаемся
  на их public API (`electronAPI`, `electronApp`, `is`, `optimizer`).

### Tertiary (LOW confidence)

- (нет; ни одной находки не оставили на этом уровне)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getSelectedStorageBackend()` на Linux возвращает строки в наборе `{ gnome_libsecret, kwallet, kwallet5, kwallet6, basic_text, unknown }` | Pattern 3 / Pitfall 4 | Если в новой версии Electron появится новое значение (например `secret-service`), `secureBackend.init()` упадёт в `unavailable` и пользователь увидит баннер на машине, где keyring есть. Mitigation: добавить `console.warn` для не-распознанного значения. `[CITED: electronjs.org/docs/latest/api/safe-storage]` — список значений; класс `[ASSUMED]` потому что новые значения могут появиться. |
| A2 | electron-vite 5 умеет собирать main процесс в ESM, если `package.json` `"type": "module"` | Pitfall 3 | Если не умеет — придётся использовать динамический `import()` для `electron-store`. `[ASSUMED]` — electron-vite docs не раскрыли детали при WebFetch. Tasks `electron-store` должны verifying-run сделать сразу после установки. |
| A3 | Vitest 2.x совместим с electron-vite 5 без дополнительной конфигурации | Validation Architecture | Если несовместим — переключиться на Jest или конфигурировать Vitest вручную. `[ASSUMED]` — не проверено через Context7/registry на момент ресёрча. |
| A4 | `process.platform === 'linux'` → нужен gnome-keyring/kwallet. Если в дистре только seahorse без keyring-daemon, поведение точно как описано | Pitfall 4 / D-07 | Возможен edge-case с пустым keyring API но present daemon — backend вернётся `basic_text` и memory-fallback сработает. Безопасный fallback покрывает риск. `[ASSUMED]`. |
| A5 | `package.json` `"type": "module"` в шаблоне `react-ts` не выставлен | Pitfall 3 | Не подтверждено через прямое чтение JSON (WebFetch упал на playground/react-ts/package.json). Если уже `module` — подводный камень не возникает. **Verify-task в плане:** `cat package.json | grep '"type"'` сразу после генерации. |

## Open Questions (RESOLVED)

1. **Шаблон ставит electron 39 — насколько безболезненно обновить до 42?**
   - Что мы знаем: `npm install --save-exact electron@42.3.0` обновит пакет.
   - Что неясно: возможны ли регрессии в `@electron-toolkit/*` версиях, привязанных к 39.
   - Рекомендация: первый task — bump + `npm run typecheck` + `npm run dev`; если
     `@electron-toolkit/*` ругаются — обновить и их (последние версии в registry).
   - **RESOLVED:** заложено в Plan 01-01 Task 1 (явный bump до electron@42.3.0 + typecheck + dev-smoke; обновление `@electron-toolkit/*` при необходимости).

2. **CI matrix на 3 ОС в Phase 1 или отложить?**
   - Что мы знаем: GitHub Actions имеет `windows-latest`, `macos-latest`, `ubuntu-latest`.
   - Что неясно: бюджет CI у Max, реально ли нужна matrix для walking skeleton.
   - Рекомендация: минимальный CI — typecheck + `electron-vite build` на одной ОС
     (`ubuntu-latest`). Кросс-платформенный билд через electron-builder отложить в Phase 5.
     В Phase 1 — ручной smoke на трёх ОС перед закрытием фазы.
   - **RESOLVED:** в Phase 1 CI matrix НЕ вводится. Cross-OS покрытие — ручной smoke через checkpoint в Plan 01-04 Task 3. CI matrix отложена в Phase 5 (packaging & distribution).

3. **Window state persistence — в Phase 1 или нет?**
   - CONTEXT.md (Deferred) разрешает оба варианта.
   - Рекомендация: **отложить.** `electron-store` уже будет настроен, добавить
     `{ width, height, x, y }` тривиально в любой следующей фазе.
   - **RESOLVED:** отложено. В планах Phase 1 не реализуется; добавим тривиально в одной из следующих фаз (electron-store уже настроен в 01-02).

4. **Playwright Electron для E2E SHELL-02 («ключ переживает рестарт»)?**
   - Что мы знаем: Playwright поддерживает Electron через `_electron.launch()`.
   - Что неясно: время на настройку vs ценность.
   - Рекомендация: для Phase 1 достаточно unit + integration с моком `electron`-модуля
     (Vitest умеет, см. Wave 0). Playwright — кандидат в Phase 5 при настройке CI.
   - **RESOLVED:** в Phase 1 Playwright НЕ добавляется. Покрытие SHELL-02 — unit (01-02 T2) + integration (01-03 T2 secrets-persist round-trip с tmpdir). Playwright рассматривается в Phase 5.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `keytar` для секретов | `safeStorage` (встроено в Electron) | keytar deprecated 2022-12; safeStorage backends расширены в Electron 15+ | Нет нативной зависимости, нет нужды в `@electron/rebuild`. |
| `electron-builder` как монолит сборки+упаковки | `electron-vite` для сборки + `electron-builder` для упаковки | electron-vite 1.x (2022) → 5.x (2025) | Лучший DX (HMR renderer + main reload), modular toolchain. |
| `sandbox: false` (default до Electron 20) | `sandbox: true` (default since Electron 20) | Electron 20 (2022) | Шаблоны иногда ставят `sandbox: false` по инерции — проверять! |
| `nodeIntegration: true` в renderer | `nodeIntegration: false` + preload bridge | Electron 5+ | Не отключать обратно «для удобства». |
| `enableRemoteModule: true` | deprecated, удалён | Electron 14 (2021) | Не использовать. |
| `electron-store` v8 (CJS) | `electron-store` v11 (ESM-only) | electron-store 10+ | Нужен ESM main или dynamic import. |
| `npm create electron-vite` (старая команда) | `npm create @quick-start/electron@latest` | quick-start стал каноническим scaffold | Команда CLAUDE.md правильная. |

**Deprecated / outdated:**

- `keytar` — не использовать (см. CLAUDE.md «What NOT to Use»).
- `electron-store` с опцией `encryptionKey` — не использовать (D-13).
- `remote` модуль (`@electron/remote` и старый `electron.remote`) — не использовать.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — все версии проверены `npm view`; стек явно зафиксирован в
  CLAUDE.md и CONTEXT.md.
- Architecture: HIGH — паттерны взяты из официальной документации Electron
  (security checklist, IPC tutorial, safeStorage docs, contextBridge docs).
- Pitfalls: MEDIUM-HIGH — №1, №2 верифицированы через прямое чтение шаблона react-ts;
  №3 (ESM/CJS) известная проблема electron-store v10+, документирована; №4-9 — стандартный
  набор Electron-граблей, верифицирован через official docs.
- IPC contract pattern: HIGH — стандартный паттерн official tutorial, адаптирован под
  D-08/D-09/D-10.
- Validation architecture: MEDIUM — Vitest предлагается по совокупности признаков (см. A3).

**Research date:** 2026-05-28
**Valid until:** 2026-06-28 (30 дней — стабильный стек, изменения маловероятны).
