/*
 * Constants shared by the main thread, the worklet and Node tests.
 * Environment-independent: no browser or Node globals.
 */

/** Name of the AudioWorkletProcessor that renders every sound (sequencer, instruments, mixer). */
export const ENGINE_PROCESSOR = 'wrack-engine';

/** Name of the AudioWorkletProcessor that applies the safety stage; always the last node. */
export const SAFETY_PROCESSOR = 'wrack-safety';

/** Output channel count of both processors (stereo). */
export const CHANNELS = 2;
