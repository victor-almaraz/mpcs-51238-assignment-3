# Accessibility

## Command system
- Every operation is a named command with an ID, label and optional key binding in one keymap.
- A command palette (`Ctrl+Shift+P`, `Cmd+Shift+P` on macOS) lists all commands with search.
- Keymaps are user-editable and exportable. No operation requires a pointer.

## Screen-reader model
A structured DOM parallel to each canvas exposes the same content. The canvas has `aria-hidden="true"`.

| View | Pattern |
|---|---|
| Arrangement | `treegrid`: tracks are rows; clips are items in time order; roving `tabindex` |
| Piano roll | `grid`: notes in time order; each note's name gives pitch name, position, length, velocity |
| Mixer | Labeled `slider`s (fader, pan, sends) and toggle buttons (mute, solo, arm) |
| Menus, dialogs | WAI-ARIA APG menu and dialog patterns |

## Edit cursor
- Moves by bar, beat, grid unit, note, clip edge, and project start or end.
- Each move announces `bar N beat N tick N`, then time as `m:ss.mmm`. An option announces only the components that changed.
- During playback, position announcements are off by default.
- The focused element's context menu opens with the `ContextMenu` key or `Shift+F10`.

## Piano roll keyboard entry
- Arrow keys move the cursor by grid step and by semitone. `Enter` inserts a note of grid length. In step-input mode, computer-keyboard notes insert at the cursor.
- Each insertion or deletion announces pitch and position.

## Announcements
- One polite live region, throttled to one announcement per 250 ms; the latest message wins (project limit).
- Safety events use an assertive live region.

## Requirements
| Criterion | Requirement |
|---|---|
| WCAG 1.4.3 Contrast (Minimum) | Text ≥ 4.5:1 (≥ 3:1 for large text) |
| WCAG 1.4.11 Non-text Contrast | Controls, clip borders and meter scales ≥ 3:1 |
| WCAG 2.1.1 Keyboard | Every function operable by keyboard |
| WCAG 2.2.2 Pause, Stop, Hide | Playhead auto-follow can be turned off |
| WCAG 2.3.1 Three Flashes or Below Threshold | No content flashes more than 3 times per second; clip and limit indicators hold instead of flashing |
| WCAG 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum) | Focus indicator always visible and not covered; ring ≥ 2 CSS px (project requirement) |
| WCAG 2.5.8 Target Size (Minimum) | Targets ≥ 24 × 24 CSS px or spaced per the criterion |
| Reduced motion | `prefers-reduced-motion` disables smooth scrolling and animated transitions |

## Sources
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/
- WAI-ARIA Authoring Practices Guide — https://www.w3.org/WAI/ARIA/apg/
- OSARA — https://github.com/jcsteh/osara
