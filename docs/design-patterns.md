# Design patterns

## Scope
This library defines interaction patterns for W-Rack, derived from web DAWs (BandLab Studio, Soundtrap, openDAW, Chrome Music Lab Song Maker) and desktop DAWs (Ableton Live 12, FL Studio, Logic Pro, Bitwig Studio 5, REAPER with OSARA, Studio One). Each pattern names a problem, the rules that solve it, prior art, its W-Rack location, accessibility requirements and anti-patterns.

- Apply **Solution** rules as acceptance criteria and **Accessibility** rules as test cases.
- Where a pattern and `assignment-3-scope.md` differ, the scope applies.

| Term | Definition |
|---|---|
| Project | One W-Rack document: tracks, clips, mixer, effects, transport settings |
| Example | A shipped project that opens as a copy |
| Archive | A `.wrack` file containing project data and imported audio |
| Chain | The ordered device list (instrument, effects) on a track or the master |
| Mirror | A DOM `grid` or `treegrid` exposing canvas content to assistive technology |
| `Mod` | Ctrl on Windows and Linux, Cmd on macOS |

## Index
| ID | Name | W-Rack location |
|---|---|---|
| `HOME-01` | Recent-first start page | `/` |
| `HOME-02` | Three entry points | `/` |
| `HOME-03` | Stopped-on-open examples | `/` → editor |
| `HOME-04` | Example as copy, saved on first edit | Editor |
| `ONB-01` | Actionable empty states | Timeline, piano roll, chains |
| `ONB-02` | One action to a playable surface | Add track menu |
| `NEW-01` | Short form with defaults | `/new` |
| `NEW-02` | Inline validation that keeps input | `/new`, Save preset dialog |
| `NEW-03` | Settings editable in place | Transport, header |
| `RET-01` | Recent list with metadata | `/`, `/projects` |
| `RET-02` | Resume where you left off | `/projects/[id]` |
| `SAVE-01` | Autosave with visible status | Editor header |
| `SAVE-02` | Self-contained archive | Save `.wrack` file |
| `SAVE-03` | Open-file conflict choice | Open `.wrack` file |
| `SAVE-04` | Missing audio relink | Audio not loaded |
| `LIB-01` | Grouped picker with My presets | Preset pickers |
| `LIB-02` | Save preset dialog | Save preset |
| `LIB-03` | Audition at a controlled level | Preset pickers |
| `TRN-01` | Transport bar anatomy | Transport |
| `TRN-02` | Play, pause, stop and locate | Transport, global keys |
| `TRN-03` | Loop range in the ruler | Timeline ruler |
| `ARR-01` | Track header controls | Track headers |
| `ARR-02` | Clip selection model | Timeline |
| `ARR-03` | Conventional edit commands | Timeline |
| `ARR-04` | Visible snap with bypass | Editor toolbar |
| `ARR-05` | Fades, crossfades, gain, envelopes | Audio clips |
| `ARR-06` | Zoom and scroll | Timeline, piano roll |
| `PR-01` | Single tool with keyboard entry | Piano roll |
| `PR-02` | Note preview on placement | Piano roll |
| `PR-03` | Velocity lane and quantize | Piano roll |
| `PR-04` | Drum rows | Piano roll on drum tracks |
| `DEV-01` | Linear chain with bypass | Track and master chains |
| `DEV-02` | Knobs with units and reset | Device panels, mixer pan |
| `DEV-03` | Sample editor with keyboard markers | Sampler device |
| `MIX-01` | Channel strip and master defaults | Mixer |
| `MIX-02` | Peak meters with clip hold | Mixer |
| `EXP-01` | Export dialog fields | WAV export dialog |
| `EXP-02` | Progress and cancellation | WAV export dialog |
| `SAFE-01` | Volume notice before first sound | Global |
| `SAFE-02` | Fixed safety limiter last | Master chain |
| `SAFE-03` | Plain-language errors, overload, panic | Import, engine, transport |
| `A11Y-01` | Canvas mirrored by DOM grid | Timeline, piano roll |
| `A11Y-02` | Position and edit announcements | Live region, `/settings` |
| `A11Y-03` | Unique names, color-independent state | All regions |
| `A11Y-04` | Alternatives to dragging | Timeline, chains |
| `HELP-01` | Icon controls, tooltips and help text | All controls |
| `HELP-02` | Command palette and shortcut overlay | Global |

## First screen

### `HOME-01` Recent-first start page
- **Problem:** A returning user has to find the last project before work continues.
- **Solution:** When saved projects exist, `Recent` comes first: up to five, newest first, each opening in one activation, with "View all projects" linking to `/projects`. `Recent` is hidden when empty.
- **Prior art:** Studio One's Start page pairs a Recent Files list with pinning and create/open actions.
- **W-Rack application:** On `/`, `Recent` precedes Create, Load and Examples on return visits.
- **Accessibility:** A `list` of `link`s named by project title; the modified date is in the description.
- **Anti-patterns:** Preview panes before open; unlabeled thumbnail tiles.

### `HOME-02` Three entry points
- **Problem:** One dominant button hides the intents "continue a file" and "explore".
- **Solution:** Three verb-labeled entries of equal weight: `New project`, `Open .wrack file`, and the Examples row.
- **Prior art:** Logic Pro's Project Chooser lists templates, demo projects and tutorials. Soundtrap's first studio window offers new projects and demos. Bitwig Studio 5's Dashboard offers New Project.
- **W-Rack application:** `New project` → `/new`; `Open .wrack file` → file picker → `SAVE-03`; example cards Beat, Ambient, Pluck melody.
- **Accessibility:** A link, a button and a `list` of card links in reading order.
- **Anti-patterns:** Sign-up walls before content; a forced template choice.

### `HOME-03` Stopped-on-open examples
- **Problem:** Sound on load startles users, and browsers block it before a gesture.
- **Solution:** Examples open stopped at bar 1. Play is highlighted, with the hint "Press Play to hear this example"; the highlight clears after first playback. Example cards on Home do not preview sound.
- **Prior art:** Chrome creates an `AudioContext` made before a user gesture in the `suspended` state. Song Maker plays only on Play or Space.
- **W-Rack application:** Editor transport for example copies; the hint is linked to Play with `aria-describedby`.
- **Accessibility:** Focus is not moved on load. The highlight meets 3:1 non-text contrast and has a text label.
- **Anti-patterns:** Autoplay on open; card previews on Home; pulsing animation that ignores reduced motion.

