/*
 * AudioWorklet module: registers the engine and safety processors
 * (a3-audio-implementation.md, Node graph). The engine is a placeholder that
 * renders silence; the safety processor runs the full SafetyKernel.
 */
import { BLOCK, ENGINE_PROCESSOR, SAFETY_PROCESSOR } from '../dsp/core/constants.js';
import { PROTOCOL_VERSION, validateSafetyMessage } from '../dsp/protocol.js';
import { SafetyKernel } from '../dsp/safety/safety.js';

/** Frames of the mono-output scratch channel; larger than any render quantum. */
const SCRATCH_FRAMES = 8192;

class EngineProcessor extends AudioWorkletProcessor {
  /** Outputs arrive zero-filled, so leaving them untouched renders silence. */
  process() {
    return true;
  }
}

class SafetyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.kernel = new SafetyKernel(sampleRate);
    this.scratch = new Float32Array(SCRATCH_FRAMES);
    // Reused for every post: process() allocates nothing.
    this.guardMessage = { t: 'guard', v: PROTOCOL_VERSION, muted: true };
    this.duckMessage = { t: 'duck', v: PROTOCOL_VERSION, active: false };
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
