/*
 * Message protocol shared by the main thread and the worklet
 * (a3-audio-implementation.md, Messaging protocol). Every message carries
 * `t` (type) and `v: 1`. Each validator returns null for a valid message or an
 * error code string. Validators may allocate: they run in onmessage, never in
 * process().
 */

export const PROTOCOL_VERSION = 1;

/** EngineModel schema version (a3-audio-implementation.md, Versioning). */
export const MODEL_SCHEMA = 1;

/** Messages the safety processor accepts. */
export const SAFETY_IN = Object.freeze(['resume-fade', 'ack-duck']);

/** Messages the safety processor posts: guard { muted }, duck { active }, error { code, detail }. */
export const SAFETY_OUT = Object.freeze(['guard', 'duck', 'error']);

/** Transport operations, applied at the next quantum boundary. */
export const TRANSPORT_OPS = Object.freeze(['play', 'stop', 'locate', 'loop']);

const isObject = (v) => v !== null && typeof v === 'object';
const isFrame = (v) => Number.isInteger(v) && v >= 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/** Validates the envelope shared by every message. */
export function validateEnvelope(msg) {
  if (!isObject(msg)) return 'not-an-object';
  if (msg.v !== PROTOCOL_VERSION) return 'bad-version';
  if (typeof msg.t !== 'string') return 'missing-type';
  return null;
}

/** Validates a message sent to the safety processor. */
export function validateSafetyMessage(msg) {
  const envelope = validateEnvelope(msg);
  if (envelope) return envelope;
  return SAFETY_IN.includes(msg.t) ? null : 'unknown-type';
}

function validateTempoPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return false;
  return points.every((p) => isObject(p) && isFrame(p.tick) && Number.isFinite(p.bpm) && (p.shape === 'step' || p.shape === 'linear'));
}

function validateMeterPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return false;
  return points.every((p) => isObject(p) && isFrame(p.tick) && isPositiveInt(p.numerator) && isPositiveInt(p.denominator));
}

/** Maximum expanded notes per track (project limit). */
export const MAX_NOTES_PER_TRACK = 20000;

/** Maximum tracks (project limit). */
export const MAX_TRACKS = 16;

/**
 * Validates one model track: { deviceId, type, params, notes: { start, end,
 * pitch, vel } } with Int32Array frames sorted by start, end > start, pitch
 * 0–127 and velocity 1–127 in Uint8Arrays.
 */
export function validateModelTrack(track) {
  if (!isObject(track) || typeof track.deviceId !== 'string' || typeof track.type !== 'string') return 'bad-track';
  if (!isObject(track.params) || !Object.values(track.params).every(Number.isFinite)) return 'bad-params';
  const n = track.notes;
  if (!isObject(n) || !(n.start instanceof Int32Array) || !(n.end instanceof Int32Array)) return 'bad-notes';
  if (!(n.pitch instanceof Uint8Array) || !(n.vel instanceof Uint8Array)) return 'bad-notes';
  const count = n.start.length;
  if (count > MAX_NOTES_PER_TRACK || n.end.length !== count || n.pitch.length !== count || n.vel.length !== count) {
    return 'bad-notes';
  }
  for (let i = 0; i < count; i++) {
    if (n.start[i] < 0 || n.end[i] <= n.start[i] || n.pitch[i] > 127 || n.vel[i] < 1 || n.vel[i] > 127) return 'bad-note';
    if (i > 0 && n.start[i] < n.start[i - 1]) return 'unsorted-notes';
  }
  return null;
}

/**
 * Validates an EngineModel: { schema, fs, tempo, meter, loopStartFrame,
 * loopEndFrame, endFrame, tracks }.
 */
export function validateModel(model) {
  if (!isObject(model)) return 'model-not-an-object';
  if (model.schema !== MODEL_SCHEMA) return 'bad-schema';
  if (!(model.fs > 0)) return 'bad-fs';
  if (!validateTempoPoints(model.tempo)) return 'bad-tempo';
  if (!validateMeterPoints(model.meter)) return 'bad-meter';
  if (!isFrame(model.loopStartFrame) || !isFrame(model.loopEndFrame) || model.loopEndFrame <= model.loopStartFrame) {
    return 'bad-loop';
  }
  if (!isFrame(model.endFrame)) return 'bad-end';
  if (!Array.isArray(model.tracks) || model.tracks.length > MAX_TRACKS) return 'bad-tracks';
  for (const track of model.tracks) {
    const invalid = validateModelTrack(track);
    if (invalid) return invalid;
  }
  return null;
}

const ENGINE_VALIDATORS = {
  init(msg) {
    if (!Number.isInteger(msg.seed)) return 'bad-seed';
    return null;
  },
  model(msg) {
    if (!Number.isInteger(msg.rev) || msg.rev < 0) return 'bad-rev';
    return validateModel(msg.model);
  },
  transport(msg) {
    if (!TRANSPORT_OPS.includes(msg.op)) return 'bad-op';
    if ((msg.op === 'play' || msg.op === 'locate') && !isFrame(msg.frame)) return 'bad-frame';
    if (msg.op === 'loop') {
      if (typeof msg.loopOn !== 'boolean') return 'bad-loop';
      if (!isFrame(msg.loopStart) || !isFrame(msg.loopEnd) || msg.loopEnd <= msg.loopStart) return 'bad-loop';
    }
    return null;
  },
  metronome(msg) {
    if (typeof msg.on !== 'boolean') return 'bad-on';
    if (!Number.isFinite(msg.gainDb)) return 'bad-gain';
    return null;
  },
  master(msg) {
    if (!Number.isFinite(msg.volumeDb)) return 'bad-volume';
    return null;
  },
};

/** Messages the engine processor accepts. */
export const ENGINE_IN = Object.freeze(Object.keys(ENGINE_VALIDATORS));

/** Messages the engine posts: ready { fs, blockSize }, ack { rev }, pos { playFrame, ctxFrame, playing }, error { code, detail }. */
export const ENGINE_OUT = Object.freeze(['ready', 'ack', 'pos', 'error']);

/** Validates a message sent to the engine processor. */
export function validateEngineMessage(msg) {
  const envelope = validateEnvelope(msg);
  if (envelope) return envelope;
  const validate = ENGINE_VALIDATORS[msg.t];
  return validate ? validate(msg) : 'unknown-type';
}

/** Quanta between `pos` reports: max(1, round(0.025·fs/frames)) (project limit). */
export function reportQuanta(fs, frames) {
  return Math.max(1, Math.round((0.025 * fs) / frames));
}