### `HOME-04` Example as copy, saved on first edit
- **Problem:** Editing a shipped example damages it or fills the project list with untouched copies.
- **Solution:** Opening an example creates an in-memory copy named "<Example> (copy)". The first edit saves it and adds it to `Recent`; leaving without edits writes nothing.
- **Prior art:** Soundtrap's demo projects open for remixing. Logic Pro creates template projects as `Untitled`.
- **W-Rack application:** The header shows "Copy of example — saved on first edit" until the first edit.
- **Accessibility:** The first save announces "Saved as Beat (copy)" politely.
- **Anti-patterns:** A name prompt before playback; saving untouched copies.

## Onboarding

### `ONB-01` Actionable empty states
- **Problem:** Empty timelines, piano rolls and chains give no next step.
- **Solution:** Each empty region shows one sentence and buttons that perform the next step:
  - Timeline: "No tracks." with `Add instrument track` and `Add audio file`.
  - Chain: `Add effect`.
  - Piano roll: "Press a key or click the grid to add a note."
- **Prior art:** BandLab Studio shows a New Track panel when a project first opens. Logic Pro's Empty Project opens the New Tracks dialog.
- **W-Rack application:** Timeline, piano roll, track chains, master chain.
- **Accessibility:** The message is visible text, not a placeholder; button names are unique in the region.
- **Anti-patterns:** A blocking modal as the empty state; illustrations without actions.

### `ONB-02` One action to a playable surface
- **Problem:** Setup steps delay the first sound.
- **Solution:** `Add instrument track` with an instrument choice (subtractive, FM, additive, pluck, granular) creates the track with default settings and a four-bar MIDI clip, and opens the piano roll with note preview on.
- **Prior art:** Song Maker shows a playable grid on load. BandLab starts new users from a loop.
- **W-Rack application:** Editor Add track menu. The first note passes through `SAFE-01`.
- **Accessibility:** Focus moves to the first piano-roll mirror cell; the result is announced: "Pluck track added, clip open in piano roll".
- **Anti-patterns:** Opening a parameter-heavy panel before any note exists.

## Project creation

### `NEW-01` Short form with defaults
- **Problem:** Many required settings discourage starting.
- **Solution:** Three fields: Name (prefilled "Untitled project N"), Tempo (default 120), Time signature (default 4/4). No sample rate or bit depth. Primary button `Create project`.
- **Prior art:** Logic Pro hides tempo, key and time signature behind a Details disclosure and defaults to 120 bpm. Studio One's New Song dialog asks sample rate, bit depth, tempo and time signature.
- **W-Rack application:** `/new` → `/projects/[id]`. Field rules are in `assignment-3-scope.md`.
- **Accessibility:** Visible `<label>`s; tempo uses `inputmode="numeric"`; time signature is a native `<select>`.
- **Anti-patterns:** Required technical settings; an empty required name.

### `NEW-02` Inline validation that keeps input
- **Problem:** Clearing a form on error loses work and hides the cause.
- **Solution:** Validate on blur of an edited field and on submit. Each error sits under its field and states the rule. Values remain; focus moves to the first invalid field.
- **Prior art:** Desktop DAWs clamp tempo silently, which hides out-of-range input.
- **W-Rack application:** `/new` and the Save preset dialog, with the error strings in `assignment-3-scope.md`.
- **Accessibility:** `aria-invalid="true"` and `aria-describedby`; errors are text, not color alone.
- **Anti-patterns:** Silent clamping; alert dialogs; clearing fields.

### `NEW-03` Settings editable in place
- **Problem:** Settings fixed at creation force a new project to change them.
- **Solution:** Tempo and time signature stay editable in the transport and the name in the editor header, under the `/new` rules. Changes are undoable.
- **Prior art:** Logic Pro project properties change at any time. BandLab edits tempo in place.
- **W-Rack application:** Transport tempo field and time-signature select; header name field.
- **Accessibility:** Enter or blur commits; Escape reverts.
- **Anti-patterns:** A settings modal as the only path to tempo.

## Return experience

### `RET-01` Recent list with metadata
- **Problem:** Similar project names are hard to tell apart.
- **Solution:** Each entry shows name, relative and absolute last-edited date, tempo, time signature, track count and an origin badge ("From example: Beat"). `/projects` adds rename, duplicate and confirmed delete. No waveform thumbnails.
- **Prior art:** Studio One Recent Files; Logic Pro's recent list.
- **W-Rack application:** One entry component on `/` (five newest) and `/projects` (all).
- **Accessibility:** Metadata through `aria-describedby`; row actions named with the project ("Rename Beat (copy)").
- **Anti-patterns:** Thumbnail-only grids; dates without a year beyond twelve months.

### `RET-02` Resume where you left off
- **Problem:** Reopening at default zoom and position wastes navigation.
- **Solution:** Restore playhead, loop range and state, zoom, scroll, selection and open panel. The transport opens stopped.
- **Prior art:** Ableton Live 12's Learn View returns to the last visited page.
- **W-Rack application:** Working state per `assignment-3-scope.md` (Resume where you left off).
- **Accessibility:** Focus lands in the editor's main region; "Restored view at bar 9" is announced.
- **Anti-patterns:** Resuming playback; restoring open dialogs.

## Saving and files

### `SAVE-01` Autosave with visible status
- **Problem:** Explicit-save-only loses work on tab close; silent autosave leaves users unsure.
- **Solution:** Save after each committed edit (500 ms debounce). The header shows "Saved on this device", "Saving…" or "Not saved — storage full". On a quota error, the editor keeps the in-memory state, shows a persistent banner and offers `Save .wrack file`.
- **Prior art:** Logic Pro autosaves new projects. Ableton Live offers recovery after a crash. BandLab syncs to its cloud.
- **W-Rack application:** Editor header; `beforeunload` prompts only while a save is pending or failed, or while session-only audio is unsaved to a file.
- **Accessibility:** `role="status"` for state changes; `role="alert"` for the quota failure.
- **Anti-patterns:** An unconditional leave prompt; recovery that needs manual file renaming.

