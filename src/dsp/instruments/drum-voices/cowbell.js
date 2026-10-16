/*
 * Cowbell: two PolyBLEP squares at 540·r and 800·r Hz through an SVF bandpass
 * (Q 4.8) centred 700–1100 Hz by tone (× r); envelope 0.6·(T60 25 ms) + 0.4·(T60).
 * r = 2^(tune/12); base T60 150 ms.
 */
import { BANDPASS } from '../../effects/svf.js';
import { square } from '../polyblep.js';
import { decayFactor, filter, setFilter, toneLog } from './shared.js';

export const COWBELL_T60 = 0.15;

export function start(k, s, f, t60Scale, tone) {
  const fs = k.fs;
  const r = f;
  k.ph[s * 8] = 0;
  k.ph[s * 8 + 1] = 0;
  k.inc[s * 8] = (540 * r) / fs;
  k.inc[s * 8 + 1] = (800 * r) / fs;
  setFilter(k, s, 0, toneLog(tone, 700, 1100) * r, 4.8);
  k.e1[s] = 0.6;
  k.g1[s] = decayFactor(0.025, fs);
  k.e2[s] = 0.4;
  k.g2[s] = decayFactor(COWBELL_T60 * t60Scale, fs);
}

export function tick(k, s) {
  const i = s * 8;
  const x = 0.5 * (square(k.ph[i], k.inc[i]) + square(k.ph[i + 1], k.inc[i + 1]));
  let a = k.ph[i] + k.inc[i];
  if (a >= 1) a -= 1;
  k.ph[i] = a;
  let b = k.ph[i + 1] + k.inc[i + 1];
  if (b >= 1) b -= 1;
  k.ph[i + 1] = b;
  const y = filter(k, s, 0, x, BANDPASS) * (k.e1[s] + k.e2[s]);
  k.e1[s] *= k.g1[s];
  k.e2[s] *= k.g2[s];
  return 0.6 * y;
}

export function level(k, s) {
  return k.e1[s] + k.e2[s];
}
