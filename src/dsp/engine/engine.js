/*
 * Engine kernel (a3-audio-implementation.md, Engine block loop): transport,
 * loop wrap, metronome and master volume. Instruments, clips and the mixer
 * join in later sub-steps. EngineProcessor is a thin wrapper; Node tests run
 * this class directly. process() allocates nothing.
 */
import { BLOCK } from '../core/constants.js';
import { dbToGain } from '../core/math.js';
import { clampParam, defineParam } from '../core/params.js';
import { Smoother } from '../core/smoother.js';
import { Metronome } from './metronome.js';
import { buildEngineModel, emptyModel } from './model.js';

/** Master volume, dB: default −12, maximum 0 (assignment-3-scope.md, Mixer). */
export const MASTER_VOLUME = defineParam({ id: 'masterVolume', min: -60, max: 0, default: -12, unit: 'dB', scale: 'lin' });

/** Metronome level relative to its −12 dB click, dB. */
export const METRONOME_GAIN = defineParam({ id: 'metronomeGain', min: -60, max: 0, default: 0, unit: 'dB', scale: 'lin' });

export class Engine {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.fs = fs;
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

  /** Swaps in a compiled model (from buildEngineModel). The playhead and loop stay. */
  setModel(compiled) {
    this.model = compiled;
    this.beatDirty = true;
  }

  /** Starts playback at `frame`. */
  play(frame) {
    this.playFrame = frame;
    this.playing = true;
    this.beatDirty = true;
  }

  /** Stops playback in place; tails (the metronome click) finish. */
  stop() {
    this.playing = false;
  }

  /** Moves the playhead to `frame`. */
  locate(frame) {
    this.playFrame = frame;
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
      this.playFrame = this.loopStart;
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
