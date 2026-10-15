# Onboarding research

## Scope
This study compares how three tools close to W-Rack welcome a first-time user: BandLab Studio (web), Chrome Music Lab Song Maker (web) and Ableton Live 12 (desktop). For each tool it records the first screen, what the tool asks for, the steps to a first useful result, empty states, learning aids, level safety and what the tool remembers on return. Decisions for W-Rack follow from the findings. Step counts are counts of documented user actions, not timed tests.

## Method
- One research agent studied each tool independently, row by row, against official sources first and third-party sources second. Sources were checked on 2026-10-14.
- BandLab and Ableton Help Center pages sit behind a browser challenge. Their article text was read through the public Help Center API (`/api/v2/help_center/en-us/articles/<id>.json`), which returns the same article bodies.
- Song Maker has no published documentation of its interface. Its first screen, defaults, audio unlock and save flow were read from the production bundle (`Song-Maker/client/build/Main.js`). These facts can change when the bundle is redeployed.
- No tool was run in a browser or installed. Layout descriptions come from documentation and code, not observation.
- Confidence labels: **documented** (official documentation), **code** (production bundle), **third-party** (independent guides), **inferred** (derived from documented facts).

## BandLab Studio
| Aspect | Observation | Confidence |
|---|---|---|
| First screen | After sign-up or sign-in, the BandLab main page has Create at the top right. Create → New Project opens the Studio, and a New Track pop-up appears on entry. Create also offers SongStarter. | Documented; the logged-out landing page is undocumented |
| Asks for | An account: the Studio is available "as soon as you sign up", and no guest mode is documented. A first track type from the New Track pop-up: Voice/Audio, Instruments, Import Audio/MIDI, BandLab Sounds, Palette (membership); Drum Machine, Sampler, Guitar and Bass are also available through Add Track. Browser microphone permission for recording, browser MIDI permission for MIDI devices. An internet connection; Chrome is recommended. | Documented |
| Steps to first sound | Create → New Project → BandLab Sounds (on the pop-up, which opens on its own) → double-click a sample → Space: five actions after sign-in. Sign-up steps are not documented and not counted. Auditioning a sample in the Sounds browser can sound one action earlier. | Documented; audition by click inferred |
| Empty states | The New Track pop-up opens with every new project. A guided Studio tutorial is available from Menu → Help → Show Tutorial. | Documented; whether the tutorial starts on its own is undocumented |
| Learning | The Studio tutorial, a keyboard-shortcut panel (Ctrl/Cmd+/), help articles and video tutorials. | Documented |
| Level safety | The master meter turns red when "your mix is too loud and may distort"; input and channel meters turn red on clipping. No default master limiter, default level or volume warning is documented. A limiter effect and mastering are optional. | Documented |
| Browser audio | BandLab documents that the site's Sound permission must be Allow or Automatic. Chrome's autoplay policy applies, and every documented path starts with a click. | Inferred |
| Return memory | Saved projects sync to BandLab's cloud, appear in the Library with revision history and open on web and mobile. Saving is manual (Save or Ctrl/Cmd+S) and needs an internet connection. No autosave or restored view state is documented. | Documented |

## Chrome Music Lab Song Maker
| Aspect | Observation | Confidence |
|---|---|---|
| First screen | A note grid with melody rows above two percussion rows. The bottom bar holds Play, instrument (Marimba), percussion (Electronic), tempo, Restart, Settings, Undo and Save; Save is disabled until the song changes. Mic and Midi buttons appear when a device is detected. The header holds Back, Restart and About. | Code |
| Asks for | No account and no setup choices. Microphone permission only when Mic is pressed. Web MIDI access is requested on load, which can show a MIDI permission prompt in Chrome 124 and later. | Documented (account); code (permissions) |
| Steps to first sound | Click an empty cell: the note is added and sounds, one action. Play or Space plays the loop: two actions. | Code |
| Empty states | The empty grid is the instruction; there is no tour. Clicking a filled cell removes the note. | Code |
| Learning | Learning by doing. Written instructions appear only in the About, Mic and MIDI dialogs ("To make a song, add notes by clicking the grid…"). | Documented; code |
| Level safety | Sampler levels are fixed at −6 dB. There is no user volume control and no limiter. | Code |
| Browser audio | The audio context resumes on note add, Play and Space, so the first click both unlocks audio and sounds. | Code |
| Return memory | Save uploads the song to Google's server and opens a share panel: "Your song is saved at this link", with Copy Link, Download Midi, Download Wav and Embed Code. No local draft is kept. Back on an unsaved song warns "Go back? Your song will not be saved." | Code |

