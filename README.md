# W-Rack

W-Rack is a digital audio workstation that runs in the browser. It combines MIDI tracks played by built-in instruments, audio tracks with imported clips, track and master effects, WAV export and `.wrack` project files. The site is static: all audio processing and storage happen on the user's device.

## User flows

The diagrams in this section are maintained in [`flows.md`](flows.md).

Each flowchart describes one W-Rack user flow. Rounded nodes are entry and exit points, rectangles are screens and actions, diamonds are decisions, and double-bordered nodes link to another flow. Text in curly quotes is interface copy.

### First visit

A first visit is a visit with no W-Rack keys in `localStorage`.

```mermaid
flowchart TD
  fv_start(["Open W-Rack with no W-Rack keys in localStorage"]) --> fv_home["Home (/)<br/>One-sentence description of W-Rack<br/>Create, Load, Examples"]
  fv_home --> fv_pick{"Choose a starting point"}
  fv_pick -->|"Example card: Beat, Ambient or Pluck melody"| fv_copy["Create an unsaved copy of the example"]
  fv_pick -->|"“New project”"| fv_create[["Create project"]]
  fv_pick -->|"“Open .wrack file”"| fv_open[["Open a .wrack file"]]
  fv_copy --> fv_editor["Editor (/projects/[id]), transport stopped<br/>Play is the highlighted primary action<br/>“Press Play to hear this example”"]
  fv_editor --> fv_act{"Next action"}
  fv_act -->|"Play"| fv_notice[["Volume notice"]]
  fv_notice --> fv_plays["The example plays"]
  fv_plays --> fv_act
  fv_act -->|"First edit"| fv_saved["Save the copy as the user's project<br/>The example itself never changes"]
  fv_saved --> fv_autosave(["Later edits save 500 ms after the last edit"])
  fv_act -->|"Leave without an edit"| fv_leave(["No project is saved"])
```

### Create project

```mermaid
flowchart TD
  cp_start(["Select “New project” on Home or in the header"]) --> cp_form["New project form (/new)<br/>Name: “Untitled project N”, lowest unused N<br/>Tempo: 120<br/>Time signature: 4/4"]
  cp_form --> cp_edit["Edit the fields"]
  cp_edit -->|"Blur an edited field"| cp_blur{"Field valid?"}
  cp_blur -->|"Yes"| cp_edit
  cp_blur -->|"No"| cp_ferr["Show the error below the field<br/>Set aria-invalid=true and aria-describedby"]
  cp_ferr --> cp_edit
  cp_edit -->|"Submit"| cp_check{"All fields valid?"}
  cp_check -->|"No"| cp_errs["Show each error below its field<br/>Keep the entered values<br/>Focus the first invalid field"]
  cp_errs --> cp_edit
  cp_check -->|"Yes"| cp_store["Write w-rack:v1:project:#lt;id#gt; and w-rack:v1:index"]
  cp_store --> cp_quota{"Write succeeded?"}
  cp_quota -->|"No: QuotaExceededError"| cp_full["“This device's browser storage is full. Save a .wrack file, then delete unused projects.”<br/>Keep the entered values"]
  cp_full --> cp_edit
  cp_quota -->|"Yes"| cp_editor(["Editor (/projects/[id]) with one empty instrument track<br/>Piano roll with step input on<br/>“Press a key or click the grid to add a note” and the keyboard map<br/>Add › “Audio file…” in the clip toolbar"])
```

| Field | Rule | Error text |
|---|---|---|
| Name | 1–60 characters after trimming | “Enter a project name.” / “Use 60 characters or fewer.” |
| Tempo | Integer 40–240 | “Enter a tempo between 40 and 240.” |
| Time signature | 1–32 beats per bar over a note value of 1, 2, 4, 8, 16 or 32 | — |

### Return visit

A return visit is a visit with at least one saved project.

