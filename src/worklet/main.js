/*
 * AudioWorklet module: registers the engine and safety processors
 * (a3-audio-implementation.md, Node graph). Message handlers validate and
 * build structures (they may allocate); process() swaps them in at the next
 * quantum and allocates nothing.
 */
import { BLOCK, ENGINE_PROCESSOR, SAFETY_PROCESSOR } from '../dsp/core/constants.js';
import { Engine } from '../dsp/engine/engine.js';
import { PROTOCOL_VERSION, reportQuanta, validateEngineMessage, validateSafetyMessage } from '../dsp/protocol.js';
import { SafetyKernel } from '../dsp/safety/safety.js';

/** Frames of the mono-output scratch channel; larger than any render quantum. */
const SCRATCH_FRAMES = 8192;

/** Transport operations queued between quanta, applied in order. */
const MAX_PENDING_OPS = 64;

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.scratch = new Float32Array(SCRATCH_FRAMES);
    this.pendingModel = null;
    this.pendingRev = -1;
    this.ops = [];
    this.quanta = 0;
    this.reportEvery = 0;
    // Reused for every post: process() allocates nothing.
    this.posMessage = { t: 'pos', v: PROTOCOL_VERSION, playFrame: 0, ctxFrame: 0, playing: false, meters: null };
    this.ackMessage = { t: 'ack', v: PROTOCOL_VERSION, rev: 0 };
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  error(code, detail) {
    this.port.postMessage({ t: 'error', v: PROTOCOL_VERSION, code, detail });
  }

  onMessage(msg) {
    const invalid = validateEngineMessage(msg);
    if (invalid) {
      this.error(invalid, msg?.t ?? null);
      return;
    }
    switch (msg.t) {
      case 'init':
        this.engine.seed = msg.seed;
        this.port.postMessage({ t: 'ready', v: PROTOCOL_VERSION, fs: sampleRate, blockSize: BLOCK });
        break;
      case 'model':
        if (msg.model.fs !== sampleRate) {
          this.error('fs-mismatch', `${msg.model.fs} ≠ ${sampleRate}`);
          return;
        }
        this.pendingModel = this.engine.prepareModel(msg.model);
        this.pendingRev = msg.rev;
        break;
      case 'params':
        this.engine.applyParams(msg.values, this.pendingModel ?? this.engine.model);
        this.ackMessage.rev = msg.rev;
        this.port.postMessage(this.ackMessage);
        break;
      case 'transport':
      case 'metronome':
      case 'master':
      case 'panic':
        if (this.ops.length >= MAX_PENDING_OPS) this.ops.shift();
        this.ops.push(msg);
        break;
      default:
        break;
    }
  }

  applyOps() {
    const engine = this.engine;
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i];
      if (op.t === 'transport') {
        if (op.op === 'play') engine.play(op.frame);
        else if (op.op === 'stop') engine.stop();
        else if (op.op === 'locate') engine.locate(op.frame);
        else engine.setLoop(op.loopOn, op.loopStart, op.loopEnd);
      } else if (op.t === 'metronome') {
        engine.setMetronome(op.on, op.gainDb);
      } else if (op.t === 'panic') {
        engine.panic();
      } else {
        engine.setMasterVolume(op.volumeDb);
      }
    }
    this.ops.length = 0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : this.scratch;
    const frames = outL.length;
    const ctxFrame = currentFrame;
    if (this.pendingModel !== null) {
      this.engine.setModel(this.pendingModel);
      this.pendingModel = null;
      this.ackMessage.rev = this.pendingRev;
      this.port.postMessage(this.ackMessage);
    }
    if (this.ops.length > 0) this.applyOps();
    this.engine.process(outL, outR, 0, frames);
    if (this.reportEvery === 0) this.reportEvery = reportQuanta(sampleRate, frames);
    if (++this.quanta >= this.reportEvery) {
      this.quanta = 0;
      const pos = this.posMessage;
      pos.playFrame = this.engine.playFrame;
      pos.ctxFrame = ctxFrame + frames;
      pos.playing = this.engine.playing;
      pos.meters = this.engine.readMeters();
      this.port.postMessage(pos);
    }
    return true;
  }
}

class SafetyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernel = new SafetyKernel(sampleRate);
    this.scratch = new Float32Array(SCRATCH_FRAMES);
    this.guardMessage = { t: 'guard', v: PROTOCOL_VERSION, muted: true };
    this.duckMessage = { t: 'duck', v: PROTOCOL_VERSION, active: false };
    this.levelMessage = { t: 'level', v: PROTOCOL_VERSION, peakL: 0, peakR: 0, reduction: 1 };
    this.peakL = 0;
    this.peakR = 0;
    this.quanta = 0;
    this.reportEvery = 0;
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(msg) {
    const error = validateSafetyMessage(msg);
    if (error) {
      this.port.postMessage({ t: 'error', v: PROTOCOL_VERSION, code: error, detail: msg?.t ?? null });
      return;
    }
    if (msg.t === 'resume-fade') this.kernel.resumeFade();
    else if (msg.t === 'ack-duck') this.kernel.ackDuck();
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : this.scratch;
    const frames = outL.length;
    const input = inputs[0];
    if (input.length > 0) {
      outL.set(input[0]);
      outR.set(input.length > 1 ? input[1] : input[0]);
    } else {
      outL.fill(0);
      outR.fill(0, 0, frames);
    }
    for (let off = 0; off < frames; off += BLOCK) {
      this.kernel.process(outL, outR, off, off + BLOCK < frames ? off + BLOCK : frames);
    }
    let pl = this.peakL;
    let pr = this.peakR;
    for (let i = 0; i < frames; i++) {
      const l = outL[i] < 0 ? -outL[i] : outL[i];
      const r = outR[i] < 0 ? -outR[i] : outR[i];
      if (l > pl) pl = l;
      if (r > pr) pr = r;
    }
    this.peakL = pl;
    this.peakR = pr;
    if (this.reportEvery === 0) this.reportEvery = reportQuanta(sampleRate, frames);
    if (++this.quanta >= this.reportEvery) {
      this.quanta = 0;
      const level = this.levelMessage;
      level.peakL = pl;
      level.peakR = pr;
      level.reduction = this.kernel.limiter.readReduction();
      this.port.postMessage(level);
      this.peakL = 0;
      this.peakR = 0;
    }
    if (this.kernel.takeGuardTrip()) this.port.postMessage(this.guardMessage);
    if (this.kernel.takeDuckChange()) {
      this.duckMessage.active = this.kernel.duck.active;
      this.port.postMessage(this.duckMessage);
    }
    return true;
  }
}

/*
 * A second registerProcessor call with the same name throws NotSupportedError,
 * so registration is guarded for repeated addModule calls on one context.
 */
if (!globalThis.__wrackProcessorsRegistered) {
  registerProcessor(ENGINE_PROCESSOR, EngineProcessor);
  registerProcessor(SAFETY_PROCESSOR, SafetyProcessor);
  globalThis.__wrackProcessorsRegistered = true;
}
