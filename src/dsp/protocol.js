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

/**
 * Messages the safety processor posts: guard { muted }, duck { active },
 * level { peakL, peakR, reduction } (post-limiter, every report period),
 * error { code, detail }.
 */
export const SAFETY_OUT = Object.freeze(['guard', 'duck', 'level', 'error']);

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

/** Maximum audio clips per track (project limit). */
export const MAX_CLIPS_PER_TRACK = 1000;

/** Maximum envelope points per audio track (project limit). */
export const MAX_ENVELOPE_POINTS = 20000;

/** Fade curve indices: FADE_CURVES order (linear, equalPower, exp). */
const FADE_CURVE_COUNT = 3;

const INT_FIELDS = ['start', 'length', 'srcStart', 'source', 'fadeIn', 'fadeOut'];

/**
 * Validates the clips of an audio model track: { id: string[], start, length,
 * srcStart, source (index into sourceIds), fadeIn, fadeOut: Int32Array;
 * gain: Float32Array; fadeInCurve, fadeOutCurve: Uint8Array; envStart:
 * Int32Array of count + 1 offsets into envFrame (Int32Array) and envGain
 * (Float32Array) }. Clips are sorted by start; envelope frames ascend per clip
 * and may lie outside the clip (anchors of segments crossing its edges).
 */
function validateAudioClips(c, sourceCount) {
  if (!isObject(c) || !Array.isArray(c.id)) return 'bad-clips';
  const count = c.id.length;
  if (count > MAX_CLIPS_PER_TRACK) return 'bad-clips';
  for (const key of INT_FIELDS) if (!(c[key] instanceof Int32Array) || c[key].length !== count) return 'bad-clips';
  if (!(c.gain instanceof Float32Array) || c.gain.length !== count) return 'bad-clips';
  for (const key of ['fadeInCurve', 'fadeOutCurve']) if (!(c[key] instanceof Uint8Array) || c[key].length !== count) return 'bad-clips';
  if (!(c.envStart instanceof Int32Array) || c.envStart.length !== count + 1) return 'bad-clips';
  if (!(c.envFrame instanceof Int32Array) || !(c.envGain instanceof Float32Array)) return 'bad-clips';
  const points = c.envFrame.length;
  if (points > MAX_ENVELOPE_POINTS || c.envGain.length !== points || c.envStart[0] !== 0 || c.envStart[count] !== points) return 'bad-clips';
  for (let i = 0; i < count; i++) {
    if (typeof c.id[i] !== 'string') return 'bad-clip';
    if (c.start[i] < 0 || c.length[i] <= 0 || c.srcStart[i] < 0) return 'bad-clip';
    if (c.source[i] < 0 || c.source[i] >= sourceCount) return 'bad-clip';
    if (c.fadeIn[i] < 0 || c.fadeOut[i] < 0 || c.fadeIn[i] > c.length[i] || c.fadeOut[i] > c.length[i]) return 'bad-clip';
    if (c.fadeInCurve[i] >= FADE_CURVE_COUNT || c.fadeOutCurve[i] >= FADE_CURVE_COUNT) return 'bad-clip';
    if (!(c.gain[i] >= 0) || !Number.isFinite(c.gain[i])) return 'bad-clip';
    if (i > 0 && c.start[i] < c.start[i - 1]) return 'unsorted-clips';
    const lo = c.envStart[i];
    const hi = c.envStart[i + 1];
    if (hi < lo) return 'bad-envelope';
    for (let k = lo; k < hi; k++) {
      if (!(c.envGain[k] >= 0) || !Number.isFinite(c.envGain[k])) return 'bad-envelope';
      if (k > lo && c.envFrame[k] <= c.envFrame[k - 1]) return 'bad-envelope';
    }
  }
  return null;
}

function validateMixer(track) {
  if (typeof track.trackId !== 'string') return 'bad-track';
  if (!Number.isFinite(track.gainDb) || !Number.isFinite(track.pan)) return 'bad-mixer';
  if (typeof track.mute !== 'boolean' || typeof track.solo !== 'boolean') return 'bad-mixer';
  return null;
}

