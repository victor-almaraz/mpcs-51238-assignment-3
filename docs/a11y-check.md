# Accessibility check

This checklist records how W-Rack is checked against WCAG 2.2 AA and the Labeling and Accessibility sections of `assignment-3-scope.md`. Automated checks run in Chromium, Firefox and WebKit with `pnpm test:e2e`.

## Automated checks
| Check | Where | Result |
|---|---|---|
| axe-core, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice` (includes color contrast and target size 2.5.8) | Every route (`/`, `/new`, `/projects`, `/settings`, unknown routes) and the editor with the timeline, clip properties, piano roll, instrument panel, sampler panel, effect chains and mixer open (`tests/e2e/a11y.spec.js`) | No violations |
| axe-core in dialog states | Volume notice, Export, Save preset with an error, Rename preset, Clear all data, Delete project (`tests/e2e/a11y.spec.js`) | No violations |
| Unique role and name per landmark | Every route and the editor; radios are scoped to their group (`tests/e2e/a11y.spec.js`, `duplicateNames`) | No duplicates |
| Primary controls queryable by role and name | Home, transport, Panic, project toolbar, clip commands, timeline treegrid, master volume, master effects (`tests/e2e/a11y.spec.js`) | All found |
| axe-core per route, panels and features | `routes.spec.js`, `audio.spec.js`, `pianoroll.spec.js`, `effects.spec.js`, `audio-import.spec.js`, `persistence.spec.js`, `new-project.spec.js`, `home.spec.js`, `smoke.spec.js` | No violations |

## Contrast
Values come from the industrial tokens (`src/design-systems/industrial/tokens.css`).

| Pair | Ratio | Requirement |
|---|---|---|
| Text on background | 12.4:1 | 4.5:1 |
| Muted text on background, hover and active surfaces | 5.6:1, 5.2:1, 4.6:1 | 4.5:1 |
| Control boundaries (`border-strong`) on background and surface | 3.7:1, 4.2:1 | 3:1 |
| Focus ring on background and surface | 5.1:1, 5.9:1 | 3:1 |
| Primary button text on signal orange | 5.0:1 | 4.5:1 |
| Panic text on red | 5.9:1 | 4.5:1 |
| Meter segments in the instrument window | 9.1:1, 9.7:1, 4.4:1 | 3:1 |

Status never depends on color alone: pressed toggles expose `aria-pressed` and a lamp, bypassed effects show "Bypassed", and clip storage states are words.

## Focus and targets
- Every focusable element shows a 2 px `outline-focus` ring on `:focus-visible`; no outline is removed.
- Dialogs use `<dialog>` named by their heading; focus moves inside on open and returns to the opening control on close.
- Focus stays on the moved effect after Move left or Move right and moves to the next effect after Remove.
- Timeline and piano-roll mirrors keep one roving `tabindex="0"` element and restore focus after edits.
- Controls are at least 24 × 24 CSS px (`min-h-6 min-w-6` for small controls, 24 px piano-roll cells); axe's target-size rule passes on every checked page.

## Keyboard
| Flow (`flows.md`) | Keyboard path | Test |
|---|---|---|
| First visit | Tab to an example, Enter; Space plays; the volume notice focuses Continue; Escape is Panic | `a11y.spec.js` (keyboard only) |
| Create project | Tab to New project, type the name, Enter submits; errors focus the first invalid field | `a11y.spec.js`, `new-project.spec.js` |
| Return visit | Continue on a recent project; working state restored | `persistence.spec.js` |
| Notes | Piano roll grid: arrows, Enter, Delete, Alt+arrows, Shift+arrows, Q | `pianoroll.spec.js` |
| Audio clips | Timeline treegrid: arrows, Shift+arrows, Mod+E, Mod+J, Mod+D, Delete, Alt+arrows, comma and period | `audio-import.spec.js` |
| Sampler | Marker sliders (1 ms, 1 frame, 100 ms, Home/End, Z), root-note spin button | `audio-import.spec.js` |
| Presets | Save preset dialog by keyboard; rename and delete in Settings | `a11y.spec.js`, `presets.spec.js` |
| Effects | Add, bypass, move and remove by buttons; sliders by arrows | `effects.spec.js` |
| Save and open `.wrack` | Buttons; the native file picker | `archive.spec.js` |
| Export | Export dialog fields and Export WAV | `export.spec.js` |

WebKit on macOS moves Tab focus only between form controls unless Alt is held or "Press Tab to highlight each item" is on; the tests use Alt+Tab there.

## Not covered
- The command palette and editable keymaps (`accessibility.md`, Command system) are not built.
- Timeline marquee selection, clip context menus and on-canvas fade and gain handles are not built; the clip properties panel provides numeric fade, gain and envelope controls.
- Edit-cursor announcements give bar and beat; they do not include `m:ss.mmm` time.
- Screen-reader output was not checked with VoiceOver, NVDA or JAWS; checks rely on the accessibility tree that Playwright and axe read.
