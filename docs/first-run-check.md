# First-run check

The first-run check (`a3-agent-plan.md`, Phase 15 task 2) has two parts: an agent tries the deployed site as a brand-new user and then as a returning user, and the main flow runs as a scripted checklist in Chromium, Firefox and WebKit with empty profiles.

## Deployed site, as a new user
- Target: <https://mpcs-51238-assignment-3.vercel.app/>, checked on 19 October 2026.
- Method: an agent drove headless Chromium (1440 × 900) through a persistent, initially empty profile, read the screen from screenshots and the accessibility tree, and closed and reopened the browser with the same profile to come back.
- Goal given to the agent: "Make a short 2-bar beat or melody you'd want to come back to, then come back later and keep working on it."

| Step | Result |
|---|---|
| First visit with nothing saved: Home shows the description, Create, Load and three examples; Projects shows "No saved projects on this device" with "Create a project" | Pass |
| New project form: an empty name and tempo 999 show "Enter a project name." and the tempo error under their fields; the fields are marked invalid and linked to the messages, focus moves to the first invalid field, and the typed values stay; fixing a field clears only its error | Pass |
| Main task: a click on the empty grid adds a note in a new clip; a melody, a drum-machine track with kick, snare and hats, a 2-bar loop and Play, with the status "Playing", moving meters and a looping playhead | Pass |
| Saving: "Saving…" then "Saved on this device"; an edit followed at once by closing the tab is kept | Pass |
| Return visit: Home shows Recent with "Continue My first beat"; the tracks, notes, loop, selected track and the volume-notice choice are restored | Pass |
| Keyboard only: the skip link, the header, the shortcut overlay (`?`) and the command palette (Mod+K) work and return focus; the piano roll adds, moves and lengthens notes from the keyboard; Space plays and pauses; the Add and File menus open with Enter and move with the arrow keys | Pass |
| Deployment: every route returns 200, `/projects/<id>` is rewritten to the editor, `/worklets/` is served with `Cache-Control: no-cache`, and an unknown path returns 404 | Pass |

## Browser checklist
- Target: the production build (`pnpm build`, static export in `out/`) served by `scripts/serve-out.mjs` with the `vercel.json` rewrites and headers. A deployment is checked with `BASE_URL=<url> pnpm test:e2e`.
- Browsers: Playwright Chromium, Firefox and WebKit, each in fresh contexts.
- Audio is verified through the engine's post-limiter level (`getMasterLevel()`), not by listening.

| Step | Chromium | Firefox | WebKit |
|---|---|---|---|
| No `AudioContext` before a sound-producing action (`/`, `/new`, `/projects`, `/settings`, an opened example, the Recent Home) | Pass | Pass | Pass |
| Home on a first visit: description, Create, Load, Examples | Pass | Pass | Pass |
| An example plays after the volume notice (master peak 0.13, below the 0.891 ceiling) and stops to silence | Pass | Pass | Pass |
| A new project from `/new` opens the editor with one empty instrument track, the piano-roll hint and Add › "Audio file…" | Pass | Pass | Pass |
| A saved preset appears under "My presets" | Pass | Pass | Pass |
| A return visit: Home shows Recent first; Continue restores zoom and the selected track with the transport stopped | Pass | Pass | Pass |
| WAV export downloads a RIFF/WAVE file | Pass | Pass | Pass |
| A `.wrack` file saved with imported audio opens in a fresh profile with the clip restored | Pass | Pass | Pass |
| Third-party requests (1468 requests recorded) | 0 | 0 | 0 |
| `/worklets/worklet/main.js`: 200 with `Cache-Control: no-cache` | Pass | Pass | Pass |

## Feedback and resolution
| Feedback (new user unless noted) | Resolution |
|---|---|
| "Press a key or click the grid to add a note" was false for key presses: a key only played the note unless Step input was on | An empty clip opens with Step input on, so a key press adds a note at the cursor and plays it |
| The music was below the fold, under the live input and view settings | The editor fits one screen without page scrolling: header, transport, clip toolbar and arrangement, then a dock with Editor (piano roll or clip properties), Devices and Mixer tabs; live input sits in the info strip at the bottom |
| The timeline had no bar numbers or track names | The timeline canvas draws a bar-number ruler and each lane's track name |
| The working-state readouts ("Open panel", "Playhead") did not match the screen or playback | The editor shows no working-state readouts; the open dock tab, the Position readout and the edit cursor show the state, and the working state returns when the project opens again |
| No Stop button; the play hint appearing and disappearing moved the page | Stop follows Play/Pause in the transport; the hint shares the status line ("Stopped") and Play stays highlighted and described by it |
| Two save states ("Saved on this device", "Not saved to file") and the term ".wrack" were unexplained | The `.wrack` controls and the "Not saved to file" indicator carry a sentence in their help text and description: edits save in the browser automatically; a `.wrack` file is a copy of the project and its audio for backups and other devices |
| Compressor value readouts overflowed their card; toggle lamps overlapped capital letters | Each device card is as wide as its controls; lamps sit only on the transport toggles (Loop, Metronome) |
| Split and Join were enabled with no clips; the Join help line was always visible | Both are disabled without clips; the Join reason shows in the clip toolbar once a clip is selected |
| Returning user: the instrument showed "Choose a preset…" after a preset was applied | Each picker shows "Preset: <name>", "<name> (edited)" after changes, or "none" |
| Returning user, deployed site: after pausing past the loop end and reopening, the first Play started there and played empty bars, outside the loop | With the loop on, a project whose saved position is at or past the loop end opens at the loop start |
| Deployed site: the editor marked no header link, so the way back to the project list was not apparent | In the editor, the header marks Projects as the current section (`aria-current="true"`, underlined) |
| Deployed site: a decimal tempo (120.5) got "Enter a tempo between 40 and 240.", and the range showed only after an error | The tempo field describes its range ("A whole number from 40 to 240.") and the error reads "Enter a whole-number tempo from 40 to 240." |
| Deployed site: the clip toolbar's Join line, "No clip touches this clip.", read as an error | The line gives the next step: "Join: Move a clip against this one to join them." |

## Open items
- Recent and Projects have no sort or search.
- Track meters reach red while the master is at −12 dB; the master limiter, not the track meter, sets the output level.
- Narrow and mobile viewports are not checked.
- The first note of a new project creates a 4-bar clip under a 4-bar loop, while the examples use 2-bar clips; a shorter sketch needs the clip and loop ends dragged.
- The Devices panel scrolls sideways at 1440 px with an instrument and its effects, so the effects card can start out of view.
- About 34 Tab stops precede the piano roll; the command palette's "Go to: Piano roll" reaches it directly.
- The piano roll shows 8 pitches at the default dock height.
- The volume notice opens on the first sound of each browser session until "Don't show again" is checked (`SAFE-01`).
