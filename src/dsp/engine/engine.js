/*
 * Engine kernel (a3-audio-implementation.md, Engine block loop; Mixer and
 * metering): transport, loop wrap, sequenced instrument tracks through channel
 * strips, metronome, master volume and pan, meters and Panic.
 * EngineProcessor is a thin wrapper; Node tests run this class directly.
 * process() allocates nothing.
 *
 * Signal order: track source → insert chain (stereo; mono sources enter at
 * −3 dB per side and then pan by balance) → strip (gain, pan, mute/solo gate)
 * → master bus → master chain → metronome click → master volume → master pan
 * (balance) → safety node.
 */
import { BLOCK, STEAL_FADE_FRAMES } from '../core/constants.js';
import { dbToGain } from '../core/math.js';
import { hash32 } from '../core/prng.js';
import { clampParam, defineParam } from '../core/params.js';
import { Smoother, settleSmoothers } from '../core/smoother.js';
import { bindSources, createClipTrack, renderClips, startStopFade } from '../clips/clip-player.js';
import { GlobalVoices } from '../instruments/voice-pool.js';
import { instrumentFor } from '../instruments/registry.js';
import { EffectSlot } from '../effects/chain.js';
import { effectFor } from '../effects/registry.js';
import { MAX_REVERBS } from '../effects/reverb.js';
import { MeterBank } from '../mixer/meter.js';
import { ChannelStrip, PAN } from '../mixer/mixer.js';
import { balance } from '../mixer/pan.js';
import { MAX_TRACKS } from '../protocol.js';
import { FloodLimiter, applyLiveEvent } from './live-input.js';
import { Metronome } from './metronome.js';
import { buildEngineModel, emptyModel } from './model.js';
import { renderTrack, reseek } from './sequencer.js';

/** Master volume, dB: default −12, maximum 0 (assignment-3-scope.md, Mixer). */
export const MASTER_VOLUME = defineParam({ id: 'masterVolume', min: -60, max: 0, default: -12, unit: 'dB', scale: 'lin' });

/** Metronome level relative to its −12 dB click, dB. */
export const METRONOME_GAIN = defineParam({ id: 'metronomeGain', min: -60, max: 0, default: 0, unit: 'dB', scale: 'lin' });

/** `params` targets and parameter IDs (a3-audio-implementation.md, Main to engine). */
export const MASTER_TARGET = -1;
export const PARAM_GAIN = 0;
export const PARAM_PAN = 1;
export const PARAM_MUTE = 2;
export const PARAM_SOLO = 3;
/** Instrument parameter i of a track's kernel is paramId INSTRUMENT_PARAM_BASE + i. */
export const INSTRUMENT_PARAM_BASE = 100;
/**
 * Parameter k of insert slot s (on a track, or the master with target −1) is
 * EFFECT_PARAM_BASE + EFFECT_PARAM_STRIDE·s + k; k = EFFECT_BYPASS is bypass.
 */
export const EFFECT_PARAM_BASE = 1000;
export const EFFECT_PARAM_STRIDE = 100;
export const EFFECT_BYPASS = 99;

/** Faults queued between posts (preallocated; faults past it stay pending until the next quantum). */
const FAULT_QUEUE = 16;

/** Meter index of the master: after the track slots. */
export const MASTER_METER = MAX_TRACKS;

/** Instrument types bound to a source through sampler-zones: the sampler and granular's File source. */
const ZONE_TYPES = new Set(['sampler', 'granular']);

