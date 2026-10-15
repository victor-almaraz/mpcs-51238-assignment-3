# Onboarding research

## Scope
This study compares how three tools close to W-Rack welcome a first-time user: BandLab Studio (web), Chrome Music Lab Song Maker (web) and Ableton Live 12 (desktop). For each tool it records the first screen, what the tool asks for, the steps to a first useful result, how it avoids empty screens and what it remembers on return. Decisions for W-Rack follow from the findings. Step counts are counts of documented user actions, not timed tests.

## BandLab Studio
| Aspect | Observation |
|---|---|
| First screen | Sign-up or sign-in, then a home page with Create. New Project opens the Studio with a New Track panel. |
| Asks for | An account; a track type (instruments, drum machine, voice/audio, guitar, bass, sampler, import, BandLab Sounds); microphone permission for voice/audio. |
| Steps to first sound | Sign in → New Project → New Track → BandLab Sounds → choose a loop → add it → Space: seven actions after account creation. |
| Empty states | The New Track panel replaces the empty timeline; a tutorial is available from the Help menu. |
| Return memory | Projects sync to BandLab's cloud and open on any device. |

## Chrome Music Lab Song Maker
| Aspect | Observation |
|---|---|
| First screen | A note grid (melody rows above, percussion rows below) with Play, instrument, tempo, settings and Save. |
| Asks for | Nothing; microphone permission only for microphone input. |
| Steps to first sound | Click a cell (it sounds) → Space or Play: two actions. |
| Empty states | The empty grid is the instruction; every cell sounds on click. |
| Return memory | Save produces a share link and a download; no local draft is kept. |

## Ableton Live 12
| Aspect | Observation |
|---|---|
| First screen | The main window with the Learn View, which the manual describes as displayed by default on first open. Lessons combine video and text and mark completion. |
| Asks for | Installation and authorization; an audio setup lesson guides device configuration; no project fields. |
| Steps to first sound | Launch → Play in a demo Set: two actions after installation. An empty Set requires browsing and dragging a device or clip. |
| Empty states | Learn View lessons beside the work; Info View explains the control under the pointer. |
| Return memory | Learn View returns to the last page; crash recovery restores unsaved work. |

## Findings
| ID | Finding | BandLab Studio | Song Maker | Ableton Live 12 | Implication |
|---|---|---|---|---|---|
| F1 | Gate before content | Account | None | Installation, authorization | No gate |
| F2 | Actions to first sound | 7 after sign-in | 2 | 2 with a demo Set | Two actions from Home |
| F3 | Empty-state strategy | New Track panel | Playable grid | Demo content, lessons | Examples first; actionable empty states |
| F4 | Sound starts on | User action | User action | User action | Stopped on open |
| F5 | Fields before work | Track type | None | None | Few fields, prefilled |
| F6 | Learning model | Tutorial overlay, help articles | Learning by doing | Lessons beside the work | In-context help; no modal tour |
| F7 | Return memory | Cloud projects | Share link | Last lesson page, crash recovery | Recent list and restored working state |
| F8 | Level safety | Red master meter on clipping | Fixed instrument levels | No documented default limiter | Notice, limiter and −12 dB master |
| F9 | Browser audio rule | Gesture required | Gesture required | Not applicable | The notice's confirmation resumes the `AudioContext` |

## Decisions for W-Rack
| ID | Decision | Findings | Target |
|---|---|---|---|
| D1 | No account, permission request or form before content | F1 | Home |
| D2 | Examples appear on every visit; Recent comes first on return visits | F3, F7 | Home (`HOME-01`, `HOME-02`) |
| D3 | An example reaches first sound in two actions: open the card, press Play | F2 | Examples (`HOME-03`) |
| D4 | Examples open stopped at bar 1 with Play highlighted and a text hint | F4, F9 | Examples |
| D5 | Examples are MIDI-only, so they open complete on every visit | F2, F3 | Examples |
| D6 | An example opens as a copy, saved on first edit | F3 | Examples (`HOME-04`) |
| D7 | The volume notice appears at the first sound-producing action of a session; `Continue` resumes the `AudioContext` and performs the action | F8, F9 | Volume notice (`SAFE-01`) |
| D8 | The volume notice offers "Don't show this again on this device"; `/settings` restores it | F8 | Volume notice, Saved settings |
| D9 | Example cards on Home do not preview sound | F4, F9 | Home |
| D10 | The master defaults to −12 dB, with a fixed safety limiter last | F8 | Master (`MIX-01`, `SAFE-02`) |
| D11 | `/new` asks for name (prefilled), tempo (120) and time signature (4/4), with inline errors that keep input | F5 | New project form (`NEW-01`, `NEW-02`) |
| D12 | Empty regions offer the next action; `Add instrument track` opens a playable piano roll | F3, F6 | Editor (`ONB-01`, `ONB-02`) |
| D13 | Help appears in context (tooltips, Info strip); there is no modal tour | F6 | Editor (`HELP-01`) |
| D14 | Return visits restore playhead, loop, zoom, selection and open panel, with the transport stopped | F7 | Coming back (`RET-02`) |
| D15 | Imported audio persists on the device in IndexedDB, and `.wrack` files carry it between devices | F7 | Audio persistence |

## Unconfirmed
- Ableton Live 12 opening a demo Set on first launch (third-party report).
- Song Maker defaults such as instrument, length and tempo (third-party tutorials).

## Sources
- BandLab Help Center: Getting Started with the BandLab Studio — https://help.bandlab.com/hc/en-us/articles/115002945153-Getting-Started-with-the-BandLab-Studio
- Chrome Music Lab: Song Maker — https://musiclab.chromeexperiments.com/Song-Maker/
- Ableton, Live 12 Reference Manual: First Steps — https://www.ableton.com/en/live-manual/12/first-steps/
- Ableton Help Center: Recovering a Set manually after a crash — https://help.ableton.com/hc/en-us/articles/115001878844-Recovering-a-Set-manually-after-a-crash
- Chrome for Developers: Autoplay policy in Chrome — https://developer.chrome.com/blog/autoplay
