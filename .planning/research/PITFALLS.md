# Pitfalls Research

**Domain:** Cross-platform Electron desktop app — media transcription (ffmpeg + Whisper/cloud STT) + configurable LLM analysis
**Researched:** 2026-05-27
**Confidence:** HIGH (Electron packaging, native modules, ffmpeg, notarization, API-key security verified against official docs + ecosystem); MEDIUM (Whisper Russian/long-audio behavior verified via research papers + multiple reports); MEDIUM (OpenAI-compatible endpoint quirks — verified for OpenAI, generalized to compatible providers)

## Critical Pitfalls

### Pitfall 1: ffmpeg / Whisper binaries packaged inside asar, unreachable at runtime

**What goes wrong:**
App works perfectly in `npm run dev` but in the packaged build, spawning ffmpeg fails with `ENOENT` / "file not found". `require('ffmpeg-static')` returns a path like `.../app.asar/node_modules/ffmpeg-static/ffmpeg.exe` — but you cannot execute a binary from inside the asar archive (it is a virtual filesystem, not real files on disk). Same problem for whisper.cpp `.node` addons and downloaded model files.

**Why it happens:**
Electron bundles `node_modules` into `app.asar`. Node's `fs` reads through the asar shim transparently, so developers assume everything inside is "real," but `child_process.spawn()` and native binary loaders hit the real OS filesystem, where the file does not exist as an extractable path. This is the single most common packaging failure for media-processing Electron apps.

**How to avoid:**
- Mark binaries/native addons as `asarUnpack` (electron-builder) / unpacked resources (Forge). Configure to unpack only the current platform+arch binary, not all of them, to control bundle size.
- At runtime, resolve the executable path then `.replace('app.asar', 'app.asar.unpacked')`. Do this resolution in the **main process only** (renderer/webpack mangles paths).
- Consider a small helper such as `ffmpeg-static-electron-forge` that handles dev-vs-prod path swapping automatically.
- Add a smoke test that spawns `ffmpeg -version` and loads the Whisper addon **from a packaged build**, not just from dev.

**Warning signs:**
Path strings containing `app.asar/` (not `app.asar.unpacked/`); works in dev but not after `electron-builder`; tester reports "nothing happens when I pick a file."

**Phase to address:** Packaging/distribution phase — but verify with a packaged-build smoke test as soon as ffmpeg is first integrated, not at the end.

---

### Pitfall 2: Native Whisper addon built against wrong ABI (Node vs Electron) and wrong platform/arch

**What goes wrong:**
whisper.cpp Node bindings (a native `.node` addon) compiled against the system Node fail to load inside Electron with errors like `NODE_MODULE_VERSION mismatch` or a silent crash. Or: you build on your Mac (arm64) and the Windows/Linux/x64 users get a binary that segfaults or won't load. GPU-enabled builds (CUDA/Metal/Vulkan) fail on machines without that runtime.

**Why it happens:**
Electron ships a different V8/ABI than system Node, so addons must be rebuilt against Electron's headers. A native addon is platform- AND arch-specific (win-x64, linux-x64, linux-arm64, mac-x64, mac-arm64) — a single build does not cover all targets. GPU acceleration adds a hard dependency on drivers the end user may not have.

**How to avoid:**
- Prefer a binding that ships **prebuilt binaries for all target triples** with runtime OS/arch detection (e.g. whisper-node-addon style, or ChetanXpro/nodejs-whisper for a more managed path). When using prebuilds in Electron, do **not** pass `--build-from-source` / `npm_config_build_from_source`.
- If building from source, use `@electron/rebuild` (or cmake-js with Electron headers) and build per-target in CI matrix runners (you cannot cross-compile native addons reliably from one host).
- **Default to CPU inference for v1.** GPU is an opt-in optimization, not a baseline assumption — most users won't have a usable GPU runtime and CPU "just works."

**Warning signs:**
`NODE_MODULE_VERSION` errors; addon loads in dev (system Node) but not in packaged Electron; works on your dev machine's OS only; crash only on Apple Silicon or only on Intel.

**Phase to address:** Local-Whisper integration phase. Set up the CI build matrix the moment native modules enter the project.

---

### Pitfall 3: API keys exposed in the renderer process

**What goes wrong:**
LLM/cloud-STT API keys end up readable in the renderer — embedded in renderer JS, stored in `localStorage`, or sent to the cloud API directly from renderer code. Because Electron apps are just unpacked JS on disk, anyone can open DevTools or unzip the asar and read the key. A leaked configurable-endpoint key can rack up real cloud spend.

