# Architecture Research

**Domain:** Cross-platform Electron desktop transcription + LLM analysis app
**Researched:** 2026-05-27
**Confidence:** HIGH (Electron process model, IPC, safeStorage, ffmpeg bundling verified against official docs; provider abstraction is a well-established community pattern)

## Standard Architecture

This is a classic Electron "three-tier process" app with two long-running heavy jobs (ffmpeg extraction, local Whisper) that must NOT block either the UI or the main process. The recommended model: thin renderer (UI), thin main (orchestrator + window + secrets), and dedicated **utilityProcess** workers for heavy work.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                      RENDERER PROCESS (Chromium)                       │
│   React/Vue UI · file picker · progress bars · settings · prompt lib   │
│   NO Node access. Talks only through window.api (preload bridge).      │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │  contextBridge + ipcRenderer.invoke
                                 │  ipcRenderer.on('job:progress', ...)
┌───────────────────────────────┴────────────────────────────────────────┐
│                          PRELOAD (isolated bridge)                       │
│   Exposes typed, allow-listed API surface. contextIsolation: true.       │
└───────────────────────────────┬────────────────────────────────────────┘
                                 │  ipcMain.handle(...) / webContents.send
┌───────────────────────────────┴────────────────────────────────────────┐
│                            MAIN PROCESS (Node)                           │
│  Orchestrator (job state machine) · BrowserWindow · dialogs · menus      │
│  Config store (electron-store) · Secret vault (safeStorage)              │
│  Provider registry · spawns + supervises utility processes               │
└──────┬────────────────────┬────────────────────────┬────────────────────┘
       │ utilityProcess.fork │ utilityProcess.fork     │ HTTPS (fetch)
┌──────┴──────────┐  ┌───────┴──────────────┐  ┌───────┴───────────────────┐
│ FFMPEG WORKER   │  │ WHISPER WORKER       │  │ Cloud APIs (in main)       │
│ spawn(ffmpeg)   │  │ spawn(whisper.cpp)   │  │ OpenAI transcribe / LLMs   │
│ mp4 → wav 16kHz │  │ wav → text segments  │  │ OpenAI-compatible endpoints│
│ parse -progress │  │ parse stdout         │  │                            │
└─────────────────┘  └──────────────────────┘  └────────────────────────────┘
       │                     │
