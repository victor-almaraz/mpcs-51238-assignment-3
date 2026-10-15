/*
 * Sustained-level duck (a3-audio-implementation.md, Stage order). A ring of
 * block mean-squares covers 3 s. When its RMS exceeds −12 dBFS (0.2512), gain
 * ramps to 0.5 (−6 dB) over 50 ms and stays there until acknowledge(); then it
 * ramps back to 1 over 50 ms and measuring restarts from an empty window.
 */
import { BLOCK } from '../core/constants.js';
import { Ring } from '../core/ring.js';

export const DUCK_WINDOW_S = 3;
export const DUCK_THRESHOLD = 0.2512; // −12 dBFS RMS
export const DUCK_GAIN = 0.5; // −6 dB
export const DUCK_RAMP_S = 0.05;

/** Running-sum recomputation interval, in pushes (bounds rounding drift). */
const RESUM_EVERY = 1024;

export class SustainedLevelDuck {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.ring = new Ring(Math.ceil((DUCK_WINDOW_S * fs) / BLOCK));
    this.thresholdSq = DUCK_THRESHOLD * DUCK_THRESHOLD;
    this.step = (1 - DUCK_GAIN) / Math.round(DUCK_RAMP_S * fs);
    this.reset();
  }

  /** Clears the measurement window and restores full gain. */
  reset() {
    this.ring.clear();
    this.pushes = 0;
    this.active = false;
    this.gain = 1;
    this.changed = false; // set when `active` changes; cleared by the caller
  }

  /** Releases the duck after the user acknowledges it. */
  acknowledge() {
    if (!this.active) return;
    this.active = false;
    this.changed = true;
    this.ring.clear();
    this.pushes = 0;
  }

  /** Measures frames [start, end) and applies the duck gain in place. */
  process(bufL, bufR, start, end) {
    let sq = 0;
    for (let i = start; i < end; i++) sq += bufL[i] * bufL[i] + bufR[i] * bufR[i];
    const n = end - start;
    if (n > 0 && !this.active) {
      this.ring.push(sq / (2 * n));
      if (++this.pushes % RESUM_EVERY === 0) this.ring.resum();
      if (this.ring.size === this.ring.capacity && this.ring.sum / this.ring.size > this.thresholdSq) {
        this.active = true;
        this.changed = true;
      }
    }
    const target = this.active ? DUCK_GAIN : 1;
    let g = this.gain;
    if (g === target) {
      if (g !== 1) for (let i = start; i < end; i++) { bufL[i] *= g; bufR[i] *= g; }
      return;
    }
    const step = target < g ? -this.step : this.step;
    for (let i = start; i < end; i++) {
      if (g !== target) {
        g += step;
        if ((step < 0 && g < target) || (step > 0 && g > target)) g = target;
      }
      bufL[i] *= g;
      bufR[i] *= g;
    }
    this.gain = g;
  }
}
