/*
 * Clip and track commands (a3-audio-implementation.md, Edit math;
 * assignment-3-scope.md, Audio clips). Pure functions from a document to a
 * new document. Musical positions are integer ticks; audio offsets are integer
 * frames at the project's audioRate (the rate its sources were decoded at).
 * Results are { ok: true, doc, ... } or { ok: false, error: { code, message } }.
 */
import { TempoMap } from '../../dsp/timing/tempo-map.js';
import { createId, createDevice, createTrack } from './model.js';

export const MAX_TRACKS = 16;
/** Shortest audio clip after a trim, in frames (project limit). */
export const MIN_CLIP_FRAMES = 64;
/** Clip gain limits, dB; the minimum means −∞. */
export const CLIP_GAIN_MIN_DB = -60;
export const CLIP_GAIN_MAX_DB = 12;
/** Envelope point gain limits, linear (−∞ to +6 dB). */
export const ENVELOPE_GAIN_MAX = 1.9953;
export const FADE_CURVES = ['linear', 'equalPower', 'exp'];
export const DEFAULT_AUDIO_RATE = 48000;

const fail = (code, message) => ({ ok: false, error: { code, message } });
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const requireInt = (v, name) => {
  if (!Number.isInteger(v)) throw new Error(`${name} must be an integer, got ${v}`);
};

const TRACK_COLORS = ['#e36927', '#1659b5', '#1d6835', '#895709', '#c51e21', '#53574e'];

/** Tempo map at the project's audio rate, for tick ↔ frame conversion of audio clips. */
export function audioTempo(doc) {
  return new TempoMap(doc.tempo, doc.audioRate ?? DEFAULT_AUDIO_RATE);
}

function trackCount(doc) {
  return doc.trackOrder.length;
}

function withTrack(doc, track, append = false) {
  return {
    ...doc,
    tracks: { ...doc.tracks, [track.id]: track },
    trackOrder: append ? [...doc.trackOrder, track.id] : doc.trackOrder,
  };
}

/** Adds an empty audio track named `name` at the end. Returns { ok, doc, trackId }. */
export function addAudioTrack(doc, name, makeId = createId) {
  if (trackCount(doc) >= MAX_TRACKS) return fail('limit', `A project can have at most ${MAX_TRACKS} tracks.`);
  const id = makeId('trk');
  const track = createTrack({
    id,
    kind: 'audio',
    name: name ?? `Audio ${doc.trackOrder.filter((t) => doc.tracks[t].kind === 'audio').length + 1}`,
    color: TRACK_COLORS[trackCount(doc) % TRACK_COLORS.length],
    output: doc.masterTrackId,
  });
  return { ok: true, doc: withTrack(doc, track, true), trackId: id };
}

/** Adds an instrument track playing `type` with default settings. Returns { ok, doc, trackId }. */
export function addInstrumentTrack(doc, type, name, makeId = createId) {
  if (trackCount(doc) >= MAX_TRACKS) return fail('limit', `A project can have at most ${MAX_TRACKS} tracks.`);
  const device = createDevice({ id: makeId('dev'), type });
  const id = makeId('trk');
  const track = createTrack({
    id,
    kind: 'instrument',
    name: name ?? `Track ${trackCount(doc) + 1}`,
    color: TRACK_COLORS[trackCount(doc) % TRACK_COLORS.length],
    deviceIds: [device.id],
    output: doc.masterTrackId,
  });
  const next = withTrack(doc, track, true);
  next.devices = { ...doc.devices, [device.id]: device };
  return { ok: true, doc: next, trackId: id };
}

function extensionFor(name, mimeType) {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  if (fromName) return fromName.toLowerCase();
  return { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }[mimeType] ?? 'bin';
}

/**
 * Adds a clip of the whole `source` ({ sourceId, name, frames, rate,
 * channels, mimeType }) at tick `tick` on audio track `trackId`, or on a new
 * audio track when `trackId` is not an audio track. Records the source in
 * `doc.sources` and sets `doc.audioRate` on the first import.
 * Returns { ok, doc, clipId, trackId }.
 */
