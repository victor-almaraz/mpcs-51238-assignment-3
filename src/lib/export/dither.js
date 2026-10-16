/*
 * TPDF dither for 16-bit export (a3-audio-implementation.md, WAV writer):
 * d = u1 − u2 in LSB, with u1 and u2 from mulberry32(exportSeed), so the same
 * export always produces the same samples. No time-based seeds.
 */
import { Mulberry32 } from '../../dsp/core/prng.js';

/** Fixed export seed (project limit: dither must be reproducible). */
export const EXPORT_SEED = 0x5752414b; // "WRAK"

/** A dither source: next() returns u1 − u2 ∈ (−1, 1) LSB, triangular. */
export function createTpdf(seed = EXPORT_SEED) {
  const rng = new Mulberry32(seed);
  return {
    next() {
      return rng.next() - rng.next();
    },
  };
}
