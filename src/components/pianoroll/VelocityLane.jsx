'use client';

import { useRef, useState } from 'react';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { LABEL_W, rowLabel, rowShortLabel } from './layout';

export const LANE_H = 48;
const VELOCITY_MIN = 1;
const VELOCITY_MAX = 127;
const STEM_W = 4;
const CHORD_STEP = 5; // px between stems of notes that start together

/** "bar 2.3", or "bar 2.3.2" off the beat (the step of `grid` within the beat). */
function barBeat(tick, meter, grid) {
  const at = `${meter.barAt(tick) + 1}.${meter.beatAt(tick) + 1}`;
  const inBeat = meter.tickInBeat(tick);
  return inBeat === 0 ? `bar ${at}` : `bar ${at}.${Math.floor(inBeat / grid) + 1}`;
}

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
 */
export default function VelocityLane({ cellW, clip, isDrums, meter, grid, cols, scrollX, selectedId, onSelect, commands, readOnly }) {
  const [hover, setHover] = useState(null); // note id under the pointer
  const [focused, setFocused] = useState(false);
  const painting = useRef(null); // { ids: Set } while dragging
  const laneRef = useRef(null);
  const list = clip ? stems(clip.notes, grid, cellW) : [];
  const current = list.find((s) => s.note.id === selectedId) ?? list[0] ?? null;
  const shown = list.find((s) => s.note.id === hover) ?? (focused ? current : null);
  const name = (note) => `Velocity ${rowLabel(note.pitch, isDrums)} ${barBeat(note.tick, meter, grid)}`;

  function pointAt(e) {
    const rect = laneRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left + scrollX, y: e.clientY - rect.top };
  }
  const under = (x) => list.filter((s) => x >= s.x - cellW / 2 && x <= s.x + STEM_W + cellW / 2 - CHORD_STEP);

  function paint(e) {
    const { x, y } = pointAt(e);
    const hits = under(x);
    if (hits.length === 0) return;
    for (const s of hits) painting.current.ids.add(s.note.id);
    commands.velocityTo(hits.map((s) => s.note.id), velocityAtY(y), false);
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
          {shown ? `${shown.note.velocity} · ${rowShortLabel(shown.note.pitch, isDrums)} ${barBeat(shown.note.tick, meter, grid)}` : list.length ? 'Drag across the bars' : 'No notes'}
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
          painting.current = { ids: new Set() };
          paint(e);
        }}
        onPointerMove={(e) => {
          if (painting.current) paint(e);
          else setHover(under(pointAt(e).x)[0]?.note.id ?? null);
        }}
        onPointerUp={(e) => {
          const p = painting.current;
          painting.current = null;
          if (p && p.ids.size > 0) commands.velocityTo([...p.ids], velocityAtY(pointAt(e).y));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="absolute top-0 left-0 h-full" style={{ width: LABEL_W + cols * cellW, transform: `translateX(${-scrollX}px)` }}>
          {list.map(({ note, x }) => {
            const h = (note.velocity / VELOCITY_MAX) * LANE_H;
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