export function addAudioClip(doc, { trackId, tick, source }, makeId = createId) {
  requireInt(tick, 'tick');
  let next = doc.audioRate ? doc : { ...doc, audioRate: source.rate };
  let target = next.tracks[trackId]?.kind === 'audio' ? trackId : null;
  if (!target) {
    const added = addAudioTrack(next, source.name.replace(/\.[^.]+$/, ''), makeId);
    if (!added.ok) return added;
    next = added.doc;
    target = added.trackId;
  }
  const frames = Math.round((source.frames * next.audioRate) / source.rate);
  if (!next.sources[source.sourceId]) {
    next = {
      ...next,
      sources: {
        ...next.sources,
        [source.sourceId]: {
          id: source.sourceId,
          name: source.name,
          path: `audio/${source.sourceId}.${extensionFor(source.name, source.mimeType)}`,
          sampleRate: next.audioRate,
          channels: source.channels.length ?? source.channels,
          frames,
          format: source.mimeType || '',
          sha256: source.sourceId,
        },
      },
    };
  }
  const clipId = makeId('clp');
  const clip = {
    id: clipId,
    trackId: target,
    kind: 'audio',
    start: Math.max(0, tick),
    name: source.name.replace(/\.[^.]+$/, ''),
    muted: false,
    sourceId: source.sourceId,
    sourceOffset: 0,
    sourceLength: frames,
    gainDb: 0,
    fadeIn: { length: 0, curve: 'linear' },
    fadeOut: { length: 0, curve: 'linear' },
    envelope: [],
  };
  const track = next.tracks[target];
  next = {
    ...next,
    clips: { ...next.clips, [clipId]: clip },
    tracks: { ...next.tracks, [target]: { ...track, clipIds: [...track.clipIds, clipId] } },
  };
  return { ok: true, doc: next, clipId, trackId: target };
}

/** Clip end in ticks: start + length for MIDI clips; the tick of the last frame + 1 for audio clips. */
export function clipEndTick(doc, clip) {
  if (clip.kind === 'midi') return clip.start + clip.length;
  const tempo = audioTempo(doc);
  return tempo.tickAt(tempo.frameAt(clip.start) + clip.sourceLength - 1) + 1;
}

function getClip(doc, clipId) {
  return doc.clips[clipId] ?? null;
}

function setClip(doc, clip) {
  return { ...doc, clips: { ...doc.clips, [clip.id]: clip } };
}

/** Drops SourceRefs no clip uses any more. */
function pruneSources(doc) {
  const used = new Set(Object.values(doc.clips).filter((c) => c.kind === 'audio').map((c) => c.sourceId));
  const keep = Object.fromEntries(Object.entries(doc.sources).filter(([id]) => used.has(id)));
  return Object.keys(keep).length === Object.keys(doc.sources).length ? doc : { ...doc, sources: keep };
}

/**
 * Moves a clip by `dTick` ticks and, with `toTrackId`, onto another track of
 * the same kind (instrument tracks for MIDI clips, audio tracks for audio
 * clips). The start stays at or after bar 1; source fields are unchanged.
 */
export function moveClip(doc, clipId, dTick, toTrackId) {
  requireInt(dTick, 'dTick');
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  const from = doc.tracks[clip.trackId];
  const to = toTrackId ? doc.tracks[toTrackId] : from;
  if (!to) return fail('missing', 'No such track.');
  const wanted = clip.kind === 'midi' ? 'instrument' : 'audio';
  if (to.kind !== wanted) {
    return fail('invalid', clip.kind === 'midi' ? 'MIDI clips move between instrument tracks only.' : 'Audio clips move between audio tracks only.');
  }
  const moved = { ...clip, start: Math.max(0, clip.start + dTick), trackId: to.id };
  let next = setClip(doc, moved);
  if (to.id !== from.id) {
    next.tracks = {
      ...doc.tracks,
      [from.id]: { ...from, clipIds: from.clipIds.filter((id) => id !== clipId) },
      [to.id]: { ...to, clipIds: [...to.clipIds, clipId] },
    };
  }
  return { ok: true, doc: next, clip: moved };
}

