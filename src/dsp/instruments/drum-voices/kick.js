/*
 * Kick: damped sine from phase 0 with a pitch envelope A = 1.5·(0.75 + 0.25v),
 * τp 6 ms, driven ×3 into the soft clip x(27 + x²)/(27 + 9x²); a 1 ms noise
 * click through a one-pole lowpass at 3 kHz. Tone sets the click level 0–0.5.
 * fBase 50 Hz, base T60 600 ms. The drive keeps the peak at 1 and lifts the
 * body about 4 dB RMS (the tail 9.5 dB): a 50 Hz sine sounds quieter than the
 * voices above it, and its added harmonics carry on small speakers.
 */
import { sineAt } from '../../core/tables.js';
import { decayFactor, onePoleCoeff, pitchFactor } from './shared.js';

export const KICK_BASE_HZ = 50;
export const KICK_T60 = 0.6;
const DRIVE = 3;

/** Rational tanh approximation: rises monotonically from 0 to 1 at |x| = 3, which DRIVE never exceeds. */
const softClip = (x) => (x * (27 + x * x)) / (27 + 9 * x * x);

export function start(k, s, f, t60Scale, tone, v) {
  const fs = k.fs;
  k.ph[s * 8] = 0;
  k.inc[s * 8] = f / fs;
  k.p[s] = 1;
  k.gp[s] = pitchFactor(0.006, fs);
  k.A[s] = 1.5 * (0.75 + 0.25 * v);
  k.e1[s] = 1;
  k.g1[s] = decayFactor(KICK_T60 * t60Scale, fs);
  k.lp[s] = 0;
  k.lpA[s] = onePoleCoeff(3000, fs);
  k.par1[s] = 0.5 * tone * v; // click level
  k.par2[s] = Math.round(0.001 * fs); // click length, frames
}

export function tick(k, s) {
  const i = s * 8;
  const y = softClip(DRIVE * sineAt(k.ph[i]) * k.e1[s]);
  let ph = k.ph[i] + k.inc[i] * (1 + k.A[s] * k.p[s]);
  if (ph >= 1) ph -= 1;
  k.ph[i] = ph;
  k.p[s] *= k.gp[s];
  k.e1[s] *= k.g1[s];
  let click = 0;
  if (k.age[s] < k.par2[s]) {
    k.lp[s] += k.lpA[s] * (k.rng[s].nextBipolar() - k.lp[s]);
    click = k.lp[s] * k.par1[s];
  }
  return y + click;
}

export function level(k, s) {
  return k.age[s] < k.par2[s] ? 1 : k.e1[s];
}
