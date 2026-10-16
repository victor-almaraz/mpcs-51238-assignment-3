/*
 * The CPU-benchmark stress project (a3-audio-implementation.md, CPU budget):
 * 16 instrument tracks holding 64 voices in total, a compressor and a
 * saturator on every track and a reverb on four of them, 20 s long at 120 BPM.
 * Returns an EngineModel payload for `fs`; plain data and typed arrays only,
 * so a page can build it from this module's source.
 */
export function stressModel(fs, seconds = 20) {
  const TYPES = ['subtractive', 'fm', 'additive', 'pluck', 'subtractive', 'fm', 'additive', 'subtractive'];
  const end = Math.round(seconds * fs);
  const tracks = [];
  for (let t = 0; t < 16; t++) {
    const pitches = [48, 52, 55, 59].map((p) => p + (t % 12));
    const count = pitches.length;
    const notes = {
      start: new Int32Array(count),
      end: new Int32Array(count).fill(end),
      pitch: Uint8Array.from(pitches),
      vel: new Uint8Array(count).fill(100),
    };
    const effects = [
      { deviceId: `cmp${t}`, type: 'compressor', bypass: false, params: { threshold: -30, ratio: 8 } },
      { deviceId: `sat${t}`, type: 'saturation', bypass: false, params: { drive: 18 } },
    ];
    if (t < 4) effects.push({ deviceId: `rev${t}`, type: 'reverb', bypass: false, params: { decay: 4 } });
    tracks.push({
      trackId: `trk${t}`,
      deviceId: `dev${t}`,
      type: TYPES[t % TYPES.length],
      params: {},
      gainDb: -12,
      pan: 0,
      mute: false,
      solo: false,
      notes,
      effects,
    });
  }
  return {
    schema: 1,
    fs,
    tempo: [{ tick: 0, bpm: 120, shape: 'step' }],
    meter: [{ tick: 0, numerator: 4, denominator: 4 }],
    loopStartFrame: 0,
    loopEndFrame: end,
    endFrame: end,
    masterPan: 0,
    masterEffects: [],
    tracks,
  };
}
