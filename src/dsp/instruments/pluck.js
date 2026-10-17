/*
 * Plucked string, Karplus–Strong with the Jaffe–Smith extensions
 * (assignment-3-scope.md, Instruments; a3-audio-implementation.md, Pluck).
 *   Period P = fs/f. Loop filter y = (1 − S)·x[n] + S·x[n−1], S = 0.5·damping.
 *   N = floor(P − S − 0.1); Δ = P − S − N ∈ [0.1, 1.1); fractional allpass
 *   C = (1 − Δ)/(1 + Δ), y[n] = C·x[n] + x[n−1] − C·y[n−1].
 *   Loop gain ρ = min(0.9999, 10^(−3/(T60·f))).
 *   Excitation: N samples of seeded noise through a one-pole lowpass with
 *   a = 0.1 + 0.9·brightness, mean removed, peak normalised.
 *   Pick position: the excitation passes the comb 1 − z^−k, k = round(pick·N),
 *   applied circularly over the period before mean removal, so harmonics
 *   with a node at the pick point drop out.
 *   Output DC blocker y = x − x1 + 0.995·y1.
 * Note-off mutes the string: the loop gain glides (τ = 5 ms) to the gain for
 * T60 = release, never above the decay's. A voice ends once one pass round the
 * loop peaks below 1e-6 (held or released).
 * One 4096-sample delay per voice (project limit). A note whose period does
 * not fit plays an octave higher, repeatedly, until it does.
 */
import { flushDenormal } from '../core/math.js';
import { clampParam, defineParam } from '../core/params.js';
import { Mulberry32, hash32 } from '../core/prng.js';
import { IDLE, RELEASE, STEAL } from './envelope.js';
import { PolyKernel, TUNING_PARAMS } from './poly-kernel.js';

export const PLUCK_DELAY_SIZE = 4096;
export const RHO_MAX = 0.9999;

/** A 2 ms onset; the string itself does the rest. */
const PLUCK_ATTACK_S = 0.002;

/** Pass peak below which a voice ends. */
const PASS_FLOOR = 1e-6;

export const PLUCK_PARAMS = [
  defineParam({ id: 'damping', min: 0, max: 1, default: 0.5, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'brightness', min: 0, max: 1, default: 0.7, unit: 'fraction', scale: 'lin', step: 0.01 }),
  // Fraction of the string length from the bridge; 0 plucks at the bridge (no comb).
  defineParam({ id: 'pickPosition', min: 0, max: 0.5, default: 0, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'decay', label: 'Decay (T60)', min: 0.2, max: 10, default: 2, unit: 's', scale: 'pow3' }),
  // T60 after note-off (string muting); never longer than the decay.
  defineParam({ id: 'release', min: 0.02, max: 2, default: 0.1, unit: 's', scale: 'pow3' }),
  ...TUNING_PARAMS,
];

const DEF = Object.fromEntries(PLUCK_PARAMS.map((d) => [d.id, d]));

/**
 * Loop tuning for frequency `f` at `fs` with averager weight `S`, after
 * octave transposition so that N < PLUCK_DELAY_SIZE. Writes [f, N, C] into
 * `out` (no allocation: it runs at note-on inside process()).
 */
export function pluckTuning(f, fs, S, out) {
  let freq = f;
  while (fs / freq - S - 0.1 >= PLUCK_DELAY_SIZE) freq *= 2;
  const P = fs / freq;
  let N = Math.floor(P - S - 0.1);
  if (N < 1) N = 1;
  const delta = P - S - N;
  out[0] = freq;
  out[1] = N;
  out[2] = (1 - delta) / (1 + delta);
  return out;
}

