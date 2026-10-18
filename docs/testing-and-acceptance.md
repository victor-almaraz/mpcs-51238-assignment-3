# Testing and acceptance

## Test layers
| Layer | Tool | Location | Command |
|---|---|---|---|
| Unit | Node test runner (`node --test`) | `tests/dsp/*.test.js` | `pnpm test:dsp` |
| End-to-end | Playwright in Chromium, Firefox and WebKit, with `@axe-core/playwright` | `tests/e2e/*.spec.js` | `pnpm test:e2e` |
| CPU benchmark | Playwright in Chromium (project `perf`) | `tests/e2e/perf.spec.js` | `pnpm test:e2e`; alone: `pnpm test:e2e --project=perf --no-deps` |
| Lint | ESLint, with environment rules for `src/dsp` and `src/worklet` | `eslint.config.mjs` | `pnpm lint` |

Every command runs with `PATH=$PWD/.tools/node/bin:$PATH`. `pnpm e2e:install` installs the three Playwright browsers into `.tools/ms-playwright`.

Shared helpers are in `tests/support/`:

| File | Content |
|---|---|
| `editor.js` | Editor helpers for end-to-end specs: track rows in the "Tracks and clips" treegrid and the dock tabs |
| `memory-storage.js` | In-memory `Storage` with a character quota, for the persistence, project-store and preset unit tests |
| `signal.js` | Signal analysis for DSP tests (Goertzel tone magnitude and related measures) |
| `stress-model.js` | The CPU-benchmark stress project: 16 instrument tracks, 64 voices, a compressor and a saturator on every track, a reverb on four, 20 s at 120 BPM |

## End-to-end configuration
`playwright.config.js` sets these values:

| Setting | Value |
|---|---|
| Target | The static export, built with `pnpm build` and served by `scripts/serve-out.mjs` on `PORT` (default 3100) with the `vercel.json` rewrites and headers; `BASE_URL` targets a deployment instead and starts no local server |
| Projects | `chromium`, `firefox`, `webkit`; `perf` (Chromium) depends on the three and runs after them, so no other worker shares the CPU |
| Timeout | 60 s per test |
| Retries | 1 on CI, 0 locally |

## Unit tests
| File | Coverage |
|---|---|
| `additive.test.js` | Harmonic pitch and levels, 1/max(1, Σh) normalisation, harmonics above 0.45·fs omitted, recursion accuracy, voice cap and determinism |
| `clips.test.js` | Audio clip commands: add, split and join, trim, move, delete with unused-source removal, track removal, rename and colour validation; split clips render like the unsplit clip |
| `core.test.js` | DSP constants, parameter definitions, clamping, enum and stepped parameters, normalised scales |
| `drums.test.js` | Drum machine parameters, General MIDI map, unmapped notes, kick and cowbell frequencies, hat choke, voice polyphony |
| `effects.test.js` | Effect registry, parameter clamping, bounded output under sweeps, delay feedback and tempo sync, reverb T60, compressor curve, EQ response |
| `engine.test.js` | Transport, metronome, sample-accurate loop wrap, quantum-length independence, tempo and meter placement |
| `fm.test.js` | Carrier pitch, sideband placement, index clamp below 0.45·fs, index decay, voice cap, bit-identical renders |
| `granular.test.js` | Sources, voice and grain caps, density, pitch, amplitude bound, release, seeded renders |
| `imports.test.js` | Every named import from `react` is a React export |
| `instrument-params.test.js` | Reference parameter sets with ranges and defaults; ADSR, filter envelope, FM fine, additive vibrato, pluck pick position |
| `live-input.test.js` | Flood limiter, live events, preview note IDs, live notes across stop and loop wraps, computer-keyboard mapping and octave range, modifier and text-entry filtering |
| `midi-commands.test.js` | MIDI clip and note commands, clamping, quantize, note lookup, loop expansion |
| `mixer.test.js` | Pan laws, fader range, solo-in-place and mute, master balance, meters, parameter changes without a new model |
| `persistence.test.js` | 500 ms save debounce, flush, failed saves, project deletion, working-state storage and normalisation |
| `pluck.test.js` | Pitch accuracy at 44.1 and 48 kHz, allpass tuning, delay-length limit, T60 decay, loop-gain cap, DC, seeded excitation, release |
| `presets.test.js` | Preset name rules, the 200-preset limit, load validation, rename and delete, apply, presets kept out of project JSON |
| `project-store.test.js` | Project creation and listing, unreadable and missing projects, quota errors, example copies saved on first edit, example content |
| `safety.test.js` | Limiter ceiling (0.8913) and recovery, guard on NaN, ±Infinity and large values, DC blocker, sustained-level duck |
| `sampler.test.js` | Interpolators, half-band filter and mips, parameters, marker constraints, pitch accuracy, ±24-semitone range, alias suppression |
| `smoke.test.js` | Processor names and stereo rendering |
| `subtractive.test.js` | Pitch, waveforms, PolyBLEP aliasing, per-instrument and global voice caps, voice stealing, cutoff clamp, envelope |
| `timing.test.js` | Tempo map (steps and linear ramps), meter map across meter changes, validation |
| `ui-helpers.test.js` | Pan readout parsing, fader taper shared by marks and meters, parameter grouping into sections |
| `validate.test.js` | New-project validation and error texts, untitled names, IDs, the default project, ticks per bar |
| `wav.test.js` | WAV headers for 16-bit, 24-bit and 32-bit float; deterministic TPDF dither |
| `zip.test.js` | CRC-32, ZIP writer headers, round trip, unsafe paths, size limit, archive validation rules |