### `SAVE-02` Self-contained archive
- **Problem:** Projects that reference external media break when moved.
- **Solution:** `Save .wrack file` (`Mod+S`) writes project JSON, every loaded audio source and the format version. The archive contains no path references.
- **Prior art:** Ableton Live's Collect All and Save copies media into the project folder. REAPER's save dialog can move media into the project directory. DAWproject packages audio with the project XML.
- **W-Rack application:** Editor menu; downloads `<name>.wrack`.
- **Accessibility:** File name and size are announced on completion.
- **Anti-patterns:** A separate collect step; unversioned archives.

### `SAVE-03` Open-file conflict choice
- **Problem:** Opening an archive of an existing project can overwrite work.
- **Solution:** When the archive's project ID matches a saved project, a dialog offers `Restore audio` (keep the saved project, load missing audio), `Replace project` and `Cancel`. Otherwise the archive opens as a new saved project.
- **Prior art:** Ableton Live prompts to save Sets from earlier versions under a new name.
- **W-Rack application:** `/` → dialog → `/projects/[id]`.
- **Accessibility:** `<dialog>` with initial focus on `Restore audio`; Escape cancels.
- **Anti-patterns:** A Yes/No "Overwrite?" prompt; a destructive default button.

### `SAVE-04` Missing audio relink
- **Problem:** Absent audio leaves clips silent without explanation.
- **Solution:** Clips without audio show hatching and the text "Audio not loaded". A banner lists the files and offers `Open .wrack file to restore audio`. Clips without a match stay marked.
- **Prior art:** Ableton Live's File Manager lists missing files and, after one manual locate, searches the same location for the rest. REAPER offers a search after one file is found.
- **W-Rack application:** Editor banner and clip overlay; sources match by `sourceId`.
- **Accessibility:** Mirror cell names include "audio not loaded"; the banner is a `region` named "Missing audio".
- **Anti-patterns:** A blocking modal on open; an `OFFLINE` label with no cause or action.

## Preset library

### `LIB-01` Grouped picker with My presets
- **Problem:** A flat list mixes built-in and user settings.
- **Solution:** Groups "My presets" (shown when non-empty) above "Built-in"; type-ahead filter; a preset applies on Enter or click only.
- **Prior art:** Ableton Live's browser with search and categories; Logic Pro's My Templates; OSARA's preset dialog, which navigates without applying.
- **W-Rack application:** Instrument and effect preset pickers.
- **Accessibility:** `combobox` with a `listbox` of labeled groups; arrow keys move without applying.
- **Anti-patterns:** Apply-on-focus, which makes sound and moves parameters while browsing.

### `LIB-02` Save preset dialog
- **Problem:** Unvalidated names create duplicates.
- **Solution:** One Name field prefilled with "<current> (my version)", validated per `assignment-3-scope.md` (Presets). A duplicate name shows its error under the field; the entered name remains.
- **Prior art:** Ableton Live saves presets from the device title bar; Logic Pro prompts for a template name.
- **W-Rack application:** Device header `Save preset`; the result appears under "My presets".
- **Accessibility:** Focus moves to Name on open and returns to the trigger on close.
- **Anti-patterns:** Silent overwrite; automatic numbering without the user's input.

### `LIB-03` Audition at a controlled level
- **Problem:** Full-scale previews cause level jumps.
- **Solution:** A preview button per preset plays a one-bar phrase through the track chain and the safety limiter at the track's fader level. Preview stops on selection change or Escape. Selecting a preset does not preview it.
- **Prior art:** Ableton Live previews in sync with the Set and has a preview volume control.
- **W-Rack application:** Preset picker rows. The first preview passes through `SAFE-01`.
- **Accessibility:** A toggle with `aria-pressed`, named "Preview Warm pad".
- **Anti-patterns:** Previews that bypass the master; previews that continue after the picker closes.

## Transport

### `TRN-01` Transport bar anatomy
- **Problem:** Inconsistent layouts slow recognition.
- **Solution:** Icon buttons in this order: Go to start (⏮), Play/Pause (▶/⏸), Stop (■), Loop, Metronome; then Position, Tempo, Time signature, master volume, meter and Panic. Position shows bars.beats.sixteenths (`1.1.1`) in a monospace readout, with a `mm:ss.mmm` toggle; the status reads "Playing", "Paused" or "Stopped".
- **Prior art:** GarageBand, Logic Pro's control bar and BandLab pair one Play/Pause button with a separate Stop. Soundtrap's bottom bar groups transport, tempo and metronome. Logic Pro sets tempo by field or tap.
- **W-Rack application:** `role="toolbar"` named "Transport".
- **Accessibility:** Play/Pause is one button named for the action it performs, "Play" or "Pause", without `aria-pressed`. Each icon button has a name and a tooltip with its key. The position is text, read on demand.
- **Anti-patterns:** A Play toggle that is also the only way to stop; changing the name and `aria-pressed` together; the position rendered as an image.

### `TRN-02` Play, pause, stop and locate
- **Problem:** Products disagree on where stop returns the playhead.
- **Solution:**
  - Space toggles Play and Pause. Pause holds the playhead; Play resumes from it.
  - Stop, while playing or paused, halts and returns the playhead to where playback started; resuming from a pause keeps that start.
  - Stop while stopped goes to bar 1, or to the loop start when the loop is on. Stop is disabled when stopped at bar 1.
  - `Home` locates to bar 1; `Shift+Home` to the loop start.
  - Escape and Panic stop every sound and leave the transport stopped, not paused.
  - Space does nothing special inside text fields or on focused buttons.
- **Prior art:** Space is play/pause in GarageBand, Logic Pro and BandLab; Logic Pro's Stop returns to the play start and a second Stop goes to the beginning.
- **W-Rack application:** Global key handler excluding `input`, `textarea`, `select`, `button` and `[contenteditable]`.
- **Accessibility:** A focused native button keeps its own Space behavior.
- **Anti-patterns:** Capturing Space in fields; Enter as play.

