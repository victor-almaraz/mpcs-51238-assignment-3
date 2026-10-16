# A3 audio implementation

## Scope
This document defines the audio system of the Assignment 3 build: worklet architecture, file layout, loading, messaging, real-time rules, timing, DSP algorithms, export, decoding and performance. Requirements and limits come from `assignment-3-scope.md`. All code is JavaScript (ES2022 modules); TypeScript is not used.

## Terms
| Term | Definition |
|---|---|
| Quantum | One `process()` call. Its length in frames is `outputs[0][0].length`. |
| Block | An internal processing unit of at most `BLOCK = 128` frames (project limit). |
| Frame | One sample per channel at the context sample rate `fs`. |
| Tick | Musical time unit; `PPQ = 960`; always an integer. |
| Kernel | A JavaScript class with preallocated state and a `process(...)` method. Kernels have no DOM, Web Audio or `postMessage` dependency. |
| EngineModel | Frame-domain project data compiled on the main thread and sent to the engine. |
| Source | Decoded PCM of one imported file, identified by `sourceId` (SHA-256 hex of the original bytes). |
| Voice | One sounding note inside an instrument kernel. |
| Rev | A monotonically increasing integer that versions EngineModel snapshots. |

## Architecture
### Node graph
```
AudioWorkletNode "wrack-engine" (EngineProcessor: 0 inputs, 1 output, 2 channels)
  → AudioWorkletNode "wrack-safety" (SafetyProcessor: 1 input, 1 output, 2 channels)
  → destination
```
- One worklet module, `/worklets/worklet/main.js`, registers both processors.
- `EngineProcessor` contains the sequencer, the five instrument kernels, the clip player, per-track effect chains, the mixer, master effects, master volume and the metronome.
- `SafetyProcessor` contains the non-finite guard, DC blocker, sustained-level duck, start and resume fades and the look-ahead limiter. It is always the last node.
- The only native nodes are the two worklet nodes and `destination`. Instruments and effects never use native nodes.
- The engine declares no `AudioParam`s. Parameters arrive as messages and are smoothed inside kernels.

### Kernel contract
Every kernel class provides:

| Method | Behaviour |
|---|---|
| `constructor(fs, limits)` | Allocates every buffer. Sizes derive from `fs` and limits. |
| `reset()` | Zeroes all state. |
| `setParam(id, value)` | Clamps through `ParamDef` and sets the smoother target. |
| `process(bufL, bufR, start, end)` | Processes frames `[start, end)` in place or additively, as documented per kernel. |

- Hot state is struct-of-arrays: `Float32Array` and `Float64Array` fields indexed by voice or grain. Arrays of objects are not used in hot paths.
- `EngineProcessor` is a thin wrapper around `Engine` (`src/dsp/engine/engine.js`), which is itself a kernel. Node tests run `Engine` directly.
- The engine reuses kernels by device ID across models. A kernel created for a model snaps its smoothers to the model's parameter values, so the first sound starts at those values.
- Instrument kernels render mono, except the drum machine, which renders stereo for its per-voice pan.

### Node splitting
The design uses one engine node. Browsers render all AudioWorklet nodes of a context on one audio thread, so splitting adds graph overhead without parallelism. A split is justified only by a measured profile that shows one quantum over budget.

## File layout
```
src/dsp/                     environment-independent JavaScript modules
  core/        constants.js params.js smoother.js prng.js tables.js math.js ring.js interp.js halfband.js
  timing/      tempo-map.js meter-map.js
  engine/      engine.js model.js sequencer.js metronome.js live-input.js reporter.js
  instruments/ voice-pool.js envelope.js polyblep.js subtractive.js fm.js additive.js pluck.js granular.js
               drums.js drum-map.js drum-voices/{kick,snare,sidestick,clap,metal,tom,cowbell,claves}.js sampler.js sampler-zones.js
  clips/       clip-player.js fades.js gain-envelope.js
  effects/     biquad.js svf.js eq3.js filter.js compressor.js saturation.js delay.js reverb.js chain.js
  mixer/       mixer.js pan.js meter.js
  safety/      safety.js limiter.js dc-blocker.js guard.js duck.js fade.js
  protocol.js                message types and validators shared by main thread and worklet
src/worklet/main.js          registerProcessor('wrack-engine'), registerProcessor('wrack-safety')
src/workers/peaks.js         waveform peak and sampler mip-level worker (module worker)
src/lib/audio/               engine-client.js compile-model.js decode.js peaks-client.js midi-input.js keyboard-input.js
src/lib/export/              render-offline.js wav-writer.js dither.js
src/lib/archive/             crc32.js zip-writer.js zip-reader.js validate.js
scripts/copy-worklets.mjs    copies src/dsp, src/worklet, src/workers into public/worklets/
tests/dsp/*.test.js          node:test suites importing src/dsp directly
tests/e2e/*.spec.js          Playwright suites
```

Rules:
- Files in `src/dsp` import only from `src/dsp`. Every relative import includes the `.js` extension: `import { Smoother } from '../core/smoother.js'`.
- Files in `src/dsp` never reference `window`, `document`, `AudioContext`, `performance`, `Date`, `Math.random`, `console` or `globalThis`.
- Public functions and classes carry JSDoc comments that state parameter units and ranges.
- `public/worklets/` is generated output and is listed in `.gitignore`.

## Worklet build and loading
### Build
- `scripts/copy-worklets.mjs` copies `src/dsp/`, `src/worklet/` and `src/workers/` into `public/worklets/`, preserving paths. With `--watch`, it recopies changed files.
- `package.json` scripts:

| Script | Command |
|---|---|
| `copy:worklets` | `node scripts/copy-worklets.mjs` |
| `dev` | `pnpm copy:worklets && (node scripts/copy-worklets.mjs --watch & NEXT_TELEMETRY_DISABLED=1 next dev)` |
| `build` | `pnpm copy:worklets && NEXT_TELEMETRY_DISABLED=1 next build` |

- `vercel.json` sets `Cache-Control: no-cache` for `/worklets/:path*`, so the module graph stays fresh between deploys. The production build is a static export, which does not support `headers()`; the development server applies the same `vercel.json` rule through `next.config.mjs`, and `scripts/serve-out.mjs` applies it to `out/`. No COOP or COEP headers are set.
- ESLint declares the AudioWorklet globals (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, `currentFrame`, `currentTime`) for `src/worklet/**` only.

### Loading
```js
// src/lib/audio/engine-client.js — imported only by 'use client' modules
const WORKLET_URL = '/worklets/worklet/main.js';
const loaded = new WeakMap();
export function ensureModule(ctx) {
  let p = loaded.get(ctx);
  if (!p) { p = ctx.audioWorklet.addModule(WORKLET_URL); loaded.set(ctx, p); }
  return p;
}
```
- Worklet and worker URLs are plain strings. `new URL('./x.js', import.meta.url)` is not used: Turbopack, the default bundler in Next.js 16, has open defects with that form for workers.
- The `AudioContext` is created only inside a user-gesture handler, after the volume notice is acknowledged. `ctx.resume()` runs in the same handler.
- The engine client is a module-level singleton stored on `globalThis.__wrackEngine`. This prevents a second context when React StrictMode double-invokes effects and when Fast Refresh re-evaluates modules.
- `main.js` guards each `registerProcessor` call with a global flag; a duplicate registration throws `NotSupportedError`.
- Worklet code does not hot-reload. After the copy script updates `public/worklets/`, the page needs a full reload.
- Components that touch audio carry `'use client'`. Pages load the studio with `next/dynamic` and `{ ssr: false }` from inside a client component; App Router rejects `ssr: false` in Server Components.