Song Maker defaults:

| Setting | Default | Range |
|---|---|---|
| Instrument | Marimba | Marimba, Piano, Strings, Woodwind, Synth |
| Percussion | Electronic | Electronic, Blocks, Kit, Conga |
| Length | 4 bars at window widths ≥ 1024 px, otherwise 1 bar | 1–16 bars |
| Beats per bar | 4 | 2–7 |
| Split beats into | 2 | 1–4 |
| Scale | Major | Major, Pentatonic, Chromatic |
| Start note | C, Middle octave | C–B; Low, Middle, High |
| Range | 2 octaves at window widths ≥ 1024 px, otherwise 1 octave | 1–3 octaves |
| Tempo | 120 BPM | 40–240 BPM |

## Ableton Live 12
Facts apply to Live 12.4 and later, where the Learn View replaces the Help View.

| Aspect | Observation | Confidence |
|---|---|---|
| First screen | On first launch, Live opens the demo Set ("Patience" by Chuck Sutton), and "The Learn View is displayed by default when you first open Live". Lessons combine video and text, can be marked complete, can play video in an always-on-top picture-in-picture window, and need an internet connection. | Documented |
| Asks for | An Ableton account to download and authorize (offline authorization exists), installation, and authorization at first launch. Audio device setup is optional, in Settings → Audio. No project fields; name and location are asked for at the first save. | Documented |
| Steps to first sound | First launch: launch → authorize → Play in the demo Set, three steps; two once Live is authorized. From an empty Set: preview an item in the browser, or drag or double-click a clip or device into the Set and play it. | Documented; counts inferred |
| Empty states | File → New Live Set opens the Default Set: two audio, two MIDI and two return tracks with no clips or instruments and no empty-state message. | Documented |
| Learning | Learn View lessons beside the work; the Info View shows "the name and function of whatever element of the UI that you hover over". | Documented |
| Level safety | No default limiter or volume warning is documented. Return-track sends are disabled by default because "runaway feedback can boost the level dramatically and unexpectedly"; Cue Out defaults to −6 dB; peak indicators are hidden until the mixer is enlarged. | Documented |
| Browser audio | Not applicable to a desktop application. | — |
| Return memory | Later launches open the Default Set; recent Sets are under File → Open Recent Set. The Learn View returns to its last page only while Live stays open. After a crash, Live offers to restore the unsaved Set on the next launch, with manual recovery from the Crash folder as the fallback. No autosave is documented. | Documented |

## Findings
| ID | Finding | BandLab Studio | Song Maker | Ableton Live 12 | Implication |
|---|---|---|---|---|---|
| F1 | Gate before content | Account | None | Account, installation, authorization | No gate |
| F2 | Actions to first sound | 5 after sign-in | 1 (place a note); 2 to play the loop | 3 on first launch with the demo Set; 2 after authorization | Two actions from Home |
| F3 | Empty-state strategy | New Track pop-up | Playable grid | Demo Set on first launch; empty Default Set later | Examples first; actionable empty states |
| F4 | Sound starts on | User action | User action | User action | Stopped on open |
| F5 | Fields before work | Track type | None | None; name at first save | Few fields, prefilled |
| F6 | Learning model | Tutorial from the Help menu, shortcut panel, help articles | Learning by doing; About dialog | Lessons beside the work; Info View on hover | In-context help; no modal tour |
| F7 | Return memory | Cloud Library, manual save | Server link on Save; leave warning | Default Set on launch, recent Sets, crash restore | Recent list and restored working state |
| F8 | Level safety | Red master meter; no documented limiter | Fixed −6 dB sampler levels; no limiter, no volume control | No documented limiter; sends off by default to prevent feedback | Notice, limiter and −12 dB master |
| F9 | Browser audio rule | Gesture required (browser policy) | Context resumes on the first note or Play | Not applicable | The notice's confirmation resumes the `AudioContext` |
| F10 | Permission requests | Microphone and MIDI when a device is used | Web MIDI requested on load; microphone on Mic | None in the browser | Permissions only on user action |
| F11 | Unsaved work | Manual save; no autosave documented | Lost on leave unless saved; warning shown | Manual save; crash restore offered | Local autosave with visible status |

