# First-run check

The first-run check (`a3-agent-plan.md`, Phase 15 task 2) runs the main flow in Chromium, Firefox and WebKit with empty profiles, then reviews the result as a brand-new user and as a returning user.

## Environment
- Target: the production build (`pnpm build`, static export in `out/`) served by `scripts/serve-out.mjs` with the `vercel.json` rewrites and headers. The deployed URL is checked with `BASE_URL=<url> pnpm test:e2e` once the site is deployed.
- Browsers: Playwright Chromium, Firefox and WebKit, each in fresh contexts.
- Audio was verified through the engine's post-limiter level (`getMasterLevel()`), not by listening.

## Checklist
| Step | Chromium | Firefox | WebKit |
|---|---|---|---|
| No `AudioContext` before a sound-producing action (`/`, `/new`, `/projects`, `/settings`, an opened example, the Recent Home) | Pass | Pass | Pass |
| Home on a first visit: description, Create, Load, Examples | Pass | Pass | Pass |
| An example plays after the volume notice (master peak 0.13, below the 0.891 ceiling) and stops to silence | Pass | Pass | Pass |
| A new project from `/new` opens the empty editor with its hint and "Add audio file" | Pass | Pass | Pass |
| A saved preset appears under "My presets" | Pass | Pass | Pass |
| A return visit: Home shows Recent first; Continue restores zoom and the selected track with the transport stopped | Pass | Pass | Pass |
| WAV export downloads a RIFF/WAVE file | Pass | Pass | Pass |
| A `.wrack` file saved with imported audio opens in a fresh profile with the clip restored | Pass | Pass | Pass |
| Third-party requests (1468 requests recorded) | 0 | 0 | 0 |
| `/worklets/worklet/main.js`: 200 with `Cache-Control: no-cache` | Pass | Pass | Pass |

## Feedback and changes
| Feedback (new user unless noted) | Change |
|---|---|
| "Press a key or click the grid to add a note" was false for key presses: a key only played the note unless Step input was on | An empty clip opens with Step input on, so a key press adds a note at the cursor and plays it |
| The editor was one long page with the music below the fold; the timeline started below the live input and view settings | Sections run Transport, Tracks, Timeline, Piano roll, Instrument, Effects, Mixer, Master effects, then Live input and View |
| The timeline had no bar numbers or track names | The timeline canvas draws a bar-number ruler and each lane's track name |
| "Open panel: none" showed while the piano roll was open; "Playhead" did not follow playback | "Open panel" names the panel on screen; the playhead line reads "(where playback starts)" and the View section states that its values return when the project opens again |
| No Stop button; the play hint appearing and disappearing moved the page | A Stop button follows Play; the hint shares the "Stopped" status line |
| Two save states ("Saved on this device", "Not saved to file") and the term ".wrack" were unexplained | Save .wrack file and Load each carry a sentence: edits save in the browser automatically; a `.wrack` file is a copy of the project and its audio for backups and other devices |
| Compressor value readouts overflowed their card; toggle lamps overlapped capital letters | Effect cards are wider; toggles have top padding that keeps the lamp clear |
| Split and Join were enabled with no clips; the Join help line was always visible | Both are disabled without clips; the Join reason shows once a clip is selected |
| Returning user: the instrument showed "Choose a preset…" after a preset was applied | Each picker shows "Preset: <name>", "<name> (edited)" after changes, or "none" |

## Feedback not acted on
- Recent and Projects show only the name and edit date, with no sort or search.
- The restored selection does not scroll the page to its panel.
- Effect move buttons read "Left" and "Right"; their accessible names are "Move <effect> left" and "Move <effect> right".
- Track meters reach red while the master is at −12 dB; the master limiter, not the track meter, sets the output level.
- Narrow and mobile viewports were not checked.
