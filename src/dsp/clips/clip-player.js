/*
 * Audio clip playback for one track (a3-audio-implementation.md, Clip
 * playback). Timeline frame F of a clip reads source frame
 * srcStart + (F − start); out = src · clipGain · fadeIn · fadeOut · envelope.
 * Rendering is a pure function of the play frame, so a split clip renders the
 * same as the unsplit clip. Mono sources fill `mono`; stereo sources fill
 * `left` and `right`. Clips whose source is not bound are silent.
 */
import { smoothingCoeff } from '../core/smoother.js';
import { fadeInGain, fadeOutGain } from './fades.js';
import { envelopeSeek } from './gain-envelope.js';

/** Frames of the fade applied when the transport stops mid-clip (project limit). */
export const STOP_FADE_FRAMES = 64;

/**
 * Builds the playback state for a validated audio model track (allocates).
 * `previous` is the same track's state from the last model, whose clip gains
 * carry over by clip ID so gain edits are smoothed.
 */
export function createClipTrack(payload, fs, previous = null) {
  const c = payload.clips;
  const count = c.start.length;
  let maxLength = 0;
  for (let i = 0; i < count; i++) if (c.length[i] > maxLength) maxLength = c.length[i];
  const gainNow = Float32Array.from(c.gain);
  if (previous !== null) {
    for (let i = 0; i < count; i++) {
      const j = previous.clipIds.indexOf(c.id[i]);
      if (j >= 0) gainNow[i] = previous.gainNow[j];
    }
  }
  return {
    count,
    clipIds: c.id,
    start: c.start,
    length: c.length,
    srcStart: c.srcStart,
    source: c.source,
    gain: c.gain,
    gainNow,
    gainCoeff: smoothingCoeff(fs),
    fadeIn: c.fadeIn,
    fadeOut: c.fadeOut,
    fadeInCurve: c.fadeInCurve,
    fadeOutCurve: c.fadeOutCurve,
    envStart: c.envStart,
    envFrame: c.envFrame,
    envGain: c.envGain,
    maxLength,
    sourceIds: payload.sourceIds,
    channels: payload.sourceIds.map(() => null), // bound per source: [Float32Array] or [L, R]
    env: new Float64Array(3),
    tailFrame: 0,
    tail: 0,
  };
}

/** Binds each of the track's sources found in `sources` (sourceId → channels); others stay unbound. */
export function bindSources(track, sources) {
  for (let s = 0; s < track.sourceIds.length; s++) track.channels[s] = sources.get(track.sourceIds[s]) ?? null;
}

/** Starts the stop fade from play frame `frame`. */
export function startStopFade(track, frame) {
  track.tailFrame = frame;
  track.tail = STOP_FADE_FRAMES;
}

/** Index of the first clip with start ≥ x. */
function lowerBound(arr, n, x) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Adds clip `c`'s frames that fall in [F, F + n) into the buffers. */
function renderClip(track, c, F, n, mono, left, right) {
  const chans = track.channels[track.source[c]];
  if (chans === null) return;
  const cs = track.start[c];
  const len = track.length[c];
  const src0 = track.srcStart[c];
  const avail = chans[0].length - src0; // frames the bound source can supply
  const playable = len < avail ? len : avail;
  const i0 = cs > F ? cs - F : 0;
  let i1 = cs + playable - F;
  if (i1 > n) i1 = n;
  if (i1 <= i0) return;
  const fadeIn = track.fadeIn[c];
  const fadeOut = track.fadeOut[c];
  const inCurve = track.fadeInCurve[c];
  const outCurve = track.fadeOutCurve[c];
  const target = track.gain[c];
  const a = track.gainCoeff;
  let g = track.gainNow[c];
  const env = track.env;
  const lo = track.envStart[c];
  const hi = track.envStart[c + 1];
  let p = F + i0 - cs;
  envelopeSeek(track.envFrame, track.envGain, lo, hi, p, env);
  let e = env[0];
  const stereo = chans.length > 1;
  const l = chans[0];
  const r = stereo ? chans[1] : chans[0];
  const out = stereo ? left : mono;
  for (let i = i0; i < i1; i++, p++) {
    if (p >= env[2]) {
      envelopeSeek(track.envFrame, track.envGain, lo, hi, p, env);
      e = env[0];
    }
    g += a * (target - g);
    let k = g * e;
    if (p < fadeIn) k *= fadeInGain(inCurve, p, fadeIn);
    if (fadeOut > 0) k *= fadeOutGain(outCurve, p, len, fadeOut);
    out[i] += l[src0 + p] * k;
    if (stereo) right[i] += r[src0 + p] * k;
    e += env[1];
  }
  track.gainNow[c] = g;
}

/** Adds every clip overlapping timeline frames [F, F + n) into the buffers (which must start at zero). */
function renderRange(track, F, n, mono, left, right) {
  const end = F + n;
  const first = lowerBound(track.start, track.count, F - track.maxLength);
  for (let c = first; c < track.count && track.start[c] < end; c++) {
    if (track.start[c] + track.length[c] > F) renderClip(track, c, F, n, mono, left, right);
  }
}

/**
 * Renders `n` frames into `mono`, `left` and `right` (overwriting them) for
 * play frame `F`. While stopped, only the stop fade sounds.
 */
export function renderClips(track, mono, left, right, n, F, playing) {
  mono.fill(0, 0, n);
  left.fill(0, 0, n);
  right.fill(0, 0, n);
  if (playing) {
    track.tail = 0;
    renderRange(track, F, n, mono, left, right);
    return;
  }
  if (track.tail <= 0) return;
  const k = track.tail < n ? track.tail : n;
  renderRange(track, track.tailFrame, k, mono, left, right);
  for (let i = 0; i < k; i++) {
    const w = (track.tail - i) / STOP_FADE_FRAMES;
    mono[i] *= w;
    left[i] *= w;
    right[i] *= w;
  }
  track.tailFrame += k;
  track.tail -= k;
}