```mermaid
flowchart TD
  rv_start(["Open W-Rack with at least one saved project"]) --> rv_home["Home (/)<br/>Recent, Create, Load, Examples"]
  rv_home -->|"“Continue” on a Recent project"| rv_route
  rv_home -->|"Projects in the header"| rv_list["Projects (/projects)<br/>Saved projects with last-edited dates,<br/>tempo, time signature and track count"]
  rv_list -->|"Select a project"| rv_route["Open /projects/[id]"]
  rv_route --> rv_exists{"Project ID in w-rack:v1:index?"}
  rv_exists -->|"No"| rv_missing(["“Project not found”<br/>Links to Projects and New project"])
  rv_exists -->|"Yes"| rv_read{"Project JSON readable?"}
  rv_read -->|"No"| rv_bad(["“A saved project could not be read.”"])
  rv_read -->|"Yes"| rv_view["Restore working state from w-rack:v1:view:#lt;id#gt;<br/>Playhead, loop range and loop on/off, zoom and scroll,<br/>selected track and clips, open editor panel and its clip,<br/>dock tab and collapse, snap and grid, armed tracks<br/>Transport stopped"]
  rv_view --> rv_audio{"Project has audio clips or sampler zones?"}
  rv_audio -->|"No"| rv_ready(["Editor ready"])
  rv_audio -->|"Yes"| rv_decode["Load sources from IndexedDB and decode them"]
  rv_decode --> rv_all{"Every source available?"}
  rv_all -->|"Yes"| rv_ready
  rv_all -->|"No"| rv_notloaded["Clips without a source show “Audio not loaded”<br/>A banner below the transport shows “Open .wrack file to restore audio”"]
  rv_notloaded --> rv_ready
  rv_notloaded -.->|"“Open .wrack file to restore audio”"| rv_open[["Open a .wrack file"]]
```

### Volume notice

The first sound-producing action of a page session passes through this flow.

```mermaid
flowchart TD
  vn_start(["Sound-producing action: Play, a keyboard or MIDI note, or a preset audition"]) --> vn_stored{"Dismissal stored in w-rack:v1:settings?"}
  vn_stored -->|"Yes"| vn_ctx
  vn_stored -->|"No"| vn_session{"“Continue” chosen earlier in this page session?"}
  vn_session -->|"Yes"| vn_ctx
  vn_session -->|"No"| vn_dialog["Volume notice dialog<br/>“Turn your device volume down. W-Rack is about to play sound.”<br/>Unchecked checkbox “Don't show this again on this device”"]
  vn_dialog -->|"Cancel"| vn_cancel(["No action is performed"])
  vn_dialog -->|"Continue"| vn_box{"Checkbox checked?"}
  vn_box -->|"Yes"| vn_persist["Store the dismissal in w-rack:v1:settings"]
  vn_box -->|"No"| vn_flag["Set the in-memory session flag"]
  vn_persist --> vn_ctx
  vn_flag --> vn_ctx
  vn_ctx["Create and resume the AudioContext and load the worklet, if not done yet"] --> vn_perform(["Perform the action with a 50 ms fade-in"])

  vn_settings(["Settings (/settings)"]) -->|"“Show the volume notice again”<br/>or “Remember settings on this device” turned off"| vn_clear(["Remove the stored dismissal"])
```

### Save preset

```mermaid
flowchart TD
  sp_start(["Select “Save preset” on an instrument or effect in the Devices tab"]) --> sp_dialog["Save preset dialog<br/>Name field"]
  sp_dialog -->|"Escape"| sp_close(["Dialog closes; focus returns to “Save preset”"])
  sp_dialog -->|"Submit"| sp_valid{"Name valid?"}
  sp_valid -->|"No"| sp_err["Show the error below the field<br/>Keep the entered name<br/>Focus the field"]
  sp_err --> sp_dialog
  sp_valid -->|"Yes"| sp_limit{"Library already holds 200 presets?"}
  sp_limit -->|"Yes"| sp_refuse(["“The preset library is full. Delete a preset in Settings to save a new one.”<br/>Keep the entered name"])
  sp_limit -->|"No"| sp_write["Write w-rack:v1:presets"]
  sp_write --> sp_quota{"Write succeeded?"}
  sp_quota -->|"No: QuotaExceededError"| sp_full(["“This device's browser storage is full. Save a .wrack file, then delete unused projects.”"])
  sp_quota -->|"Yes"| sp_done["Dialog closes<br/>The preset appears under “My presets” in every project's picker for its type"]
  sp_done --> sp_settings["Settings (/settings): preset list"]
  sp_settings -->|"Rename or delete"| sp_manage(["Write w-rack:v1:presets"])
```