/** Copies a clip to start right after the original on the same track. Returns { ok, doc, clipId }. */
export function duplicateClip(doc, clipId, makeId = createId) {
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  const id = makeId('clp');
  const copy = { ...structuredClone(clip), id, start: clipEndTick(doc, clip) };
  if (copy.kind === 'midi') copy.notes = copy.notes.map((n) => ({ ...n, id: makeId('nte') }));
  const track = doc.tracks[clip.trackId];
  const next = setClip(doc, copy);
  next.tracks = { ...doc.tracks, [track.id]: { ...track, clipIds: [...track.clipIds, id] } };
  return { ok: true, doc: next, clipId: id };
}

/** Removes a clip; a source no other clip uses leaves `doc.sources`. */
export function deleteClip(doc, clipId) {
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  const { [clipId]: _removed, ...clips } = doc.clips;
  const track = doc.tracks[clip.trackId];
  const next = {
    ...doc,
    clips,
    tracks: { ...doc.tracks, [track.id]: { ...track, clipIds: track.clipIds.filter((id) => id !== clipId) } },
  };
  return { ok: true, doc: pruneSources(next) };
}

/**
 * Splits a clip at tick `tick` (strictly inside it). Audio: d = frameAt(T) −
 * frameAt(start); left keeps d frames, right starts at T with srcStart + d.
 * MIDI: notes before the split stay left (cropped at it), the rest move right.
 * Returns { ok, doc, leftId, rightId }.
 */
export function splitClip(doc, clipId, tick, makeId = createId) {
  requireInt(tick, 'tick');
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  if (tick <= clip.start || tick >= clipEndTick(doc, clip)) return fail('invalid', 'The split point is outside the clip.');
  const rightId = makeId('clp');
  let left;
  let right;
  if (clip.kind === 'audio') {
    const tempo = audioTempo(doc);
    const d = tempo.frameAt(tick) - tempo.frameAt(clip.start);
    if (d < MIN_CLIP_FRAMES || clip.sourceLength - d < MIN_CLIP_FRAMES) return fail('invalid', 'Each part of a split needs at least 64 frames.');
    left = { ...clip, sourceLength: d, fadeOut: { length: 0, curve: clip.fadeOut.curve }, envelope: clip.envelope.filter((p) => p.frame < d) };
    right = {
      ...clip,
      id: rightId,
      start: tick,
      sourceOffset: clip.sourceOffset + d,
      sourceLength: clip.sourceLength - d,
      fadeIn: { length: 0, curve: clip.fadeIn.curve },
      envelope: clip.envelope.filter((p) => p.frame >= d).map((p) => ({ ...p, frame: p.frame - d })),
    };
  } else {
    const d = tick - clip.start;
    left = {
      ...clip,
      length: d,
      notes: clip.notes.filter((n) => n.tick < d).map((n) => ({ ...n, length: Math.min(n.length, d - n.tick) })),
    };
    right = {
      ...clip,
      id: rightId,
      start: tick,
      length: clip.length - d,
      notes: clip.notes.filter((n) => n.tick >= d).map((n) => ({ ...n, id: makeId('nte'), tick: n.tick - d })),
    };
  }
  const track = doc.tracks[clip.trackId];
  const index = track.clipIds.indexOf(clipId);
  const clipIds = [...track.clipIds.slice(0, index + 1), rightId, ...track.clipIds.slice(index + 1)];
  const next = { ...doc, clips: { ...doc.clips, [clipId]: left, [rightId]: right }, tracks: { ...doc.tracks, [track.id]: { ...track, clipIds } } };
  return { ok: true, doc: next, leftId: clipId, rightId };
}