### `TRN-03` Loop range in the ruler
- **Problem:** A loop toggle without a visible range plays an unknown span.
- **Solution:**
  - The ruler shows the loop range as a band: lit while the loop is on, grey while it is off. While on, its edges continue down the lanes.
  - Dragging empty ruler space draws a loop and turns the loop on. Dragging the band's edges resizes it; dragging its body moves it. Edges snap to the grid while snap is on; Alt bypasses snap. A click without a drag moves the edit cursor.
  - The loop is at least one grid step long.
  - Playback wraps at the loop end only when it reaches the end from before it. Playback that starts after the loop end, or passes it before the loop is on, continues.
- **Prior art:** Logic Pro's cycle area and Ableton Live's loop brace in the ruler; both continue past a loop that playback starts after.
- **W-Rack application:** Timeline ruler; the range is part of the working state and sets the Export loop range.
- **Accessibility:** "Loop start" and "Loop end" are `slider` handles on the band's edges, valued in bars ("bar 3 beat 2"). Arrow keys move by a grid step, Page Up and Page Down by a bar, Home and End to the limits. Changes are announced ("Loop bar 3 to bar 5, on").
- **Anti-patterns:** A loop range set only in a dialog; a loop that jumps back from beyond its end.

## Arrangement

### `ARR-01` Track header controls
- **Problem:** Unlabeled letter buttons hide state.
- **Solution:** Editable name, then Mute and Solo, with the track type. Muted tracks dim and show "Muted"; soloed tracks show "Solo".
- **Prior art:** BandLab's mix panel; Ableton Live's track headers.
- **W-Rack application:** Timeline headers, mirrored in the mixer.
- **Accessibility:** "Mute Bass" and "Solo Bass" with `aria-pressed`; `M` and `S` act on the focused track.
- **Anti-patterns:** Color-only mute; identical "M" names on every track.

### `ARR-02` Clip selection model
- **Problem:** Ambiguous selection makes edits unpredictable.
- **Solution:** Click selects; Shift+click extends; Mod+click toggles; dragging on empty space draws a marquee; `Mod+A` selects all in the focused region. Selection survives edits and persists with the working state.
- **Prior art:** Ableton Live moves selected clips with the arrow keys.
- **W-Rack application:** Timeline canvas and mirror.
- **Accessibility:** `aria-selected` on mirror cells; Space or Enter selects; Shift+Arrow extends.
- **Anti-patterns:** Selection lost after split or duplicate.

### `ARR-03` Conventional edit commands
- **Problem:** Non-standard keys force relearning.
- **Solution:** Split at the edit cursor `Mod+E`; duplicate `Mod+D`; join `Mod+J`; delete `Delete` or `Backspace`; move by grid `Left`/`Right`; trim start `Alt+Left`/`Alt+Right`; trim end `Alt+Shift+Left`/`Alt+Shift+Right`; on a clip, `Alt+Up`/`Alt+Down` move it to the adjacent track of the same kind; on a track, they reorder tracks. Comma and period move the edit cursor by the grid step, with Shift by a bar. Every command also appears in the clip context menu and `HELP-02`.
- **Prior art:** Ableton Live 12 uses `Mod+E` split, `Mod+D` duplicate, `Mod+J` consolidate. OSARA provides keyboard move and trim for REAPER items.
- **W-Rack application:** Audio and MIDI clips; edge handles for pointer trim.
- **Accessibility:** Results are announced ("Split Vox 1 at 5.1.1, two clips"); the context menu opens with `Shift+F10`.
- **Anti-patterns:** Split only at the pointer; join that fills gaps without notice.

### `ARR-04` Visible snap with bypass
- **Problem:** Hidden snap state misaligns edits.
- **Solution:** The toolbar shows "Snap: 1/16". `N` toggles snap; `+` and `-` change the grid; Alt while dragging bypasses snap. Snap is on by default.
- **Prior art:** BandLab's snap is on by default; Ableton Live changes the grid with plus and minus.
- **W-Rack application:** One snap setting per project for timeline and piano roll.
- **Accessibility:** An `aria-pressed` toggle and a labeled select; changes are announced.
- **Anti-patterns:** Snap state shown only by icon tint.

### `ARR-05` Fades, crossfades, gain, envelopes
- **Problem:** Small corner handles are hard to hit and unreachable by keyboard.
- **Solution:**
  - Fade handles at the top corners and a gain handle at top center, each at least 24 × 24 CSS px, with a dB readout.
  - Overlaps create equal-power crossfades.
  - Envelope points are added by double-click and removed with Delete.
  - A properties panel provides numeric fade length, fade curve, clip gain and envelope point fields, within the ranges in `assignment-3-scope.md`.
- **Prior art:** Ableton's accessibility documentation lists automation and clip edge fades as unsupported for screen readers; W-Rack provides numeric alternatives.
- **W-Rack application:** Timeline audio clips and the clip properties panel.
- **Accessibility:** Numeric fields satisfy WCAG 2.5.7. Envelope points are mirror rows ("time, dB") adjusted with Up and Down.
- **Anti-patterns:** Handle-only fades; gain without units.

### `ARR-06` Zoom and scroll
- **Problem:** DAW zoom collides with browser zoom on `Mod+wheel` and `Mod+=`/`Mod+-`.
- **Solution:** Wheel scrolls vertically; Shift+wheel scrolls horizontally; Alt+wheel zooms at the pointer; `Alt+=`, `Alt+-` and `Alt+0` zoom in, zoom out and fit. `Mod+=`, `Mod+-` and `Mod+0` stay with the browser.
- **Prior art:** Ableton Live zooms to the selection with `Z` and back with `X`.
- **W-Rack application:** Timeline and piano roll; zoom persists in the working state.
- **Accessibility:** Zoom changes are announced; the page reflows at 200% browser zoom (WCAG 1.4.4, 1.4.10).
- **Anti-patterns:** Intercepting Ctrl+wheel.

## Piano roll

