/*
 * Note editing commands (a3-agent-plan.md, Phase 8): pure functions from a
 * project document to a new document with structural sharing. Every time is an
 * integer tick (PPQ 960); a fractional tick is a programming error and throws.
 * Results are { ok: true, doc, ... } or { ok: false, error: { code, message } }.
 */
import { createId, ticksPerBar } from './model.js';

/** Default velocity of a new note (midi.md, project limit). */
export const DEFAULT_VELOCITY = 100;
export const PITCH_MIN = 0;
export const PITCH_MAX = 127;
export const VELOCITY_MIN = 1;
export const VELOCITY_MAX = 127;

/** Length of a clip created by the first note on an empty track, in bars. */
export const NEW_CLIP_BARS = 4;

function requireTick(value, name) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer tick count, got ${value}`);
}

const fail = (code, message) => ({ ok: false, error: { code, message } });
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function withClip(doc, clip) {
  return { ...doc, clips: { ...doc.clips, [clip.id]: clip } };
}

function getClip(doc, clipId) {
  const clip = doc.clips[clipId];
  return clip && clip.kind === 'midi' ? clip : null;
}

/**
 * Creates an empty MIDI clip on `trackId` at tick `start` spanning `length`
 * ticks (default: four bars of the first meter). Returns { ok, doc, clipId }.
 */
export function createClip(doc, trackId, { start = 0, length, name } = {}, makeId = createId) {
  const track = doc.tracks[trackId];
  if (!track || track.kind !== 'instrument') return fail('missing', 'MIDI clips go on instrument tracks.');
  const { numerator, denominator } = doc.meter[0];
  const len = length ?? NEW_CLIP_BARS * ticksPerBar(numerator, denominator);
  requireTick(start, 'start');
  requireTick(len, 'length');
  if (len < 1 || start < 0) return fail('invalid', 'A clip needs a start at or after bar 1 and a length.');
  const clipId = makeId('clp');
  const clip = { id: clipId, trackId, kind: 'midi', start, length: len, name: name ?? track.name, muted: false, notes: [] };
  const next = withClip(doc, clip);
  next.tracks = { ...doc.tracks, [trackId]: { ...track, clipIds: [...track.clipIds, clipId] } };
  return { ok: true, doc: next, clipId };
}

/**
 * Adds a note at clip-relative `tick` with `pitch`, `length` and `velocity`.
 * The note must start inside the clip. Returns { ok, doc, noteId }.
 */
export function addNote(doc, clipId, { tick, pitch, length, velocity = DEFAULT_VELOCITY }, makeId = createId) {
  requireTick(tick, 'tick');
  requireTick(length, 'length');
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No MIDI clip to add the note to.');
  if (tick < 0 || tick >= clip.length) return fail('invalid', 'Notes start inside their clip.');
  if (!Number.isInteger(pitch) || pitch < PITCH_MIN || pitch > PITCH_MAX) return fail('invalid', 'Pitch is 0–127.');
  if (length < 1) return fail('invalid', 'A note lasts at least one tick.');
  const noteId = makeId('nte');
  const note = { id: noteId, tick, length, pitch, velocity: clamp(Math.round(velocity), VELOCITY_MIN, VELOCITY_MAX), channel: 0 };
  return { ok: true, doc: withClip(doc, { ...clip, notes: [...clip.notes, note] }), noteId };
}

function updateNote(doc, clipId, noteId, update) {
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No MIDI clip.');
  const index = clip.notes.findIndex((n) => n.id === noteId);
  if (index < 0) return fail('missing', 'No such note.');
  const note = update(clip.notes[index], clip);
  const notes = clip.notes.slice();
  notes[index] = note;
  return { ok: true, doc: withClip(doc, { ...clip, notes }), note };
}

/**
 * Moves a note by `dTick` ticks and `dPitch` semitones. Its start stays
 * inside the clip and its pitch within 0–127.
 */
export function moveNote(doc, clipId, noteId, dTick = 0, dPitch = 0) {
  requireTick(dTick, 'dTick');
  if (!Number.isInteger(dPitch)) throw new Error('dPitch must be an integer');
  return updateNote(doc, clipId, noteId, (n, clip) => ({
    ...n,
    tick: clamp(n.tick + dTick, 0, clip.length - 1),
    pitch: clamp(n.pitch + dPitch, PITCH_MIN, PITCH_MAX),
  }));
}

/** Changes a note's length by `dLength` ticks; the length stays at least `minLength` (≥ 1). */
export function resizeNote(doc, clipId, noteId, dLength, minLength = 1) {
  requireTick(dLength, 'dLength');
  requireTick(minLength, 'minLength');
  return updateNote(doc, clipId, noteId, (n) => ({ ...n, length: Math.max(Math.max(1, minLength), n.length + dLength) }));
}

/** Sets a note's velocity, clamped to 1–127. */
export function setVelocity(doc, clipId, noteId, velocity) {
  return updateNote(doc, clipId, noteId, (n) => ({ ...n, velocity: clamp(Math.round(velocity), VELOCITY_MIN, VELOCITY_MAX) }));
}

/** Removes a note. */
export function deleteNote(doc, clipId, noteId) {
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No MIDI clip.');
  if (!clip.notes.some((n) => n.id === noteId)) return fail('missing', 'No such note.');
  return { ok: true, doc: withClip(doc, { ...clip, notes: clip.notes.filter((n) => n.id !== noteId) }) };
}

/**
 * Moves note starts to the nearest multiple of `grid` ticks (100 %), keeping
 * lengths; starts stay inside the clip. `noteIds` limits it to a selection;
 * by default every note in the clip.
 */
export function quantize(doc, clipId, grid, noteIds = null) {
  requireTick(grid, 'grid');
  if (grid < 1) throw new Error('grid must be ≥ 1 tick');
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No MIDI clip.');
  const only = noteIds ? new Set(noteIds) : null;
  const last = Math.floor((clip.length - 1) / grid) * grid;
  const notes = clip.notes.map((n) =>
    only && !only.has(n.id) ? n : { ...n, tick: Math.min(last, Math.round(n.tick / grid) * grid) },
  );
  return { ok: true, doc: withClip(doc, { ...clip, notes }) };
}

/**
 * Sets the clip's loop length in ticks (the notes in [0, loopLength) repeat to
 * fill the clip), or removes it with null.
 */
export function setLoopLength(doc, clipId, loopLength) {
  const clip = getClip(doc, clipId);
  if (!clip) return fail('missing', 'No MIDI clip.');
  if (loopLength === null) {
    const { loopLength: _removed, ...rest } = clip;
    return { ok: true, doc: withClip(doc, rest) };
  }
  requireTick(loopLength, 'loopLength');
  if (loopLength < 1) return fail('invalid', 'A loop lasts at least one tick.');
  return { ok: true, doc: withClip(doc, { ...clip, loopLength }) };
}

/** The note in `clip` that starts at `tick` with `pitch`, or the one covering that cell; undefined if none. */
export function noteAt(clip, tick, pitch, cell = 1) {
  return (
    clip.notes.find((n) => n.pitch === pitch && n.tick >= tick && n.tick < tick + cell) ??
    clip.notes.find((n) => n.pitch === pitch && n.tick < tick && n.tick + n.length > tick)
  );
}

/**
 * Expands a clip's notes for playback (a3-audio-implementation.md, Compile
 * step): a note at clip tick t < loopLength repeats at t + k·loopLength while
 * it starts inside the clip; each repeat is cropped at the end of its loop pass
 * and at the clip end. Notes at or after loopLength do not sound in a looping
 * clip. Returns notes with
 * clip-relative ticks; stops at `cap` notes.
 */
export function expandClipNotes(clip, cap = Infinity) {
  const out = [];
  const loop = clip.loopLength && clip.loopLength < clip.length ? clip.loopLength : null;
  const sorted = [...clip.notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const push = (n, tick, passEnd) => {
    if (out.length >= cap) return false;
    const length = Math.min(n.length, passEnd - tick);
    if (length >= 1) out.push({ tick, length, pitch: n.pitch, velocity: n.velocity });
    return true;
  };
  if (!loop) {
    for (const n of sorted) if (n.tick < clip.length && !push(n, n.tick, clip.length)) break;
    return out;
  }
  for (let base = 0; base < clip.length; base += loop) {
    for (const n of sorted) {
      if (n.tick >= loop) continue;
      const tick = base + n.tick;
      if (tick >= clip.length) break;
      if (!push(n, tick, Math.min(base + loop, clip.length))) return out;
    }
  }
  return out;
}
