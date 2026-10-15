/*
 * Subtractive synth (assignment-3-scope.md, Instruments;
 * a3-audio-implementation.md, Subtractive): a band-limited oscillator through a
 * per-voice TPT state-variable lowpass, with a linear-attack, exponential-release
 * envelope. Renders mono, overwriting its output range.
 */
import { VOICES_PER_INSTRUMENT } from '../core/constants.js';
import { flushDenormal } from '../core/math.js';
import { clampParam, defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { NOTE_FREQUENCIES, VELOCITY_GAIN, sineAt } from '../core/tables.js';
import { LOWPASS, svfCoefficients, svfTick } from '../effects/svf.js';
import { EnvelopeBank, IDLE } from './envelope.js';
import { saw, square } from './polyblep.js';
import { VoicePool } from './voice-pool.js';

export const WAVEFORMS = ['sine', 'square', 'saw', 'triangle'];
const SINE = 0;
const SQUARE = 1;
const SAW = 2;

/** Triangle leak (project limit): y = 0.999·y + 4·dt·square. */
const TRIANGLE_LEAK = 0.999;

export const SUBTRACTIVE_PARAMS = [
  defineParam({ id: 'waveform', scale: 'enum', options: WAVEFORMS, default: SAW }),
  defineParam({ id: 'cutoff', min: 40, max: 16000, default: 2000, unit: 'Hz', scale: 'log' }),
  defineParam({ id: 'resonance', min: 0, max: 20, default: 1, unit: 'dB', scale: 'lin', step: 0.1 }),
  defineParam({ id: 'attack', min: 0.002, max: 2, default: 0.01, unit: 's', scale: 'pow3' }),
  defineParam({ id: 'release', min: 0.01, max: 4, default: 0.3, unit: 's', scale: 'pow3' }),
];

const DEF = Object.fromEntries(SUBTRACTIVE_PARAMS.map((d) => [d.id, d]));

export class SubtractiveKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   */
  constructor(fs, global) {
    const slots = VoicePool.slotsFor(VOICES_PER_INSTRUMENT);
    this.fs = fs;
    this.env = new EnvelopeBank(fs, slots);
    this.pool = new VoicePool(this.env, global);
    this.phase = new Float64Array(slots);
    this.dt = new Float64Array(slots);
    this.tri = new Float64Array(slots);
    this.gain = new Float64Array(slots);
    this.filter = new Float64Array(2 * slots); // [ic1, ic2] per voice
    this.coef = new Float64Array(4);
    this.waveform = DEF.waveform.default;
    this.attack = DEF.attack.default;
    this.release = DEF.release.default;
    this.cutoff = new Smoother(fs, DEF.cutoff.default);
    this.resonance = new Smoother(fs, DEF.resonance.default);
    this.polyGain = new Smoother(fs, 1);
  }

  /** Sets a parameter by id; the value is clamped through its ParamDef. Unknown ids are ignored. */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    if (id === 'waveform') this.waveform = v;
    else if (id === 'attack') this.attack = v;
    else if (id === 'release') this.release = v;
    else if (id === 'cutoff') this.cutoff.setTarget(v);
    else this.resonance.setTarget(v);
  }

  /** Starts note `noteId` at MIDI `pitch` (0–127) with `velocity` (1–127). */
  noteOn(noteId, pitch, velocity) {
    const v = this.pool.allocate(noteId);
    if (v < 0) return;
    this.phase[v] = 0;
    this.tri[v] = 0;
    this.filter[2 * v] = 0;
    this.filter[2 * v + 1] = 0;
    this.dt[v] = NOTE_FREQUENCIES[pitch] / this.fs;
    this.gain[v] = VELOCITY_GAIN[velocity];
    this.env.start(v, this.attack);
  }

  /** Releases note `noteId`; an unknown id is ignored. */
  noteOff(noteId) {
    const v = this.pool.find(noteId);
    if (v < 0) return;
    this.env.release(v, this.release);
    this.pool.detach(v);
  }

  /** Releases every voice; `hard` fades them over 64 frames instead (Panic, stop of previews). */
  allNotesOff(hard) {
    for (let v = 0; v < this.pool.slots; v++) {
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
    const n = end - start;
    out.fill(0, start, end);
    // Smoothed filter parameters, advanced over the block; coefficients once per block.
    for (let i = 0; i < n; i++) {
      this.cutoff.next();
      this.resonance.next();
    }
    svfCoefficients(this.coef, 0, this.cutoff.y, 0.7071 * 10 ** (this.resonance.y / 20), this.fs);
    const sounding = this.pool.sounding();
    this.polyGain.setTarget(sounding > 0 ? Math.min(1, 2 / Math.sqrt(sounding)) : 1);
    const wave = this.waveform;
    const coef = this.coef;
    const state = this.filter;
    for (let v = 0; v < this.pool.slots; v++) {
      if (this.env.stage[v] === IDLE) continue;
      let t = this.phase[v];
      const dt = this.dt[v];
      const g = this.gain[v];
      let tri = this.tri[v];
      for (let i = start; i < end; i++) {
        let x;
        if (wave === SAW) x = saw(t, dt);
        else if (wave === SQUARE) x = square(t, dt);
        else if (wave === SINE) x = sineAt(t);
        else {
          tri = TRIANGLE_LEAK * tri + 4 * dt * square(t, dt);
          x = tri;
        }
        t += dt;
        if (t >= 1) t -= 1;
        const y = svfTick(x, coef, 0, state, 2 * v, LOWPASS);
        out[i] += y * g * this.env.next(v);
      }
      this.phase[v] = t;
      this.tri[v] = flushDenormal(tri);
      state[2 * v] = flushDenormal(state[2 * v]);
      state[2 * v + 1] = flushDenormal(state[2 * v + 1]);
    }
    const poly = this.polyGain;
    for (let i = start; i < end; i++) out[i] *= poly.next();
    this.cutoff.flush();
    this.resonance.flush();
    poly.flush();
    this.pool.reap();
  }
}