export class PluckKernel extends PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   */
  constructor(fs, global) {
    super(fs, global);
    const slots = this.slots;
    this.delay = new Float32Array(slots * PLUCK_DELAY_SIZE);
    this.length = new Int32Array(slots); // N
    this.pos = new Int32Array(slots);
    this.C = new Float64Array(slots);
    this.S = new Float64Array(slots);
    this.rho = new Float64Array(slots);
    this.rhoRel = new Float64Array(slots); // loop gain after note-off
    this.freq = new Float64Array(slots); // loop frequency after octave transposition
    this.releasing = new Uint8Array(slots);
    this.passPeak = new Float64Array(slots);
    this.glide = 1 - Math.exp(-1 / (0.005 * fs));
    this.scratch = new Float32Array(PLUCK_DELAY_SIZE); // excitation before the pick comb
    this.prev = new Float64Array(slots); // x[n−1] of the loop averager
    this.apX = new Float64Array(slots);
    this.apY = new Float64Array(slots);
    this.dcX = new Float64Array(slots);
    this.dcY = new Float64Array(slots);
    this.noise = new Mulberry32(1);
    this.tuning = new Float64Array(3);
    this.seed = 1; // set by the engine per track
    this.damping = DEF.damping.default;
    this.brightness = DEF.brightness.default;
    this.pickPosition = DEF.pickPosition.default;
    this.decay = DEF.decay.default;
    this.attack = PLUCK_ATTACK_S;
    this.release = DEF.release.default;
  }

  /** Sets a parameter by id; the values apply from the next note (release from the next note-off). */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    if (id === 'decay') this.decay = v; // the string's T60, not an envelope decay
    else if (this.setShared(id, v)) return;
    else if (id === 'damping') this.damping = v;
    else if (id === 'brightness') this.brightness = v;
    else if (id === 'pickPosition') this.pickPosition = v;
    else this.release = v;
  }

  /** Mutes the string: from now the loop gain glides to the gain for T60 = release. */
  releaseVoice(v) {
    const s = this.env.stage[v];
    if (s !== RELEASE && this.releasing[v] === 0 && this.env.active(v) && s !== STEAL) {
      this.releasing[v] = 1;
      this.rhoRel[v] = Math.min(this.rho[v], 10 ** (-3 / (this.release * this.freq[v])));
      // The stage marks the voice released for stealing; the level holds (multiplier 1).
      this.env.stage[v] = RELEASE;
      this.env.releaseMul[v] = 1;
    }
  }

  /** Fills voice `v`'s delay with the excitation and sets its loop. Seeded by (seed, noteId). */
  startNote(v, pitch, noteId) {
    const fs = this.fs;
    const S = 0.5 * this.damping;
    const tuning = pluckTuning(this.noteHz(pitch), fs, S, this.tuning);
    const N = tuning[1];
    this.freq[v] = tuning[0];
    this.releasing[v] = 0;
    this.passPeak[v] = 0;
    this.length[v] = N;
    this.pos[v] = 0;
    this.C[v] = tuning[2];
    this.S[v] = S;
    this.rho[v] = Math.min(RHO_MAX, 10 ** (-3 / (this.decay * tuning[0])));
    this.prev[v] = 0;
    this.apX[v] = 0;
    this.apY[v] = 0;
    this.dcX[v] = 0;
    this.dcY[v] = 0;
    const base = v * PLUCK_DELAY_SIZE;
    const buf = this.delay;
    const a = 0.1 + 0.9 * this.brightness;
    this.noise.reseed(hash32(this.seed, noteId, 0));
    let y = 0;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      y += a * (this.noise.nextBipolar() - y);
      buf[base + i] = y;
    }
    const kPick = Math.round(this.pickPosition * N);
    if (kPick >= 1 && kPick < N) {
      const x = this.scratch;
      for (let i = 0; i < N; i++) x[i] = buf[base + i];
      for (let i = 0; i < N; i++) buf[base + i] = x[i] - x[i >= kPick ? i - kPick : i - kPick + N];
    }
    for (let i = 0; i < N; i++) sum += buf[base + i];
    const mean = sum / N;
    let max = 0;
    for (let i = 0; i < N; i++) {
      const x = buf[base + i] - mean;
      buf[base + i] = x;
      if (x > max) max = x;
      else if (-x > max) max = -x;
    }
    const scale = max > 0 ? 1 / max : 0;
    for (let i = 0; i < N; i++) buf[base + i] *= scale;
  }

  noteOn(noteId, pitch, velocity) {
    const v = this.pool.allocate(noteId);
    if (v < 0) return;
    this.gain[v] = this.velocityGain(velocity);
    this.startNote(v, pitch, noteId);
    this.env.start(v, this.attack);
  }

  renderVoice(v, out, start, end) {
    const buf = this.delay;
    const base = v * PLUCK_DELAY_SIZE;
    const N = this.length[v];
    const C = this.C[v];
    const S = this.S[v];
    const releasing = this.releasing[v] === 1;
    const rhoRel = this.rhoRel[v];
    const glide = this.glide;
    let rho = this.rho[v];
    let peak = this.passPeak[v];
    const env = this.env;
    const g = this.gain[v];
    let pos = this.pos[v];
    let prev = this.prev[v];
    let apX = this.apX[v];
    let apY = this.apY[v];
    let dcX = this.dcX[v];
    let dcY = this.dcY[v];
    for (let i = start; i < end; i++) {
      if (releasing && rho > rhoRel) rho += (rhoRel - rho) * glide;
      const x = buf[base + pos];
      const avg = (1 - S) * x + S * prev;
      prev = x;
      const ap = C * avg + apX - C * apY;
      apX = avg;
      apY = ap;
      buf[base + pos] = rho * ap;
      pos = pos + 1 === N ? 0 : pos + 1;
      dcY = x - dcX + 0.995 * dcY;
      dcX = x;
      out[i] += dcY * g * env.next(v);
      const a = ap < 0 ? -ap : ap;
      if (a > peak) peak = a;
      if (pos === 0) {
        // One full pass round the loop: a string below the floor has died away.
        if (peak < PASS_FLOOR && env.stage[v] !== STEAL) {
          env.stage[v] = IDLE;
          env.level[v] = 0;
          break;
        }
        peak = 0;
      }
    }
    this.rho[v] = rho;
    this.passPeak[v] = peak;
    this.pos[v] = pos;
    this.prev[v] = prev;
    this.apX[v] = apX;
    this.apY[v] = flushDenormal(apY);
    this.dcX[v] = dcX;
    this.dcY[v] = flushDenormal(dcY);
  }
}