**Why it happens:**
Convenience: it's easy to `fetch()` the API straight from the React/renderer side. Developers treat the renderer like a trusted backend, but it is effectively client-side code shipped to the user.

**How to avoid:**
- All secret handling and all outbound API calls live in the **main process**. The renderer requests an action over IPC ("transcribe this", "analyze this"); the main process holds the key and makes the network call.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (these are the modern defaults — do not turn them off). Expose a **narrow, explicit** API via `contextBridge` in a preload script; never expose `ipcRenderer` raw.
- Store the key with OS-level protection (`safeStorage` / OS keychain) rather than plaintext config. At minimum keep it out of renderer-accessible storage.
- Note: this is a local single-user app, so the threat model is mostly "key leaking off the machine / into logs," not multi-tenant — but main-process isolation is still the correct, cheap baseline.

**Warning signs:**
`fetch` to an LLM endpoint inside renderer code; key visible in DevTools Network/Sources; `nodeIntegration: true`; key in `localStorage` or a JSON file in the app bundle.

**Phase to address:** Foundation/architecture phase (set the main-vs-renderer boundary before any API integration). Verify again in the cloud-API phase.

---

### Pitfall 4: Long jobs block the UI / the renderer freezes

**What goes wrong:**
ffmpeg transcoding, local Whisper inference, and LLM calls on a long recording take minutes. If they run on the main thread or synchronously, the window freezes, the OS shows "Application not responding," and there is no progress feedback. Users assume the app crashed and force-quit mid-job.

**Why it happens:**
Naive implementation runs heavy work in-line. Even when offloaded, developers often forget that synchronous IPC (`ipcRenderer.sendSync`) and large synchronous reads block. Whisper CPU inference is genuinely long-running (can exceed real-time on big models).

**How to avoid:**
- Run ffmpeg and Whisper as **child processes / async spawns** in the main process; stream stdout/stderr to parse progress (ffmpeg emits time progress; whisper.cpp emits segment progress).
- Use **async IPC** + event-based progress updates back to the renderer. Never `sendSync` for long work.
- Show real progress (percent or elapsed/segment count), and provide a **cancel** that actually kills the child process and frees resources.
- Consider a utility process / worker for the orchestration so the main process stays responsive.

**Warning signs:**
Spinning beachball / "Not Responding"; progress bar that jumps 0→100 with nothing in between; cancel button that doesn't stop the work; `sendSync` in code.

**Phase to address:** Pipeline-orchestration phase (the job-runner that wires ffmpeg → STT → LLM). Bake in progress + cancel from the start.

---

### Pitfall 5: Long audio breaks the cloud STT 25 MB / duration limit — and naive chunking corrupts the transcript

**What goes wrong:**
Cloud transcription (OpenAI Whisper-1 and compatible) rejects files over **25 MiB**, and newer `gpt-4o-transcribe`-style routes additionally cap **audio duration (~1500s / 25 min)**. A 1–2 hour MP4 sails past both. Worse: when developers chunk to get under the limit, they cut at fixed time offsets mid-word, producing duplicated or dropped words at every boundary and garbled context.

**Why it happens:**
The limit is on **file bytes, not duration** for legacy Whisper, but **duration** for newer models — two different ceilings that surprise people. Fixed-interval splitting ignores speech boundaries.

**How to avoid:**
- Detect the input length up front and route appropriately. For cloud STT, **compress/downsample** with ffmpeg (mono, 16 kHz, low-bitrate Opus/MP3) to fit more audio under 25 MB before deciding to chunk.
- When chunking is required, split on **silence / low-activity regions** (VAD or ffmpeg `silencedetect`), not fixed offsets, and overlap slightly to stitch cleanly.
- Local Whisper avoids the hard size limit but has its own long-form drift (see Pitfall 6) — long files still need chunking there too.
- Surface the limit to the user proactively rather than failing with a raw API error.

**Warning signs:**
HTTP 413 / "file too large" / "audio too long" errors; duplicated or missing words at regular intervals in the transcript; works on short test clips only.

**Phase to address:** Transcription pipeline phase; chunking strategy is a first-class design item, not an afterthought.

---

### Pitfall 6: Whisper hallucination & repetition on silence, noise, and long-form audio (Russian)

**What goes wrong:**
Whisper invents text that was never spoken — entire phrases, looping repetitions, or filler ("так", "ага", "so") during silence, music, applause, or noisy segments. On long-form audio, buffered/sliding-window decoding drifts and repeats. Roughly ~1% of segments can contain fully hallucinated content; non-speech segments are far worse. Russian is well-supported by Whisper multilingual but is not English-grade, and domain terms / names / numbers degrade further.

