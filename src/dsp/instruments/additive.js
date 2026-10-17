/*
 * Additive synth (assignment-3-scope.md, Instruments;
 * a3-audio-implementation.md, Additive): eight harmonic amplitudes h1–h8,
 * normalised by 1/max(1, Σh). Harmonics with k·f > 0.45·fs are omitted; the
 * count is fixed at note-on. Per sample, sin θ and cos θ come from the sine
 * table and sin(kθ) from s_k = 2·cos θ·s_{k−1} − s_{k−2}.
 * Vibrato: a per-voice sine LFO (rate, from phase 0 at note-on) moves the pitch
 * by up to ±depth cents and never the level; 2^(c/1200) uses a second-order
 * series, accurate to 3e-5 over ±100 cents. +100 cents keeps the highest kept
 * harmonic under 0.48·fs, so the note-on harmonic count stays alias-free.
 * An ADSR envelope shapes the level.
 */
import { clampParam, defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { sineAt } from '../core/tables.js';
import { PolyKernel, SUSTAIN_PARAM, TUNING_PARAMS, decayParam } from './poly-kernel.js';

export const HARMONICS = 8;
const DEFAULT_LEVELS = [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12];

export const ADDITIVE_PARAMS = [
  ...DEFAULT_LEVELS.map((level, i) =>
    defineParam({ id: `h${i + 1}`, min: 0, max: 1, default: level, unit: 'fraction', scale: 'lin', step: 0.01, group: 'Harmonics' }),
  ),
  defineParam({ id: 'attack', min: 0.002, max: 2, default: 0.02, unit: 's', scale: 'pow3' }),
  decayParam(0.5),
  SUSTAIN_PARAM,
  defineParam({ id: 'release', min: 0.01, max: 4, default: 0.5, unit: 's', scale: 'pow3' }),
  defineParam({ id: 'vibratoRate', min: 0.5, max: 12, default: 5, unit: 'Hz', scale: 'log' }),
  defineParam({ id: 'vibratoDepth', min: 0, max: 100, default: 0, unit: 'cents', scale: 'lin', step: 1 }),
  ...TUNING_PARAMS,
];

const LN2_PER_CENT = Math.LN2 / 1200;

const DEF = Object.fromEntries(ADDITIVE_PARAMS.map((d) => [d.id, d]));

/** Harmonic param id → index, so setParam does no string work. */
const HARMONIC_INDEX = Object.fromEntries(DEFAULT_LEVELS.map((_, i) => [`h${i + 1}`, i]));

export class AdditiveKernel extends PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   */
  constructor(fs, global) {
    super(fs, global);
    this.phase = new Float64Array(this.slots);
    this.dt = new Float64Array(this.slots);
    this.count = new Uint8Array(this.slots); // harmonics kept for each voice
    this.lfo = new Float64Array(this.slots); // vibrato phase, cycles
    this.vibratoRate = new Smoother(fs, DEF.vibratoRate.default);
    this.vibratoDepth = new Smoother(fs, DEF.vibratoDepth.default);
    this.levels = DEFAULT_LEVELS.map((level) => new Smoother(fs, level));
    this.amp = new Float64Array(HARMONICS); // normalised levels for the current block
    this.attack = DEF.attack.default;
    this.release = DEF.release.default;
    this.env.setDecay(DEF.decay.default);
  }

  /** Sets a parameter by id; the value is clamped through its ParamDef. Unknown ids are ignored. */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    if (this.setShared(id, v)) return;
    if (id === 'attack') this.attack = v;
    else if (id === 'release') this.release = v;
    else if (id === 'vibratoRate') this.vibratoRate.setTarget(v);
    else if (id === 'vibratoDepth') this.vibratoDepth.setTarget(v);
    else this.levels[HARMONIC_INDEX[id]].setTarget(v);
  }

  startVoice(v, pitch) {
    const f = this.noteHz(pitch);
    this.phase[v] = 0;
    this.lfo[v] = 0;
    this.dt[v] = f / this.fs;
    let k = 0;
    while (k < HARMONICS && (k + 1) * f <= 0.45 * this.fs) k++;
    this.count[v] = k;
  }

  /** Levels advance over the block and are normalised once per block. */
  beginBlock(n) {
    for (let i = 0; i < n; i++) {
      this.vibratoRate.next();
      this.vibratoDepth.next();
    }
    let sum = 0;
    for (let k = 0; k < HARMONICS; k++) {
      const s = this.levels[k];
      for (let i = 0; i < n; i++) s.next();
      sum += s.y;
    }
    const norm = 1 / (sum > 1 ? sum : 1);
    for (let k = 0; k < HARMONICS; k++) this.amp[k] = this.levels[k].y * norm;
  }

  renderVoice(v, out, start, end) {
    const amp = this.amp;
    const count = this.count[v];
    const dt = this.dt[v];
    const env = this.env;
    const g = this.gain[v];
    const dLfo = this.vibratoRate.y / this.fs;
    const depth = this.vibratoDepth.y * LN2_PER_CENT;
    let t = this.phase[v];
    let lfo = this.lfo[v];
    for (let i = start; i < end; i++) {
      const s1 = sineAt(t);
      const tc = t + 0.25 < 1 ? t + 0.25 : t - 0.75;
      const twoCos = 2 * sineAt(tc);
      let prev = 0;
      let cur = s1;
      let sum = amp[0] * s1;
      for (let k = 1; k < count; k++) {
        const next = twoCos * cur - prev;
        prev = cur;
        cur = next;
        sum += amp[k] * cur;
      }
      out[i] += sum * g * env.next(v);
      if (depth > 0) {
        const y = depth * sineAt(lfo);
        t += dt * (1 + y + 0.5 * y * y);
        lfo += dLfo;
        if (lfo >= 1) lfo -= 1;
      } else t += dt;
      if (t >= 1) t -= 1;
    }
    this.phase[v] = t;
    this.lfo[v] = lfo;
  }

  endBlock() {
    for (let k = 0; k < HARMONICS; k++) this.levels[k].flush();
    this.vibratoRate.flush();
    this.vibratoDepth.flush();
  }
}