| Field | Rule | Error text |
|---|---|---|
| Name | 1–40 characters after trimming; unique within the instrument or effect type | “Enter a preset name.” / “Use 40 characters or fewer.” / “A preset with this name already exists for &lt;type&gt;. Choose another name.” |

### Import audio

```mermaid
flowchart TD
  ia_start(["Select Add › “Audio file…” in the clip toolbar,<br/>“Add audio file” in an empty timeline,<br/>or the “Add audio file…” command"]) --> ia_pick["Choose one or more files"]
  ia_pick --> ia_first{"First audio import on this device?"}
  ia_first -->|"Yes"| ia_persist["Request navigator.storage.persist()"]
  ia_first -->|"No"| ia_each
  ia_persist --> ia_each["Take the next file<br/>Compute its SHA-256 as sourceId"]
  ia_each --> ia_decode{"decodeAudioData succeeds?"}
  ia_decode -->|"No"| ia_derr["“Could not decode #lt;name#gt;. Supported formats: WAV, MP3, M4A/AAC, FLAC, OGG.”"]
  ia_decode -->|"Yes"| ia_limit{"Project decoded audio stays within 20 minutes?"}
  ia_limit -->|"No"| ia_lerr["“#lt;name#gt; was not added. A project can hold up to 20 minutes of audio.”"]
  ia_limit -->|"Yes"| ia_clip["Place a clip at the edit cursor on the selected audio track,<br/>or on a new audio track"]
  ia_clip --> ia_known{"Source with this sourceId already stored?"}
  ia_known -->|"Yes"| ia_saved["Clip shows “Saved on this device”"]
  ia_known -->|"No"| ia_cap{"navigator.storage.estimate() leaves at least 10% of quota free?"}
  ia_cap -->|"No"| ia_session["“This browser could not store #lt;name#gt;. Save a .wrack file to keep this audio.”<br/>Clip shows “Session only”"]
  ia_cap -->|"Yes"| ia_put["Store the original file bytes in IndexedDB w-rack, store sources"]
  ia_put --> ia_ok{"Write succeeded?"}
  ia_ok -->|"Yes"| ia_saved
  ia_ok -->|"No"| ia_session
  ia_derr --> ia_more
  ia_lerr --> ia_more
  ia_saved --> ia_more
  ia_session --> ia_more
  ia_more{"More files?"}
  ia_more -->|"Yes"| ia_each
  ia_more -->|"No"| ia_done(["Import results announced in the polite live region"])
```

### Export WAV

```mermaid
flowchart TD
  ex_start(["Select File › “Export WAV…” or press Ctrl/Cmd+Shift+E"]) --> ex_dialog["Export dialog<br/>Range: Whole project or Loop<br/>Format: WAV 16-bit with TPDF dither (default), 24-bit, 32-bit float;<br/>the last format chosen is kept in w-rack:v1:settings<br/>Tail: 0–10 s, default 2 s"]
  ex_dialog --> ex_missing{"Clips without loaded audio?"}
  ex_missing -->|"Yes"| ex_list["List the clips; they render as silence"]
  ex_missing -->|"No"| ex_go
  ex_list --> ex_go["Start the export"]
  ex_go --> ex_len{"Range within 10 minutes?"}
  ex_len -->|"No"| ex_lerr["“Export ranges are limited to 10 minutes.”"]
  ex_lerr --> ex_dialog
  ex_len -->|"Yes"| ex_render["Stop the transport<br/>Render in an OfflineAudioContext with the same worklet graph and the safety stage<br/>Focus moves to Cancel"]
  ex_render --> ex_msgs{"Engine progress messages arriving?"}
  ex_msgs -->|"Yes"| ex_det["Determinate progress with percentage and elapsed time"]
  ex_msgs -->|"No"| ex_indet["Indeterminate progress"]
  ex_det --> ex_wav
  ex_indet --> ex_wav
  ex_render -->|"Cancel"| ex_cancel(["Discard the render; nothing downloads"])
  ex_wav["Write the WAV file"] --> ex_ready["“Download (#lt;size#gt;)” receives focus<br/>Nothing downloads by itself"]
  ex_ready -->|"Download"| ex_done(["Save the WAV file: save picker in Chromium, download elsewhere"])
```

