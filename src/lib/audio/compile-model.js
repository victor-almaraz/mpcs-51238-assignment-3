/*
 * Compile step (a3-audio-implementation.md): converts a project document into
 * the frame-domain EngineModel the engine receives. Pure; runs on the main
 * thread before every model message.
 */
import { clampParam, clampParams } from '../../dsp/core/params.js';
import { PAN, TRACK_GAIN } from '../../dsp/mixer/mixer.js';
import { instrumentFor } from '../../dsp/instruments/registry.js';
import { MAX_NOTES_PER_TRACK, MODEL_SCHEMA } from '../../dsp/protocol.js';
import { MeterMap } from '../../dsp/timing/meter-map.js';
import { TempoMap } from '../../dsp/timing/tempo-map.js';
import { expandClipNotes } from '../project/midi-commands.js';

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
 * Note arrays for one instrument track, sorted by start frame then pitch.
 * Looping clips expand (expandClipNotes); notes are placed at clip start +
 * note tick and cropped at the clip end; muted clips are skipped. At most
 * MAX_NOTES_PER_TRACK notes.
 */
function compileNotes(doc, track, tempo) {
  const notes = [];
  for (const clipId of track.clipIds) {
    const clip = doc.clips[clipId];
    if (!clip || clip.kind !== 'midi' || clip.muted) continue;
    for (const note of expandClipNotes(clip, MAX_NOTES_PER_TRACK - notes.length)) {
      const tick = clip.start + note.tick;
      const start = tempo.frameAt(tick);
      const end = tempo.frameAt(tick + note.length);
      if (end > start) notes.push({ start, end, pitch: note.pitch, vel: note.velocity });
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  if (notes.length > MAX_NOTES_PER_TRACK) notes.length = MAX_NOTES_PER_TRACK;
  return {
    start: Int32Array.from(notes, (n) => n.start),
    end: Int32Array.from(notes, (n) => n.end),
    pitch: Uint8Array.from(notes, (n) => n.pitch),
    vel: Uint8Array.from(notes, (n) => n.vel),
  };
}

/** Model tracks for the document's instrument tracks, in track order. */
function compileTracks(doc, tempo) {
  const tracks = [];
  for (const trackId of doc.trackOrder) {
    const track = doc.tracks[trackId];
    if (!track || track.kind !== 'instrument') continue;
    const device = doc.devices[track.deviceIds[0]];
    if (!device) continue;
    const entry = instrumentFor(device.type);
    tracks.push({
      trackId,
      deviceId: device.id,
      type: device.type,
      params: entry ? clampParams(entry.params, device.params) : {},
      gainDb: clampParam(TRACK_GAIN, track.gainDb),
      pan: clampParam(PAN, track.pan),
      mute: track.mute === true,
      solo: track.solo === true,
      notes: compileNotes(doc, track, tempo),
    });
  }
  return tracks;
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
      masterPan: clampParam(PAN, doc.tracks[doc.masterTrackId]?.pan ?? 0),
      tracks: compileTracks(doc, tempo),
    },
  };
}
