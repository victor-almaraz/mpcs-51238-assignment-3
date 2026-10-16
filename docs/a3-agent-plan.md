# A3 agent plan

## Use
- This plan directs a coding agent that writes all code for the Assignment 3 build. All code is JavaScript (ES2022 modules, `.js` and `.jsx`); TypeScript is not used.
- Each phase is a series of commits. Each task fits one agent turn.
- Each phase lists its goal, context to load, files, tasks, acceptance checks, commit message, prohibitions and prompt.
- The agent completes tasks in order. After each task it runs the listed checks and reports their output.
- Commits use the phase message. Sub-steps append `(n/m)`.

## Global rules
| Rule | Detail |
|---|---|
| Language | JavaScript only. No `.ts`/`.tsx` files, no `tsconfig.json`, no `typescript` package, no `// @ts-check`. `jsconfig.json` defines the `@/` path alias. |
| Runtime packages | `next`, `react`, `react-dom`, `tailwindcss` and its PostCSS plugin |
| Dev packages | `eslint` (9.x; the React and accessibility plugins in `eslint-config-next` do not support ESLint 10), `eslint-config-next`, `globals`, `@playwright/test`, `@axe-core/playwright`. Any other package needs user approval. |
| Package manager | `pnpm` only; `pnpm-lock.yaml` is committed. `pnpm-workspace.yaml` holds pnpm settings only. |
| Local tooling | Node (`.tools/node`), the pnpm store and cache, and the Playwright browsers live under `.tools/`, which git ignores. Commands run with `.tools/node/bin` first on `PATH`. Nothing is installed or cached outside the project. |
| Playwright | `@playwright/test` and `playwright-core` (a pnpm override) stay at 1.57.0, the last release with Chromium, Firefox and WebKit builds for macOS 13. Its WebKit build for macOS 13 is frozen and approximates Safari. |
| Hosting | Static export (`output: 'export'`) to `out/`. `vercel.json` defines the rewrites and headers; `scripts/serve-out.mjs` applies the same file locally, and the development server reads it through `next.config.mjs`. |
| Storage | `localStorage` through `src/lib/storage/` for projects, working state, presets and settings. IndexedDB for audio sources, only through `src/lib/storage/audio-store.js`. No OPFS, service worker, cookies or sessionStorage. |
| Network | No external requests, remote fonts, analytics or CDNs. `next/font/local` only. The `dev` and `build` scripts set `NEXT_TELEMETRY_DISABLED=1`. |
| Headers | No COOP or COEP. No `SharedArrayBuffer`. |
| Audio | All DSP in `src/dsp`. No native AudioNodes except the two worklet nodes and `destination`. |
| Errors | No empty `catch`. Every caught error is shown to the user or rethrown with an error code. |
| Determinism | No `Math.random`, `Date` or `performance` in `src/dsp`. |
| Labels | Every interactive element has a role and an accessible name unique in its region. Icon-only buttons carry `aria-label`. |
| Documentation | Exported functions and classes carry JSDoc comments with units and ranges. |

Check commands, defined in Phase 3:

| Command | Purpose |
|---|---|
| `pnpm lint` | ESLint, including worklet globals for `src/worklet/**` |
| `pnpm test:dsp` | `node --test "tests/dsp/**/*.test.js"` |
| `pnpm test:e2e` | Playwright on chromium, firefox, webkit, against `out/` served by `scripts/serve-out.mjs`, or against `BASE_URL` when set |
| `pnpm e2e:install` | Installs the three Playwright browsers into `.tools/ms-playwright` |
| `pnpm build` | `copy:worklets` + `next build` (static export to `out/`) |
| `pnpm start` | Serves `out/` on port 3100 with the `vercel.json` rewrites and headers |

## Stop-and-ask conditions
The agent stops and asks the user when:
1. A task needs a package not listed in Global rules.
2. `assignment-3-scope.md` conflicts with this plan or with `a3-audio-implementation.md`.
3. An acceptance check fails after two fix attempts.
4. A browser behaves differently from the docs (for example, a worklet import fails in WebKit, or `progress` messages never arrive).
5. A "(project limit)" value blocks a requirement.
6. UI copy is missing from the scope (labels, error text, empty states).
7. A change touches files outside the phase's file list.
8. A change can lose saved data (schema change, key rename, migration).
9. The CPU benchmark fails its target.

