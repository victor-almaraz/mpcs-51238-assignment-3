/*
 * Meter map (transport-and-timing.md): time signatures placed at bar
 * boundaries. Ticks per bar = numerator·PPQ·4/denominator. Bars and beats are
 * 0-based here; display code adds 1. Construction allocates; lookups do not.
 */
import { PPQ } from '../core/constants.js';

export const DENOMINATORS = [1, 2, 4, 8, 16, 32];
export const NUMERATOR_MAX = 32;

export class MeterMap {
  /**
   * @param {{ tick: number, numerator: number, denominator: number }[]} points sorted,
   *   first at tick 0, each later point on a bar boundary of the meter before it
   */
  constructor(points) {
    if (!Array.isArray(points) || points.length === 0) throw new Error('Meter map needs at least one point');
    if (points[0].tick !== 0) throw new Error('The first meter point must be at tick 0');
    const n = points.length;
    this.count = n;
    this.ticks = new Float64Array(n);
    this.bars = new Float64Array(n); // bar index where each meter starts
    this.barTicks = new Float64Array(n);
    this.beatTicks = new Float64Array(n);
    this.numerators = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const { tick, numerator, denominator } = points[i];
      if (!Number.isInteger(numerator) || numerator < 1 || numerator > NUMERATOR_MAX) {
        throw new Error(`Meter point ${i}: numerator must be an integer 1–${NUMERATOR_MAX}`);
      }
      if (!DENOMINATORS.includes(denominator)) throw new Error(`Meter point ${i}: denominator must be a power of 2 up to 32`);
      if (!Number.isInteger(tick)) throw new Error(`Meter point ${i}: tick must be an integer`);
      this.ticks[i] = tick;
      this.numerators[i] = numerator;
      this.beatTicks[i] = (4 * PPQ) / denominator;
      this.barTicks[i] = numerator * this.beatTicks[i];
      if (i > 0) {
        const span = tick - this.ticks[i - 1];
        if (span <= 0 || span % this.barTicks[i - 1] !== 0) {
          throw new Error(`Meter point ${i}: must fall on a later bar boundary`);
        }
        this.bars[i] = this.bars[i - 1] + span / this.barTicks[i - 1];
      }
    }
  }

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

  #segmentForBar(bar) {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.bars[mid] <= bar) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 0-based bar containing tick `x`. */
  barAt(x) {
    const i = this.#segmentForTick(x);
    return this.bars[i] + Math.floor((x - this.ticks[i]) / this.barTicks[i]);
  }

  /** 0-based beat within its bar for tick `x`. */
  beatAt(x) {
    const i = this.#segmentForTick(x);
    const inBar = (x - this.ticks[i]) % this.barTicks[i];
    return Math.floor(inBar / this.beatTicks[i]);
  }

  /** Ticks into the current beat for tick `x`. */
  tickInBeat(x) {
    const i = this.#segmentForTick(x);
    return ((x - this.ticks[i]) % this.barTicks[i]) % this.beatTicks[i];
  }

  /** Tick where 0-based bar `bar` starts. */
  tickAtBar(bar) {
    const i = this.#segmentForBar(bar);
    return this.ticks[i] + (bar - this.bars[i]) * this.barTicks[i];
  }

  /** Ticks per bar of the meter at tick `x`. */
  barTicksAt(x) {
    return this.barTicks[this.#segmentForTick(x)];
  }

  /** Ticks per beat of the meter at tick `x`. */
  beatTicksAt(x) {
    return this.beatTicks[this.#segmentForTick(x)];
  }

  /** Beats per bar of the meter at tick `x`. */
  beatsPerBarAt(x) {
    return this.numerators[this.#segmentForTick(x)];
  }
}