### Save a .wrack file

```mermaid
flowchart TD
  sw_start(["Select File › “Save .wrack file” or press Ctrl/Cmd+S"]) --> sw_size{"Archive within 500 MB?"}
  sw_size -->|"No"| sw_big(["“This project is too large to save as one file.”"])
  sw_size -->|"Yes"| sw_build["Assemble project.json and audio/#lt;sourceId#gt;.#lt;ext#gt;<br/>as STORE-only ZIP Blob parts"]
  sw_build --> sw_fsa{"showSaveFilePicker available?"}
  sw_fsa -->|"Yes: Chromium"| sw_picker["Save file picker"]
  sw_fsa -->|"No"| sw_anchor["Download through #lt;a download#gt;"]
  sw_picker -->|"Cancel"| sw_cancel(["No file is written"])
  sw_picker -->|"Save"| sw_mark
  sw_anchor --> sw_mark(["Record the archive-save date in w-rack:v1:index<br/>The header shows “Saved to file”"])

  sw_leave(["Leave the page"]) --> sw_newer{"Loaded audio newer than the last archive save?"}
  sw_newer -->|"Yes"| sw_prompt(["beforeunload prompt"])
  sw_newer -->|"No"| sw_exit(["Page closes"])
```

### Open a .wrack file

```mermaid
flowchart TD
  ow_start(["Select “Open .wrack file” on Home, File › “Open .wrack file…” (Ctrl/Cmd+O),<br/>or “Open .wrack file to restore audio” in the editor's missing-audio banner"]) --> ow_choose["Choose a .wrack file"]
  ow_choose --> ow_valid{"Archive passes validation?"}
  ow_valid -->|"No"| ow_errs(["Import nothing<br/>List every validation error"])
  ow_valid -->|"Yes"| ow_match{"Archive project ID matches a saved project?"}
  ow_match -->|"No"| ow_new["Import as a new saved project"]
  ow_match -->|"Yes"| ow_dialog["Dialog: “Restore audio” or “Replace project”"]
  ow_dialog -->|"Restore audio"| ow_restore["Load matching sources by sourceId<br/>Keep current edits"]
  ow_dialog -->|"Replace project"| ow_replace["Replace the saved project with the archive"]
  ow_new --> ow_editor
  ow_restore --> ow_editor
  ow_replace --> ow_editor
  ow_editor["Editor (/projects/[id])"] --> ow_all{"Every referenced source present?"}
  ow_all -->|"Yes"| ow_ready(["Editor ready"])
  ow_all -->|"No"| ow_notloaded(["Clips with a missing source stay “Audio not loaded”"])
```

Validation rejects an archive with any of these properties:
- A `..`, absolute or backslash path.
- More than 1000 entries.
- Duplicate paths, compared case-insensitively.
- A compression method other than 0.
- The encryption flag set.
- Sizes inconsistent with the file.
- A total size above 500 MB.
- A `project.json` above 5 MB or with JSON depth above 64.
- A CRC-32 mismatch.

### Panic

```mermaid
flowchart TD
  pa_button(["Select “Panic”"]) --> pa_send
  pa_key(["Press Escape"]) --> pa_where{"Focus in a text field, or a dialog or menu open?"}
  pa_where -->|"Yes"| pa_normal(["Escape keeps its usual behaviour"])
  pa_where -->|"No"| pa_send["Send panic to the engine"]
  pa_send --> pa_stop["Within 20 ms: stop the transport;<br/>end every voice, one-shot drum hit, preview and audition;<br/>clear effect buffers"]
  pa_stop --> pa_fade["The safety stage applies a 50 ms fade-in to the next sound"]
  pa_fade --> pa_done(["Announce “All sound stopped”"])
```

### Route coverage

