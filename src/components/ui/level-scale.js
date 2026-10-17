/*
 * The fader's dB scale, shared by the fader, its scale marks and the meter
 * beside it, so a level and a mark of the same dB sit at the same height.
 * Pure functions; no React.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Height of `db` on a `min`–`max` dB scale, 0 (bottom) to 1 (top), on a square
 * taper: the top of the range (+6 to −12 dB) gets most of the travel, as on a console.
 */
export function taperFraction(db, min, max) {
  return ((clamp(db, min, max) - min) / (max - min)) ** 2;
}

/** The dB value at height `f` (0 to 1) of the scale; the inverse of taperFraction. */
export function taperValue(f, min, max) {
  return min + Math.sqrt(clamp(f, 0, 1)) * (max - min);
}
