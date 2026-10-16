/*
 * Metal voices from six PolyBLEP squares at {205.3, 304.4, 369.6, 522.7, 540,
 * 800} × r × 2^(tune/12) Hz (the TR-808 oscillators), starting at phases drawn
 * from the instance's PRNG.
 *   Hats: bandpass 7100·r Hz (Q 1.5), then a highpass set by tone; 0.3 ms
 *   linear attack. Closed 150 ms, pedal 100 ms at 0.7 level, open 1350 ms.
 *   Crash and ride: bandpass 3440·r Hz (Q 1.2, T60) plus bandpass 7100·r Hz
 *   (Q 1.5, a shorter T60), summed through a highpass; tone balances the bands.
 * Output scales bring every voice to a peak near 1 before velocity and level.
 */
import { BANDPASS, HIGHPASS } from '../../effects/svf.js';
import { square } from '../polyblep.js';
import { CLOSED_HAT, CRASH, OPEN_HAT, PEDAL_HAT, RIDE } from '../drum-map.js';
import { decayFactor, filter, setFilter, toneLog } from './shared.js';

const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];
export const METAL_T60 = { [CLOSED_HAT]: 0.15, [PEDAL_HAT]: 0.1, [OPEN_HAT]: 1.35, [CRASH]: 2.4, [RIDE]: 3.0 };
const RIDE_RATIO = 1.19;

export function start(k, s, f, t60Scale, tone, v, voice) {
  const fs = k.fs;
  const cymbal = voice === CRASH || voice === RIDE;
  const r = (voice === RIDE ? RIDE_RATIO : 1) * f; // f carries 2^(tune/12) for metal voices
  for (let j = 0; j < 6; j++) {
    k.ph[s * 8 + j] = k.rng[s].next();
    k.inc[s * 8 + j] = (METAL_HZ[j] * r) / fs;
  }
  const t60 = METAL_T60[voice] * t60Scale;
  k.e1[s] = 1;
  k.g1[s] = decayFactor(t60, fs);
  if (cymbal) {
    setFilter(k, s, 0, 3440 * r, 1.2);
    setFilter(k, s, 1, 7100 * r, 1.5);
    setFilter(k, s, 2, voice === RIDE ? 5000 : 4000, 0.7071);
    k.e2[s] = 1;
    k.g2[s] = decayFactor((voice === RIDE ? 0.7 : 0.4) * t60, fs);
    k.par1[s] = 2 * (1 - tone); // low band
    k.par2[s] = 2 * tone; // high band
  } else {
    setFilter(k, s, 0, 7100 * r, 1.5);
    setFilter(k, s, 1, voice === OPEN_HAT ? toneLog(tone, 6000, 10000) : toneLog(tone, 7000, 12000), 0.7071);
    k.par1[s] = voice === PEDAL_HAT ? 0.7 : 1;
    k.par2[s] = Math.max(1, Math.round(0.0003 * fs)); // attack, frames
  }
  k.par3[s] = cymbal ? 1 : 0;
}

export function tick(k, s) {
  let sum = 0;
  for (let j = 0; j < 6; j++) {
    const i = s * 8 + j;
    const dt = k.inc[i];
    sum += square(k.ph[i], dt);
    let ph = k.ph[i] + dt;
    if (ph >= 1) ph -= 1;
    k.ph[i] = ph;
  }
  sum *= 1 / 6;
  let y;
  if (k.par3[s] === 1) {
    const lo = filter(k, s, 0, sum, BANDPASS) * k.e1[s] * k.par1[s];
    const hi = filter(k, s, 1, sum, BANDPASS) * k.e2[s] * k.par2[s];
    y = 0.4 * filter(k, s, 2, lo + hi, HIGHPASS);
    k.e2[s] *= k.g2[s];
  } else {
    const attack = k.age[s] < k.par2[s] ? k.age[s] / k.par2[s] : 1;
    y = filter(k, s, 1, filter(k, s, 0, sum, BANDPASS), HIGHPASS) * k.e1[s] * k.par1[s] * attack;
  }
  k.e1[s] *= k.g1[s];
  return 4 * y;
}

export function level(k, s) {
  return k.par3[s] === 1 && k.e2[s] > k.e1[s] ? k.e2[s] : k.e1[s];
}
