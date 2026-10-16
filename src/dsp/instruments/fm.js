/*
 * Two-operator FM synth (assignment-3-scope.md, Instruments;
 * a3-audio-implementation.md, FM): out = sin(φc + I(t)·sin(φm)), fm = ratio·fc,
 * I(t) = min(index, I_max)·exp(−t/τ) with τ = index decay. The decay factor is
 * computed once per block and interpolated per sample.
 * I_max = max(0, (0.45·fs − fc)/fm − 1) keeps the highest significant sideband
 * fc + (I + 1)·fm (Carson's rule) at or below 0.45·fs.
 * Two Math.sin calls per sample per voice (the accepted exception to rule 4).
 */
import { clampParam, defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { NOTE_FREQUENCIES } from '../core/tables.js';
import { PolyKernel } from './poly-kernel.js';

const TWO_PI = 2 * Math.PI;

export const FM_PARAMS = [
  defineParam({ id: 'ratio', min: 0.5, max: 12, default: 2, unit: '×', scale: 'lin', step: 0.5 }),
  defineParam({ id: 'index', min: 0, max: 20, default: 3, scale: 'lin', step: 0.1 }),
  defineParam({ id: 'indexDecay', min: 0.01, max: 4, default: 0.5, unit: 's', scale: 'pow3' }),
  defineParam({ id: 'attack', min: 0.002, max: 2, default: 0.005, unit: 's', scale: 'pow3' }),
  defineParam({ id: 'release', min: 0.01, max: 4, default: 0.4, unit: 's', scale: 'pow3' }),
];

const DEF = Object.fromEntries(FM_PARAMS.map((d) => [d.id, d]));

/** Largest modulation index whose Carson bandwidth stays at or below 0.45·fs. */
export function maxIndex(fc, fm, fs) {
  return Math.max(0, (0.45 * fs - fc) / fm - 1);
}

export class FmKernel extends PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   */
  constructor(fs, global) {
    super(fs, global);
    this.phaseC = new Float64Array(this.slots);
    this.phaseM = new Float64Array(this.slots);
    this.fc = new Float64Array(this.slots);
    this.decay = new Float64Array(this.slots); // exp(−t/τ) at block start
    this.ratio = DEF.ratio.default;
    this.indexDecay = DEF.indexDecay.default;
    this.attack = DEF.attack.default;
    this.release = DEF.release.default;
    this.index = new Smoother(fs, DEF.index.default);
    this.blockDecay = 1; // exp(−n/(τ·fs)) for the current block
    this.blockFrames = 1;
  }

  /** Sets a parameter by id; the value is clamped through its ParamDef. Unknown ids are ignored. */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    if (id === 'ratio') this.ratio = v;
    else if (id === 'index') this.index.setTarget(v);
    else if (id === 'indexDecay') this.indexDecay = v;
    else if (id === 'attack') this.attack = v;
    else this.release = v;
  }

  startVoice(v, pitch) {
    this.phaseC[v] = 0;
    this.phaseM[v] = 0;
    this.fc[v] = NOTE_FREQUENCIES[pitch];
    this.decay[v] = 1;
  }

  beginBlock(n) {
    for (let i = 0; i < n; i++) this.index.next();
    this.blockDecay = Math.exp(-n / (this.indexDecay * this.fs));
    this.blockFrames = n;
  }

  renderVoice(v, out, start, end) {
    const fs = this.fs;
    const fc = this.fc[v];
    const fm = this.ratio * fc;
    const peakIndex = Math.min(this.index.y, maxIndex(fc, fm, fs));
    const dC = (TWO_PI * fc) / fs;
    const dM = (TWO_PI * fm) / fs;
    const e0 = this.decay[v];
    const de = (e0 * this.blockDecay - e0) / this.blockFrames;
    const env = this.env;
    const g = this.gain[v];
    let pc = this.phaseC[v];
    let pm = this.phaseM[v];
    let e = e0;
    for (let i = start; i < end; i++) {
      out[i] += Math.sin(pc + peakIndex * e * Math.sin(pm)) * g * env.next(v);
      pc += dC;
      if (pc >= TWO_PI) pc -= TWO_PI;
      pm += dM;
      if (pm >= TWO_PI) pm -= TWO_PI;
      e += de;
    }
    this.phaseC[v] = pc;
    this.phaseM[v] = pm;
    this.decay[v] = e0 * this.blockDecay;
  }

  endBlock() {
    this.index.flush();
  }
}
