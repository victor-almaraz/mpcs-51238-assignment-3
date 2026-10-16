/*
 * Piano-roll geometry and labels, shared by the canvas, the grid mirror and the
 * command hook. Pure functions; no React.
 */
import { DRUM_MAP, drumRowLabel } from '@/dsp/instruments/drum-map';
import { NOTE_COUNT, PPQ } from '@/dsp/core/constants';
import { noteName } from '@/lib/audio/keyboard-input';

/** Cell size in CSS pixels: the 24 × 24 minimum target (WCAG 2.5.8). */
export const CELL_W = 24;
export const ROW_H = 24;
export const LABEL_W = 208;

/** Grid choices, in ticks. */
export const GRIDS = [
  { value: PPQ, label: '1/4' },
  { value: PPQ / 2, label: '1/8' },
  { value: PPQ / 4, label: '1/16' },
  { value: PPQ / 8, label: '1/32' },
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

/** Notes 42, 44 and 46 share the hi-hat choke group. */
export function inChokeGroup(pitch) {
  return pitch === 42 || pitch === 44 || pitch === 46;
}

const isBlackKey = (pitch) => [1, 3, 6, 8, 10].includes(pitch % 12);
export { isBlackKey };

/** "bar 2 beat 1" for tick `t` in `meter` (MeterMap), with "step n" for positions between beats. */
export function positionText(t, meter, grid) {
  const bar = meter.barAt(t) + 1;
  const beat = meter.beatAt(t) + 1;
  const inBeat = meter.tickInBeat(t);
  if (inBeat === 0) return `bar ${bar} beat ${beat}`;
  return `bar ${bar} beat ${beat} step ${Math.floor(inBeat / grid) + 1}`;
}

/** "length 1 beat", "length 0.5 beats". */
export function lengthText(ticks, meter, at) {
  const beats = Math.round((ticks / meter.beatTicksAt(at)) * 1000) / 1000;
  return `length ${beats} ${beats === 1 ? 'beat' : 'beats'}`;
}

/** Accessible note name: "C4, bar 2 beat 1, length 1 beat, velocity 100". */
export function noteText(note, isDrums, meter, grid) {
  return `${rowLabel(note.pitch, isDrums)}, ${positionText(note.tick, meter, grid)}, ${lengthText(note.length, meter, note.tick)}, velocity ${note.velocity}`;
}
