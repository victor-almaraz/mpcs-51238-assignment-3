'use client';

import { useMemo, useRef, useState } from 'react';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { LABEL_W, barBeatText, rowLabel, rowShortLabel } from './layout';

export const LANE_H = 48;
const VELOCITY_MIN = 1;
const VELOCITY_MAX = 127;
const STEM_W = 4;
const CHORD_STEP = 5; // px between stems of notes that start together

/** Notes in time order, then low to high, each with its stem's x in the lane. */
function stems(notes, grid, cellW) {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  return sorted.map((note, i) => {
    let chord = 0;
    for (let j = i - 1; j >= 0 && sorted[j].tick === note.tick; j--) chord++;
    return { note, x: LABEL_W + (note.tick / grid) * cellW + 2 + chord * CHORD_STEP };
  });
}

const velocityAtY = (y) => Math.round(Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, VELOCITY_MIN + (1 - y / LANE_H) * (VELOCITY_MAX - VELOCITY_MIN))));

/**
 * Velocity lane under the piano roll (PR-03): a stem per note, 1–127. A drag
 * paints velocities across the stems it passes, so one stroke edits several
 * notes. The value under the pointer or in focus is shown beside the lane.
 * For the keyboard the lane is one slider, "Velocity C4 bar 1.1", on the
 * selected note: arrows step by 1, Page Up and Page Down by 10, Home and End
 * go to 1 and 127; Shift+Left and Shift+Right move to the previous or next note.
 * `notes` are the notes the grid shows and edits.
 */
export default function VelocityLane({ cellW, notes, isDrums, meter, grid, cols, scrollX, selectedId, onSelect, commands, readOnly }) {
  const [hover, setHover] = useState(null); // note id under the pointer
  const [focused, setFocused] = useState(false);
  // While painting: note ID → the velocity painted at its stem. The lane shows it; release commits it as one edit.
  const [painted, setPainted] = useState(null);
  const laneRef = useRef(null);
  const list = useMemo(() => stems(notes, grid, cellW), [notes, grid, cellW]);
  const velocityOf = (note) => painted?.get(note.id) ?? note.velocity;
  const current = list.find((s) => s.note.id === selectedId) ?? list[0] ?? null;
  const shown = list.find((s) => s.note.id === hover) ?? (focused ? current : null);
  const name = (note) => `Velocity ${rowLabel(note.pitch, isDrums)} ${barBeatText(note.tick, meter, grid)}`;

  function pointAt(e) {
    const rect = laneRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left + scrollX, y: e.clientY - rect.top };
  }
  const under = (x) => list.filter((s) => x >= s.x - cellW / 2 && x <= s.x + STEM_W + cellW / 2 - CHORD_STEP);

  /** Paints the stems under the pointer to the velocity at its height; each stem keeps the last height painted on it. */
  function paint(e, values) {
    const { x, y } = pointAt(e);
    const hits = under(x);
    if (hits.length === 0) return values;
    const next = new Map(values);
    for (const s of hits) next.set(s.note.id, velocityAtY(y));
    setPainted(next);
    return next;
  }

  function onKeyDown(e) {
    if (!current) return;
    const v = current.note.velocity;
    const i = list.indexOf(current);
    let next = null;
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const to = list[i + (e.key === 'ArrowLeft' ? -1 : 1)];
      if (to) onSelect(to.note.id);
      e.preventDefault();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = v + 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = v - 1;
    else if (e.key === 'PageUp') next = v + 10;
    else if (e.key === 'PageDown') next = v - 10;
    else if (e.key === 'Home') next = VELOCITY_MIN;
    else if (e.key === 'End') next = VELOCITY_MAX;
    else return;
    e.preventDefault();
    if (!readOnly) commands.velocityTo([current.note.id], Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, next)));
  }

  return (
    <div className="relative shrink-0 overflow-hidden rounded-ds border border-border-strong bg-surface" style={{ height: LANE_H + 2 }}>
      <div
        className="absolute top-0 left-0 z-10 flex h-full flex-col justify-center border-r border-border bg-surface-2 px-2 text-xs"
        style={{ width: LABEL_W }}
      >
        <span className="uppercase tracking-[0.06em]">Velocity</span>
        <span aria-hidden="true" className="truncate tabular-nums text-muted">
          {shown ? `${velocityOf(shown.note)} · ${rowShortLabel(shown.note.pitch, isDrums)} ${barBeatText(shown.note.tick, meter, grid)}` : list.length ? 'Drag across the bars' : 'No notes'}
        </span>
      </div>
      <div
        ref={laneRef}
        aria-hidden="true"
        className="absolute inset-0"
        style={{ touchAction: 'none', cursor: readOnly || list.length === 0 ? 'default' : 'ns-resize' }}
        onPointerDown={(e) => {
          if (readOnly || e.button !== 0 || pointAt(e).x - scrollX < LABEL_W) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          // The stroke starts here even between stems; the stems it then crosses are painted.
          setPainted(paint(e, new Map()));
        }}
        onPointerMove={(e) => {
          if (painted) paint(e, painted);
          else setHover(under(pointAt(e).x)[0]?.note.id ?? null);
        }}
        onPointerUp={() => {
          if (painted?.size > 0) commands.paintVelocities(painted);
          setPainted(null);
        }}
        onPointerCancel={() => setPainted(null)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="absolute top-0 left-0 h-full" style={{ width: LABEL_W + cols * cellW, transform: `translateX(${-scrollX}px)` }}>
          {list.map(({ note, x }) => {
            const h = (velocityOf(note) / VELOCITY_MAX) * LANE_H;
            const on = note.id === current?.note.id;
            return (
              <div key={note.id} className="absolute bottom-0" style={{ left: x, width: STEM_W, height: h }}>
                <div className={cx('h-full w-full', on ? 'bg-accent' : 'bg-fg/60')} />
                <div className={cx('absolute -top-1 -left-0.5 size-[7px] rounded-full', on ? 'bg-accent' : 'bg-fg')} />
              </div>
            );
          })}
        </div>
      </div>
      {current ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={name(current.note)}
          aria-valuemin={VELOCITY_MIN}
          aria-valuemax={VELOCITY_MAX}
          aria-valuenow={current.note.velocity}
          aria-readonly={readOnly || undefined}
          aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
          data-help="Velocity: Up and Down change the selected note by 1, Page Up and Page Down by 10; Shift+Left and Shift+Right pick another note. Drag across the bars to paint."
          className={cx('absolute top-1 z-20 h-6 min-w-6 rounded-ds', focusRing)}
          style={{ left: Math.max(LABEL_W, current.x - scrollX - 10), width: 24, pointerEvents: 'none' }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      ) : null}
    </div>
  );
}
