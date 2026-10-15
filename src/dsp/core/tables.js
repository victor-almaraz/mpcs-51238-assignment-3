/*
 * Lookup tables built once at module load (worklet start or test import),
 * never inside process().
 */
import { FADE_TABLE_SIZE, NOTE_COUNT } from './constants.js';

/** Frequency in Hz of MIDI note n: 440·2^((n − 69)/12), for n in 0–127. */
export const NOTE_FREQUENCIES = new Float64Array(NOTE_COUNT);
for (let n = 0; n < NOTE_COUNT; n++) NOTE_FREQUENCIES[n] = 440 * 2 ** ((n - 69) / 12);

/** Velocity gain 0.3·(vel/127)² for velocity 0–127. */
export const VELOCITY_GAIN = new Float32Array(NOTE_COUNT);
for (let v = 0; v < NOTE_COUNT; v++) VELOCITY_GAIN[v] = 0.3 * (v / 127) ** 2;

/** Fade curve names, in table index order. */
export const FADE_CURVES = ['linear', 'equalPower', 'exp'];

/**
 * Builds a fade-in table for `curve` with `size` entries over x ∈ [0, 1]:
 * linear g = x; equalPower g = sin(x·π/2); exp g = 10^(−3·(1 − x)), with g(0) = 0.
 */
export function buildFadeTable(curve, size = FADE_TABLE_SIZE) {
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    if (curve === 'linear') table[i] = x;
    else if (curve === 'equalPower') table[i] = Math.sin((x * Math.PI) / 2);
    else if (curve === 'exp') table[i] = x === 0 ? 0 : 10 ** (-3 * (1 - x));
    else throw new Error(`Unknown fade curve: ${curve}`);
  }
  return table;
}

/** Fade-in tables indexed like FADE_CURVES. A fade-out reads its table at 1 − x. */
export const FADE_TABLES = FADE_CURVES.map((curve) => buildFadeTable(curve));

/** Reads `table` at x ∈ [0, 1] with linear interpolation; x outside the range is clamped. */
export function readTable(table, x) {
  const last = table.length - 1;
  const pos = (x <= 0 ? 0 : x >= 1 ? 1 : x) * last;
  const i = pos | 0;
  if (i >= last) return table[last];
  const frac = pos - i;
  return table[i] + (table[i + 1] - table[i]) * frac;
}

/** Entries in the sine table (project limit); one guard entry follows for interpolation. */
export const SINE_TABLE_SIZE = 4096;

/** sin(2π·i/4096) for i in 0–4096 (the last entry repeats the first). */
export const SINE_TABLE = new Float32Array(SINE_TABLE_SIZE + 1);
for (let i = 0; i <= SINE_TABLE_SIZE; i++) SINE_TABLE[i] = Math.sin((2 * Math.PI * i) / SINE_TABLE_SIZE);

/** sin(2π·phase) for phase ∈ [0, 1), by linear interpolation in SINE_TABLE. */
export function sineAt(phase) {
  const pos = phase * SINE_TABLE_SIZE;
  const i = pos | 0;
  const frac = pos - i;
  return SINE_TABLE[i] + (SINE_TABLE[i + 1] - SINE_TABLE[i]) * frac;
}
