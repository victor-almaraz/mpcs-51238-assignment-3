'use client';

import { useEffect, useRef } from 'react';
import { getEngine } from '@/lib/audio/engine-client';
import { CELL_W, LABEL_W, ROW_H, isBlackKey } from './layout';

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
export default function PianoRollCanvas({ view, rows, clip, clipStart, grid, barTicks, beatTicks, isDrums, selectedId, ghost, noteColor }) {
  const canvasRef = useRef(null);
  const props = useRef(null);
  useEffect(() => {
    props.current = { view, rows, clip, clipStart, grid, barTicks, beatTicks, isDrums, selectedId, ghost, noteColor };
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
    function draw() {
      const p = props.current;
      if (!p) {
        frame = requestAnimationFrame(draw);
        return;
      }
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
      const tickW = CELL_W / p.grid;
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
      for (let t = 0; t <= length; t += p.grid) {
        const x = t * tickW - sx;
        if (x < -1 || x > w + 1) continue;
        ctx.fillStyle = t % p.barTicks === 0 ? colors.bar : colors.line;
        ctx.fillRect(x, 0, t % p.beatTicks === 0 ? 1 : 0.5, h);
      }
      if (p.clip) {
        const rowOf = new Map(p.rows.map((pitch, i) => [pitch, i]));
        for (const n of p.clip.notes) {
          const r = rowOf.get(n.pitch);
          if (r === undefined || r < firstRow || r > lastRow) continue;
          const x = n.tick * tickW - sx;
          const width = p.isDrums ? CELL_W - 2 : Math.max(3, n.length * tickW - 1);
          if (x + width < 0 || x > w) continue;
          ctx.globalAlpha = p.isDrums ? 0.35 + (0.65 * n.velocity) / 127 : 1;
          // Notes take the track's colour, so the piano roll reads as the track it edits.
          ctx.fillStyle = p.noteColor ?? colors.note;
          ctx.fillRect(x + 1, r * ROW_H - sy + 3, width, ROW_H - 6);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = colors.noteEdge;
          ctx.lineWidth = n.id === p.selectedId ? 2 : 1;
          ctx.strokeRect(x + 1.5, r * ROW_H - sy + 3.5, width - 1, ROW_H - 7);
        }
      }
      if (p.ghost) {
        const r = p.rows.indexOf(p.ghost.pitch);
        const x = p.ghost.tick * tickW - sx;
        const width = p.isDrums ? CELL_W - 2 : Math.max(3, p.ghost.length * tickW - 1);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = colors.playhead;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1.5, r * ROW_H - sy + 3.5, width - 1, ROW_H - 7);
        ctx.setLineDash([]);
      }
      const tick = engine.positionTick() - p.clipStart;
      if (p.clip && tick >= 0 && tick <= length) {
        ctx.fillStyle = colors.playhead;
        ctx.fillRect(tick * tickW - sx, 0, 2, h);
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: LABEL_W, top: 0, transform: `translate(${view.scrollX}px, ${view.scrollY}px)` }}
    />
  );
}