## Messaging protocol
### Transport and ordering
- The main thread and the engine communicate only through `node.port`. The safety node has its own port.
- Messages on one port arrive in send order. The worklet's `onmessage` runs on the audio thread between `process()` calls.
- `onmessage` may allocate. It validates the message, builds structures and stores them in a pending slot. `process()` swaps them in at the start of the next quantum with one assignment per structure.
- Every message carries `t` (type) and `v: 1`. A message with another `v` is answered with `error` and ignored.
- `src/dsp/protocol.js` exports one validator per message type. Both threads call the validator before use.

### Main to engine
| `t` | Payload | Rule |
|---|---|---|
| `init` | `fs`, `seed`, `limits` | Once, after node creation |
| `model` | `rev`, EngineModel (typed arrays) | Full snapshot on structural edits; at most one per animation frame |
| `params` | `rev`, `Float64Array` of triples `[target, paramId, value]` | At most one per animation frame; one message per slider event is not allowed. `target` is a model track index, or −1 for the master. `paramId` 0–3 are gain (dB), pan, mute and solo; 100 + i is parameter i of the track instrument's ParamDefs; 1000 + 100·s + k is parameter k of insert slot s, and 1000 + 100·s + 99 is that slot's bypass (tracks and the master). The main thread sends `params` instead of `model` when an edit changes only these values |
| `transport` | `op` (`play`, `stop`, `locate`, `loop`), `frame`, `loopStart`, `loopEnd`, `loopOn` | Applied at the next quantum boundary |
| `live` | `Uint8Array` of `[status, data1, data2]` triples | Keyboard and Web MIDI notes; applied at offset 0 of the next quantum |
| `source-add` | `sourceId`, `channels` (array of `Float32Array`) | Transfer list: each channel's `buffer` |
| `source-remove` | `sourceId` | References released at the next quantum |
| `source-mips` | `sourceId`, `levels` (array of `{ level, channels }`) | Transfer list: each channel's `buffer` |
| `sampler-zones` | `deviceId`, `selection` (0), `zones` (at most one `{ sourceId, sourceName }`; empty unbinds) | No sample data; sent whole on change. Markers and the other zone settings are instrument params |
| `panic` | — | Every voice, drum instance, preview and audition fades over 5 ms (project limit), effect state clears at once and again when the fades end, transport stops |
| `metronome` | `on`, `gainDb` | — |
| `master` | `volumeDb` | Clamped to the master volume ParamDef (−60 to 0 dB, default −12) and smoothed |

### Engine to main
| `t` | Payload | Rate |
|---|---|---|
| `ready` | `fs`, `blockSize` | Once |
| `ack` | `rev` | After applying a `model` or `params` rev |
| `pos` | `playFrame`, `ctxFrame` (`currentFrame` at block start), `playing`, meters | Every `REPORT_QUANTA` quanta, `REPORT_QUANTA = max(1, round(0.025·fs/frames))` (project limit) |
| `fault` | `trackId` (`'master'` for the master chain), `deviceId`, `slot`, `kind: 'nonfinite'` | Once per fault, from a preallocated queue of 16 per quantum |
| `source-status` | `deviceId`, `sourceId`, `status` (`bound` or `missing`) | Once per bind attempt |
| `sampler-zone-invalid` | `deviceId`, `zoneIndex`, `reason` | Once per rejected zone; `reason: null` once the zone is valid again |
| `progress` | `renderedFrames`, `totalFrames` | Offline only; every 0.25 s of rendered audio (project limit) |
| `error` | `code`, `detail` | On protocol errors |