/**
 * Validates one model track. Instrument tracks: { trackId, deviceId, type,
 * params, gainDb, pan, mute, solo, notes: { start, end, pitch, vel } } with
 * Int32Array frames sorted by start, end > start, pitch 0–127 and velocity
 * 1–127 in Uint8Arrays. Audio tracks: { trackId, kind: 'audio', gainDb, pan,
 * mute, solo, sourceIds: string[], clips } (validateAudioClips).
 */
export function validateModelTrack(track) {
  if (!isObject(track)) return 'bad-track';
  const mixer = validateMixer(track);
  if (mixer) return mixer;
  if (track.kind === 'audio') {
    if (!Array.isArray(track.sourceIds) || !track.sourceIds.every((id) => typeof id === 'string')) return 'bad-sources';
    return validateAudioClips(track.clips, track.sourceIds.length);
  }
  if (typeof track.deviceId !== 'string' || typeof track.type !== 'string') return 'bad-track';
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
  if (!Number.isFinite(model.masterPan)) return 'bad-master-pan';
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
  params(msg) {
    if (!Number.isInteger(msg.rev) || msg.rev < 0) return 'bad-rev';
    if (!(msg.values instanceof Float64Array) || msg.values.length % 3 !== 0) return 'bad-params';
    for (const x of msg.values) if (!Number.isFinite(x)) return 'bad-params';
    return null;
  },
  panic() {
    return null;
  },
  'source-add'(msg) {
    if (typeof msg.sourceId !== 'string' || msg.sourceId === '') return 'bad-source';
    const ch = msg.channels;
    if (!Array.isArray(ch) || ch.length < 1 || ch.length > 2) return 'bad-channels';
    if (!ch.every((c) => c instanceof Float32Array && c.length > 0 && c.length === ch[0].length)) return 'bad-channels';
    return null;
  },
  'source-remove'(msg) {
    return typeof msg.sourceId === 'string' ? null : 'bad-source';
  },
  'source-mips'(msg) {
    if (typeof msg.sourceId !== 'string') return 'bad-source';
    if (!Array.isArray(msg.levels) || msg.levels.length !== 2) return 'bad-mips';
    for (let i = 0; i < 2; i++) {
      const l = msg.levels[i];
      if (!isObject(l) || l.level !== i + 1 || !Array.isArray(l.channels) || l.channels.length < 1 || l.channels.length > 2) return 'bad-mips';
      if (!l.channels.every((c) => c instanceof Float32Array && c.length > 0)) return 'bad-mips';
    }
    return null;
  },
  'sampler-zones'(msg) {
    if (typeof msg.deviceId !== 'string') return 'bad-device';
    if (msg.selection !== 0 || !Array.isArray(msg.zones) || msg.zones.length > 1) return 'bad-zones';
    for (const z of msg.zones) {
      if (!isObject(z) || !(z.sourceId === null || typeof z.sourceId === 'string') || typeof z.sourceName !== 'string') return 'bad-zones';
    }
    return null;
  },
  live(msg) {
    if (!Number.isInteger(msg.track) || msg.track < 0 || msg.track >= MAX_TRACKS) return 'bad-track';
    if (!(msg.events instanceof Uint8Array) || msg.events.length % 3 !== 0) return 'bad-events';
    return null;
  },
};

/** Messages the engine processor accepts. */
export const ENGINE_IN = Object.freeze(Object.keys(ENGINE_VALIDATORS));

/**
 * Messages the engine posts: ready { fs, blockSize }, ack { rev },
 * pos { playFrame, ctxFrame, playing, meters }, error { code, detail },
 * source-status { deviceId, sourceId, status: 'bound' | 'missing' },
 * sampler-zone-invalid { deviceId, zoneIndex, reason } (reason null once the
 * zone is valid again).
 * meters: Float32Array of [peakL, peakR, meanSquareL, meanSquareR] for 16
 * track slots in model order, then the master.
 */
export const ENGINE_OUT = Object.freeze(['ready', 'ack', 'pos', 'error', 'source-status', 'sampler-zone-invalid']);

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