### `PR-01` Single tool with keyboard entry
- **Problem:** Modal tool palettes confuse; mouse-only entry excludes keyboard users.
- **Solution:**
  - Pointer: clicking an empty cell adds a grid-length note; clicking a note selects it; dragging moves; dragging an edge resizes; `B` toggles a paint mode.
  - Keyboard: arrows move the cursor; Enter adds or removes a note; Delete removes it; Alt+Left/Right moves it by a grid step and Alt+Up/Down transposes it by a row; Shift+Left/Right changes length; Shift+Up/Down changes velocity by 8. Left from the first column reaches the row header, where Space or Enter previews the row.
  - A loop brace above the grid has numeric start and end fields.
- **Prior art:** Ableton Live's draw mode and grid-stepped insert marker; Song Maker's click-to-toggle cells.
- **W-Rack application:** Piano roll panel.
- **Accessibility:** `grid` mirror with rows named by pitch ("C4") and columns by step ("Bar 1 beat 2"); cells expose state, velocity and length.
- **Anti-patterns:** Five-mode palettes; drag-only note creation.

### `PR-02` Note preview on placement
- **Problem:** Silent note entry hides pitch errors.
- **Solution:** Placing, selecting or transposing a note plays it for 250 ms at its velocity through the track chain. The "Preview notes" toggle is on by default. No preview plays during playback.
- **Prior art:** Ableton recommends note preview for screen-reader users; Song Maker sounds each cell on click.
- **W-Rack application:** Piano roll toolbar; the first preview passes through `SAFE-01`.
- **Accessibility:** The audible preview supplements the announced pitch name.
- **Anti-patterns:** Doubled notes during playback.

### `PR-03` Velocity lane and quantize
- **Problem:** Dialog-only velocity editing is slow; destructive quantize loses timing.
- **Solution:** A velocity lane (1–127) shows values on hover and focus and edits several notes at once. `Q` quantizes the selection, or all notes, to the grid at 100%. Undo restores the original timing.
- **Prior art:** BandLab's MIDI editor; DAWproject stores note velocity.
- **W-Rack application:** Lower piano-roll lane and the Quantize button.
- **Accessibility:** Each bar is a `slider` named "Velocity C4 bar 1.1" with Arrow, Page Up/Down and Home/End keys.
- **Anti-patterns:** Velocity without a numeric readout.

### `PR-04` Drum rows
- **Problem:** Rows labelled C1–C8 do not say which drum a note triggers.
- **Solution:**
  - On drum machine tracks, each row label gives note number, voice and GM name: "42 Closed hat (Closed Hi-Hat)".
  - The view lists the 21 mapped notes, low to high. "Show all notes" reveals 0–127; unmapped rows read "No voice".
  - Notes draw as fixed-width markers at their start; fill opacity shows velocity. Length stays editable in the note inspector.
  - Activating a row label auditions its voice at velocity 100, through the engine and safety stage.
  - Rows 42, 44 and 46 share a choke-group indicator.
- **Prior art:** Ableton Drum Rack shows note names, numbers and GM drum names, with choke groups. Logic Pro Drum Machine Designer and FL Studio FPC name pads by kit piece. Bitwig Drum Machine offers choke targets per chain.
- **W-Rack application:** Piano roll on tracks whose instrument is the drum machine.
- **Accessibility:** Row headers carry the full label text; cells name their time position ("Bar 2, beat 3"). Space on a row header auditions; Enter on a cell toggles a note; Shift+Up/Down changes velocity by 8. Labels are text, not color.
- **Anti-patterns:** Pitch names on drum rows; auditions outside the safety stage.

## Instruments and effects

### `DEV-01` Linear chain with bypass
- **Problem:** Hidden order and unclear bypass produce unexpected sound.
- **Solution:** Devices run left to right: instrument, then effects, up to eight. Each header shows name, bypass, move left, move right, preset and remove. At eight, `Add effect` is disabled with "Chain full (8 of 8)".
- **Prior art:** Ableton Live's device view exposes each device as a group with keyboard navigation; Logic Pro lists inserts in order.
- **W-Rack application:** Track and master chains; the master ends with `SAFE-02`.
- **Accessibility:** Devices are `group`s named "Delay, 3 of 5"; move buttons are named "Move Delay left" (WCAG 2.5.7); bypass uses `aria-pressed` and shows "Bypassed".
- **Anti-patterns:** Drag-only reordering; bypass shown only by greying.

### `DEV-02` Knobs with units and reset
- **Problem:** Unfamiliar control shapes slow recognition; unitless values mislead.
- **Solution:**
  - Device parameters are rotary knobs in a grid, grouped in sections with a heading (Oscillator, Filter, Envelope, Tuning).
  - Each knob shows its caption above and its value with units below ("−6.0 dB", "1.2 kHz", "250 ms").
  - Vertical drag changes the value; Shift gives fine steps. Double-click or Delete resets to the default.
  - Clicking the value, or Enter on the knob, opens a text field that accepts a number with or without a unit ("2 kHz", "40 ms").
  - Enums are segmented buttons.
- **Prior art:** Knobs in Ableton Live's devices, Logic Pro's plug-in windows, FL Studio and Reason; DAWproject records parameter units.
- **W-Rack application:** Instrument panels, the sampler, the drum machine, effect devices and mixer pan.
- **Accessibility:** Each knob is a visually hidden native range input under the SVG arc, with the parameter's name and unit-bearing `aria-valuetext`; Arrow, Page Up/Down, Home/End and Delete keys. Enums are radio groups.
- **Anti-patterns:** Circular drag, which jumps when the pointer passes the centre; values visible only while dragging.

### `DEV-03` Sample editor with keyboard markers
- **Problem:** Drag-only waveform markers exclude keyboard and screen-reader users; imprecise loop points click.
- **Solution:**
  - The sampler device shows the source waveform with five markers: Start, Loop start, Loop end, End and the crossfade length.
  - Each marker is a slider. Keys: Left/Right ±1 ms; Shift+Left/Right ±1 frame; Page Up/Down ±100 ms; Home/End to the nearest constraint; `Z` snaps to the nearest zero crossing within 2048 frames.
  - A "Snap to zero crossings" toggle applies `Z` after every move.
  - Marker constraints from `a3-audio-implementation.md` (Sampler) hold during editing; a blocked move is announced.
  - Loop mode (Off, Forward, Ping-pong) and Trigger/Gate are radio groups. Root note is a spin button showing the note name.
  - Without a source, the waveform area shows "Audio not loaded: <source name>" with `Load sample…` and `Choose project source`.
  - Previews play through the engine and safety stage, and Panic stops them.
