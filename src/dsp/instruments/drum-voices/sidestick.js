/*
 * Side stick: damped sines at f and 3.66f, summed through an SVF highpass whose
 * corner tone sets from 300 to 1500 Hz. fBase 455 Hz, base T60 30 ms.
 */
import { sineAt } from '../../core/tables.js';
import { HIGHPASS } from '../../effects/svf.js';
import { decayFactor, filter, setFilter, toneLog } from './shared.js';

export const SIDESTICK_BASE_HZ = 455;
export const SIDESTICK_T60 = 0.03;

export function start(k, s, f, t60Scale, tone) {
  const fs = k.fs;
  k.ph[s * 8] = 0;
  k.ph[s * 8 + 1] = 0;
  k.inc[s * 8] = f / fs;
  k.inc[s * 8 + 1] = (3.66 * f) / fs;
  k.e1[s] = 1;
  k.g1[s] = decayFactor(SIDESTICK_T60 * t60Scale, fs);
  setFilter(k, s, 0, toneLog(tone, 300, 1500), 0.7071);
}

export function tick(k, s) {
  const i = s * 8;
  const x = 0.5 * (sineAt(k.ph[i]) + sineAt(k.ph[i + 1])) * k.e1[s];
  let a = k.ph[i] + k.inc[i];
  if (a >= 1) a -= 1;
  k.ph[i] = a;
  let b = k.ph[i + 1] + k.inc[i + 1];
  if (b >= 1) b -= 1;
  k.ph[i + 1] = b;
  k.e1[s] *= k.g1[s];
  return 1.5 * filter(k, s, 0, x, HIGHPASS);
}

export function level(k, s) {
  return k.e1[s];
}
