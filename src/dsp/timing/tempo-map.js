/*
 * Tempo map (transport-and-timing.md, a3-audio-implementation.md "Tempo map").
 * Converts integer ticks to seconds and frames and back. Segments are 'step'
 * (constant tempo) or 'linear' (tempo ramps linearly in ticks to the next
 * point; a linear last point is constant).
 *
 * Seconds at tick x in a segment from tick x₀ (second s₀), tempo b₀ → b₁ over L ticks:
 *   constant: s = s₀ + 60·(x − x₀)/(PPQ·b₀)
 *   linear:   s = s₀ + 60·L/(PPQ·(b₁ − b₀))·ln(b(x)/b₀), b(x) = b₀ + (b₁ − b₀)·(x − x₀)/L
 * Event frame = floor(s·fs). Construction allocates; lookups do not.
 */
import { PPQ } from '../core/constants.js';

/** Tempo limits, in BPM (project limit). */
export const BPM_MIN = 20;
export const BPM_MAX = 999;

/** Absorbs float error in s·fs so exact frame boundaries do not floor one frame low. */
const FRAME_EPSILON = 1e-7;

export class TempoMap {
  /**
   * @param {{ tick: number, bpm: number, shape: 'step' | 'linear' }[]} points sorted, first at tick 0;
   *   bpm is clamped to [20, 999]
   * @param {number} fs sample rate, Hz
   */
  constructor(points, fs) {
    if (!Array.isArray(points) || points.length === 0) throw new Error('Tempo map needs at least one point');
    if (points[0].tick !== 0) throw new Error('The first tempo point must be at tick 0');
    if (!(fs > 0)) throw new Error('Tempo map needs a sample rate');
    const n = points.length;
    this.fs = fs;
    this.count = n;
    this.ticks = new Float64Array(n);
    this.seconds = new Float64Array(n);
    this.bpm0 = new Float64Array(n);
    this.bpm1 = new Float64Array(n);
    this.lengths = new Float64Array(n); // ticks to the next point; Infinity for the last
    for (let i = 0; i < n; i++) {
      const p = points[i];
      if (!Number.isInteger(p.tick) || p.tick < 0) throw new Error(`Tempo point ${i}: tick must be a non-negative integer`);
      if (i > 0 && p.tick <= points[i - 1].tick) throw new Error(`Tempo point ${i}: ticks must increase`);
      if (p.shape !== 'step' && p.shape !== 'linear') throw new Error(`Tempo point ${i}: unknown shape ${p.shape}`);
      this.ticks[i] = p.tick;
      this.bpm0[i] = clampBpm(p.bpm);
    }
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      this.lengths[i] = last ? Infinity : this.ticks[i + 1] - this.ticks[i];
      this.bpm1[i] = !last && points[i].shape === 'linear' ? this.bpm0[i + 1] : this.bpm0[i];
      if (i > 0) this.seconds[i] = this.seconds[i - 1] + this.#segmentSeconds(i - 1, this.lengths[i - 1]);
    }
  }

  /** Seconds from the start of segment `i` to `dx` ticks into it. */
  #segmentSeconds(i, dx) {
    const b0 = this.bpm0[i];
    const b1 = this.bpm1[i];
    if (b1 === b0) return (60 * dx) / (PPQ * b0);
    const L = this.lengths[i];
    const b = b0 + ((b1 - b0) * dx) / L;
    return ((60 * L) / (PPQ * (b1 - b0))) * Math.log(b / b0);
  }

  /** Index of the segment containing tick `x` (binary search). */
  #segmentForTick(x) {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.ticks[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Index of the segment containing time `s` seconds (binary search). */
  #segmentForSeconds(s) {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.seconds[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Seconds at tick `x` (x ≥ 0; fractional ticks are allowed here). */
  secondsAt(x) {
    const i = this.#segmentForTick(x);
    return this.seconds[i] + this.#segmentSeconds(i, x - this.ticks[i]);
  }

  /** Tempo in BPM at tick `x`. */
  bpmAt(x) {
    const i = this.#segmentForTick(x);
    const b0 = this.bpm0[i];
    const b1 = this.bpm1[i];
    return b1 === b0 ? b0 : b0 + ((b1 - b0) * (x - this.ticks[i])) / this.lengths[i];
  }

  /** Frame of integer tick `tick`: floor(secondsAt(tick)·fs). */
  frameAt(tick) {
    return Math.floor(this.secondsAt(tick) * this.fs + FRAME_EPSILON);
  }

  /** Fractional tick at time `s` seconds (closed-form inverse within the segment). */
  tickAtSeconds(s) {
    const i = this.#segmentForSeconds(s);
    const ds = s - this.seconds[i];
    const b0 = this.bpm0[i];
    const b1 = this.bpm1[i];
    if (b1 === b0) return this.ticks[i] + (ds * PPQ * b0) / 60;
    const L = this.lengths[i];
    const b = b0 * Math.exp((ds * PPQ * (b1 - b0)) / (60 * L));
    return this.ticks[i] + ((b - b0) * L) / (b1 - b0);
  }

  /**
   * The largest integer tick whose frame is ≤ `frame` (frame ≥ 0). When every
   * tick has its own frame (frames per tick ≥ 1, i.e. fs ≥ 16 kHz at 999 BPM),
   * tickAt(frameAt(t)) === t.
   */
  tickAt(frame) {
    let t = Math.floor(this.tickAtSeconds((frame + 1) / this.fs));
    if (t < 0) t = 0;
    while (t > 0 && this.frameAt(t) > frame) t--;
    while (this.frameAt(t + 1) <= frame) t++;
    return t;
  }
}

function clampBpm(bpm) {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) throw new Error('Tempo must be a finite number');
  return bpm < BPM_MIN ? BPM_MIN : bpm > BPM_MAX ? BPM_MAX : bpm;
}