┌──────┴─────────────────────┴────────────────────────────────────────────┐
│                              FILE SYSTEM                                  │
│  source.mp4 · temp/*.wav (cleaned up) · transcript.md · analysis.md       │
│  userData/: config.json · secrets (encrypted) · prompts library          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Renderer (UI) | Display state, capture user intent, render progress/results. No business logic, no fs, no secrets. | React/Vue + Vite; subscribes to job events |
| Preload bridge | Expose a minimal, typed, allow-listed `window.api`. The ONLY channel renderer↔main. | `contextBridge.exposeInMainWorld` + `ipcRenderer` |
| Main (Orchestrator) | Drive the pipeline state machine (extract→transcribe→analyze), own windows/dialogs, route IPC, supervise workers. | `app`, `BrowserWindow`, `ipcMain.handle` |
| Config store | Persist non-secret settings (chosen provider, model, paths, last-used prompt). | `electron-store` (JSON in userData) |
| Secret vault | Encrypt/decrypt API keys at rest. | `safeStorage` + encrypted blob in electron-store |
| Transcription providers | Common interface; local (whisper.cpp) and cloud (OpenAI) implementations. | Strategy pattern behind `TranscriptionProvider` |
| LLM providers | Common interface; presets (OpenAI/Claude/Gemini) + custom OpenAI-compatible. | Strategy pattern behind `LlmProvider` |
| ffmpeg worker | Extract/normalize audio from mp4 to 16kHz mono wav; emit progress. | `utilityProcess` → `child_process.spawn('ffmpeg')` |
| Whisper worker | Run local transcription; emit segment/progress. | `utilityProcess` → `spawn(whisper-cli)` |

## Recommended Project Structure

```
scrubber/
├── electron.vite.config.ts      # three build targets: main / preload / renderer
├── src/
│   ├── main/                     # MAIN PROCESS (Node)
│   │   ├── index.ts              # app lifecycle, window creation
│   │   ├── ipc/                  # ipcMain.handle registrations (one file per domain)
│   │   │   ├── transcription.ts
│   │   │   ├── analysis.ts
│   │   │   ├── settings.ts
│   │   │   └── files.ts
│   │   ├── orchestrator/         # pipeline state machine, job lifecycle
│   │   │   └── job.ts
│   │   ├── workers/              # entry scripts run via utilityProcess.fork
│   │   │   ├── ffmpeg.worker.ts  # spawns ffmpeg, parses -progress pipe:1
│   │   │   └── whisper.worker.ts # spawns whisper-cli, parses stdout
│   │   ├── providers/
│   │   │   ├── transcription/
│   │   │   │   ├── types.ts       # TranscriptionProvider interface
│   │   │   │   ├── local-whisper.ts
│   │   │   │   ├── openai-cloud.ts
│   │   │   │   └── registry.ts
│   │   │   └── llm/
│   │   │       ├── types.ts       # LlmProvider interface
│   │   │       ├── openai-compatible.ts  # covers OpenAI + custom + Ollama
│   │   │       ├── anthropic.ts          # Claude (Messages API)
│   │   │       ├── gemini.ts
│   │   │       ├── presets.ts            # baseURL/model defaults per preset
│   │   │       └── registry.ts
│   │   ├── config/
│   │   │   ├── store.ts           # electron-store schema + accessors
│   │   │   └── secrets.ts         # safeStorage encrypt/decrypt wrappers
│   │   └── fs/
│   │       ├── paths.ts           # temp dir, output naming
│   │       └── markdown.ts        # transcript/analysis .md writers
│   ├── preload/
│   │   └── index.ts               # contextBridge: window.api surface
│   ├── renderer/                  # RENDERER (browser context)
│   │   ├── App.tsx
│   │   ├── views/                 # Transcribe, Analyze, Settings, Prompts
│   │   ├── state/                 # store subscribing to job events
│   │   └── api.ts                 # typed wrapper over window.api
│   └── shared/                    # types shared across processes (IPC contracts)
│       └── ipc-contract.ts        # channel names, payload/result types, ProgressEvent
└── resources/                     # bundled binaries (asarUnpack / extraResources)
    └── bin/{win32,darwin,linux}/  # ffmpeg, whisper-cli per platform/arch
```

### Structure Rationale

- **`src/main/workers/` separate from providers:** workers are process entry points; providers are pure logic. The `local-whisper` provider *asks the orchestrator to fork* the whisper worker — it doesn't spawn directly. Keeps providers testable.
- **`src/shared/ipc-contract.ts`:** single source of truth for channel names and payload types. Both preload and renderer import it. Prevents string-typo IPC bugs and gives end-to-end typing.
- **`providers/llm/openai-compatible.ts` does triple duty:** OpenAI preset, custom endpoint, and local LLMs (Ollama/LM Studio) all speak the OpenAI Chat Completions shape — one implementation, different `baseURL`/`apiKey`/`model`. Only Claude and Gemini need bespoke adapters.
- **`resources/bin/`:** binaries live outside `node_modules` so packaging via `extraResources` is predictable and asar-safe.

## Architectural Patterns

### Pattern 1: utilityProcess for heavy work (NOT main, NOT renderer)

**What:** Run ffmpeg and local Whisper in `utilityProcess.fork()` children supervised by main. The worker uses `child_process.spawn` for the actual native binary and streams progress back.
**When to use:** Any CPU-heavy or crash-prone task. Whisper can run minutes and may OOM; ffmpeg is CPU-bound. Isolating them means a crash kills only the worker, not the app.
**Trade-offs:** Slightly more wiring than spawning in main. But `utilityProcess` is Electron's officially recommended replacement for `child_process.fork` for this purpose, integrates with the app lifecycle, and can hold a `MessagePort` directly to the renderer if you want to bypass main for high-frequency progress. (HIGH — official docs.)

**Example:**
```typescript
// main/orchestrator/job.ts
import { utilityProcess, MessageChannelMain } from 'electron'
const child = utilityProcess.fork(workerPath, [], { serviceName: 'whisper' })
child.on('message', (msg) => {
  if (msg.type === 'progress') win.webContents.send('job:progress', msg)
})
child.postMessage({ type: 'start', wavPath, model })
child.on('exit', (code) => { /* resolve/reject job */ })
```
Inside the worker: `process.parentPort.on('message', ...)` then `const p = spawn(whisperBin, args)` and parse `p.stdout`.

### Pattern 2: contextIsolation + allow-listed preload bridge

**What:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Renderer never touches Node/fs/secrets; it calls `window.api.transcribe(opts)` which is an allow-listed `ipcRenderer.invoke`.
**When to use:** Always — this is the Electron security baseline. Especially important here: the app handles file paths, spawns binaries, and holds API keys.
**Trade-offs:** Every capability must be explicitly exposed (more boilerplate). That explicitness IS the security benefit. (HIGH — official Electron security guidance.)

**Example:**
```typescript
// preload/index.ts
contextBridge.exposeInMainWorld('api', {
  pickVideo: () => ipcRenderer.invoke('files:pickVideo'),
  transcribe: (opts) => ipcRenderer.invoke('transcription:run', opts),
  onProgress: (cb) => ipcRenderer.on('job:progress', (_e, p) => cb(p)),
})
```

### Pattern 3: Provider Strategy + Registry

**What:** Define `TranscriptionProvider` and `LlmProvider` interfaces. Each concrete provider implements it. A registry maps an id (`'local-whisper'`, `'openai'`, `'claude'`, `'custom'`) to a factory. The orchestrator depends only on the interface.
**When to use:** Whenever you have interchangeable backends selected at runtime by config. Exactly the project's "local OR cloud" and "preset + custom endpoint" requirements.
**Trade-offs:** A little indirection up front. Pays off immediately because adding a provider = one file + one registry entry, no orchestrator changes.

**Example:**
```typescript
// providers/transcription/types.ts
export interface TranscriptionProvider {
  id: string
  transcribe(input: { audioPath: string; language?: string },
             onProgress: (p: ProgressEvent) => void): Promise<TranscriptResult>
}