- **Prior art:** Ableton Simpler (loop fade, zero-crossing snap, one-shot trigger and gate); Logic Pro Quick Sampler (start, end, loop and crossfade markers; loop modes); WAI-ARIA slider pattern.
- **W-Rack application:** Sampler device panel.
- **Accessibility:** Sliders expose `aria-valuetext` such as "Loop start, 1.250 seconds, frame 60000"; a DOM table lists markers with numeric inputs in seconds; marker colors pair with text labels.
- **Anti-patterns:** Drag-only markers; previews through a separate audio element.

## Mixer

### `MIX-01` Channel strip and master defaults
- **Problem:** Hot defaults clip the master on first playback.
- **Solution:**
  - Vertical channel strips, top to bottom: pan knob ("C", "L20", "R20"), clip indicator, a vertical fader with a dB scale beside a vertical peak meter, the dB readout, M and S buttons, and the track name.
  - The master strip has the same layout, with limiter gain reduction in place of the clip indicator and no M or S.
  - Faders follow a square taper, so the range from +6 to −12 dB has most of the travel.
  - Tracks default to 0 dB; the master defaults to −12 dB; every pan defaults to centre. Double-click resets.
- **Prior art:** BandLab's master meter turns red on clipping; FL Studio's default template places a limiter on the master.
- **W-Rack application:** Mixer panel with the master strip separated at the right.
- **Accessibility:** The fader is a native range input with `aria-orientation="vertical"`: "Bass volume" with `aria-valuetext="−6.0 dB"`. The pan knob is "Bass pan" with "Left 20". M and S are named "Mute Bass" and "Solo Bass". The master strip has "Master volume" and "Master pan".
- **Anti-patterns:** A 0 dB master without a limiter; raw −1 to 1 pan values.

### `MIX-02` Peak meters with clip hold
- **Problem:** Momentary overs vanish unnoticed.
- **Solution:** Peak meters hold for 1.5 s. A "Clip" indicator latches above 0 dBFS until clicked or reset. The master shows limiter gain reduction ("Limiter −3.2 dB").
- **Prior art:** BandLab's red master meter; FL Studio's limiter display.
- **W-Rack application:** Mixer and master strip.
- **Accessibility:** Meters are hidden from the accessibility tree. Clip state is a button, "Clear clip indicator, Bass clipped", announced once per playback.
- **Anti-patterns:** Red-only indicators; meter values announced live.

## Export

### `EXP-01` Export dialog fields
- **Problem:** Option-heavy dialogs produce wrong ranges and cut-off tails.
- **Solution:** Range (whole project or loop range), format (WAV 16-bit with dither stated, 24-bit, 32-bit float), tail (0–10 s, default 2 s) and file name, with the computed length ("0:42 including tail"). No normalize option.
- **Prior art:** Ableton Live's export dialog offers render range, normalize, sample rate, bit depth and dither choices.
- **W-Rack application:** Editor menu, `Mod+Shift+E`.
- **Accessibility:** `fieldset`s with legends; `NEW-02` validation; a disabled Export button states why.
- **Anti-patterns:** A range that cuts at the last clip end; normalize on by default.

### `EXP-02` Progress and cancellation
- **Problem:** Unreported offline renders look frozen.
- **Solution:** A progress state with percentage, elapsed time and `Cancel`. Completion offers `Download` with the file size. Cancel discards the output.
- **Prior art:** Desktop DAWs show render progress with cancel.
- **W-Rack application:** Export dialog during the offline render.
- **Accessibility:** `role="progressbar"`; announcements at 25% steps; focus moves to `Download`.
- **Anti-patterns:** No cancel; automatic download.

## Safety and errors

### `SAFE-01` Volume notice before first sound
- **Problem:** First playback at an unknown device volume risks startle and hearing harm.
- **Solution:** Before the first sound-producing action (Play, note preview, preset audition, keyboard or MIDI note), the volume notice appears with the text, buttons and "Don't show this again on this device" checkbox defined in `assignment-3-scope.md`. `Continue` resumes the `AudioContext` and performs the action.
- **Prior art:** Browsers require a user gesture before Web Audio runs; Song Maker and BandLab start sound only from user actions.
- **W-Rack application:** Global dialog from the engine client. The session flag lives in memory; the dismissal lives in saved settings.
- **Accessibility:** `role="alertdialog"`; initial focus on `Continue`; Escape cancels.
- **Anti-patterns:** A notice on page load; a notice whose confirmation does not start audio.

### `SAFE-02` Fixed safety limiter last
- **Problem:** Synthesis, feedback and stacked gain produce overs.
- **Solution:** A limiter with a −1 dBFS ceiling ends the master chain. It shows gain reduction, cannot be removed, moved or bypassed, and does not count toward the eight-device limit. Every sound, including note previews, drum-row auditions, preset auditions and sample-editor previews, passes through it, and Panic stops every sound.
- **Prior art:** FL Studio's default template inserts a limiter on the master.
- **W-Rack application:** The master chain's last slot, "Safety limiter (always on)"; requirements in `audio-safety.md`.
- **Accessibility:** `group` named "Safety limiter, always on, gain reduction 0 dB".
- **Anti-patterns:** A removable default limiter; unlabeled processing.

### `SAFE-03` Plain-language errors, overload, panic
- **Problem:** Codec errors, dropouts and stuck notes surface as silent failures.
- **Solution:**
  - Import errors name the file, the cause and a fix.
  - The transport shows "Audio overloaded — reduce tracks or effects" until 5 s pass without dropouts.
  - `Panic` (button, and `Escape` outside text fields when no dialog is open) stops the transport, releases all notes and clears effect buffers.
- **Prior art:** Ableton Live shows per-track performance impact; Logic Pro shows a system overload alert; "all notes off" is a MIDI convention.
- **W-Rack application:** Import results, transport status area, Panic button.
- **Accessibility:** Errors use `role="alert"`; overload uses `role="status"` once per occurrence; Panic announces "All sound stopped".
- **Anti-patterns:** Stack traces; error codes without fixes; mouse-only panic.

