/*
 * Piano-roll geometry and labels, shared by the canvas, the grid mirror and the
 * command hook. Pure functions; no React.
 */
import { DRUM_MAP, DRUM_VOICE_NAMES, drumRowLabel } from '@/dsp/instruments/drum-map';
import { NOTE_COUNT, PPQ } from '@/dsp/core/constants';
import { noteName } from '@/lib/audio/keyboard-input';
import { beatCountText, beatsText } from '@/components/timeline/layout';

/** Smallest cell in CSS pixels: the 24 × 24 minimum target (WCAG 2.5.8). */
export const CELL_W = 24;

/**
 * Horizontal scale, px per tick, at zoom 1: a 1/16 step is CELL_W wide. The grid
 * never changes it; a grid step is grid · TICK_W · zoom pixels wide.
 */
const TICK_W = CELL_W / (PPQ / 4);

/** Piano-roll zoom factors; a grid is usable at a zoom where its cells are at least CELL_W wide. */
export const ROLL_ZOOMS = [0.5, 1, 2, 4];

/** Width in px of a `grid`-tick cell at `zoom`. */
export const cellWidth = (grid, zoom) => grid * TICK_W * zoom;
export const ROW_H = 24;
export const LABEL_W = 208;

/** Grid choices, in ticks: straight values and triplets (T, three in the time of two). */
export const GRIDS = [
  { value: PPQ, label: '1/4' },
  { value: (PPQ * 2) / 3, label: '1/4T' },
  { value: PPQ / 2, label: '1/8' },
  { value: PPQ / 3, label: '1/8T' },
  { value: PPQ / 4, label: '1/16' },
  { value: PPQ / 6, label: '1/16T' },
  { value: PPQ / 8, label: '1/32' },
  { value: PPQ / 12, label: '1/32T' },
];
export const DEFAULT_GRID = PPQ / 4;

/** Rows top to bottom: pitched tracks run 127 → 0; drum tracks list mapped notes low to high (PR-04). */
export function rowPitches(isDrums, showAll) {
  if (isDrums && !showAll) return DRUM_MAP.map((e) => e.note);
  if (isDrums) return Array.from({ length: NOTE_COUNT }, (_, i) => i);
  return Array.from({ length: NOTE_COUNT }, (_, i) => NOTE_COUNT - 1 - i);
}

/** Row label: "C4", or "36 Kick (Bass Drum 1)" on drum tracks. */
export function rowLabel(pitch, isDrums) {
  return isDrums ? drumRowLabel(pitch) : noteName(pitch);
}

/** Visible row header: "C4", or "36 Kick" on drum rows (the GM name goes in the accessible name and tooltip). */
export function rowShortLabel(pitch, isDrums) {
  if (!isDrums) return noteName(pitch);
  const e = DRUM_MAP.find((x) => x.note === pitch);
  return e ? `${pitch} ${DRUM_VOICE_NAMES[e.voice]}` : `${pitch} No voice`;
}

/** Notes 42, 44 and 46 share the hi-hat choke group. */
export function inChokeGroup(pitch) {
  return pitch === 42 || pitch === 44 || pitch === 46;
}

const isBlackKey = (pitch) => [1, 3, 6, 8, 10].includes(pitch % 12);
export { isBlackKey };

/** Where tick `inBeat` lies in a beat of `beatTicks`: the grid step when the grid divides the beat, else the fraction. */
function inBeatText(inBeat, beatTicks, grid) {
  return beatTicks % grid === 0 ? { step: Math.floor(inBeat / grid) + 1 } : { fraction: beatsText(inBeat, beatTicks) };
}

/**
 * "bar 2 beat 1" for tick `t` in `meter` (MeterMap); between beats, "step n" on a grid
 * that divides the beat, else the fraction of the beat ("bar 1 beat 1 and 2/3" on 1/4T).
 */
export function positionText(t, meter, grid) {
  const bar = meter.barAt(t) + 1;
  const beat = meter.beatAt(t) + 1;
  const inBeat = meter.tickInBeat(t);
  if (inBeat === 0) return `bar ${bar} beat ${beat}`;
  const { step, fraction } = inBeatText(inBeat, meter.beatTicksAt(t), grid);
  return `bar ${bar} beat ${beat} ${step ? `step ${step}` : `and ${fraction}`}`;
}

/** "bar 2.3", or off the beat "bar 2.3.2" (the grid step) or "bar 2.3+1/3" (the fraction of the beat). */
export function barBeatText(t, meter, grid) {
  const at = `bar ${meter.barAt(t) + 1}.${meter.beatAt(t) + 1}`;
  const inBeat = meter.tickInBeat(t);
  if (inBeat === 0) return at;
  const { step, fraction } = inBeatText(inBeat, meter.beatTicksAt(t), grid);
  return step ? `${at}.${step}` : `${at}+${fraction}`;
}

/** "length 1 beat", "length 0.5 beats", "length 1/3 beat". */
const lengthText = (ticks, meter, at) => `length ${beatCountText(ticks, meter.beatTicksAt(at))}`;

/** Accessible note name: "C4, bar 2 beat 1, length 1 beat, velocity 100". */
export function noteText(note, isDrums, meter, grid) {
  return `${rowLabel(note.pitch, isDrums)}, ${positionText(note.tick, meter, grid)}, ${lengthText(note.length, meter, note.tick)}, velocity ${note.velocity}`;
}
