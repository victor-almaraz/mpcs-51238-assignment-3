/*
 * Snare: damped sines at f and 1.94f with body T60 = 0.6·T60; noise through an
 * SVF highpass at 1.2 kHz (Q 0.7) with its own T60. Tone mixes body (0) and
 * noise (1); velocity scales the noise by 0.7 + 0.3v. fBase 173 Hz, T60 250 ms.
 */
import { sineAt } from '../../core/tables.js';
import { HIGHPASS } from '../../effects/svf.js';
import { decayFactor, filter, setFilter } from './shared.js';

export const SNARE_BASE_HZ = 173;
export const SNARE_T60 = 0.25;

export function start(k, s, f, t60Scale, tone, v) {
  const fs = k.fs;
  const t60 = SNARE_T60 * t60Scale;
  k.ph[s * 8] = 0;
  k.ph[s * 8 + 1] = 0;
  k.inc[s * 8] = f / fs;
  k.inc[s * 8 + 1] = (1.94 * f) / fs;
  k.e1[s] = 1;
  k.g1[s] = decayFactor(0.6 * t60, fs);
  k.e2[s] = 1;
  k.g2[s] = decayFactor(t60, fs);
  setFilter(k, s, 0, 1200, 0.7);
  k.par1[s] = 1 - tone; // body
  k.par2[s] = tone * (0.7 + 0.3 * v); // noise
}

export function tick(k, s) {
  const i = s * 8;
  const body = 0.5 * (sineAt(k.ph[i]) + sineAt(k.ph[i + 1])) * k.e1[s];
  let a = k.ph[i] + k.inc[i];
  if (a >= 1) a -= 1;
  k.ph[i] = a;
  let b = k.ph[i + 1] + k.inc[i + 1];
  if (b >= 1) b -= 1;
  k.ph[i + 1] = b;
  const noise = filter(k, s, 0, k.rng[s].nextBipolar(), HIGHPASS) * k.e2[s];
  k.e1[s] *= k.g1[s];
  k.e2[s] *= k.g2[s];
  return 0.8 * (k.par1[s] * body + k.par2[s] * noise);
}

export function level(k, s) {
  return k.e1[s] > k.e2[s] ? k.e1[s] : k.e2[s];
}