// providers/llm/types.ts
export interface LlmProvider {
  id: string
  analyze(input: { systemPrompt: string; transcript: string },
          onToken?: (t: string) => void): Promise<string>
}
```
For LLMs, `openai-compatible.ts` takes `{ baseURL, apiKey, model }` so OpenAI, a custom endpoint, and Ollama are all the same class with different config. Claude (Messages API) and Gemini get their own adapters but expose the identical `LlmProvider` interface.

### Pattern 4: Secrets via safeStorage, settings via electron-store

**What:** Non-secret config (selected provider, model, output dir, last prompt) → `electron-store` plaintext JSON. API keys → `safeStorage.encryptString()`, store the resulting base64 blob in electron-store; decrypt only in main, in memory, at call time.
**When to use:** Always for API keys. `keytar` is unmaintained (since Dec 2022) — `safeStorage` is the current standard, no native module to compile.
**Trade-offs:** On Linux without an available keyring (kwallet/gnome-libsecret), safeStorage falls back to a hardcoded-key encryption (effectively obfuscation). Detect this and warn the user. (HIGH — official docs; confirmed by VS Code's keytar→safeStorage migration.)

## Data Flow

### Request Flow (full pipeline)

```
[User picks mp4 + provider + (later) prompt]
    ↓ window.api.transcribe()  (renderer → preload → ipcMain.invoke)
[Main: Orchestrator creates Job, state=EXTRACTING]
    ↓ utilityProcess.fork(ffmpeg.worker)
[ffmpeg worker: spawn ffmpeg, mp4 → temp/audio.wav (16kHz mono)]
    ↑ {type:'progress', pct}  →  webContents.send('job:progress')  →  UI bar
[Main: state=TRANSCRIBING]
    ↓ TranscriptionProvider.transcribe()
    ├─ local  → utilityProcess.fork(whisper.worker) → spawn whisper-cli → stdout segments
    └─ cloud  → fetch OpenAI audio/transcriptions (multipart upload)
    ↑ progress events → UI
[Main: write transcript.md → return path to renderer]  ← FIRST core deliverable

--- separate user action ---
[User selects system prompt + clicks Analyze]
    ↓ window.api.analyze({transcriptPath, promptId, providerId})
[Main: load prompt from library, read transcript.md]
    ↓ LlmProvider.analyze()  → fetch (streamed tokens optional)
    ↑ {type:'token'} → UI live render
[Main: write analysis.md → return path]
```

### State Management

```
Main owns the authoritative Job state machine:
  IDLE → EXTRACTING → TRANSCRIBING → TRANSCRIBED → ANALYZING → DONE
                  ↘ ERROR (any step) ↗