export class Engine {
  /** @param {number} fs sample rate, Hz */
  constructor(fs) {
    this.fs = fs;
    this.seed = 1; // project seed for per-track noise (init message)
    this.globalVoices = new GlobalVoices();
    this.kernels = new Map(); // deviceId → kernel, reused across models
    this.strips = new Map(); // trackId → ChannelStrip, reused across models
    this.clipTracks = new Map(); // trackId → clip player state of the last prepared model
    this.sources = new Map(); // sourceId → [Float32Array] or [L, R], from source-add
    this.mips = new Map(); // sourceId → [[level 1 channels], [level 2 channels]], from source-mips
    this.zones = new Map(); // sampler or granular deviceId → { sourceId, sourceName }, from sampler-zones
    this.reports = []; // source-status and sampler-zone-invalid messages to post
    this.slots = new Map(); // effect deviceId → EffectSlot, reused across models
    this.faults = Array.from({ length: FAULT_QUEUE }, () => ({ t: 'fault', v: 1, trackId: '', deviceId: '', slot: 0, kind: 'nonfinite' }));
    this.faultCount = 0;
    this.chainClearIn = 0; // frames until Panic clears effect state again, after the voice fades
    this.generation = 0;
    this.trackBuf = new Float32Array(BLOCK);
    this.trackBufR = new Float32Array(BLOCK);
    this.monoBuf = new Float32Array(BLOCK);
    this.stripL = new Float32Array(BLOCK);
    this.stripR = new Float32Array(BLOCK);
    this.meters = new MeterBank(MAX_TRACKS + 1);
    this.model = buildEngineModel(emptyModel(fs));
    this.metronome = new Metronome(fs);
    this.metronomeOn = false;
    this.metronomeGain = 1;
    this.master = new Smoother(fs, dbToGain(MASTER_VOLUME.default));
    this.masterPan = new Smoother(fs, 0);
    this.masterPanGains = new Float64Array(2);
    this.hasProject = false;
    this.liveLimiter = new FloodLimiter();
    this.framesRendered = 0;
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
   * ID and strips by track ID, so sound and smoothing continue across edits.
   * Objects created for this model snap their smoothers to the payload values.
   */
  prepareModel(payload) {
    const generation = ++this.generation;
    const kernels = new Map();
    const strips = new Map();
    const clipTracks = new Map();
    const slots = new Map();
    const bpm = payload.tempo?.[0]?.bpm ?? 120;
    let reverbs = 0;
    const compiled = buildEngineModel(
      payload,
      (track, index) => {
        const entry = instrumentFor(track.type);
        if (!entry) return null;
        let kernel = this.kernels.get(track.deviceId);
        const created = !kernel || kernel.type !== track.type;
        if (created) {
          kernel = new entry.Kernel(this.fs, this.globalVoices);
          kernel.type = track.type;
        }
        for (const [id, value] of Object.entries(track.params ?? {})) kernel.setParam(id, value);
        if (created) settleSmoothers(kernel);
        kernel.seed = hash32(this.seed, index, 0);
        kernel.generation = generation;
        kernel.deviceId = track.deviceId;
        kernels.set(track.deviceId, kernel);
        if (ZONE_TYPES.has(track.type)) this.bindSampler(kernel);
        return kernel;
      },
      (track) => {
        let strip = this.strips.get(track.trackId);
        const created = !strip;
        if (created) strip = new ChannelStrip(this.fs);
        strip.setGainDb(track.gainDb);
        strip.setPan(track.pan);
        strip.mute = track.mute;
        strip.solo = track.solo;
        strip.created = created;
        strips.set(track.trackId, strip);
        return strip;
      },
      (track) => {
        const clips = createClipTrack(track, this.fs, this.clipTracks.get(track.trackId) ?? null);
        bindSources(clips, this.sources);
        clipTracks.set(track.trackId, clips);
        return clips;
      },
      (effects) =>
        effects.map((e) => {
          const entry = effectFor(e.type);
          // Reverbs past the project limit and unknown types pass the signal through.
          if (!entry || (e.type === 'reverb' && ++reverbs > MAX_REVERBS)) return null;
          let slot = this.slots.get(e.deviceId);
          const created = !slot || slot.type !== e.type;
          if (created) {
            slot = new EffectSlot(this.fs, new entry.Kernel(this.fs));
            slot.type = e.type;
            slot.deviceId = e.deviceId;
          }
          for (const [id, value] of Object.entries(e.params)) slot.kernel.setParam(id, value);
          if (typeof slot.kernel.setTempo === 'function') slot.kernel.setTempo(bpm);
          // A faulted slot stays bypassed until the main thread turns it on with a params bypass edit.
          if (!slot.faulted) slot.setBypass(e.bypass);
          if (created) {
            settleSmoothers(slot.kernel);
            slot.wet = slot.target; // a new slot starts in its bypass state
          }
          slots.set(e.deviceId, slot);
          return slot;
        }),
    );
    updateGates(compiled.tracks);
    for (const t of compiled.tracks) {
      if (t.strip.created) settleSmoothers(t.strip);
      t.strip.created = false;
    }
    compiled.generation = generation;
    compiled.masterPan = clampParam(PAN, payload.masterPan ?? 0);
    this.kernels = kernels;
    this.strips = strips;
    this.clipTracks = clipTracks;
    this.slots = slots;
    return compiled;
  }

  /**
   * Stores a source's channels (source-add) and binds it in the current
   * model and in `pending` (a prepared model not yet swapped in).
   */
  addSource(sourceId, channels, pending = null) {
    this.sources.set(sourceId, channels);
    this.rebindSources(pending);
  }

  /** Drops a source and its mips (source-remove); clips and samplers that use it fall silent. */
  removeSource(sourceId, pending = null) {
    this.sources.delete(sourceId);
    this.mips.delete(sourceId);
    this.rebindSources(pending);
  }

  rebindSources(pending) {
    for (const model of pending === null ? [this.model] : [this.model, pending]) {
      for (const track of model.tracks) if (track.audio !== null) bindSources(track.audio, this.sources);
    }
    this.rebindSamplers();
  }

  /** Stores mip levels 1 and 2 for a source (source-mips: [{ level, channels }]) and rebinds samplers using it. */
  addMips(sourceId, levels) {
    this.mips.set(sourceId, [levels[0].channels, levels[1].channels]);
    this.rebindSamplers();
  }

  /** Sets a sampler's zone source (sampler-zones); a null sourceId unbinds it. */
  setZone(deviceId, zone) {
    if (zone && zone.sourceId) this.zones.set(deviceId, zone);
    else this.zones.delete(deviceId);
    const kernel = this.kernels.get(deviceId);
    if (ZONE_TYPES.has(kernel?.type)) this.bindSampler(kernel);
  }

  rebindSamplers() {
    for (const kernel of this.kernels.values()) if (ZONE_TYPES.has(kernel.type)) this.bindSampler(kernel);
  }

  /**
   * Binds a sampler kernel to its zone's source and mips by reference. A bind
   * attempt that changes nothing is skipped; others report source-status.
   */
  bindSampler(kernel) {
    const zone = this.zones.get(kernel.deviceId) ?? null;
    const channels = zone ? (this.sources.get(zone.sourceId) ?? null) : null;
    const mips = zone ? (this.mips.get(zone.sourceId) ?? null) : null;
    if (kernel.boundZone === zone && kernel.boundChannels === channels && kernel.boundMips === mips) return;
    kernel.boundZone = zone;
    kernel.boundChannels = channels;
    kernel.boundMips = mips;
    if (zone === null) {
      if (kernel.channels) kernel.unbindSource();
      kernel.takeMissingReport();
      return;
    }
    if (channels === null) {
      kernel.unbindSource();
      kernel.takeMissingReport();
      this.reports.push({ t: 'source-status', deviceId: kernel.deviceId, sourceId: zone.sourceId, status: 'missing' });
      return;
    }
    kernel.bindSource(channels, mips, zone.sourceName);
    this.reports.push({ t: 'source-status', deviceId: kernel.deviceId, sourceId: zone.sourceId, status: 'bound' });
  }

  /**
   * Returns and clears the reports gathered since the last call, adding any
   * zone a sampler rejected, and `reason: null` once a rejected zone is valid
   * again (allocates; call from onmessage).
   */
  takeReports() {
    for (const kernel of this.kernels.values()) {
      if (kernel.type !== 'sampler') continue;
      const reason = kernel.takeZoneReport();
      if (reason) {
        kernel.zoneRejected = true;
        this.reports.push({ t: 'sampler-zone-invalid', deviceId: kernel.deviceId, zoneIndex: 0, reason });
      } else if (kernel.zoneRejected && (kernel.zoneOk || !kernel.channels)) {
        kernel.zoneRejected = false;
        this.reports.push({ t: 'sampler-zone-invalid', deviceId: kernel.deviceId, zoneIndex: 0, reason: null });
      }
    }
    const out = this.reports;
    this.reports = [];
    return out;
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
    // The first project starts at its master pan; later models glide to theirs.
    if (this.hasProject) this.masterPan.setTarget(compiled.masterPan ?? 0);
    else this.masterPan.snap(compiled.masterPan ?? 0);
    this.hasProject = true;
    this.releaseNotes();
    this.reseekTracks(this.playFrame);
    this.beatDirty = true;
  }

  /**
   * Applies `params` triples [target, paramId, value] to `model`'s objects
   * (the current model, or a pending one whose objects it shares). Target −1
   * is the master; others are track indices. Unknown targets are ignored.
   */
  applyParams(values, model = this.model) {
    let gates = false;
    for (let i = 0; i + 2 < values.length; i += 3) {
      const target = values[i];
      const id = values[i + 1];
      const value = values[i + 2];
      if (target === MASTER_TARGET) {
        if (id === PARAM_PAN) this.masterPan.setTarget(clampParam(PAN, value));
        else if (id >= EFFECT_PARAM_BASE) applyEffectParam(model.masterChain, id, value);
        continue;
      }
      const track = model.tracks[target];
      if (!track) continue;
      if (id >= EFFECT_PARAM_BASE) {
        applyEffectParam(track.chain, id, value);
        continue;
      }
      if (id === PARAM_GAIN) track.strip.setGainDb(value);
      else if (id === PARAM_PAN) track.strip.setPan(value);
      else if (id === PARAM_MUTE) {
        track.strip.mute = value !== 0;
        gates = true;
      } else if (id === PARAM_SOLO) {
        track.strip.solo = value !== 0;
        gates = true;
      } else if (id >= INSTRUMENT_PARAM_BASE && track.kernel !== null) {
        const def = instrumentFor(track.kernel.type)?.params[id - INSTRUMENT_PARAM_BASE];
        if (def) track.kernel.setParam(def.id, value);
      }
    }
    if (gates) updateGates(model.tracks);
  }

  /** Releases every sequenced note; live notes keep sounding. */
  releaseNotes() {
    const tracks = this.model.tracks;
    for (let i = 0; i < tracks.length; i++) if (tracks[i].kernel !== null) tracks[i].kernel.releaseSequenced();
  }

  /**
   * Applies one live MIDI message to track `trackIndex` (live-input.js).
   * Returns false when the flood limit dropped a note-on.
   */
  live(trackIndex, status, data1, data2) {
    const track = this.model.tracks[trackIndex];
    if (!track) return true;
    return applyLiveEvent(track.kernel, status, data1, data2, this.liveLimiter, this.framesRendered / this.fs);
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

  /** Stops playback in place; release tails finish and audio clips fade over 64 frames. */
  stop() {
    if (this.playing) this.fadeClips();
    this.playing = false;
    this.releaseNotes();
  }

  fadeClips() {
    const tracks = this.model.tracks;
    for (let i = 0; i < tracks.length; i++) if (tracks[i].audio !== null) startStopFade(tracks[i].audio, this.playFrame);
  }

  /**
   * Panic (audio-safety.md): stops the transport and fades every voice and
   * drum instance over 64 frames; the metronome click stops at once.
   */
  panic() {
    if (this.playing) this.fadeClips();
    this.playing = false;
    const tracks = this.model.tracks;
    for (let i = 0; i < tracks.length; i++) if (tracks[i].kernel !== null) tracks[i].kernel.allNotesOff(true);
    this.clearChains();
    // The voices' 64-frame fades still enter the chains; clear them again once the fades end.
    this.chainClearIn = STEAL_FADE_FRAMES;
    this.metronome.reset();
  }

  clearChains() {
    const tracks = this.model.tracks;
    for (let i = 0; i < tracks.length; i++) resetChain(tracks[i].chain);
    resetChain(this.model.masterChain);
  }

  /** Queues a fault message for a slot that reset and bypassed itself. */
  queueFault(trackId, slot, index) {
    if (this.faultCount >= FAULT_QUEUE) return;
    const f = this.faults[this.faultCount++];
    f.trackId = trackId;
    f.deviceId = slot.deviceId;
    f.slot = index;
  }

  /** Runs `chain` over frames [0, n) of the track buffers and queues any fault. */
  runChain(chain, trackId, bufL, bufR, start, end) {
    for (let s = 0; s < chain.length; s++) {
      const slot = chain[s];
      if (slot === null) continue;
      slot.process(bufL, bufR, start, end);
      if (slot.hasFault() && this.faultCount < FAULT_QUEUE) {
        slot.takeFault();
        this.queueFault(trackId, slot, s);
      }
    }
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

  /** Meter readings since the last call: [peakL, peakR, meanSquareL, meanSquareR] per track, master last. */
  readMeters() {
    return this.meters.read(this.model.tracks.length);
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
    this.framesRendered += end - start;
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
    this.masterPan.flush();
    if (this.chainClearIn > 0) {
      this.chainClearIn -= n;
      if (this.chainClearIn <= 0) this.clearChains();
    }
  }

  renderSpan(bufL, bufR, off, n) {
    if (n <= 0) return;
    const end = off + n;
    const tracks = this.model.tracks;
    const tb = this.trackBuf;
    const tbR = this.trackBufR;
    const meters = this.meters;
    for (let t = 0; t < tracks.length; t++) {
      const track = tracks[t];
      const chained = hasSlots(track.chain);
      if (track.audio !== null) {
        const mono = this.monoBuf;
        renderClips(track.audio, mono, tb, tbR, n, this.playFrame, this.playing);
        if (chained) {
          // Mono clips join the stereo bus at −3 dB, the centre of constant-power pan.
          for (let i = 0; i < n; i++) {
            const m = mono[i] * Math.SQRT1_2;
            tb[i] += m;
            tbR[i] += m;
          }
          this.runChain(track.chain, track.trackId, tb, tbR, 0, n);
          track.strip.mix(tb, tbR, true, n, bufL, bufR, off, this.stripL, this.stripR);
        } else {
          track.strip.mixAudio(mono, tb, tbR, n, bufL, bufR, off, this.stripL, this.stripR);
        }
      } else {
        renderTrack(track, tb, tbR, n, this.playFrame, this.playing);
        let stereo = track.kernel !== null && track.kernel.stereo === true;
        if (chained) {
          if (!stereo) {
            // Mono instruments enter the stereo chain at −3 dB per side; balance pan follows.
            for (let i = 0; i < n; i++) {
              const m = tb[i] * Math.SQRT1_2;
              tb[i] = m;
              tbR[i] = m;
            }
            stereo = true;
          }
          this.runChain(track.chain, track.trackId, tb, tbR, 0, n);
        }
        track.strip.mix(tb, tbR, stereo, n, bufL, bufR, off, this.stripL, this.stripR);
      }
      meters.add(t, this.stripL, this.stripR, 0, n);
    }
    if (hasSlots(this.model.masterChain)) this.runChain(this.model.masterChain, 'master', bufL, bufR, off, end);
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
    for (let i = 0; i < n; i++) this.masterPan.next();
    balance(this.masterPan.y, this.masterPanGains);
    const pl = this.masterPanGains[0];
    const pr = this.masterPanGains[1];
    const master = this.master;
    for (let i = off; i < end; i++) {
      const g = master.next();
      bufL[i] *= g * pl;
      bufR[i] *= g * pr;
    }
    meters.add(MASTER_METER, bufL, bufR, off, end);
    meters.count(n);
  }
}

/** True when `chain` has at least one slot. */
function hasSlots(chain) {
  for (let i = 0; i < chain.length; i++) if (chain[i] !== null) return true;
  return false;
}

/** Applies effect param `id` (EFFECT_PARAM_BASE + stride·slot + k) to `chain`. */
function applyEffectParam(chain, id, value) {
  const rel = id - EFFECT_PARAM_BASE;
  const slot = chain[Math.floor(rel / EFFECT_PARAM_STRIDE)];
  if (!slot) return;
  const k = rel % EFFECT_PARAM_STRIDE;
  if (k === EFFECT_BYPASS) slot.setBypass(value !== 0);
  else {
    const def = effectFor(slot.type)?.params[k];
    if (def) slot.setParam(def.id, value);
  }
}

/** Clears every slot's effect state (Panic). */
function resetChain(chain) {
  for (let i = 0; i < chain.length; i++) if (chain[i] !== null) chain[i].reset();
}

/** Sets every strip's gate from mute and solo (solo-in-place). */
function updateGates(tracks) {
  let anySolo = false;
  for (let i = 0; i < tracks.length; i++) if (tracks[i].strip.solo) anySolo = true;
  for (let i = 0; i < tracks.length; i++) tracks[i].strip.updateGate(anySolo);
}
