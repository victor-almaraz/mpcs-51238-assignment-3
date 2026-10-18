'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from '@/components/ui/icons/Icon';
import { cx, focusRing } from '@/design-systems/industrial/classes';
import { trackLabel } from '@/lib/project/model';
import { HEADER_W, RULER_H, TRACK_H, clipRect, clipText, trackClips } from './layout';

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
 * clip, Left collapses, Enter selects the clips under the edit cursor,
 * Alt+Up/Down reorder the track, M and S mute and solo it, and Delete
 * deletes it (onDeleteTrack confirms one that has clips).
 *
 * Clip commands (ARR-03): Left/Right move by the snap step; Alt+Left/Right
 * trim the start; Alt+Shift+Left/Right trim the end; Alt+Up/Down move to the
 * track above or below of the same kind; Mod+E splits at the edit cursor;
 * Mod+J joins; Mod+D duplicates; Delete or Backspace removes; the
 * ContextMenu key or Shift+F10 opens the clip menu. Comma and
 * period move the edit cursor by the snap step (with Shift, a bar).
 */
export default function TimelineTree({
  project,
  rowIds,
  meter,
  zoom,
  selection,
  setSelection,
  selectedTrackId,
  onSelectTrack,
  onDeleteTrack,
  onTrackChange,
  statusFor,
  commands,
  onCursorStep,
  onOpenProperties,
  onRename,
  armed = [],
  onArm,
  onClipMenu,
  editCursor,
  readOnly,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [focusKey, setFocusKey] = useState(null);
  const anchor = useRef(null);
  const rowRefs = useRef(new Map());

  const rows = [];
  rowIds.forEach((trackId, i) => {
    const track = project.tracks[trackId];
    const clips = trackClips(project, track);
    rows.push({ key: rowKey('t', trackId), kind: 'track', trackId, track, position: i + 1, row: i, clips });
    if (!collapsed.has(trackId)) {
      clips.forEach((clip, j) => rows.push({ key: rowKey('c', clip.id), kind: 'clip', trackId, clip, index: j, count: clips.length, row: i }));
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
    if (row.kind === 'clip' && (key === 'ContextMenu' || (e.shiftKey && key === 'F10'))) {
      onClipMenu(row.clip, rowRefs.current.get(row.key));
    } else if (key === 'F2' && !mod) {
      // F2 renames the focused track or clip.
      onRename(row);
    } else if (!mod && (key === ',' || key === '.' || key === '<' || key === '>')) {
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
    } else if (row.kind === 'track' && row.track.kind === 'instrument' && !mod && !e.altKey && key === 'r') {
      onArm(row.trackId);
    } else if (row.kind === 'track' && !mod && !e.altKey && (key === 'm' || key === 's')) {
      if (!readOnly) onTrackChange(row.trackId, key === 'm' ? { mute: !row.track.mute } : { solo: !row.track.solo });
    } else if (key === 'Enter') {
      onSelectTrack(row.trackId);
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
      } else if (!readOnly) onDeleteTrack(row.trackId);
    } else handled = false;
    if (handled) e.preventDefault();
  }

  return (
    <div
      role="treegrid"
      aria-label="Tracks and clips"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      className="pointer-events-none absolute inset-0"
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
          const t = row.track;
          const label = `${trackLabel(project, row.trackId, row.position)}, ${row.clips.length === 1 ? '1 clip' : `${row.clips.length} clips`}`;
          const kind = trackLabel(project, row.trackId, row.position).split(', ').slice(1).join(', ');
          const isCurrent = selectedTrackId === row.trackId;
          return (
            // A track header (ARR-01) that stays at the left edge while the timeline scrolls.
            <div
              key={row.key}
              {...common}
              aria-label={label}
              aria-level={1}
              aria-expanded={row.clips.length > 0 ? !collapsed.has(row.trackId) : undefined}
              aria-posinset={row.position}
              aria-setsize={rowIds.length}
              aria-selected={isCurrent}
              data-track-header=""
              onClick={() => {
                focusRow(row);
                onSelectTrack(row.trackId);
              }}
              // Double-clicking the header renames the track; its Mute and Solo buttons keep their own clicks.
              onDoubleClick={(e) => {
                if (!e.target.closest('button')) onRename(row);
              }}
              className={cx(
                'pointer-events-auto absolute left-0 z-10 flex items-stretch border-r border-b border-border-strong',
                isCurrent ? 'bg-hover' : 'bg-surface',
                t.mute ? 'opacity-70' : '',
                // Inside the row: an outer ring would be clipped at the left edge and hidden by the neighbouring rows.
                'outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
              )}
              style={{ top: RULER_H + row.row * TRACK_H, width: HEADER_W, height: TRACK_H, transform: 'translateX(var(--sx, 0px))' }}
            >
              <span aria-hidden="true" className="w-1.5 shrink-0" style={{ background: t.color }} />
              <span role="gridcell" className="flex min-w-0 flex-1 flex-col justify-center px-2">
                <span className="truncate text-sm">
                  {row.position} {t.name}
                </span>
                <span className="truncate text-xs text-muted">
                  {kind}
                  {t.mute ? ' · Muted' : ''}
                  {t.solo ? ' · Solo' : ''}
                </span>
              </span>
              <span role="gridcell" className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-pressed={t.mute ? 'true' : 'false'}
                  aria-label={`Mute ${t.name}`}
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrackChange(row.trackId, { mute: !t.mute });
                  }}
                  className={cx('min-h-6 min-w-6 rounded-ds border border-border-strong text-xs', t.mute ? 'bg-selected text-selected-fg' : 'bg-surface')}
                >
                  M
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-pressed={t.solo ? 'true' : 'false'}
                  aria-label={`Solo ${t.name}`}
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTrackChange(row.trackId, { solo: !t.solo });
                  }}
                  className={cx('min-h-6 min-w-6 rounded-ds border border-border-strong text-xs', t.solo ? 'bg-selected text-selected-fg' : 'bg-surface')}
                >
                  S
                </button>
                {t.kind === 'instrument' ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-pressed={armed.includes(row.trackId) ? 'true' : 'false'}
                    aria-label={`Arm ${t.name} for live input`}
                    data-tip={`Arm ${t.name} for live input (R on the track)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onArm(row.trackId);
                    }}
                    className={cx('inline-flex min-h-6 min-w-6 items-center justify-center rounded-ds border border-border-strong', armed.includes(row.trackId) ? 'bg-selected text-selected-fg' : 'bg-surface')}
                  >
                    <Icon name="circle-dot" className="size-3.5" />
                  </button>
                ) : null}
              </span>
            </div>
          );
        }
        const isSelected = selection.includes(row.clip.id);
        const rect = clipRect(project, row.clip, row.row, zoom);
        return (
          // Over the clip on the canvas, so keyboard focus shows on the clip itself.
          <div
            key={row.key}
            {...common}
            aria-label={clipText(project, row.clip, meter, statusFor(row.clip))}
            aria-level={2}
            aria-selected={isSelected}
            aria-posinset={row.index + 1}
            aria-setsize={row.count}
            aria-haspopup="menu"
            data-clip-id={row.clip.id}
            // Pointer events reach the arrangement's handlers, which hit-test by position; focus follows the click.
            className={cx('pointer-events-auto absolute rounded-ds', focusRing)}
            style={{ left: HEADER_W + rect.x0, top: rect.top, width: Math.max(4, rect.x1 - rect.x0), height: rect.height }}
          >
            <span role="gridcell" className="sr-only">
              {clipText(project, row.clip, meter, statusFor(row.clip))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
