/*
 * Sample-editor marker rules (design-patterns.md, DEV-03;
 * a3-audio-implementation.md, Sampler → Reading and loops). Markers are
 * frames of the loaded source here and fractions in the device params.
 * Pure functions; no React.
 */
import { LOOP_OFF, MIN_LOOP_FRAMES } from '@/dsp/instruments/sampler-zones';

export const MARKERS = [
  { id: 'start', label: 'Start' },
  { id: 'loopStart', label: 'Loop start' },
  { id: 'loopEnd', label: 'Loop end' },
  { id: 'end', label: 'End' },
];

/** Zero-crossing search distance, frames (DEV-03). */
export const ZERO_SEARCH = 2048;

/** Marker frames { start, end, loopStart, loopEnd } of `params` for a source of `frames` frames. */
export function markerFrames(params, frames) {
  const at = (id, fallback) => Math.round((params[id] ?? fallback) * frames);
  return { start: at('start', 0), end: at('end', 1), loopStart: at('loopStart', 0), loopEnd: at('loopEnd', 1) };
}

/**
 * [min, max] frames marker `id` may take with the others fixed: start < end,
 * and with a loop start < loopStart < loopEnd ≤ end with a loop of at least
 * 64 frames.
 */
export function markerRange(id, m, frames, loopMode) {
  const loop = loopMode !== LOOP_OFF;
  switch (id) {
    case 'start':
      return [0, (loop ? m.loopStart : m.end) - 1];
    case 'end':
      return [loop ? Math.max(m.loopEnd, m.start + 1) : m.start + 1, frames];
    case 'loopStart':
      return [m.start + 1, m.loopEnd - MIN_LOOP_FRAMES];
    default:
      return [m.loopStart + MIN_LOOP_FRAMES, m.end];
  }
}

/** The frame nearest `frame` within ±2048 where `channel` crosses zero, or `frame` when none does. */
export function nearestZeroCrossing(channel, frame) {
  for (let d = 0; d <= ZERO_SEARCH; d++) {
    for (const j of d === 0 ? [frame] : [frame - d, frame + d]) {
      if (j <= 0 || j >= channel.length) continue;
      const a = channel[j - 1];
      const b = channel[j];
      if (b === 0 || (a < 0 && b >= 0) || (a > 0 && b <= 0)) return j;
    }
  }
  return frame;
}

/** Markers for turning a loop on: the current ones when valid, else a loop over the last three quarters of the region. */
export function loopMarkersFor(m) {
  if (m.start < m.loopStart && m.loopStart < m.loopEnd && m.loopEnd <= m.end && m.loopEnd - m.loopStart >= MIN_LOOP_FRAMES) return m;
  return { ...m, loopStart: m.start + Math.max(1, Math.floor((m.end - m.start) / 4)), loopEnd: m.end };
}

/** "1.250 seconds, frame 60000". */
export function markerText(frame, rate) {
  return `${(frame / rate).toFixed(3)} seconds, frame ${frame}`;
}

/** Plain-language text for an engine sampler-zone-invalid reason. */
export const ZONE_REASONS = {
  'source-empty': 'The sample is empty.',
  'source-too-long': 'The sample is longer than 60 seconds.',
  'crossfade-too-long': 'The loop crossfade is longer than 500 ms.',
  'start-not-before-end': 'Start must come before End.',
  'loop-markers-out-of-order': 'The loop must lie between Start and End: Start, Loop start, Loop end, End.',
  'loop-too-short': 'The loop must be at least 64 frames long.',
};
