/*
 * Clip gain envelopes (a3-audio-implementation.md, Gain stages): breakpoints
 * { frame, gain } with clip-relative frames (points outside the clip anchor
 * the segments that cross its edges), linear in gain between points and held
 * before the first and after the last. Per sample g = g0 + (p − f0)·dg, with
 * g0, f0 and dg found on segment entry by envelopeSeek; evaluating from the
 * segment start instead of accumulating keeps the value independent of where
 * rendering started, so split clips render the same samples.
 */

/** Index of the first point in frames[lo, hi) with frame > p. */
function upperBound(frames, lo, hi, p) {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid] <= p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of fields envelopeSeek writes. */
export const ENV_STATE = 4;

/**
 * Writes the segment at clip frame `p` into `state`: [g0, gain step per
 * frame, frame of the next breakpoint (Infinity after the last), f0]; the
 * gain at frame q in the segment is g0 + (q − f0)·step. The envelope is
 * points [lo, hi) of `frames` and `gains`; an empty envelope is 1.
 */
export function envelopeSeek(frames, gains, lo, hi, p, state) {
  state[3] = p;
  if (hi <= lo) {
    state[0] = 1;
    state[1] = 0;
    state[2] = Infinity;
    return;
  }
  const k = upperBound(frames, lo, hi, p);
  if (k === lo) {
    state[0] = gains[lo];
    state[1] = 0;
    state[2] = frames[lo];
  } else if (k === hi) {
    state[0] = gains[hi - 1];
    state[1] = 0;
    state[2] = Infinity;
  } else {
    state[0] = gains[k - 1];
    state[1] = (gains[k] - gains[k - 1]) / (frames[k] - frames[k - 1]);
    state[2] = frames[k];
    state[3] = frames[k - 1];
  }
}

/** Envelope gain at clip frame `p` (allocates; for tests and the main thread). */
export function envelopeAt(frames, gains, p) {
  const state = new Float64Array(ENV_STATE);
  envelopeSeek(frames, gains, 0, frames.length, p, state);
  return state[0] + (p - state[3]) * state[1];
}