## Prompt template
```
Phase <N>.<task>: <title>
Read only: <context list>.
Do task <task> of Phase <N> in docs/a3-agent-plan.md. Touch only: <files>.
Rules: docs/a3-agent-plan.md "Global rules". Stop and ask on any "Stop-and-ask" condition.
When done: run <checks>, paste the output, list changed files, and propose the commit message "<message>".
Do not start the next task.
```

## Phases

### Phase 1 — Flows
- **Goal:** user flows documented before code.
- **Context:** `assignment-3-scope.md` (Main flow, Routes, Home, Examples, Volume notice, Coming back).
- **Files:** `flows.md`, `README.md`.
- **Tasks:**
  1. Write Mermaid flowcharts: first visit (Home → example or new project), create project, return visit (Recent → Continue with working state), save preset, import audio, export WAV, save and open `.wrack`, panic.
  2. Embed the flows in `README.md` under "User flows".
  3. In plan mode, list the planned files for Phases 3–7 and wait for approval.
- **Acceptance:** Mermaid renders in the GitHub preview; every route appears in at least one flow.
- **Commit:** `docs: add user flows`
- **Prohibited:** application code; routes not in the scope.

### Phase 2 — Onboarding research
- **Goal:** onboarding research carried out by the agent's subagents, as the assignment requires, verified against `docs/onboarding-research.md`.
- **Context:** `docs/onboarding-research.md`, `design-patterns.md` (First screen, Onboarding), `assignment-3-scope.md` (Home, Examples, Volume notice).
- **Files:** `docs/onboarding-research.md`, `README.md`.
- **Tasks:**
  1. Send one subagent per tool (BandLab Studio, Chrome Music Lab Song Maker, Ableton Live 12) to study the first screen, what it asks for and the steps to a first useful result.
  2. Compare the subagent findings with the Findings table; record differences and resolve each Unconfirmed item that a subagent can verify.
  3. Summarise the findings and decisions in `README.md` under "Onboarding research".
- **Acceptance:** each tool section matches the subagent findings; every decision cites a finding; the README summary exists.
- **Commit:** `docs: verify onboarding research`
- **Prohibited:** links the app loads at runtime; scope changes without user approval.

