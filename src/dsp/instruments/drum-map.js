/*
 * General MIDI Level 1 percussion key map for the drum machine
 * (a3-audio-implementation.md, Drum machine). Shared by the kernel and the
 * piano roll's drum rows. Unmapped notes produce no sound.
 */
import { NOTE_COUNT } from '../core/constants.js';

/** Voice IDs, in kernel index order. */
export const DRUM_VOICES = [
  'kick', 'snare', 'sidestick', 'clap', 'closedHat', 'pedalHat', 'openHat',
  'lowTom', 'midTom', 'highTom', 'crash', 'ride', 'cowbell', 'claves',
];

/** Display names of the voices, in DRUM_VOICES order. */
export const DRUM_VOICE_NAMES = [
  'Kick', 'Snare', 'Side stick', 'Clap', 'Closed hat', 'Pedal hat', 'Open hat',
  'Low tom', 'Mid tom', 'High tom', 'Crash', 'Ride', 'Cowbell', 'Claves',
];

export const KICK = 0;
export const SNARE = 1;
export const SIDESTICK = 2;
export const CLAP = 3;
export const CLOSED_HAT = 4;
export const PEDAL_HAT = 5;
export const OPEN_HAT = 6;
export const LOW_TOM = 7;
export const MID_TOM = 8;
export const HIGH_TOM = 9;
export const CRASH = 10;
export const RIDE = 11;
export const COWBELL = 12;
export const CLAVES = 13;

/** Mapped notes: { note, voice (index), tuneOffset (semitones, project limit), gmName }. */
export const DRUM_MAP = Object.freeze(
  [
    [35, KICK, -2, 'Acoustic Bass Drum'],
    [36, KICK, 0, 'Bass Drum 1'],
    [37, SIDESTICK, 0, 'Side Stick'],
    [38, SNARE, 0, 'Acoustic Snare'],
    [39, CLAP, 0, 'Hand Clap'],
    [40, SNARE, 2, 'Electric Snare'],
    [41, LOW_TOM, -3, 'Low Floor Tom'],
    [42, CLOSED_HAT, 0, 'Closed Hi-Hat'],
    [43, LOW_TOM, 0, 'High Floor Tom'],
    [44, PEDAL_HAT, 0, 'Pedal Hi-Hat'],
    [45, MID_TOM, -2, 'Low Tom'],
    [46, OPEN_HAT, 0, 'Open Hi-Hat'],
    [47, MID_TOM, 0, 'Low-Mid Tom'],
    [48, HIGH_TOM, 0, 'Hi-Mid Tom'],
    [49, CRASH, 0, 'Crash Cymbal 1'],
    [50, HIGH_TOM, 2, 'High Tom'],
    [51, RIDE, 0, 'Ride Cymbal 1'],
    [56, COWBELL, 0, 'Cowbell'],
    [57, CRASH, 1, 'Crash Cymbal 2'],
    [59, RIDE, -1, 'Ride Cymbal 2'],
    [75, CLAVES, 0, 'Claves'],
  ].map(([note, voice, tuneOffset, gmName]) => Object.freeze({ note, voice, tuneOffset, gmName })),
);

/** voiceOfNote[n]: voice index for MIDI note n, or −1 when unmapped. */
export const voiceOfNote = new Int8Array(NOTE_COUNT).fill(-1);
/** offsetOfNote[n]: tune offset in semitones for MIDI note n. */
export const offsetOfNote = new Int8Array(NOTE_COUNT);
for (const e of DRUM_MAP) {
  voiceOfNote[e.note] = e.voice;
  offsetOfNote[e.note] = e.tuneOffset;
}

/** Piano-roll row label (PR-04): "36 Kick (Bass Drum 1)", or "60 No voice". */
export function drumRowLabel(note) {
  const e = DRUM_MAP.find((x) => x.note === note);
  return e ? `${note} ${DRUM_VOICE_NAMES[e.voice]} (${e.gmName})` : `${note} No voice`;
}
