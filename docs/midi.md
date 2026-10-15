# MIDI

## SMF import
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

## SMF export
- Format 1, PPQ 960. Track 0 holds tempo, meter and markers. One SMF track per instrument track; notes keep their `channel`.

## Web MIDI input
- `navigator.requestMIDIAccess({ sysex: false })`, called from a user action.
- Status bytes ≥ 0xF0 are ignored.
- Handled: note-on, note-off, CC64 sustain (≥ 64 is down), CC120 all sound off, CC123 all notes off, pitch bend (applied by instruments that support it).
- Messages are forwarded to the audio thread through a SAB ring with `MIDIMessageEvent.timeStamp`.
- Live playing sounds at the next quantum. Recording maps `timeStamp` to a context frame through the `performanceTime`/`contextTime` pair from `getOutputTimestamp()`.
- The flood limit is in `audio-safety.md`.

## Computer keyboard input
| `KeyboardEvent.code` | KeyA | KeyW | KeyS | KeyE | KeyD | KeyF | KeyT | KeyG | KeyY | KeyH | KeyU | KeyJ | KeyK |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Semitone | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |

- `KeyZ` and `KeyX` shift the octave down and up. Base note C4 = 60; range C0–C8 (project limits). Velocity 100 (project limit).
- Input is inactive while focus is in text entry (`input`, `textarea`, `contenteditable`) or a dialog, and while the keyboard-play mode is off. Key repeat is ignored.

```ts
export interface ComputerKeyboardInput { setEnabled(on: boolean): void; octave(): number; setOctave(o: number): void }
export interface MidiPortInfo { id: string; name: string; manufacturer?: string; state: 'connected' | 'disconnected' }
export type MidiAccessState = 'granted' | 'denied' | 'unsupported';
```

## Sources
- Standard MIDI Files 1.0 — https://midi.org/standard-midi-files
- Web MIDI API — https://www.w3.org/TR/webmidi/
- MDN KeyboardEvent.code — https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