## Decisions for W-Rack
| ID | Decision | Findings | Target |
|---|---|---|---|
| D1 | No account, permission request or form before content | F1, F10 | Home |
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
| D12 | Empty regions offer the next action; `Add instrument track` opens a playable piano roll, and placing a note previews it | F2, F3, F6 | Editor (`ONB-01`, `ONB-02`, `PR-02`) |
| D13 | Help appears in context (tooltips, Info strip); there is no modal tour | F6 | Editor (`HELP-01`) |
| D14 | Return visits restore playhead, loop, zoom, selection and open panel, with the transport stopped | F7 | Coming back (`RET-02`) |
| D15 | Imported audio persists on the device in IndexedDB, and `.wrack` files carry it between devices | F7 | Audio persistence |
| D16 | Web MIDI access is requested only from a button; the page load requests no permission | F10 | MIDI |
| D17 | Edits save locally 500 ms after the last change, with a visible save status; leaving never discards an edit | F11 | Persistence (`SAVE-01`) |

## Unconfirmed
- BandLab: the logged-out landing page, the absence of a guest mode, whether the Studio tutorial starts on its own, and the absence of autosave. The documentation is silent on each.
- Song Maker: whether the load-time Web MIDI request shows a prompt depends on the Chrome version; the request is confirmed in code, the prompt was not observed.
- Ableton Live 12: how the demo Set and the Learn View are arranged on first launch, and whether lesson completion persists across restarts. Settling these needs a fresh installation.

## Sources
BandLab:
- Getting Started with the BandLab Studio — https://help.bandlab.com/hc/en-us/articles/115002945153-Getting-Started-with-the-BandLab-Studio
- BandLab Sounds — https://help.bandlab.com/hc/en-us/articles/360018942593-BandLab-Sounds
- Studio Keyboard Shortcuts — https://help.bandlab.com/hc/en-us/articles/360021363353-Studio-Keyboard-Shortcuts
- Connecting MIDI Devices — https://help.bandlab.com/hc/en-us/articles/58150962949785-Connecting-MIDI-Devices
- Audio Issues in the Studio — https://help.bandlab.com/hc/en-us/articles/59373540651161-Audio-Issues-in-the-Studio
- Audio Output Issues — https://help.bandlab.com/hc/en-us/articles/56922726115097-Audio-Output-Issues
- Saving Issues — https://help.bandlab.com/hc/en-us/articles/115002945193-Saving-Issues
- The Beginner's Guide to BandLab Studio — https://blog.bandlab.com/studio-faq/

Song Maker:
- Chrome Music Lab: Song Maker — https://musiclab.chromeexperiments.com/Song-Maker/
- Song Maker production bundle — https://musiclab.chromeexperiments.com/Song-Maker/client/build/Main.js
- Chrome Music Lab: About — https://musiclab.chromeexperiments.com/About
- Chrome for Developers: Access to MIDI devices now requires user permission — https://developer.chrome.com/blog/web-midi-permission-prompt

Ableton Live 12:
- Live 12 Reference Manual: First Steps — https://www.ableton.com/en/live-manual/12/first-steps/
- Live 12 Reference Manual: Managing Files and Sets — https://www.ableton.com/en/live-manual/12/managing-files-and-sets/
- Live 12 Reference Manual: Mixing — https://www.ableton.com/en/live-manual/12/mixing/
- Live 12 Release Notes — https://www.ableton.com/en/release-notes/live-12/
- Location of the default Demo Set — https://help.ableton.com/hc/en-us/articles/209774005-Location-of-the-default-Demo-Set
- Installing Ableton Live — https://help.ableton.com/hc/en-us/articles/209773565-Installing-Ableton-Live
- Default Set and Template Sets — https://help.ableton.com/hc/en-us/articles/209067189-Default-Set-and-Template-Sets
- Recovering a Set manually after a crash — https://help.ableton.com/hc/en-us/articles/115001878844-Recovering-a-Set-manually-after-a-crash

Browsers:
- Chrome for Developers: Autoplay policy in Chrome — https://developer.chrome.com/blog/autoplay
