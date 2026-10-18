/*
 * Amplitude envelopes for a bank of voices, struct-of-arrays
 * (a3-audio-implementation.md, Shared rules): linear attack to 1, then
 * (EnvelopeBank) a hold at 1, or (AdsrBank) a decay toward a sustain level shared
 * by every voice; exponential release to −80 dB over the release time with
 * r = 10^(−4/(release·fs)) computed at note-off; the voice frees below 1e-4.
 * A stolen voice fades out linearly over STEAL_FADE_FRAMES.
 */
import { STEAL_FADE_FRAMES } from '../core/constants.js';

export const IDLE = 0;
export const ATTACK = 1;
export const SUSTAIN = 2;
export const RELEASE = 3;
export const STEAL = 4;

/** Envelope level below which a releasing voice is free. */
export const ENV_FLOOR = 1e-4;

export class EnvelopeBank {
  /**
   * @param {number} fs sample rate, Hz
   * @param {number} voices number of envelopes
   */
  constructor(fs, voices) {
    this.fs = fs;
    this.stage = new Uint8Array(voices);
    this.level = new Float64Array(voices);
    this.attackStep = new Float64Array(voices);
    this.releaseMul = new Float64Array(voices);
    this.stealStep = new Float64Array(voices);
  }

  /** Starts voice `v` from silence with an attack of `attackS` seconds. */
  start(v, attackS) {
    this.stage[v] = ATTACK;
    this.level[v] = 0;
    this.attackStep[v] = 1 / Math.max(1, attackS * this.fs);
  }

  /** Releases voice `v` over `releaseS` seconds (to −80 dB). */
  release(v, releaseS) {
    const s = this.stage[v];
    if (s === IDLE || s === STEAL || s === RELEASE) return;
    this.stage[v] = RELEASE;
    this.releaseMul[v] = 10 ** (-4 / (Math.max(1, releaseS * this.fs)));
  }

  /** Fades voice `v` out over STEAL_FADE_FRAMES (voice stealing and hard all-notes-off). */
  steal(v, frames = STEAL_FADE_FRAMES) {
    if (this.stage[v] === IDLE) return;
    this.stage[v] = STEAL;
    this.stealStep[v] = this.level[v] / frames;
  }

  /** Advances voice `v` one frame and returns its level; an ended voice turns IDLE and returns 0. */
  next(v) {
    let l = this.level[v];
    switch (this.stage[v]) {
      case ATTACK:
        l += this.attackStep[v];
        if (l >= 1 - 1e-9) {
          l = 1;
          this.stage[v] = SUSTAIN;
        }
        break;
      case RELEASE:
        l *= this.releaseMul[v];
        if (l < ENV_FLOOR) {
          l = 0;
          this.stage[v] = IDLE;
        }
        break;
      case STEAL:
        l -= this.stealStep[v];
        if (l <= 0) {
          l = 0;
          this.stage[v] = IDLE;
        }
        break;
      case SUSTAIN:
        break;
      default:
        return 0;
    }
    this.level[v] = l;
    return l;
  }

  /** True while voice `v` produces sound. */
  active(v) {
    return this.stage[v] !== IDLE;
  }
}

/** Envelope stage after ATTACK: decay toward sustain, then hold there until release. */
export const DECAY = 5;

/** ADSR envelopes: EnvelopeBank with a decay-to-sustain stage shared by every voice. */
export class AdsrBank extends EnvelopeBank {
  /**
   * @param {number} fs sample rate, Hz
   * @param {number} voices number of envelopes
   */
  constructor(fs, voices) {
    super(fs, voices);
    this.sustain = 1;
    this.decayMul = 0;
  }

  /** Sets the decay time in seconds: d = 10^(−4/(decay·fs)), −80 dB toward sustain over that time. */
  setDecay(decayS) {
    this.decayMul = 10 ** (-4 / Math.max(1, decayS * this.fs));
  }

  /** Advances voice `v` one frame and returns its level; an ended voice turns IDLE and returns 0. */
  next(v) {
    const stage = this.stage[v];
    if (stage === ATTACK) {
      let l = this.level[v] + this.attackStep[v];
      if (l >= 1 - 1e-9) {
        l = 1;
        this.stage[v] = DECAY;
      }
      this.level[v] = l;
      return l;
    }
    if (stage === DECAY) {
      const s = this.sustain;
      let l = s + (this.level[v] - s) * this.decayMul;
      if (s === 0 && l < ENV_FLOOR) {
        l = 0;
        this.stage[v] = IDLE;
      }
      this.level[v] = l;
      return l;
    }
    return super.next(v);
  }

  /** Block-end flush: a decay within 1e-15 of sustain snaps to it. */
  flush(v) {
    const d = this.level[v] - this.sustain;
    if (this.stage[v] === DECAY && d < 1e-15 && d > -1e-15) this.level[v] = this.sustain;
  }
}
