/*
 * Clip and track commands (a3-audio-implementation.md, Edit math;
 * assignment-3-scope.md, Audio clips). Pure functions from a document to a
 * new document. Musical positions are integer ticks; audio offsets are integer
 * frames at the project's audioRate (the rate its sources were decoded at).
 * Results are { ok: true, doc, ... } or { ok: false, error: { code, message } }.
 */
import { TempoMap } from '../../dsp/timing/tempo-map.js';
import { INSTRUMENT_LABELS, createId, createDevice, createTrack } from './model.js';

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

/**
 * Track and clip colours (tokens.css): hues no semantic colour uses (focus blue,
 * danger red, primary orange, lamp amber), each at least 3.5:1 on the lanes.
 */
export const COLORS = [
  { value: '#20857b', label: 'Teal' },
  { value: '#6a4fa9', label: 'Violet' },
  { value: '#667f30', label: 'Olive' },
  { value: '#b54076', label: 'Rose' },
  { value: '#a25e2b', label: 'Copper' },
  { value: '#576574', label: 'Slate' },
];
const TRACK_COLORS = COLORS.map((c) => c.value);

const tempoCache = new WeakMap(); // doc.tempo → { rate, map }

/** Tempo map at the project's audio rate, for tick ↔ frame conversion of audio clips. Cached per tempo array. */
export function audioTempo(doc) {
  const rate = doc.audioRate ?? DEFAULT_AUDIO_RATE;
  const cached = tempoCache.get(doc.tempo);
  if (cached?.rate === rate) return cached.map;
  const map = new TempoMap(doc.tempo, rate);
  tempoCache.set(doc.tempo, { rate, map });
  return map;
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

/**
 * Changes instrument track `trackId` to a new instrument of `type` at its default
 * settings. The clips and notes, effects, mixer settings, name and colour stay; the
 * old instrument's settings go, and audio only it used is released. The new device
 * gets a new ID, so the engine builds it afresh. Returns { ok, doc, deviceId }.
 */
export function setInstrumentType(doc, trackId, type, makeId = createId) {
  const track = doc.tracks[trackId];
  if (!track || track.kind !== 'instrument') return fail('missing', 'Choose an instrument track.');
  if (!INSTRUMENT_LABELS[type]) return fail('invalid', `There is no instrument "${type}".`);
  const oldId = track.deviceIds[0];
  if (doc.devices[oldId]?.type === type) return { ok: true, doc, deviceId: oldId };
  const device = createDevice({ id: makeId('dev'), type });
  const devices = { ...doc.devices, [device.id]: device };
  delete devices[oldId];
  const next = { ...doc, devices, tracks: { ...doc.tracks, [trackId]: { ...track, deviceIds: [device.id, ...track.deviceIds.slice(1)] } } };
  return { ok: true, doc: pruneSources(next), deviceId: device.id };
}

function extensionFor(name, mimeType) {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  if (fromName) return fromName.toLowerCase();
  return { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' }[mimeType] ?? 'bin';
}

/**
 * Returns `doc` with a SourceRef for `source` (a decode.js entry) in
 * `doc.sources`, setting `doc.audioRate` on the first source. Frames are
 * recorded at audioRate.
 */
export function withSourceRef(doc, source) {
  const next = doc.audioRate ? doc : { ...doc, audioRate: source.rate };
  if (next.sources[source.sourceId]) return next;
  return {
    ...next,
    sources: {
      ...next.sources,
      [source.sourceId]: {
        id: source.sourceId,
        name: source.name,
        path: `audio/${source.sourceId}.${extensionFor(source.name, source.mimeType)}`,
        sampleRate: next.audioRate,
        channels: Array.isArray(source.channels) ? source.channels.length : source.channels,
        frames: Math.round((source.frames * next.audioRate) / source.rate),
        format: source.mimeType || '',
        sha256: source.sourceId,
      },
    },
  };
}

/** Longest sampler-bound source, seconds, and the mip memory limit, bytes (project limits). */
export const SAMPLER_MAX_SOURCE_S = 60;
export const SAMPLER_MIP_BYTES = 64 * 1024 * 1024;

/** Mip memory of the sources sampler devices use: 0.75 × frames × channels × 4 bytes each. */
export function samplerMipBytes(doc) {
  const ids = new Set(Object.values(doc.devices).map((d) => d.sampler?.sourceId).filter(Boolean));
  let bytes = 0;
  for (const id of ids) {
    const ref = doc.sources[id];
    if (ref) bytes += 0.75 * ref.frames * ref.channels * 4;
  }
  return bytes;
}

/**
 * Sets sampler device `deviceId`'s zone source to `source` (a decode.js
 * entry), or clears it with null. Enforces the 60 s source and 64 MB mip limits.
 */
/**
 * The source an instrument device plays, { sourceId, sourceName }, or null:
 * a sampler's zone or granular's File source.
 */
export function deviceSource(device) {
  const ref = device.type === 'sampler' ? device.sampler : device.type === 'granular' ? device.granular : null;
  return ref?.sourceId ? ref : null;
}

/**
 * Sets granular device `deviceId`'s File source to `source` ({ sourceId,
 * name, frames, rate, … }), or clears it with null. Files longer than 20 s
 * play their first 20 s. Returns { ok, doc }.
 */
export function setGranularSource(doc, deviceId, source) {
  const device = doc.devices[deviceId];
  if (!device || device.type !== 'granular') return fail('missing', 'No granular instrument.');
  if (source === null) return { ok: true, doc: pruneSources({ ...doc, devices: { ...doc.devices, [deviceId]: { ...device, granular: null } } }) };
  const next = withSourceRef(doc, source);
  return { ok: true, doc: pruneSources({ ...next, devices: { ...next.devices, [deviceId]: { ...device, granular: { sourceId: source.sourceId, sourceName: source.name } } } }) };
}

export function setSamplerSource(doc, deviceId, source) {
  const device = doc.devices[deviceId];
  if (!device || device.type !== 'sampler') return fail('missing', 'No sampler.');
  if (source === null) return { ok: true, doc: pruneSources({ ...doc, devices: { ...doc.devices, [deviceId]: { ...device, sampler: null } } }) };
  if (source.frames / source.rate > SAMPLER_MAX_SOURCE_S) {
    return fail('limit', `${source.name} is longer than 60 seconds. A sampler source can be at most 60 seconds long.`);
  }
  let next = withSourceRef(doc, source);
  next = { ...next, devices: { ...next.devices, [deviceId]: { ...device, sampler: { sourceId: source.sourceId, sourceName: source.name } } } };
  if (samplerMipBytes(next) > SAMPLER_MIP_BYTES) return fail('limit', `${source.name} was not set. Sampler sources can use at most 64 MB of memory.`);
  return { ok: true, doc: pruneSources(next) };
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
  next = withSourceRef(next, source);
  const frames = next.sources[source.sourceId].frames;
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

/** Drops SourceRefs no audio clip or sampler zone uses any more. */
export function pruneSources(doc) {
  const used = new Set(Object.values(doc.clips).filter((c) => c.kind === 'audio').map((c) => c.sourceId));
  for (const device of Object.values(doc.devices)) {
    const ref = deviceSource(device);
    if (ref) used.add(ref.sourceId);
  }
  const keep = Object.fromEntries(Object.entries(doc.sources).filter(([id]) => used.has(id)));
  return Object.keys(keep).length === Object.keys(doc.sources).length ? doc : { ...doc, sources: keep };
}

/**
 * Envelope points that shape clip frames [lo, hi): the points inside plus the
 * nearest point on each side. Points outside a clip are kept as anchors, so a
 * segment that crosses a split or trim edge keeps its slope.
 */
function envelopeWindow(envelope, lo, hi) {
  let before = -1;
  let after = -1;
  envelope.forEach((p, i) => {
    if (p.frame < lo) before = i;
    else if (p.frame >= hi && after < 0) after = i;
  });
  return envelope.filter((p, i) => i === before || i === after || (p.frame >= lo && p.frame < hi));
}

const shiftEnvelope = (envelope, d) => envelope.map((p) => ({ ...p, frame: p.frame - d }));

/** Envelope gain at clip frame `p`: linear between points, held outside them, 1 without points. */
export function envelopeGainAt(envelope, p) {
  if (envelope.length === 0) return 1;
  if (p <= envelope[0].frame) return envelope[0].gain;
  for (let i = 1; i < envelope.length; i++) {
    const b = envelope[i];
    if (p < b.frame) {
      const a = envelope[i - 1];
      return a.gain + ((p - a.frame) * (b.gain - a.gain)) / (b.frame - a.frame);
    }
  }
  return envelope[envelope.length - 1].gain;
}

/** Envelope points inside the clip (frames 0 to length − 1), the ones the properties panel edits. */
export function visibleEnvelope(clip) {
  return clip.envelope.filter((p) => p.frame >= 0 && p.frame < clip.sourceLength);
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

const without = (map, ids) => Object.fromEntries(Object.entries(map).filter(([id]) => !ids.includes(id)));

/**
 * Removes a track with its clips, devices, sends and lanes; sources nothing
 * else uses leave `doc.sources`. The master bus cannot be removed.
 */
export function removeTrack(doc, trackId) {
  const track = doc.tracks[trackId];
  if (!track || trackId === doc.masterTrackId) return fail('missing', 'No such track.');
  const next = {
    ...doc,
    trackOrder: doc.trackOrder.filter((id) => id !== trackId),
    tracks: without(doc.tracks, [trackId]),
    clips: without(doc.clips, track.clipIds),
    devices: without(doc.devices, track.deviceIds),
    sends: without(doc.sends, track.sendIds),
    lanes: without(doc.lanes, track.laneIds),
  };
  return { ok: true, doc: pruneSources(next) };
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
 * frameAt(start); left keeps d frames, right starts at T with srcStart + d;
 * each part keeps the envelope points that shape it, so both render the same
 * samples as the unsplit clip. A split inside a fade is refused.
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
    if (d < clip.fadeIn.length || clip.sourceLength - d < clip.fadeOut.length) {
      return fail('invalid', 'The split point is inside a fade. Split outside the fades or shorten them first.');
    }
    left = { ...clip, sourceLength: d, fadeOut: { length: 0, curve: clip.fadeOut.curve }, envelope: envelopeWindow(clip.envelope, 0, d) };
    right = {
      ...clip,
      id: rightId,
      start: tick,
      sourceOffset: clip.sourceOffset + d,
      sourceLength: clip.sourceLength - d,
      fadeIn: { length: 0, curve: clip.fadeIn.curve },
      envelope: shiftEnvelope(envelopeWindow(clip.envelope, d, clip.sourceLength), d),
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

/**
 * The joined envelope of audio clips A and B. Parts of one split share their
 * boundary segment's anchor points (by point ID) and rejoin exactly. Otherwise
 * each side keeps its own gain up to the boundary: A's value at its last frame
 * and B's at its first become points, and a side without an envelope is 1.
 */
function joinEnvelopes(a, b, makeId) {
  const len = a.sourceLength;
  if (a.envelope.length === 0 && b.envelope.length === 0) return [];
  const inA = a.envelope.filter((p) => p.frame < len);
  const inB = shiftEnvelope(b.envelope, -len).filter((p) => p.frame >= len);
  const ids = (env) => new Set(env.filter((p) => p.id !== undefined).map((p) => p.id));
  const aIds = ids(a.envelope);
  const bIds = ids(b.envelope);
  const continuous =
    a.envelope.some((p) => p.frame >= len && bIds.has(p.id)) && b.envelope.some((p) => p.frame < 0 && aIds.has(p.id));
  if (continuous) return [...inA, ...inB];
  const edgeA = { id: makeId('env'), frame: len - 1, gain: envelopeGainAt(a.envelope, len - 1) };
  const edgeB = { id: makeId('env'), frame: len, gain: envelopeGainAt(b.envelope, 0) };
  return [...inA.filter((p) => p.frame < len - 1), edgeA, edgeB, ...inB.filter((p) => p.frame > len)];
}

/** Joins B into A (A keeps its fade-in and takes B's fade-out; joinEnvelopes merges the envelopes). */
export function joinClips(doc, aId, bId, makeId = createId) {
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
          envelope: joinEnvelopes(a, b, makeId),
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
  const tempo = audioTempo(doc);
  const startFrame = tempo.frameAt(clip.start);
  // The start cannot move before the source start or before bar 1.
  const d = clamp(delta, Math.max(-clip.sourceOffset, -startFrame), clip.sourceLength - MIN_CLIP_FRAMES);
  return {
    ok: true,
    doc: setClip(doc, {
      ...clip,
      start: tempo.tickAt(startFrame + d),
      sourceOffset: clip.sourceOffset + d,
      sourceLength: clip.sourceLength - d,
      envelope: shiftEnvelope(envelopeWindow(clip.envelope, d, clip.sourceLength), d),
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
  return { ok: true, doc: setClip(doc, { ...clip, sourceLength: length, envelope: envelopeWindow(clip.envelope, 0, length) }) };
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

/**
 * Adds an envelope point at clip-relative `frame` (0 to length − 1) with
 * linear `gain` (0 to +6 dB); a point already at that frame takes the gain.
 * Points stay sorted. Returns { ok, doc, pointId }.
 */
export function addEnvelopePoint(doc, clipId, frame, gain, makeId = createId) {
  requireInt(frame, 'frame');
  const clip = getClip(doc, clipId);
  if (!clip || clip.kind !== 'audio') return fail('missing', 'No audio clip.');
  const at = clamp(frame, 0, clip.sourceLength - 1);
  const g = clamp(gain, 0, ENVELOPE_GAIN_MAX);
  const existing = clip.envelope.find((p) => p.frame === at);
  const point = existing ? { ...existing, gain: g } : { id: makeId('env'), frame: at, gain: g };
  const envelope = [...clip.envelope.filter((p) => p !== existing), point].sort((a, b) => a.frame - b.frame);
  return { ok: true, doc: setClip(doc, { ...clip, envelope }), pointId: point.id };
}

/**
 * Sets envelope point `pointId` to `frame` and `gain`. The frame stays inside
 * the clip and strictly between the neighbouring points, so the order holds.
 */
export function setEnvelopePoint(doc, clipId, pointId, frame, gain) {
  const clip = getClip(doc, clipId);
  const i = clip?.envelope?.findIndex((p) => p.id === pointId) ?? -1;
  if (i < 0) return fail('missing', 'No such envelope point.');
  const lo = Math.max(0, (clip.envelope[i - 1]?.frame ?? -1) + 1);
  const hi = Math.min(clip.sourceLength - 1, (clip.envelope[i + 1]?.frame ?? clip.sourceLength) - 1);
  const point = { ...clip.envelope[i], frame: lo <= hi ? clamp(Math.round(frame), lo, hi) : clip.envelope[i].frame, gain: clamp(gain, 0, ENVELOPE_GAIN_MAX) };
  const envelope = clip.envelope.map((p, j) => (j === i ? point : p));
  return { ok: true, doc: setClip(doc, { ...clip, envelope }) };
}

/** Removes envelope point `pointId`. */
export function removeEnvelopePoint(doc, clipId, pointId) {
  const clip = getClip(doc, clipId);
  if (!clip?.envelope?.some((p) => p.id === pointId)) return fail('missing', 'No such envelope point.');
  return { ok: true, doc: setClip(doc, { ...clip, envelope: clip.envelope.filter((p) => p.id !== pointId) }) };
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
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fail('invalid', 'Use a colour like #20857b.');
  return { ok: true, doc: setClip(doc, { ...clip, color }) };
}
