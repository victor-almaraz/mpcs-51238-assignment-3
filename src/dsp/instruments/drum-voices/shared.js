/*
 * Primitives shared by the drum voice models (a3-audio-implementation.md,
 * Drum machine). All coefficient functions run at note-on; the per-sample
 * helpers call no pow, exp, log or tan.
 */
import { svfCoefficients, svfTick } from '../../effects/svf.js';

/** Per-sample decay factor for T60 `t60` seconds: 10^(−3/(T60·fs)). Note-on only. */
export function decayFactor(t60, fs) {
  return 10 ** (-3 / (t60 * fs));
}

/** Per-sample pitch-envelope factor exp(−1/(τ·fs)). Note-on only. */
export function pitchFactor(tauS, fs) {
  return Math.exp(-1 / (tauS * fs));
}

/** One-pole lowpass coefficient for corner `fc` Hz: 1 − exp(−2π·fc/fs). Note-on only. */
export function onePoleCoeff(fc, fs) {
  return 1 - Math.exp((-2 * Math.PI * fc) / fs);
}

/** Maps tone ∈ [0, 1] to [lo, hi] on a log scale. */
export function toneLog(tone, lo, hi) {
  return lo * (hi / lo) ** tone;
}

/** Sets SVF `index` (0–2) of slot `s` to cutoff `fc` and `q`, and clears its state. Note-on only. */
export function setFilter(k, s, index, fc, q) {
  svfCoefficients(k.svfCoef, s * 12 + index * 4, fc, q, k.fs);
  k.svfState[s * 6 + index * 2] = 0;
  k.svfState[s * 6 + index * 2 + 1] = 0;
}

/** One sample of SVF `index` of slot `s` in `mode`. */
export function filter(k, s, index, x, mode) {
  return svfTick(x, k.svfCoef, s * 12 + index * 4, k.svfState, s * 6 + index * 2, mode);
}
