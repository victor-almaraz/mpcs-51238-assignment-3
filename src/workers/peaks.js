/*
 * Peaks worker (a3-audio-implementation.md, Decoding, hashing and peaks;
 * Sampler → Mip levels). Loaded as a module worker from
 * /worklets/workers/peaks.js. Both requests carry transferred channel copies:
 *   { t: 'peaks', id, sourceId, channels } → { t: 'peaks', id, sourceId, levels }
 *     where each level is { bucket, min, max }: Float32Array min/max pairs
 *     over both channels, level 0 at 256 frames per bucket, each level 4×
 *     coarser, up to 65 536 frames.
 *   { t: 'mips', id, sourceId, channels } → { t: 'mips', id, sourceId, levels }
 *     with levels [{ level: 1, channels }, { level: 2, channels }]: half-band
 *     filtered, 2:1 decimated copies for the sampler.
 */
import { buildMips } from '../dsp/core/halfband.js';

/** Frames per bucket at level 0, the level step, and the coarsest bucket (project limits). */
export const BASE_BUCKET = 256;
export const LEVEL_STEP = 4;
export const MAX_BUCKET = 65536;

/** Level 0 min/max over every channel. */
function baseLevel(channels) {
  const frames = channels[0].length;
  const count = Math.ceil(frames / BASE_BUCKET);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const end = Math.min(frames, (b + 1) * BASE_BUCKET);
    for (const ch of channels) {
      for (let i = b * BASE_BUCKET; i < end; i++) {
        const x = ch[i];
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { bucket: BASE_BUCKET, min, max };
}

/** The next level: LEVEL_STEP buckets of `level` per bucket. */
function coarser(level) {
  const count = Math.ceil(level.min.length / LEVEL_STEP);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let lo = Infinity;
    let hi = -Infinity;
    const end = Math.min(level.min.length, (b + 1) * LEVEL_STEP);
    for (let i = b * LEVEL_STEP; i < end; i++) {
      if (level.min[i] < lo) lo = level.min[i];
      if (level.max[i] > hi) hi = level.max[i];
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { bucket: level.bucket * LEVEL_STEP, min, max };
}

/** Every peak level for `channels`, finest first. */
export function peakLevels(channels) {
  const levels = [baseLevel(channels)];
  while (levels[levels.length - 1].bucket < MAX_BUCKET) levels.push(coarser(levels[levels.length - 1]));
  return levels;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (event) => {
    const msg = event.data;
    if (msg?.t === 'peaks') {
      const levels = peakLevels(msg.channels);
      const transfer = levels.flatMap((l) => [l.min.buffer, l.max.buffer]);
      self.postMessage({ t: 'peaks', id: msg.id, sourceId: msg.sourceId, levels }, transfer);
    } else if (msg?.t === 'mips') {
      const perChannel = msg.channels.map((c) => buildMips(c));
      const levels = [1, 2].map((level) => ({ level, channels: perChannel.map((m) => m[level - 1]) }));
      const transfer = levels.flatMap((l) => l.channels.map((c) => c.buffer));
      self.postMessage({ t: 'mips', id: msg.id, sourceId: msg.sourceId, levels }, transfer);
    }
  };
}
