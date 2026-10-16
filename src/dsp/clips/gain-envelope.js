/*
 * Clip gain envelopes (a3-audio-implementation.md, Gain stages): breakpoints
 * { frame, gain } with clip-relative frames, linear in gain between points and
 * held before the first and after the last. Per sample g += dg; dg is computed
 * on segment entry by envelopeSeek.
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

/**
 * Writes the envelope state at clip frame `p` into `state`: [gain, gain step
 * per frame, frame of the next breakpoint (Infinity after the last)]. The
 * envelope is points [lo, hi) of `frames` and `gains`; an empty envelope is 1.
 */
export function envelopeSeek(frames, gains, lo, hi, p, state) {
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
    const slope = (gains[k] - gains[k - 1]) / (frames[k] - frames[k - 1]);
    state[0] = gains[k - 1] + (p - frames[k - 1]) * slope;
    state[1] = slope;
    state[2] = frames[k];
  }
}

/** Envelope gain at clip frame `p` (allocates; for tests and the main thread). */
export function envelopeAt(frames, gains, p) {
  const state = new Float64Array(3);
  envelopeSeek(frames, gains, 0, frames.length, p, state);
  return state[0];
}
