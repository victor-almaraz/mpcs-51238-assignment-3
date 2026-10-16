'use client';

import { useEffect, useRef, useState } from 'react';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { trackLabel } from '@/lib/project/model';
import { clipText, trackClips } from './layout';

const rowKey = (kind, id) => `${kind}:${id}`;

/**
 * Accessible mirror of the timeline (accessibility.md, Screen-reader model):
 * a treegrid named "Tracks and clips" whose track rows hold their clips in
 * time order. One row is in the tab order (roving tabindex).
 *
 * Rows: Up/Down move between rows and select the clip (Shift extends the
 * range on one track; Ctrl or Cmd moves without selecting); Home/End go to
 * the first or last row; Space or Enter selects the focused clip (Ctrl/Cmd
 * adds or removes it); Enter on a selected clip opens its properties; Mod+A
 * selects every clip. On a track row, Right expands or enters the first
 * clip, Left collapses, Enter selects the clips under the edit cursor and
 * Alt+Up/Down reorder the track.
 *
 * Clip commands (ARR-03): Left/Right move by the snap step; Alt+Left/Right
 * trim the start; Alt+Shift+Left/Right trim the end; Alt+Up/Down move to the
 * track above or below of the same kind; Mod+E splits at the edit cursor;
 * Mod+J joins; Mod+D duplicates; Delete or Backspace removes. Comma and
 * period move the edit cursor by the snap step (with Shift, a bar).
 */
