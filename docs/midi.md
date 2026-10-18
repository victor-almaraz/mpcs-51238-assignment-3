# MIDI

## Standard MIDI Files
This build does not import or export Standard MIDI Files. The two sections below specify the format handling.

### SMF import
| Item | Requirement |
|---|---|
| Formats | 0, 1, 2; format 2 tracks are placed one after another |
| Header | `MThd` length ≥ 6 (extra bytes skipped); division in PPQ or SMPTE (negative frames per second, ticks per frame) |
| Variable-length quantities | ≤ 4 bytes; longer is an error |
| Running status | Supported. Running status continuing across a meta or SysEx event is tolerated with a warning. |
| Meta events | Tempo (0x51), time signature (0x58), track name (0x03), marker (0x06), end of track (0x2F); key signature (0x59) kept in `extensions` |
| Tick conversion | PPQ input scaled to 960 with rounding; SMPTE division converted through seconds and the imported tempo map |
| Note pairing | FIFO per (track, channel, pitch). Note-on with velocity 0 is a note-off. Unpaired notes end at end of track. |
| Parts | Keyed `t{track}c{channel}`; each part becomes an instrument track |
| RMID | `RIFF`/`RMID` wrapper unwrapped to its `data` chunk |
| Limits | File ≤ 4 MiB; tracks ≤ 256; notes ≤ 200 000 (project limits) |

### SMF export
- Format 1, PPQ 960. Track 0 holds tempo, meter and markers. One SMF track per instrument track; notes keep their `channel`.

## Live input routing
Computer-keyboard and Web MIDI notes are live input (`src/lib/audio/engine-client.js`, `src/components/studio/Studio.jsx`).

- Live notes play on every armed instrument track. When no track is armed, they play on the selected track: the track whose piano roll the Editor tab shows (the selected track, or the first instrument track when none is selected).
- An instrument track is armed by its header's arm button (circle-dot icon, "Arm Bass for live input", `aria-pressed`) or by R on its focused track row. Several tracks may be armed at once. The armed tracks are part of the working state (`armedTrackIds`); audio tracks cannot be armed.
- Note previews and drum-row auditions always play on the selected track, on MIDI channel 16, so they never cut a held live note.
- When a track stops receiving live input (it is disarmed, or the selection changes), its held live notes end (all notes off, CC 123).
- The info strip names the target: "Input: Bass, Lead" for armed tracks, "Input: Bass (selected)" otherwise. Arming and disarming are announced ("Bass armed for live input", "Bass disarmed").
- With the piano roll's step input on, each live note-on is also added at the piano-roll cursor.
- The first live note of a page session passes through the volume notice (`assignment-3-scope.md`). A note released before audio starts does not sound.
- Live events reach the engine as `live` messages on the worklet port, one MIDI channel message `[status, data1, data2]` per target track, and apply at the start of the next quantum. They carry no timestamp.
- Note-ons beyond 200 per second are dropped (`audio-safety.md`); note-offs always pass.

## Web MIDI input
- `Connect MIDI device` in the info strip calls `navigator.requestMIDIAccess({ sysex: false })` from the click (`src/lib/audio/midi-input.js`).
- Every input port is bound. A port that appears is bound when it appears; a port that disconnects ends every live note.
- Status bytes ≥ 0xF0 are ignored. Messages on every channel are handled alike.
- Handled: note-on, note-off (and note-on with velocity 0), CC 64 sustain (≥ 64 is down; note-offs wait until release), CC 120 all sound off, CC 123 all notes off. Pitch bend and other messages are ignored.
- Status text: "MIDI input: <port names>", "No MIDI devices found. Connect a device; it is picked up when it appears.", "MIDI access was not allowed. Allow it in the browser’s site settings to play from a MIDI device.", "Web MIDI is not supported in this browser." Firefox adds: "Firefox asks to install a site permission add-on. Connect the MIDI device before starting Firefox."

## Computer keyboard input
| `KeyboardEvent.code` | KeyA | KeyW | KeyS | KeyE | KeyD | KeyF | KeyT | KeyG | KeyY | KeyH | KeyU | KeyJ | KeyK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Semitone | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |

- `KeyZ` and `KeyX` shift the octave down and up. The base note of octave o is MIDI 12·(o + 1); octaves 0–7 cover C0–C8, and octave 4 (C4 = 60) is the default (project limits). The octave is shown in the info strip ("Keyboard octave: C4") and kept in saved settings. Velocity is 100 (project limit).
- `Play with keyboard` in the info strip turns keyboard input on and off; it is on when the editor opens.
- Input is inactive while focus is in text entry (`input` other than range, checkbox, radio and button types; `textarea`; `select`; `contenteditable`), while a dialog is open, while `Play with keyboard` is off, while Ctrl, Cmd or Alt is held, and for a key a focused editor has already handled. Key repeat is ignored.
- Held notes end when the window loses focus, when keyboard input is turned off, when the octave changes, and when Cmd is pressed or released (macOS browsers send no key-up for other keys while Cmd is down).

### Shortcuts and note keys
- No global single-letter shortcut uses a note key or Z or X (`design-patterns.md`, Keyboard shortcuts).
- While `Play with keyboard` is on, the note keys and Z and X are claimed for notes: an unmodified press of one of them runs no global shortcut. Shortcuts with Ctrl, Cmd or Alt (`Mod+Z`, `Mod+D`) are unaffected.
- A focused editor handles its own keys first. On a focused track row, S solos the track and does not play a note.

```ts
// src/lib/audio/keyboard-input.js
export function createKeyboardInput(options: {
  onNoteOn(pitch: number, velocity: number, isHeld: () => boolean): void;
  onNoteOff(pitch: number): void;
  onOctave(octave: number): void;
  octave?: number;
}): { attach(): void; detach(): void; setEnabled(on: boolean): void; octave(): number; setOctave(o: number): void };

// src/lib/audio/midi-input.js
export function parseMidi(data: Uint8Array):
  | { type: 'on'; pitch: number; velocity: number }
  | { type: 'off'; pitch: number }
  | { type: 'sustain'; down: boolean }
  | { type: 'allSoundOff' | 'allNotesOff' }
  | null;
export function connectMidi(handlers: {
  onNoteOn(pitch: number, velocity: number, isHeld: () => boolean): void;
  onNoteOff(pitch: number): void;
  onAllOff(hard: boolean): void;
  onStatus(text: string): void;
}): Promise<() => void>; // resolves to a disconnect function
```

## Sources
- Standard MIDI Files 1.0 — https://midi.org/standard-midi-files
- Web MIDI API — https://www.w3.org/TR/webmidi/
- MDN KeyboardEvent.code — https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
