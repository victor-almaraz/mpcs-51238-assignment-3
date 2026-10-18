# UI: timeline and editors

## Editor layout
The editor (`/projects/[id]`, `src/components/studio/Studio.jsx`) fills one screen. Regions, top to bottom:

| Region | Contents |
|---|---|
| Site header | W-Rack wordmark, Home, Projects, New project and Settings links, `Commands` (`Mod+K`) and `Keyboard shortcuts` (`?`) buttons |
| Editor header | Project name as the page heading (text face, bold) with `Rename project`; tempo and time signature; save status ("Saved on this device", "Saving…", "Not saved — storage full", "Copy of example — saved on first edit"); `File` menu: Save .wrack file (`Mod+S`), Open .wrack file… (`Mod+O`), Export WAV… (`Mod+Shift+E`) |
| Transport | `design-patterns.md` `TRN-01` to `TRN-03` |
| Banners | Shown only when needed: read-only project, effects reset after non-finite output, save failures, and "Audio not loaded" with `Open .wrack file to restore audio` |
| Clip toolbar | `Add` menu, `Edit` menu, Snap toggle (`N`) and Grid select, Zoom out, zoom readout, Zoom in, Split, Join, Duplicate, Delete, the edit cursor readout ("Edit cursor: bar 5 beat 2") and, with a selection, the join status |
| Arrangement | Track headers at the left, the ruler at the top and the timeline canvas |
| Dock | `Editor`, `Devices` and `Mixer` tabs over the active panel |
| Info strip | Help text of the hovered or focused control; live-input controls (`midi.md`) |

### Menus
Menus follow the WAI-ARIA APG menu button pattern (`src/components/ui/MenuButton.jsx`, `Menu.jsx`): Enter, Space or Down opens on the first item, Up on the last; Up, Down, Home and End move; Enter or Space runs an item; Escape or Tab closes and returns focus to the button. An item that will not work states why in a note.

| Menu | Items |
|---|---|
| `File` | Save .wrack file, Open .wrack file…, Export WAV… |
| `Add` | One instrument track per instrument type, Audio track, Audio file… |
| `Edit` | Undo, Redo, Select all clips, Mute or Unmute clip, Rename clip… (`F2`), Rename track…, Delete track |

### Dock
- The dock is an APG tablist with automatic activation; Left, Right, Home and End move between tabs. Only the active panel is mounted.
- The `Panels` button (`aria-expanded`) collapses the dock to its tab strip, giving the arrangement the space. A click on the open tab also collapses it; a click on any tab while collapsed expands it.
- A separator above the tab strip resizes the dock by pointer drag, or by Up and Down in 40 px steps, with Home and End to the limits. The dock is at least 200 px tall, leaves the workspace at least 340 px, and opens at 42 % of the workspace height.
- The active tab and the collapsed state are part of the working state (`dock`, `dockCollapsed`).

| Tab | Panel |
|---|---|
| Editor | The selected audio clip's properties; otherwise the piano roll of the selected instrument track, or of the first instrument track when no track is selected |
| Devices | A `Chain` choice between the selected track and `Master`. The track chain shows the instrument, then its effects, left to right; the master chain ends with the safety limiter. Each device card is as wide as its controls, and the panel scrolls sideways. |
| Mixer | Vertical track strips with the master strip at the right (`mixer-and-routing.md`) |

### Info strip
The info strip shows the `data-help` text of the control under the pointer, else of the focused control, else "Space plays and pauses · Escape stops all sound · Ctrl/Cmd+K lists every command · ? shows shortcuts". It is not a live region. Its right side holds `Play with keyboard`, the live-input target ("Input: Bass (selected)", "Input: Bass, Lead"), the keyboard octave, `Connect MIDI device` and the MIDI status.

### Icon controls and tooltips
Icon controls use vendored Lucide icons (`src/components/ui/icons/`). Each has an `aria-label`; its shortcut is its description ("Shortcut: L"). One shared tooltip layer (`TooltipLayer.jsx`) shows the name and shortcut ("Loop (L)") 400 ms after hover or keyboard focus; it stays while the pointer is over the control or the tooltip, and Escape, pointer exit, blur and scrolling dismiss it.

