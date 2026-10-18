'use client';

import { useEffect, useRef } from 'react';
import { getEngine } from '@/lib/audio/engine-client';
import { PPQ } from '@/dsp/core/constants';
import { LABEL_W, ROW_H, isBlackKey } from './layout';

/** Drum hits draw one 1/16 step wide at the current scale, whatever the grid. */
const DRUM_HIT_TICKS = PPQ / 4;

function cssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Visual layer of the piano roll: row shading, bar and beat lines, notes and
 * the playhead, drawn on Canvas 2D for the visible area only. Hidden from the
 * accessibility tree and from pointer events; the grid mirror on top receives
 * all input. `ghost` is the provisional note of a drag, drawn dashed. `view` is { scrollX, scrollY, width, height }; the playhead is
 * read from the engine in a requestAnimationFrame loop, never React state.
 */
/** Longest gap between redraws of an idle, unchanged piano roll, ms. */
const IDLE_REDRAW_MS = 250;

export default function PianoRollCanvas({ tickW, view, rows, clip, clipStart, grid, barTicks, beatTicks, isDrums, selectedId, ghost, noteColor }) {
  const canvasRef = useRef(null);
  const props = useRef(null);
  const playheadRef = useRef(null);
  useEffect(() => {
    props.current = { tickW, view, rows, clip, clipStart, grid, barTicks, beatTicks, isDrums, selectedId, ghost, noteColor };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const colors = {
      bg: cssVar('--ds-surface', '#faf9f6'),
      black: cssVar('--ds-surface-2', '#efece8'),
      line: cssVar('--ds-border', '#cccac5'),
      bar: cssVar('--ds-border-strong', '#77746e'),
      note: cssVar('--ds-accent', '#ea6f2f'),
      noteEdge: cssVar('--ds-fg', '#1c1a16'),
      playhead: cssVar('--ds-focus', '#145ec1'),
    };
    const engine = getEngine();
    let frame = 0;
    // As the timeline: the canvas redraws on change, else at most IDLE_REDRAW_MS apart; the playhead
    // is a separate element moved by a transform, so playback does not repaint the grid.
    const drawn = { p: null, playing: false, at: 0 };
    function draw(now) {
      const p = props.current;
      const playing = engine.getState().playing;
      const head = playheadRef.current;
      if (p && head) {
        const tick = engine.positionTick() - p.clipStart;
        const inClip = playing && p.clip && tick >= 0 && tick <= p.clip.length;
        if (inClip) {
          head.style.display = '';
          head.style.height = `${Math.max(1, p.view.height)}px`;
          head.style.transform = `translate(${Math.round(tick * p.tickW)}px, ${p.view.scrollY}px)`;
        } else if (head.style.display !== 'none') head.style.display = 'none';
      }
      if (!p || (drawn.p === p && drawn.playing === playing && now - drawn.at < IDLE_REDRAW_MS)) {
        frame = requestAnimationFrame(draw);
        return;
      }
      Object.assign(drawn, { p, playing, at: now });
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, p.view.width - LABEL_W);
      const h = Math.max(1, p.view.height);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);
      const tickW = p.tickW;
      const sx = p.view.scrollX;
      const sy = p.view.scrollY;
      const firstRow = Math.max(0, Math.floor(sy / ROW_H));
      const lastRow = Math.min(p.rows.length - 1, Math.ceil((sy + h) / ROW_H));
      for (let r = firstRow; r <= lastRow; r++) {
        if (!p.isDrums && isBlackKey(p.rows[r])) {
          ctx.fillStyle = colors.black;
          ctx.fillRect(0, r * ROW_H - sy, w, ROW_H);
        }
        ctx.fillStyle = colors.line;
        ctx.fillRect(0, (r + 1) * ROW_H - sy - 0.5, w, 0.5);
      }
      const length = p.clip ? p.clip.length : 0;
      // Grid steps, then beats and bars over them: a triplet grid does not land on every beat.
      const line = (t, width) => {
        const x = t * tickW - sx;
        if (x < -1 || x > w + 1) return;
        ctx.fillStyle = t % p.barTicks === 0 ? colors.bar : colors.line;
        ctx.fillRect(x, 0, width, h);
      };
      for (let t = 0; t <= length; t += p.grid) if (t % p.beatTicks !== 0) line(t, 0.5);
      for (let t = 0; t <= length; t += p.beatTicks) line(t, 1);
      if (p.clip) {
        const rowOf = new Map(p.rows.map((pitch, i) => [pitch, i]));
        for (const n of p.clip.notes) {
          const r = rowOf.get(n.pitch);
          if (r === undefined || r < firstRow || r > lastRow) continue;
          const x = n.tick * tickW - sx;
          const width = p.isDrums ? DRUM_HIT_TICKS * tickW - 2 : Math.max(3, n.length * tickW - 1);
          if (x + width < 0 || x > w) continue;
          ctx.globalAlpha = p.isDrums ? 0.35 + (0.65 * n.velocity) / 127 : 1;
          // Notes take the track's colour, so the piano roll reads as the track it edits.
          ctx.fillStyle = p.noteColor ?? colors.note;
          ctx.fillRect(x + 1, r * ROW_H - sy + 3, width, ROW_H - 6);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = colors.noteEdge;
          ctx.lineWidth = n.id === p.selectedId ? 2 : 1;
          ctx.strokeRect(x + 1.5, r * ROW_H - sy + 3.5, width - 1, ROW_H - 7);
          // The selected note shows grips at both ends: drag either one to stretch it.
          if (n.id === p.selectedId && !p.isDrums && width >= 10) {
            ctx.fillStyle = colors.noteEdge;
            ctx.fillRect(x + 3, r * ROW_H - sy + 8, 2, ROW_H - 16);
            ctx.fillRect(x + width - 3, r * ROW_H - sy + 8, 2, ROW_H - 16);
          }
        }
      }
      if (p.ghost) {
        const r = p.rows.indexOf(p.ghost.pitch);
        const x = p.ghost.tick * tickW - sx;
        const width = p.isDrums ? DRUM_HIT_TICKS * tickW - 2 : Math.max(3, p.ghost.length * tickW - 1);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = colors.playhead;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1.5, r * ROW_H - sy + 3.5, width - 1, ROW_H - 7);
        ctx.setLineDash([]);
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{ left: LABEL_W, top: 0, transform: `translate(${view.scrollX}px, ${view.scrollY}px)` }}
      />
      <div ref={playheadRef} aria-hidden="true" className="pointer-events-none absolute top-0 w-0.5 bg-focus" style={{ left: LABEL_W, display: 'none' }} />
    </>
  );
}
