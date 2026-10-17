'use client';

import { useEffect, useRef } from 'react';
import { PPQ } from '@/dsp/core/constants';
import { getSource } from '@/lib/audio/decode';
import { getEngine } from '@/lib/audio/engine-client';
import { levelFor, peaksFor } from '@/lib/audio/peaks-client';
import { faderText } from '@/components/mixer/TrackStrip';
import { audioTempo, clipEndTick, envelopeGainAt } from '@/lib/project/clip-commands';
import { RULER_H, TRACK_H, clipRect, envelopeY, hasHandles, pxPerTick, trackClips, xAtFrame } from './layout';

function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Min/max of `level` over source frames [from, to). */
function bucketRange(level, from, to) {
  const a = Math.max(0, Math.floor(from / level.bucket));
  const b = Math.min(level.min.length, Math.max(a + 1, Math.ceil(to / level.bucket)));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i < b; i++) {
    if (level.min[i] < lo) lo = level.min[i];
    if (level.max[i] > hi) hi = level.max[i];
  }
  return lo === Infinity ? null : [lo, hi];
}

function drawWaveform(ctx, doc, clip, x0, top, height, zoom, width, color) {
  const source = getSource(clip.sourceId);
  if (!source) return false;
  const levels = peaksFor(source);
  if (!levels) return true;
  const tempo = audioTempo(doc);
  const ratio = source.rate / (doc.audioRate ?? source.rate);
  const framesPerTick = (tempo.frameAt(clip.start + PPQ) - tempo.frameAt(clip.start)) / PPQ;
  const framesPerPx = (framesPerTick / pxPerTick(zoom)) * ratio;
  const level = levelFor(levels, framesPerPx);
  const mid = top + height / 2;
  const end = Math.min(width, x0 + (clip.sourceLength * ratio) / framesPerPx);
  ctx.fillStyle = color;
  for (let px = Math.max(0, Math.floor(x0)); px < end; px++) {
    const from = clip.sourceOffset * ratio + (px - x0) * framesPerPx;
    const range = bucketRange(level, from, from + framesPerPx);
    if (!range) continue;
    const y0 = mid - range[1] * (height / 2);
    const y1 = mid - range[0] * (height / 2);
    ctx.fillRect(px, y0, 1, Math.max(1, y1 - y0));
  }
  return true;
}

/** `clip` with a drag preview (`ghost`) applied: a fade length, a gain or a moved envelope point. */
function previewed(clip, g) {
  if (!g || g.clipId !== clip.id) return clip;
  if (g.mode === 'fadeIn' || g.mode === 'fadeOut') return { ...clip, [g.mode]: { ...clip[g.mode], length: g.length } };
  if (g.mode === 'gain') return { ...clip, gainDb: g.gainDb };
  if (g.mode === 'envPoint') return { ...clip, envelope: clip.envelope.map((p) => (p.id === g.pointId ? { ...p, frame: g.frame, gain: g.gain } : p)).sort((a, b) => a.frame - b.frame) };
  return clip;
}

/** Draws an audio clip's gain envelope (when it has points) inside its box, with its visible points. */
function drawEnvelope(ctx, doc, clip, rect, zoom, sx, colors) {
  if (clip.envelope.length === 0) return;
  const len = clip.sourceLength;
  ctx.strokeStyle = colors.focus;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rect.x0 - sx, envelopeY(rect, envelopeGainAt(clip.envelope, 0)));
  for (const p of clip.envelope) {
    if (p.frame <= 0 || p.frame >= len) continue;
    ctx.lineTo(xAtFrame(doc, clip, p.frame, zoom) - sx, envelopeY(rect, p.gain));
  }
  ctx.lineTo(rect.x1 - sx, envelopeY(rect, envelopeGainAt(clip.envelope, len - 1)));
  ctx.stroke();
  ctx.fillStyle = colors.focus;
  for (const p of clip.envelope) {
    if (p.frame < 0 || p.frame >= len) continue;
    ctx.fillRect(xAtFrame(doc, clip, p.frame, zoom) - sx - 3, envelopeY(rect, p.gain) - 3, 6, 6);
  }
}

