/*
 * Compile step (a3-audio-implementation.md): converts a project document into
 * the frame-domain EngineModel the engine receives. Pure; runs on the main
 * thread before every model message.
 */
import { clampParam, clampParams } from '../../dsp/core/params.js';
import { PAN, TRACK_GAIN } from '../../dsp/mixer/mixer.js';
import { instrumentFor } from '../../dsp/instruments/registry.js';
import { MAX_CLIPS_PER_TRACK, MAX_NOTES_PER_TRACK, MODEL_SCHEMA } from '../../dsp/protocol.js';
import { MeterMap } from '../../dsp/timing/meter-map.js';
import { TempoMap } from '../../dsp/timing/tempo-map.js';
import { expandClipNotes } from '../project/midi-commands.js';
import { curveIndex } from '../../dsp/clips/fades.js';
import { dbToGain } from '../../dsp/core/math.js';
import { CLIP_GAIN_MIN_DB, DEFAULT_AUDIO_RATE, audioTempo, clipEndTick } from '../project/clip-commands.js';

/** Bars an empty project spans, for its end frame and default loop. */
const MIN_BARS = 4;

/** Scales a frame count recorded at the project's audioRate to `fs`. */
function scaler(doc, fs) {
  const ratio = fs / (doc.audioRate ?? DEFAULT_AUDIO_RATE);
  return ratio === 1 ? (x) => x : (x) => Math.round(x * ratio);
}

/** Last tick used by any clip, or 0. */
function contentEndTick(doc) {
  let end = 0;
  for (const clip of Object.values(doc.clips)) {
    if (clip.kind === 'midi') end = Math.max(end, clip.start + clip.length);
    else end = Math.max(end, clipEndTick(doc, clip));
  }
  return end;
}

/**
 * Clip arrays for one audio track (protocol.js, validateAudioClips), sorted
 * by start frame. Positions come from the tempo map at audioRate and scale to
 * `fs` from shared rounded boundaries: a clip spans
 * [round(F·r), round((F + length)·r)) and reads the source at a fixed
 * timeline-to-source offset round((srcStart − F)·r), so the parts of a split
 * stay contiguous and read the same frames at any rate (r = fs/audioRate).
 * Where a later clip starts inside an earlier one and outlasts it, the
 * overlap of L frames becomes the earlier clip's fade-out and the later
 * clip's fade-in, L frames of equalPower (the crossfade); a clip lying wholly
 * inside another gets no automatic fades. Muted clips are skipped.
 */
function compileClips(doc, track, scale) {
  const tempo = audioTempo(doc);
  const sourceIds = [];
  const clips = [];
  for (const clipId of track.clipIds) {
    const clip = doc.clips[clipId];
    if (!clip || clip.kind !== 'audio' || clip.muted) continue;
    const startAr = tempo.frameAt(clip.start);
    const start = scale(startAr);
    const length = scale(startAr + clip.sourceLength) - start;
    if (length <= 0) continue;
    let source = sourceIds.indexOf(clip.sourceId);
    if (source < 0) source = sourceIds.push(clip.sourceId) - 1;
    clips.push({
      id: clip.id,
      start,
      length,
      srcStart: Math.max(0, start + scale(clip.sourceOffset - startAr)),
      source,
      gain: clip.gainDb <= CLIP_GAIN_MIN_DB ? 0 : dbToGain(clip.gainDb),
      fadeIn: Math.min(length, scale(clip.fadeIn?.length ?? 0)),
      fadeOut: Math.min(length, scale(clip.fadeOut?.length ?? 0)),
      fadeInCurve: curveIndex(clip.fadeIn?.curve),
      fadeOutCurve: curveIndex(clip.fadeOut?.curve),
      envelope: (clip.envelope ?? []).map((p) => ({ frame: scale(p.frame), gain: p.gain })),
    });
  }
  clips.sort((a, b) => a.start - b.start);
  if (clips.length > MAX_CLIPS_PER_TRACK) clips.length = MAX_CLIPS_PER_TRACK;
  const equalPower = curveIndex('equalPower');
  for (let j = 1; j < clips.length; j++) {
    const b = clips[j];
    for (let i = 0; i < j; i++) {
      const a = clips[i];
      const aEnd = a.start + a.length;
      if (!(b.start < aEnd && aEnd <= b.start + b.length)) continue;
      // The longest overlap wins when a clip crossfades with several others.
      const overlap = aEnd - b.start;
      a.fadeOut = a.crossOut ? Math.max(a.fadeOut, overlap) : overlap;
      a.fadeOutCurve = equalPower;
      a.crossOut = true;
      b.fadeIn = b.crossIn ? Math.max(b.fadeIn, overlap) : overlap;
      b.fadeInCurve = equalPower;
      b.crossIn = true;
    }
  }
  const envStart = new Int32Array(clips.length + 1);
  const envFrame = [];
  const envGain = [];
  clips.forEach((c, i) => {
    let last = -Infinity;
    for (const p of c.envelope) {
      if (p.frame <= last) continue; // scaling can merge points
      envFrame.push(p.frame);
      envGain.push(p.gain);
      last = p.frame;
    }
    envStart[i + 1] = envFrame.length;
  });
  return {
    sourceIds,
    clips: {
      id: clips.map((c) => c.id),
      start: Int32Array.from(clips, (c) => c.start),
      length: Int32Array.from(clips, (c) => c.length),
      srcStart: Int32Array.from(clips, (c) => c.srcStart),
      source: Int32Array.from(clips, (c) => c.source),
      gain: Float32Array.from(clips, (c) => c.gain),
      fadeIn: Int32Array.from(clips, (c) => c.fadeIn),
      fadeOut: Int32Array.from(clips, (c) => c.fadeOut),
      fadeInCurve: Uint8Array.from(clips, (c) => c.fadeInCurve),
      fadeOutCurve: Uint8Array.from(clips, (c) => c.fadeOutCurve),
      envStart,
      envFrame: Int32Array.from(envFrame),
      envGain: Float32Array.from(envGain),
    },
  };
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

/** Model tracks for the document's instrument and audio tracks, in track order (engineTrackIds). */
function compileTracks(doc, tempo, scale) {
  const tracks = [];
  for (const trackId of doc.trackOrder) {
    const track = doc.tracks[trackId];
    if (track?.kind === 'audio') {
      tracks.push({
        trackId,
        kind: 'audio',
        gainDb: clampParam(TRACK_GAIN, track.gainDb),
        pan: clampParam(PAN, track.pan),
        mute: track.mute === true,
        solo: track.solo === true,
        ...compileClips(doc, track, scale),
      });
      continue;
    }
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
  const scale = scaler(doc, fs);
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
      tracks: compileTracks(doc, tempo, scale),
    },
  };
}
