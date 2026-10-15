/*
 * Compile step (a3-audio-implementation.md): converts a project document into
 * the frame-domain EngineModel the engine receives. Pure; runs on the main
 * thread before every model message.
 */
import { MODEL_SCHEMA } from '../../dsp/protocol.js';
import { TempoMap } from '../../dsp/timing/tempo-map.js';
import { MeterMap } from '../../dsp/timing/meter-map.js';

/** Bars an empty project spans, for its end frame and default loop. */
const MIN_BARS = 4;

/** Last tick used by any clip, or 0. */
function contentEndTick(doc) {
  let end = 0;
  for (const clip of Object.values(doc.clips)) {
    if (clip.kind === 'midi') end = Math.max(end, clip.start + clip.length);
  }
  return end;
}

/**
 * Returns { model, tempo, meter }: the EngineModel payload for `doc` at sample
 * rate `fs`, plus the tempo and meter maps the main thread uses to convert
 * between ticks and frames.
 */
export function compileModel(doc, fs) {
  const tempo = new TempoMap(doc.tempo, fs);
  const meter = new MeterMap(doc.meter);
  const minEnd = meter.tickAtBar(MIN_BARS);
  const endTick = Math.max(contentEndTick(doc), minEnd);
  const loop = doc.loop ?? { start: 0, end: endTick };
  return {
    tempo,
    meter,
    model: {
      schema: MODEL_SCHEMA,
      fs,
      tempo: doc.tempo.map((p) => ({ tick: p.tick, bpm: p.bpm, shape: p.shape })),
      meter: doc.meter.map((p) => ({ tick: p.tick, numerator: p.numerator, denominator: p.denominator })),
      loopStartFrame: tempo.frameAt(loop.start),
      loopEndFrame: tempo.frameAt(loop.end),
      endFrame: tempo.frameAt(endTick),
    },
  };
}
