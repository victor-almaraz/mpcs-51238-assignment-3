/*
 * Granular synth (assignment-3-scope.md, Instruments; a3-audio-implementation.md,
 * Granular). Sources are generated at construction: 2 s mono of a PolyBLEP saw
 * at 261.63 Hz (C4), seeded noise, or a C–E–G chord of saws scaled by 1/3.
 *
 * Each voice (at most 4) counts down per sample; at zero a free grain starts
 * and the countdown resets to round(fs/density). A grain lasts size·fs frames
 * under a 1025-entry Hann window, starts at base + spray·(rand − 0.5)·length
 * (wrapped), reads with linear interpolation at increment f/261.63, and has
 * amplitude velocity gain × min(1, 1/√(density·size)). `base` is the voice's
 * read point, which advances through the source in real time from the note
 * start. With no free grain of the 64, the start is skipped and counted.
 */
import { clampParam, defineParam } from '../core/params.js';
import { Mulberry32, hash32 } from '../core/prng.js';
import { NOTE_FREQUENCIES, readTable } from '../core/tables.js';
import { IDLE } from './envelope.js';
import { PolyKernel } from './poly-kernel.js';
import { saw } from './polyblep.js';

export const SOURCES = ['saw', 'noise', 'chord'];
export const GRAIN_VOICES = 4;
export const MAX_GRAINS = 64;
export const SOURCE_SECONDS = 2;
export const SOURCE_PITCH_HZ = 261.63;

/** Fixed seed of the noise source, so every instance generates the same buffer. */
const NOISE_SEED = 0x6e6f6973;
const GRANULAR_ATTACK_S = 0.02;
const GRANULAR_RELEASE_S = 0.3;

export const GRANULAR_PARAMS = [
  defineParam({ id: 'source', scale: 'enum', options: SOURCES, default: 0 }),
  defineParam({ id: 'grainSize', min: 0.01, max: 0.25, default: 0.06, unit: 's', scale: 'log' }),
  defineParam({ id: 'density', min: 2, max: 60, default: 20, unit: 'grains/s', scale: 'log' }),
  defineParam({ id: 'spray', min: 0, max: 1, default: 0.2, unit: 'fraction', scale: 'lin', step: 0.01 }),
];

const DEF = Object.fromEntries(GRANULAR_PARAMS.map((d) => [d.id, d]));

/** Hann window, 1025 entries over x ∈ [0, 1]. */
const HANN = new Float32Array(1025);
for (let i = 0; i < HANN.length; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (HANN.length - 1));

/** The three source buffers for sample rate `fs` (allocates). */
export function buildSources(fs) {
  const n = Math.round(SOURCE_SECONDS * fs);
  const sawBuf = new Float32Array(n);
  const noiseBuf = new Float32Array(n);
  const chordBuf = new Float32Array(n);
  const rng = new Mulberry32(NOISE_SEED);
  const freqs = [SOURCE_PITCH_HZ, 329.63, 392.0];
  const phase = [0, 0, 0];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const dt = SOURCE_PITCH_HZ / fs;
    sawBuf[i] = saw(t, dt);
    t += dt;
    if (t >= 1) t -= 1;
    noiseBuf[i] = rng.nextBipolar();
    let c = 0;
    for (let k = 0; k < 3; k++) {
      const dk = freqs[k] / fs;
      c += saw(phase[k], dk);
      phase[k] += dk;
      if (phase[k] >= 1) phase[k] -= 1;
    }
    chordBuf[i] = c / 3;
  }
  return [sawBuf, noiseBuf, chordBuf];
}