### Phase 3 — Tooling and shared components
- **Goal:** project skeleton, scripts and accessible primitives.
- **Context:** this plan (Global rules), `a3-audio-implementation.md` (File layout, Worklet build and loading), `accessibility.md`.
- **Files:**
  - Config: `package.json`, `pnpm-workspace.yaml`, `jsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `vercel.json`, `eslint.config.mjs`, `playwright.config.js`, `.gitignore`, `scripts/copy-worklets.mjs`, `scripts/serve-out.mjs`.
  - Design system: `src/design-systems/industrial/{tokens.css,classes.js,fonts.js}` and `fonts/` (League Mono, SIL OFL 1.1), ported from assignment 2.
  - App: `src/app/layout.jsx`, `src/app/globals.css`, `src/app/page.jsx` (placeholder).
  - Components: `src/components/ui/{Button,IconButton,Field,Select,RadioGroup,Dialog,Slider,Toggle,StatusRegion}.jsx`.
  - Placeholders: `src/dsp/core/constants.js`, `src/worklet/main.js` (registers both processors as silent pass-throughs), `tests/dsp/smoke.test.js`, `tests/e2e/smoke.spec.js`.
- **Tasks:**
  1. Write the configuration that `create-next-app --js --tailwind --eslint --app --src-dir --import-alias "@/*"` produces (JavaScript, Tailwind, ESLint, App Router, `src/`, `@/*` alias), with no sample content.
  2. Write `scripts/copy-worklets.mjs` (copy, and `--watch`) and the scripts table. Add `Cache-Control: no-cache` for `/worklets/:path*` in `vercel.json`. Add `public/worklets/` to `.gitignore`.
  3. Configure ESLint: `globals.browser` for app code; worklet globals for `src/worklet/**`; no host globals for `src/dsp/**`; `globals.node` for `scripts/**` and `tests/**`. `no-undef` is on, so each block's globals define its environment.
  4. Port the industrial design system from assignment 2 (`src/design-systems/industrial/`): tokens, class strings and the League Mono fonts. The root layout sets `data-ds="industrial"` and the font class.
  5. Build the UI primitives on the industrial classes:
     - `IconButton` requires a `label` prop and throws during development when it is missing.
     - `Slider` is a native `<input type="range">` with a visible label and `aria-valuetext`.
     - `Dialog` uses `<dialog>`, moves focus inside on open, closes on `Escape`, returns focus on close.
     - `StatusRegion` renders `role="status"`.
  6. Configure Playwright with chromium, firefox and webkit against the static export; add an axe check on `/`.
- **Acceptance:** `pnpm lint && pnpm test:dsp && pnpm build` pass; `pnpm test:e2e` passes in three browsers; `public/worklets/worklet/main.js` exists after build; the repository contains no `.ts` files.
- **Commit:** `chore: scaffold app, tooling, shared components`
- **Prohibited:** TypeScript; UI or icon libraries; `new URL(..., import.meta.url)` for workers or worklets; committing `public/worklets/`.

### Phase 4 — Routes and navigation
- **Goal:** every route renders with landmarks and shared navigation.
- **Context:** `assignment-3-scope.md` (Routes), `accessibility.md`.
- **Files:** `src/app/{page,new/page,projects/page,projects/[id]/page,settings/page,not-found}.jsx`, `src/components/nav/{SiteHeader,SkipLink}.jsx`, `src/components/studio/{StudioLoader,Studio}.jsx`, `tests/e2e/routes.spec.js`.
- **Tasks:**
  1. Create route files, each with `<main>`, one `<h1>` and a skip link.
  2. Build the header with `aria-current="page"` on the active link.
  3. `StudioLoader.jsx` (`'use client'`) loads the studio with `dynamic(() => import('./Studio'), { ssr: false })`; `/projects/[id]` renders `StudioLoader` with a placeholder studio.
  4. `/projects/[id]` prerenders one shell: `generateStaticParams()` returns `{ id: '_shell' }` and `dynamicParams` is `false`. The `vercel.json` rewrite serves the shell for every project ID, and `StudioLoader` reads the ID from `window.location.pathname` after mount. An unknown ID shows "Project not found".
- **Acceptance:** Playwright visits each route; one `h1` per page; no axe violations; Tab reaches the navigation; `/projects/<any id>` serves the shell.
- **Commit:** `feat: add routes and navigation`
- **Prohibited:** `localStorage` in Server Components or at module top level; `ssr: false` in a Server Component.

### Phase 5 — Home and new project form
- **Goal:** the Home screen and a validated form that creates a project.
- **Context:** `assignment-3-scope.md` (Home, Examples, New project form), `project-model.md`.
- **Files:** `src/app/page.jsx`, `src/app/new/page.jsx`, `src/components/home/{HomeSections,RecentList,CreateCard,LoadCard,ExampleCards}.jsx`, `src/components/ui/Card.jsx`, `src/app/new/NewProjectForm.jsx`, `src/lib/project/{model,validate,examples,store}.js`, `src/lib/storage/{keys,storage}.js`, `src/components/studio/{StudioLoader,Studio}.jsx`, `tests/dsp/{validate,project-store}.test.js`, `tests/e2e/home.spec.js`, `tests/e2e/new-project.spec.js`.
- **Storage:** saving a new project, Recent and example copies need storage, so this phase builds the guarded `readJson`/`writeJson`, the key names and a basic project store (create, load, index, in-memory example copies, save). Phase 6 extends them.
- **Routing:** an example opens at `/projects/<new id>?example=<slug>`; the editor creates the unsaved copy from the query, so a reload reopens it. The first edit of a copy is covered by a unit test until editing exists (Phase 7).
- **Tasks:**
  1. Pure validators that return the exact scope error strings.
  2. The form:
     - Name, tempo, time signature `<select>`.
     - Each error under its field, linked with `aria-describedby`, with `aria-invalid="true"`.
     - On submit, focus moves to the first invalid field; entered values remain.
     - On success, the project opens with one empty instrument track.
  3. Home: Recent (hidden without saved projects), Create, Load (button only; archive logic in Phase 12) and Examples sections.
  4. Example data for Beat, Ambient and Pluck melody as MIDI-only project JSON. Opening an example creates an unsaved copy and opens the editor stopped; the copy saves on its first edit.
- **Acceptance:** e2e covers an empty name, 61 characters, tempo 39, 241 and `abc`, and a valid submit that opens `/projects/<id>`; an example opens without creating a saved project until an edit; Home shows Recent only when projects exist.
- **Commit:** `feat: add home screen and new project form`
- **Prohibited:** reworded error strings; clearing fields on error; placeholders used as labels; changing example data when a copy is edited.

### Phase 6 — Persistence and coming back
- **Goal:** localStorage persistence, the return experience, working state and saved settings.
- **Context:** `assignment-3-scope.md` (Persistence, Coming back: Resume where you left off, Saved settings), `a3-audio-implementation.md` (Versioning).
- **Files:** `src/lib/storage/{keys,storage,migrate,schema}.js`, `src/lib/project/{store,view-state}.js`, `src/lib/settings/store.js`, `src/components/home/RecentList.jsx`, `src/app/projects/{page,ProjectList}.jsx`, `src/app/settings/{page,SettingsPanel}.jsx`, `src/components/studio/{StudioLoader,Studio}.jsx`, `src/components/ui/{Dialog,useHydrated}.js(x)`, `tests/dsp/persistence.test.js`, `tests/support/memory-storage.js`, `tests/e2e/persistence.spec.js`.
- **Placeholder controls:** until the timeline exists, the editor placeholder selects tracks and zooms, so working-state saving is testable end to end. `/projects` deletes projects (index maintenance; the storage-full message asks for it).
- **Tasks:**
  1. Storage API (extends the Phase 5 modules):
     - `readJson(key)`: parse inside a guard, check the schema, return `{ ok, value }` or `{ ok: false, error }`.
     - `writeJson(key, value)`: catch `QuotaExceededError` (`name === 'QuotaExceededError'`, `code === 22`, or `name === 'NS_ERROR_DOM_QUOTA_REACHED'`).
     - Size estimate: 2 bytes per string code unit.
  2. Project store: 500 ms debounced save, flush on `pagehide`, index maintenance.
  3. Return experience: Recent list with "Continue"; clips without loaded audio show "Audio not loaded" and the toolbar action "Open .wrack file to restore audio".
  4. Working state per project in `w-rack:v1:view:<id>`: playhead, loop, zoom, scroll, selection, open panel. Restored on open; transport always stopped.
  5. Saved settings and the "Remember settings on this device" toggle; turning it off removes `w-rack:v1:settings`.
  6. `schemaVersion: 1` and a `migrate()` registry.
- **Acceptance:** e2e covers create, reload and continue with working state restored; corrupted JSON shows the guarded message; a quota error simulated by stubbing `Storage.prototype.setItem` shows the scope message; the settings toggle removes the settings key.
- **Commit:** `feat: add localStorage persistence and return experience`
- **Prohibited:** audio bytes or base64 in localStorage; `localStorage` outside `src/lib/storage`; silenced quota errors.

### Phase 7 — Audio engine, safety, instruments
- **Goal:** the audible engine: transport, six instruments and the safety stage.
- **Context:** `a3-audio-implementation.md` (Architecture through Instruments, Mixer and metering, Safety stage, Performance pitfalls), `audio-safety.md`, `transport-and-timing.md`, `instruments.md`.
- **Files:** `src/dsp/**` (instruments share `poly-kernel.js`, `registry.js` and `drum-voices/shared.js`), `src/worklet/main.js`, `src/lib/audio/{engine-client,compile-model}.js`, `src/components/transport/*.jsx`, `src/components/VolumeNotice.jsx`, `src/components/studio/Studio.jsx`, `src/components/instruments/{InstrumentPanel,ParamControl,DrumMachinePanel}.jsx` (one panel generated from ParamDefs; the drum machine has its own), `src/components/mixer/*.jsx`, `src/components/ui/Meter.jsx`, `tests/dsp/*.test.js`, `tests/e2e/audio.spec.js`.
- **Reuse:** parameter definitions and scaling from assignment 2 (`src/audio/synths/param-defs.js`, `scaling.js`) and its instrument panels (`src/components/synth/widgets/*`). Assignment 2's DSP uses native nodes and is rewritten as worklet kernels.
- **Examples:** example effect slots load into the model; until Phase 10 the engine passes their signal through unprocessed.
- **Sub-steps** (one commit each):
  1. `core`: constants, `ParamDef` and `clampParam`, smoother, `mulberry32`, tables, ring. Tests: clamping; fixed PRNG sequence for seed 1.
  2. `timing`: tempo and meter maps. Test: `tickAt(frameAt(t)) === t` for 10 000 random integer ticks.
  3. `safety`: guard, DC blocker, duck, fade, limiter, `SafetyProcessor`. Tests: no sample above 0.8913 on random input with peaks of 10; NaN input gives 250 ms of silence, then a fade-in.
  4. `engine`, `EngineProcessor`, `engine-client`: silent engine, transport, metronome, volume notice on the first sound-producing action, context creation on confirm, `pos` reporting, rAF playhead, and a worklet-import smoke test in three browsers.
  5. One instrument per task: Subtractive, FM, Additive, Pluck, Granular, Drum machine. Tests: pitch accuracy, voice caps, Nyquist rules; for the drum machine, the drum tests in `a3-audio-implementation.md` (Testing), and the voice selector with five per-voice controls and three kit controls. Piano-roll drum rows (`PR-04`) are built in Phase 8. The sampler is built in Phase 9 (task 7).
  6. Mixer (track gain, pan, mute, solo; master volume and pan), meters, Panic and `Escape`. Tests: centre pan gives equal channels; full left gives silence on the right for mono and stereo sources; master pan applies balance.
- **Acceptance:**
  - `pnpm test:dsp` passes.
  - e2e: no `AudioContext` exists before the volume notice is confirmed (constructor spy).
  - Each example plays in Chromium, Firefox and WebKit; the volume notice appears before the first sound.
  - Panic silences every sound within 20 ms, including one-shot drum hits, previews and auditions.
  - Two 4 s offline renders have equal hashes.
- **Commit:** `feat(audio): <sub-step> (n/6)`
- **Prohibited:**
  - `AudioContext` at import time or in `useEffect` without a gesture.
  - Allocation in `process()`.
  - `OscillatorNode`, `BiquadFilterNode`, `GainNode` or other native nodes for DSP.
  - Removing, bypassing or reordering the safety stage.
  - The literal `128` outside `constants.js`.
  - Playhead or meters in React state.
  - `Math.random`.
  - A message every quantum.

### Phase 8 — Piano roll, MIDI clips, input
- **Goal:** note editing and live input.
- **Context:** `a3-audio-implementation.md` (Timing and sequencing, UI timing and drawing), `midi.md`, `accessibility.md`.
- **Files:** `src/components/pianoroll/{PianoRollCanvas,PianoRollGrid,usePianoRollCommands}.jsx`, `src/components/pianoroll/layout.js`, `src/components/input/LiveInputControls.jsx`, `src/lib/project/midi-commands.js`, `src/lib/audio/{keyboard-input,midi-input}.js`, `src/dsp/engine/live-input.js`, `tests/dsp/{midi-commands,live-input}.test.js`, `tests/e2e/pianoroll.spec.js`.
- **Clip looping:** MIDI clips carry an optional `loopLength` (ticks); the piano roll sets it to 1, 2 or 4 bars or off.
- **Tasks:**
  1. Pure note commands on integer ticks: add, move, resize, delete, velocity, quantize.
  2. Canvas drawing with a `role="grid"` DOM mirror, arrow-key navigation and note names such as "C4, bar 2 beat 1, length 1 beat, velocity 100".
  3. MIDI clip looping, compiled per the implementation guide.
  4. Computer-keyboard input, ignored while focus is in a text field.
  5. Web MIDI: feature-detect `navigator.requestMIDIAccess`; request on a button click; status text "Web MIDI is not supported in this browser." (Safari) and "Firefox asks to install a site permission add-on. Connect the MIDI device before starting Firefox."; 200 note-ons/s flood limit.
  6. Drum rows (`PR-04`) on drum machine tracks, labelled with note number, voice and GM name.
- **Acceptance:** e2e creates, moves and deletes notes by keyboard only; the DOM mirror's note count equals the model; unit tests cover the flood limiter and loop expansion.
- **Commit:** `feat: add piano roll, MIDI clips and live input`
- **Prohibited:** fractional ticks; canvas handlers that bypass the command layer; requesting MIDI on page load.

### Phase 9 — Audio import and clip management
- **Goal:** audio tracks with full clip editing.
- **Context:** `a3-audio-implementation.md` (Transfer and memory, Clip playback, Decoding), `assignment-3-scope.md` (Audio persistence), `project-model.md`.
- **Files:** `src/lib/audio/{decode,peaks-client,source-cleanup}.js`, `src/lib/storage/audio-store.js`, `src/workers/peaks.js`, `src/dsp/clips/*.js`, `src/lib/project/clip-commands.js`, `src/components/timeline/*.{js,jsx}`, `src/components/studio/useProjectSources.js`, `src/components/ui/useThrottledAnnouncer.js`, `src/dsp/instruments/{sampler,sampler-zones}.js`, `src/dsp/core/{interp,halfband}.js`, `src/components/sampler/*.{js,jsx}`, `src/app/settings/StoredAudio.jsx`, `tests/dsp/{clips,sampler}.test.js`, `tests/e2e/audio-import.spec.js`.
- **Tasks:**
  1. Multi-file import: hash, decode a copy, `source-add` with transferred copies, the 20-minute limit, per-file error messages.
  2. Peaks worker and multi-resolution waveform drawing.
  3. Clip commands per the edit-math table: select, move and reorder within a track kind, duplicate, delete, split, join, trim, gain, fades, crossfades, envelope, rename, colour.
  4. Clip player kernel with fade tables and envelope segments; crossfades set during compile.
  5. `role="treegrid"` timeline mirror (tracks → clips) with keyboard commands.
  6. IndexedDB audio store (`audio-store.js`): `put`, `get`, `remove`, `list`, `usage`; one record per `sourceId` holding the original file bytes; `persist()` on the first import; capacity check with `estimate()`; session-only fallback with the scope message; reference cleanup; automatic decode on open; "Saved on this device" or "Session only" in the import result, clip properties and accessible names; usage in `/settings`.
  7. Sampler: `sampler.js`, `interp.js`, `halfband.js`, mip-level generation in the peaks worker, the `source-mips`, `sampler-zones`, `source-status` and `sampler-zone-invalid` messages, the sample editor (`DEV-03`), "Audio not loaded" on missing sources, and sampler presets that store `sourceId` and source name. Tests: the sampler tests in `a3-audio-implementation.md` (Testing).
- **Acceptance:** split then join restores the identical clip; a split clip and the unsplit clip export to equal hashes; two WAV fixtures import in three browsers; imported files persist across reload from IndexedDB; a simulated quota failure makes a file session-only with the scope message; deleting the last project that uses a source removes its record; the sampler tests pass; sample-editor markers move by keyboard alone; a sampler preset applied without its source shows "Audio not loaded: <source name>" and importing the matching file restores sound.
- **Commit:** `feat: add audio import and clip management`
- **Prohibited:** persisting decoded PCM; audio in `localStorage`; IndexedDB access outside `audio-store.js`; evicting stored audio to make room; passing the original `ArrayBuffer` to `decodeAudioData`; copying source channel data into the sampler; the sampler in any example; recomputing peaks per render; moving clips between MIDI and audio tracks.

### Phase 10 — Effects
- **Goal:** six effects in chains of up to eight on every track and the master.
- **Context:** `a3-audio-implementation.md` (Effects, CPU budget, Performance pitfalls).
- **Files:** `src/dsp/effects/*.js`, `src/components/effects/*.jsx`, `tests/dsp/effects.test.js`, `tests/e2e/perf.spec.js`.
- **Tasks** (one per turn):
  1. Biquad and 3-band EQ.
  2. State-variable filter.
  3. Compressor.
  4. Saturation with ADAA.
  5. Delay with tempo sync.
  6. Freeverb reverb with the four-instance limit.
  7. Chain UI: add, remove, reorder, bypass; every control a labelled native input.
  8. Fault path: reset, bypass, `fault`, and the notice "Effect <name> on <track> was reset and bypassed."
- **Acceptance:** bounded output over parameter sweeps with white noise; delay loop gain below 1 at maximum settings; reverb decay within ±20% of T60 (project limit); compressor static curve within 0.1 dB of the formula; CPU benchmark passes.
- **Commit:** `feat(fx): <effect>`
- **Prohibited:** `BiquadFilterNode`, `ConvolverNode`, `DynamicsCompressorNode`, `WaveShaperNode`, `DelayNode`; feedback ≥ 1; per-sample coefficient computation.

### Phase 11 — Presets
- **Goal:** a personal preset library shared across projects.
- **Context:** `assignment-3-scope.md` (Presets, Persistence).
- **Files:** `src/lib/presets/{store,validate}.js`, `src/components/presets/{SavePresetDialog,PresetPicker,PresetList}.jsx`, `src/app/settings/page.jsx`, `tests/dsp/presets.test.js`, `tests/e2e/presets.spec.js`.
- **Tasks:**
  1. Preset store in `w-rack:v1:presets`: add, rename, delete; 200-preset limit; parameters clamped through `ParamDef` on load.
  2. Save preset dialog: name field with the scope rules and error strings; entered name kept on error.
  3. Pickers on every instrument and effect with a "My presets" group above built-in settings.
  4. Preset list in `/settings` with rename and delete.
- **Acceptance:** a preset saved in one project appears in another after reload; duplicate names for the same type show the scope error; the 201st preset is refused with a message; unit tests cover validation.
- **Commit:** `feat: add preset library`
- **Prohibited:** storing presets inside project JSON; unclamped parameter values from storage.

### Phase 12 — `.wrack` archive
- **Goal:** save and open STORE-only ZIP archives.
- **Context:** `assignment-3-scope.md` (`.wrack` archive), `project-file-format.md`.
- **Files:** `src/lib/archive/{crc32,zip-writer,zip-reader,validate}.js`, `src/components/archive/{SaveArchive,OpenArchive,RestoreDialog}.jsx`, `tests/dsp/zip.test.js`.
- **Tasks:**
  1. CRC-32 with a reflected table, polynomial `0xEDB88320`. Test: `crc32("123456789") === 0xCBF43926`.
  2. Writer: per entry a local file header (signature `0x04034b50`, 30 bytes + name) and data; then central directory headers (`0x02014b50`, 46 bytes + name); then the end-of-central-directory record (`0x06054b50`, 22 bytes). Method 0, flag bit 11 (UTF-8), fixed DOS time 0 and date `0x0021` for deterministic output. CRC and sizes in the local header. Output `new Blob(parts)`.
  3. Reader: locate the end record in the last 65 557 bytes with `File.slice`; parse the central directory; read entries with `File.slice`; validate per the scope (paths, entry count, duplicates, method, encryption flag, sizes, total size, `project.json` size and depth, CRC).
  4. Save: `showSaveFilePicker` when present; otherwise `<a download>` with an object URL revoked after the click.
  5. Open: "Restore audio" and "Replace project" dialog; validation errors listed.
- **Acceptance:** write → read round trip is byte-equal; fixtures with a traversal path, duplicate entries, oversized entries and deep JSON are rejected with specific messages.
- **Commit:** `feat: add .wrack archive save and open`
- **Prohibited:** ZIP libraries; compression; trusting header sizes without checking them against the file size; concatenating the archive into one large `Uint8Array`.

### Phase 13 — WAV export
- **Goal:** deterministic offline WAV export.
- **Context:** `a3-audio-implementation.md` (Offline export, WAV writer), `export.md` (WAV headers).
- **Files:** `src/lib/export/{render-offline,wav-writer,dither}.js`, `src/components/export/ExportDialog.jsx`, `tests/dsp/wav.test.js`, `tests/e2e/export.spec.js`.
- **Tasks:**
  1. WAV writer: 16-bit with TPDF dither, 24-bit extensible, 32-bit float. Tests check header bytes field by field.
  2. Offline render through `processorOptions`: whole or loop range, 0–10 s tail, 10-minute limit, `progress` messages.
  3. Export dialog: format, range and tail; determinate or indeterminate progress; the export control disabled during rendering.
- **Acceptance:** two exports have equal SHA-256 in each browser; peak ≤ −1 dBFS; headers are 44, 68 and 58 bytes; Firefox completes an export.
- **Commit:** `feat: add WAV export`
- **Prohibited:** `MediaRecorder`; recording the live context; omitting the safety node offline; time-based dither seeds.

### Phase 14 — Labeling and accessibility
- **Goal:** WCAG 2.2 AA and names usable by screen readers and automation agents.
- **Context:** `assignment-3-scope.md` (Labeling, Accessibility), `accessibility.md`.
- **Files:** `src/components/**`, `tests/e2e/a11y.spec.js`, `docs/a11y-check.md`.
- **Tasks:**
  1. axe on every route and dialog state; fix every violation.
  2. A test that queries each primary control by role and name and asserts names are unique per landmark.
  3. Contrast (text 4.5:1, UI components 3:1), visible focus, targets ≥ 24 × 24 CSS px.
  4. A keyboard-only pass through every flow in `flows.md`.
- **Acceptance:** zero axe violations; uniqueness test passes; checklist committed in `docs/a11y-check.md`.
- **Commit:** `fix(a11y): labeling, contrast and keyboard pass`
- **Prohibited:** `aria-label` that contradicts visible text; removed focus outlines; `role="application"` on the studio.

### Phase 15 — Deploy, first-run check, README
- **Goal:** a production deployment with a verified first run.
- **Context:** `assignment-3-scope.md` (Deliverables, Main flow).
- **Files:** `README.md`, `docs/first-run-check.md`.
- **Tasks:**
  1. Deploy to Vercel with build command `pnpm build`; Vercel serves `out/` with the rewrites and headers in `vercel.json`. Confirm `/worklets/worklet/main.js` returns 200 with `Cache-Control: no-cache`.
  2. First-run check on the production URL in Chrome, Firefox and Safari with empty profiles: no sound on load, Home, an example played after the volume notice, a new project, a saved preset, then a simulated return visit with working state restored, plus export and a `.wrack` round trip. Ask the agent for usability feedback as a brand-new and as a returning user.
  3. README: flows, onboarding research summary, first-run feedback and changes, browser support, limits, scripts.
- **Acceptance:** `pnpm test:e2e` passes against the deployed URL (`BASE_URL`); DevTools shows zero third-party requests.
- **Commit:** `docs: deploy and first-run check`
- **Prohibited:** analytics; secrets; COOP or COEP headers.

## Review checklist
Run after every phase.
- [ ] No `.ts` or `.tsx` files and no TypeScript packages.
- [ ] No package outside Global rules.
- [ ] IndexedDB used only by `audio-store.js`, and only for audio sources.
- [ ] No `localStorage` in Server Components or at module top level.
- [ ] No `AudioContext` at import time or without a gesture.
- [ ] No allocation, closures or per-quantum `postMessage` in `process()`.
- [ ] No native AudioNodes for instruments or effects, and no `AudioBufferSourceNode` or `<audio>` element for any preview or audition.
- [ ] No sample files (WAV, MP3, OGG, FLAC, base64 audio) in the repository or build output.
- [ ] Panic ends every sound, including one-shot drum hits and trigger-mode sampler voices.
- [ ] Safety node present and last, live and offline.
- [ ] No literal `128` outside `constants.js`.
- [ ] Every icon-only button labelled.
- [ ] Playhead and meters outside React state.
- [ ] No `Math.random` or `Date` in `src/dsp`; exports deterministic.
- [ ] No empty `catch`.

## Sources
- Next.js, `create-next-app` options — https://nextjs.org/docs/app/api-reference/cli/create-next-app
- Next.js, `next/dynamic` — https://nextjs.org/docs/app/guides/lazy-loading
- Node.js, test runner — https://nodejs.org/api/test.html
- Playwright — https://playwright.dev/docs/intro
- axe-core Playwright integration — https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
- PKWARE, APPNOTE.TXT (ZIP format) — https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
