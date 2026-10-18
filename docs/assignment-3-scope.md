# Assignment 3 scope

## Scope
This document defines the W-Rack build for Assignment 3 (Patterns & Flows). Where it conflicts with another doc, this document takes precedence for this build. Implementation details are in `a3-audio-implementation.md`; build order, checks and prompts are in `a3-agent-plan.md`.

## Build rules
- Coding agents write all code under user direction. The core/scaffolding boundary in `core-and-scaffolding.md` does not apply.
- Every change is made by directing the agent; each build step ends in at least one commit.
- All code is JavaScript (ES2022 modules, `.js` and `.jsx`). TypeScript is not used.

## Constraints
| Area | Requirement |
|---|---|
| Stack | Next.js (App Router), React, JavaScript, Tailwind CSS, pnpm |
| Hosting | Vercel Hobby plan |
| Runtime packages | Next.js, React and Tailwind CSS only |
| Development tooling | ESLint, Playwright, axe-core |
| In-project code | All audio, MIDI, WAV and ZIP code |
| Persistence | `localStorage` for projects, working state, presets and settings; IndexedDB for audio sources only (Audio persistence). No OPFS, Cache Storage, service worker, cookies or sessionStorage. |
| Network | No database, accounts, external APIs or third-party requests |
| Threads | No `SharedArrayBuffer` and no COOP or COEP headers. The main thread and the audio thread communicate through `MessagePort` with transferables. |
| Worklet loading | Worklet and worker modules are copied from `src/` into `public/worklets/` by a build script and loaded by plain URL |
| Render quantum | Code reads the frame count of each `process()` call; no fixed 128 |

## Product
W-Rack for Assignment 3 is an arrangement sketchpad: MIDI tracks played by built-in instruments, audio tracks with imported clips, track and master effects, WAV export and project files.

### Required
| Area | Requirement | Reference |
|---|---|---|
| Transport | Play, stop, locate, tempo, meter, loop, metronome | Transport |
| Instruments | Subtractive, FM, additive, pluck, granular, drum machine, sampler | Instruments |
| MIDI clips | Piano roll; computer-keyboard input; Web MIDI where supported | MIDI |
| Audio clips | Import from files; clip management | Audio clips |
| Mixer | Track gain, pan, mute, solo; master volume and pan | Mixer |
| Effects | Track and master effect chains | Effects |
| Export | WAV export | Export |
| Project files | `.wrack` save and open | `.wrack` archive |
| Presets | Personal library of instrument and effect presets | Presets |
| Safety | Safety stage and limits | Safety |
| Labeling | Every interactive element labeled | Labeling |

### Out of scope
Recording, buses, sends, automation, plugins, OSC and Web Serial, DAWproject import and export, stretched audio.

## Main flow
> I open an example or start a project → I make it my own and save the sounds I like → I come back and pick up exactly where I left off.

## Routes
| Route | Purpose |
|---|---|
| `/` | Home: create, load, examples; recent projects on a return visit |
| `/new` | New project form |
| `/projects` | Saved projects list |
| `/projects/[id]` | Editor for one project (client-only) |
| `/settings` | Audio and MIDI status, saved settings, preset library, storage and stored-audio usage, "Clear all data" (removes every W-Rack `localStorage` key and the `w-rack` IndexedDB database) |

- A shared header on every route shows the current location and links to Home, Projects and New project.
- An unknown project ID shows "Project not found" with links to Projects and New project.

## Home
Home is the first screen on every visit. It never shows an empty workspace.

| Section | Content | Shown |
|---|---|---|
| Recent | Saved projects, most recently edited first, each with name, last-edited date and "Continue" | Return visits only |
| Create | "New project", which opens `/new` | Always |
| Load | "Open .wrack file" (`.wrack` archive) | Always |
| Examples | Three example project cards | Always |

- The page loads silently. No `AudioContext` exists before the first sound-producing action.
- On a first visit (no W-Rack keys in `localStorage`), the Examples section follows Create and Load, and a one-sentence description of W-Rack heads the page.

## Examples
| Example | Content |
|---|---|
| Beat | Drum machine (GM notes 36, 38, 42, 46, 49), Subtractive bass, FM lead stab; compressor on the drums, saturation on the bass, distortion on the lead stab |
| Ambient | Granular texture, Additive pad; filter and reverb on the texture, delay on the pad |
| Pluck melody | Pluck lead with delay, Subtractive bass, EQ on the master |

