# Feature Research

**Domain:** Desktop video → transcript → LLM-analysis app (Electron, Russian-first audio)
**Researched:** 2026-05-27
**Confidence:** HIGH (closest analogs MacWhisper and Buzz directly verified; Russian Whisper quality verified; Electron key-storage verified)

## Feature Landscape

The competitive field splits into two families:
- **Local file transcribers** — Buzz (open-source, cross-platform, the closest analog), MacWhisper (macOS only, but the closest UX/feature analog incl. prompt library + transcript chat), Superwhisper, VoiceScriber. These take a file → transcript, run offline via whisper.cpp/faster-whisper, export TXT/SRT/VTT.
- **Cloud meeting note-takers** — Otter, Fireflies, Read.ai, Zoom AI. These auto-join meetings, do live transcription + speaker diarization + action items + integrations. Mostly irrelevant to v1 (cloud, real-time, SaaS), but they define user *expectations* for the analysis output (summaries, action items, decisions).

scrubber sits squarely in the first family with the analysis layer of the second. MacWhisper is the single best reference: file in → offline transcript → custom prompt library → chat/summarize with a connected LLM provider. That validates the entire scrubber concept as a proven product shape.

### Table Stakes (Users Expect These)

Missing these = product feels broken or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| File picker + drag-and-drop for mp4 | Every analog supports both; drag-drop is the default mental model | LOW | Electron native dialog + HTML5 drop zone. Validate extension/codec early. |
| ffmpeg audio extraction from mp4 | Whisper needs audio; user shouldn't pre-convert | MEDIUM | Bundle `ffmpeg-static` (avoids system-dependency hell across 3 OSes). Extract to 16 kHz mono WAV (Whisper's native input). |
| Whisper model size selection (tiny/base/small/medium/large-v3) | Buzz, MacWhisper all expose this; it's the core accuracy/speed/RAM tradeoff | MEDIUM | First-run model download with size + RAM hints. For Russian, default to `large-v3` or `medium`; smaller models degrade Russian noticeably. |
| Transcription progress feedback (% + elapsed/ETA + cancel) | Long files take minutes; a frozen UI reads as a crash | MEDIUM | Stream progress from the whisper backend (segment count / audio timestamp vs duration). Must have a Cancel button. |
| Local offline transcription (whisper.cpp / faster-whisper) | Core Value + privacy constraint; must work with zero network | HIGH | whisper.cpp = simplest cross-platform bundling (CPU + Vulkan/Metal GPU). faster-whisper = better speed/accuracy but Python/CTranslate2 dependency. This is the make-or-break feature. |
| Cloud transcription option (OpenAI Whisper API) | Explicit requirement; gives users without strong hardware a path | LOW | Single HTTPS upload. Note 25 MB file limit on OpenAI's endpoint — long videos must be chunked or rejected with a clear message. |
| Save transcript to `.md` | Core deliverable per PROJECT.md | LOW | Default filename from source video name + timestamp. |
| Transcript displayed in-window (read + scroll + copy) | User must see the result before saving/analyzing | LOW | Read-only view is fine for v1 (editing is explicitly out of scope). Copy-to-clipboard button. |
| Language handling (default Russian, allow override/auto) | Audio is "preimushchestvenno russian"; wrong language = garbage output | LOW | Pass language code to Whisper. Auto-detect is unreliable on short/noisy clips — default to `ru`, allow override. |
| LLM provider config: presets (OpenAI, Claude, Gemini) + custom OpenAI-compatible endpoint | Explicit requirement; covers Ollama/LM Studio/3rd-party | MEDIUM | Custom = URL + key + model name. Treat all providers through one OpenAI-compatible client where possible. |
| Secure API key storage | Storing keys in plaintext JSON is a trust-killer | MEDIUM | Use Electron `safeStorage` (OS keychain, no native dep). Caveat: on Linux without a secret store it falls back to plaintext — warn the user. |
| System prompt library (named, create/edit/delete, pick before send) | Explicit requirement; MacWhisper ships pre-built + custom prompts | MEDIUM | Store as JSON. Ship 2-3 starter prompts ("Summary", "Meeting minutes", "Key points") in Russian. |
| Send transcript + chosen prompt to LLM → show + save analysis `.md` | The second half of Core Value | MEDIUM | Stream the response into the window. Save as separate `.md`. Handle context-length: long transcripts may exceed model limits. |
| Error handling: invalid file, missing model, no API key, network failure, API error | Each failure mode is hit in normal use | MEDIUM | Specific, actionable messages (not stack traces). "File too long for cloud API", "Model not downloaded", "API key rejected". |
| Cross-platform build (Win/Linux/macOS) | Explicit constraint | HIGH | The hard part: bundling ffmpeg + whisper binary/native module across 3 OSes and 2 architectures. electron-builder. |