## Rendering
| Surface | Technology |
|---|---|
| Timeline lanes, ruler, clips, waveforms; piano-roll grid and notes | Canvas 2D on the main thread, covering the visible area only |
| Playheads | One DOM element per canvas view, moved by a CSS transform each animation frame while playing |
| Meters | DOM bars moved by `scaleY` and `translateY` transforms in an animation-frame loop |
| Accessible mirrors, menus, dialogs, device panels, mixer controls | React DOM |

- A canvas redraws when its inputs change (document, selection, drag preview, scroll, size, playing state), and otherwise at most every 250 ms, so peaks that arrive later from the peaks worker appear. Playback does not repaint the canvas.
- Meters write a transform only when its rounded value changes, so a steady or silent meter writes nothing.
- Waveforms come from the peaks worker (`src/workers/peaks.js`): min/max levels from 256 frames per bucket, each level 4× coarser, up to 65 536 frames.
- WebGL, WebGPU and `OffscreenCanvas` are not used.

## Budgets
| Budget | Value (project limits) |
|---|---|
| Frame | ≤ 16.7 ms at 60 Hz; canvas drawing ≤ 8 ms |
| Main-thread long tasks during playback | None over 50 ms |
| Drawn clips | Clips that meet the visible area |
| Waveform level | Coarsest level with ≥ 1 peak pair per pixel |
| Meter refresh | Every animation frame, from the latest engine report |

## React boundaries
- Canvas views are components mounted once that draw in their own animation-frame loop from a ref holding the latest props.
- Playheads, the transport position, meters and the limiter readout are written through refs and never pass through React state.
- The working state (`src/lib/project/view-state.js`) holds view data per project: playhead, loop range and state, zoom, scroll, selection, open panel, dock tab and collapse, snap grid and toggle, and armed tracks. It saves to `w-rack:v1:view:<id>` 500 ms after a change. The document is separate and saves through `src/lib/project/store.js`.
- Drags show a provisional result and commit one edit on release.
- Undo and Redo (`Mod+Z`; `Mod+Shift+Z` or `Mod+Y`; the `Edit` menu) keep up to 200 whole documents. Edits within 600 ms of the previous one join its step, so a knob or fader drag undoes as one. Text fields keep their own undo.

## Timeline
The timeline is `src/components/timeline/Timeline.jsx`: a canvas picture (`TimelineCanvas.jsx`) with pointer editing, and the "Tracks and clips" treegrid mirror (`TimelineTree.jsx`) for the keyboard and assistive technology. Pointer input and keys call the same commands (`useTimelineCommands.js`).

### Geometry
| Item | Value |
|---|---|
| Track header width | 224 px |
| Track row height | 56 px |
| Ruler height | 24 px |
| Quarter note at 100 % zoom | 32 px |
| Zoom | 25 % to 800 %, in steps of 2× |
| Content length | The last clip end or the edit cursor, plus 8 bars |

### Scrolling and zoom
- The arrangement scrolls in both directions. The ruler, the "Tracks" corner and the track headers stay in place; the canvas is held in view by the scroll offsets and redraws for the visible area.
- `Alt+=` and `Alt+-`, and the zoom buttons, change the zoom. The zoom keeps its anchor in place: the edit cursor when it is in view, else the centre of the view. `Mod+=`, `Mod+-` and `Mod+0` stay with the browser.
- While playing, the view follows the playhead: when the playhead leaves the visible lanes, or wraps back before them, the view scrolls so that it sits 48 px from the left edge.
- Moving a loop edge by keyboard scrolls it into view.

### Ruler and loop range
- The ruler shows bar numbers and the loop range as a band: lit amber while the loop is on, grey while it is off. While on, the band's edges continue down the lanes over a light wash.
- Dragging empty ruler space draws a loop and turns the loop on. Dragging the band's edges resizes it; dragging its body moves it while the loop is on. Edges snap to the grid while snap is on; Alt bypasses snap. A click without a drag moves the edit cursor.
- The loop is at least one grid step long.
- The keyboard handles "Loop start" and "Loop end" are `slider`s on the band's edges, valued in bars ("bar 3 beat 2"): arrows move by the grid step, Page Up and Page Down by a bar, Home and End to the limits. Changes are announced ("Loop bar 3 to bar 5, on").