- Meters are a `Float32Array` of `[peakL, peakR, rmsL, rmsR]` per track plus master, combined into `pos`.
- The safety port carries `duck` (`active`), `guard` (`muted`) and `level` (`peakL`, `peakR` and the limiter's smallest gain `reduction`, post-limiter, every `REPORT_QUANTA` quanta) to the main thread, and `ack-duck` and `resume-fade` to the safety processor. The master meter and the limiter readout use `level`.
- Model tracks carry `trackId`, `gainDb`, `pan`, `mute` and `solo`; the model carries `masterPan`. Master volume is a saved setting sent with `master`.

### Transfer and memory
- **Source upload:** after `decodeAudioData`, each channel is copied with `audioBuffer.getChannelData(c).slice()` and the copy's `buffer` is transferred. The main thread keeps its own channel data for peaks and export.
- **Memory per source:** `frames × channels × 4` bytes for each copy. At 48 kHz stereo, one minute is 23.04 MB per copy.
- **Original bytes** are kept as a `Blob` for archive saving. `decodeAudioData` detaches the buffer it receives, so it always receives `bytes.slice(0)`.
- **Meters:** the engine reuses one preallocated `Float32Array` and posts it without a transfer list. Structured clone copies it, so the array stays valid.

### Versioning
- The main thread increments `rev` on every edit batch. The engine replies `ack(rev)`.
- While `lastAck < rev` for longer than 500 ms (project limit), the UI shows "Syncing audio…".
- EngineModel carries `schema: 1`. The engine rejects other values with `error`.

## Real-time rules
1. `process()` and every function it calls allocate nothing: no `new`, array or object literals, closures, `map`/`forEach`/`filter`, string building, spread, destructuring, or `try`/`catch` around per-sample code.
2. `process()` posts at most one message per `REPORT_QUANTA` quanta, plus `fault` and `ack`.
3. The frame count comes from `outputs[0][0].length` and is processed in chunks of at most `BLOCK`. The literal `128` appears only in `constants.js`.
4. Per-sample code does not call `Math.pow`, `Math.exp`, `Math.log` or `Math.tan`. Coefficients are computed per block or on parameter change. Kernel sections list the exceptions.
5. Recursive state (filters, combs, envelopes, smoothers) is flushed at block end: `if (Math.abs(s) < 1e-15) s = 0`. JavaScript engines do not flush denormals.
6. `process()` returns `true` in both processors.
7. Every parameter passes through `ParamDef { min, max, default, scale, smoothMs }`. `clampParam` runs on both threads.
8. Smoothing is one-pole: `y += a·(x − y)`, `a = 1 − exp(−1/(τ·fs))`, `τ = 12 ms` (project limit, inside the required 10–15 ms). `a` is computed once.
9. Randomness comes only from `mulberry32(seed)`. Seeds are `hash32(projectSeed, trackIndex, eventIndex)`.
10. No kernel reads wall-clock time. State depends only on samples processed and messages applied.

```js
// src/dsp/core/prng.js
export function mulberry32(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```
The returned function is created once per kernel at construction, never in `process()`.

## Timing and sequencing
### Tempo map
- Segments start at sorted tempo points; segment 0 starts at tick 0. A segment is constant (`step`) or ramps linearly in ticks to the next point (`linear`), with the seconds formulas in `transport-and-timing.md`. Segment start seconds are a Float64 cumulative sum.
- `frameAt(tick) = floor(secondsAt(tick)·fs)`, with the segment found by binary search. `tickAt(frame)` is the largest integer tick whose frame is ≤ `frame`, so `tickAt(frameAt(t)) === t` whenever frames per tick ≥ 1 (fs ≥ 16 kHz at 999 BPM).
- Meter map entries `{ bar, numerator, denominator }`; ticks per bar = `numerator·PPQ·4/denominator`.

### Compile step
`compile-model.js` converts the project into EngineModel arrays sorted by start frame:
- MIDI notes become `Int32Array` `startFrame`, `endFrame` and `Uint8Array` `pitch`, `vel` per track.
- MIDI clip looping expands notes: a note at clip tick `t` repeats at `t + k·loopLength` while inside the clip; notes are cropped at the clip end. Cap: 20 000 expanded notes per track (project limit).
- Audio clips become `timelineStartFrame`, `srcStart`, `srcLength`, gain, fade lengths and curves, and envelope segments.
- The loop region becomes `loopStartFrame`, `loopEndFrame`.
- Any edit, tempo change or sample-rate change triggers a recompile.

### Engine block loop
```
process(outputs):
  frames = outputs[0][0].length
  swapPendingModel(); drainLive()
  for off = 0; off < frames; off += n:
    n = min(BLOCK, frames − off)
    renderBlock(off, n)
  return true

renderBlock(off, n):
  if playing and loopOn and playFrame + n > loopEnd:
    a = loopEnd − playFrame
    renderSpan(off, a)
    releaseSequencerVoices(off + a); playFrame = loopStart; reseekCursors()
    renderSpan(off + a, n − a)
  else:
    renderSpan(off, n)
```
`renderSpan` collects events whose start or end frame lies in the span into a preallocated queue, sorted by offset, then note-off before note-on, then pitch. Instruments render from event to event.

### Loop wrap and locate
- At a wrap, every voice the sequencer started receives note-off at the wrap offset. Live-input voices continue.
- `reseekCursors()` binary-searches each track's notes for the first `startFrame ≥ loopStart`. Locate does the same at the target frame.
- Clip playback is a pure function of `playFrame` and needs no wrap state.

### Metronome
- Clicks occur at each beat frame: 1500 Hz sine on the downbeat, 1000 Hz on other beats, 30 ms exponential decay, −12 dB relative to master (project limits).
- The click mixes after the master chain and before master volume, so it passes through the safety stage. Export excludes it.

### Live input
- Computer keyboard: `KeyA`–`KeyK` map to C–C of the current octave; `KeyZ`/`KeyX` change the octave within 1–7 (project limit). Keys are ignored while focus is in a text field.
- Web MIDI and keyboard notes travel as `live` messages and apply at offset 0 of the next quantum. Latency is message delay + one quantum + `baseLatency` + `outputLatency`.
- Flood limit: a token bucket of 200 note-ons/s on the main thread, re-checked in the engine. Excess note-ons are dropped and counted; note-offs always pass.

## Clip playback
### Source addressing
- A clip stores `sourceId`, `start` (ticks), `srcStart` and `srcLength` (frames), `gainDb`, fades, fade curves and envelope.
- The project stores `audioRate`, the `fs` at which frame offsets were recorded (the first imported source's decode rate). When the context runs at another `fs`, the compile step scales the offsets from shared rounded boundaries (Gain stages); the document keeps its offsets. Sources decode again from their bytes at the context rate, so `decodeAudioData` output matches it.
- For timeline frame `F`, the read index is `srcStart + (F − clipStartFrame)`. Mono sources feed both channels through constant-power pan; stereo sources use balance pan.
- Rendering is a pure function of the play frame, so a split clip renders the same samples as the unsplit clip.
- Transport stop and Panic fade sounding clips over 64 frames (project limit).

### Edit math
| Edit | Rule |
|---|---|
| Split at tick `T` | `d = frameAt(T) − frameAt(start)`. Left: `srcLength = d`. Right: `start = T`, `srcStart += d`, `srcLength −= d`. |
| Join A, B | Allowed when `A.sourceId = B.sourceId`, `B.srcStart = A.srcStart + A.srcLength` and `frameAt(B.start) = frameAt(A.start) + A.srcLength`. Result: A with `srcLength += B.srcLength`, A's fade-in, B's fade-out, envelopes concatenated. |
| Trim start by Δ frames | `srcStart += Δ`, `srcLength −= Δ`, `start = tickAt(frameAt(start) + Δ)`; `srcStart ≥ 0`, `srcLength ≥ 64` (project limit). |
| Trim end | `srcLength` clamped to `[64, sourceFrames − srcStart]`. |
| Move | Changes `start` and track (same track kind only). Source fields are unchanged. |

### Gain stages
`out = src[i] · clipGain · fade(i) · env(i)`
- Clip gain: −∞ to +12 dB (linear 0–3.981), smoothed.
- Fade tables: 1025 entries (project limit), built at init, read with linear interpolation, for `x ∈ [0, 1]`:
  - `linear`: `g = x`
  - `equalPower`: `g = sin(x·π/2)`
  - `exp`: `g = x === 0 ? 0 : 10^(−3·(1 − x))`
  - A fade-out reads the table at `1 − x`.
- Crossfades: where a later clip on one track starts inside an earlier clip and ends after it, the overlap of `L` frames becomes the earlier clip's fade-out and the later clip's fade-in, `L` frames of `equalPower`, so `a² + b² = 1`. Each clip is compared with every earlier clip still sounding; the longest overlap wins. A clip lying wholly inside another gets no automatic fades. The engine has no crossfade logic.
- Gain envelope: breakpoints `{ id, frame, gain }` with clip-relative frames and linear gain 0–1.995 (−∞ to +6 dB). Segments are linear in gain; per sample `g = g0 + (p − f0)·dg`, with `g0`, `f0` and `dg` found on segment entry, so the value does not depend on where rendering started. Points outside the clip anchor the segments that cross its edges.
- Split, trim and join keep the gain at every kept frame: each part keeps the points that shape it plus the nearest point on each side. Rejoined parts of one split share their anchors and restore the clip exactly; other joins give each side its own gain up to the boundary, and a side without an envelope is unity. A split inside a fade is refused.
- At another context rate, a clip spans `[round(F·r), round((F + length)·r))` with `F` its start frame at `audioRate` and `r = fs/audioRate`, and reads the source at the fixed offset `round((srcStart − F)·r)`, so the parts of a split stay contiguous.

## Instruments
### Shared rules
| Rule | Value |
|---|---|
| Note frequency | `440·2^((n − 69)/12)`, from a 128-entry table |
| Velocity gain | `0.3·(vel/127)²` |
| Voice caps | 16 per instrument, 64 global |
| Stealing | The released voice with the lowest envelope; otherwise the oldest voice. A stolen voice fades over 64 frames (project limit). |
| Polyphony auto-gain | `min(1, 2/√activeVoices)`, smoothed |
| Envelope | Linear attack to 1; sustain 1; exponential release to −80 dB over the release time, `r = 10^(−4/(release·fs))` computed at note-off; voice frees below 1e-4 |

### Subtractive
- Waveforms:
  - Sine: 4096-entry table (project limit), linear interpolation.
  - Saw: `2t − 1 − blep(t, dt)`.
  - Square: `sign(0.5 − t) + blep(t, dt) − blep((t + 0.5) mod 1, dt)`.
  - Triangle: leaky integration of the band-limited square, `y = 0.999·y + 4·dt·square` (project limit).
  - PolyBLEP, with phase `t ∈ [0, 1)` and `dt = f/fs`:
    ```
    blep(t, dt): if t < dt:     x = t/dt;       return 2x − x² − 1
                 if t > 1 − dt: x = (t − 1)/dt; return x² + 2x + 1
                 return 0
    ```
- Filter: per-voice TPT state-variable lowpass (Filter). Cutoff 40–16 000 Hz on a log scale, clamped to `0.45·fs`. Resonance 0–20 dB maps to `Q = 0.7071·10^(res/20)`. `g = tan(π·fc/fs)` is computed once per block.
- Envelope: attack 0.002–2 s, release 0.01–4 s.

### FM (two-operator)
- `fm = ratio·fc`; ratio 0.5–12 in steps of 0.5.
- Output `sin(φc + I(t)·sin(φm))`. Phases are Float64 accumulators wrapped to [0, 2π).
- `I(t) = min(index, I_max)·exp(−t/τ)`, τ = index decay 0.01–4 s (project limit). The decay factor is computed per block and interpolated per sample.
- `I_max = max(0, (0.45·fs − fc)/fm − 1)` keeps the highest significant sideband `fc + (I + 1)·fm` (Carson's rule) at or below `0.45·fs`.
- Cost: two `Math.sin` calls per sample per voice (accepted exception to rule 4).

### Additive
- Eight amplitudes `h_k ∈ [0, 1]`, normalised by `1/max(1, Σh_k)`. Harmonics with `k·f > 0.45·fs` are omitted; the count is fixed at note-on.
- Per sample, `sin θ` and `cos θ` come from the sine table; `sin(kθ)` for k = 2–8 comes from the recursion `s_k = 2·cos θ·s_{k−1} − s_{k−2}`, with `s_0 = 0`, `s_1 = sin θ`.

### Pluck (Karplus–Strong)
- Period `P = fs/f`. Loop filter `y = (1 − S)·x[n] + S·x[n−1]`, phase delay `S = 0.5·damping`.
- `N = floor(P − S − 0.1)`, `Δ = P − S − N ∈ [0.1, 1.1)`.
- Fractional allpass: `C = (1 − Δ)/(1 + Δ)`, `y[n] = C·x[n] + x[n−1] − C·y[n−1]`.
- Loop gain `ρ = min(0.9999, 10^(−3/(T60·f)))`, T60 0.2–10 s.
- Excitation: N samples of seeded noise in [−1, 1] through a one-pole lowpass with `a = 0.1 + 0.9·brightness`, scaled by velocity gain.
- Output DC blocker: `y = x − x1 + 0.995·y1`.
- One 4096-sample delay buffer per voice (project limit); covers MIDI note 24 at 96 kHz.

### Granular
- Sources generated at init, 2 s mono at `fs` (project limit): `saw` (PolyBLEP saw at 261.63 Hz), `noise` (seeded), `chord` (PolyBLEP saws at C4, E4, G4, scaled by 1/3).
- Window: 1025-entry Hann table with linear interpolation.
- Grain pool: 64 grains as struct-of-arrays (`pos`, `inc`, `age`, `len`, `amp`, `active`); 4 voices.
- Scheduling per voice: a countdown per sample; at zero a free grain starts and the countdown resets to `round(fs/density)`.
  - Length `size·fs`, size 0.01–0.25 s; density 2–60 grains/s.
  - Position `base + spray·(rand − 0.5)·sourceLength`, wrapped; spray 0–1.
  - Increment `f/261.63`; reads use linear interpolation.
  - With no free grain, the start is skipped and counted.
- Grain amplitude: velocity gain × `1/√(density·size)`, clamped to ≤ 1 (project limit).

### Drum machine
A single kernel, `DrumKernel`, synthesizes 14 percussion voices. It ships no sample data. A voice instance is one sounding hit of one voice.

**Drum map.** Notes follow the General MIDI Level 1 percussion key map. Notes absent from the map produce no sound and allocate no instance. The map lives in `src/dsp/instruments/drum-map.js` as two `Int8Array(128)` tables, `voiceOfNote` (−1 = unmapped) and `offsetOfNote`; the piano roll imports the same table for row labels.

| Note | GM1 name | Voice | Tune offset (semitones) |
|---|---|---|---|
| 35 | Acoustic Bass Drum | Kick | −2 |
| 36 | Bass Drum 1 | Kick | 0 |
| 37 | Side Stick | Side stick | 0 |
| 38 | Acoustic Snare | Snare | 0 |
| 39 | Hand Clap | Clap | 0 |
| 40 | Electric Snare | Snare | +2 |
| 41 | Low Floor Tom | Low tom | −3 |
| 42 | Closed Hi-Hat | Closed hat | 0 |
| 43 | High Floor Tom | Low tom | 0 |
| 44 | Pedal Hi-Hat | Pedal hat | 0 |
| 45 | Low Tom | Mid tom | −2 |
| 46 | Open Hi-Hat | Open hat | 0 |
| 47 | Low-Mid Tom | Mid tom | 0 |
| 48 | Hi-Mid Tom | High tom | 0 |
| 49 | Crash Cymbal 1 | Crash | 0 |
| 50 | High Tom | High tom | +2 |
| 51 | Ride Cymbal 1 | Ride | 0 |
| 56 | Cowbell | Cowbell | 0 |
| 57 | Crash Cymbal 2 | Crash | +1 |
| 59 | Ride Cymbal 2 | Ride | −1 |
| 75 | Claves | Claves | 0 |

Tune offsets are project limits.

**Shared primitives.**
- Phase accumulator: `ph += inc; if (ph >= 1) ph -= 1`, with `inc = f/fs`.
- Sine: 4097-entry table with linear interpolation.
- Exponential decay: `e *= g`, `g = 10^(−3/(T60·fs))`, computed at note-on.
- Pitch envelope: `p *= gp`, `gp = exp(−1/(τp·fs))`, computed at note-on; `inc = inc0·(1 + A·p)`.
- Noise: one `mulberry32` per instance, seeded at note-on with `hash32(projectSeed, trackIndex, eventIndex)`.
- Filters: TPT SVF (Filter) with coefficients computed at note-on.
- Squares: PolyBLEP, 50% duty, as in Subtractive. Naive squares are not used: their folded harmonics fall in the 3–12 kHz band the hat filters pass.
- Tune, decay and tone latch at note-on. Level and pan are smoothed per voice.
- Per-sample `pow`, `exp`, `log` and `tan` do not occur in drum voices.

**Voice models.** `f = fBase·2^((tune + offset)/12)`; `T60 = baseT60 × decay`; `v` is the velocity term (Velocity).

| Voice | Model | fBase | baseT60 | Tone controls |
|---|---|---|---|---|
| Kick | Damped sine from phase 0; pitch envelope A = 1.5·(0.75 + 0.25v), τp 6 ms; 1 ms noise click through a one-pole lowpass at 3 kHz | 50 Hz | 600 ms | Click level 0–0.5 |
| Snare | Damped sines at f and 1.94f, body T60 = 0.6·T60; noise through SVF highpass 1.2 kHz (Q 0.7) with its own T60 | 173 Hz | 250 ms | Body/noise mix |
| Side stick | Damped sines at f and 3.66f; sum through SVF highpass | 455 Hz | 30 ms | Highpass 300–1500 Hz |
| Clap | Noise through SVF bandpass (Q 2); burst and tail envelopes (Clap) | 1000 Hz | 300 ms | Bandpass centre 700–2000 Hz |
| Closed hat | Six squares × r through SVF bandpass 7100·r Hz (Q 1.5), then SVF highpass; 0.3 ms linear attack | r = 1 | 150 ms | Highpass 7–12 kHz |
| Pedal hat | Closed hat at 0.7 level | r = 1 | 100 ms | Highpass 7–12 kHz |
| Open hat | Closed hat topology | r = 1 | 1350 ms | Highpass 6–10 kHz |
| Low, mid, high tom | Damped sine; pitch envelope A = 0.26, τp 10 ms; noise through one-pole lowpass 2 kHz, T60 40 ms | 90, 135, 185 Hz | 600, 390, 300 ms | Noise level 0–0.3 |
| Crash | Six squares × r into bandpass 3440·r Hz (Q 1.2, T60) and bandpass 7100·r Hz (Q 1.5, 0.4·T60); sum through SVF highpass 4 kHz | r = 1 | 2400 ms | Band balance |
| Ride | Crash topology, high band T60 = 0.7·T60, highpass 5 kHz | r = 1.19 | 3000 ms | Band balance |
| Cowbell | Two squares at 540·r and 800·r Hz through SVF bandpass 880·r Hz (Q 4.8); envelope 0.6·(T60 25 ms) + 0.4·(T60) | r = 1 | 150 ms | Bandpass centre 700–1100 Hz |
| Claves | Damped sine from phase 0 | 2500 Hz | 75 ms | Pitch drop 0–2 semitones |

- Metal voices (hats, crash, ride) run six squares at `{205.3, 304.4, 369.6, 522.7, 540, 800} × r × 2^(tune/12)` Hz, the TR-808 oscillator frequencies. Each instance owns its bank and starts at phases drawn from its PRNG.
- `baseT60` values are three times the TR-808 chart decay times, which state decay to −20 dB (project limit).

**Clap.** `S` = 10 ms burst spacing (project limit):
```
t < 3S:   burst envelope restarts to 1 at t = 0, S, 2S; decays with T60 9 ms
t = 3S:   burst envelope = 1; decays with T60 20 ms
always:   tail envelope starts at 0.35 and decays with the voice T60
out = bandpass(noise) × (burst + tail)
```

**Velocity.** `s` = kit velocity sensitivity, `vn = vel/127`.
- Gain: `0.3·((1 − s) + s·vn²)`. With `s = 1` this equals the shared rule.
- Timbre term `v = (1 − s) + s·vn` scales kick pitch-envelope depth and click level, and snare noise level by `0.7 + 0.3v`.

**Instances.**
- The pool holds 16 instance slots (instrument cap), struct-of-arrays.
- Each voice is monophonic, except crash and ride, which keep up to 2 instances each (project limit).
- Retriggering a monophonic voice starts a new instance; the prior instance fades over 64 frames.
- Note-off has no effect. An instance ends when its envelope falls below 1e-4.
- When the pool is full, shared stealing applies; every drum instance counts as released from note-on.
- Instances count toward the 64-voice global cap.
- Polyphony auto-gain `min(1, 2/√activeInstances)` applies, as for every instrument.
- All-notes-off fades every instance over 64 frames and clears the pool. Panic applies the engine panic fade. Neither depends on the one-shot rule.

**Choke.** With `kit.choke` on, a closed-hat or pedal-hat note-on fades every open-hat instance over 64 frames.

**Buffers.** Constructor allocates: 16 slots × (8 Float64 phases, increments, envelopes, pitch-envelope states, 3 SVF state pairs, `Uint32` PRNG state, `Int8` voice id, `Uint32` age); sine table; pan table. No per-hit allocation. Filter states, envelopes and pitch-envelope states flush below 1e-15 at block end.

### Sampler
`SamplerKernel` plays one zone chromatically from a user-imported source. A zone maps a source region onto a key and velocity range. This build reads `zones[0]`, which covers keys 0–127 and velocities 1–127. There are no built-in samples.

**Rate.** `r = 2^((note − rootNote)/12 + fineTune/1200)`, computed at note-on. `decodeAudioData` output matches the context rate, so no rate correction applies. Notes more than 24 semitones from `rootNote` do not start (project limit).

**Mip levels.**
- Level 0 is the engine's decoded channel data. Levels 1 and 2 are generated in the peaks worker when a sampler binds a source: a 63-tap Kaiser-windowed half-band FIR (β 7.857, project limit), then 2:1 decimation, per level.
- Levels are transferred with `source-mips`. Memory overhead is 0.75 × level 0.
- At note-on, `L = clamp(ceil(log2(r)), 0, 2)`; the voice reads level L at step `r/2^L ≤ 1`. In mono mode with glide, L uses `max(rStart, rTarget)`. L stays fixed for the life of a voice.

**Interpolation.** 4-point cubic Hermite (`src/dsp/core/interp.js`):
```
c0 = x0; c1 = 0.5·(x1 − xm1)
c2 = xm1 − 2.5·x0 + 2·x1 − 0.5·x2
c3 = 0.5·(x2 − xm1) + 1.5·(x0 − x1)
y  = ((c3·t + c2)·t + c1)·t + c0
```
`interp.js` also exports `linear` and `lagrange6` for tests.

**Reading and loops.**
- Position `pos` is Float64 in level-L frames: `i = pos | 0`, `t = pos − i`, `y = hermite(rd(i−1), rd(i), rd(i+1), rd(i+2), t)`, `pos += dir·step`.
- `rd(j)` wraps inside a forward loop (`j ≥ loopEnd` → `j − loopLength`) and clamps to `[start, end − 1]` outside a loop.
- Loop modes: `off` (play to end, then a 64-frame fade); `forward` (loop, continuing through release); `pingpong` (reverse direction at loop boundaries; no crossfade).
- Forward crossfade over `X` frames, `X ≤ min(loopLength/2, loopStart − start)`: for `p` in `[loopEnd − X, loopEnd)`, `w = (p − (loopEnd − X))/X`, `y = (1 − w)·interp(p) + w·interp(p − loopLength)`.
- Markers `start`, `end`, `loopStart`, `loopEnd` are fractions 0–1 of source length, resolved to frames at bind time. Constraints: `start < loopStart < loopEnd ≤ end`; loop length ≥ 64 frames; crossfade ≤ 500 ms (project limits). A zone violating them is rejected with `sampler-zone-invalid`.

**Envelope and filter.**
- ADSR: linear attack; exponential decay toward sustain, `e = S + (e − S)·d`, `d = 10^(−4/(decay·fs))`; shared release rule.
- `trigger` mode ignores note-off; `gate` mode releases on note-off.
- Per-voice TPT SVF lowpass; `fc = cutoff × 2^(envAmount·e·4)` (±48 semitones); coefficients recomputed every 16 frames (project limit).

**Voices.** `poly`: up to 16 voices, shared stealing and polyphony auto-gain. `mono`: one voice; legato notes glide with `rate *= gGlide`, `gGlide = (rTarget/rCurrent)^(1/(glide·fs))`, clamped at the target. All-notes-off and Panic end every voice in both trigger and gate modes.

**Channels.** Mono sources use constant-power pan; stereo sources use balance pan.

**Missing source.** When `sourceId` has no loaded source, note-on allocates nothing and the device outputs silence. The engine posts `source-status` with `missing` once per bind attempt.

**Memory.** The kernel holds references to the engine's channel arrays and mip arrays and never copies them. Sampler-bound sources are at most 60 s each, and mip memory is at most 64 MB in total (project limits).

**Buffers.** Constructor allocates 16 voice slots: Float64 `pos`, `rate`, `gGlide`; Int8 `dir`, `level`, `stage`; Float32 envelope, SVF state pairs per channel, pan gains. Source bindings are reference assignments made in `onmessage`.

## Effects
### Shared slot rules
- Chains hold at most 8 slots. Bypass crossfades over 10 ms (project limit).
- Parameters are smoothed per the real-time rules.
- At block end, each slot computes `e = Σ out²`. If `e !== e` or `e > 1e12`, the slot resets, bypasses and posts `fault` once. A block whose input is already non-finite is silenced instead, so one bad source never faults the slots after it.
- A faulted slot stays bypassed until a `params` bypass edit turns it on; the main thread writes the bypass into the document and shows "Effect <name> on <track> was reset and bypassed." once per fault.
- Every feedback path has total gain below 1, enforced by parameter clamps.

### Biquad (RBJ Audio EQ Cookbook, transposed direct form II)
`w0 = 2π·f0/fs`, `α = sin(w0)/(2Q)`, `A = 10^(G/40)`; coefficients normalised by `a0`, recomputed at most once per block and only when a smoothed parameter moved more than 1e-6 of its range.

| Type | b0, b1, b2 / a0, a1, a2 |
|---|---|
| Peak | `1 + αA`, `−2cos w0`, `1 − αA` / `1 + α/A`, `−2cos w0`, `1 − α/A` |
| Low shelf (S = 1, `α = sin w0/√2`) | `A[(A+1) − (A−1)cos w0 + 2√A·α]`, `2A[(A−1) − (A+1)cos w0]`, `A[(A+1) − (A−1)cos w0 − 2√A·α]` / `(A+1) + (A−1)cos w0 + 2√A·α`, `−2[(A−1) + (A+1)cos w0]`, `(A+1) + (A−1)cos w0 − 2√A·α` |
| High shelf (S = 1) | `A[(A+1) + (A−1)cos w0 + 2√A·α]`, `−2A[(A−1) + (A+1)cos w0]`, `A[(A+1) + (A−1)cos w0 − 2√A·α]` / `(A+1) − (A−1)cos w0 + 2√A·α`, `2[(A−1) − (A+1)cos w0]`, `(A+1) − (A−1)cos w0 − 2√A·α` |

Transposed direct form II: `y = b0·x + s1; s1 = b1·x − a1·y + s2; s2 = b2·x − a2·y`.

**3-band EQ** (ranges are project limits):

| Param | Range | Default |
|---|---|---|
| `lowFreq` | 30–500 Hz (log) | 120 Hz |
| `lowGain` | −18 to +18 dB | 0 dB |
| `midFreq` | 200–8000 Hz (log) | 1000 Hz |
| `midGain` | −18 to +18 dB | 0 dB |
| `midQ` | 0.3–8 | 0.7 |
| `highFreq` | 2000–16 000 Hz (log) | 8000 Hz |
| `highGain` | −18 to +18 dB | 0 dB |

### Filter (TPT state-variable filter)
Stable under fast modulation; used for every modulated filter.
```
g = tan(π·fc/fs); k = 1/Q
a1 = 1/(1 + g·(g + k)); a2 = g·a1; a3 = g·a2
v3 = x − ic2; v1 = a1·ic1 + a2·v3; v2 = ic2 + a2·ic1 + a3·v3
ic1 = 2·v1 − ic1; ic2 = 2·v2 − ic2
LP = v2; BP = v1; HP = x − k·v1 − v2
```

| Param | Range | Default |
|---|---|---|
| `mode` | LP, HP, BP | LP |
| `cutoff` | 20–20 000 Hz (log), clamped to `0.45·fs` | 2000 Hz |
| `resonance` | Q 0.5–12 (project limit) | 0.707 |

### Compressor (feed-forward, log domain)
- Stereo-linked detector input `x = max(|L|, |R|)`, level `xdB = 20·log10(max(x, 1e-9))`.
- Gain computer with threshold `T`, ratio `R`, knee `W = 6 dB` (project limit):
  ```
  if 2(xdB − T) < −W:      y = xdB
  elif |2(xdB − T)| ≤ W:   y = xdB + (1/R − 1)·(xdB − T + W/2)²/(2W)
  else:                    y = T + (xdB − T)/R
  gc = y − xdB
  ```
- Smooth branching detector on `xL = −gc`: `yL = xL > yL ? αA·yL + (1 − αA)·xL : αR·yL + (1 − αR)·xL`, `α = exp(−1/(τ·fs))` computed on parameter change.
- Output gain `10^((M − yL)/20)`, where `M` is makeup.
- Cost: one `log10` and one `pow` per sample (accepted exception to rule 4).

| Param | Range | Default |
|---|---|---|
| `threshold` | −60 to 0 dB | −18 dB |
| `ratio` | 1–20 | 4 |
| `attack` | 0.1–100 ms (log) | 10 ms |
| `release` | 10–1000 ms (log) | 120 ms |
| `makeup` | 0 to +24 dB | 0 dB |

### Saturation (tanh with first-order antiderivative anti-aliasing)
- `u = x·10^(drive/20)`. Antiderivative `F(u) = ln cosh u = |u| + log1p(exp(−2|u|)) − ln 2`.
- `y = (F(u) − F(u1))/(u − u1)`; when `|u − u1| < 1e-5`, `y = tanh((u + u1)/2)`.
- The dry path uses `0.5·(x + x1)` to match the half-sample delay of the ADAA output.
- Tone: one-pole lowpass after the nonlinearity, 1–16 kHz (log); coefficient per block.
- `out = (dry·(1 − mix) + wet·mix)·10^(output/20)`.
- Cost: one `exp` and one `log1p` per sample per channel (accepted exception to rule 4).

| Param | Range | Default |
|---|---|---|
| `drive` | 0 to +36 dB | 6 dB |
| `tone` | 1000–16 000 Hz | 8000 Hz |
| `mix` | 0–1 | 1 |
| `output` | −24 to +6 dB | −3 dB |

### Delay
- Stereo ring of `ceil(2·fs) + 4` frames, allocated at init.
- Time: 1–2000 ms, or synced to 1/32, 1/16, 1/8, 1/4, 1/2, 1/1 with dotted and triplet variants (`beats·60/bpm`, capped at 2000 ms, recomputed on tempo change). Time smoothing τ 50 ms (project limit).
- Reads use linear interpolation at the fractional delay.
- Feedback `fb = clamp(feedback, 0, 0.9)` through a one-pole high-cut (1–20 kHz, gain ≤ 1), so loop gain stays below 1. The wet output is taken after the high-cut, so every echo is filtered.
- Mix 0–1. Left and right are independent delays.
- Defaults: time 375 ms, sync off, feedback 0.35, high-cut 8000 Hz, mix 0.3.
- Synced times follow the project's first tempo point.

### Reverb (Freeverb structure)
- Per channel: 8 parallel lowpass-feedback combs into 4 series allpasses with `g = 0.5`.
- Delay lengths at 44.1 kHz, scaled by `fs/44100`: combs 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617; allpasses 556, 441, 341, 225; right channel adds 23.
- Input: mono sum × 0.015 after a pre-delay of 0–200 ms.
- Comb gains `g_i = min(0.98, 10^(−3·L_i/(T60·fs)))`, T60 = decay 0.2–10 s; the 0.98 cap (project limit) keeps loop gain below 1.
- Damping 0–1 sets the in-loop one-pole `d`: `f = y·(1 − d) + f·d`, `out = buf + g·f`.
- Size 0–1 scales comb lengths by 0.5–1.0; buffers are allocated at maximum length.
- Mix 0–1: `out = dry·(1 − mix) + 3·wet·mix` (Freeverb's wet scale). Damping maps to `d = 0.4·damping`. Left wet comes from the left comb bank and right wet from the right bank.
- Defaults: size 0.75, decay 2 s, damping 0.5, pre-delay 10 ms, mix 0.25.
- The 0.98 comb-gain cap shortens long decays at small sizes: at size 0 a 10 s setting decays in about 5.6 s. From size 0.75 the measured T60 stays within ±20% of the setting.
- At most 4 reverb instances per project (project limit); the engine passes the signal through any reverb past the fourth, and the chain UI refuses a fifth.
- A 4-line feedback delay network with a Householder matrix `A = I − (2/N)·11ᵀ` replaces Freeverb if the CPU benchmark fails.

## Mixer and metering
- Per track: source → insert chain → gain (−∞ to +6 dB, smoothed) → pan → mute/solo gate → master bus. Chains are stereo: a mono source enters a non-empty chain at −3 dB per side (the centre of constant-power pan), and the track then pans by balance.
- The master chain runs after the track sum and before the metronome click.
- Pan: mono sources use constant power, `θ = (p + 1)·π/4`, `L = cos θ`, `R = sin θ`. Stereo clips use balance, `L·= min(1, 1 − p)`, `R·= min(1, 1 + p)`. Instruments render mono; the pan stage produces stereo.
- Solo-in-place: `audible = !mute && (anySolo ? solo : true)`, smoothed over 5 ms (project limit).
- Master: master chain → master volume (default −12 dB, maximum 0 dB) → master pan (balance) → `SafetyProcessor`.
- Track and master pan: −1 to +1, default 0, clamped through `ParamDef` and smoothed with τ 12 ms. Pan gains are computed per block from the smoothed value; per-sample work is two multiplies per channel.
- Summing is Float32 without clipping; only the safety stage limits.
- Meters: sample peak and sum of squares per report window per track and master; the UI applies 1 s peak hold and decay.

## Safety stage
### Audio path
Every sound W-Rack produces renders inside `EngineProcessor` and reaches `destination` only through `SafetyProcessor`. This includes instruments, audio clips, the metronome, note previews, drum-row auditions, preset auditions and sample-editor previews.
- No sound uses another `AudioContext`, an `<audio>` element, an `AudioBufferSourceNode` or any path around the safety stage.
- Every voice, instance and grain counts toward voice caps and polyphony auto-gain.
- Panic and all-notes-off stop every sound in the engine: sequenced notes, live notes, one-shot drum instances, trigger-mode sampler voices, previews and auditions. Effect buffers clear and the transport stops.
- Offline export renders through the same path.

### Stage order
Order per sample: guard → DC blocker → duck → limiter → fade → final clamp. The fade follows the limiter (audio-safety.md, Position), so the onset bound holds for any input level.

| Stage | Algorithm |
|---|---|
| Non-finite guard | If either channel is NaN, ±∞ or above 1e4 in magnitude: output 0, mute 250 ms, fade in over 50 ms (`g = x³`), post `guard`. The DC blocker and limiter reset at the faulty frame, so look-ahead samples cannot reach the muted output. |
| DC blocker | `y = x − x1 + R·y1`, `R = exp(−2π·10/fs)` (0.99869 at 48 kHz). |
| Sustained-level duck | A ring of block mean-squares covering 3 s (`ceil(3·fs/BLOCK)` entries) with a running sum. When `√mean > 0.2512` (−12 dBFS), gain ramps to 0.5 (−6 dB) over 50 ms and `duck` is posted. Gain returns only after `ack-duck`. |
| Look-ahead limiter | Ceiling `c = 0.8913` (−1 dBFS); look-ahead `L = ceil(0.0015·fs)` (72 frames at 48 kHz). |
| Fade | On `resume-fade` (transport start, context resume) and at node creation, gain ramps 0 → 1 over 50 ms along `g = x³`, which keeps the first 10 ms below 0.8 % of the ceiling. |
| Final clamp | `y = max(−c32, min(c32, y))`, where `c32` is the largest float32 ≤ `c` (0.8913 rounds up in a `Float32Array`). |

Limiter:
1. Required gain `r[n] = min(1, c/max(|l|, |r|, 1e-12))`.
2. Sliding minimum over the last `L` frames with a monotonic deque (a ring of indices, capacity `L + 1`): pop the back while its value ≥ `r[n]`; pop the front when its index ≤ `n − L`.
3. Boxcar average of the minimum over `L` frames with a running sum, recomputed from the ring every 4096 frames to bound drift.
4. Release `env = gs < env ? gs : env + (gs − env)·αrel`, τ 50 ms (project limit).
5. Output `y[n] = x[n − (L − 1)]·env`. Added latency is `L − 1` frames.

Session rules:
- No audio before the volume notice is acknowledged. The notice shows once per page session; the flag lives in memory.
- Panic (button, or `Escape` outside text fields) sends `panic` to the engine and `resume-fade` to the safety processor.
- Master volume defaults to −12 dB with a maximum of 0 dB, enforced by `ParamDef`.

## Offline export
1. Range: `[0, projectEndFrame)` or `[loopStartFrame, loopEndFrame)`, plus a 0–10 s tail. Totals above 10 minutes are rejected before rendering.
2. `new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: liveCtx.sampleRate })`.
3. `await ensureModule(offCtx)`.
4. Engine node with `processorOptions: { offline: true, seed, model, sources, mips, zones, masterVolumeDb, startFrame, totalFrames }`; `sources` holds `slice()` copies of the channel data (decoded again at the export rate where needed), cloned at construction; `mips` and `zones` bind samplers as live playback does. The metronome is off and the master volume is the saved setting. Safety node with `processorOptions: { offline: true }`, which starts the 50 ms fade-in as playback does. Connect engine → safety → destination.
5. `startRendering()`. The engine starts at `startFrame` and posts `progress`. The UI shows a determinate bar while `progress` arrives, otherwise an indeterminate one. `suspend()` is not used.
6. Determinism: fixed seeds, zeroed state, no time reads. Two exports in one browser have equal SHA-256 hashes.
7. One export runs at a time; the export button is disabled during rendering. Offline contexts are never created in loops.
8. Memory: `frames × 2 × 4` bytes for the render buffer (234.2 MB for 10 min 10 s at 48 kHz), plus the WAV output. References are released after the download starts.
9. During export, the live transport stops and the live context keeps running.

## WAV writer
| Format | Header | Fields |
|---|---|---|
| 16-bit PCM (default) | 44 bytes | `fmt ` size 16, `wFormatTag = 1`, `nBlockAlign = 4`, `wBitsPerSample = 16` |
| 24-bit PCM | 68 bytes | `fmt ` size 40, `wFormatTag = 0xFFFE`, `cbSize = 22`, `wValidBitsPerSample = 24`, `dwChannelMask = 0x3`, SubFormat `00000001-0000-0010-8000-00AA00389B71`, `nBlockAlign = 6` |
| 32-bit float | 58 bytes | `fmt ` size 18, `wFormatTag = 3`, `cbSize = 0`, `fact` chunk (size 4, `dwSampleLength`), `nBlockAlign = 8` |

- Little-endian throughout. `RIFF` size = file length − 8; `data` size = `frames·nBlockAlign`; odd chunks get a pad byte.
- 16-bit: TPDF dither `d = u1 − u2` LSB, `u1`, `u2` from `mulberry32(exportSeed)`; `q = clamp(round(x·32767 + d), −32768, 32767)`.
- 24-bit: `clamp(round(x·8388607), −8388608, 8388607)`, no dither.
- Float: samples copied unchanged.
- The writer fills one preallocated `ArrayBuffer` through a `DataView`.

## Decoding, hashing and peaks
- Per file, one at a time: `file.arrayBuffer()` → `sourceId = hex(await crypto.subtle.digest('SHA-256', bytes))` → `ctx.decodeAudioData(bytes.slice(0))`.
- An existing `sourceId` reuses the loaded source.
- A rejected decode shows "Could not decode <name>. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG." Other files continue.
- Decoded audio is limited to 20 minutes per project at the context rate (project limit).
- Peaks: module worker `/worklets/workers/peaks.js`, created with `new Worker(url, { type: 'module' })` from a plain string. It receives transferred channel copies and returns min/max pairs: level 0 at 256 frames per bucket, each level 4× coarser, up to at least 65 536 frames (project limit). Peaks are cached in memory by `sourceId`.

## UI timing and drawing
- Timeline, piano roll and waveforms draw on Canvas 2D in a `requestAnimationFrame` loop that reads refs. React renders structure and the accessible mirror only.
- The playhead is positioned with `style.transform` in the rAF loop; it is never React state:
  ```
  ts = ctx.getOutputTimestamp()
  audible = ts.contextTime·fs + (performance.now() − ts.performanceTime)/1000·fs
  playhead = last.playFrame + (audible − last.ctxFrame)   // wrapped into the loop when loopOn
  ```
- Only visible clips and notes are drawn; ranges come from binary search on sorted starts.
- Canvases scale by `devicePixelRatio` and redraw on `ResizeObserver`.
- Canvas views have a DOM mirror (`treegrid` for tracks and clips, `grid` for notes) with roving `tabindex` (`accessibility.md`). Pointer and keyboard edits call the same command functions.

## CPU budget
Target: at most 50% of a 128-frame quantum (1.33 ms at 48 kHz) for the worst-case project (project limit). Per-feature costs are design estimates verified by the benchmark.

| Feature | Work per sample | Maximum |
|---|---|---|
| Instrument voices | Oscillator, filter, envelope | 64 total |
| Granular | ≤ 64 grains × 2 interpolated reads | 4 voices |
| Audio clips | 1 read, 3 multiplies per channel | 32 overlapping |
| EQ | 3 biquads per channel | any slot |
| Filter | 1 SVF per channel | any slot |
| Compressor | `log10` + `pow` | any slot |
| Saturation | `exp` + `log1p` per channel | any slot |
| Delay | 2 interpolated reads + lowpass | any slot |
| Reverb | 24 delay taps per channel | 4 instances |
| Tracks | Gain, pan, meter | 16 |
| Drum machine | 16 metal-voice instances (estimate 8.4% of a quantum) | 9% of a quantum |
| Sampler | 16 stereo voices inside a loop crossfade (estimate 5.3%) | 7% of a quantum |

Benchmark: `tests/e2e/perf.spec.js` renders a 20 s stress project (16 tracks, 64 voices, 4 reverbs, 16 compressors, 16 saturators) offline and measures wall time on the main thread. Pass: realtime factor ≥ 4 in Chromium (project limit).
- The stress project (`tests/support/stress-model.js`) gives each of 16 instrument tracks a four-note chord held for 20 s, a compressor and a saturator, and a reverb on four tracks.
- Saturation processes dual-mono input (equal channels and equal state, as mono sources in a stereo chain produce) once and copies it to the right channel; the result is identical to the stereo path.

## Performance pitfalls
| Pitfall | Rule |
|---|---|
| Garbage collection from `process()` | No allocation; preallocate in constructors |
| Per-sample `pow`, `exp`, `tan` | Coefficients per block or on change; tables |
| Objects or closures per voice or event | Struct-of-arrays; plain `for` loops |
| `postMessage` every quantum | `REPORT_QUANTA`; main-thread sends coalesced per animation frame |
| Native nodes or `AudioParam`s | Two worklet nodes; zero `AudioParam`s |
| Denormals | Flush state below 1e-15 at block end |
| Fixed 128 | Read `outputs[0][0].length`; `BLOCK` internally |
| Polymorphic hot calls | Fixed kernel classes per slot; switch on an integer `kind` |
| Playhead in React state | Refs and rAF |
| Repeated decoding | Decode once per file; cache peaks by `sourceId` |

## Testing
- DSP unit tests run with `node --test "tests/dsp/**/*.test.js"`, importing `src/dsp` directly. Coverage:
  - tempo-map round trips
  - PolyBLEP aliasing below a threshold (DFT of a 5 kHz saw)
  - Karplus–Strong pitch error below 1 cent
  - limiter ceiling over 10⁶ random frames
  - biquad stability across parameter sweeps
  - ZIP and WAV byte layouts
  - determinism (two renders equal)
  - drum machine: kick fundamental 50 Hz ± 0.5 Hz; unmapped note 60 outputs exact zeros; closed hat silences an open hat within 64 frames; cowbell peaks at 540 and 800 Hz ± 2 Hz; two renders of a pattern are bit-identical; different `eventIndex` values give different noise
  - sampler: a 440 Hz source at root 69 plays 880 and 220 Hz within 1 cent; root + 25 allocates no voice; a 10 kHz source at +24 semitones stays ≤ −60 dB; the loop seam has no step larger than 1.5 × the loop body's largest step; a missing source outputs zeros and posts one `source-status`; the kernel's channel array is the engine's array (no copy)
  - Panic: drum instances, trigger-mode sampler voices and previews are silent within 20 ms of `panic`
- Within one JavaScript engine, renders compare bit-exact by SHA-256. Across engines, `Math.sin` and `Math.exp` can differ in the last bits; cross-browser comparisons use `maxAbsDiff ≤ 1e-4`, and golden hashes are stored per engine.
- Playwright projects `chromium`, `firefox` and `webkit` run offline renders through `window.__wrackTest`, present only when `NEXT_PUBLIC_TEST_HOOKS=1`. They assert repeat-export hash equality, non-silence and peak ≤ −1 dBFS. axe-core runs on every route.

## Unconfirmed
- CPU estimates for the drum machine and sampler assume 1 ns per operation; the benchmark replaces them.
- TR-808 values (hat highpass corners, cowbell bandpass, tom pitch drop, side-stick frequency pair) vary by unit and source.
- Static `import` between modules inside an AudioWorklet in Safari, Firefox and Chrome. Phase 7 includes a smoke test; the fallback is a single-file worklet produced by the copy script.
- Delivery of `progress` messages from an `OfflineAudioContext` worklet during rendering in every browser.
- Size limits on `processorOptions` for large sources.
- Single-thread rendering of all worklet nodes of one context in every engine.
- Safari rejection of offline contexts with a sample rate below 44 100 Hz.
- Safari `decodeAudioData` support for Ogg Vorbis and Opus.
- `AudioWorklet` inside `OfflineAudioContext` under Playwright WebKit on Linux CI.

## Sources
- W3C, Web Audio API 1.1 — https://www.w3.org/TR/webaudio-1.1/
- MDN, AudioWorkletGlobalScope.registerProcessor() — https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/registerProcessor
- MDN, BaseAudioContext.decodeAudioData() — https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- MDN, AudioContext.getOutputTimestamp() — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
- Chrome for Developers, Chrome 153 release notes (`renderSizeHint`) — https://developer.chrome.com/release-notes/153
- Mozilla Bugzilla 1265406 (OfflineAudioContext suspend) — https://bugzilla.mozilla.org/show_bug.cgi?id=1265406
- Next.js, Turbopack — https://nextjs.org/docs/app/api-reference/turbopack
- R. Bristow-Johnson, Audio EQ Cookbook — https://www.w3.org/TR/audio-eq-cookbook/
- V. Välimäki and A. Huovilainen, "Antialiasing Oscillators in Subtractive Synthesis," IEEE Signal Processing Magazine, 2007
- V. Zavalishin, The Art of VA Filter Design — https://www.native-instruments.com/fileadmin/ni_media/downloads/pdf/VAFilterDesign_2.1.0.pdf
- D. Giannoulis, M. Massberg, J. D. Reiss, "Digital Dynamic Range Compressor Design — A Tutorial and Analysis," JAES 60(6), 2012
- J. D. Parker, V. Zavalishin, E. Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution," DAFx-16
- J. O. Smith, Physical Audio Signal Processing (Freeverb, Schroeder allpass) — https://ccrma.stanford.edu/~jos/pasp/
- D. Jaffe and J. O. Smith, "Extensions of the Karplus-Strong Plucked-String Algorithm," Computer Music Journal 7(2), 1983
- K. J. Werner, J. S. Abel, J. O. Smith, "A Physically-Informed, Circuit-Bendable, Digital Model of the Roland TR-808 Bass Drum Circuit," DAFx-14; "The TR-808 Cymbal," ICMC/SMC 2014; "More Cowbell," AES 2014
- Roland Corporation, TR-808 Service Notes, 1981
- G. Reid, "Synth Secrets" drum synthesis articles, Sound On Sound, 2002
- O. Niemitalo, "Polynomial Interpolators for High-Quality Resampling of Oversampled Audio," 2001
- SFZ Format opcode reference — https://sfzformat.com/
- The MIDI Association, General MIDI Level 1 percussion key map — https://midi.org/
- J.-M. Jot and A. Chaigne, "Digital Delay Networks for Designing Artificial Reverberators," AES 90th Convention, 1991