| Route | Flows |
|---|---|
| `/` | First visit, Return visit, Open a .wrack file |
| `/new` | First visit, Create project |
| `/projects` | Return visit |
| `/projects/[id]` | First visit, Create project, Return visit, Save preset, Import audio, Export WAV, Save a .wrack file, Open a .wrack file, Panic |
| `/settings` | Volume notice, Save preset |
| Unknown project ID | Return visit |

## Onboarding research

The full study, with sources and confidence labels, is in [`docs/onboarding-research.md`](docs/onboarding-research.md). It compares the first-run experience of BandLab Studio, Chrome Music Lab Song Maker and Ableton Live 12, each researched by an independent agent against official documentation, help-center articles and, for Song Maker, the production code.

### Findings

| ID | Finding | BandLab Studio | Song Maker | Ableton Live 12 |
|---|---|---|---|---|
| F1 | Gate before content | Account | None | Account, installation, authorization |
| F2 | Actions to first sound | 5 after sign-in | 1 (place a note) | 3 on first launch with the demo Set |
| F3 | Empty-state strategy | New Track pop-up | Playable grid | Demo Set, then an empty Default Set |
| F4 | Sound starts on | User action | User action | User action |
| F5 | Fields before work | Track type | None | None |
| F6 | Learning model | Tutorial from the Help menu | Learning by doing | Lessons beside the work |
| F7 | Return memory | Cloud Library | Server share link | Recent Sets, crash restore |
| F8 | Level safety | Red master meter | Fixed −6 dB levels | No default limiter |
| F9 | Browser audio rule | Gesture required | Resumes on first note | Not applicable |
| F10 | Permission requests | When a device is used | Web MIDI on load | None |
| F11 | Unsaved work | Manual save | Lost unless saved | Manual save, crash restore |

### Decisions

| Decision | Findings |
|---|---|
| No account, permission request or form before content | F1, F10 |
| Examples on every visit; Recent first on return visits | F3, F7 |
| An example reaches first sound in two actions: open the card, press Play | F2 |
| Examples open stopped, with Play highlighted and the hint "Press Play to hear this example"; cards on Home do not preview sound | F4, F9 |
| Examples are MIDI-only and open as a copy that saves on first edit | F2, F3 |
| A volume notice precedes the first sound of a session, and its `Continue` resumes the `AudioContext` | F8, F9 |
| The master defaults to −12 dB, with a fixed safety limiter last | F8 |
| `/new` asks for three prefilled fields, with inline errors that keep input | F5 |
| Empty regions offer the next action, and placing a note previews it | F2, F3, F6 |
| Help appears in context; there is no modal tour | F6 |
| Return visits restore the working state with the transport stopped; imported audio persists on the device | F7 |
| Web MIDI access is requested only from a button | F10 |
| Edits save locally 500 ms after the last change, with a visible save status | F11 |

## First-run check

The main flow was run in Chromium, Firefox and WebKit with empty profiles against the production build: no sound before a user action, Home, an example played after the volume notice, a new project, a saved preset, a return visit with the working state restored, WAV export and a `.wrack` round trip. Every step passed, and the site made no third-party requests. The review as a brand-new and as a returning user is addressed as follows:

- An empty clip opens with Step input on, so pressing a key adds a note, as the empty-editor hint says.
- The editor fits one screen: the transport and the arrangement come first, and the dock below holds the Editor, Devices and Mixer tabs.
- The timeline has a bar-number ruler and track names.
- The `.wrack` controls explain what a `.wrack` file is and that edits save in the browser automatically.
- Each instrument and effect shows its current preset.
- Split and Join are disabled until the project has clips.

The full results, the feedback and the items left open are in [`docs/first-run-check.md`](docs/first-run-check.md).

## Features

