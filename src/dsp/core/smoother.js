/*
 * One-pole parameter smoothing (a3-audio-implementation.md, Real-time rules 8):
 * y += a·(x − y), a = 1 − exp(−1/(τ·fs)), computed once at construction.
 */
import { SMOOTH_TAU_S } from './constants.js';

/** Smoothing coefficient for sample rate `fs` (Hz) and time constant `tauS` (s). */
export function smoothingCoeff(fs, tauS = SMOOTH_TAU_S) {
  return 1 - Math.exp(-1 / (tauS * fs));
}

/** Gap below which a smoother is treated as settled and snaps to its target. */
const SETTLE = 1e-12;

/** A smoothed value. next() advances one frame; it never allocates. */
export class Smoother {
  /**
   * @param {number} fs sample rate, Hz
   * @param {number} value initial value (also the initial target)
   * @param {number} [tauS] time constant, s (default 12 ms)
   */
  constructor(fs, value = 0, tauS = SMOOTH_TAU_S) {
    this.a = smoothingCoeff(fs, tauS);
    this.y = value;
    this.target = value;
  }

  /** Sets the value to move toward. */
  setTarget(x) {
    this.target = x;
  }

  /** Jumps to `x` with no ramp (initialisation and resets only). */
  snap(x) {
    this.y = x;
    this.target = x;
  }

  /** Advances one frame and returns the new value. */
  next() {
    this.y += this.a * (this.target - this.y);
    return this.y;
  }

  /** True when the value has reached its target. */
  settled() {
    return this.y === this.target;
  }

  /** Block-end flush: snaps to the target once the gap is negligible, so no denormals accumulate. */
  flush() {
    const d = this.target - this.y;
    if (d < SETTLE && d > -SETTLE) this.y = this.target;
  }
}
