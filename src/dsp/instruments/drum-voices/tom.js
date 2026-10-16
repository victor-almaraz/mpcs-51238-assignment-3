/*
 * Toms: damped sine with a pitch envelope A = 0.26, τp 10 ms; noise through a
 * one-pole lowpass at 2 kHz with T60 40 ms at a level tone sets from 0 to 0.3.
 * fBase 90, 135, 185 Hz; base T60 600, 390, 300 ms (low, mid, high).
 */
import { sineAt } from '../../core/tables.js';
import { HIGH_TOM, LOW_TOM, MID_TOM } from '../drum-map.js';
import { decayFactor, onePoleCoeff, pitchFactor } from './shared.js';

export const TOM_BASE_HZ = { [LOW_TOM]: 90, [MID_TOM]: 135, [HIGH_TOM]: 185 };
export const TOM_T60 = { [LOW_TOM]: 0.6, [MID_TOM]: 0.39, [HIGH_TOM]: 0.3 };

export function start(k, s, f, t60Scale, tone, v, voice) {
  const fs = k.fs;
  k.ph[s * 8] = 0;
  k.inc[s * 8] = f / fs;
  k.p[s] = 1;
  k.gp[s] = pitchFactor(0.01, fs);
  k.A[s] = 0.26;
  k.e1[s] = 1;
  k.g1[s] = decayFactor(TOM_T60[voice] * t60Scale, fs);
  k.e2[s] = 1;
  k.g2[s] = decayFactor(0.04, fs);
  k.lp[s] = 0;
  k.lpA[s] = onePoleCoeff(2000, fs);
  k.par1[s] = 0.3 * tone;
}

export function tick(k, s) {
  const i = s * 8;
  const y = sineAt(k.ph[i]) * k.e1[s];
  let ph = k.ph[i] + k.inc[i] * (1 + k.A[s] * k.p[s]);
  if (ph >= 1) ph -= 1;
  k.ph[i] = ph;
  k.p[s] *= k.gp[s];
  k.lp[s] += k.lpA[s] * (k.rng[s].nextBipolar() - k.lp[s]);
  const noise = k.lp[s] * k.e2[s] * k.par1[s];
  k.e1[s] *= k.g1[s];
  k.e2[s] *= k.g2[s];
  return y + noise;
}

export function level(k, s) {
  return k.e1[s];
}