**Why it happens:**
Whisper was trained to always produce text and misreads non-speech as speech; long-context decoding accumulates errors. Quality varies by language and by audio quality.

**How to avoid:**
- Run **VAD first**, feed only speech regions, and merge ~30s chunks at low-activity boundaries (the WhisperX-style approach) — this directly reduces drift and hallucination.
- Set `language=ru` explicitly (don't rely on auto-detect for mixed/quiet audio); pass an `initial_prompt`/context hint with expected domain vocabulary when supported.
- Choose model size deliberately: `large-v3` is most accurate for Russian but slow on CPU and big to download; smaller models hallucinate more. Make the model configurable and document the tradeoff.
- Always retain the **original audio** and present the transcript as machine output that may contain errors — never as ground truth (especially important since the downstream LLM analysis will amplify any transcription error).

**Warning signs:**
Looping/duplicated sentences; plausible text during known-silent sections; the same filler word repeated; nonsense that the user "never said."

**Phase to address:** Transcription-quality phase. VAD + language config + model selection should be explicit features, not defaults left to the library.

---

### Pitfall 7: macOS code-signing / notarization failures — especially because of the bundled binaries

**What goes wrong:**
The macOS build runs on the dev machine but on any other Mac, Gatekeeper blocks it ("app is damaged / from an unidentified developer"), or notarization is rejected. Frequently the cause is the **unsigned bundled ffmpeg/whisper binaries and `.node` addons** — Apple requires every executable inside the bundle to be signed, not just the `.app`.

**Why it happens:**
Notarization is mandatory for distribution outside the App Store since Catalina, and requires Hardened Runtime. Developers sign the app but forget the nested third-party binaries. Hardened Runtime can also block native code that needs JIT/unsigned memory without the right entitlements.

**How to avoid:**
- Sign **all** nested executables (ffmpeg, whisper binaries, `.node` addons), then sign and notarize the app. electron-builder + `@electron/notarize` handle this if `asarUnpack` and signing are configured correctly.
- `hardenedRuntime: true` (default). Add `com.apple.security.cs.allow-jit` if the native code needs JIT; on Electron 12+ avoid `allow-unsigned-executable-memory` (it widens attack surface and is generally unnecessary on modern Electron).
- Build/sign/notarize in **CI on a real macOS runner**; test the notarized build on a clean Mac (or after stripping the quarantine attribute is NOT a valid test — test as a downloaded artifact).
- Budget for an Apple Developer account ($99/yr) and the multi-step credential setup early — it is a long-tail blocker.

**Warning signs:**
"App is damaged and can't be opened"; notarization log lists unsigned binaries; works only on the build machine; crash on launch on other Macs due to Hardened Runtime.

**Phase to address:** Distribution phase. Flag early as a known long-pole; do not leave the first notarization attempt until release week.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| API calls from renderer directly | Fast to wire up | Key leakage, rearchitecture later, sandbox off | Never — set the main/renderer boundary on day one |
| Fixed-offset audio chunking | Trivial to implement | Garbled boundaries, duplicated/lost words | Never for production; only a throwaway spike |
| Bundle ffmpeg/whisper for all platforms+archs | One build config | Bloated installer (hundreds of MB) | Acceptable short-term; trim with per-target unpack before release |
| Skip VAD, feed raw long audio to Whisper | Less code | Hallucination/repetition, user distrust | Only for short clean clips in early demos |
| Synchronous IPC for job results | Simple control flow | UI freeze on long jobs | Never for the transcription/LLM jobs |
| Defer macOS notarization to "later" | Ship Win/Linux faster | Surprise multi-day blocker at release | Acceptable only if mac distribution is explicitly post-v1 |
| Plaintext API key in config JSON | No keychain code | Key readable on disk / in backups | MVP-only with a clear hardening follow-up ticket |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| ffmpeg-static | Using returned path verbatim (points into asar) | Resolve in main process, `.replace('app.asar','app.asar.unpacked')`, mark `asarUnpack` |
| whisper.cpp Node addon | Building against system Node ABI / single platform | Prebuilt-per-target binding or `@electron/rebuild` in a CI matrix; CPU default |
| OpenAI-compatible LLM endpoint | Assuming all providers honor the same params | Make **base URL, model, and key configurable**; don't hardcode `api.openai.com`; tolerate missing/extra fields |
| OpenAI-compatible streaming (SSE) | Assuming every provider streams identically / supports it | Treat streaming as optional; handle `data: [DONE]`, partial chunks, and non-streaming fallback |
| Cloud STT upload | Sending raw 1-hour file | Pre-compress with ffmpeg; check 25 MB / duration cap before upload |
| LLM context window | Pasting an entire long transcript into one prompt | Count tokens; chunk/summarize-then-combine (map-reduce) for transcripts that exceed context |
| Whisper model download | Bundling the model in the installer | Download on first use, show progress, verify checksum, allow re-download on corruption |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Whisper inference on main thread | UI freeze, "Not Responding" | Child process + async IPC + progress | Any file beyond a few minutes |
| Loading whole audio/transcript into memory | RAM spike, crash on large files | Stream via ffmpeg; process in chunks | Long recordings (hours) / large WAV |
| No request timeout on cloud calls | App hangs indefinitely on a stalled API | Set timeouts + retry-with-backoff | Flaky network or slow provider |
| Re-running ffmpeg/Whisper with no caching | Repeated long waits on same file | Cache intermediate audio + transcript by file hash | As soon as a user retries a file |
| Reloading large model per job | Slow start each run | Keep model warm for the session | Multiple sequential files |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key in renderer / localStorage / bundle | Key theft, runaway cloud cost | Key + network in main process; `safeStorage`/keychain |
| `nodeIntegration: true` / `contextIsolation: false` | RCE if any rendered content is compromised | Keep modern secure defaults; sandbox on |
| Exposing raw `ipcRenderer` via preload | Renderer can invoke arbitrary main handlers | Expose a narrow, explicit `contextBridge` API |
| Logging full transcripts / keys to disk or console | Sensitive content/secrets leak into logs | Redact keys; make transcript logging opt-in |
| Loading remote code/content into a window | Classic Electron RCE vector | Local files only; no remote `<script>` with Node access |
| No checksum on downloaded Whisper model | Tampered/corrupt model | Verify hash after download |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress for multi-minute jobs | User thinks app froze, force-quits | Real per-stage progress (ffmpeg %, whisper segments, LLM streaming) |
| No cancel, or cancel that doesn't kill the process | Stuck waiting, wasted compute | Cancel that kills child process and cleans temp files |
| Presenting transcript as authoritative | User trusts hallucinated text | Label as machine output; keep original audio accessible |
| Cryptic provider error passthrough ("413", "rate_limit_exceeded") | Confusion, no recovery path | Map errors to plain language + suggested action |
| Silent failure when model not yet downloaded | "Nothing happens" on first run | First-run model download with clear progress/size warning |
| No indication of expected cost/time for cloud STT/LLM | Bill shock, abandonment | Show estimated duration/cost before a long cloud job |

## "Looks Done But Isn't" Checklist

- [ ] **ffmpeg/Whisper integration:** Verify by running a **packaged** build on a clean machine, not just `npm run dev` — asar-unpack and path resolution only fail in production.
- [ ] **Cross-platform native module:** Verify the prebuilt/rebuilt addon loads on win-x64, linux-x64/arm64, mac-x64, **and** mac-arm64 — not only the dev host.
- [ ] **Long audio:** Verify with a real 1–2 hour Russian recording — chunking, memory, timeouts, and boundary stitching only break at length.
- [ ] **Cancellation:** Verify cancel actually kills the ffmpeg/whisper child process and deletes temp files (not just hides the UI).
- [ ] **API key security:** Verify the key is **not** present anywhere reachable from the renderer (DevTools, localStorage, unpacked asar).
- [ ] **macOS distribution:** Verify the **notarized, downloaded** artifact launches on a second Mac — including nested-binary signing.
- [ ] **OpenAI-compatible endpoint:** Verify against at least one non-OpenAI compatible provider (different base URL/model) to catch hardcoded assumptions.
- [ ] **LLM long transcript:** Verify a transcript that exceeds the model context window is handled (chunked), not silently truncated.
- [ ] **Bundle size:** Verify the installer only ships the current platform's ffmpeg/whisper binaries, not all targets.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| asar path / binary not found | LOW | Add `asarUnpack` + path `.replace`; rebuild; re-test packaged |
| Wrong native ABI/arch | MEDIUM | Switch to prebuilt binding or add `@electron/rebuild` + CI matrix |
| API key in renderer | MEDIUM | Move secret + network to main process; rotate the leaked key |
| UI freeze on long jobs | MEDIUM | Move work to child process; convert to async IPC + progress |
| Garbled chunked transcript | MEDIUM | Re-implement silence/VAD-based splitting with overlap |
| Whisper hallucination | MEDIUM | Add VAD pre-filtering; set language; allow larger model |
| macOS notarization rejected | HIGH | Sign all nested binaries, fix entitlements, re-notarize via CI on real macOS |
| Bundle too large | LOW | Per-target unpack; download model at runtime instead of bundling |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| API keys in renderer | Foundation / architecture (process boundary) | No key reachable from renderer; sandbox + contextIsolation on |
| ffmpeg in asar | ffmpeg integration + packaging | `ffmpeg -version` runs from a packaged build |
| Native Whisper ABI/arch | Local-Whisper integration | Addon loads on all 5 target triples via CI matrix |
| UI freeze on long jobs | Pipeline orchestration | 1-hour file processes with live progress + working cancel |
| Cloud STT size/duration limit | Transcription pipeline | Long file routed via compression/chunking, no 413/duration error |
| Whisper hallucination (Russian/long) | Transcription quality | VAD + `language=ru`; clean transcript on noisy/long sample |
| LLM context overflow | LLM analysis phase | Over-context transcript chunked, not truncated |
| OpenAI-compatible quirks | LLM analysis phase | Works against a second compatible provider |
| macOS notarization | Distribution | Notarized download launches on a clean second Mac |
| Bundle size | Distribution | Installer ships only current-target binaries |

## Sources

- [Native Node Modules | Electron](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) — HIGH
- [Native Code and Electron | Electron](https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron) — HIGH
- [Security | Electron](https://www.electronjs.org/docs/latest/tutorial/security) — HIGH
- [Context Isolation | Electron](https://www.electronjs.org/docs/latest/tutorial/context-isolation) — HIGH
- [contextBridge | Electron](https://www.electronjs.org/docs/latest/api/context-bridge) — HIGH
- [Process Sandboxing | Electron](https://www.electronjs.org/docs/latest/tutorial/sandbox) — HIGH
- [macOS | electron-builder](https://www.electron.build/docs/mac/) — HIGH
- [electron/notarize](https://github.com/electron/notarize) — HIGH
- [Notarizing your Electron application | Kilian Valkhof](https://kilianvalkhof.com/2019/electron/notarizing-your-electron-application/) — MEDIUM
- [The pain of publishing Electron apps on macOS | Fora Soft](https://forasoft.medium.com/the-pain-of-publishing-electron-apps-on-macos-996cb6f8f363) — MEDIUM
- [Include FFMPEG Binaries in your Electron App | Alexander Cleasby](https://alexandercleasby.dev/blog/use-ffmpeg-electron) — MEDIUM
- [Allow ASAR to work with child_process.spawn() · electron#9459](https://github.com/electron/electron/issues/9459) — MEDIUM
- [ffmpeg-static-electron-forge | npm](https://www.npmjs.com/package/ffmpeg-static-electron-forge/v/1.1.6) — MEDIUM
- [whisper-node-addon | npm](https://www.npmjs.com/package/whisper-node-addon) — MEDIUM
- [Kutalia/whisper-node-addon (cross-platform prebuilt bindings)](https://github.com/Kutalia/whisper-node-addon) — MEDIUM
- [OpenAI Audio API FAQ](https://help.openai.com/en/articles/7031512-audio-api-faq) — HIGH
- [OpenAI Whisper API Limits 2026 | TranscribeTube](https://www.transcribetube.com/blog/openai-whisper-api-limits) — MEDIUM
- [Gpt-4o-transcribe audio length limits | OpenAI Community](https://community.openai.com/t/gpt-4o-transcribe-audio-length-limits/1148374) — MEDIUM
- [WhisperX: Time-Accurate Transcription of Long-Form Audio (arXiv)](https://arxiv.org/pdf/2303.00747) — HIGH (method)
- [Investigation of Whisper ASR Hallucinations Induced by Non-Speech Audio (arXiv)](https://arxiv.org/html/2501.11378v1) — HIGH (findings)
- [Calm-Whisper: Reduce Whisper Hallucination on Non-Speech (arXiv)](https://arxiv.org/html/2505.12969v1) — MEDIUM
- [OpenAI Whisper makes up words | Healthcare Brew](https://www.healthcare-brew.com/stories/2024/11/18/openai-transcription-tool-whisper-hallucinations) — MEDIUM
- [Pisets: Robust Speech Recognition for Lectures/Interviews (arXiv, Russian-focused)](https://arxiv.org/pdf/2601.18415) — MEDIUM

---
*Pitfalls research for: cross-platform Electron transcription + LLM analysis app*
*Researched: 2026-05-27*
