/*
 * Clap: noise through an SVF bandpass (Q 2) centred 700–2000 Hz by tone
 * (× the tune ratio). Burst spacing S = 10 ms:
 *   t < 3S: the burst envelope restarts to 1 at 0, S, 2S and decays with T60 9 ms;
 *   t = 3S: the burst envelope is 1 and decays with T60 20 ms;
 *   always: a tail envelope starts at 0.35 and decays with the voice T60.
 *   out = bandpass(noise) × (burst + tail). Base T60 300 ms.
 */
import { BANDPASS } from '../../effects/svf.js';
import { decayFactor, filter, setFilter, toneLog } from './shared.js';

export const CLAP_T60 = 0.3;
const SPACING_S = 0.01;

export function start(k, s, f, t60Scale, tone) {
  const fs = k.fs;
  setFilter(k, s, 0, toneLog(tone, 700, 2000) * (f / 1000), 2);
  k.e1[s] = 1; // burst
  k.g1[s] = decayFactor(0.009, fs);
  k.g2[s] = decayFactor(0.02, fs); // final burst
  k.e3[s] = 0.35; // tail
  k.g3[s] = decayFactor(CLAP_T60 * t60Scale, fs);
  k.par2[s] = Math.round(SPACING_S * fs);
}

export function tick(k, s) {
  const age = k.age[s];
  const S = k.par2[s];
  if (age === S || age === 2 * S || age === 3 * S) k.e1[s] = 1;
  const x = filter(k, s, 0, k.rng[s].nextBipolar(), BANDPASS);
  const y = x * (k.e1[s] + k.e3[s]);
  k.e1[s] *= age >= 3 * S ? k.g2[s] : k.g1[s];
  k.e3[s] *= k.g3[s];
  return 1.2 * y;
}

export function level(k, s) {
  if (k.age[s] <= 3 * k.par2[s]) return 1;
  return k.e1[s] > k.e3[s] ? k.e1[s] : k.e3[s];
}
