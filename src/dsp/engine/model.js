/*
 * EngineModel on the audio thread: the validated message model with its tempo
 * and meter maps and sequencer tracks built. Building allocates, so it runs in
 * onmessage (or a test); process() swaps the result in with one assignment.
 */
import { TempoMap } from '../timing/tempo-map.js';
import { MeterMap } from '../timing/meter-map.js';
import { createTrack } from './sequencer.js';

const NO_NOTES = {
  start: new Int32Array(0),
  end: new Int32Array(0),
  pitch: new Uint8Array(0),
  vel: new Uint8Array(0),
};

/**
 * Returns the compiled model for a validated EngineModel payload:
 * { fs, tempo, meter, loopStartFrame, loopEndFrame, endFrame, tracks }.
 * `kernelFor(track, index)` returns the instrument kernel for a payload
 * instrument track, or null; `clipsFor(track)` the clip player state of an
 * audio track; `stripFor(track)` its channel strip. Each compiled track has
 * `kernel` (null for audio tracks) and `audio` (null for instrument tracks).
 */
export function buildEngineModel(model, kernelFor = () => null, stripFor = () => null, clipsFor = () => null) {
  return {
    fs: model.fs,
    tempo: new TempoMap(model.tempo, model.fs),
    meter: new MeterMap(model.meter),
    loopStartFrame: model.loopStartFrame,
    loopEndFrame: model.loopEndFrame,
    endFrame: model.endFrame,
    tracks: (model.tracks ?? []).map((t, index) => {
      const audio = t.kind === 'audio';
      const track = audio ? createTrack(null, NO_NOTES) : createTrack(kernelFor(t, index), t.notes);
      track.audio = audio ? clipsFor(t) : null;
      track.strip = stripFor(t);
      return track;
    }),
  };
}

/** EngineModel payload for an empty project at `fs`: 120 BPM, 4/4, a four-bar loop, no tracks. */
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
    masterPan: 0,
    tracks: [],
  };
}
