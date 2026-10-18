# Accessibility

## Command system
- Operations are named commands (`src/lib/commands/registry.js`) with an ID, group, label and optional shortcut. Components register the commands they own while mounted.
- A global command's shortcut works anywhere on the page, except for unmodified keys typed into a field, menu or list, keys claimed by computer-keyboard notes (`midi.md`), held repeats, and while a dialog is open. Other keys belong to the focused editor, which handles them itself.
- The command palette (`Mod+K` or `Mod+Shift+P`; the `Commands` button in the site header) lists every registered command with its shortcut. Typed words filter the list by label and group; Up, Down, Home and End move; Enter runs a command; Escape closes. Unavailable commands are listed as disabled. The match count is announced.
- `?` (or the `Keyboard shortcuts` button) opens the shortcut overlay: every registered shortcut by group and, in the editor, the keys of the focused editors.
- Shortcuts are fixed (`design-patterns.md`, Keyboard shortcuts). No operation requires a pointer.

## Screen-reader model
A structured DOM parallel to each canvas exposes the same content. The canvas has `aria-hidden="true"`.

| View | Pattern |
|---|---|
| Arrangement | `treegrid` "Tracks and clips": track rows hold their clips as child rows in time order; one Tab stop with a roving `tabindex`; clip rows lie over their clips, so focus shows on the clip |
| Piano roll | `grid` "Notes": rows are pitches (or drum rows), columns grid steps; an empty cell is named by pitch and position ("C4, bar 2 beat 1"), a cell where a note starts by pitch, position, length and velocity |
| Velocity lane | One `slider` on the selected note ("Velocity C4 bar 1.1") |
| Mixer | Labeled range inputs (faders, pan knobs) and toggle buttons (mute, solo); arm toggles are on the track headers |
| Menus, dialogs, dock tabs | WAI-ARIA APG menu button, dialog and tabs patterns |

Track rows are named "Track 2: Bass, FM synth, 3 clips"; clip rows "Clip: Vox 1, bar 5 to bar 9", with "muted" and, for audio clips, the audio status ("Saved on this device", "Session only", "Audio not loaded").

## Keyboard in the arrangement
| Keys | Action |
|---|---|
| Up, Down, Home, End | Move between rows; arriving on a clip selects it (Shift extends the range on one track; Ctrl or Cmd moves without selecting) |
| Right, Left on a track | Expand and enter the first clip; collapse |
| Space, Enter on a clip | Select it (Ctrl or Cmd toggles it); Enter on a selected clip opens its properties |
| Enter on a track | Select the clips under the edit cursor |
| Left, Right on a clip | Move by the grid step |
| Alt+Left, Alt+Right; Alt+Shift+Left, Alt+Shift+Right | Trim the start; trim the end |
| Alt+Up, Alt+Down | Move a clip to the adjacent track of the same kind; reorder a track |
| M, S, R on a track | Mute, solo, arm (instrument tracks) |
| F2 | Rename the focused track or clip |
| Delete, Backspace | Delete the focused or selected clips; on a track, delete the track |
| Comma, Period | Move the edit cursor by the grid step; with Shift, by a bar |
| Shift+F10, ContextMenu | Open the clip menu |
| `Mod+A`, `Mod+E`, `Mod+J`, `Mod+D` | Select all, split, join, duplicate |

## Edit cursor
- The edit cursor is the playhead while stopped. Comma and Period move it by the grid step, with Shift by a bar; `Home` moves it to bar 1 and `Shift+Home` to the loop start; a click in empty lane or ruler space places it.
- Moves from the timeline announce the position: "Edit cursor bar 5 beat 2", or "Edit cursor bar 5" on a bar line.
- The transport position is text, read on demand; it is not announced during playback.
- The focused clip's menu opens with the `ContextMenu` key or `Shift+F10`.

## Piano roll keyboard entry
- Arrow keys move the cursor by grid step and by semitone; Left from the first column reaches the row header, where Space or Enter previews the row. `Enter` adds a note of grid length, or removes the note there.
- With step input on, computer-keyboard and MIDI notes are added at the cursor, which advances one grid step.
- Each insertion or deletion announces "Added" or "Removed" with the note's pitch, position, length and velocity.

## Announcements
- Edit results go to polite status regions (`role="status"`). Each editor throttles its announcements to one per 250 ms; the latest message wins (project limit).
- Errors and safety events (the loudness duck, effect resets, save failures) use `role="alert"`, which is assertive. The volume notice is an `alertdialog`.

## Requirements
| Criterion | Requirement |
|---|---|
| WCAG 1.4.3 Contrast (Minimum) | Text ≥ 4.5:1 (≥ 3:1 for large text) |
| WCAG 1.4.11 Non-text Contrast | Controls, clip borders and meter scales ≥ 3:1 |
| WCAG 2.1.1 Keyboard | Every function operable by keyboard |
| WCAG 2.2.2 Pause, Stop, Hide | Playhead follow runs only during playback, which Space, Pause and Stop end |
| WCAG 2.3.1 Three Flashes or Below Threshold | No content flashes more than 3 times per second; the clip indicator latches and the limiter readout holds instead of flashing |
| WCAG 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum) | Focus indicator always visible and not covered; ring ≥ 2 CSS px (project requirement) |
| WCAG 2.5.8 Target Size (Minimum) | Targets ≥ 24 × 24 CSS px or spaced per the criterion |
| Reduced motion | `prefers-reduced-motion` disables smooth scrolling and animated transitions |

Contrast values for the design tokens are in `src/design-systems/industrial/tokens.css` and `a11y-check.md`.

## Sources
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/
- WAI-ARIA Authoring Practices Guide — https://www.w3.org/WAI/ARIA/apg/
- OSARA — https://github.com/jcsteh/osara
