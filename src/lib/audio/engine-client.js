/*
 * Main-thread engine client (a3-audio-implementation.md, Loading;
 * assignment-3-scope.md, Volume notice). Imported only by 'use client' modules.
 *
 * No AudioContext exists until a sound-producing action is confirmed: the
 * first such action of a page session opens the volume notice (unless it is
 * dismissed on this device); Continue creates and resumes the context inside
 * the click handler, loads the worklet and performs the action. The client is
 * a singleton on globalThis, so React StrictMode and Fast Refresh never create
 * a second context.
 */
import { CHANNELS, ENGINE_PROCESSOR, SAFETY_PROCESSOR } from '../../dsp/core/constants.js';
import { CONTROL_CHANGE, CC_ALL_NOTES_OFF, CC_ALL_SOUND_OFF, FloodLimiter, NOTE_OFF, NOTE_ON, PREVIEW_CHANNEL } from '../../dsp/engine/live-input.js';
import { PROTOCOL_VERSION } from '../../dsp/protocol.js';
import { getSettings, updateSettings } from '../settings/store.js';
import { compileModel } from './compile-model.js';
import { allSources, getSource, redecodeAll, subscribeSources } from './decode.js';
import { deviceSource } from '../project/clip-commands.js';
import { mipsFor } from './peaks-client.js';
import { paramChanges } from './param-changes.js';

export const WORKLET_URL = '/worklets/worklet/main.js';

export const AUDIO_START_FAILED = 'Wrack could not start audio in this browser. Reload the page and try again.';

/** Sample rate used for tick ↔ frame conversion before a context exists. */
const DEFAULT_FS = 48000;

const loaded = new WeakMap();

/** Loads the worklet module into `ctx` once per context. */
export function ensureModule(ctx) {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL);
    loaded.set(ctx, p);
  }
  return p;
}

