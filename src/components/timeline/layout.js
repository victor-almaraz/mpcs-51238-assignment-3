/*
 * Timeline geometry and labels, shared by the canvas, the treegrid mirror and
 * the command hook. Pure functions; no React.
 */
import { PPQ } from '@/dsp/core/constants';
import { ENVELOPE_GAIN_MAX, audioTempo, clipEndTick } from '@/lib/project/clip-commands';

/** Row height, bar-number ruler height and pixels per quarter note at zoom 1, CSS pixels. */
export const TRACK_H = 56;
export const RULER_H = 20;
/** Width of the track header column (ARR-01), CSS pixels. */
export const HEADER_W = 224;
export const QUARTER_W = 32;
/** Pointer distance from a clip edge that grabs a trim handle. */
export const EDGE_PX = 6;
/** Bars of empty timeline after the last clip. */
export const TAIL_BARS = 8;

export const pxPerTick = (zoom) => (QUARTER_W * zoom) / PPQ;

/** Tick at x (CSS pixels from the timeline start). */
export function xToTick(x, zoom) {
  return Math.max(0, Math.round(x / pxPerTick(zoom)));
}

export function tickToX(tick, zoom) {
  return tick * pxPerTick(zoom);
}

/** `tick` rounded to the nearest multiple of `step`. */
export function snap(tick, step) {
  return Math.max(0, Math.round(tick / step) * step);
}

/** "bar 5" on a bar line, else "bar 5 beat 3" (beats from 1), for a MeterMap. */
export function barText(tick, meter) {
  const bar = meter.barAt(tick) + 1;
  const atBar = meter.tickAtBar(bar - 1) === tick;
  return atBar ? `bar ${bar}` : `bar ${bar} beat ${meter.beatAt(tick) + 1}`;
}

/** Storage status of a clip's source: "Saved on this device", "Session only", "Loading audio…" or "Audio not loaded". */
export function sourceStatus(sourceId, getSource, loading) {
  const source = getSource(sourceId);
  if (source) return source.stored === 'device' ? 'Saved on this device' : 'Session only';
  return loading.has(sourceId) ? 'Loading audio…' : 'Audio not loaded';
}

/** "Clip: Verse riff, bar 5 to bar 9", plus the storage status for audio clips and "muted". */
export function clipText(doc, clip, meter, status) {
  const parts = [`Clip: ${clip.name}, ${barText(clip.start, meter)} to ${barText(clipEndTick(doc, clip), meter)}`];
  if (clip.muted) parts.push('muted');
  if (clip.kind === 'audio') parts.push(status);
  return parts.join(', ');
}

/** Clips of `track` in time order. */
export function trackClips(doc, track) {
  return track.clipIds
    .map((id) => doc.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

/** Last tick of any clip, or 0. */
export function contentEnd(doc) {
  let end = 0;
  for (const clip of Object.values(doc.clips)) end = Math.max(end, clipEndTick(doc, clip));
  return end;
}

/** Topmost clip of `track` under `tick` (the last one in time order), or null. */
export function clipAt(doc, track, tick) {
  let hit = null;
  for (const clip of trackClips(doc, track)) if (clip.start <= tick && tick < clipEndTick(doc, clip)) hit = clip;
  return hit;
}

/** On-canvas handle target size, CSS px (WCAG 2.5.8 minimum; ARR-05). */
export const HANDLE = 24;
/** Envelope point hit radius, CSS px. */
export const POINT_HIT = 8;
/** Clip gain change per pixel of vertical drag on the gain handle, dB. */
export const GAIN_DB_PER_PX = 0.25;

/** A clip's box in content pixels: { x0, x1, top, height } on track row `row`. */
export function clipRect(doc, clip, row, zoom) {
  return {
    x0: tickToX(clip.start, zoom),
    x1: tickToX(clipEndTick(doc, clip), zoom),
    top: RULER_H + row * TRACK_H + 3,
    height: TRACK_H - 6,
  };
}

/** Clip-relative frame at content x (audio clips), clamped to the clip. */
export function frameAtX(doc, clip, x, zoom) {
  const tempo = audioTempo(doc);
  const f = tempo.frameAt(xToTick(x, zoom)) - tempo.frameAt(clip.start);
  return Math.max(0, Math.min(clip.sourceLength - 1, f));
}

/** Content x of clip-relative frame `frame`. */
export function xAtFrame(doc, clip, frame, zoom) {
  const tempo = audioTempo(doc);
  return tickToX(tempo.tickAt(tempo.frameAt(clip.start) + frame), zoom);
}

/** Envelope gain ↔ y inside a clip box: 0 at the bottom, ENVELOPE_GAIN_MAX (+6 dB) at the top. */
export const envelopeY = (rect, gain) => rect.top + rect.height * (1 - gain / ENVELOPE_GAIN_MAX);
export const gainAtY = (rect, y) => Math.max(0, Math.min(ENVELOPE_GAIN_MAX, ENVELOPE_GAIN_MAX * (1 - (y - rect.top) / rect.height)));

/** True when the clip box is wide enough for the three top handles. */
export const hasHandles = (rect) => rect.x1 - rect.x0 >= 3 * HANDLE;

/**
 * The handle of audio clip `clip` under content point x, y: 'fadeIn' (the
 * target right of the fade-in's end), 'fadeOut' (left of the fade-out's
 * start), 'gain' (top centre), or null.
 */
export function handleAt(doc, clip, rect, x, y, zoom) {
  if (clip.kind !== 'audio' || !hasHandles(rect) || y < rect.top || y > rect.top + HANDLE) return null;
  const fadeInX = xAtFrame(doc, clip, clip.fadeIn.length, zoom);
  const fadeOutX = xAtFrame(doc, clip, clip.sourceLength - clip.fadeOut.length, zoom);
  const mid = (rect.x0 + rect.x1) / 2;
  if (x >= mid - HANDLE / 2 && x <= mid + HANDLE / 2) return 'gain';
  if (x >= fadeInX && x <= fadeInX + HANDLE) return 'fadeIn';
  if (x >= fadeOutX - HANDLE && x <= fadeOutX) return 'fadeOut';
  return null;
}

/** The visible envelope point of `clip` within POINT_HIT px of x, y, or null. */
export function envelopePointAt(doc, clip, rect, x, y, zoom) {
  if (clip.kind !== 'audio') return null;
  let best = null;
  let bestD = POINT_HIT;
  for (const p of clip.envelope) {
    if (p.frame < 0 || p.frame >= clip.sourceLength) continue;
    const d = Math.hypot(xAtFrame(doc, clip, p.frame, zoom) - x, envelopeY(rect, p.gain) - y);
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