- Together the examples use the six synthesized instruments and every effect type. The sampler appears in no example, because examples contain no audio.
- An example opens in the editor stopped. Play is the highlighted primary action, with the hint "Press Play to hear this example".
- Opening an example creates a copy. The copy is saved as the user's project on its first edit; the example itself never changes.
- Examples are MIDI-only, so they open complete on every visit.

## Volume notice
- The first sound-producing action of a page session (Play, a keyboard or MIDI note, auditioning a preset) opens the volume notice: "Turn your device volume down. W-Rack is about to play sound."
- The notice has `Continue`, `Cancel` and an unchecked checkbox "Don't show this again on this device".
- `Continue` creates and resumes the `AudioContext`, loads the worklet and performs the action, with a 50 ms fade-in. `Cancel` performs nothing.
- Without the checkbox, the notice shows once per page session; the flag is held in memory.
- With the checkbox, the choice is stored in `w-rack:v1:settings` and the notice does not show again. `/settings` provides "Show the volume notice again". Turning off "Remember settings on this device" also restores the notice.
- The safety stage, the −12 dB master default and the no-sound-on-load rule apply whether or not the notice shows.
- Example cards on Home do not preview sound.
## New project form
One column; every field has a visible label.

| Field | Control | Rule | Error text |
|---|---|---|---|
| Name | Text input | 1–60 characters after trimming; prefilled "Untitled project N", where N is the lowest unused number | "Enter a project name." / "Use 60 characters or fewer." |
| Tempo | Number input | Integer 40–240; default 120 | "Enter a tempo between 40 and 240." |
| Time signature | Two selects: beats per bar (1–32) over a note value (1, 2, 4, 8, 16 or 32) | Default 4/4 | — |

- Validation runs on submit and on blur of an edited field.
- Each error appears below its field, linked with `aria-describedby`, and the field gets `aria-invalid="true"`. On submit, focus moves to the first invalid field.
- Entered values remain when errors show.
- Duplicate names are allowed; the projects list shows last-edited dates.
- On success, the project is saved and the editor opens with one empty instrument track. The empty editor shows "Press a key or click the grid to add a note", "Add audio file" and the keyboard map.

## Coming back
Condition: at least one saved project.

### Resume where you left off
Each project restores its working state on open:

| State | Restored |
|---|---|
| Playhead position | Yes |
| Loop range and loop on/off | Yes |
| Zoom and scroll | Yes |
| Selected track and selected clips | Yes |
| Open editor panel (piano roll or clip view) and the clip it shows | Yes |
| Transport | Always stopped |

- Home's Recent section lists projects; "Continue" opens the most recent project with its working state restored.
- Projects with audio clips open with their MIDI, settings and stored audio complete (Audio persistence). Clips whose audio is not available show "Audio not loaded", and a secondary action "Open .wrack file to restore audio" appears in the editor toolbar.

### Presets
A personal library of named instrument and effect settings, stored separately from projects.

- "Save preset" on any instrument or effect opens the Save preset dialog.
- Presets appear in every project's instrument and effect pickers, grouped as "My presets" above the built-in settings.
- `/settings` lists presets with rename and delete.
- Drum machine presets store all 73 parameters. Sampler presets store parameters and zones; zones store `sourceId` and source name, never audio. Applying a sampler preset without its source shows "Audio not loaded: <source name>".
- The library holds at most 200 presets (project limit). Saving another preset when the library is full shows "The preset library is full. Delete a preset in Settings to save a new one."

Save preset dialog (one column, visible labels):

| Field | Control | Rule | Error text |
|---|---|---|---|
| Name | Text input | 1–40 characters after trimming; unique within the same instrument or effect type | "Enter a preset name." / "Use 40 characters or fewer." / "A preset with this name already exists for <type>. Choose another name." |

- Errors follow the New project form rules; the entered name remains on error.

### Saved settings
- "Remember settings on this device" in `/settings` is on by default. When off, settings reset on each visit and `w-rack:v1:settings` is removed.
- Saved settings: master volume, keyboard octave, default export format, metronome on/off, volume-notice dismissal.

## Persistence
| Key | Content |
|---|---|
| `w-rack:v1:index` | Project summaries: ID, name, last-edited date, last archive-save date |
| `w-rack:v1:project:<id>` | Project JSON with `schemaVersion: 1`; clip and source metadata only |
| `w-rack:v1:view:<id>` | Working state of one project (Resume where you left off) |
| `w-rack:v1:presets` | Preset library: name, type, parameter values, created date |
| `w-rack:v1:settings` | Saved settings (Saved settings) |

