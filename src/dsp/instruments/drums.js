/*
 * Drum machine (assignment-3-scope.md, Instruments; a3-audio-implementation.md,
 * Drum machine): 14 synthesized voices behind the GM percussion map, no
 * samples. Renders stereo (per-voice constant-power pan), overwriting its range.
 *
 * Instances: 16 held (instrument cap) plus slots for 64-frame fades. Each voice
 * is monophonic except crash and ride (2 instances). Retriggering fades the
 * prior instance over 64 frames. Note-off has no effect; an instance ends when
 * its envelope falls below 1e-4. Every instance counts as released from
 * note-on, so stealing takes the quietest. With kit.choke on, closed and pedal
 * hat end open-hat instances. Velocity gain 0.3·((1 − s) + s·vn²) and timbre
 * term v = (1 − s) + s·vn, with s = kit.velSens and vn = vel/127.
 */
import { VOICES_PER_INSTRUMENT } from '../core/constants.js';
import { dbToGain, flushDenormal } from '../core/math.js';
import { clampParam, defineParam } from '../core/params.js';
import { Mulberry32, hash32 } from '../core/prng.js';
import { Smoother } from '../core/smoother.js';
import * as clap from './drum-voices/clap.js';
import * as claves from './drum-voices/claves.js';
import * as cowbell from './drum-voices/cowbell.js';
import * as kick from './drum-voices/kick.js';
import * as metal from './drum-voices/metal.js';
import * as sidestick from './drum-voices/sidestick.js';
import * as snare from './drum-voices/snare.js';
import * as tom from './drum-voices/tom.js';
import {
  CLAP, CLAVES, CLOSED_HAT, COWBELL, CRASH, DRUM_VOICES, HIGH_TOM, KICK, LOW_TOM, MID_TOM,
  OPEN_HAT, PEDAL_HAT, RIDE, SIDESTICK, SNARE, offsetOfNote, voiceOfNote,
} from './drum-map.js';
import { EnvelopeBank, IDLE, RELEASE, STEAL } from './envelope.js';
import { VoicePool } from './voice-pool.js';

const VOICE_COUNT = DRUM_VOICES.length;
const END_LEVEL = 1e-4;

/** Base frequency (Hz) per voice; metal voices and the cowbell use a ratio r = 1. */
const BASE_HZ = new Float64Array(VOICE_COUNT);
BASE_HZ[KICK] = kick.KICK_BASE_HZ;
BASE_HZ[SNARE] = snare.SNARE_BASE_HZ;
BASE_HZ[SIDESTICK] = sidestick.SIDESTICK_BASE_HZ;
BASE_HZ[CLAP] = 1000;
BASE_HZ[CLOSED_HAT] = 1;
BASE_HZ[PEDAL_HAT] = 1;
BASE_HZ[OPEN_HAT] = 1;
BASE_HZ[LOW_TOM] = tom.TOM_BASE_HZ[LOW_TOM];
BASE_HZ[MID_TOM] = tom.TOM_BASE_HZ[MID_TOM];
BASE_HZ[HIGH_TOM] = tom.TOM_BASE_HZ[HIGH_TOM];
BASE_HZ[CRASH] = 1;
BASE_HZ[RIDE] = 1;
BASE_HZ[COWBELL] = 1;
BASE_HZ[CLAVES] = claves.CLAVES_BASE_HZ;

const FIELDS = ['level', 'tune', 'decay', 'tone', 'pan'];

/** The 73 parameters: kit.level, kit.velSens, kit.choke, then <voice>.<field> for 14 voices. */
export const DRUM_PARAMS = [
  defineParam({ id: 'kit.level', min: -60, max: 6, default: 0, unit: 'dB', scale: 'lin', step: 0.1 }),
  defineParam({ id: 'kit.velSens', min: 0, max: 1, default: 1, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'kit.choke', scale: 'enum', options: ['off', 'on'], default: 1 }),
  ...DRUM_VOICES.flatMap((voice) => [
    defineParam({ id: `${voice}.level`, min: -60, max: 6, default: 0, unit: 'dB', scale: 'lin', step: 0.1 }),
    defineParam({ id: `${voice}.tune`, min: -12, max: 12, default: 0, unit: 'st', scale: 'lin', step: 0.1 }),
    defineParam({ id: `${voice}.decay`, min: 0.1, max: 4, default: 1, unit: '×', scale: 'log' }),
    defineParam({ id: `${voice}.tone`, min: 0, max: 1, default: 0.5, unit: 'fraction', scale: 'lin', step: 0.01 }),
    defineParam({ id: `${voice}.pan`, min: -1, max: 1, default: 0, unit: 'pan', scale: 'lin', step: 0.01 }),
  ]),
];

const DEF = Object.fromEntries(DRUM_PARAMS.map((d) => [d.id, d]));
/** id → voice·5 + field for voice params; −1, −2, −3 for kit.level, kit.velSens, kit.choke. */
const CODE = Object.fromEntries(DRUM_PARAMS.map((d) => {
  if (d.id === 'kit.level') return [d.id, -1];
  if (d.id === 'kit.velSens') return [d.id, -2];
  if (d.id === 'kit.choke') return [d.id, -3];
  const [voice, field] = d.id.split('.');
  return [d.id, DRUM_VOICES.indexOf(voice) * FIELDS.length + FIELDS.indexOf(field)];
}));

