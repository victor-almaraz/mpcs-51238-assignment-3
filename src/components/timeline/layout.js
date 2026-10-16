/*
 * Timeline geometry and labels, shared by the canvas, the treegrid mirror and
 * the command hook. Pure functions; no React.
 */
import { PPQ } from '@/dsp/core/constants';
import { clipEndTick } from '@/lib/project/clip-commands';

/** Row height and pixels per quarter note at zoom 1, CSS pixels. */
export const TRACK_H = 56;
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