- Saves are debounced to 500 ms after the last edit (project limit) and flushed on `pagehide`. Working state saves separately from the project, so view changes do not rewrite project data.
- Reads parse inside a guard. Unreadable data shows "A saved project could not be read." and never crashes the app.
- `QuotaExceededError` keeps the previous saved state and shows "This device's browser storage is full. Save a .wrack file, then delete unused projects."
- `localStorage` holds 5 MiB per origin and stores strings at 2 bytes per code unit. `/settings` shows estimated usage; above 4 MiB (project limit) a warning appears.
- Audio is never stored in `localStorage`; audio sources persist in IndexedDB (Audio persistence).

## Audio persistence
Imported audio sources persist on the device in IndexedDB. Projects, working state, presets and settings stay in `localStorage`.

| Item | Specification |
|---|---|
| Database | `w-rack`, version 1 |
| Object store | `sources`, key path `sourceId` |
| Record | `{ sourceId, name, mimeType, size, sha256, bytes }`, where `bytes` is a `Blob` of the original file bytes |
| Write time | Once, after a successful import |
| Sharing | One record per `sourceId`; projects that use the same file share it |
| Removal | When no saved project references the source; from `/settings`; by "Clear all data" |
| Persistence request | `navigator.storage.persist()` on the first audio import, from that user action |
| Capacity check | `navigator.storage.estimate()` before each import; an import that would leave less than 10% of quota free is session-only |
| Limits | 20 minutes of decoded audio per project (project limit) |

- Records hold original file bytes, never decoded PCM. Sources decode on project open.
- An import is **session-only** when the capacity check fails, when the write fails with `QuotaExceededError` or another IndexedDB error, or when the record cannot be read back after the write (WebKit private windows complete the write but keep no `Blob`). The import result shows "This browser could not store <name>. Save a .wrack file to keep this audio." Stored records are never evicted to make room.
- Each audio clip shows "Saved on this device" or "Session only" in its properties panel and accessible name.
- "Audio not loaded" appears only for sources absent from both memory and the store, for example after the browser deletes site data.
- Safari can delete script-writable storage after 7 days without user interaction. `/settings` states this in Safari and recommends `.wrack` backups.
- `/settings` shows stored audio usage from `navigator.storage.estimate()` and lists stored sources with the projects that use them.
- `.wrack` archives include every loaded source.
- IndexedDB access lives only in `src/lib/storage/audio-store.js`.

### Sampler sources
- Sampler zones reference sources by `sourceId`. Sampler sources and audio-clip sources share one source table and the audio store, and `.wrack` archives carry them alike.
- A source stays loaded while any audio clip or sampler zone references it.
- Sampler sources count toward the 20-minute decoded-audio limit. Sampler mip levels count toward a 64 MB limit (project limit).
- A sampler whose source is not available shows "Audio not loaded: <source name>" on the device and outputs silence. Importing a file with the same SHA-256, opening a `.wrack` file that carries it, or choosing another source rebinds the sampler.

## Transport
- Play, stop, locate, tempo, meter, loop and metronome.
- Time is integer ticks at PPQ 960, with a tempo map and a meter map (`transport-and-timing.md`).
- Event timing is sample-accurate inside the worklet; loop wraps occur within the quantum.

## Instruments
All seven instruments are kernels inside one engine processor (`instruments.md`, `a3-audio-implementation.md`).

| Instrument | Parameters and rules |
|---|---|
| Subtractive | Waveform sine, square, saw, triangle (band-limited); cutoff 40–16 000 Hz (log); resonance 0–20 dB; filter envelope 0–6 octaves, capped at 0.45·fs; ADSR (attack 0.002–2 s, decay 0.01–4 s, sustain 0–1, release 0.01–4 s) |
| FM (two-operator) | Ratio 0.5–12 in steps of 0.5; fine −0.5 to 0.5; index 0–20 with `I_max = max(0, (0.45·fs − f_c)/f_m − 1)`; index decay; ADSR |
| Additive | Eight harmonics, normalised by `max(1, Σh)`; harmonics above `0.45·fs` omitted; ADSR; vibrato rate 0.5–12 Hz and depth 0–100 cents |
| Pluck | Damping, brightness, pick position 0–0.5, decay T60, release T60 after note-off; `ρ = 10^(−3/(T60·f)) ≤ 0.9999`; allpass `C = (1 − d)/(1 + d)`; DC blocker; seeded noise |
| Granular | Sources saw, noise, chord and an audio file (first 20 s); position 0–1; grain size 0.01–0.25 s; density 2–60 grains/s; spray 0–1; pitch spread 0–1200 cents; attack; release; ≤ 4 voices, ≤ 64 grains |
| Drum machine | 14 synthesized voices, no samples; per voice level, tune, decay, tone, pan; kit level, velocity sensitivity, choke; General MIDI percussion map (21 notes); unmapped notes silent; note-off ignored; closed and pedal hat choke open hat; crash and ride layer 2 instances |
| Sampler | One user-imported source per device; root note, fine tune, start and end, loop mode (off, forward, ping-pong) and points, loop crossfade, trigger or gate, ADSR, lowpass with envelope amount, velocity sensitivity, poly or mono with glide, pan, level; ±24 semitones from the root note; one zone covering every key in this build |

