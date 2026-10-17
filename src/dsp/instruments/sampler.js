/*
 * Sampler (assignment-3-scope.md, Instruments; a3-audio-implementation.md,
 * Sampler; instruments.md, Sampler): one zone of a user-imported source played
 * chromatically at r = 2^((note − rootNote)/12 + fineTune/1200), fixed at
 * note-on. Notes more than 24 semitones from rootNote do not start.
 *
 * Mip levels: a voice reads level L = clamp(ceil(log2 r), 0, 2) at step r/2^L
 * (level 0 only when no mips are bound), with 4-point Hermite interpolation.
 * L is fixed while a voice plays one note; a mono legato note recomputes it
 * from max(rCurrent, rTarget) and rescales the position to the new level.
 *
 * Loops: off (play to the end marker, then a 64-frame fade), forward (with the
 * crossfade y = (1 − w)·interp(p) + w·interp(p − loopLength) over the last X
 * frames), pingpong (reverse at the loop markers, no crossfade). Loops continue
 * through the release.
 *
 * Envelope: linear attack, exponential decay toward sustain with
 * d = 10^(−4/(decay·fs)), the shared release. A sustain of 0 ends the voice
 * once the decay falls below 1e-4. `gate` releases on note-off; `trigger`
 * ignores note-off. Filter: per-voice TPT lowpass, fc = cutoff·2^(amount·e·4),
 * coefficients every 16 frames (project limit); resonance 0–1 maps to
 * Q = 0.7071·(12/0.7071)^resonance.
 *
 * Voices: poly (16, shared stealing and auto-gain) or mono (one voice, a note
 * stack with last-note priority; legato notes glide with rate *= gGlide,
 * gGlide = (rTarget/rCurrent)^(1/(glide·fs)), clamped at the target).
 *
 * Output: stereo (`stereo = true`), overwriting its range. A mono source is
 * placed by `pan` with constant power; a stereo source is balanced by `pan`.
 * Velocity gain 0.3·((1 − s) + s·vn²), s = velSens; `level` in dB applies after
 * polyphony auto-gain.
 *
 * Sources: bindSource keeps references to the engine's channel and mip arrays
 * and never copies them. Each voice holds references to the arrays it started
 * on, so binding a different source or unbinding fades sounding voices over
 * 64 frames on their own data; rebinding the same channels (mips arriving
 * later) leaves them playing. Without a bound source (or with an invalid zone), note-on allocates
 * nothing and the output is silence.
 *
 * Transport stops (releaseSequenced): in gate mode sequenced notes release; in
 * trigger mode one-shots (loop off) keep ringing to their end, like drum hits,
 * and looping voices release, since they would otherwise never end.
 * All-notes-off and Panic end every voice in both modes.
 */