export default function TimelineTree({ project, rowIds, meter, selection, setSelection, statusFor, commands, onCursorStep, onOpenProperties, editCursor }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [focusKey, setFocusKey] = useState(null);
  const anchor = useRef(null);
  const rowRefs = useRef(new Map());

  const rows = [];
  rowIds.forEach((trackId, i) => {
    const track = project.tracks[trackId];
    const clips = trackClips(project, track);
    rows.push({ key: rowKey('t', trackId), kind: 'track', trackId, track, position: i + 1, clips });
    if (!collapsed.has(trackId)) {
      clips.forEach((clip, j) => rows.push({ key: rowKey('c', clip.id), kind: 'clip', trackId, clip, index: j, count: clips.length }));
    }
  });
  const current = rows.find((r) => r.key === focusKey) ?? rows.find((r) => r.kind === 'clip' && selection.includes(r.clip.id)) ?? rows[0];

  const pendingFocus = useRef(null);
  useEffect(() => {
    if (pendingFocus.current) {
      rowRefs.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  });

  function focusRow(row) {
    if (!row) return;
    setFocusKey(row.key);
    pendingFocus.current = row.key;
  }

  /** Clip IDs between the anchor and `row` on the same track, in time order. */
  function rangeTo(row) {
    const start = rows.find((r) => r.kind === 'clip' && r.clip.id === anchor.current);
    if (!start || start.trackId !== row.trackId) return [row.clip.id];
    const [a, b] = [start.index, row.index].sort((x, y) => x - y);
    return trackClips(project, project.tracks[row.trackId])
      .slice(a, b + 1)
      .map((c) => c.id);
  }

  function arrive(row, e) {
    focusRow(row);
    if (row?.kind !== 'clip' || e.ctrlKey || e.metaKey) return;
    if (e.shiftKey) setSelection(rangeTo(row));
    else {
      anchor.current = row.clip.id;
      setSelection([row.clip.id]);
    }
  }

  function toggle(id) {
    anchor.current = id;
    setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
  }

  function onKeyDown(e) {
    const row = current;
    if (!row) return;
    const i = rows.indexOf(row);
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    let handled = true;
    if (!mod && (key === ',' || key === '.' || key === '<' || key === '>')) {
      onCursorStep(key === ',' || key === '<' ? -1 : 1, e.shiftKey ? 'bar' : 'step');
    } else if (mod && key === 'a') {
      setSelection(Object.keys(project.clips).filter((id) => rowIds.includes(project.clips[id].trackId)));
    } else if (mod && key === 'e') {
      commands.split(row.kind === 'track' ? row.trackId : null);
    } else if (mod && key === 'j') {
      commands.join();
    } else if (mod && key === 'd') {
      const copies = commands.duplicate() ?? [];
      if (copies.length > 0) {
        setFocusKey(rowKey('c', copies[0]));
        pendingFocus.current = rowKey('c', copies[0]);
      }
    } else if (row.kind === 'clip' && horizontal && !mod) {
      if (e.altKey) commands.trim(e.shiftKey ? 'end' : 'start', sign);
      else commands.move(sign * commands.snapStep());
      pendingFocus.current = row.key;
    } else if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      if (row.kind === 'clip') commands.move(0, sign);
      else commands.moveTrack(row.trackId, sign);
      pendingFocus.current = row.key;
    } else if (key === 'ArrowDown') arrive(rows[i + 1], e);
    else if (key === 'ArrowUp') arrive(rows[i - 1], e);
    else if (key === 'Home') arrive(rows[0], e);
    else if (key === 'End') arrive(rows[rows.length - 1], e);
    else if (key === 'ArrowRight' && row.kind === 'track') {
      if (collapsed.has(row.trackId)) setCollapsed(new Set([...collapsed].filter((id) => id !== row.trackId)));
      else if (row.clips.length > 0) arrive(rows[i + 1], e);
    } else if (key === 'ArrowLeft' && row.kind === 'track') {
      setCollapsed(new Set([...collapsed, row.trackId]));
    } else if ((key === ' ' || key === 'Enter') && row.kind === 'clip') {
      const id = row.clip.id;
      if (mod) toggle(id);
      else if (key === 'Enter' && selection.includes(id)) onOpenProperties();
      else {
        anchor.current = id;
        setSelection([id]);
      }
    } else if (key === 'Enter') {
      const hits = row.clips.filter((c) => c.start <= editCursor && editCursor < commands.clipEnd(c));
      setSelection(hits.map((c) => c.id));
    } else if (key === 'Delete' || key === 'Backspace') {
      if (row.kind === 'clip') {
        const doomed = selection.includes(row.clip.id) ? selection : [row.clip.id];
        const keep = (r) => r?.kind === 'clip' && r.trackId === row.trackId && !doomed.includes(r.clip.id);
        const neighbour = rows.slice(i + 1).find(keep) ?? rows.slice(0, i).reverse().find(keep);
        commands.remove(doomed);
        if (neighbour) {
          anchor.current = neighbour.clip.id;
          setSelection([neighbour.clip.id]);
          focusRow(neighbour);
        } else focusRow(rows.find((r) => r.key === rowKey('t', row.trackId)));
      }
    } else handled = false;
    if (handled) e.preventDefault();
  }

  return (
    <div
      role="treegrid"
      aria-label="Tracks and clips"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      className="flex flex-col rounded-ds border border-border-strong bg-surface"
    >
      {rows.map((row) => {
        const tabIndex = row === current ? 0 : -1;
        const common = {
          ref: (el) => (el ? rowRefs.current.set(row.key, el) : rowRefs.current.delete(row.key)),
          role: 'row',
          tabIndex,
          onFocus: () => setFocusKey(row.key),
        };
        if (row.kind === 'track') {
          return (
            <div
              key={row.key}
              {...common}
              aria-level={1}
              aria-expanded={row.clips.length > 0 ? !collapsed.has(row.trackId) : undefined}
              aria-posinset={row.position}
              aria-setsize={rowIds.length}
              onClick={() => focusRow(row)}
              className={cx('flex min-h-8 items-center px-2 font-bold', focusRing)}
            >
              <span role="gridcell">
                {trackLabel(project, row.trackId, row.position)}, {row.clips.length === 1 ? '1 clip' : `${row.clips.length} clips`}
              </span>
            </div>
          );
        }
        const isSelected = selection.includes(row.clip.id);
        return (
          <div
            key={row.key}
            {...common}
            aria-level={2}
            aria-selected={isSelected}
            aria-posinset={row.index + 1}
            aria-setsize={row.count}
            onClick={(e) => arrive(row, e)}
            className={cx(
              'flex min-h-8 items-center pr-2 pl-6 text-sm',
              isSelected ? 'bg-selected text-selected-fg' : 'hover:bg-hover',
              focusRing,
            )}
          >
            <span role="gridcell">{clipText(project, row.clip, meter, statusFor(row.clip))}</span>
          </div>
        );
      })}
    </div>
  );
}
