/*
 * Metronome click (a3-audio-implementation.md, Metronome): a 1500 Hz sine on
 * the downbeat, 1000 Hz on other beats, 30 ms exponential decay, −12 dB
 * relative to the master. The sine comes from a rotation recurrence, so the
 * per-sample loop calls no transcendental function.
 */
import { dbToGain } from '../core/math.js';

export const CLICK_ACCENT_HZ = 1500;
export const CLICK_BEAT_HZ = 1000;
export const CLICK_DECAY_S = 0.03;
export const CLICK_LEVEL_DB = -12;

/** Envelope level below which a click is finished. */
const CLICK_END = 1e-5;

export class Metronome {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.fs = fs;
    this.decay = Math.exp(-1 / (CLICK_DECAY_S * fs));
    this.level = dbToGain(CLICK_LEVEL_DB);
    this.accentCos = Math.cos((2 * Math.PI * CLICK_ACCENT_HZ) / fs);
    this.accentSin = Math.sin((2 * Math.PI * CLICK_ACCENT_HZ) / fs);
    this.beatCos = Math.cos((2 * Math.PI * CLICK_BEAT_HZ) / fs);
    this.beatSin = Math.sin((2 * Math.PI * CLICK_BEAT_HZ) / fs);
    this.reset();
  }

  /** Silences any click in progress. */
  reset() {
    this.env = 0;
    this.s = 0;
    this.c = 1;
    this.cosw = this.beatCos;
    this.sinw = this.beatSin;
  }

  /** Starts a click; `accent` selects the downbeat pitch. `gain` scales the click level (linear). */
  trigger(accent, gain = 1) {
    this.cosw = accent ? this.accentCos : this.beatCos;
    this.sinw = accent ? this.accentSin : this.beatSin;
    this.s = 0;
    this.c = 1;
    this.env = this.level * gain;
  }

  /**
   * Adds the click to frames [start, end) of both channels. The click ends at
   * the first sample whose envelope is below CLICK_END, whatever the block size.
   */
  render(bufL, bufR, start, end) {
    let env = this.env;
    if (env < CLICK_END) return;
    let s = this.s;
    let c = this.c;
    const cw = this.cosw;
    const sw = this.sinw;
    const d = this.decay;
    for (let i = start; i < end; i++) {
      if (env < CLICK_END) {
        env = 0;
        break;
      }
      const y = s * env;
      bufL[i] += y;
      bufR[i] += y;
      const ns = s * cw + c * sw;
      c = c * cw - s * sw;
      s = ns;
      env *= d;
    }
    this.s = s;
    this.c = c;
    this.env = env;
  }
}
