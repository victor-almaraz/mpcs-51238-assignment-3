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
import { PROTOCOL_VERSION } from '../../dsp/protocol.js';
import { getSettings, updateSettings } from '../settings/store.js';
import { compileModel } from './compile-model.js';

export const WORKLET_URL = '/worklets/worklet/main.js';

export const AUDIO_START_FAILED = 'W-Rack could not start audio in this browser. Reload the page and try again.';

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
  let stoppedTick = 0; // playhead while stopped
  let last = { playFrame: 0, ctxFrame: 0 }; // latest engine report while playing
  let state = { status: 'idle', noticeOpen: false, playing: false, metronome: getSettings().metronome, error: null };
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

  /** Sends the model at most once per animation frame (a3-audio-implementation.md, Main to engine). */
  function scheduleModel() {
    if (!engine || modelFrame) return;
    modelFrame = requestAnimationFrame(() => {
      modelFrame = 0;
      sendModel();
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

  function compile() {
    compiled = doc ? compileModel(doc, fs()) : null;
  }

  function contextFrame() {
    return Math.round(ctx.currentTime * ctx.sampleRate);
  }

  function onEngineMessage(event) {
    const msg = event.data;
    if (msg.t === 'pos' && msg.playing) last = { playFrame: msg.playFrame, ctxFrame: msg.ctxFrame };
    else if (msg.t === 'error') console.error(`Engine error: ${msg.code}`, msg.detail);
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
      send({ t: 'init', seed: 1 });
      compile();
      sendModel();
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
      doc = project;
      compile();
      scheduleModel();
      sendLoop();
    },

    /** Meter map of the current project, or null. */
    meter: () => compiled?.meter ?? null,

    /** Starts playback at the playhead with a 50 ms fade-in. Runs inside requestSound. */
    play() {
      if (!compiled || state.playing) return;
      const frame = compiled.tempo.frameAt(stoppedTick);
      send({ t: 'transport', op: 'play', frame });
      safety.port.postMessage({ t: 'resume-fade', v: PROTOCOL_VERSION });
      last = { playFrame: frame, ctxFrame: contextFrame() };
      setState({ playing: true });
    },

    /** Stops in place and returns the tick where playback stopped. */
    stop() {
      if (!state.playing) return stoppedTick;
      stoppedTick = this.positionTick();
      send({ t: 'transport', op: 'stop' });
      setState({ playing: false });
      return stoppedTick;
    },

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
        const start = compiled.tempo.frameAt(loop.startTick);
        const end = compiled.tempo.frameAt(loop.endTick);
        if (end > start && frame >= end) frame = start + ((frame - start) % (end - start));
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
