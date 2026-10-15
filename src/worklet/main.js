/*
 * AudioWorklet module: registers the engine and safety processors.
 * Placeholder processors: the engine outputs silence and the safety stage
 * passes its input through unchanged.
 */
import { ENGINE_PROCESSOR, SAFETY_PROCESSOR } from '../dsp/core/constants.js';

class EngineProcessor extends AudioWorkletProcessor {
  /** Outputs arrive zero-filled, so leaving them untouched renders silence. */
  process() {
    return true;
  }
}

class SafetyProcessor extends AudioWorkletProcessor {
  /** Copies each input channel to the matching output channel. */
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let ch = 0; ch < output.length && ch < input.length; ch++) {
      output[ch].set(input[ch]);
    }
    return true;
  }
}

/*
 * A second registerProcessor call with the same name throws NotSupportedError,
 * so each registration is guarded for repeated addModule calls on one context.
 */
if (!globalThis.__wrackProcessorsRegistered) {
  registerProcessor(ENGINE_PROCESSOR, EngineProcessor);
  registerProcessor(SAFETY_PROCESSOR, SafetyProcessor);
  globalThis.__wrackProcessorsRegistered = true;
}