/**
 * Why clips `a` and `b` (in that order) cannot join, or null when they can:
 * same track, B starts where A ends and, for audio, the same source with
 * contiguous offsets.
 */
export function joinBlocker(doc, aId, bId) {
  const a = getClip(doc, aId);
  const b = getClip(doc, bId);
  if (!a || !b) return 'Select two clips to join.';
  if (a.trackId !== b.trackId) return 'Only clips on the same track can be joined.';
  if (a.kind !== b.kind) return 'An audio clip and a MIDI clip cannot be joined.';
  if (a.kind === 'midi') return b.start === a.start + a.length ? null : 'The clips must touch: the second starts where the first ends.';
  if (a.sourceId !== b.sourceId) return 'The clips use different audio files.';
  if (b.sourceOffset !== a.sourceOffset + a.sourceLength) return 'The second clip does not continue the first clip’s audio.';
  const tempo = audioTempo(doc);
  if (tempo.frameAt(b.start) !== tempo.frameAt(a.start) + a.sourceLength) return 'The clips must touch: the second starts where the first ends.';
  return null;
}

/** Joins B into A (A keeps its fade-in, takes B's fade-out; envelopes concatenate). */
export function joinClips(doc, aId, bId) {
  const blocker = joinBlocker(doc, aId, bId);
  if (blocker) return fail('invalid', blocker);
  const a = doc.clips[aId];
  const b = doc.clips[bId];
  const joined =
    a.kind === 'audio'
      ? {
          ...a,
          sourceLength: a.sourceLength + b.sourceLength,
          fadeOut: b.fadeOut,
          envelope: [...a.envelope, ...b.envelope.map((p) => ({ ...p, frame: p.frame + a.sourceLength }))],
        }
      : { ...a, length: a.length + b.length, notes: [...a.notes, ...b.notes.map((n) => ({ ...n, tick: n.tick + a.length }))] };
  const removed = deleteClip(setClip(doc, joined), bId);
  return { ok: true, doc: removed.doc, clipId: aId };
}

/**
 * Trims an audio clip's start by `deltaFrames` (positive shortens): srcStart
 * += Δ, srcLength −= Δ, start = tickAt(frameAt(start) + Δ); srcStart ≥ 0 and
 * srcLength ≥ 64 hold. MIDI clips trim by `deltaFrames` read as ticks.
 */
export function trimStart(doc, clipId, delta) {
  requireInt(delta, 'delta');
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  if (clip.kind === 'midi') {
    const d = clamp(delta, -clip.start, clip.length - 1);
    return {
      ok: true,
      doc: setClip(doc, {
        ...clip,
        start: clip.start + d,
        length: clip.length - d,
        notes: clip.notes.filter((n) => n.tick - d >= 0).map((n) => ({ ...n, tick: n.tick - d })),
      }),
    };
  }
  const d = clamp(delta, -clip.sourceOffset, clip.sourceLength - MIN_CLIP_FRAMES);
  const tempo = audioTempo(doc);
  const startFrame = Math.max(0, tempo.frameAt(clip.start) + d);
  return {
    ok: true,
    doc: setClip(doc, {
      ...clip,
      start: tempo.tickAt(startFrame),
      sourceOffset: clip.sourceOffset + d,
      sourceLength: clip.sourceLength - d,
      envelope: clip.envelope.map((p) => ({ ...p, frame: p.frame - d })).filter((p) => p.frame >= 0),
    }),
  };
}

/** Trims an audio clip's end to `sourceLength + delta` frames within [64, sourceFrames − srcStart]; MIDI clips by ticks. */
export function trimEnd(doc, clipId, delta) {
  requireInt(delta, 'delta');
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  if (clip.kind === 'midi') return { ok: true, doc: setClip(doc, { ...clip, length: Math.max(1, clip.length + delta) }) };
  const sourceFrames = doc.sources[clip.sourceId]?.frames ?? clip.sourceOffset + clip.sourceLength;
  const length = clamp(clip.sourceLength + delta, MIN_CLIP_FRAMES, sourceFrames - clip.sourceOffset);
  return { ok: true, doc: setClip(doc, { ...clip, sourceLength: length, envelope: clip.envelope.filter((p) => p.frame < length) }) };
}

