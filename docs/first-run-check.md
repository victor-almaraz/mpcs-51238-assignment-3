# First-run check

The first-run check (`a3-agent-plan.md`, Phase 15 task 2) runs the main flow in Chromium, Firefox and WebKit with empty profiles, then reviews the result as a brand-new user and as a returning user.

## Environment
- Target: the production build (`pnpm build`, static export in `out/`) served by `scripts/serve-out.mjs` with the `vercel.json` rewrites and headers. A deployment is checked with `BASE_URL=<url> pnpm test:e2e`.
- Browsers: Playwright Chromium, Firefox and WebKit, each in fresh contexts.
- Audio is verified through the engine's post-limiter level (`getMasterLevel()`), not by listening.

## Checklist
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

## Open items
- Recent and Projects have no sort or search.
- Track meters reach red while the master is at −12 dB; the master limiter, not the track meter, sets the output level.
- Narrow and mobile viewports are not checked.
