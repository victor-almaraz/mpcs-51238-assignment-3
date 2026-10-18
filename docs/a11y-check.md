# Accessibility check

This checklist records how W-Rack is checked against WCAG 2.2 AA and the Labeling and Accessibility sections of `assignment-3-scope.md`. Automated checks run in Chromium, Firefox and WebKit with `pnpm test:e2e`.

## Automated checks
| Check | Where | Result |
|---|---|---|
| axe-core, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice` (includes color contrast and target size 2.5.8) | Every route (`/`, `/new`, `/projects`, `/settings`, unknown routes) and the editor on each dock tab (Editor with clip properties and the piano roll, Devices with the instrument, sampler and effect chains, Mixer) (`tests/e2e/a11y.spec.js`) | No violations |
| axe-core in dialog states | Volume notice, File menu, Export, Save preset with an error, Rename preset, Rename project, Clear all data, Delete project, Keyboard shortcuts, collapsed panels (`tests/e2e/a11y.spec.js`, `project-list.spec.js`, `workspace.spec.js`) | No violations |
| Unique role and name per landmark | Every route and the editor; radios are scoped to their group (`tests/e2e/a11y.spec.js`, `duplicateNames`) | No duplicates |
| Primary controls queryable by role and name | Home, transport, Panic, the File, Add and Edit menus and their items, clip commands, timeline treegrid, master volume, master effects (`tests/e2e/a11y.spec.js`) | All found |
| axe-core per route, panels and features | `routes.spec.js`, `home.spec.js`, `new-project.spec.js`, `persistence.spec.js`, `project-list.spec.js`, `audio.spec.js`, `audio-import.spec.js`, `editor-tools.spec.js`, `effects.spec.js`, `loop.spec.js`, `pianoroll.spec.js`, `velocity.spec.js`, `workspace.spec.js`, `smoke.spec.js` | No violations |

## Contrast
Values come from the industrial tokens (`src/design-systems/industrial/tokens.css`).

| Pair | Ratio | Requirement |
|---|---|---|
| Text on background, surface, active surface | 13.6:1, 16.5:1, 11.4:1 | 4.5:1 |
| Muted text on background, hover and active surfaces | 5.7:1, 5.4:1, 4.8:1 | 4.5:1 |
| Control boundaries (`border-strong`) on background, surface and hover surface | 3.6:1, 4.4:1, 3.5:1 | 3:1 |
| Focus ring on background and surface | 4.8:1, 5.9:1 | 3:1 |
| Primary button text (ink) on signal orange, on its hover colour | 5.6:1, 7.2:1 | 4.5:1 |
| Panic text on red | 5.8:1 | 4.5:1 |
| Panic boundary (1 px ink edge) on background | 12.4:1 | 3:1 |
| Danger, warning and success text on their backgrounds | 5.2:1, 5.3:1, 5.7:1 | 4.5:1 |
| Lit lamp on a pressed control, in a readout window | 9.7:1, 10.3:1 | 3:1 |
| Track colours (teal, violet, olive, rose, copper, slate, plum, steel, mustard, pine, taupe) on the lanes | 3.5:1 or more | 3:1 |

The `border` token (1.6:1) is a divider only and never a control boundary. The primary button is outlined in ink, since signal orange alone has low contrast on the background.

Status never depends on color alone: pressed toggles expose `aria-pressed` and a lamp, bypassed effects show "Bypassed", and clip storage states are words.

## Focus and targets
- Every focusable element shows a 2 px `outline-focus` ring on `:focus-visible`; no outline is removed.
- Dialogs use `<dialog>` named by their heading; focus moves inside on open and returns to the opening control on close.
- Focus stays on the moved effect after Move left or Move right and moves to the next effect after Remove.
- Timeline and piano-roll mirrors keep one roving `tabindex="0"` element and restore focus after edits.
- Icon-only controls (Lucide icons, hidden from assistive technology) carry an `aria-label` and a tooltip that repeats the name with its shortcut ("Loop (L)"). The tooltip shows on hover and on keyboard focus, and Escape, pointer exit or blur dismisses it.
- Controls are at least 24 × 24 CSS px (`min-h-6 min-w-6` for small controls, 24 px piano-roll cells); axe's target-size rule passes on every checked page.

## Keyboard
| Flow (`flows.md`) | Keyboard path | Test |
|---|---|---|
| First visit | Tab to an example, Enter; Space plays; the volume notice focuses Continue; Escape is Panic | `a11y.spec.js` (keyboard only) |
| Transport | Space plays and pauses; Play/Pause, Stop and Go to start buttons; Home and Shift+Home locate | `audio.spec.js` |
| Create project | Tab to New project, type the name, Enter submits; errors focus the first invalid field | `a11y.spec.js`, `new-project.spec.js` |
| Return visit | Continue on a recent project; working state restored | `persistence.spec.js` |
| Empty project | "No tracks" region with Add instrument track and Add audio file; Add instrument track opens a four-bar clip with focus on the first piano-roll cell | `workspace.spec.js` |
| Notes | Piano roll grid: arrows, Enter, Delete, Alt+arrows, Shift+arrows, Q | `pianoroll.spec.js` |
| Velocity | Velocity lane slider on the selected note: arrows, Page Up/Down, Home/End; Shift+Left/Right pick another note | `velocity.spec.js` |
| Loop range | "Loop start" and "Loop end" handles in the ruler: arrows (grid steps), Page Up/Down (bars), Home/End | `loop.spec.js` |
| Tracks | Track rows in the treegrid: M and S mute and solo; R arms an instrument track for live input; F2 renames the track; Delete deletes it, after a confirmation when it has clips | `workspace.spec.js`, `ux-fixes.spec.js` |
| Audio clips | Timeline treegrid: arrows, Shift+arrows, Space and Enter select, Enter on a selected clip opens its properties, Mod+A, Mod+E, Mod+J, Mod+D, Delete, Alt+arrows, comma and period (Shift for bars), F2 renames | `audio-import.spec.js`, `ux-fixes.spec.js` |
| Global shortcuts | L loop, C metronome, N snap, + and − grid, ?, Mod+E, Mod+J, Mod+D, Mod+S, Mod+O, Mod+Shift+E, Mod+, (design-patterns.md, Keyboard shortcuts); single-key shortcuts do not act in text fields, menus or lists, or while a dialog is open; no page-wide letter shortcut uses a note letter (A W S E D F T G Y H U J K, Z, X) | `workspace.spec.js` |
| Undo and redo | Mod+Z, Mod+Shift+Z or Mod+Y, and the Edit menu; edits within 600 ms form one step; a focused text field keeps its own undo | `ux-fixes.spec.js` |
| Zoom | Alt+= and Alt+− outside text fields; the Zoom in and Zoom out buttons | `editor-tools.spec.js` (palette) |
| Sampler | Marker sliders (1 ms, 1 frame, 100 ms, Home/End, Z), root-note spin button | `audio-import.spec.js` |
| Presets | Preset combobox: type to filter, Up/Down move without applying, Enter applies; Preview auditions the highlighted preset; Save preset dialog by keyboard; rename and delete in Settings | `a11y.spec.js`, `presets.spec.js` |
| Effects | Add, bypass, move and remove by icon buttons; knobs by arrows, Page Up/Down, Home/End and Delete | `effects.spec.js` |
| Device parameters | Knobs (visually hidden range inputs): arrows, Page Up/Down, Home/End, Delete resets, Enter opens the value field | `audio.spec.js`, `presets.spec.js` |
| Mixer | Vertical faders and pan knobs by arrows and Page Up/Down, Delete resets; M and S buttons named "Mute Bass" and "Solo Bass" | `audio.spec.js`, `workspace.spec.js` |
| Save and open `.wrack` | Buttons; the native file picker | `archive.spec.js` |
| Export | Export dialog fields and Export WAV; Cancel during the render; focus moves to Download when the file is ready | `export.spec.js` |
| Projects | Rename, Duplicate and Delete on `/projects`, each named with the project | `project-list.spec.js`, `persistence.spec.js` |
| Commands | Ctrl+K or Ctrl+Shift+P (Cmd on macOS), or the header's Commands button; type to filter, Up/Down, Enter | `editor-tools.spec.js` |
| Shortcut overlay | `?` or the header's Keyboard shortcuts button opens "Keyboard shortcuts"; Escape closes it and returns focus | `workspace.spec.js` |
| Menus | File, Add and Edit menu buttons (WAI-ARIA APG menu button): Enter, Space or Down opens on the first item, Up on the last; Up/Down and Home/End move; Escape or Tab closes and returns focus to the button | `a11y.spec.js`, `workspace.spec.js` |
| Panels | Editor, Devices and Mixer tabs: Left/Right and Home/End move between tabs and open them; the Panels button (`aria-expanded`) collapses the dock to its tabs and expands it; a click on the open tab collapses it, on another tab expands it; the "Resize the panels" separator takes Up/Down and Home/End; the tab and collapse state are saved with the working state | `workspace.spec.js` |
| Clip menu | ContextMenu key or Shift+F10 on a clip row; Up/Down, Enter, Escape returns focus to the row | `editor-tools.spec.js` |

Firefox reserves Ctrl+Shift+P for a private window; Ctrl+K and the Commands button open the palette there. WebKit on macOS moves Tab focus only between form controls unless Alt is held or "Press Tab to highlight each item" is on; the tests use Alt+Tab there.

## Not covered
- Keymaps are not editable or exportable (`accessibility.md`, Command system); the command palette and the shortcut overlay list each command's shortcut.
- The on-canvas fade, gain and envelope handles are pointer-only; the clip properties panel provides the same edits as labelled sliders.
- Painting several velocities in one drag is pointer-only; the velocity lane slider edits one note at a time from the keyboard.
- Edit-cursor announcements give bar and beat; they do not include `m:ss.mmm` time.
- Screen-reader output was not checked with VoiceOver, NVDA or JAWS; checks rely on the accessibility tree that Playwright and axe read.
