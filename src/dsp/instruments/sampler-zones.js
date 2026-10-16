/*
 * Sampler parameters and zone markers (instruments.md, Sampler;
 * a3-audio-implementation.md, Sampler → Reading and loops). Markers are
 * fractions 0–1 of the source, resolved to level-0 frames when a source binds
 * or a marker changes. Constraints (project limits): start < end; with a loop,
 * start < loopStart < loopEnd ≤ end and a loop of at least 64 frames; a
 * crossfade of at most 500 ms; a sampler-bound source of at most 60 s.
 * The crossfade is shortened to min(loopLength/2, loopStart − start).
 */
import { clampParam, defineParam } from '../core/params.js';

export const LOOP_MODES = ['off', 'forward', 'pingpong'];
export const LOOP_OFF = 0;
export const LOOP_FORWARD = 1;
export const LOOP_PINGPONG = 2;

export const TRIGGER_MODES = ['gate', 'trigger'];
export const VOICE_MODES = ['poly', 'mono'];

/** Shortest loop, in level-0 frames (project limit). */
export const MIN_LOOP_FRAMES = 64;

/** Longest loop crossfade, in ms (project limit). */
export const MAX_CROSSFADE_MS = 500;

/** Longest sampler-bound source, in seconds (project limit). */
export const MAX_SOURCE_S = 60;

/** Farthest playable note from rootNote, in semitones (project limit). */
export const MAX_TRANSPOSE = 24;

/*
 * Log-scale controls whose range starts at 0 use 'pow3' (a log scale needs
 * min > 0); the others with a log mapping in instruments.md use 'log'.
 */
export const SAMPLER_PARAMS = [
  defineParam({ id: 'rootNote', min: 0, max: 127, default: 60, unit: 'note', scale: 'lin', step: 1 }),
  defineParam({ id: 'fineTune', min: -100, max: 100, default: 0, unit: 'cents', scale: 'lin', step: 0.1 }),
  defineParam({ id: 'start', min: 0, max: 1, default: 0, unit: 'fraction', scale: 'lin' }),
  defineParam({ id: 'end', min: 0, max: 1, default: 1, unit: 'fraction', scale: 'lin' }),
  defineParam({ id: 'loopMode', scale: 'enum', options: LOOP_MODES, default: LOOP_OFF }),
  defineParam({ id: 'loopStart', min: 0, max: 1, default: 0, unit: 'fraction', scale: 'lin' }),
  defineParam({ id: 'loopEnd', min: 0, max: 1, default: 1, unit: 'fraction', scale: 'lin' }),
  defineParam({ id: 'loopCrossfade', min: 0, max: MAX_CROSSFADE_MS, default: 10, unit: 'ms', scale: 'pow3' }),
  defineParam({ id: 'trigger', scale: 'enum', options: TRIGGER_MODES, default: 0 }),
  defineParam({ id: 'attack', min: 0, max: 10000, default: 2, unit: 'ms', scale: 'pow3' }),
  defineParam({ id: 'decay', min: 1, max: 10000, default: 300, unit: 'ms', scale: 'log' }),
  defineParam({ id: 'sustain', min: 0, max: 1, default: 1, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'release', min: 5, max: 10000, default: 200, unit: 'ms', scale: 'log' }),
  defineParam({ id: 'cutoff', min: 20, max: 20000, default: 20000, unit: 'Hz', scale: 'log' }),
  defineParam({ id: 'resonance', min: 0, max: 1, default: 0, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'filterEnvAmount', min: -1, max: 1, default: 0, unit: '× 48 st', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'velSens', min: 0, max: 1, default: 1, unit: 'fraction', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'voiceMode', scale: 'enum', options: VOICE_MODES, default: 0 }),
  defineParam({ id: 'glide', min: 0, max: 2000, default: 0, unit: 'ms', scale: 'pow3' }),
  defineParam({ id: 'pan', min: -1, max: 1, default: 0, unit: 'pan', scale: 'lin', step: 0.01 }),
  defineParam({ id: 'level', min: -60, max: 6, default: 0, unit: 'dB', scale: 'lin', step: 0.1 }),
];

export const SAMPLER_DEF = Object.freeze(Object.fromEntries(SAMPLER_PARAMS.map((d) => [d.id, d])));

/** Indices into a resolved-zone array (Float64Array of ZONE_FIELDS). */
export const ZONE_START = 0;
export const ZONE_END = 1;
export const ZONE_LOOP_START = 2;
export const ZONE_LOOP_END = 3;
export const ZONE_CROSSFADE = 4;
export const ZONE_FIELDS = 5;

