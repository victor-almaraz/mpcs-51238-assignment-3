/*
 * Clip fades (a3-audio-implementation.md, Gain stages): 1025-entry tables read
 * with linear interpolation. A fade-in reads its table at x = p/L; a fade-out
 * at 1 − x, x = (p − (len − L))/L. With equalPower curves, an overlap's
 * fade-out and fade-in sum to unit power, so crossfades need no engine logic.
 */
import { FADE_CURVES, FADE_TABLES, readTable } from '../core/tables.js';

export { FADE_CURVES };

/** Index of `curve` in FADE_CURVES, for the model's Uint8Array; unknown curves are linear. */
export function curveIndex(curve) {
  const i = FADE_CURVES.indexOf(curve);
  return i < 0 ? 0 : i;
}

/** Fade-in gain at clip frame `p` for a fade of `length` frames on curve index `curve`. */
export function fadeInGain(curve, p, length) {
  return p >= length ? 1 : readTable(FADE_TABLES[curve], p / length);
}

/** Fade-out gain at clip frame `p` of a clip `clipLength` frames long. */
export function fadeOutGain(curve, p, clipLength, length) {
  const from = clipLength - length;
  return p < from ? 1 : readTable(FADE_TABLES[curve], 1 - (p - from) / length);
}