/** Draws the fade-in, fade-out and gain handles of a selected audio clip (ARR-05). */
function drawHandles(ctx, doc, clip, rect, zoom, sx, colors, gainDrag) {
  if (!hasHandles(rect)) return;
  const fadeInX = xAtFrame(doc, clip, clip.fadeIn.length, zoom) - sx;
  const fadeOutX = xAtFrame(doc, clip, clip.sourceLength - clip.fadeOut.length, zoom) - sx;
  const mid = (rect.x0 + rect.x1) / 2 - sx;
  ctx.fillStyle = colors.fg;
  ctx.fillRect(fadeInX + 1, rect.top + 1, 9, 9);
  ctx.fillRect(fadeOutX - 10, rect.top + 1, 9, 9);
  ctx.beginPath();
  ctx.moveTo(mid, rect.top + 1);
  ctx.lineTo(mid + 6, rect.top + 7);
  ctx.lineTo(mid, rect.top + 13);
  ctx.lineTo(mid - 6, rect.top + 7);
  ctx.closePath();
  ctx.fill();
  if (gainDrag) {
    const text = faderText(clip.gainDb);
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = colors.fg;
    ctx.fillRect(mid - w / 2, rect.top + 16, w, 15);
    ctx.fillStyle = colors.bg;
    ctx.fillText(text, mid - w / 2 + 4, rect.top + 27);
  }
}

/**
 * Visual layer of the timeline: a bar-number ruler, track rows with their
 * names, bar lines, clips with waveforms
 * (from cached peaks) or note sketches, fades, the selection, the edit cursor
 * and the playhead, drawn on Canvas 2D for the visible area only. Hidden from
 * the accessibility tree; the treegrid mirror is the accessible view. `ghost`
 * is the provisional result of a drag: a move or trim ({ clipIds, dTick,
 * dRow, mode }), a fade, gain or envelope-point edit on one clip, or a
 * marquee ({ x0, y0, x1, y1 }). Selected audio clips show fade and gain
 * handles; clips with envelope points show the envelope line. The
 * playhead is read from the engine in a requestAnimationFrame loop.
 */