The five synths share an Octave (−3 to 3) and Cents (−100 to 100) tuning. Shared by all seven: velocity gain `0.3·(vel/127)²` (drum machine and sampler scale it by velocity sensitivity); seeded `mulberry32`; 16 voices per instrument and 64 global, with stealing; polyphony auto-gain `min(1, 2/√voices)`; Panic and all-notes-off end every voice, including one-shot drum hits and trigger-mode sampler voices.

## MIDI
- MIDI clips are edited in a piano roll and can loop.
- Computer keyboard: `KeyA`–`KeyK` map to C–C; `KeyZ`/`KeyX` change the octave.
- Web MIDI: Chrome and Edge; Firefox after it installs its generated site-permission add-on, with devices connected before Firefox starts; not Safari. Access is requested on user action; each case shows status text.
- Flood limit: 200 note-ons/s.
- Drum machine tracks map note numbers through the General MIDI Level 1 percussion key map: 35, 36 kick; 37 side stick; 38, 40 snare; 39 clap; 41, 43 low tom; 42 closed hat; 44 pedal hat; 45, 47 mid tom; 46 open hat; 48, 50 high tom; 49, 57 crash; 51, 59 ride; 56 cowbell; 75 claves.
- Unmapped notes on drum tracks are stored and editable, and produce no sound. Note length has no effect on drum sound.
- On drum tracks the piano roll labels each row with note number, voice and GM name, for example "36 Kick (Bass Drum 1)" (`design-patterns.md`, `PR-04`).

## Audio clips
- "Add audio file" accepts multiple files. Files decode with `decodeAudioData`, which resamples to the context rate. Each file becomes a clip at the edit cursor on the selected audio track, or on a new audio track.
- Supported formats: WAV, MP3, AAC/M4A, FLAC, Ogg (browser-dependent). A failed decode shows "Could not decode <name>. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG."; other files continue.
- Decoded audio is limited to 20 minutes per project (project limit). A file that would exceed the limit is not added and shows "<name> was not added. A project can hold up to 20 minutes of audio."; other files continue.
- Clip offsets are stored in frames with `project.audioRate` and scaled when the context rate differs.

| Operation | Requirement |
|---|---|
| Select | Single, range (`Shift`), additive (`Ctrl`/`Cmd`); keyboard selection by edit cursor |
| Move and reorder | Drag or keyboard nudge by grid step; between tracks of the same kind only |
| Duplicate | Copy placed immediately after the original |
| Delete | Removes the clip; the source stays in memory while any clip references it |
| Split | At the edit cursor or pointer position |
| Join | Adjacent clips with the same source and contiguous offsets; otherwise the command states why it is unavailable |
| Trim | Start and end, by handle or by keyboard grid step |
| Clip gain | −∞ to +12 dB (project limit) |
| Fades | Fade-in and fade-out; curves `linear`, `equalPower`, `exp` |
| Crossfade | Overlapping clips on one track crossfade over the overlap, `equalPower` by default |
| Gain envelope | Per-clip breakpoints, linear gain −∞ to +6 dB per point (project limit), linear segments, applied per sample |
| Loop | A MIDI clip repeats its notes, and an audio clip its source window, to fill its length |
| Rename and colour | Per clip |

## Mixer
- Every track has gain (−∞ to +6 dB), pan, mute and solo-in-place.
- The master has volume (default −12 dB, maximum 0 dB) and pan.
- Pan range: −1 (full left) to +1 (full right), default 0 (centre), displayed as "L20", "C", "R20". Double-click or Delete resets pan to centre.
- Track pan uses constant power for mono sources and balance for stereo sources. Master pan uses balance.
- Pan is smoothed like every gain parameter and saved with the project.
- At most 16 tracks (project limit).