## Accessibility

### `A11Y-01` Canvas mirrored by DOM grid
- **Problem:** Canvas timelines and piano rolls are invisible to screen readers.
- **Solution:** The timeline mirror is a `treegrid` (tracks with child clip rows; columns name, start, length, gain, state). The piano roll mirror is a `grid`. Each region has one Tab stop with a roving `tabindex`, and selection is shared with the canvas.
- **Prior art:** Ableton tests Live with VoiceOver, NVDA, Narrator and JAWS. OSARA makes REAPER's track and item model keyboard-navigable.
- **W-Rack application:** Timeline and piano roll.
- **Accessibility:** Names carry full context ("Vox 1, bar 5 to 9, gain −3 dB"); canvas focus follows mirror focus.
- **Anti-patterns:** An `aria-hidden` canvas without an alternative; a Tab stop per cell.

### `A11Y-02` Position and edit announcements
- **Problem:** Screen-reader users cannot perceive playhead moves or edit results.
- **Solution:** One polite live region announces locate and step moves ("Bar 5 beat 1"), edit results and transport start and stop. It is silent during playback and debounced to 300 ms. `/settings` provides "Announce position on play and stop" and "Announce position when moving the playhead", both on by default.
- **Prior art:** Logic Pro's accessibility settings for playhead announcements; OSARA's edit-cursor reports by measure, beat and grid.
- **W-Rack application:** Global live region and `/settings`.
- **Accessibility:** `assertive` only for errors and safety events.
- **Anti-patterns:** Announcing meter values or playhead ticks.

### `A11Y-03` Unique names, color-independent state
- **Problem:** Repeated labels are indistinguishable; color-coded state fails users with color-vision deficiency.
- **Solution:** Every control has a role and a name unique in its landmark ("Bypass Delay on Bass"). Mute, solo, bypass, loop, snap, clip and missing-audio states carry text or shape. Contrast is 4.5:1 for text and 3:1 for non-text elements.
- **Prior art:** Ableton Live's high-contrast themes.
- **W-Rack application:** All regions; rules in `assignment-3-scope.md` (Labeling).
- **Accessibility:** An automated test checks for duplicate names per landmark.
- **Anti-patterns:** Track color as the only identifier; unnamed icon buttons.

### `A11Y-04` Alternatives to dragging
- **Problem:** Drag-only operations fail WCAG 2.2 SC 2.5.7.
- **Solution:** Arrow moves, Alt+Arrow trims, numeric fade and gain fields, device move buttons and Alt+Up/Down for tracks. Targets are at least 24 × 24 CSS px (SC 2.5.8); focus is never hidden by sticky panels (SC 2.4.11).
- **Prior art:** Ableton Live's arrow-key clip moves; OSARA's move and trim actions.
- **W-Rack application:** Timeline, piano roll, chains, mixer.
- **Accessibility:** Each operation is tested without a pointer.
- **Anti-patterns:** Reorder handles without a keyboard path.

## Help

### `HELP-01` Icon controls, tooltips and help text
- **Problem:** Text labels on every button crowd the editor; dense controls lack explanation where they are used.
- **Solution:**
  - Controls with a recognisable icon are icon-only (Lucide icons): transport, timeline tools, device headers, piano-roll tools, preset and sampler actions, the mixer and secondary dialog actions.
  - Text stays where an icon would be ambiguous: dialog primary actions, Panic, empty-state calls to action and the home page.
  - Less frequent commands live in the File, Add and Edit menus.
  - One shared tooltip shows each icon control's name with its shortcut ("Play (Space)") after a short delay on hover or keyboard focus.
  - The Info strip shows a one-sentence description of the focused or hovered control.
- **Prior art:** Icon toolbars with tooltips in Logic Pro, Ableton Live and BandLab; Ableton Live's Info View.
- **W-Rack application:** All icon controls; the editor's Info strip.
- **Accessibility:**
  - Each icon control has an `aria-label`, with the names used before the icons ("Split at edit cursor", "Bypass Delay").
  - A shortcut is the control's description through `aria-describedby`; a control without one has no description, so the name is not read twice.
  - Tooltips are dismissible with Escape, hoverable and persistent (WCAG 1.4.13).
  - Targets are at least 24 × 24 px. Toggles expose `aria-pressed` and show a lit lamp on a filled cap, never colour alone.
- **Anti-patterns:** Hover-only tooltips; tooltips that repeat the label.

### `HELP-02` Command palette and shortcut overlay
- **Problem:** Shortcuts stay hidden; keyboard users need a path to every command.
- **Solution:** `Mod+K` opens a palette listing every command with its shortcut, fuzzy search, Enter to run and Escape to close; unavailable commands are disabled with a reason. `?` opens a grouped shortcut overlay.
- **Prior art:** REAPER's Actions list; OSARA's key map; Ableton Live's Navigate menu.
- **W-Rack application:** Global overlay.
- **Accessibility:** `combobox` with a `listbox`; result counts are announced; focus returns to the previous element on close.
- **Anti-patterns:** Shortcuts documented only outside the app.

## Visual hierarchy
The industrial design system draws attention by mechanical importance. Flair marks only the controls that act on sound in real time or keep it safe.

| Tier | Elements | Treatment |
|---|---|---|
| 1. Transport and safety | Play/Pause, Stop, Loop, Metronome, Position, master volume and meter, Panic | Indicator lamps on toggles, amber readout windows, emergency-stop Panic, signal orange on Play while it is the next step |
| 2. Working toggles | Mute, Solo, Snap, Bypass, step input, dock tabs | Ink-filled pressed state; tabs underline the open panel |
| 3. Everything else | Menus, selects, zoom, navigation, parameter values, cards | Quiet: regular sentence-case legends, plain value readouts, thin card borders |

