# Architecture decisions

Each record states its decision and consequences. Records are numbered and are not renumbered.

## ADR-1: Static single-page application
- Stack: Vite, React, TypeScript, pnpm, Tailwind CSS. No server rendering.
- Workers: `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })`.
- Worklet modules and WASM binaries: `?url` imports or `new URL(..., import.meta.url)`, emitted as separate same-origin files.
- Hosting: any static host that sets response headers (ADR-12).

## ADR-2: Musical time in ticks
- Musical time is integer ticks, PPQ = 960 (project limit).
- The tempo map converts ticks to seconds and frames (`transport-and-timing.md`).
- An audio clip stores its timeline position in ticks, and its source offset and length in source frames.
- Audio clips are fixed-tempo: frame length does not depend on tempo; tick length is derived.
- Tempo-following (stretched) clips are outside stages 1–5.

## ADR-3: Threading
| Thread | Responsibilities |
|---|---|
| Main | UI, document model, undo/redo, commands, engine control, event-list compilation |
| Audio (AudioWorklet) | Sequencing, built-in instruments and effects, mixing, automation, metering, safety stage, capture, WAM processors |
| Disk worker | OPFS via `FileSystemSyncAccessHandle`, decoding, cache and peak generation, archive I/O |
| Render worker (optional) | Timeline and waveform drawing via `OffscreenCanvas` |
| Export worker | Offline rendering of projects without WAM plugins (ADR-10) |

- Audio data between threads moves through `SharedArrayBuffer` ring buffers. Control messages use `MessagePort`.
- Cross-origin isolation is required.

## ADR-4: Engine node and segments
Context:
- A Web Audio context has one rendering thread; extra nodes add per-node `process()` overhead and no parallelism.
- In Chromium, `AudioWorkletProcessor` overhead grows with the number of declared `AudioParam`s.

Decision:
1. One `EngineProcessor` (the engine node) runs transport, sequencer, built-in instruments, built-in effects, automation, mixing and metering.
2. One `SafetyProcessor` is the last node before `AudioContext.destination`.
3. One `CaptureProcessor` exists per armed input and one for master capture.
4. Processors declare zero `AudioParam`s. Parameters and automation are internal.
5. Built-in instruments are kernels inside engine processors: JavaScript first, then WASM.
6. The main thread compiles the arrangement into per-track event lists. An edit during playback publishes a new event-list version, applied at a render-quantum boundary.
7. Native `AudioNode` synthesis and effects are not used in the render path. Allowed native nodes: `MediaStreamAudioSourceNode`, WAM nodes, the destination.
8. A WAM plugin on a channel strip ends a segment. Processing after the plugin runs in a `SegmentProcessor`. Strips are assigned to processors in topological order of the routing graph, so every signal flows forward and the graph stays acyclic (`audio-engine.md`).

Consequences: without plugins the graph is two nodes. Plugins add one node each plus one `SegmentProcessor` per downstream segment. No configuration adds latency through graph cycles.

## ADR-5: Native format
- A project is a versioned JSON document plus audio Sources, stored as a directory in OPFS or as a ZIP archive (`.wrack`).
- Interchange: DAWproject 1.0 and SMF, import and export. Lossy mappings are reported to the user.

## ADR-6: WAM 2.0 is the only plugin format
- Plugins load only from user-installed local copies (ADR-8).
- Projects reference plugins by identifier and version and never embed plugin code.
- An unavailable plugin's device is bypassed and marked missing.

## ADR-7: Sample rate
- The context runs at the device's default sample rate.
- Imported and recorded audio is kept unmodified as the original file, plus a Source cache at the context rate.
- A sample-rate change between sessions regenerates caches in the disk worker. No real-time resampling.

## ADR-8: Plugin installation and same-origin loading
Context: `connect-src 'self'` forbids fetching from user-chosen origins; a static CSP cannot list origins chosen at run time; COEP `require-corp` blocks cross-origin modules without CORP or CORS headers.

Decision:
- The user installs a plugin from a local ZIP or folder. The disk worker copies it to `opfs:/plugins/<id>/<version>/`.
- The service worker serves installed plugins at `/plugins/<id>/<version>/...` as same-origin responses.
- `script-src` includes `blob:` for the WAM SDK environment setup (`privacy-and-security.md`). Wrack's own code never creates script `blob:` URLs.
- The app never fetches plugins over the network.

## ADR-9: Media containers
- Compressed-audio demuxing and muxing use Mediabunny, version pinned. Codecs use WebCodecs.
- WAV, AIFF and RF64 readers and writers are core code.

## ADR-10: Offline render
Context: `OfflineAudioContext` exists only in Window contexts and holds its full output buffer; Firefox lacks `OfflineAudioContext.suspend()`; WAM plugins run only inside a Web Audio context.

Decision:
| Project | Render path |
|---|---|
| No WAM plugins | Export worker drives the engine and safety kernels directly, block by block, and streams output to the disk worker. Memory is bounded; no length limit beyond storage quota. |
| WAM plugins present | `OfflineAudioContext` with the full node graph; length limit in `export.md`. |

- Core DSP is environment-independent: kernels run in AudioWorklet processors, the export worker and unit tests.
- Engine acceptance tests run both paths and require identical output for plugin-free projects.

## ADR-11: Service worker
The service worker:
- precaches the application shell;
- serves installed plugins from OPFS;
- adds `Cross-Origin-Resource-Policy: same-origin` to responses it constructs.

It makes no requests other than same-origin shell updates.

## ADR-12: Headers and hosting
- The host must send the headers in `privacy-and-security.md`. Hosts that cannot set headers are not supported.
- Header injection by a service worker (for example `coi-serviceworker`) is not used: it requires a reload on first load and depends on service-worker installation.

## Sources
- Web Audio API 1.1 — https://www.w3.org/TR/webaudio-1.1/
- AudioWorkletProcessor parameter cost — https://cprimozic.net/blog/webaudio-audioworklet-optimization/
- WAM API — https://github.com/webaudiomodules/api
- Mediabunny — https://mediabunny.dev/
- coi-serviceworker — https://github.com/gzuidhof/coi-serviceworker
