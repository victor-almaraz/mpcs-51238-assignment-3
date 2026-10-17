/*
 * Shared voice handling for polyphonic instrument kernels (a3-audio-implementation.md,
 * Shared rules): allocation and stealing, ADSR envelopes, velocity gain
 * 0.3·(vel/127)², polyphony auto-gain min(1, 2/√voices), all-notes-off, and
 * the Octave and Cents tuning (TUNING_PARAMS): notes that start after a change
 * sound 12·octave + cents/100 semitones away, clamped to MIDI 0–127.
 * Subclasses implement:
 *   startVoice(v, pitch, velocity)     per-voice state at note-on
 *   beginBlock(n)                      per-block coefficients for n frames
 *   renderVoice(v, out, start, end)    add voice v (× gain[v] × envelope) into out
 *   endBlock()                         block-end flushes
 * They hold `attack` and `release` in seconds; decay and sustain live on the
 * envelope bank (setEnvelope). Renders mono, overwriting its range.
 */
import { VOICES_PER_INSTRUMENT } from '../core/constants.js';
import { defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { VELOCITY_GAIN } from '../core/tables.js';
import { LIVE_NOTE_BASE } from '../engine/live-input.js';
import { AdsrBank, IDLE } from './envelope.js';
import { VoicePool } from './voice-pool.js';

/** Per-instrument tuning, last in every synth's parameter list. */
export const TUNING_PARAMS = [
  defineParam({ id: 'octave', min: -3, max: 3, default: 0, unit: 'oct', scale: 'lin', step: 1, group: 'Tuning' }),
  defineParam({ id: 'cents', min: -100, max: 100, default: 0, unit: 'cents', scale: 'lin', step: 1, group: 'Tuning' }),
];

/** ADSR decay and sustain shared by the synths (sustain 1 holds the peak: the plain AR shape). */
export const decayParam = (def) => defineParam({ id: 'decay', min: 0.01, max: 4, default: def, unit: 's', scale: 'pow3' });
export const SUSTAIN_PARAM = defineParam({ id: 'sustain', min: 0, max: 1, default: 1, unit: 'fraction', scale: 'lin', step: 0.01 });

export class PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   * @param {number} [cap] held-voice cap
   */
  constructor(fs, global, cap = VOICES_PER_INSTRUMENT) {
    this.fs = fs;
    this.slots = VoicePool.slotsFor(cap);
    this.env = new AdsrBank(fs, this.slots);
    this.pool = new VoicePool(this.env, global, cap);
    this.gain = new Float64Array(this.slots);
    this.polyGain = new Smoother(fs, 1);
    this.attack = 0.01;
    this.release = 0.3;
    this.octave = 0;
    this.cents = 0;
  }

  /**
   * Applies a clamped tuning, decay or sustain value; returns false for other
   * ids. `decay` here is the envelope decay, so Pluck (decay = T60) skips it.
   */
  setShared(id, v) {
    if (id === 'octave') this.octave = v;
    else if (id === 'cents') this.cents = v;
    else if (id === 'decay') this.env.setDecay(v);
    else if (id === 'sustain') this.env.sustain = v;
    else return false;
    return true;
  }

  /** Frequency in Hz of MIDI `pitch` after the tuning shift, clamped to MIDI 0–127 (allocates nothing). */
  noteHz(pitch) {
    const p = pitch + 12 * this.octave + this.cents / 100;
    return 440 * 2 ** (((p < 0 ? 0 : p > 127 ? 127 : p) - 69) / 12);
  }

  /** Starts note `noteId` at MIDI `pitch` (0–127) with `velocity` (1–127). */
  noteOn(noteId, pitch, velocity) {
    const v = this.pool.allocate(noteId);
    if (v < 0) return;
    this.gain[v] = this.velocityGain(velocity);
    this.startVoice(v, pitch, velocity);
    this.env.start(v, this.attack);
  }

  /** Velocity gain 0.3·(vel/127)²; kernels with a velocity-sensitivity control override it. */
  velocityGain(velocity) {
    return VELOCITY_GAIN[velocity];
  }

  /** Starts voice `v`'s release (note-off, soft all-notes-off, transport stop). */
  releaseVoice(v) {
    this.env.release(v, this.release);
  }

  /** Releases note `noteId`; an unknown id is ignored. */
  noteOff(noteId) {
    const v = this.pool.find(noteId);
    if (v < 0) return;
    this.releaseVoice(v);
    this.pool.detach(v);
  }

  /** Releases every voice; `hard` fades them over 64 frames instead (Panic). */
  allNotesOff(hard) {
    for (let v = 0; v < this.slots; v++) {
      if (this.env.stage[v] === IDLE) continue;
      if (hard) this.env.steal(v);
      else this.releaseVoice(v);
      this.pool.detach(v);
    }
  }

  /** Releases held sequenced notes; live notes (IDs from LIVE_NOTE_BASE) keep sounding. */
  releaseSequenced() {
    for (let v = 0; v < this.slots; v++) {
      const id = this.pool.noteId[v];
      if (id < 0 || id >= LIVE_NOTE_BASE || this.env.stage[v] === IDLE) continue;
      this.releaseVoice(v);
      this.pool.detach(v);
    }
  }

  /** Voices producing sound (held, releasing or fading). */
  activeVoices() {
    return this.pool.sounding();
  }

  /** Renders frames [start, end) into `out`, overwriting them. */
  render(out, start, end) {
    out.fill(0, start, end);
    this.beginBlock(end - start);
    const sounding = this.pool.sounding();
    this.polyGain.setTarget(sounding > 0 ? Math.min(1, 2 / Math.sqrt(sounding)) : 1);
    for (let v = 0; v < this.slots; v++) {
      if (this.env.stage[v] === IDLE) continue;
      this.renderVoice(v, out, start, end);
      this.env.flush(v);
    }
    const poly = this.polyGain;
    for (let i = start; i < end; i++) out[i] *= poly.next();
    poly.flush();
    this.endBlock();
    this.pool.reap();
  }

  /* Subclass hooks; the base versions do nothing. */
  startVoice() {}
  beginBlock() {}
  renderVoice() {}
  endBlock() {}
}
