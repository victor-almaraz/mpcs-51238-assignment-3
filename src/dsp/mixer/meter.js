/*
 * Meter accumulators (a3-audio-implementation.md, Mixer and metering): sample
 * peak and mean square per channel over one report window, for each track and
 * the master. The UI applies peak hold and fall. Readings go into one
 * preallocated Float32Array of [peakL, peakR, meanSquareL, meanSquareR] per
 * target, posted with every `pos` report.
 */

export const METER_FIELDS = 4;

export class MeterBank {
  /** @param {number} targets tracks plus master */
  constructor(targets) {
    this.targets = targets;
    this.peak = new Float64Array(2 * targets);
    this.sum = new Float64Array(2 * targets);
    this.frames = 0;
    this.out = new Float32Array(METER_FIELDS * targets);
  }

  /** Accumulates frames [start, end) of a stereo signal for target `t`. */
  add(t, bufL, bufR, start, end) {
    let pl = this.peak[2 * t];
    let pr = this.peak[2 * t + 1];
    let sl = 0;
    let sr = 0;
    for (let i = start; i < end; i++) {
      const l = bufL[i];
      const r = bufR[i];
      const al = l < 0 ? -l : l;
      const ar = r < 0 ? -r : r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      sl += l * l;
      sr += r * r;
    }
    this.peak[2 * t] = pl;
    this.peak[2 * t + 1] = pr;
    this.sum[2 * t] += sl;
    this.sum[2 * t + 1] += sr;
  }

  /** Counts frames of the current window (once per span, after every target is added). */
  count(frames) {
    this.frames += frames;
  }

  /** Writes the window's readings into `out`, resets the window and returns `out`. */
  read(activeTargets = this.targets) {
    const n = this.frames > 0 ? this.frames : 1;
    for (let t = 0; t < this.targets; t++) {
      const o = METER_FIELDS * t;
      const used = t < activeTargets || t === this.targets - 1;
      this.out[o] = used ? this.peak[2 * t] : 0;
      this.out[o + 1] = used ? this.peak[2 * t + 1] : 0;
      this.out[o + 2] = used ? this.sum[2 * t] / n : 0;
      this.out[o + 3] = used ? this.sum[2 * t + 1] / n : 0;
    }
    this.peak.fill(0);
    this.sum.fill(0);
    this.frames = 0;
    return this.out;
  }
}