## Effects
- Every track and the master have a chain of up to eight effects (project limit). The master chain runs before the safety stage.

| Effect | Parameters |
|---|---|
| EQ (3-band) | Low shelf, peak, high shelf: frequency, gain; peak Q |
| Filter | Lowpass, highpass, bandpass; cutoff; resonance |
| Compressor | Threshold, ratio, attack, release, makeup |
| Saturation | Drive, tone, mix, output |
| Distortion | Soft clip, hard clip or foldback; drive, bias, tone, mix, output (at most 0 dB) |
| Delay | Time in ms or tempo-synced; feedback ≤ 0.9; high-cut; mix |
| Reverb | Size, decay 0.2–10 s, damping, pre-delay, mix |

- Ranges and defaults are in `a3-audio-implementation.md`.
- At most four reverb instances per project (project limit).
- Feedback loop gain stays below 1. Every effect has bypass and parameter smoothing.
- Non-finite output resets and bypasses the effect and shows "Effect <name> on <track> was reset and bypassed."

## Safety
The safety stage is the last processor, live and offline (`audio-safety.md`).

| Rule | Value |
|---|---|
| Limiter | Sample peak, ceiling −1 dBFS, 1.5 ms look-ahead |
| Non-finite guard | Mute 250 ms, then 50 ms fade-in |
| DC blocker | 10 Hz |
| Sustained-level duck | −6 dB while 3 s RMS exceeds −12 dBFS; holds until acknowledged |
| Master volume | Default −12 dB, maximum 0 dB |
| Fades | 50 ms on start and resume |
| Load | No sound on load; volume notice once per session |
| Panic | Panic button and `Escape` outside text fields; ends every voice, one-shot hit, preview and audition |
| Audio path | Every sound renders in the engine and passes the safety stage; no preview or audition uses another path |
| Parameters | `ParamDef` clamping; smoothing τ 10–15 ms |
| MIDI flood limit | 200 note-ons/s |

## Export
- "Export WAV…" in the File menu opens a dialog with range (whole project or loop), format and tail (0–10 s, default 2 s).
- Formats: WAV 16-bit with TPDF dither (default), 24-bit (`WAVE_FORMAT_EXTENSIBLE`), 32-bit float (format 3 with a `fact` chunk).
- Rendering uses an `OfflineAudioContext` running the same worklet graph, safety stage included. Project data and audio sources pass through `processorOptions`.
- Export length is at most 10 minutes plus tail; longer ranges show "Export ranges are limited to 10 minutes."
- Clips without loaded audio render as silence; the dialog lists them before export.
- Progress comes from engine messages: determinate while messages arrive, indeterminate otherwise.
- One export runs at a time. Repeated exports of the same project and settings in one browser are bit-identical.

## `.wrack` archive
- Format: STORE-only ZIP with CRC-32. Contents: `project.json` and `audio/<sourceId>.<ext>` holding original file bytes.
- Assembly: in memory as `Blob` parts; at most 500 MB (project limit). Larger saves show "This project is too large to save as one file."
- Save: `showSaveFilePicker` in Chromium; `<a download>` elsewhere.
- An indicator next to the File menu shows "Not saved to file" while loaded audio or edits are newer than the last archive save. `beforeunload` prompts while an edit is not yet saved on the device, or while session-only audio (not stored on the device) is missing from the last archive save.
- Open:

| Archive project ID | Action |
|---|---|
| Matches a saved project | Dialog: "Restore audio" (load matching sources, keep current edits) or "Replace project" |
| No match | Import as a new saved project |

- Sources match by `sourceId` (SHA-256). A clip whose source is missing stays marked "Audio not loaded".
- Validation (project limits): no `..`, absolute or backslash paths; ≤ 1000 entries; no duplicate paths, compared case-insensitively; method 0 only; no encryption flag; sizes consistent with the file; total ≤ 500 MB; `project.json` ≤ 5 MB with JSON depth ≤ 64; CRC verified. A failing archive imports nothing and lists the errors.

## Labeling
Every interactive element has a role and an accessible name, with visible text or a visible label where space allows. The same names serve screen readers and browser automation agents.

