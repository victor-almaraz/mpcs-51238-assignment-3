# Overview

## Product
Wrack (identifier `wrack`) is a digital audio workstation that runs entirely in a web browser: an arrangement sketchpad with MIDI tracks played by built-in instruments, audio tracks with imported clips, track and master effects, WAV export and `.wrack` project files. It ships as a static site built with Next.js, React and Tailwind CSS. No server-side component processes, stores or observes user data. `assignment-3-scope.md` defines the build.

## Principles
| Principle | Requirement | Reference |
|---|---|---|
| Private | No accounts, tracking, telemetry or third-party requests. Data leaves the device only through user-initiated `.wrack` saves and WAV exports. | `privacy-and-security.md` |
| Local | Projects, working state, presets and settings stay in `localStorage`; imported audio stays in IndexedDB. | `assignment-3-scope.md`, Persistence |
| Open | The `.wrack` file is a documented STORE-only ZIP of `project.json` and the original audio files. | `project-file-format.md` |
| Safe | Bounded output: a fixed safety stage after the master, a volume notice before the first sound of a session, and Panic. | `audio-safety.md` |
| Accessible | Every operation is available by keyboard and to screen readers; WCAG 2.2 AA. | `accessibility.md`, `a11y-check.md` |

## Scope
In scope:
- One-screen editor: transport, arrangement timeline with MIDI and audio clips, and a dock with Editor, Devices and Mixer tabs
- Transport: play, pause, stop, locate, tempo, time signature, loop, metronome
- Piano roll with a velocity lane, step input, quantize and clip looping
- Non-destructive audio clip editing: split, join, trim, move, duplicate, fades, crossfades, clip gain and gain envelopes
- Built-in instruments: subtractive, FM, additive, pluck, granular, drum machine, sampler
- Effects on every track and the master: EQ, filter, compressor, saturation, distortion, delay, reverb
- Mixer: track volume, pan, mute and solo; master volume and pan; peak meters and clip indicators
- Input: computer keyboard and Web MIDI, played on armed or selected instrument tracks
- Undo and redo, a command palette and a shortcut overlay
- Personal preset library for instruments and effects
- Export: WAV (16-bit dithered, 24-bit, 32-bit float); `.wrack` save and open

Out of scope:
- Recording, buses, sends, automation
- Plugins (WAM 2.0, VST, AU, CLAP)
- OSC and Web Serial
- DAWproject and SMF import and export; compressed export formats; stems
- Stretched audio
- Collaboration, accounts, cloud sync, server-side processing
- Video, notation

`storage.md`, `audio-streaming.md`, `recording.md`, `plugins-wam.md`, `osc-web-serial.md` and `core-and-scaffolding.md` describe a wider design that this build does not implement (`assignment-3-scope.md`, Main documents).

## Platform support
| Capability | Chromium desktop | Firefox desktop | Safari macOS |
|---|---|---|---|
| Support level | Supported | Supported | Supported |
| AudioWorklet engine and `OfflineAudioContext` export | Yes | Yes | Yes |
| Web MIDI | Yes, after the permission prompt | Yes, with Firefox's site-permission add-on | No |
| `.wrack` and WAV saving | File picker (`showSaveFilePicker`) | Download | Download |
| Imported audio in IndexedDB | Yes | Yes | Yes; site data can be deleted after 7 days without a visit, and private windows keep audio for the session only |

Narrow and mobile viewports are not checked. Web MIDI and the file picker are feature-detected at run time. The end-to-end suite runs in Chromium, Firefox and WebKit (`testing-and-acceptance.md`).

## Glossary
| Term | Definition |
|---|---|
| Tick | Integer unit of musical time; 960 per quarter note. |
| Frame | One sample instant across all channels at the context sample rate. |
| Render quantum | The block of frames the audio thread processes per `process()` call; code reads its length on every call. |
| Clip | A placed region on a track that references a Source (audio) or holds notes (MIDI). |
| Source | An imported audio file, identified by the SHA-256 of its bytes (`sourceId`). |
| Track | Timeline lane of kind `instrument` or `audio`; the master is a track of kind `bus`. |
| Channel strip | The per-track mixer controls: fader, pan, mute, solo, meter and clip indicator. |
| Device | A processing unit on a track: a built-in instrument or a built-in effect. |
| Working state | Per-project view state stored apart from the project: playhead, loop, zoom, scroll, selection, open panel, dock tab, snap and armed tracks. |
| Engine node | The `AudioWorkletNode` hosting the sequencer, built-in devices and mixer. |
| Safety stage | The final processor before the destination (`audio-safety.md`). |
| Edit cursor | The playhead position in the working state; split, audio import and timeline keyboard edits act at it. |

## Prior art
| System | Relevance |
|---|---|
| openDAW (André Michelle) | Open-source browser DAW built on AudioWorklets. |
| Audiotool, BandLab, Soundtrap | Browser DAWs with server storage and accounts. Wrack excludes this model. |
| REAPER + OSARA | Screen-reader access to a DAW: edit-cursor reports by measure, beat and grid; keyboard context menus. |

## Sources
- Web Audio API 1.1 — https://www.w3.org/TR/webaudio-1.1/
- MDN Web MIDI API — https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API
- MDN Window.showSaveFilePicker() — https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
- openDAW — https://github.com/andremichelle/openDAW
- OSARA — https://osara.reaperaccessibility.com/