export class GranularKernel extends PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   * @param {number} [maxGrains] grain pool size (64; smaller only in tests)
   */
  constructor(fs, global, maxGrains = MAX_GRAINS) {
    super(fs, global, GRAIN_VOICES);
    this.sources = buildSources(fs);
    this.sourceLength = this.sources[0].length;
    this.source = DEF.source.default;
    this.grainSize = DEF.grainSize.default;
    this.density = DEF.density.default;
    this.spray = DEF.spray.default;
    this.attack = GRANULAR_ATTACK_S;
    this.release = GRANULAR_RELEASE_S;
    this.seed = 1;
    // Voices
    this.inc = new Float64Array(this.slots);
    this.base = new Float64Array(this.slots);
    this.countdown = new Int32Array(this.slots);
    this.envLevel = new Float64Array(this.slots);
    this.rng = Array.from({ length: this.slots }, () => new Mulberry32(1));
    // Grains (struct-of-arrays)
    this.maxGrains = maxGrains;
    this.gActive = new Uint8Array(maxGrains);
    this.gVoice = new Int32Array(maxGrains);
    this.gPos = new Float64Array(maxGrains);
    this.gInc = new Float64Array(maxGrains);
    this.gAge = new Int32Array(maxGrains);
    this.gLen = new Int32Array(maxGrains);
    this.gAmp = new Float64Array(maxGrains);
    this.gSource = new Uint8Array(maxGrains);
    this.skipped = 0;
  }

  /** Sets a parameter by id; new values apply to grains started afterwards. */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    if (id === 'source') this.source = v;
    else if (id === 'grainSize') this.grainSize = v;
    else if (id === 'density') this.density = v;
    else this.spray = v;
  }

  startVoice(v, pitch) {
    this.inc[v] = NOTE_FREQUENCIES[pitch] / SOURCE_PITCH_HZ;
    this.base[v] = 0;
    this.countdown[v] = 0; // the first grain starts at once
    this.rng[v].reseed(hash32(this.seed, this.pool.noteId[v], 1));
  }

  /** Concurrent grains (for tests and meters). */
  activeGrains() {
    let n = 0;
    for (let g = 0; g < this.maxGrains; g++) n += this.gActive[g];
    return n;
  }

  #startGrain(v) {
    let g = -1;
    for (let i = 0; i < this.maxGrains; i++) {
      if (!this.gActive[i]) {
        g = i;
        break;
      }
    }
    if (g < 0) {
      this.skipped++;
      return;
    }
    const L = this.sourceLength;
    let pos = this.base[v] + this.spray * (this.rng[v].next() - 0.5) * L;
    pos %= L;
    if (pos < 0) pos += L;
    this.gActive[g] = 1;
    this.gVoice[g] = v;
    this.gPos[g] = pos;
    this.gInc[g] = this.inc[v];
    this.gAge[g] = 0;
    this.gLen[g] = Math.max(2, Math.round(this.grainSize * this.fs));
    this.gAmp[g] = this.gain[v] * Math.min(1, 1 / Math.sqrt(this.density * this.grainSize));
    this.gSource[g] = this.source;
  }

  /** Renders frames [start, end) into `out`, overwriting them. */
  render(out, start, end) {
    out.fill(0, start, end);
    const sounding = this.pool.sounding();
    this.polyGain.setTarget(sounding > 0 ? Math.min(1, 2 / Math.sqrt(sounding)) : 1);
    const env = this.env;
    const L = this.sourceLength;
    const period = Math.max(1, Math.round(this.fs / this.density));
    const poly = this.polyGain;
    for (let i = start; i < end; i++) {
      for (let v = 0; v < this.slots; v++) {
        if (env.stage[v] === IDLE) {
          this.envLevel[v] = 0;
          continue;
        }
        this.envLevel[v] = env.next(v);
        this.base[v] += 1;
        if (this.base[v] >= L) this.base[v] -= L;
        if (--this.countdown[v] <= 0) {
          this.#startGrain(v);
          this.countdown[v] = period;
        }
      }
      let sum = 0;
      for (let g = 0; g < this.maxGrains; g++) {
        if (!this.gActive[g]) continue;
        const level = this.envLevel[this.gVoice[g]];
        const src = this.sources[this.gSource[g]];
        const pos = this.gPos[g];
        const j = pos | 0;
        const frac = pos - j;
        const j1 = j + 1 === L ? 0 : j + 1;
        const s = src[j] + (src[j1] - src[j]) * frac;
        sum += s * readTable(HANN, this.gAge[g] / this.gLen[g]) * this.gAmp[g] * level;
        let next = pos + this.gInc[g];
        if (next >= L) next -= L;
        this.gPos[g] = next;
        if (++this.gAge[g] >= this.gLen[g] || env.stage[this.gVoice[g]] === IDLE) this.gActive[g] = 0;
      }
      out[i] = sum * poly.next();
    }
    poly.flush();
    this.pool.reap();
  }
}