/**
 * Resolves marker fractions to level-0 frames without allocating (safe on the
 * audio thread). Writes [startFrame, endFrame, loopStartFrame, loopEndFrame,
 * crossfadeFrames] into `out` and returns null, or returns a reason string
 * and leaves `out` partly written. Values are expected already clamped.
 * @param {Float64Array} out receives ZONE_FIELDS values
 * @param {number} start fraction 0–1
 * @param {number} end fraction 0–1
 * @param {number} loopMode index into LOOP_MODES
 * @param {number} loopStart fraction 0–1
 * @param {number} loopEnd fraction 0–1
 * @param {number} crossfadeMs 0–500 ms
 * @param {number} sourceFrames level-0 source length, frames
 * @param {number} fs sample rate, Hz
 * @returns {string | null}
 */
export function resolveZoneInto(out, start, end, loopMode, loopStart, loopEnd, crossfadeMs, sourceFrames, fs) {
  if (!(sourceFrames >= 1)) return 'source-empty';
  if (sourceFrames > MAX_SOURCE_S * fs) return 'source-too-long';
  if (!(crossfadeMs >= 0 && crossfadeMs <= MAX_CROSSFADE_MS)) return 'crossfade-too-long';
  const s = Math.round(start * sourceFrames);
  const e = Math.round(end * sourceFrames);
  if (!(s < e)) return 'start-not-before-end';
  const ls = Math.round(loopStart * sourceFrames);
  const le = Math.round(loopEnd * sourceFrames);
  out[ZONE_START] = s;
  out[ZONE_END] = e;
  if (loopMode === LOOP_OFF) {
    // Unused without a loop; kept inside the region.
    out[ZONE_LOOP_START] = ls < s ? s : ls > e ? e : ls;
    out[ZONE_LOOP_END] = le < s ? s : le > e ? e : le;
    out[ZONE_CROSSFADE] = 0;
    return null;
  }
  if (!(s < ls && ls < le && le <= e)) return 'loop-markers-out-of-order';
  const length = le - ls;
  if (length < MIN_LOOP_FRAMES) return 'loop-too-short';
  let x = Math.round((crossfadeMs * fs) / 1000);
  if (x > length / 2) x = Math.floor(length / 2);
  if (x > ls - s) x = ls - s;
  out[ZONE_LOOP_START] = ls;
  out[ZONE_LOOP_END] = le;
  out[ZONE_CROSSFADE] = loopMode === LOOP_FORWARD ? x : 0;
  return null;
}

/** Plain value of zone field `id` from `zone`, or undefined when absent. */
function rawField(zone, id) {
  if (id === 'loopCrossfade') return zone.loopCrossfade ?? zone.loopCrossfadeMs;
  if (id === 'loopMode' && typeof zone.loopMode === 'string') return LOOP_MODES.indexOf(zone.loopMode);
  return zone[id];
}

/**
 * Validates a zone and resolves its markers to level-0 frames (main thread or
 * onmessage; allocates). `zoneParams` holds start, end, loopStart, loopEnd
 * (fractions 0–1), loopMode (index or name) and loopCrossfade (ms; the zone
 * field loopCrossfadeMs is also read). Absent fields take their defaults.
 * Loop markers constrain only when loopMode is not off.
 * @param {object} zoneParams marker values
 * @param {number} sourceFrames level-0 source length, frames
 * @param {number} fs sample rate, Hz
 * @returns {{ ok: true, value: { startFrame: number, endFrame: number, loopStartFrame: number,
 *   loopEndFrame: number, crossfadeFrames: number } } | { ok: false, reason: string }}
 */
export function resolveZone(zoneParams, sourceFrames, fs) {
  const v = {};
  for (const id of ['start', 'end', 'loopMode', 'loopStart', 'loopEnd', 'loopCrossfade']) {
    const def = SAMPLER_DEF[id];
    const raw = rawField(zoneParams ?? {}, id);
    if (raw === undefined) v[id] = def.default;
    else if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < def.min) return { ok: false, reason: `invalid-${id}` };
    else if (raw > def.max) return { ok: false, reason: id === 'loopCrossfade' ? 'crossfade-too-long' : `invalid-${id}` };
    else v[id] = clampParam(def, raw);
  }
  const out = new Float64Array(ZONE_FIELDS);
  const reason = resolveZoneInto(out, v.start, v.end, v.loopMode, v.loopStart, v.loopEnd, v.loopCrossfade, sourceFrames, fs);
  if (reason !== null) return { ok: false, reason };
  return {
    ok: true,
    value: {
      startFrame: out[ZONE_START],
      endFrame: out[ZONE_END],
      loopStartFrame: out[ZONE_LOOP_START],
      loopEndFrame: out[ZONE_LOOP_END],
      crossfadeFrames: out[ZONE_CROSSFADE],
    },
  };
}