| Element | Requirement |
|---|---|
| Buttons | Visible text, or `aria-label` on icon-only buttons; names state action and target ("Mute Drums") |
| Inputs, selects, sliders | `<label>` or `aria-labelledby`; sliders expose value text with units ("−6.0 dB") |
| Toggles | `aria-pressed` with a constant name |
| Tracks and clips | Names such as "Track 2: Bass, FM synth" and "Clip: Verse riff, bar 5 to bar 9" |
| Canvas views | DOM mirror per `accessibility.md` (`treegrid` timeline, `grid` piano roll); the canvas is `aria-hidden` |
| Dialogs | `<dialog>` with `aria-labelledby` its heading; focus moves inside on open and returns on close |
| Status and errors | Polite live region for saves and imports; errors linked to their fields |
| Uniqueness | Names are unique within their landmark, so a role-and-name query identifies one element |

- No interactive `div` or `span` lacks a role, name and keyboard handling.
- axe-core runs on every route, and a test queries each primary control by role and name.

## Accessibility
- `accessibility.md` applies, including keyboard operation of the editor and piano roll.
- `/settings` provides "Announce position on play and stop" and "Announce position when moving the playhead", both on by default.
- Interaction patterns follow `design-patterns.md`.
- Target: WCAG 2.2 AA. Text contrast is checked with the agent and recorded in `README.md`.

## Limits
| Limit | Value |
|---|---|
| Voices | 16 per instrument, 64 global |
| Granular | 4 voices, 64 grains |
| Tracks | 16 (project limit) |
| Effects per chain | 8 (project limit) |
| Reverb instances | 4 (project limit) |
| Decoded audio | 20 minutes per project (project limit) |
| Expanded MIDI notes per track | 20 000 (project limit) |
| Export length | 10 minutes plus a tail of at most 10 s |
| Archive size | 500 MB (project limit) |
| Presets | 200 (project limit) |
| Drum voices / mapped notes | 14 / 21 (project limit) |
| Crash and ride layering | 2 instances each (project limit) |
| Sampler transposition | ±24 semitones from the root note (project limit) |
| Sampler-bound source length | 60 s each (project limit) |
| Sampler mip memory | 64 MB total (project limit) |
| Sampler loop | ≥ 64 frames; crossfade ≤ 500 ms (project limit) |
| Sampler zones | 1 in this build (project limit) |
| `localStorage` warning | 4 MiB estimated (project limit) |

## Deliverables
| Item | Location |
|---|---|
| Flow diagram (Mermaid) | `flows.md`, embedded in `README.md` |
| Onboarding research | `docs/onboarding-research.md`, summarised in `README.md` |
| First-run check: agent usability feedback and resulting changes | `docs/first-run-check.md`, summarised in `README.md` |
| Live URL | Vercel |
| Repository with incremental commits | GitHub |

## Build order
1. Flows
2. Onboarding research
3. Tooling and shared components
4. Routes and navigation
5. Home and new project form
6. Persistence and coming back (working state, saved settings)
7. Audio engine, safety, instruments, examples
8. Piano roll, MIDI clips, input
9. Audio import and clip management
10. Effects
11. Presets
12. `.wrack` archive
13. WAV export
14. Labeling and accessibility
15. Deploy, first-run check, README

Steps 1–6 meet the flow, form and return requirements before audio work starts.

## Main documents
| Document | Status in this build |
|---|---|
| `audio-safety.md`, `transport-and-timing.md`, `instruments.md`, `midi.md`, `accessibility.md` | Apply. TypeScript declarations in them describe data shapes; code is JavaScript. |
| `project-model.md`, `project-file-format.md` | Apply to data shapes and validation; storage is `localStorage` and the archive is STORE-only |
| `export.md` | WAV header sections apply |
| `architecture-decisions.md` ADR-1, ADR-3, ADR-5, ADR-8 to ADR-12 | Overridden by this document |
| `storage.md` | Assignment 3 build section applies; the rest does not |
| `audio-streaming.md`, `recording.md`, `plugins-wam.md`, `osc-web-serial.md` | Do not apply |
| `repo-structure.md` | Applies; describes the source layout |
| `core-and-scaffolding.md` | Does not apply |
| `privacy-and-security.md` | Network policy applies; COOP and COEP headers do not |

## Sources
- MDN, Window.localStorage — https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- MDN, Storage quotas and eviction criteria — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN, BaseAudioContext.decodeAudioData() — https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- MDN, OfflineAudioContext — https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
- MDN, Web MIDI API — https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API
- Next.js, dynamic routes — https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes
- W3C, WAI-ARIA Authoring Practices Guide — https://www.w3.org/WAI/ARIA/apg/
- W3C, WCAG 2.2 — https://www.w3.org/TR/WCAG22/