export class DrumKernel {
  /**
   * @param {number} fs sample rate, Hz
   * @param {import('./voice-pool.js').GlobalVoices} global shared voice budget
   */
  constructor(fs, global) {
    this.fs = fs;
    this.stereo = true;
    this.seed = 1;
    const slots = VoicePool.slotsFor(VOICES_PER_INSTRUMENT);
    this.slots = slots;
    this.env = new EnvelopeBank(fs, slots); // gate: 1, or the 64-frame fade
    this.pool = new VoicePool(this.env, global);
    // Instance state, struct-of-arrays.
    this.vid = new Int8Array(slots);
    this.age = new Int32Array(slots);
    this.gain = new Float64Array(slots);
    this.ph = new Float64Array(slots * 8);
    this.inc = new Float64Array(slots * 8);
    this.p = new Float64Array(slots);
    this.gp = new Float64Array(slots);
    this.A = new Float64Array(slots);
    for (const name of ['e1', 'g1', 'e2', 'g2', 'e3', 'g3', 'lp', 'lpA', 'par1', 'par2', 'par3']) {
      this[name] = new Float64Array(slots);
    }
    this.svfCoef = new Float64Array(slots * 12);
    this.svfState = new Float64Array(slots * 6);
    this.rng = Array.from({ length: slots }, () => new Mulberry32(1));
    // Parameters: per voice, plus kit.
    this.params = new Float64Array(VOICE_COUNT * FIELDS.length);
    for (let v = 0; v < VOICE_COUNT; v++) {
      for (let f = 0; f < FIELDS.length; f++) this.params[v * 5 + f] = DEF[`${DRUM_VOICES[v]}.${FIELDS[f]}`].default;
    }
    this.levelGain = Array.from({ length: VOICE_COUNT }, () => new Smoother(fs, 1));
    this.pan = Array.from({ length: VOICE_COUNT }, () => new Smoother(fs, 0));
    this.panL = new Float64Array(VOICE_COUNT);
    this.panR = new Float64Array(VOICE_COUNT);
    this.gainL = new Float64Array(VOICE_COUNT);
    this.gainR = new Float64Array(VOICE_COUNT);
    this.kitGain = new Smoother(fs, 1);
    this.velSens = 1;
    this.choke = true;
    this.polyGain = new Smoother(fs, 1);
  }

  /** Sets one of the 73 parameters; values are clamped through their ParamDefs. */
  setParam(id, value) {
    const def = DEF[id];
    if (!def) return;
    const v = clampParam(def, value);
    const code = CODE[id];
    if (code === -1) this.kitGain.setTarget(dbToGain(v));
    else if (code === -2) this.velSens = v;
    else if (code === -3) this.choke = v === 1;
    else {
      this.params[code] = v;
      const voice = (code / 5) | 0;
      const field = code % 5;
      if (field === 0) this.levelGain[voice].setTarget(dbToGain(v));
      else if (field === 4) this.pan[voice].setTarget(v);
    }
  }