### Differentiators (Competitive Advantage)

Not required, but where scrubber can stand out for its technical, Russian-speaking, single-user audience.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Russian-tuned model option (e.g. `antony66/whisper-large-v3-russian`) | Verified WER 6.39 vs 9.84 stock large-v3 — materially better Russian accuracy | MEDIUM | Offer as a selectable model in the download list. Strong fit for the stated audience. faster-whisper/HF backend needed to load it. |
| `initial_prompt` / vocabulary hints | Verified +20-30% accuracy with context (domain terms, names, proper nouns) | LOW | Small text field "context/terms" passed as Whisper `initial_prompt`. Cheap, high-impact for Russian technical content. |
| Quality preset toggle (fast vs accurate: beam_size/best_of/temperature) | One toggle hides expert knobs (beam_size=5, best_of=5, temp=0.0 = best quality) | LOW | "Fast" vs "Maximum quality" radio rather than raw numeric fields. |
| Local LLM via custom endpoint (Ollama / LM Studio) | Fully-offline pipeline incl. analysis — unique privacy story; the custom endpoint already enables it | LOW | It's "free" given the OpenAI-compatible requirement — just document it and ship an Ollama preset. |
| Per-prompt provider/model binding | A "Meeting minutes" prompt can pin GPT-4-class; "quick summary" pins a cheap/local model | LOW | Optional model field on each saved prompt. |
| Editable transcript before analysis | Even minor fixes (names, terms) noticeably improve LLM output quality | MEDIUM | Out of scope for v1 per PROJECT.md — but a read-only view that's *trivially upgradeable* to editable is the right architecture. Flag as v1.x. |
| Plain-text timestamp option in transcript `.md` | Lets user jump back to the video moment; useful for review | LOW | Whisper already produces segment timestamps; just a formatting choice. |
| Re-run analysis without re-transcribing | Swap prompt/provider and re-analyze the same transcript instantly | LOW | Keep transcript in memory/state separate from the analysis step. Big UX win, near-zero cost. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Batch / multi-file processing | "I have 50 videos" | Explicitly out of scope; queue UI + concurrency + per-item error state is a whole subsystem; dilutes v1 focus | Ship one-file-at-a-time well first; queue is a clean v1.x add. |
| Live / real-time mic transcription | Buzz and meeting-tools have it | Different pipeline (streaming, VAD, ring buffers); not in the video→transcript Core Value | Defer to v2; file transcription is the job. |
| Speaker diarization (who-said-what) | Meeting note-takers all advertise it | Heavy extra models (pyannote), fragile on Russian, large dependency, GPU-hungry | Defer to v2. Document as known gap. |
| In-app transcript chat (multi-turn Q&A like MacWhisper) | MacWhisper's headline feature | Chat history/state management + token budgeting is real work; v1 is "one prompt → one analysis" | Single-shot prompt→analysis for v1; multi-turn chat is v1.x. |
| Auto-join meetings / calendar integration | Otter/Fireflies model | Entirely different product (bots, OAuth, SaaS); contradicts local/offline positioning | Not this product. Never. |
| Built-in video player / editor | "Show me the video while I read" | Scope explosion; transcript is the deliverable, not video playback | Optional timestamp links the user opens in their own player (v2). |
| Cloud sync / accounts / sharing | "Access my transcripts anywhere" | Contradicts the local/privacy constraint; backend cost + auth | Files are `.md` on disk — user syncs via their own Dropbox/git if wanted. |
| Many video/audio input formats | "Why only mp4?" | Each codec is a test/support burden; ffmpeg *can* handle them but each is a promise | mp4 only for v1 (per scope). ffmpeg makes adding formats cheap later. |
| Auto-translation to English | Whisper supports `translate` task | Russian users want Russian transcripts; translation is a different intent | Keep transcription in source language; translation is a prompt the LLM can do if asked. |

## Feature Dependencies

