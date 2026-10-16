/*
 * Engine kernel (a3-audio-implementation.md, Engine block loop): transport,
 * loop wrap, sequenced instrument tracks, metronome and master volume. Tracks
 * mix at centre with constant-power gain until the mixer stage exists. EngineProcessor is a thin wrapper; Node tests run
 * this class directly. process() allocates nothing.
 */
import { BLOCK } from '../core/constants.js';
import { dbToGain } from '../core/math.js';
import { hash32 } from '../core/prng.js';
import { clampParam, defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { GlobalVoices } from '../instruments/voice-pool.js';
import { instrumentFor } from '../instruments/registry.js';
import { Metronome } from './metronome.js';
import { buildEngineModel, emptyModel } from './model.js';
import { renderTrack, reseek } from './sequencer.js';

/** Constant-power centre gain, cos(π/4). */
const CENTRE = Math.SQRT1_2;

/** Master volume, dB: default −12, maximum 0 (assignment-3-scope.md, Mixer). */
export const MASTER_VOLUME = defineParam({ id: 'masterVolume', min: -60, max: 0, default: -12, unit: 'dB', scale: 'lin' });

/** Metronome level relative to its −12 dB click, dB. */
export const METRONOME_GAIN = defineParam({ id: 'metronomeGain', min: -60, max: 0, default: 0, unit: 'dB', scale: 'lin' });

export class Engine {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.fs = fs;
    this.seed = 1; // project seed for per-track noise (init message)
    this.globalVoices = new GlobalVoices();
    this.kernels = new Map(); // deviceId → kernel, reused across models
    this.generation = 0;
    this.trackBuf = new Float32Array(BLOCK);
    this.model = buildEngineModel(emptyModel(fs));
    this.metronome = new Metronome(fs);
    this.metronomeOn = false;
    this.metronomeGain = 1;
    this.master = new Smoother(fs, dbToGain(MASTER_VOLUME.default));
    this.playing = false;
    this.playFrame = 0;
    this.loopOn = false;
    this.loopStart = this.model.loopStartFrame;
    this.loopEnd = this.model.loopEndFrame;
    this.beatDirty = true;
    this.nextBeatFrame = 0;
    this.nextBeatAccent = false;
  }

  /**
   * Builds a compiled model from a validated payload (allocates; call from
   * onmessage or a test, never from process()). Kernels are reused by device
   * ID, so sound continues across edits; payload params are applied to them.
   */
  prepareModel(payload) {
    const generation = ++this.generation;
    const next = new Map();
    let trackIndex = 0;
    const compiled = buildEngineModel(payload, (track) => {
      const index = trackIndex++;
      const entry = instrumentFor(track.type);
      if (!entry) return null;
      let kernel = this.kernels.get(track.deviceId);
      if (!kernel || kernel.type !== track.type) {
        kernel = new entry.Kernel(this.fs, this.globalVoices);
        kernel.type = track.type;
      }
      for (const [id, value] of Object.entries(track.params ?? {})) kernel.setParam(id, value);
      kernel.seed = hash32(this.seed, index, 0);
      kernel.generation = generation;
      next.set(track.deviceId, kernel);
      return kernel;
    });
    compiled.generation = generation;
    this.kernels = next;
    return compiled;
  }

  /**
   * Swaps in a compiled model. The playhead and loop stay; sequenced notes are
   * released (note IDs change with the model) and kernels the new model no
   * longer uses give back their voices.
   */
  setModel(compiled) {
    const old = this.model.tracks;
    for (let i = 0; i < old.length; i++) {
      const k = old[i].kernel;
      if (k !== null && k.generation !== compiled.generation) k.pool.clear();
    }
    this.model = compiled;
    this.releaseNotes();
    this.reseekTracks(this.playFrame);
    this.beatDirty = true;
  }

  /** Releases every sequenced note (live notes are unaffected once they exist). */
  releaseNotes() {
    const tracks = this.model.tracks;
    for (let i = 0; i < tracks.length; i++) if (tracks[i].kernel !== null) tracks[i].kernel.allNotesOff(false);
  }

  reseekTracks(frame) {
    const tracks = this.model.tracks;
    for (let i = 0; i < tracks.length; i++) reseek(tracks[i], frame);
  }

  /** Starts playback at `frame`. */
  play(frame) {
    this.releaseNotes();
    this.playFrame = frame;
    this.reseekTracks(frame);
    this.playing = true;
    this.beatDirty = true;
  }

  /** Stops playback in place; tails (the metronome click) finish. */
  stop() {
    this.playing = false;
    this.releaseNotes();
  }

  /** Moves the playhead to `frame`. */
  locate(frame) {
    if (this.playing) this.releaseNotes();
    this.playFrame = frame;
    this.reseekTracks(frame);
    this.beatDirty = true;
  }

  /** Sets the loop range [start, end) in frames and turns the loop on or off. */
  setLoop(on, start, end) {
    this.loopOn = on;
    this.loopStart = start;
    this.loopEnd = end;
    this.beatDirty = true;
  }

  /** Turns the metronome on or off; `gainDb` scales its click (clamped to METRONOME_GAIN). */
  setMetronome(on, gainDb = 0) {
    this.metronomeOn = on;
    this.metronomeGain = dbToGain(clampParam(METRONOME_GAIN, gainDb));
  }

  /** Sets master volume in dB (clamped to MASTER_VOLUME); smoothed. */
  setMasterVolume(db) {
    this.master.setTarget(dbToGain(clampParam(MASTER_VOLUME, db)));
  }

  /** Finds the first beat at or after `frame` and stores it in nextBeatFrame and nextBeatAccent. */
  findNextBeat(frame) {
    const tempo = this.model.tempo;
    const meter = this.model.meter;
    let t = tempo.tickAt(frame);
    if (tempo.frameAt(t) < frame) t++;
    const bar = meter.barAt(t);
    const barTick = meter.tickAtBar(bar);
    const beatTicks = meter.beatTicksAt(t);
    let k = Math.ceil((t - barTick) / beatTicks);
    let beatTick = barTick + k * beatTicks;
    if (k >= meter.beatsPerBarAt(t)) {
      beatTick = meter.tickAtBar(bar + 1);
      k = 0;
    }
    this.nextBeatFrame = tempo.frameAt(beatTick);
    this.nextBeatAccent = k === 0;
    this.beatDirty = false;
  }

  /** Renders frames [start, end) of both channels, overwriting them. */
  process(bufL, bufR, start, end) {
    for (let off = start; off < end; off += BLOCK) {
      const n = off + BLOCK < end ? BLOCK : end - off;
      bufL.fill(0, off, off + n);
      bufR.fill(0, off, off + n);
      this.renderBlock(bufL, bufR, off, n);
    }
  }

  renderBlock(bufL, bufR, off, n) {
    // `>=`: a block that ends exactly at the loop end still wraps.
    if (this.playing && this.loopOn && this.playFrame < this.loopEnd && this.playFrame + n >= this.loopEnd) {
      const a = this.loopEnd - this.playFrame;
      this.renderSpan(bufL, bufR, off, a);
      this.releaseNotes();
      this.playFrame = this.loopStart;
      this.reseekTracks(this.loopStart);
      this.beatDirty = true;
      this.renderSpan(bufL, bufR, off + a, n - a);
    } else {
      this.renderSpan(bufL, bufR, off, n);
    }
    this.master.flush();
  }

  renderSpan(bufL, bufR, off, n) {
    if (n <= 0) return;
    const end = off + n;
    const tracks = this.model.tracks;
    const tb = this.trackBuf;
    for (let t = 0; t < tracks.length; t++) {
      renderTrack(tracks[t], tb, n, this.playFrame, this.playing);
      for (let i = 0; i < n; i++) {
        const x = tb[i] * CENTRE;
        bufL[off + i] += x;
        bufR[off + i] += x;
      }
    }
    if (this.playing) {
      if (this.beatDirty) this.findNextBeat(this.playFrame);
      let pos = off;
      while (this.nextBeatFrame < this.playFrame + n) {
        const at = off + (this.nextBeatFrame - this.playFrame);
        this.metronome.render(bufL, bufR, pos, at);
        if (this.metronomeOn) this.metronome.trigger(this.nextBeatAccent, this.metronomeGain);
        pos = at;
        this.findNextBeat(this.nextBeatFrame + 1);
      }
      this.metronome.render(bufL, bufR, pos, end);
      this.playFrame += n;
    } else {
      this.metronome.render(bufL, bufR, off, end);
    }
    const master = this.master;
    for (let i = off; i < end; i++) {
      const g = master.next();
      bufL[i] *= g;
      bufR[i] *= g;
    }
  }
}
