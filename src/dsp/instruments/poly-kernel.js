/*
 * Shared voice handling for polyphonic instrument kernels (a3-audio-implementation.md,
 * Shared rules): allocation and stealing, envelopes, velocity gain
 * 0.3·(vel/127)², polyphony auto-gain min(1, 2/√voices), all-notes-off.
 * Subclasses implement:
 *   startVoice(v, pitch, velocity)     per-voice state at note-on
 *   beginBlock(n)                      per-block coefficients for n frames
 *   renderVoice(v, out, start, end)    add voice v (× gain[v] × envelope) into out
 *   endBlock()                         block-end flushes
 * They hold `attack` and `release` in seconds. Renders mono, overwriting its range.
 */
import { VOICES_PER_INSTRUMENT } from '../core/constants.js';
import { Smoother } from '../core/smoother.js';
import { VELOCITY_GAIN } from '../core/tables.js';
import { EnvelopeBank, IDLE } from './envelope.js';
import { VoicePool } from './voice-pool.js';

export class PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   * @param {number} [cap] held-voice cap
   */
  constructor(fs, global, cap = VOICES_PER_INSTRUMENT) {
    this.fs = fs;
    this.slots = VoicePool.slotsFor(cap);
    this.env = new EnvelopeBank(fs, this.slots);
    this.pool = new VoicePool(this.env, global, cap);
    this.gain = new Float64Array(this.slots);
    this.polyGain = new Smoother(fs, 1);
    this.attack = 0.01;
    this.release = 0.3;
  }

  /** Starts note `noteId` at MIDI `pitch` (0–127) with `velocity` (1–127). */
  noteOn(noteId, pitch, velocity) {
    const v = this.pool.allocate(noteId);
    if (v < 0) return;
    this.gain[v] = VELOCITY_GAIN[velocity];
    this.startVoice(v, pitch, velocity);
    this.env.start(v, this.attack);
  }

  /** Releases note `noteId`; an unknown id is ignored. */
  noteOff(noteId) {
    const v = this.pool.find(noteId);
    if (v < 0) return;
    this.env.release(v, this.release);
    this.pool.detach(v);
  }

  /** Releases every voice; `hard` fades them over 64 frames instead (Panic). */
  allNotesOff(hard) {
    for (let v = 0; v < this.slots; v++) {
      if (this.env.stage[v] === IDLE) continue;
      if (hard) this.env.steal(v);
      else this.env.release(v, this.release);
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
      if (this.env.stage[v] !== IDLE) this.renderVoice(v, out, start, end);
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