```
[File picker / drag-drop mp4]
    └──requires──> [ffmpeg audio extraction]
                       └──requires──> [Transcription engine selection]
                            ├──(local)──> [Whisper model download + selection]
                            │                  └──enhanced by──> [Russian-tuned model]
                            │                  └──enhanced by──> [initial_prompt / quality preset]
                            └──(cloud)──> [Cloud Whisper API config + key]
                                   └──requires──> [file-size/length guard]

[Transcription engine] ──produces──> [Transcript view + Save .md]
                                          └──feeds──> [LLM analysis step]

[LLM analysis step]
    ├──requires──> [Provider/endpoint config]
    │                  └──requires──> [Secure key storage]
    ├──requires──> [System prompt library]
    │                  └──enhanced by──> [Per-prompt provider binding]
    └──produces──> [Analysis view + Save analysis .md]
                        └──enhanced by──> [Re-run analysis without re-transcribe]

[Secure key storage] ──shared by──> [Cloud transcription] AND [LLM analysis]

[Progress feedback + Cancel] ──wraps──> [Transcription engine] (long-running)
[Error handling] ──wraps──> [every external boundary: file, ffmpeg, model, network, API]
```

### Dependency Notes

- **Everything downstream of ffmpeg:** if audio extraction is unreliable, nothing else matters. It is the first hard technical gate and must be proven before transcription work.
- **Secure key storage is shared infrastructure** for both cloud transcription and LLM analysis — build it once, before either feature that needs it.
- **Progress + Cancel must be designed into the transcription engine from the start**, not bolted on — the IPC channel between the whisper worker/process and the renderer has to stream progress events. Retrofitting is painful.
- **Re-run-without-re-transcribe** depends on cleanly separating transcript state from the analysis call. If the analysis step reads transcript from in-memory state (not by re-running the pipeline), this feature is nearly free.
- **Russian-tuned model + initial_prompt** both depend on which local backend is chosen: faster-whisper/HF can load custom HF models; plain whisper.cpp is mostly limited to the official ggml models. This is a stack decision with feature consequences.

## MVP Definition

### Launch With (v1)

- [ ] mp4 file picker + drag-drop — entry point to everything
- [ ] ffmpeg audio extraction (bundled `ffmpeg-static`) — required for transcription
- [ ] Local Whisper transcription with model-size selection — Core Value, privacy
- [ ] Cloud Whisper API transcription option (with file-size guard) — explicit requirement
- [ ] Russian as default language with override — matches the actual audio
- [ ] Progress feedback + Cancel for transcription — long files need it
- [ ] Transcript view (read-only) + copy + save `.md` — the primary deliverable
- [ ] LLM provider config: OpenAI/Claude/Gemini presets + custom OpenAI-compatible endpoint — explicit requirement
- [ ] Secure API key storage (`safeStorage`) — trust + shared by both API features
- [ ] System prompt library: named, CRUD, pick-before-send + 2-3 RU starter prompts — explicit requirement
- [ ] Single-shot analysis: transcript + prompt → LLM → show + save `.md` — second half of Core Value
- [ ] Actionable error handling at every external boundary — normal-use failures
- [ ] Cross-platform build (Win/Linux/macOS) — explicit constraint

### Add After Validation (v1.x)

- [ ] Russian-tuned model option + `initial_prompt`/vocabulary hints — trigger: users report Russian accuracy gaps
- [ ] Quality preset toggle (fast vs accurate) — trigger: users want more control over speed/quality
- [ ] Re-run analysis without re-transcribing — trigger: users iterate on prompts (likely fast)
- [ ] Editable transcript before analysis — trigger: users fixing names/terms by hand
- [ ] Multi-file queue (batch) — trigger: validated demand for >1 file at a time
- [ ] Multi-turn transcript chat — trigger: single-shot analysis feels limiting
- [ ] Timestamp links in transcript — trigger: users want to jump back to video

### Future Consideration (v2+)

