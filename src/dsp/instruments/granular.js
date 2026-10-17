/*
 * Granular synth (assignment-3-scope.md, Instruments; a3-audio-implementation.md,
 * Granular). Sources are generated at construction: 2 s mono of a PolyBLEP saw
 * at 261.63 Hz (C4), seeded noise, or a C–E–G chord of saws scaled by 1/3; the
 * File source is a bound sample (bindSource, the sampler's zone path), read
 * as the mean of its channels. Without a bound file, File is silent.
 *
 * Each voice (at most 4) counts down per sample; at zero a free grain starts
 * and the countdown resets to round(fs/density). A grain lasts size·fs frames
 * under a 1025-entry Hann window and reads with linear interpolation at rate
 * f/261.63 (noise: 1), detuned per grain by up to ±pitch spread cents (the
 * extra random draw happens only while spread is on). It covers c = size·rate
 * source frames from start = position·(L − c) + spray·(rand − 0.5)·L, clamped
 * to [0, L − c]. Amplitude is velocity gain × min(1, 1/√(density·size)). An
 * attack-release envelope shapes each voice. With no free grain of the 64,
 * the start is skipped and counted.
 */
import { clampParam, defineParam } from '../core/params.js';
import { Mulberry32, hash32 } from '../core/prng.js';
import { readTable } from '../core/tables.js';
import { IDLE } from './envelope.js';
import { PolyKernel, TUNING_PARAMS } from './poly-kernel.js';
import { saw } from './polyblep.js';

export const SOURCES = ['saw', 'noise', 'chord', 'sample'];
const NOISE = 1;
const SAMPLE = 3;
/** Longest File source used, in seconds; longer files play their first 20 s. */
export const GRANULAR_MAX_SOURCE_S = 20;
export const GRAIN_VOICES = 4;
export const MAX_GRAINS = 64;
export const SOURCE_SECONDS = 2;
export const SOURCE_PITCH_HZ = 261.63;

/** Fixed seed of the noise source, so every instance generates the same buffer. */
const NOISE_SEED = 0x6e6f6973;