function createClient() {
  let ctx = null;
  let engine = null;
  let safety = null;
  let startPromise = null;
  let confirmedThisSession = false; // the volume notice's in-memory flag
  let pendingAction = null; // action waiting on the volume notice
  let doc = null;
  let compiled = null; // { model, tempo, meter } at the context rate
  let rev = 0;
  let loop = { on: false, startTick: 0, endTick: 0 };
  let stoppedTick = 0; // playhead while stopped or paused
  let playStart = 0; // where the current or last playback started
  let last = { playFrame: 0, ctxFrame: 0 }; // latest engine report while playing
  let state = {
    status: 'idle',
    noticeOpen: false,
    playing: false,
    paused: false, // halted by Pause: Play resumes, Stop returns to the play start
    metronome: getSettings().metronome,
    masterVolumeDb: getSettings().masterVolumeDb,
    ducked: false,
    error: null,
    samplers: {}, // deviceId → { status: 'bound' | 'missing', sourceId, reason } from the engine
    faults: [], // effects the engine reset and bypassed: { trackId ('master' or a track ID), deviceId, slot }
  };
  let meters = null; // latest engine meters (Float32Array)
  let level = { peakL: 0, peakR: 0, reduction: 1 }; // latest post-limiter master level
  const pendingParams = new Map(); // "target:paramId" → value, sent once per frame
  let liveTarget = 0; // engine track index being edited: previews, and live input while no track is armed
  let armedTargets = []; // engine track indices armed for live input (keyboard and MIDI)
  const liveLimiter = new FloodLimiter();
  const nowS = () => performance.now() / 1000;

  /** Tracks live input plays on: the armed ones, else the track being edited. */
  const inputTargets = () => (armedTargets.length > 0 ? armedTargets : [liveTarget]);

  /** Sends one MIDI event to each of `targets` (default: the live input targets). */
  function sendLive(status, data1, data2, targets = inputTargets()) {
    for (const track of targets) send({ t: 'live', track, events: Uint8Array.of(status, data1, data2) });
  }

  /** Ends held live notes on tracks that no longer receive live input. */
  function releaseDropped(before) {
    const now = inputTargets();
    const dropped = before.filter((t) => !now.includes(t));
    if (engine && dropped.length > 0) sendLive(CONTROL_CHANGE, CC_ALL_NOTES_OFF, 0, dropped);
  }
  const listeners = new Set();

  function setState(changes) {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  function fs() {
    return ctx ? ctx.sampleRate : DEFAULT_FS;
  }

  function send(msg) {
    engine?.port.postMessage({ v: PROTOCOL_VERSION, ...msg });
  }

  let modelFrame = 0; // pending requestAnimationFrame for a coalesced model message

  function sendModel() {
    if (compiled) send({ t: 'model', rev: ++rev, model: compiled.model });
  }

  let modelPending = false;
  let relocateTick = null; // a playing position to keep in ticks once the next model is sent (tempo edits)
  let relocating = null; // { frame, ctxFrame } of a relocate the engine has not yet reported back

  /**
   * Sends model and params changes at most once per animation frame
   * (a3-audio-implementation.md, Main to engine). A pending model carries
   * every param, so pending params are dropped when one is sent.
   */
  function scheduleFlush() {
    if (!engine || modelFrame) return;
    modelFrame = requestAnimationFrame(() => {
      modelFrame = 0;
      if (modelPending) {
        modelPending = false;
        pendingParams.clear();
        sendModel();
        // The engine keeps its playhead in frames across a model swap; a tempo edit while playing
        // would move it to another bar, so playback carries on from the same tick instead.
        if (relocateTick !== null && compiled) {
          const frame = compiled.tempo.frameAt(relocateTick);
          send({ t: 'transport', op: 'locate', frame });
          last = { playFrame: frame, ctxFrame: contextFrame() };
          relocating = last;
        }
        relocateTick = null;
      } else if (pendingParams.size > 0) {
        const values = new Float64Array(3 * pendingParams.size);
        let i = 0;
        for (const [key, value] of pendingParams) {
          const [target, paramId] = key.split(':').map(Number);
          values[i++] = target;
          values[i++] = paramId;
          values[i++] = value;
        }
        pendingParams.clear();
        send({ t: 'params', rev: ++rev, values });
      }
    });
  }

  function sendLoop() {
    if (!compiled || loop.endTick <= loop.startTick) return;
    send({
      t: 'transport',
      op: 'loop',
      loopOn: loop.on,
      loopStart: compiled.tempo.frameAt(loop.startTick),
      loopEnd: compiled.tempo.frameAt(loop.endTick),
    });
  }

  const sentSources = new Map(); // sourceId → the channel arrays last sent
  let syncing = null;

  /**
   * Sends every loaded source the engine lacks (source-add with transferred
   * copies) and removes unloaded ones. Sources decoded at another rate decode
   * again at the context rate first.
   */
  function syncSources() {
    if (!engine) return;
    if (syncing) {
      syncing.again = true;
      return;
    }
    syncing = { again: false };
    const rate = ctx.sampleRate;
    const pending = allSources().some((s) => s.rate !== rate) ? redecodeAll(rate) : Promise.resolve();
    pending
      .catch((err) => console.error('Audio could not be decoded at the context rate', err))
      .then(() => {
        // Only the open project's sources go to the engine; others are removed.
        const used = { ...(doc?.sources ?? {}) };
        for (const d of Object.values(doc?.devices ?? {})) {
          const ref = deviceSource(d);
          if (ref) used[ref.sourceId] = true;
        }
        const loaded = new Map(allSources().filter((s) => s.rate === rate && used[s.sourceId]).map((s) => [s.sourceId, s]));
        for (const [id, source] of loaded) {
          if (sentSources.get(id) === source.channels) continue;
          const copies = source.channels.map((c) => c.slice());
          engine.port.postMessage({ t: 'source-add', v: PROTOCOL_VERSION, sourceId: id, channels: copies }, copies.map((c) => c.buffer));
          sentSources.set(id, source.channels);
        }
        for (const id of sentSources.keys()) {
          if (loaded.has(id)) continue;
          send({ t: 'source-remove', sourceId: id });
          sentSources.delete(id);
          sentMips.delete(id);
        }
        const again = syncing.again;
        syncing = null;
        syncZones();
        if (again) syncSources();
      });
  }

  const sentZones = new Map(); // sampler or granular deviceId → sourceId sent in sampler-zones (or null)
  const sentMips = new Map(); // sourceId → the channel arrays its sent mips were built from
  const mipsPending = new Map(); // sourceId → the channel arrays a mips request is building from

  /**
   * Sends each sampler's zone source and each granular File source when it
   * changes (sampler-zones), and mip levels for sampler sources at the
   * context rate (source-mips).
   */
  function syncZones() {
    if (!engine || !doc) return;
    for (const device of Object.values(doc.devices)) {
      if (device.type !== 'sampler' && device.type !== 'granular') continue;
      const zone = deviceSource(device);
      const id = zone?.sourceId ?? null;
      if (sentZones.get(device.id) !== id) {
        send({ t: 'sampler-zones', deviceId: device.id, selection: 0, zones: zone ? [{ sourceId: zone.sourceId, sourceName: zone.sourceName ?? '' }] : [] });
        sentZones.set(device.id, id);
      }
      if (device.type !== 'sampler') continue;
      const source = id ? getSource(id) : null;
      if (!source || source.rate !== ctx.sampleRate || sentMips.get(id) === source.channels || mipsPending.get(id) === source.channels) continue;
      mipsPending.set(id, source.channels);
      mipsFor(id, source.channels).then((levels) => {
        if (mipsPending.get(id) !== source.channels) return;
        mipsPending.delete(id);
        if (!levels || getSource(id)?.channels !== source.channels) return; // a failed request is retried on the next sync
        sentMips.set(id, source.channels);
        const transfer = levels.flatMap((l) => l.channels.map((c) => c.buffer));
        engine.port.postMessage({ t: 'source-mips', v: PROTOCOL_VERSION, sourceId: id, levels }, transfer);
      });
    }
  }

  function compile() {
    compiled = doc ? compileModel(doc, fs()) : null;
  }

  function contextFrame() {
    return Math.round(ctx.currentTime * ctx.sampleRate);
  }

  /**
   * True for a position report from before a tempo-edit relocate reached the engine: its
   * frames count at the old tempo. A report within half a second of the relocated position
   * (or one a second after it) ends the wait.
   */
  function staleReport(msg) {
    if (!relocating) return false;
    const elapsed = msg.ctxFrame - relocating.ctxFrame;
    const expected = relocating.playFrame + elapsed;
    if (Math.abs(msg.playFrame - expected) <= 0.5 * ctx.sampleRate || elapsed > ctx.sampleRate) {
      relocating = null;
      return false;
    }
    return true;
  }

  function onEngineMessage(event) {
    const msg = event.data;
    if (msg.t === 'pos') {
      meters = msg.meters;
      if (msg.playing && !staleReport(msg)) last = { playFrame: msg.playFrame, ctxFrame: msg.ctxFrame };
    } else if (msg.t === 'fault') {
      setState({ faults: [...state.faults, { trackId: msg.trackId, deviceId: msg.deviceId, slot: msg.slot }] });
    } else if (msg.t === 'source-status') {
      setState({ samplers: { ...state.samplers, [msg.deviceId]: { status: msg.status, sourceId: msg.sourceId, reason: null } } });
    } else if (msg.t === 'sampler-zone-invalid') {
      const prev = state.samplers[msg.deviceId] ?? { status: 'bound', sourceId: null };
      setState({ samplers: { ...state.samplers, [msg.deviceId]: { ...prev, reason: msg.reason } } });
    } else if (msg.t === 'error') console.error(`Engine error: ${msg.code}`, msg.detail);
  }

  function onSafetyMessage(event) {
    const msg = event.data;
    if (msg.t === 'level') level = msg;
    else if (msg.t === 'duck') setState({ ducked: msg.active });
    else if (msg.t === 'error') console.error(`Safety error: ${msg.code}`, msg.detail);
  }

  function reportFailure(err) {
    console.error(err);
    setState({ status: 'error', error: AUDIO_START_FAILED });
  }

  /**
   * Creates the context and graph. The AudioContext constructor and resume()
   * run synchronously inside the calling user-gesture handler.
   */
  function start() {
    if (startPromise) return startPromise;
    ctx = new AudioContext({ latencyHint: 'interactive' });
    const resumed = ctx.resume();
    setState({ status: 'starting' });
    startPromise = Promise.all([resumed, ensureModule(ctx)]).then(() => {
      engine = new AudioWorkletNode(ctx, ENGINE_PROCESSOR, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [CHANNELS],
      });
      safety = new AudioWorkletNode(ctx, SAFETY_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [CHANNELS],
        channelCount: CHANNELS,
        channelCountMode: 'explicit',
      });
      engine.connect(safety).connect(ctx.destination);
      engine.port.onmessage = onEngineMessage;
      safety.port.onmessage = onSafetyMessage;
      send({ t: 'init', seed: 1 });
      compile();
      sendModel();
      subscribeSources(syncSources);
      syncSources();
      sendLoop();
      send({ t: 'master', volumeDb: getSettings().masterVolumeDb });
      send({ t: 'metronome', on: state.metronome, gainDb: 0 });
      setState({ status: 'running' });
    });
    return startPromise;
  }

  function perform(action) {
    start().then(action).catch(reportFailure);
  }

  return {
    /** Snapshot for useSyncExternalStore: { status, noticeOpen, playing, metronome, error }. */
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** True once an AudioContext exists. */
    hasContext: () => ctx !== null,

    /** Rate to decode audio at: the context's, or 48 kHz before one exists. */
    decodeRate: () => fs(),

    /**
     * Runs a sound-producing `action` (Play, a note, an audition), opening the
     * volume notice first when needed. Call from a user-gesture handler.
     */
    requestSound(action) {
      if (ctx || confirmedThisSession || getSettings().volumeNoticeDismissed) {
        confirmedThisSession = true;
        perform(action);
        return;
      }
      pendingAction = action;
      setState({ noticeOpen: true });
    },

    /** Volume notice Continue. Call from its click handler. */
    confirmNotice(dontShowAgain) {
      confirmedThisSession = true;
      if (dontShowAgain) updateSettings({ volumeNoticeDismissed: true });
      const action = pendingAction;
      pendingAction = null;
      setState({ noticeOpen: false });
      if (action) perform(action);
    },

    /** Volume notice Cancel: performs nothing. */
    cancelNotice() {
      pendingAction = null;
      setState({ noticeOpen: false });
    },

    /** Compiles `project` and sends it to the engine (now, or when audio starts). */
    setProject(project) {
      const changes = paramChanges(doc, project);
      const sourcesChanged = doc?.sources !== project.sources;
      if (doc && doc.id !== project.id && state.faults.length > 0) setState({ faults: [] }); // faults belong to the project that raised them
      doc = project;
      if (sourcesChanged) syncSources();
      if (changes) {
        for (let i = 0; i < changes.length; i += 3) pendingParams.set(`${changes[i]}:${changes[i + 1]}`, changes[i + 2]);
      } else {
        const before = compiled?.tempo ?? null;
        const tick = state.playing && before ? this.positionTick() : null;
        compile();
        modelPending = true;
        if (tick !== null && compiled && compiled.tempo.frameAt(tick) !== before.frameAt(tick)) {
          relocateTick = tick;
          last = { playFrame: compiled.tempo.frameAt(tick), ctxFrame: contextFrame() };
          relocating = last;
        }
        sendLoop();
      }
      syncZones();
      scheduleFlush();
    },

    /**
     * Panic: stops the transport and fades every sound in the engine; the
     * safety stage restarts its fade-in. Returns true when audio was running.
     */
    panic() {
      if (!engine) return false;
      stoppedTick = this.positionTick();
      send({ t: 'panic' });
      safety.port.postMessage({ t: 'resume-fade', v: PROTOCOL_VERSION });
      setState({ playing: false, paused: false });
      return true;
    },

    /** Returns and clears the faults the engine reported since the last call. */
    takeFaults() {
      const faults = state.faults;
      if (faults.length > 0) setState({ faults: [] });
      return faults;
    },

    /** Sets the engine track index that live notes and previews play on. */
    setLiveTarget(index) {
      const before = inputTargets();
      if (index !== liveTarget && engine) sendLive(CONTROL_CHANGE, CC_ALL_NOTES_OFF, 0, [liveTarget]);
      liveTarget = index;
      releaseDropped(before);
    },

    /**
     * Sets the engine track indices armed for live input. Keyboard and MIDI notes play on
     * every armed track, or on the track being edited when none is armed; previews always
     * play on the track being edited.
     */
    setArmedTargets(indices) {
      const before = inputTargets();
      armedTargets = [...indices];
      releaseDropped(before);
    },

    /**
     * Plays a live note through the volume notice when needed. `isHeld()`
     * says whether the key or MIDI note is still down when audio starts, so a
     * note released during the notice never sticks. Note-ons beyond 200 per
     * second are dropped. Call from the input event handler.
     */
    noteOn(pitch, velocity, isHeld = () => true) {
      this.requestSound(() => {
        if (!isHeld() || !liveLimiter.allow(nowS())) return;
        sendLive(NOTE_ON, pitch, velocity);
      });
    },

    /** Ends a live note. */
    noteOff(pitch) {
      if (engine) sendLive(NOTE_OFF, pitch, 0);
    },

    /** Ends every live note on the target track; `hard` fades them out at once. */
    allLiveOff(hard = false) {
      if (engine) sendLive(CONTROL_CHANGE, hard ? CC_ALL_SOUND_OFF : CC_ALL_NOTES_OFF, 0);
    },

    /**
     * Note preview (PR-02): plays `pitch` for 250 ms through the target track's
     * chain, on its own MIDI channel so it never cuts a held note. No preview
     * plays during playback.
     */
    preview(pitch, velocity = 100) {
      if (state.playing) return;
      this.requestSound(() => {
        if (!liveLimiter.allow(nowS())) return;
        sendLive(NOTE_ON | PREVIEW_CHANNEL, pitch, velocity, [liveTarget]);
        setTimeout(() => sendLive(NOTE_OFF | PREVIEW_CHANNEL, pitch, 0, [liveTarget]), 250);
      });
    },

    /** Releases a sustained-level duck (the user acknowledged it). */
    ackDuck() {
      safety?.port.postMessage({ t: 'ack-duck', v: PROTOCOL_VERSION });
      setState({ ducked: false });
    },

    /** Sets master volume in dB and saves it in settings. */
    setMasterVolume(db) {
      updateSettings({ masterVolumeDb: db });
      send({ t: 'master', volumeDb: db });
      setState({ masterVolumeDb: db });
    },

    /** Latest engine meters: [peakL, peakR, meanSquareL, meanSquareR] per track slot, master last; or null. */
    getMeters: () => meters,

    /** Latest post-limiter master level: { peakL, peakR, reduction (linear gain) }. */
    getMasterLevel: () => level,

    /** Meter map of the current project, or null. */
    meter: () => compiled?.meter ?? null,

    /**
     * Starts playback at the playhead with a 50 ms fade-in. Runs inside
     * requestSound. From a stop, the playhead becomes the play start that
     * Stop returns to; resuming from a pause keeps it.
     */
    play() {
      if (!compiled || state.playing) return;
      if (!state.paused) playStart = stoppedTick;
      const frame = compiled.tempo.frameAt(stoppedTick);
      send({ t: 'transport', op: 'play', frame });
      safety.port.postMessage({ t: 'resume-fade', v: PROTOCOL_VERSION });
      last = { playFrame: frame, ctxFrame: contextFrame() };
      setState({ playing: true, paused: false });
    },

    /** Pauses in place and returns the tick where playback paused. */
    pause() {
      if (!state.playing) return stoppedTick;
      stoppedTick = this.positionTick();
      send({ t: 'transport', op: 'stop' });
      setState({ playing: false, paused: true });
      return stoppedTick;
    },

    /**
     * Stops: while playing or paused, halts and returns the playhead to the
     * play start. Returns the playhead tick.
     */
    stop() {
      if (!state.playing && !state.paused) return stoppedTick;
      if (state.playing) send({ t: 'transport', op: 'stop' });
      setState({ playing: false, paused: false });
      this.locate(playStart);
      return stoppedTick;
    },

    /** The tick where the current or last playback started. */
    playStart: () => playStart,

    /** Moves the playhead to `tick`. */
    locate(tick) {
      stoppedTick = tick;
      if (!compiled) return;
      const frame = compiled.tempo.frameAt(tick);
      send({ t: 'transport', op: 'locate', frame });
      if (ctx) last = { playFrame: frame, ctxFrame: contextFrame() };
    },

    /** Sets the loop range in ticks and turns the loop on or off. */
    setLoop(on, startTick, endTick) {
      loop = { on, startTick, endTick };
      sendLoop();
    },

    /** Turns the metronome on or off and saves the choice in settings. */
    setMetronome(on) {
      updateSettings({ metronome: on });
      send({ t: 'metronome', on, gainDb: 0 });
      setState({ metronome: on });
    },

    /**
     * The tick being heard now. While playing: the last reported play frame
     * advanced by the audible context time since the report (getOutputTimestamp
     * when present, else currentTime minus output latency), wrapped into the
     * loop when it is on.
     */
    positionTick() {
      if (!state.playing || !ctx || !compiled) return stoppedTick;
      const rate = ctx.sampleRate;
      const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
      const audible =
        ts && ts.contextTime > 0
          ? ts.contextTime * rate + ((performance.now() - ts.performanceTime) / 1000) * rate
          : (ctx.currentTime - (ctx.baseLatency ?? 0) - (ctx.outputLatency ?? 0)) * rate;
      let frame = last.playFrame + Math.max(0, audible - last.ctxFrame);
      if (loop.on) {
        // As in the engine, only a pass that reaches the loop end from before it wraps;
        // playback that started after the loop end, or passed it before the loop was on, plays on.
        const start = compiled.tempo.frameAt(loop.startTick);
        const end = compiled.tempo.frameAt(loop.endTick);
        if (end > start && last.playFrame < end && frame >= end) frame = start + ((frame - start) % (end - start));
      }
      return compiled.tempo.tickAt(Math.floor(frame));
    },
  };
}

/** The engine client singleton. */
export function getEngine() {
  globalThis.__wrackEngine ??= createClient();
  return globalThis.__wrackEngine;
}