  /** Fades every live instance of `voice` (beyond `keep` newest) over 64 frames. */
  #fadeVoice(voice, keep) {
    let live = 0;
    for (let s = 0; s < this.slots; s++) {
      if (this.vid[s] === voice && this.env.stage[s] !== IDLE && this.env.stage[s] !== STEAL) live++;
    }
    while (live > keep) {
      let oldest = -1;
      for (let s = 0; s < this.slots; s++) {
        if (this.vid[s] !== voice || this.env.stage[s] === IDLE || this.env.stage[s] === STEAL) continue;
        if (oldest < 0 || this.pool.order[s] < this.pool.order[oldest]) oldest = s;
      }
      this.env.steal(oldest);
      this.pool.detach(oldest);
      live--;
    }
  }

  /** Starts a hit for MIDI note `pitch`; unmapped notes do nothing. `noteId` seeds the noise. */
  noteOn(noteId, pitch, velocity) {
    const voice = voiceOfNote[pitch];
    if (voice < 0) return;
    if (this.choke && (voice === CLOSED_HAT || voice === PEDAL_HAT)) this.#fadeVoice(OPEN_HAT, 0);
    this.#fadeVoice(voice, voice === CRASH || voice === RIDE ? 1 : 0);
    const s = this.pool.allocate(noteId);
    if (s < 0) return;
    const sens = this.velSens;
    const vn = velocity / 127;
    this.gain[s] = 0.3 * (1 - sens + sens * vn * vn);
    const timbre = 1 - sens + sens * vn;
    const base = voice * 5;
    const f = BASE_HZ[voice] * 2 ** ((this.params[base + 1] + offsetOfNote[pitch]) / 12);
    const decay = this.params[base + 2];
    const tone = this.params[base + 3];
    this.vid[s] = voice;
    this.age[s] = 0;
    this.e2[s] = 0;
    this.e3[s] = 0;
    this.rng[s].reseed(hash32(this.seed, noteId, 2));
    switch (voice) {
      case KICK: kick.start(this, s, f, decay, tone, timbre); break;
      case SNARE: snare.start(this, s, f, decay, tone, timbre); break;
      case SIDESTICK: sidestick.start(this, s, f, decay, tone); break;
      case CLAP: clap.start(this, s, f, decay, tone); break;
      case LOW_TOM: case MID_TOM: case HIGH_TOM: tom.start(this, s, f, decay, tone, timbre, voice); break;
      case COWBELL: cowbell.start(this, s, f, decay, tone); break;
      case CLAVES: claves.start(this, s, f, decay, tone); break;
      default: metal.start(this, s, f, decay, tone, timbre, voice);
    }
    // A gate at full level that counts as released from note-on.
    this.env.stage[s] = RELEASE;
    this.env.level[s] = 1;
    this.env.releaseMul[s] = 1;
  }

  /** Note-off has no effect on drum hits. */
  noteOff() {}

  /** Fades every instance over 64 frames (all-notes-off and Panic alike). */
  allNotesOff() {
    for (let s = 0; s < this.slots; s++) {
      if (this.env.stage[s] === IDLE) continue;
      this.env.steal(s);
      this.pool.detach(s);
    }
  }

  /** Sounding instances. */
  activeVoices() {
    return this.pool.sounding();
  }

  /** Live instances of `voice` (not fading), for tests. */
  instancesOf(voice) {
    let n = 0;
    for (let s = 0; s < this.slots; s++) if (this.vid[s] === voice && this.env.stage[s] === RELEASE) n++;
    return n;
  }

  #tick(voice, s) {
    switch (voice) {
      case KICK: return kick.tick(this, s);
      case SNARE: return snare.tick(this, s);
      case SIDESTICK: return sidestick.tick(this, s);
      case CLAP: return clap.tick(this, s);
      case LOW_TOM: case MID_TOM: case HIGH_TOM: return tom.tick(this, s);
      case COWBELL: return cowbell.tick(this, s);
      case CLAVES: return claves.tick(this, s);
      default: return metal.tick(this, s);
    }
  }

  #level(voice, s) {
    switch (voice) {
      case KICK: return kick.level(this, s);
      case SNARE: return snare.level(this, s);
      case SIDESTICK: return sidestick.level(this, s);
      case CLAP: return clap.level(this, s);
      case LOW_TOM: case MID_TOM: case HIGH_TOM: return tom.level(this, s);
      case COWBELL: return cowbell.level(this, s);
      case CLAVES: return claves.level(this, s);
      default: return metal.level(this, s);
    }
  }

  /** Renders frames [start, end) into both channels, overwriting them. */
  render(outL, outR, start, end) {
    const n = end - start;
    outL.fill(0, start, end);
    outR.fill(0, start, end);
    // Per block: smoothed level and pan per voice give channel gains.
    for (let i = 0; i < n; i++) this.kitGain.next();
    for (let v = 0; v < VOICE_COUNT; v++) {
      const lg = this.levelGain[v];
      const pn = this.pan[v];
      for (let i = 0; i < n; i++) {
        lg.next();
        pn.next();
      }
      const theta = ((pn.y + 1) * Math.PI) / 4;
      const g = lg.y * this.kitGain.y;
      this.gainL[v] = Math.cos(theta) * g;
      this.gainR[v] = Math.sin(theta) * g;
      lg.flush();
      pn.flush();
    }
    this.kitGain.flush();
    const sounding = this.pool.sounding();
    this.polyGain.setTarget(sounding > 0 ? Math.min(1, 2 / Math.sqrt(sounding)) : 1);
    const env = this.env;
    for (let s = 0; s < this.slots; s++) {
      if (env.stage[s] === IDLE) continue;
      const voice = this.vid[s];
      const gl = this.gainL[voice] * this.gain[s];
      const gr = this.gainR[voice] * this.gain[s];
      for (let i = start; i < end; i++) {
        const x = this.#tick(voice, s) * env.next(s);
        outL[i] += x * gl;
        outR[i] += x * gr;
        this.age[s]++;
        if (env.stage[s] === IDLE) break;
      }
      for (let j = 0; j < 6; j++) this.svfState[s * 6 + j] = flushDenormal(this.svfState[s * 6 + j]);
      this.lp[s] = flushDenormal(this.lp[s]);
      if (env.stage[s] === RELEASE) {
        const level = this.#level(voice, s);
        if (level < END_LEVEL) {
          env.stage[s] = IDLE;
          env.level[s] = 0;
          this.pool.detach(s);
        } else {
          env.level[s] = level; // stealing picks the quietest instance
          env.releaseMul[s] = 1;
        }
      }
    }
    const poly = this.polyGain;
    for (let i = start; i < end; i++) {
      const g = poly.next();
      outL[i] *= g;
      outR[i] *= g;
    }
    poly.flush();
    this.pool.reap();
  }
}