import { VOICES_PER_INSTRUMENT } from '../core/constants.js';
import { hermite } from '../core/interp.js';
import { dbToGain, flushDenormal } from '../core/math.js';
import { clampParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { LOWPASS, svfCoefficients, svfTick } from '../effects/svf.js';
import { LIVE_NOTE_BASE } from '../engine/live-input.js';
import { balance, constantPower } from '../mixer/pan.js';
import { ATTACK, AdsrBank, DECAY, IDLE, RELEASE, STEAL } from './envelope.js';

export { AdsrBank, DECAY };
import { PolyKernel } from './poly-kernel.js';
import {
  LOOP_FORWARD, LOOP_OFF, LOOP_PINGPONG, MAX_TRANSPOSE, SAMPLER_DEF, SAMPLER_PARAMS,
  ZONE_CROSSFADE, ZONE_END, ZONE_FIELDS, ZONE_LOOP_END, ZONE_LOOP_START, ZONE_START, resolveZoneInto,
} from './sampler-zones.js';
import { VoicePool } from './voice-pool.js';

export { SAMPLER_PARAMS };

/** Mip levels: level 0 (the source) and the two half-band levels. */
export const MIP_LEVELS = 3;

/** Read step per unit rate at each level: 2^−L. */
const MIP_STEP = Float64Array.of(1, 0.5, 0.25);

/** Frames between filter coefficient updates (project limit). */
export const FILTER_INTERVAL = 16;

/** Filter Q at resonance 0 and 1. */
const Q_MIN = 0.7071;
const Q_MAX = 12;

/** Lowest modulated cutoff, Hz. */
const MIN_FC = 10;

/** Mip level for rate `r` when `levels` levels are bound: clamp(ceil(log2 r), 0, 2), or 0. */
function mipLevel(r, levels) {
  if (levels < MIP_LEVELS) return 0;
  const l = Math.ceil(Math.log2(r));
  return l < 0 ? 0 : l > MIP_LEVELS - 1 ? MIP_LEVELS - 1 : l;
}

/** rd(j): wraps j ≥ wrapAt back by `len` (forward loops), then clamps to [lo, hi]. */
function rd(data, j, lo, hi, wrapAt, len) {
  const k = j >= wrapAt ? j - len : j;
  return data[k < lo ? lo : k > hi ? hi : k];
}

/** Hermite read of `data` at position `pos` (frames ≥ 0). */
function interp(data, pos, lo, hi, wrapAt, len) {
  const i = pos | 0;
  return hermite(
    rd(data, i - 1, lo, hi, wrapAt, len),
    rd(data, i, lo, hi, wrapAt, len),
    rd(data, i + 1, lo, hi, wrapAt, len),
    rd(data, i + 2, lo, hi, wrapAt, len),
    pos - i,
  );
}

/** Frames shared by every channel of `channels`, or 0 when it is not a non-empty Float32Array list. */
function sourceFrames(channels) {
  if (!Array.isArray(channels) || channels.length === 0) return 0;
  let frames = Infinity;
  const n = channels.length > 2 ? 2 : channels.length;
  for (let c = 0; c < n; c++) {
    if (!(channels[c] instanceof Float32Array)) return 0;
    if (channels[c].length < frames) frames = channels[c].length;
  }
  return frames;
}

/** True when `mips` is [[level 1 channels], [level 2 channels]] matching `channelCount` and `frames`. */
function validMips(mips, channelCount, frames) {
  if (!Array.isArray(mips) || mips.length < MIP_LEVELS - 1) return false;
  for (let l = 1; l < MIP_LEVELS; l++) {
    const level = mips[l - 1];
    if (!Array.isArray(level) || level.length < channelCount) return false;
    const expected = Math.ceil(frames / 2 ** l);
    for (let c = 0; c < channelCount; c++) {
      const data = level[c];
      if (!(data instanceof Float32Array) || Math.abs(data.length - expected) > 1 || data.length === 0) return false;
    }
  }
  return true;
}

export class SamplerKernel extends PolyKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   */
  constructor(fs, global) {
    super(fs, global);
    this.stereo = true;
    this.env = new AdsrBank(fs, this.slots);
    this.pool = new VoicePool(this.env, global, VOICES_PER_INSTRUMENT);
    const n = this.slots;
    // Voice state, struct-of-arrays. Positions are in level-L frames.
    this.pos = new Float64Array(n);
    this.rate = new Float64Array(n);
    this.target = new Float64Array(n);
    this.gGlide = new Float64Array(n);
    this.dir = new Int8Array(n);
    this.mip = new Int8Array(n);
    this.mode = new Int8Array(n);
    this.vzone = new Float64Array(n * ZONE_FIELDS); // the voice's markers at its level
    this.srcA = new Array(n).fill(null); // channel 0 (or mono) data the voice reads
    this.srcB = new Array(n).fill(null); // channel 1 data, or null for a mono source
    this.coef = new Float64Array(4 * n); // [a1, a2, a3, k] per voice
    this.state = new Float64Array(4 * n); // [ic1, ic2] per voice per channel
    this.coefCount = new Int32Array(n); // frames until the next coefficient update
    // Source binding.
    this.channels = null;
    this.mips = null;
    this.sourceName = '';
    this.stereoSource = false;
    this.levels = 0; // bound levels: 0 (none), 1 (level 0 only) or MIP_LEVELS
    this.levelFrames = new Float64Array(MIP_LEVELS);
    this.zone = new Float64Array(ZONE_FIELDS); // level-0 markers
    this.levelZone = new Float64Array(MIP_LEVELS * ZONE_FIELDS);
    this.zoneOk = false;
    this.missingPending = false;
    this.zoneReport = null;
    // Mono note stack (last-note priority).
    this.monoVoice = -1;
    this.heldIds = new Int32Array(VOICES_PER_INSTRUMENT);
    this.heldRates = new Float64Array(VOICES_PER_INSTRUMENT);
    this.heldCount = 0;
    // Parameters.
    this.cutoff = new Smoother(fs, SAMPLER_DEF.cutoff.default);
    this.pan = new Smoother(fs, SAMPLER_DEF.pan.default);
    this.levelGain = new Smoother(fs, 1);
    this.panGains = new Float64Array(4); // constant power [L, R], balance [L, R]
    this.mono = false;
    for (const def of SAMPLER_PARAMS) this.setParam(def.id, def.default);
  }

  /** Sets a parameter by id; the value is clamped through its ParamDef. Unknown ids are ignored. */
  setParam(id, value) {
    if (!Object.hasOwn(SAMPLER_DEF, id)) return;
    const v = clampParam(SAMPLER_DEF[id], value);
    switch (id) {
      case 'rootNote': this.rootNote = v; break;
      case 'fineTune': this.fineTune = v; break;
      case 'start': this.start = v; this.#rezone(false); break;
      case 'end': this.end = v; this.#rezone(false); break;
      case 'loopMode': this.loopMode = v; this.#rezone(false); break;
      case 'loopStart': this.loopStart = v; this.#rezone(false); break;
      case 'loopEnd': this.loopEnd = v; this.#rezone(false); break;
      case 'loopCrossfade': this.loopCrossfade = v; this.#rezone(false); break;
      case 'trigger': this.oneShot = v === 1; break;
      case 'attack': this.attack = v / 1000; break;
      case 'decay': this.env.setDecay(v / 1000); break;
      case 'sustain': this.env.sustain = v; break;
      case 'release': this.release = v / 1000; break;
      case 'cutoff': this.cutoff.setTarget(v); break;
      case 'resonance': this.q = Q_MIN * (Q_MAX / Q_MIN) ** v; break;
      case 'filterEnvAmount': this.envAmount = v; break;
      case 'velSens': this.velSens = v; break;
      case 'voiceMode':
        if ((v === 1) !== this.mono) {
          this.mono = v === 1;
          this.heldCount = 0;
          this.monoVoice = -1;
        }
        break;
      case 'glide': this.glide = v / 1000; break;
      case 'pan': this.pan.setTarget(v); break;
      default: this.levelGain.setTarget(dbToGain(v)); // level
    }
  }

  /**
   * Binds a source by reference (onmessage). `channels` are the engine's
   * level-0 arrays (1 or 2 used); `mips` is [[level 1 channels], [level 2
   * channels]] or null (level 0 only). A different source fades sounding
   * voices. An invalid `channels` acts as unbindSource. Returns true when the
   * zone is valid and notes can start.
   * @param {Float32Array[] | null} channels level-0 channel data
   * @param {Float32Array[][] | null} mips half-band levels 1 and 2
   * @param {string} [sourceName] shown in "Audio not loaded: <name>"
   * @returns {boolean}
   */
  bindSource(channels, mips, sourceName = '') {
    const frames = sourceFrames(channels);
    if (frames === 0) {
      this.unbindSource();
      return false;
    }
    if (channels !== this.channels) this.allNotesOff(true);
    const count = channels.length > 1 ? 2 : 1;
    this.channels = channels;
    this.sourceName = sourceName;
    this.stereoSource = count === 2;
    this.levelFrames[0] = frames;
    this.mips = validMips(mips, count, frames) ? mips : null;
    this.levels = this.mips === null ? 1 : MIP_LEVELS;
    for (let l = 1; l < this.levels; l++) {
      const level = this.mips[l - 1];
      this.levelFrames[l] = count === 2 ? Math.min(level[0].length, level[1].length) : level[0].length;
    }
    this.missingPending = false;
    this.#rezone(true);
    return this.zoneOk;
  }

  /** Drops the source binding (onmessage): sounding voices fade over 64 frames, and a missing report is pending. */
  unbindSource() {
    this.allNotesOff(true);
    this.channels = null;
    this.mips = null;
    this.levels = 0;
    this.zoneOk = false;
    this.missingPending = true;
  }

  /** True once after an unbind or a failed bind: the engine posts `source-status` `missing`. */
  takeMissingReport() {
    const pending = this.missingPending;
    this.missingPending = false;
    return pending;
  }

  /** A reason string once after a bind or marker change made the zone invalid (`sampler-zone-invalid`), else null. */
  takeZoneReport() {
    const reason = this.zoneReport;
    this.zoneReport = null;
    return reason;
  }

  /** Resolves the markers for the bound source; `report` reports any failure, otherwise only a valid → invalid change. */
  #rezone(report) {
    if (this.channels === null) return;
    const z = this.zone;
    const reason = resolveZoneInto(
      z, this.start, this.end, this.loopMode, this.loopStart, this.loopEnd, this.loopCrossfade, this.levelFrames[0], this.fs,
    );
    if (reason !== null) {
      if (report || this.zoneOk) this.zoneReport = reason;
      this.zoneOk = false;
      return;
    }
    for (let l = 0; l < this.levels; l++) {
      const s = MIP_STEP[l];
      const frames = this.levelFrames[l];
      let zs = Math.round(z[ZONE_START] * s);
      if (zs > frames - 1) zs = frames - 1;
      let ze = Math.round(z[ZONE_END] * s);
      if (ze > frames) ze = frames;
      if (ze < zs + 1) ze = zs + 1;
      let ls = Math.round(z[ZONE_LOOP_START] * s);
      ls = ls < zs ? zs : ls > ze ? ze : ls;
      let le = Math.round(z[ZONE_LOOP_END] * s);
      le = le < ls ? ls : le > ze ? ze : le;
      let x = z[ZONE_CROSSFADE] * s;
      if (x > (le - ls) / 2) x = (le - ls) / 2;
      if (x > ls - zs) x = ls - zs;
      const o = l * ZONE_FIELDS;
      this.levelZone[o + ZONE_START] = zs;
      this.levelZone[o + ZONE_END] = ze;
      this.levelZone[o + ZONE_LOOP_START] = ls;
      this.levelZone[o + ZONE_LOOP_END] = le;
      this.levelZone[o + ZONE_CROSSFADE] = x;
    }
    this.zoneOk = true;
  }

  /** Velocity gain 0.3·((1 − s) + s·(vel/127)²), s = velSens. */
  velocityGain(velocity) {
    const vn = velocity / 127;
    const s = this.velSens;
    return 0.3 * (1 - s + s * vn * vn);
  }

  /** Starts note `noteId` at MIDI `pitch` (0–127) with `velocity` (1–127); ignored without a valid source or beyond ±24 semitones. */
  noteOn(noteId, pitch, velocity) {
    if (!this.zoneOk) return;
    const semis = pitch - this.rootNote;
    if (semis > MAX_TRANSPOSE || semis < -MAX_TRANSPOSE) return;
    const r = 2 ** (semis / 12 + this.fineTune / 1200);
    if (this.mono) this.#monoOn(noteId, velocity, r);
    else this.#voiceOn(noteId, velocity, r);
  }

  /** Allocates and starts a voice at rate `r`; returns its slot or −1. */
  #voiceOn(noteId, velocity, r) {
    const v = this.pool.allocate(noteId);
    if (v < 0) return -1;
    this.gain[v] = this.velocityGain(velocity);
    this.rate[v] = r;
    this.target[v] = r;
    this.gGlide[v] = 1;
    this.mode[v] = this.loopMode;
    this.dir[v] = 1;
    this.#setLevel(v, mipLevel(r, this.levels));
    this.pos[v] = this.vzone[v * ZONE_FIELDS + ZONE_START];
    const s = 4 * v;
    this.state[s] = 0;
    this.state[s + 1] = 0;
    this.state[s + 2] = 0;
    this.state[s + 3] = 0;
    this.coefCount[v] = 0;
    this.env.start(v, this.attack);
    return v;
  }

  /** Points voice `v` at mip level `l` of the bound source: data references and markers. */
  #setLevel(v, l) {
    this.mip[v] = l;
    const level = l === 0 ? this.channels : this.mips[l - 1];
    this.srcA[v] = level[0];
    this.srcB[v] = this.stereoSource ? level[1] : null;
    const from = l * ZONE_FIELDS;
    const to = v * ZONE_FIELDS;
    for (let f = 0; f < ZONE_FIELDS; f++) this.vzone[to + f] = this.levelZone[from + f];
  }

  /** Mono note-on: a held voice glides (legato); otherwise a new voice starts and a releasing one fades. */
  #monoOn(noteId, velocity, r) {
    this.#push(noteId, r);
    const m = this.monoVoice;
    const stage = m >= 0 ? this.env.stage[m] : IDLE;
    if (stage === ATTACK || stage === DECAY) {
      this.pool.noteId[m] = noteId;
      this.#glideTo(m, r);
      return;
    }
    if (stage === RELEASE) {
      this.env.steal(m);
      this.pool.detach(m);
    }
    this.monoVoice = this.#voiceOn(noteId, velocity, r);
  }

  /** Glides voice `v` toward rate `r` over `glide` seconds; the mip level follows max(rCurrent, r). */
  #glideTo(v, r) {
    const current = this.rate[v];
    this.target[v] = r;
    const l = mipLevel(current > r ? current : r, this.levels);
    if (l !== this.mip[v]) {
      let pos = this.pos[v] * 2 ** (this.mip[v] - l);
      this.#setLevel(v, l);
      const z = v * ZONE_FIELDS;
      const lo = this.vzone[z + ZONE_START];
      const hi = this.vzone[z + ZONE_END];
      pos = pos < lo ? lo : pos > hi ? hi : pos;
      this.pos[v] = pos;
    }
    if (this.glide <= 0 || current === r) {
      this.rate[v] = r;
      this.gGlide[v] = 1;
    } else {
      this.gGlide[v] = (r / current) ** (1 / (this.glide * this.fs));
    }
  }

  /** Pushes a held mono note; a full stack drops its oldest entry. */
  #push(noteId, r) {
    if (this.heldCount === this.heldIds.length) {
      this.heldIds.copyWithin(0, 1);
      this.heldRates.copyWithin(0, 1);
      this.heldCount--;
    }
    this.heldIds[this.heldCount] = noteId;
    this.heldRates[this.heldCount] = r;
    this.heldCount++;
  }

  /** Removes `noteId` from the mono stack, if present. */
  #remove(noteId) {
    for (let i = this.heldCount - 1; i >= 0; i--) {
      if (this.heldIds[i] !== noteId) continue;
      this.heldIds.copyWithin(i, i + 1, this.heldCount);
      this.heldRates.copyWithin(i, i + 1, this.heldCount);
      this.heldCount--;
      return;
    }
  }

  /** Releases note `noteId` in gate mode; trigger mode ignores note-off. Unknown ids are ignored. */
  noteOff(noteId) {
    if (this.mono) {
      this.#monoOff(noteId);
      return;
    }
    if (this.oneShot) return;
    super.noteOff(noteId);
  }

  /** Mono note-off: the sounding note glides back to the newest held note, or releases when none is held. */
  #monoOff(noteId) {
    this.#remove(noteId);
    if (this.oneShot) return;
    const m = this.monoVoice;
    if (m >= 0 && this.env.stage[m] !== IDLE && this.pool.noteId[m] === noteId) {
      if (this.heldCount > 0) {
        const top = this.heldCount - 1;
        this.pool.noteId[m] = this.heldIds[top];
        this.#glideTo(m, this.heldRates[top]);
      } else {
        this.env.release(m, this.release);
        this.pool.detach(m);
      }
      return;
    }
    super.noteOff(noteId); // a voice started in poly mode
  }

  /** Releases every voice; `hard` fades them over 64 frames instead (Panic). Both trigger modes. */
  allNotesOff(hard) {
    super.allNotesOff(hard);
    this.heldCount = 0;
    this.monoVoice = -1;
  }

  /**
   * Releases held sequenced notes (transport stop, loop wrap); live notes keep
   * sounding. In trigger mode, one-shot voices (loop off) keep ringing to
   * their end; looping voices release.
   */
  releaseSequenced() {
    let k = 0;
    for (let i = 0; i < this.heldCount; i++) {
      if (this.heldIds[i] < LIVE_NOTE_BASE) continue;
      this.heldIds[k] = this.heldIds[i];
      this.heldRates[k] = this.heldRates[i];
      k++;
    }
    this.heldCount = k;
    for (let v = 0; v < this.slots; v++) {
      const id = this.pool.noteId[v];
      if (id < 0 || id >= LIVE_NOTE_BASE || this.env.stage[v] === IDLE) continue;
      if (this.oneShot && this.mode[v] === LOOP_OFF) continue;
      this.env.release(v, this.release);
      this.pool.detach(v);
    }
  }

  /** Renders frames [start, end) into both channels, overwriting them. */
  render(outL, outR, start, end) {
    outL.fill(0, start, end);
    outR.fill(0, start, end);
    this.beginBlock(end - start);
    const env = this.env;
    const sounding = this.pool.sounding();
    this.polyGain.setTarget(sounding > 0 ? Math.min(1, 2 / Math.sqrt(sounding)) : 1);
    for (let v = 0; v < this.slots; v++) {
      if (env.stage[v] !== IDLE) this.renderVoice(v, outL, outR, start, end);
      if (env.stage[v] === IDLE && this.srcA[v] !== null) {
        this.srcA[v] = null; // the voice no longer holds the source
        this.srcB[v] = null;
      }
    }
    const poly = this.polyGain;
    const level = this.levelGain;
    for (let i = start; i < end; i++) {
      const g = poly.next() * level.next();
      outL[i] *= g;
      outR[i] *= g;
    }
    poly.flush();
    level.flush();
    this.endBlock();
    this.pool.reap();
    if (this.monoVoice >= 0 && env.stage[this.monoVoice] === IDLE) this.monoVoice = -1;
  }

  /** Smoothed cutoff and pan advance over the block; pan gains once per block. */
  beginBlock(n) {
    for (let i = 0; i < n; i++) {
      this.cutoff.next();
      this.pan.next();
    }
    constantPower(this.pan.y, this.panGains, 0);
    balance(this.pan.y, this.panGains, 2);
  }

  /** Filter coefficients for voice `v` from its envelope level (every FILTER_INTERVAL frames). */
  #voiceCoefficients(v) {
    let fc = this.cutoff.y;
    if (this.envAmount !== 0) fc *= Math.exp(this.envAmount * this.env.level[v] * 4 * Math.LN2);
    svfCoefficients(this.coef, 4 * v, fc < MIN_FC ? MIN_FC : fc, this.q, this.fs);
  }

  /** Adds voice `v` (× velocity gain × envelope, panned) into frames [start, end). */
  renderVoice(v, outL, outR, start, end) {
    const env = this.env;
    const a = this.srcA[v];
    const b = this.srcB[v];
    const z = v * ZONE_FIELDS;
    const vz = this.vzone;
    const lo = vz[z + ZONE_START];
    const zoneEnd = vz[z + ZONE_END];
    const hi = zoneEnd - 1;
    const ls = vz[z + ZONE_LOOP_START];
    const le = vz[z + ZONE_LOOP_END];
    const len = le - ls;
    const x = vz[z + ZONE_CROSSFADE];
    const mode = this.mode[v];
    const wrapAt = mode === LOOP_FORWARD ? le : Infinity;
    const fadeFrom = mode === LOOP_FORWARD && x > 0 ? le - x : Infinity;
    const scale = MIP_STEP[this.mip[v]];
    const g = this.gain[v];
    const coef = this.coef;
    const state = this.state;
    const c = 4 * v;
    const gl = b === null ? this.panGains[0] : this.panGains[2];
    const gr = b === null ? this.panGains[1] : this.panGains[3];
    const target = this.target[v];
    let glide = this.gGlide[v];
    let rate = this.rate[v];
    let pos = this.pos[v];
    let dir = this.dir[v];
    let count = this.coefCount[v];
    for (let i = start; i < end; i++) {
      if (count === 0) {
        this.#voiceCoefficients(v);
        count = FILTER_INTERVAL;
      }
      count--;
      let ya = interp(a, pos, lo, hi, wrapAt, len);
      let yb = b === null ? 0 : interp(b, pos, lo, hi, wrapAt, len);
      if (pos >= fadeFrom) {
        const w = (pos - fadeFrom) / x;
        ya = (1 - w) * ya + w * interp(a, pos - len, lo, hi, wrapAt, len);
        if (b !== null) yb = (1 - w) * yb + w * interp(b, pos - len, lo, hi, wrapAt, len);
      }
      const e = env.next(v) * g;
      const ya2 = svfTick(ya, coef, c, state, c, LOWPASS) * e;
      if (b === null) {
        outL[i] += ya2 * gl;
        outR[i] += ya2 * gr;
      } else {
        outL[i] += ya2 * gl;
        outR[i] += svfTick(yb, coef, c, state, c + 2, LOWPASS) * e * gr;
      }
      if (glide !== 1) {
        rate *= glide;
        if (glide > 1 ? rate >= target : rate <= target) {
          rate = target;
          glide = 1;
        }
      }
      pos += dir * rate * scale;
      if (mode === LOOP_FORWARD) {
        if (pos >= le) {
          pos -= len;
          if (pos >= le) pos = ls + ((pos - ls) % len);
        }
      } else if (mode === LOOP_PINGPONG) {
        if (dir > 0 && pos >= le) {
          pos = 2 * le - pos;
          dir = -1;
          if (pos < ls) pos = ls;
        } else if (dir < 0 && pos < ls) {
          pos = 2 * ls - pos;
          dir = 1;
          if (pos > le) pos = le;
        }
      } else if (pos >= zoneEnd) {
        pos = zoneEnd;
        if (env.stage[v] !== STEAL && env.stage[v] !== IDLE) {
          env.steal(v); // end of the region: 64-frame fade
          this.pool.detach(v);
        }
      }
      if (env.stage[v] === IDLE) break;
    }
    this.pos[v] = pos;
    this.dir[v] = dir;
    this.rate[v] = rate;
    this.gGlide[v] = glide;
    this.coefCount[v] = count;
    for (let j = c; j < c + 4; j++) state[j] = flushDenormal(state[j]);
    env.flush(v);
  }

  endBlock() {
    this.cutoff.flush();
    this.pan.flush();
  }
}
