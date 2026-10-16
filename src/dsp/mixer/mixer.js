/*
 * Channel strips (a3-audio-implementation.md, Mixer and metering;
 * mixer-and-routing.md): per track, source → gain (−∞ to +6 dB, smoothed) →
 * pan (constant power for mono sources, balance for stereo) → mute/solo gate
 * (smoothed over 5 ms) → master bus. Solo is solo-in-place:
 * audible = !mute && (anySolo ? solo : true).
 */
import { dbToGain } from '../core/math.js';
import { clampParam, defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { balance, constantPower } from './pan.js';

/** Track fader, dB; the minimum means −∞ (silence). */
export const TRACK_GAIN = defineParam({ id: 'gainDb', min: -60, max: 6, default: 0, unit: 'dB', scale: 'lin', step: 0.1 });

/** Pan for tracks and the master: −1 full left to +1 full right. */
export const PAN = defineParam({ id: 'pan', min: -1, max: 1, default: 0, unit: 'pan', scale: 'lin', step: 0.01 });

/** Mute/solo gate time constant, seconds (project limit). */
export const GATE_TAU_S = 0.005;

/** Linear gain of fader `db`; the fader minimum is −∞ dB. */
export function faderGain(db) {
  return db <= TRACK_GAIN.min ? 0 : dbToGain(db);
}

export class ChannelStrip {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.gain = new Smoother(fs, 1);
    this.pan = new Smoother(fs, 0);
    this.gate = new Smoother(fs, 1, GATE_TAU_S);
    this.mute = false;
    this.solo = false;
    this.panGains = new Float64Array(2);
    this.balanceGains = new Float64Array(2);
  }

  setGainDb(db) {
    this.gain.setTarget(faderGain(clampParam(TRACK_GAIN, db)));
  }

  setPan(p) {
    this.pan.setTarget(clampParam(PAN, p));
  }

  /** Sets the gate target from mute and solo states (`anySolo` across all tracks). */
  updateGate(anySolo) {
    this.gate.setTarget(!this.mute && (anySolo ? this.solo : true) ? 1 : 0);
  }

  /**
   * Applies gain, pan and gate to `n` frames of the track signal and adds the
   * result into the bus at `off`. Mono sources arrive in `srcL` only.
   * `outL`/`outR` also receive the post-strip signal for metering.
   */
  mix(srcL, srcR, stereo, n, busL, busR, off, outL, outR) {
    // Pan gains once per block from the pan smoothed over the block.
    for (let i = 0; i < n; i++) this.pan.next();
    if (stereo) balance(this.pan.y, this.panGains);
    else constantPower(this.pan.y, this.panGains);
    const pl = this.panGains[0];
    const pr = this.panGains[1];
    const gain = this.gain;
    const gate = this.gate;
    for (let i = 0; i < n; i++) {
      const g = gain.next() * gate.next();
      const l = srcL[i];
      const r = stereo ? srcR[i] : srcL[i];
      const yl = l * g * pl;
      const yr = r * g * pr;
      outL[i] = yl;
      outR[i] = yr;
      busL[off + i] += yl;
      busR[off + i] += yr;
    }
    gain.flush();
    this.pan.flush();
    gate.flush();
  }

  /**
   * Audio tracks: like mix(), for a track whose mono clips arrive in `mono`
   * (constant-power pan) and stereo clips in `srcL`/`srcR` (balance).
   */
  mixAudio(mono, srcL, srcR, n, busL, busR, off, outL, outR) {
    for (let i = 0; i < n; i++) this.pan.next();
    constantPower(this.pan.y, this.panGains);
    balance(this.pan.y, this.balanceGains);
    const cl = this.panGains[0];
    const cr = this.panGains[1];
    const bl = this.balanceGains[0];
    const br = this.balanceGains[1];
    const gain = this.gain;
    const gate = this.gate;
    for (let i = 0; i < n; i++) {
      const g = gain.next() * gate.next();
      const m = mono[i];
      const yl = (m * cl + srcL[i] * bl) * g;
      const yr = (m * cr + srcR[i] * br) * g;
      outL[i] = yl;
      outR[i] = yr;
      busL[off + i] += yl;
      busR[off + i] += yr;
    }
    gain.flush();
    this.pan.flush();
    gate.flush();
  }
}