## End-to-end specs
| File | Coverage |
|---|---|
| `a11y.spec.js` | axe-core on every route, every dock tab and dialog states; unique names per landmark; primary controls by role and name; a keyboard-only main flow |
| `archive.spec.js` | `.wrack` save and open in a fresh profile, Restore audio or Replace project, damaged files |
| `audio-import.spec.js` | Audio import, IndexedDB persistence, capacity and decode errors, keyboard clip editing, Join reasons, clip properties, source cleanup, granular File source, sampler markers and missing sources, stored audio in Settings |
| `audio.spec.js` | Silent page loads, the volume notice, Play, Pause, Stop and Go to start, metronome setting, tempo edits, instrument panels, example playback, the mixer, Panic, computer-keyboard notes and octave, Web MIDI states, instrument change in place |
| `editor-tools.spec.js` | Command palette, clip menu, marquee selection, on-clip fade, gain and envelope handles |
| `effects.spec.js` | Track and master chains, the four-reverb limit, playback through chains, Distortion |
| `export.spec.js` | Bit-identical 16-bit exports, WAV header sizes, float peak at most −1 dBFS, silent clips, range limit, Cancel |
| `home.spec.js` | First and return visits, example copies, unreadable saved data |
| `levels.spec.js` | Track clip indicators, the safety limiter at the end of the master chain |
| `loop.spec.js` | Loop band in the ruler, drawing a loop, keyboard loop handles, playback past the loop end |
| `new-project.spec.js` | New-project defaults, validation, focus on errors, blur validation, the empty instrument track, full storage |
| `perf.spec.js` | Stress project renders at least 4× faster than real time in Chromium |
| `persistence.spec.js` | Working-state restore, writes on page hide, corrupted data, missing audio, quota errors, Settings options, Projects list and deletion |
| `pianoroll.spec.js` | Keyboard and pointer note editing, the DOM mirror, Quantize and loop length, step input, drum rows and auditions, previews |
| `presets.spec.js` | Presets across projects, Save preset errors, the 200-preset limit, rename and delete in Settings, Preview |
| `project-list.spec.js` | Recent metadata and origin, rename and duplicate on Projects |
| `routes.spec.js` | Landmarks, one `h1` and axe-core per route, current-location marking, skip link, unknown projects, the editor shell for any `/projects/<id>`, header navigation |
| `smoke.spec.js` | Home renders, the worklet is served with `Cache-Control: no-cache` and registers, the safety processor limits and fades in |
| `ux-fixes.spec.js` | Clip drag by the grid, undo and redo, tempo edits during playback, the one-screen editor, sticky ruler and loop handles, clip and track rename, arming for live input |
| `velocity.spec.js` | Velocity lane by keyboard and by drag |
| `workspace.spec.js` | Empty-timeline next steps, page-wide single-key shortcuts that leave note keys alone, the shortcut overlay, collapsible panels, icon-control tooltips, knobs, vertical mixer strips |

## Acceptance criteria
| Area | Criterion | Test |
|---|---|---|
| Safety | No sample above 0.8913 (−1 dBFS) over 10⁶ random frames with peaks of 10; a NaN gives 250 ms of silence, then a 50 ms fade-in; −6 dB duck after 3 s above −12 dBFS RMS | `safety.test.js` |
| Timing | Loop wrap is sample-accurate inside a quantum; output does not depend on the quantum length | `engine.test.js` |
| Instruments | Pitch within 1 cent; renders with fixed seeds repeat bit for bit | Instrument unit tests |
| Export | Two 16-bit exports of one project are bit-identical; headers are 44, 68 and 58 bytes; the float peak is at most −1 dBFS | `export.spec.js`, `wav.test.js` |
| Audio start | No `AudioContext` exists before a sound-producing action | `audio.spec.js` |
| CPU | The stress project renders at least 4× faster than real time in Chromium | `perf.spec.js` |
| Accessibility | No axe-core violations for tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice` | `a11y.spec.js` and others (`a11y-check.md`) |

## Sources
- Node.js test runner — https://nodejs.org/api/test.html
- Playwright — https://playwright.dev/
- axe-core — https://github.com/dequelabs/axe-core