Renderer holds a *mirror* updated via 'job:progress'/'job:state' events.
Renderer never mutates job state directly — it only sends commands (invoke)
and receives state pushes (on). One-way authority, predictable UI.
```

### Key Data Flows

1. **Progress:** worker → (postMessage) → main → (webContents.send) → preload listener → renderer store → progress bar. High-frequency; keep payloads tiny (`{jobId, stage, pct}`).
2. **Secrets:** never cross to renderer. Renderer sends only a provider id; main resolves the decrypted key in-process at call time.
3. **Temp files:** ffmpeg writes wav to OS temp dir; main deletes it after transcription (success or fail). Final .md files written to a user-chosen output dir.

## Scaling Considerations

This is a single-user, one-file-at-a-time desktop app. "Scale" = larger files / longer audio, not concurrent users.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Short clips (<10 min) | Default — everything as designed works fine |
| Long audio (1h+) | Chunk audio for cloud (OpenAI ~25MB upload limit); whisper.cpp handles long files but slowly — stream segment progress so UI isn't frozen-looking |
| Large transcripts → LLM | Watch model context limits; warn/truncate or note chunking as a future feature (out of scope v1) |

### Scaling Priorities

1. **First bottleneck:** Local Whisper speed/memory on the user's machine. Mitigation: let user pick model size (tiny→large) per the project's resource concern; default to a balanced model good for Russian (e.g. `large-v3`/`medium` tradeoff — confirm in STACK research).
2. **Second bottleneck:** Cloud upload size limit. Mitigation: pre-check wav size; chunk if needed (defer to post-v1 unless trivial).

## Anti-Patterns

### Anti-Pattern 1: Spawning ffmpeg/Whisper directly in the main process

**What people do:** Call `child_process.spawn` from `main/index.ts` and `await` it.
**Why it's wrong:** Even though spawn is async, heavy native work + frequent stdout parsing on the main thread starves IPC and can jank the whole app; a binary crash can destabilize main. There are reported cases of `child_process.spawn` blocking for hundreds of ms on signed macOS apps.
**Do this instead:** Run the binary inside a `utilityProcess` worker; main only supervises and routes messages.

### Anti-Pattern 2: Enabling nodeIntegration / disabling contextIsolation to "make fs easier"

**What people do:** Turn on `nodeIntegration: true` so the renderer can read files / call APIs directly.
**Why it's wrong:** Any XSS or compromised dependency in the renderer then has full Node/fs/network access — and this app holds API keys and runs binaries. Catastrophic blast radius.
**Do this instead:** Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; route everything through the allow-listed preload bridge.

### Anti-Pattern 3: Storing API keys in electron-store plaintext (or in renderer/localStorage)

**What people do:** Save the key as a normal setting because it's convenient.
**Why it's wrong:** electron-store is plaintext JSON on disk; localStorage is plaintext in the renderer profile. Trivially exfiltrated.
**Do this instead:** `safeStorage.encryptString` the key, store the blob, decrypt only in main at request time. Detect Linux no-keyring fallback and warn.

### Anti-Pattern 4: Per-provider branching scattered through the orchestrator

**What people do:** `if (provider === 'openai') {...} else if (provider === 'claude') {...}` repeated across the codebase.
**Why it's wrong:** Adding/changing a provider means hunting conditionals everywhere; impossible to test in isolation.
**Do this instead:** Strategy + registry. Orchestrator calls `provider.transcribe()` / `provider.analyze()` and never knows which concrete provider it has.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| ffmpeg | Bundled binary via `ffmpeg-static`, spawned in worker | Bundle per-platform; use `asarUnpack` or `extraResources` so the binary path is real (not inside asar). Parse `-progress pipe:1` for percentage. |
| whisper.cpp (local) | Bundled `whisper-cli` + downloaded GGML model, spawned in worker | Models are large — download on demand to userData, don't bundle. Pure C++, no Python runtime to ship (key advantage over faster-whisper for Electron). |
| OpenAI transcription (cloud) | HTTPS `audio/transcriptions` multipart from main | ~25MB upload limit → may need chunking for long files. |
| LLM presets (OpenAI / Claude / Gemini) | OpenAI: Chat Completions; Claude: Messages API; Gemini: own SDK — all behind `LlmProvider` | OpenAI-compatible class also serves custom endpoints + Ollama/LM Studio via configurable baseURL. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| renderer ↔ main | `ipcRenderer.invoke` (commands) + `webContents.send` (events) via preload | Typed by shared `ipc-contract.ts`. Renderer is a pure consumer of state. |
| main ↔ workers | `utilityProcess` postMessage + `process.parentPort` | Optionally a direct `MessagePort` to renderer for high-frequency progress. |
| orchestrator ↔ providers | Direct in-process interface calls | Providers are the seam; everything else stays provider-agnostic. |

## Suggested Build Order (Component Dependencies)

Order chosen so the **core value (mp4 → transcript.md) is provable earliest**, and each step depends only on prior ones.

1. **App shell + secure baseline** — electron-vite scaffold (main/preload/renderer), contextIsolation on, shared `ipc-contract.ts`, a "pick file" round-trip. *Depends on: nothing.*
2. **ffmpeg worker** — bundle ffmpeg, utilityProcess worker, mp4 → wav with progress events to UI. *Depends on: 1.*
3. **Local transcription provider + whisper worker** — `TranscriptionProvider` interface, whisper.cpp worker, write transcript.md. **This is the core value milestone.** *Depends on: 1, 2.*
4. **Settings + secrets infra** — electron-store schema, safeStorage key vault, settings UI. *Depends on: 1.* (Can run parallel with 2–3, but cloud needs it.)
5. **Cloud transcription provider** — OpenAI implementation behind the same interface; provider selection in settings. *Depends on: 3 (interface), 4 (keys).*
6. **Prompt library** — named system prompts CRUD persisted via electron-store. *Depends on: 1, 4.*
7. **LLM provider abstraction + analysis** — `LlmProvider` interface, openai-compatible class, analyze flow, write analysis.md. *Depends on: 4, 6, and a transcript from 3/5.*
8. **Preset providers (Claude, Gemini) + custom endpoint** — additional adapters + custom endpoint config. *Depends on: 7.*
9. **Packaging / cross-platform** — electron-builder config, per-platform binary bundling (asarUnpack/extraResources), on-demand model download, Linux keyring detection. *Depends on: everything; validate continuously, finalize last.*

**Phase-structure implication:** the natural seam between "Transcription" (steps 1–5) and "Analysis" (steps 6–8) maps cleanly to two roadmap phases, with packaging (9) as a cross-cutting concern validated from the start and hardened at the end. The provider interfaces (steps 3 and 7) are the highest-leverage early investments.

## Sources

- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) (HIGH)
- [Electron utilityProcess API](https://www.electronjs.org/docs/latest/api/utility-process) (HIGH)
- [Electron Performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance) (HIGH)
- [child_process spawn blocking on signed macOS — electron#26143](https://github.com/electron/electron/issues/26143) (MEDIUM)
- [Electron safeStorage API](https://www.electronjs.org/docs/latest/api/safe-storage) (HIGH)
- [VS Code keytar → safeStorage migration #185677](https://github.com/microsoft/vscode/issues/185677) (HIGH)
- [Replacing keytar with safeStorage (Freek Van der Herten)](https://freek.dev/2103-replacing-keytar-with-electrons-safestorage-in-ray) (MEDIUM)
- [electron-vite build tooling](https://electron-vite.org/) (HIGH)
- [Electron Forge boilerplates/CLIs](https://www.electronjs.org/docs/latest/tutorial/boilerplates-and-clis) (HIGH)
- [Include FFmpeg binaries in Electron (asarUnpack/extraResources)](https://alexandercleasby.dev/blog/use-ffmpeg-electron) (MEDIUM)
- [ffmpeg-static npm](https://www.npmjs.com/package/ffmpeg-static) (MEDIUM)
- [whisper.cpp (ggml-org)](https://github.com/ggml-org/whisper.cpp) (HIGH)
- [faster-whisper (SYSTRAN)](https://github.com/SYSTRAN/faster-whisper) (HIGH)
- [Continue OpenAI adapters — provider abstraction](https://deepwiki.com/continuedev/continue/4.3-extension-activation-and-setup) (MEDIUM)
- [OpenRouter unified LLM API pattern](https://medium.com/@milesk_33/a-practical-guide-to-openrouter-unified-llm-apis-model-routing-and-real-world-use-d3c4c07ed170) (MEDIUM)

---
*Architecture research for: cross-platform Electron transcription + LLM analysis app*
*Researched: 2026-05-27*