### Track headers
Each header shows the track colour, position and name, the kind ("Subtractive synth", "Audio") with "· Muted" or "· Solo", and the `M` and `S` buttons. Instrument tracks add the arm button (circle-dot icon, "Arm Bass for live input"). Clicking a header selects the track; double-clicking it renames the track. Muted tracks dim.

### Clip editing by pointer
- Click selects a clip; Shift+click selects the range from the first selected clip on the same track; Ctrl or Cmd+click toggles a clip. Dragging empty space draws a marquee; a click there clears the selection and moves the edit cursor.
- Dragging a clip moves the selection, across tracks of the same kind; dragging within 6 px of an edge trims it. Moves and trims snap while snap is on; Alt bypasses snap.
- The top half of a MIDI clip's right edge is its loop handle (the repeat cursor): dragging it turns looping on at the clip's current length and lengthens the clip with repeats. The lower half lengthens it with empty time. Each repeat after the first starts at a notch in the clip's top band, and the clip row's name adds "loops every 4 bars". `Loop clip` and `Stop looping clip` in the clip menu, the `Edit` menu and the command palette do the same for the keyboard; with looping on, the end trim keys lengthen the loop.
- Stop looping, Split, a start trim and Join write a loop's repeats out as notes first, so the clip sounds the same. The piano roll's Clip loop Off does the same.
- Double-clicking empty lane space adds a clip at the snapped tick: on an instrument track, an empty MIDI clip one bar long (or up to the next clip), selected and open in the piano roll; on an audio track, the file picker, whose files import there. Audio files dropped on the lanes import at the drop point, on that audio track or a new one.
- A selected audio clip at least 72 px wide shows fade-in, fade-out and gain handles, each with a 24 px hit target; the gain drag shows its dB value. Double-click on a selected audio clip adds an envelope point; double-click on a point removes it; points drag.
- The clip menu opens by right-click on a clip, or Shift+F10 or the ContextMenu key on a focused clip row. A clip outside the selection becomes the selection first. Items act on the selection and count it: "Split 3 clips at edit cursor", "Join clips", "Duplicate 3 clips", "Mute 3 clips", "Loop clip" (MIDI), "Rename clip…", "Delete 3 clips". Split and Join state why they will not work.
- Selecting a MIDI clip opens it in the piano roll, which names the clip it edits ("Track 1, bar 5 to bar 9"). A duplicate is a separate clip: the copy is selected after Duplicate, and edits to it leave the original as it was.

### Tracks
- `Add` offers `MIDI clip on <track> at edit cursor` (the selected instrument track, else the first; also "Add MIDI clip at edit cursor" in the command palette), then creates an instrument track of the chosen type with a four-bar MIDI clip, opens it in the piano roll and focuses its first cell; or an audio track; or imports audio files at the edit cursor onto the selected audio track or a new one.
- Rename: the `Rename` dialog (track or clip name, validated with the error under the field) opens from F2 on a focused row, a double-click on a track header, or the `Edit` menu.
- Delete track: Delete on a focused track row, the `Edit` menu or the command palette. A track with clips asks first ("Delete Bass?", initial focus on `Cancel`). Undo restores the track, its clips and its devices. Focus moves to the next track, or to the empty timeline's `Add instrument track`.
- Arm for live input: the arm button or R on a focused instrument track row (`midi.md`, Live input routing).

### Keyboard
The treegrid has one Tab stop with a roving `tabindex`. Its keys are listed in the shortcut overlay and in `accessibility.md`.

## Piano roll
The piano roll (`src/components/pianoroll/PianoRollGrid.jsx`) is a canvas (`PianoRollCanvas.jsx`) under a `grid` mirror named "Notes" that receives all input. Only visible rows and columns, plus the cursor cell, are in the DOM.

| Item | Behaviour |
|---|---|
| Rows | Pitches 127 to 0, top to bottom; on drum machine tracks the 21 mapped General MIDI notes, low to high, or 0–127 with `Show all notes` |
| Cells | One grid step wide and 24 px tall. The time scale is fixed: a 1/16 step is 24 px at zoom 1×, so a grid change never resizes notes |
| Toolbar | Grid (1/4, 1/8, 1/16, 1/32 and the triplets 1/4T, 1/8T, 1/16T, 1/32T; default 1/16), Piano roll zoom out and zoom in (0.5×, 1×, 2×, 4×; a grid whose cells would be narrower than 24 px is disabled until a zoom in), Clip loop (Off, 1, 2 or 4 bars), Step input, Preview notes, Quantize (`Q`), and `Show all notes` on drum tracks |
| Notes | Drawn in the track colour; drum notes draw as fixed-width markers whose opacity follows velocity |
| Empty clip | "Press a key or click the grid to add a note. Drag to draw a longer one." with the keyboard map; step input starts on |

