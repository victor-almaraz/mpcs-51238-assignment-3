/*
 * Look-ahead sample-peak limiter (a3-audio-implementation.md, Limiter).
 * Ceiling c = 0.8913 (−1 dBFS); look-ahead L = ceil(0.0015·fs) frames.
 *   1. Required gain r[n] = min(1, c / max(|l|, |r|, 1e-12)).
 *   2. Sliding minimum of r over the last L frames (monotonic deque of indices).
 *   3. Boxcar average of that minimum over L frames (running sum, recomputed
 *      every 4096 frames to bound drift).
 *   4. Release: env = gs < env ? gs : env + (gs − env)·αrel, τ 50 ms.
 *   5. y[n] = x[n − (L − 1)]·env. Added latency: L − 1 frames.
 * Every minimum averaged at frame n covers the delayed sample, so the gain
 * applied never exceeds the gain that sample needs.
 */
import { Deque, Ring } from '../core/ring.js';

export const LIMITER_CEILING = 0.8913;

/**
 * The largest float32 value ≤ LIMITER_CEILING. Outputs are Float32Arrays, and
 * 0.8913 itself rounds up to 0.89130002 there, so the final clamp uses this.
 */
export const OUTPUT_CEILING = (() => {
  const f32 = new Float32Array([LIMITER_CEILING]);
  if (f32[0] > LIMITER_CEILING) new Uint32Array(f32.buffer)[0] -= 1;
  return f32[0];
})();
export const LIMITER_LOOKAHEAD_S = 0.0015;
export const LIMITER_RELEASE_S = 0.05;

const RESUM_FRAMES = 4096;

export class Limiter {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.L = Math.ceil(LIMITER_LOOKAHEAD_S * fs);
    this.ceiling = LIMITER_CEILING;
    this.alphaRel = 1 - Math.exp(-1 / (LIMITER_RELEASE_S * fs));
    this.gains = new Float64Array(this.L + 1); // r[n] at n mod (L + 1)
    this.minQueue = new Deque(this.L + 1);      // frame indices with increasing r
    this.boxcar = new Ring(this.L);             // last L sliding minima
    this.D = this.L - 1; // output delay, frames (L ≥ 5 at any browser sample rate)
    this.delayL = new Float32Array(this.D);
    this.delayR = new Float32Array(this.D);
    this.reset();
  }

  /** Clears all state: unity gain, silent delay line. */
  reset() {
    this.n = 0;
    this.env = 1;
    this.gains.fill(1);
    this.minQueue.clear();
    this.boxcar.clear();
    for (let i = 0; i < this.L; i++) this.boxcar.push(1);
    this.boxcar.resum();
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.delayPos = 0;
    this.reduction = 1; // smallest gain applied since the last readReduction()
  }

  /** Returns the smallest gain applied since the previous call and resets it (for meters). */
  readReduction() {
    const g = this.reduction;
    this.reduction = 1;
    return g;
  }

  /** Limits frames [start, end) of both channels in place. */
  process(bufL, bufR, start, end) {
    const L = this.L;
    const D = this.D;
    const cap = L + 1;
    const c = this.ceiling;
    const gains = this.gains;
    const q = this.minQueue;
    const box = this.boxcar;
    const dl = this.delayL;
    const dr = this.delayR;
    const invL = 1 / L;
    let env = this.env;
    let n = this.n;
    let pos = this.delayPos;
    let reduction = this.reduction;
    for (let i = start; i < end; i++) {
      const l = bufL[i];
      const r = bufR[i];
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      let peak = al > ar ? al : ar;
      if (peak < 1e-12) peak = 1e-12;
      const need = c / peak < 1 ? c / peak : 1;
      gains[n % cap] = need;
      while (q.size > 0 && gains[q.back() % cap] >= need) q.popBack();
      q.pushBack(n);
      if (q.front() <= n - L) q.popFront();
      box.push(gains[q.front() % cap]);
      if (n % RESUM_FRAMES === 0) box.resum();
      const gs = box.sum * invL;
      env = gs < env ? gs : env + (gs - env) * this.alphaRel;
      // Reading before writing a D-frame ring yields x[n − D] = x[n − (L − 1)].
      const outL = dl[pos];
      const outR = dr[pos];
      dl[pos] = l;
      dr[pos] = r;
      pos = pos + 1 === D ? 0 : pos + 1;
      bufL[i] = outL * env;
      bufR[i] = outR * env;
      if (env < reduction) reduction = env;
      n++;
    }
    this.env = env;
    this.n = n;
    this.delayPos = pos;
    this.reduction = reduction;
  }
}