- Bold is reserved for page, editor, dialog and panel titles (h1, h2), project names in lists and missing-audio warnings.
- Small regular capitals mark structure: group headings and legends inside a panel. Controls use sentence case.
- Signal orange marks the primary action and the selected velocity only; knob arcs and other values use ink.
- Hues are reserved: blue is focus, red is danger and Panic, orange is the primary action, amber is the transport lamps and readouts. Track and clip colours (teal, violet, olive, rose, copper, slate) use none of them, and piano-roll notes take their track's colour.
- Neutrals are a warm grey in three elevations: the ground, the bars (toolbars, track headers, dock bar) one step lighter, and the lanes and cards lightest.

## Conflicts and decisions
| Topic | Product behavior | W-Rack decision | Pattern |
|---|---|---|---|
| Audio on open | Browsers block audio before a gesture | Examples open stopped; no previews on Home | `HOME-03` |
| Account before use | BandLab and Soundtrap require one; Song Maker does not | No accounts | `HOME-02` |
| Naming at creation | Logic Pro uses `Untitled`; Studio One asks for a title | Prefilled name, editable later | `NEW-01`, `NEW-03` |
| Settings at creation | Studio One asks sample rate and bit depth; Logic Pro hides details | Name, tempo, time signature only | `NEW-01` |
| Autosave or explicit save | Logic Pro autosaves; Ableton Live saves on command | Autosave plus explicit `.wrack` file | `SAVE-01`, `SAVE-02` |
| Media references | Ableton Live references unless collected | Archives always include audio | `SAVE-02` |
| Master limiter | FL Studio inserts one by default | Fixed limiter plus −12 dB master | `SAFE-02`, `MIX-01` |
| Knobs or sliders | Knobs in Ableton Live, Logic Pro, FL Studio and Reason; sliders in Logic Pro's Controls view | Knobs for device parameters and pan; vertical faders in the mixer; each is a native range input for keyboards and assistive technology | `DEV-02`, `MIX-01` |
| Play key | Space in Live, Logic Pro, BandLab, Song Maker | Space toggles Play and Pause; Stop returns to the play start, then to bar 1 | `TRN-02` |
| Preset apply while browsing | REAPER applies on move; OSARA's dialog does not | Apply on Enter or click | `LIB-01` |
| Volume notice repetition | No DAW precedent | Once per session, with an opt-out per device | `SAFE-01` |

## Keyboard shortcuts
Single-letter keys act only outside text fields. No global single-letter shortcut uses a computer-keyboard note key (A W S E D F T G Y H U J K, Z, X), so the shortcuts keep working while Play with keyboard is on; M and S act only on a focused track row.

| Action | Key | Browser conflict | Handling |
|---|---|---|---|
| Play / pause | `Space` | Page scroll; activates focused buttons | Not captured in fields or on buttons |
| Locate to start / loop start | `Home` / `Shift+Home` | Caret movement in fields | Not captured in fields |
| Loop on/off | `L` | — | — |
| Metronome | `C` | — | — |
| Split | `Mod+E` | Chrome and Edge search shortcut | Captured in the editor; menu alternative |
| Duplicate | `Mod+D` | Bookmark | Captured in the editor |
| Join | `Mod+J` | Chrome downloads | Captured in the editor; menu alternative |
| Trim start / end | `Alt+Left/Right` / `Alt+Shift+Left/Right` | `Alt+Left` is Back on Windows | Only with a clip focused |
| Grid size | `+` / `-` | — | Unmodified keys |
| Snap | `N` | — | — |
| Zoom in / out / fit | `Alt+=` / `Alt+-` / `Alt+0` | `Mod+=`/`-`/`0` page zoom | Alt-modified |
| Mute / solo | `M` / `S` | — | Focused track |
| Paint mode / quantize | `B` / `Q` | — | Piano roll |
| Save / open `.wrack` | `Mod+S` / `Mod+O` | Save page / open file | Captured |
| Export WAV | `Mod+Shift+E` | — | — |
| Settings | `Mod+,` | — | Opens `/settings` |
| Command palette | `Mod+K` | Chrome search shortcut | Captured |
| Panic | `Escape` | — | Outside text fields, when no dialog or menu is open |

Never bound: `Mod+W`, `Mod+T`, `Mod+N`, `Mod+Shift+N`, `Mod+Shift+T`, `Mod+L`, `Mod+1`–`9`, `Ctrl+Tab`, `Mod+R`, `Mod+Shift+R`, `F5`, `F11`, `Mod+Q`, `Alt+F4`, `Mod+=`, `Mod+-`, `Mod+0`, `Tab`, `Shift+Tab`.

## Unconfirmed
- Whether browsers allow `preventDefault` on `Mod+E`, `Mod+D`, `Mod+J` and `Mod+K` in every engine.
- FL Studio's default master limiter (forum reports only).
- Default behaviors of Song Maker (third-party tutorials only).
- Behaviors of GarageBand, Audiotool, Amped Studio, Soundation and Reason; no sources in this library cover them.

## Sources
- Ableton, Live 12 Reference Manual: Accessibility and Keyboard Navigation, First Steps, Managing Files and Sets, Live Keyboard Shortcuts, Working with the Browser — https://www.ableton.com/en/live-manual/12/
- Ableton Help Center: Accessibility in Live Overview; Collect All and Save; finding missing media — https://help.ableton.com/
- Apple, Logic Pro User Guide: create projects, tempo, accessibility settings — https://support.apple.com/guide/logicpro/
- Bitwig Studio User Guide: The Dashboard — https://www.bitwig.com/userguide/latest/the_dashboard/
- DAWproject — https://github.com/bitwig/dawproject
- PreSonus Knowledge Base: Studio One Start Page — https://support.presonus.com/
- OSARA — https://osara.reaperaccessibility.com/
- The REAPER Blog: offline media — https://reaper.blog/2023/10/offline-media/
- Image-Line, FL Studio Online Manual — https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/
- BandLab Help Center: Getting Started with the BandLab Studio — https://help.bandlab.com/
- Soundtrap Support: Originals demo projects — https://support.soundtrap.com/
- Chrome Music Lab — https://musiclab.chromeexperiments.com/
- Chrome for Developers: Autoplay policy in Chrome — https://developer.chrome.com/blog/autoplay
- W3C, WCAG 2.2 — https://www.w3.org/TR/WCAG22/
