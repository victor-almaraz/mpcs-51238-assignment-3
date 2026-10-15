/*
 * EngineModel on the audio thread: the validated message model with its tempo
 * and meter maps built. Building allocates, so it runs in onmessage (or a
 * test), and process() swaps the result in with one assignment.
 */
import { TempoMap } from '../timing/tempo-map.js';
import { MeterMap } from '../timing/meter-map.js';

/**
 * Returns the compiled model for a validated EngineModel message payload:
 * { fs, tempo: TempoMap, meter: MeterMap, loopStartFrame, loopEndFrame, endFrame }.
 */
export function buildEngineModel(model) {
  return {
    fs: model.fs,
    tempo: new TempoMap(model.tempo, model.fs),
    meter: new MeterMap(model.meter),
    loopStartFrame: model.loopStartFrame,
    loopEndFrame: model.loopEndFrame,
    endFrame: model.endFrame,
  };
}

/** EngineModel payload for an empty project at `fs`: 120 BPM, 4/4, a four-bar loop. */
export function emptyModel(fs) {
  const bar = 2 * fs; // one 4/4 bar at 120 BPM, in frames
  return {
    schema: 1,
    fs,
    tempo: [{ tick: 0, bpm: 120, shape: 'step' }],
    meter: [{ tick: 0, numerator: 4, denominator: 4 }],
    loopStartFrame: 0,
    loopEndFrame: 4 * bar,
    endFrame: 4 * bar,
  };
}