- [ ] Speaker diarization — defer: heavy models, fragile on Russian, large dependency
- [ ] Live mic transcription — defer: different streaming pipeline, not the Core Value
- [ ] Additional input formats beyond mp4 — defer: cheap via ffmpeg but each is a support promise
- [ ] Built-in video player with timestamp sync — defer: scope explosion

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Local Whisper transcription | HIGH | HIGH | P1 |
| ffmpeg audio extraction | HIGH | MEDIUM | P1 |
| File picker + drag-drop | HIGH | LOW | P1 |
| Progress + Cancel | HIGH | MEDIUM | P1 |
| Save transcript `.md` + view + copy | HIGH | LOW | P1 |
| Russian default language | HIGH | LOW | P1 |
| LLM provider config (presets + custom) | HIGH | MEDIUM | P1 |
| Secure key storage | HIGH | MEDIUM | P1 |
| System prompt library | HIGH | MEDIUM | P1 |
| Single-shot analysis → `.md` | HIGH | MEDIUM | P1 |
| Cloud Whisper option | MEDIUM | LOW | P1 |
| Error handling (all boundaries) | HIGH | MEDIUM | P1 |
| Cross-platform build | HIGH | HIGH | P1 |
| Russian-tuned model + initial_prompt | HIGH | MEDIUM | P2 |
| Re-run analysis w/o re-transcribe | MEDIUM | LOW | P2 |
| Quality preset toggle | MEDIUM | LOW | P2 |
| Editable transcript | MEDIUM | MEDIUM | P2 |
| Batch processing | MEDIUM | HIGH | P3 |
| Multi-turn chat | MEDIUM | MEDIUM | P3 |
| Speaker diarization | MEDIUM | HIGH | P3 |
| Live mic transcription | LOW | HIGH | P3 |

## Competitor Feature Analysis

| Feature | Buzz (open-source, cross-platform) | MacWhisper (macOS) | Our Approach |
|---------|-----------------------------------|--------------------|--------------|
| Input | Audio/video files, YouTube URL, live mic | Drag-in audio/video | mp4 file only (v1) |
| Backends | Whisper, whisper.cpp, faster-whisper, HF models, OpenAI API | Local whisper + connected AI providers | whisper.cpp or faster-whisper (local) + OpenAI Whisper API (cloud) |
| Model sizes | tiny→large-v3, GPU (CUDA/Vulkan/Metal) | Multiple local sizes | tiny→large-v3 + optional RU-tuned model |
| Export | TXT, SRT, VTT (timestamps, speaker labels) | TXT, SRT + AI summary | `.md` transcript + `.md` analysis (v1); SRT/VTT later |
| Prompt library | (none — pure transcription) | Pre-built + custom prompts, transcript chat | Named prompt library, single-shot analysis (v1) |
| LLM analysis | No | Yes — chat + summarize with chosen model | Yes — prompt + transcript → analysis |
| Russian | Generic Whisper | Generic Whisper | Russian-default + RU-tuned model option (differentiator) |
| Diarization | Yes | Yes | No (v2) |
| Live mode | Yes | Dictation focus | No (v2) |

## Sources

- [Buzz — FAQ, features, backends, model sizes, export](https://chidiwilliams.github.io/buzz/docs/faq) and [Buzz overview](https://blog.brightcoding.dev/2026/04/11/buzz-transcribes-audio-offline-the-whisper-powered-tool-developers-crave) — HIGH (closest cross-platform analog)
- [MacWhisper review — file transcription, prompt library, AI summarization, model selection](https://daveswift.com/macwhisper/) and [MacWhisper Assistant docs](https://macwhisper.helpscoutdocs.com/article/22-assistant) — HIGH (closest feature/UX analog)
- [AI meeting note-taker landscape — Otter, Fireflies, Read.ai, Zoom](https://zapier.com/blog/best-ai-meeting-assistant/) — MEDIUM (defines analysis-output expectations)
- [Whisper large-v3 Russian fine-tune — WER 6.39 vs 9.84](https://huggingface.co/antony66/whisper-large-v3-russian) — HIGH
- [Whisper accuracy settings — initial_prompt, beam_size, best_of, temperature](https://www.saytowords.com/blogs/Whisper-Best-Settings/) — MEDIUM
- [faster-whisper (CTranslate2) backend](https://github.com/SYSTRAN/faster-whisper) and [whisper.cpp](https://github.com/ggml-org/whisper.cpp/discussions/420) — HIGH
- [Electron safeStorage — secure key storage, Linux caveat](https://www.electronjs.org/docs/latest/api/safe-storage) and [replacing keytar with safeStorage](https://freek.dev/2103-replacing-keytar-with-electrons-safestorage-in-ray) — HIGH
- [AnythingLLM provider config — OpenAI-compatible, Ollama, LM Studio](https://docs.anythingllm.com/configuration) and [Datasette LLM — prompt templates + key storage](https://llm.datasette.io/en/stable/templates.html) — MEDIUM

---
*Feature research for: desktop video→transcript→LLM-analysis app (Russian-first)*
*Researched: 2026-05-27*
