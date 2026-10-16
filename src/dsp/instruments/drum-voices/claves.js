/*
 * Claves: damped sine from phase 0 at 2500 Hz, base T60 75 ms. Tone sets a
 * pitch drop of 0–2 semitones: the pitch starts that far above f and falls to
 * f with τp 5 ms.
 */
import { sineAt } from '../../core/tables.js';
import { decayFactor, pitchFactor } from './shared.js';

export const CLAVES_BASE_HZ = 2500;
export const CLAVES_T60 = 0.075;

export function start(k, s, f, t60Scale, tone) {
  const fs = k.fs;
  k.ph[s * 8] = 0;
  k.inc[s * 8] = f / fs;
  k.p[s] = 1;
  k.gp[s] = pitchFactor(0.005, fs);
  k.A[s] = 2 ** ((2 * tone) / 12) - 1;
  k.e1[s] = 1;
  k.g1[s] = decayFactor(CLAVES_T60 * t60Scale, fs);
}

export function tick(k, s) {
  const i = s * 8;
  const y = sineAt(k.ph[i]) * k.e1[s];
  let ph = k.ph[i] + k.inc[i] * (1 + k.A[s] * k.p[s]);
  if (ph >= 1) ph -= 1;
  k.ph[i] = ph;
  k.p[s] *= k.gp[s];
  k.e1[s] *= k.g1[s];
  return y;
}

export function level(k, s) {
  return k.e1[s];
}