export default function TimelineCanvas({ project, rowIds, zoom, meter, selected, ghost, editCursor, scrollRef }) {
  const canvasRef = useRef(null);
  const props = useRef(null);
  useEffect(() => {
    props.current = { project, rowIds, zoom, meter, selected, ghost, editCursor };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const colors = {
      bg: cssVar('--ds-surface', '#eff1eb'),
      alt: cssVar('--ds-surface-2', '#e4e8e0'),
      line: cssVar('--ds-border', '#bbbfb6'),
      bar: cssVar('--ds-border-strong', '#70736a'),
      fg: cssVar('--ds-fg', '#1e201a'),
      muted: cssVar('--ds-muted', '#53574e'),
      focus: cssVar('--ds-focus', '#1659b5'),
      clip: cssVar('--ds-bg', '#dee1d9'),
    };
    const engine = getEngine();
    let frame = 0;
    function draw() {
      frame = requestAnimationFrame(draw);
      const p = props.current;
      const scroller = scrollRef.current;
      if (!p || !scroller) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, scroller.clientWidth);
      const h = RULER_H + Math.max(TRACK_H, p.rowIds.length * TRACK_H);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const sx = scroller.scrollLeft;
      const k = pxPerTick(p.zoom);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      p.rowIds.forEach((_, r) => {
        if (r % 2 === 1) {
          ctx.fillStyle = colors.alt;
          ctx.fillRect(0, RULER_H + r * TRACK_H, w, TRACK_H);
        }
      });
      ctx.fillStyle = colors.clip;
      ctx.fillRect(0, 0, w, RULER_H);
      ctx.fillStyle = colors.bar;
      ctx.fillRect(0, RULER_H - 1, w, 1);
      // Beat and bar lines across the visible range.
      const firstTick = Math.floor(sx / k);
      const lastTick = Math.ceil((sx + w) / k);
      let bar = p.meter.barAt(firstTick);
      for (let t = p.meter.tickAtBar(bar); t <= lastTick; t = p.meter.tickAtBar(++bar)) {
        const beat = p.meter.beatTicksAt(t);
        const next = p.meter.tickAtBar(bar + 1);
        for (let b = t; b < next && b <= lastTick; b += beat) {
          ctx.fillStyle = b === t ? colors.bar : colors.line;
          ctx.fillRect(b * k - sx, b === t ? 0 : RULER_H, b === t ? 1 : 0.5, h);
        }
        ctx.fillStyle = colors.fg;
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(String(bar + 1), t * k - sx + 4, 14);
      }
      const g = p.ghost;
      p.rowIds.forEach((trackId, r) => {
        const track = p.project.tracks[trackId];
        for (const original of trackClips(p.project, track)) {
          const clip = previewed(original, g);
          const end = clipEndTick(p.project, clip);
          const x = clip.start * k - sx;
          const cw = Math.max(2, (end - clip.start) * k);
          if (x + cw < 0 || x > w) continue;
          const top = RULER_H + r * TRACK_H + 3;
          const ch = TRACK_H - 6;
          ctx.fillStyle = colors.clip;
          ctx.fillRect(x, top, cw, ch);
          ctx.fillStyle = clip.color ?? track.color;
          ctx.fillRect(x, top, cw, 4);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, top, cw, ch);
          ctx.clip();
          if (clip.kind === 'audio') {
            const shown = drawWaveform(ctx, p.project, clip, x, top + 14, ch - 16, p.zoom, w, clip.muted ? colors.line : colors.muted);
            if (!shown) {
              ctx.fillStyle = colors.fg;
              ctx.fillText('Audio not loaded', x + 4, top + 32);
            }
            const fadeIn = clip.fadeIn.length;
            const fadeOut = clip.fadeOut.length;
            if (fadeIn > 0 || fadeOut > 0) {
              const tempo = audioTempo(p.project);
              const startFrame = tempo.frameAt(clip.start);
              ctx.strokeStyle = colors.fg;
              ctx.lineWidth = 1;
              ctx.beginPath();
              if (fadeIn > 0) {
                ctx.moveTo(x, top + ch);
                ctx.lineTo(tempo.tickAt(startFrame + fadeIn) * k - sx, top + 4);
              }
              if (fadeOut > 0) {
                ctx.moveTo(tempo.tickAt(startFrame + clip.sourceLength - fadeOut) * k - sx, top + 4);
                ctx.lineTo(x + cw, top + ch);
              }
              ctx.stroke();
            }
          } else {
            const pitches = clip.notes.map((n) => n.pitch);
            const lo = Math.min(...pitches);
            const span = Math.max(12, Math.max(...pitches) - lo + 1);
            ctx.fillStyle = clip.muted ? colors.line : colors.muted;
            const repeat = clip.loopLength > 0 ? clip.loopLength : clip.length;
            for (let base = 0; base < clip.length; base += repeat) {
              for (const n of clip.notes) {
                if (base + n.tick >= clip.length) continue;
                const nx = (clip.start + base + n.tick) * k - sx;
                const ny = top + 14 + (ch - 18) * (1 - (n.pitch - lo + 1) / span);
                ctx.fillRect(nx, ny, Math.max(2, Math.min(n.length, clip.length - base - n.tick) * k), 2);
              }
            }
          }
          ctx.fillStyle = colors.fg;
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillText(clip.name, x + 4, top + 15);
          ctx.restore();
          const isSelected = p.selected.has(clip.id);
          ctx.strokeStyle = isSelected ? colors.focus : colors.bar;
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(x + 0.5, top + 0.5, cw - 1, ch - 1);
          if (clip.kind === 'audio') {
            const rect = clipRect(p.project, clip, r, p.zoom);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, top, cw, ch);
            ctx.clip();
            drawEnvelope(ctx, p.project, clip, rect, p.zoom, sx, colors);
            if (isSelected) drawHandles(ctx, p.project, clip, rect, p.zoom, sx, colors, g?.mode === 'gain' && g.clipId === clip.id);
            ctx.restore();
          }
          if (g && g.clipIds?.includes(clip.id)) {
            let gs = clip.start;
            let ge = end;
            if (g.mode === 'move') {
              gs += g.dTick;
              ge += g.dTick;
            } else if (g.mode === 'trimStart') gs = Math.min(ge - 1, gs + g.dTick);
            else ge = Math.max(gs + 1, ge + g.dTick);
            const gr = r + (g.mode === 'move' ? g.dRow : 0);
            ctx.setLineDash([4, 3]);
            ctx.strokeStyle = colors.focus;
            ctx.lineWidth = 2;
            ctx.strokeRect(gs * k - sx + 1, RULER_H + gr * TRACK_H + 4, Math.max(2, (ge - gs) * k) - 2, TRACK_H - 8);
            ctx.setLineDash([]);
          }
        }
      });
      // Track names stay at the left edge, above the clips.
      ctx.font = '11px ui-monospace, monospace';
      p.rowIds.forEach((trackId, r) => {
        const label = p.project.tracks[trackId].name;
        const y = RULER_H + r * TRACK_H + TRACK_H - 8;
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = colors.bg;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(0, y - 11, tw, 15);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.fg;
        ctx.fillText(label, 4, y);
      });
      ctx.fillStyle = colors.focus;
      for (let y = 0; y < h; y += 8) ctx.fillRect(p.editCursor * k - sx, y, 1, 4);
      if (g?.mode === 'marquee') {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = colors.focus;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.min(g.x0, g.x1) - sx + 0.5, Math.min(g.y0, g.y1) + 0.5, Math.abs(g.x1 - g.x0), Math.abs(g.y1 - g.y0));
        ctx.setLineDash([]);
      }
      if (engine.getState().playing) {
        ctx.fillStyle = colors.fg;
        ctx.fillRect(engine.positionTick() * k - sx, 0, 2, h);
      }
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [scrollRef]);

  return <canvas ref={canvasRef} aria-hidden="true" className="sticky left-0 top-0 block" />;
}