/** Sets clip gain in dB, −∞ (the minimum) to +12 dB. */
export function setClipGain(doc, clipId, gainDb) {
  const clip = getClip(doc, clipId);
  if (!clip || clip.kind !== 'audio') return fail('missing', 'No audio clip.');
  return { ok: true, doc: setClip(doc, { ...clip, gainDb: clamp(gainDb, CLIP_GAIN_MIN_DB, CLIP_GAIN_MAX_DB) }) };
}

/**
 * Sets the fade-in or fade-out (`which`) to `length` frames and `curve`.
 * Fade-in plus fade-out never exceeds the clip length.
 */
export function setFade(doc, clipId, which, length, curve) {
  requireInt(length, 'length');
  const clip = getClip(doc, clipId);
  if (!clip || clip.kind !== 'audio') return fail('missing', 'No audio clip.');
  if (!FADE_CURVES.includes(curve)) return fail('invalid', 'Unknown fade curve.');
  const other = which === 'fadeIn' ? clip.fadeOut.length : clip.fadeIn.length;
  const fade = { length: clamp(length, 0, clip.sourceLength - other), curve };
  return { ok: true, doc: setClip(doc, { ...clip, [which]: fade }) };
}

/** Adds an envelope point at clip-relative `frame` with linear `gain` (0 to +6 dB). Points stay sorted. */
export function addEnvelopePoint(doc, clipId, frame, gain) {
  requireInt(frame, 'frame');
  const clip = getClip(doc, clipId);
  if (!clip || clip.kind !== 'audio') return fail('missing', 'No audio clip.');
  const point = { frame: clamp(frame, 0, clip.sourceLength - 1), gain: clamp(gain, 0, ENVELOPE_GAIN_MAX) };
  const envelope = [...clip.envelope.filter((p) => p.frame !== point.frame), point].sort((a, b) => a.frame - b.frame);
  return { ok: true, doc: setClip(doc, { ...clip, envelope }) };
}

/** Sets envelope point `index` to `frame` and `gain`; points stay sorted. */
export function setEnvelopePoint(doc, clipId, index, frame, gain) {
  const clip = getClip(doc, clipId);
  if (!clip?.envelope?.[index]) return fail('missing', 'No such envelope point.');
  const rest = clip.envelope.filter((_, i) => i !== index);
  return addEnvelopePoint(setClip(doc, { ...clip, envelope: rest }), clipId, frame, gain);
}

/** Removes envelope point `index`. */
export function removeEnvelopePoint(doc, clipId, index) {
  const clip = getClip(doc, clipId);
  if (!clip?.envelope?.[index]) return fail('missing', 'No such envelope point.');
  return { ok: true, doc: setClip(doc, { ...clip, envelope: clip.envelope.filter((_, i) => i !== index) }) };
}

/** Renames a clip (1–60 characters after trimming). */
export function renameClip(doc, clipId, name) {
  const clip = getClip(doc, clipId);
  const trimmed = String(name ?? '').trim();
  if (!clip) return fail('missing', 'No such clip.');
  if (!trimmed) return fail('invalid', 'Enter a clip name.');
  if ([...trimmed].length > 60) return fail('invalid', 'Use 60 characters or fewer.');
  return { ok: true, doc: setClip(doc, { ...clip, name: trimmed }) };
}

/** Sets a clip's colour (a CSS hex colour). */
export function setClipColor(doc, clipId, color) {
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No such clip.');
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fail('invalid', 'Use a colour like #e36927.');
  return { ok: true, doc: setClip(doc, { ...clip, color }) };
}