export const GRANULAR_PARAMS = [
  defineParam({ id: 'source', scale: 'enum', options: SOURCES, default: 0 }),
  defineParam({ id: 'position', min: 0, max: 1, default: 0.5, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'grainSize', min: 0.01, max: 0.25, default: 0.06, unit: 's', scale: 'log' }),
  defineParam({ id: 'density', min: 2, max: 60, default: 20, unit: 'grains/s', scale: 'log' }),
  defineParam({ id: 'spray', min: 0, max: 1, default: 0.2, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'pitchSpread', min: 0, max: 1200, default: 0, unit: 'cents', scale: 'lin', step: 1 }),
  defineParam({ id: 'attack', min: 0.002, max: 2, default: 0.05, unit: 's', scale: 'pow3' }),
  defineParam({ id: 'release', min: 0.01, max: 4, default: 0.4, unit: 's', scale: 'pow3' }),
  ...TUNING_PARAMS,
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
    this.channels = null; // bound File source channels
    this.sampleLength = 0;
    this.missingPending = false;
    this.source = DEF.source.default;
    this.position = DEF.position.default;
    this.grainSize = DEF.grainSize.default;
    this.density = DEF.density.default;
    this.spray = DEF.spray.default;
    this.pitchSpread = DEF.pitchSpread.default;
    this.attack = DEF.attack.default;
    this.release = DEF.release.default;
    this.seed = 1;
    // Voices
    this.inc = new Float64Array(this.slots);
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

  /**
   * Binds the File source to `channels` (references, not copies); grains of
   * the old file stop. Empty channels act as unbindSource. The engine's zone
   * path calls it with (channels, mips, name); mips are not used.
   */
  bindSource(channels) {
    const frames = channels?.[0]?.length ?? 0;
    if (frames === 0) {
      this.unbindSource();
      return false;
    }
    if (channels !== this.channels) this.#dropSampleGrains();
    this.channels = channels;
    this.sampleLength = Math.min(frames, Math.round(GRANULAR_MAX_SOURCE_S * this.fs));
    return true;
  }

  /** Unbinds the File source; File plays silence. */
  unbindSource() {
    this.#dropSampleGrains();
    this.channels = null;
    this.sampleLength = 0;
    this.missingPending = true;
  }

  /** True once after an unbind, for the engine's source-status report. */
  takeMissingReport() {
    const pending = this.missingPending;
    this.missingPending = false;
    return pending;
  }

  #dropSampleGrains() {
    for (let g = 0; g < this.maxGrains; g++) if (this.gSource[g] === SAMPLE) this.gActive[g] = 0;
  }

  /** Sets a parameter by id; new values apply to grains started afterwards. */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    if (this.setShared(id, v)) return;
    if (id === 'source') this.source = v;
    else if (id === 'position') this.position = v;
    else if (id === 'grainSize') this.grainSize = v;
    else if (id === 'density') this.density = v;
    else if (id === 'spray') this.spray = v;
    else if (id === 'pitchSpread') this.pitchSpread = v;
    else if (id === 'attack') this.attack = v;
    else this.release = v;
  }

  startVoice(v, pitch) {
    this.inc[v] = this.noteHz(pitch) / SOURCE_PITCH_HZ;
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
    const source = this.source;
    const L = source === SAMPLE ? this.sampleLength : this.sourceLength;
    if (L < 2) return; // File without a bound sample: silent
    const rng = this.rng[v];
    const r = rng.next();
    let rate = source === NOISE ? 1 : this.inc[v];
    if (this.pitchSpread > 0 && source !== NOISE) rate *= 2 ** (((rng.next() * 2 - 1) * this.pitchSpread) / 1200);
    const len = Math.max(2, Math.round(this.grainSize * this.fs));
    const content = Math.min(len * rate, L - 1);
    const room = Math.max(0, L - 1 - content);
    const at = this.position * room + (r - 0.5) * this.spray * L;
    this.gActive[g] = 1;
    this.gVoice[g] = v;
    this.gPos[g] = at < 0 ? 0 : at > room ? room : at;
    this.gInc[g] = rate;
    this.gAge[g] = 0;
    this.gLen[g] = len;
    this.gAmp[g] = this.gain[v] * Math.min(1, 1 / Math.sqrt(this.density * this.grainSize));
    this.gSource[g] = source;
  }

  /** Renders frames [start, end) into `out`, overwriting them. */
  render(out, start, end) {
    out.fill(0, start, end);
    const sounding = this.pool.sounding();
    this.polyGain.setTarget(sounding > 0 ? Math.min(1, 2 / Math.sqrt(sounding)) : 1);
    const env = this.env;
    const channels = this.channels;
    const stereo = channels !== null && channels.length > 1;
    const period = Math.max(1, Math.round(this.fs / this.density));
    const poly = this.polyGain;
    for (let i = start; i < end; i++) {
      for (let v = 0; v < this.slots; v++) {
        if (env.stage[v] === IDLE) {
          this.envLevel[v] = 0;
          continue;
        }
        this.envLevel[v] = env.next(v);
        if (--this.countdown[v] <= 0) {
          this.#startGrain(v);
          this.countdown[v] = period;
        }
      }
      let sum = 0;
      for (let g = 0; g < this.maxGrains; g++) {
        if (!this.gActive[g]) continue;
        const level = this.envLevel[this.gVoice[g]];
        const kind = this.gSource[g];
        const L = kind === SAMPLE ? this.sampleLength : this.sourceLength;
        const pos = this.gPos[g];
        const j = pos | 0;
        const frac = pos - j;
        const j1 = j + 1 < L ? j + 1 : L - 1;
        let s;
        if (kind === SAMPLE) {
          const a = channels[0];
          s = a[j] + (a[j1] - a[j]) * frac;
          if (stereo) {
            const b = channels[1];
            s = 0.5 * (s + b[j] + (b[j1] - b[j]) * frac);
          }
        } else {
          const src = this.sources[kind];
          s = src[j] + (src[j1] - src[j]) * frac;
        }
        sum += s * readTable(HANN, this.gAge[g] / this.gLen[g]) * this.gAmp[g] * level;
        const next = pos + this.gInc[g];
        this.gPos[g] = next < L - 1 ? next : L - 1;
        if (++this.gAge[g] >= this.gLen[g] || env.stage[this.gVoice[g]] === IDLE) this.gActive[g] = 0;
      }
      out[i] = sum * poly.next();
    }
    poly.flush();
    this.pool.reap();
  }
}