### Pointer
- A click on an empty cell adds a note one grid step long; a drag from an empty cell draws a note as long as the drag.
- A drag from a note's body moves it in time and pitch. A drag from either end (the last 6 px, or a third of a short note, with the resize cursor) stretches it from that end; the other end stays. Stretches snap to the grid; with Alt they snap to 1/64. The selected note shows grips at both ends. The edit commits on release.
- A click on a note selects and previews it; a double-click removes it.
- Drum notes keep their length under the pointer.
- A row header previews its pitch, or auditions its drum voice.
- A note dragged in pitch plays each new pitch with Preview notes on. Near or past an edge of the view (8 px), the grid scrolls with the drag, faster the further out the pointer is, and the note stays on the edge row or column, in view.
- Positions off the beat read as the grid step ("bar 1 beat 1 step 2") when the grid divides the beat, else as the fraction of the beat ("bar 1 beat 2 and 1/3" on 1/4T); triplet lengths read as fractions ("length 1/3 beat").

### Keyboard
Arrows move the cursor; Left from the first column reaches the row header. Enter adds or removes a note; Delete removes it; Alt+arrows move it; Shift+Left and Shift+Right change its length; Shift+Up and Shift+Down change its velocity by 8; `Q` quantizes the clip. With step input on, each computer-keyboard or MIDI note is added at the cursor, which advances one grid step.

### Velocity lane
The lane under the grid shows a stem per note (1–127), the selected one in signal orange. A drag paints velocities across the stems it passes: each stem takes the height the pointer crossed it at, so a rising stroke paints a ramp, and release commits the stroke as one edit. The value under the pointer or in focus shows beside the lane. For the keyboard the lane is one `slider` on the selected note ("Velocity C4 bar 1.1"): arrows step by 1, Page Up and Page Down by 10, Home and End go to 1 and 127, and Shift+Left and Shift+Right move to the previous or next note.

## Devices
- The instrument panel (`InstrumentPanel.jsx`) is generated from the instrument's parameter definitions: sections with a heading (Oscillator, Filter, Envelope, Tuning and others), a segmented radio group per enum and a knob per number. Its `Instrument` select changes the track's instrument type in place: clips, effects, mixer settings, name and colour stay, the instrument starts at its defaults, and Undo restores the previous one.
- Effect devices (`EffectChain.jsx`) are groups named "Delay, 3 of 5" with Bypass, the name, "Bypassed" while bypassed, Move left, Move right, Remove, a preset picker and the parameters. A chain holds up to eight effects; at eight, `Add effect` is disabled with "Chain full (8 of 8)".

### Knobs
A knob (`src/components/ui/Knob.jsx`) shows its caption above, an SVG arc, and its value with units below. A visually hidden native range input carries the role, name, value text and keys.

| Input | Action |
|---|---|
| Vertical drag | Changes the value over 160 px for the full range; Shift divides the speed by 10 |
| Double-click, Delete | Resets to the default |
| Click on the value, Enter | Opens a text field that accepts a number with or without a unit ("2 kHz", "40 ms"); Enter or leaving the field commits, Escape cancels |
| Arrows | Step |
| Page Up, Page Down | 10 % of the range |
| Home, End | The ends of the range |

Bipolar ranges fill from the centre.

## Audio clip properties
The Editor tab for a selected audio clip (`ClipProperties.jsx`) has the clip name, colour, Mute clip, clip gain, fade-in and fade-out length and curve, and the envelope points as time and gain fields with `Remove point N` and `Add point at edit cursor`.

## Not implemented
Automation lanes, buses and sends are outside this build (`assignment-3-scope.md`, Out of scope).

## Sources
- MDN, Canvas API — https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
- WAI-ARIA Authoring Practices Guide: Menu Button, Tabs, Treegrid, Grid — https://www.w3.org/WAI/ARIA/apg/