| Area | What W-Rack provides |
|---|---|
| Editor | One screen without page scrolling: project header with rename, save status and a File menu (Save .wrack file, Open .wrack file, Export WAV); an icon transport; a clip toolbar with Add and Edit menus, Snap and Grid, zoom, and split, join, duplicate and delete; the arrangement, whose ruler and track headers stay in view while it scrolls; a resizable dock with Editor, Devices and Mixer tabs that collapses to its tabs; tooltips with the name and shortcut on icon controls; an info strip that describes the control under the pointer or in focus and shows the live-input target |
| Transport | Go to start (`Home`; `Shift+Home` for the loop start), Play/Pause (`Space`), Stop (returns to where playback started; a second Stop goes to bar 1, or to the loop start with the loop on), Loop, Metronome, Position, Tempo, Time signature (1–32 beats over a note value from 1 to 32), master volume and meter, Panic (`Escape`); a tempo change during playback keeps the musical position |
| Loop | A band in the ruler: drag empty ruler space to draw a loop and turn it on, drag its edges to resize it and, while the loop is on, its body to move it; a click in the ruler moves the edit cursor; "Loop start" and "Loop end" handles move by keyboard |
| Instruments | Subtractive, FM, additive, pluck (Karplus–Strong), granular, a 14-voice drum machine with General MIDI note mapping, and a sampler with a keyboard-operable sample editor; parameters are knobs grouped in sections, and choices are segmented buttons; a track's Instrument select changes its instrument type in place, keeping its clips, effects, mixer settings, name and colour |
| MIDI | Piano roll with notes in the track colour, keyboard note entry, drawing by drag, stretching from either end of a note, pitch drags that audition and scroll the view, straight and triplet grids, a zoom independent of the grid, step input, a velocity lane, quantize and clip looping; MIDI clips loop in the timeline by the top of their right edge or the clip menu; a double-click on an empty instrument lane adds a MIDI clip there; selecting a clip opens it in the piano roll; computer-keyboard and Web MIDI live input, played on the armed instrument tracks (Arm on the track header, or `R` on its row) or else on the selected one |
| Audio | Multi-file import (also by dropping files on the lanes, or a double-click on an empty audio lane), waveform timeline with a bar ruler and a keyboard treegrid, marquee selection, a clip menu (right-click, `Shift+F10`) that acts on the selection, split, join, trim, move, duplicate, rename, fades, crossfades, clip gain and gain envelopes, editable by on-clip handles or by sliders in the clip properties |
| Tracks | Add, rename (`F2` on the row, double-click on the header, or the Edit menu), delete (with a confirmation when the track has clips), mute, solo and arm; track and clip colours: teal, violet, olive, rose, copper, slate, plum, steel, mustard, pine, taupe |
| Effects | EQ, filter, compressor, saturation, distortion (soft clip, hard clip, foldback), delay and reverb in chains of up to eight on every track and the master; the Devices tab shows a track's instrument and effects left to right, and the master chain ends in the safety limiter |
| Mixer | Vertical channel strips: pan knob, fader with a dB scale beside a peak meter with hold, mute, solo and a clip indicator; a master strip at the right with the limiter readout |
| Safety | A fixed safety stage after the master: guard, DC blocker, sustained-level duck, −1 dBFS limiter and a 50 ms start fade |
| Projects | Automatic local saving, undo and redo, restored working state, project lists with tempo, time signature, track count and origin, rename and duplicate, a personal preset library with auditions, `.wrack` archives, WAV export with progress, Cancel and Download |
| Commands | A command palette (`Ctrl+K` or `Ctrl+Shift+P`, `Cmd` on macOS, or the header's Commands button) that searches and runs every command with its shortcut; `?` lists every shortcut |

Keyboard shortcuts (`Ctrl` reads `Cmd` on macOS):

| Keys | Command |
|---|---|
| `Space`, `Home`, `Shift+Home`, `Escape` | Play/Pause, Go to start, Go to loop start, Panic |
| `L`, `C` | Loop, Metronome |
| `N`, `+`, `−` | Snap on or off, finer grid, coarser grid; `Alt` while dragging places freely |
| `Alt+=`, `Alt+−` | Zoom in, zoom out |
| `Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y` | Undo, Redo; edits within 600 ms form one step, and a text field keeps its own undo |
| `Ctrl+E`, `Ctrl+J`, `Ctrl+D`, `Delete`, `Ctrl+A` | Split at edit cursor, Join clips, Duplicate, Delete, Select all clips |
| `Ctrl+S`, `Ctrl+O`, `Ctrl+Shift+E`, `Ctrl+,` | Save .wrack file, Open .wrack file, Export WAV, Settings |
| `Ctrl+K` or `Ctrl+Shift+P`, `?` | Command palette, keyboard shortcuts |
| `A` `W` `S` `E` `D` `F` `T` `G` `Y` `H` `U` `J` `K`, `Z`, `X` | Computer-keyboard notes C to C, octave down, octave up; no page-wide letter shortcut uses these keys |

Single-key shortcuts do not act in text fields, menus or lists.

All audio runs in one AudioWorklet engine followed by the safety stage; no native Web Audio DSP nodes are used. Implementation details are in [`docs/a3-audio-implementation.md`](docs/a3-audio-implementation.md).

Icons are from [Lucide](https://lucide.dev) 1.58.0 (ISC licence). Their shapes are vendored in `src/components/ui/icons/lucide.js`, with the licence in `src/components/ui/icons/LICENSE.lucide`; the site loads no icon package.

## Browser support

| Browser | Status |
|---|---|
| Chrome and Edge (Chromium) | Supported. Web MIDI is available after its permission prompt. `.wrack` files save through the file picker. |
| Firefox | Supported. Web MIDI needs Firefox's site-permission add-on; connect the MIDI device before starting Firefox. Files save as downloads. |
| Safari (WebKit) | Supported without Web MIDI. Safari can delete site data after 7 days without a visit, so `.wrack` backups are recommended; private windows keep imported audio for the session only. Files save as downloads. |

The end-to-end suite runs in Chromium, Firefox and WebKit.

## Storage

| Data | Where |
|---|---|
| Projects, working state, presets, settings | `localStorage`, keys starting with `w-rack:v1:` |
| Imported audio (original file bytes) | IndexedDB database `w-rack`, store `sources` |

Nothing leaves the device. `/settings` shows storage use, lists stored audio with the projects that use it, and offers "Clear all data".

## Limits

| Limit | Value |
|---|---|
| Tracks | 16 |
| Voices | 16 per instrument, 64 in total |
| Effects per chain | 8; at most 4 reverbs per project |
| Decoded audio per project | 20 minutes |
| Sampler source | 60 s; mip memory 64 MB in total |
| Expanded MIDI notes per track | 20 000 |
| Export | 10 minutes plus a tail of up to 10 s |
| `.wrack` archive | 500 MB |
| Presets | 200 |

The full list is in [`docs/assignment-3-scope.md`](docs/assignment-3-scope.md) (Limits).

## Accessibility

W-Rack targets WCAG 2.2 AA. Canvas views have DOM mirrors: the timeline is a `treegrid` named "Tracks and clips" and the piano roll a `grid` named "Notes". Every control has a role and a name that is unique within its landmark.

| Pair | Contrast |
|---|---|
| Text on background | 13.6:1 |
| Muted text on background | 5.7:1 |
| Control boundaries on background | 3.6:1 |
| Focus ring on background | 4.8:1 |
| Primary button text on signal orange | 5.6:1 |
| Panic text on red | 5.8:1 |
| Track colours on the lanes | 3.5:1 or more |

The checks, keyboard paths and known gaps are recorded in [`docs/a11y-check.md`](docs/a11y-check.md).

## Development

Node 24 and the Playwright browsers install under `.tools/` (git-ignored); every command runs with `PATH=$PWD/.tools/node/bin:$PATH`.

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server; worklet sources are copied to `public/worklets/` and watched |
| `pnpm build` | Static export to `out/` |
| `pnpm start` | Serves `out/` on port 3100 with the rewrites and headers in `vercel.json` |
| `pnpm lint` | ESLint, including the audio-thread rules for `src/dsp` and `src/worklet` |
| `pnpm test:dsp` | Unit tests in Node (`tests/dsp`) |
| `pnpm e2e:install` | Installs Chromium, Firefox and WebKit into `.tools/ms-playwright` |
| `pnpm test:e2e` | End-to-end tests in the three browsers against `out/`, or against `BASE_URL` when set; the CPU benchmark runs last, alone |

Deployment: Vercel runs `pnpm build` and serves `out/` with `vercel.json`, which rewrites every `/projects/<id>` path to the prerendered editor shell and serves `/worklets/` with `Cache-Control: no-cache`.
